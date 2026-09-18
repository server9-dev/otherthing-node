// chain-bridge — links wallets to accounts and mirrors on-chain workspace
// membership (WorkspaceRegistry) into Postgres. Runs with the service role, so
// it is the only writer of profile wallets and bridged workspaces.
//
// POST /functions/v1/chain-bridge   (Authorization: Bearer <user access token>)
//   { action: 'link-wallet', address, issuedAt, signature }
//       signature = personal_sign of linkMessage(userId, address, issuedAt)
//   { action: 'sync-workspace', chainWorkspaceId }
//       -> { workspaceId }   (403 if the user's wallet isn't a member on-chain)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { ethers } from 'npm:ethers@6'

const RPC_URL = Deno.env.get('CHAIN_RPC_URL') || 'https://ethereum-sepolia-rpc.publicnode.com'
const REGISTRY = Deno.env.get('WORKSPACE_REGISTRY_ADDRESS') || '0x8433285448DB684b9a37b4bc97DBDcd72e148DCa'
const REGISTRY_ABI = [
  'function getWorkspace(bytes32) view returns (tuple(bytes32 id, string name, string description, address owner, uint256 createdAt, bool isPublic, uint256 memberCount))',
  'function isMember(bytes32, address) view returns (bool)',
]
const LINK_MAX_AGE_MS = 10 * 60_000

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, new ethers.JsonRpcProvider(RPC_URL))

/** Kept identical in src/services/chain-bridge.ts and the renderer. */
export function linkMessage(userId: string, address: string, issuedAt: string): string {
  return `Link this wallet to your OtherThing account.\n\nAccount: ${userId}\nWallet: ${address.toLowerCase()}\nIssued: ${issuedAt}`
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function linkWallet(userId: string, body: any): Promise<Response> {
  const { address, issuedAt, signature } = body ?? {}
  if (!ethers.isAddress(address) || typeof issuedAt !== 'string' || typeof signature !== 'string') {
    return json(400, { error: 'address, issuedAt and signature are required' })
  }
  const age = Date.now() - Date.parse(issuedAt)
  if (!(age >= -60_000 && age <= LINK_MAX_AGE_MS)) {
    return json(400, { error: 'Link request expired — sign again' })
  }
  let signer: string
  try {
    signer = ethers.verifyMessage(linkMessage(userId, address, issuedAt), signature)
  } catch {
    return json(400, { error: 'Invalid signature' })
  }
  if (signer.toLowerCase() !== address.toLowerCase()) {
    return json(400, { error: 'Signature does not match wallet' })
  }

  const wallet = ethers.getAddress(address)
  const { data: holder } = await admin
    .from('user_profiles').select('user_id').ilike('wallet_address', wallet).maybeSingle()
  if (holder && holder.user_id !== userId) {
    return json(409, { error: 'This wallet is linked to another account' })
  }
  const { data: current } = await admin
    .from('user_profiles').select('wallet_address').eq('user_id', userId).single()
  if (current?.wallet_address === wallet) return json(200, { wallet })

  const { error } = await admin
    .from('user_profiles')
    .update({ wallet_address: wallet, chain_id: 11155111 })
    .eq('user_id', userId)
  if (error) return json(500, { error: error.message })

  // Memberships granted through a previous wallet no longer hold.
  if (current?.wallet_address) {
    await admin.from('workspace_members').delete()
      .eq('user_id', userId)
      .in('workspace_id', (await bridgedWorkspaceIds()) ?? [])
  }
  return json(200, { wallet })
}

async function bridgedWorkspaceIds(): Promise<string[] | null> {
  const { data } = await admin.from('workspaces').select('id').not('chain_workspace_id', 'is', null)
  return data?.map((r) => r.id) ?? null
}

async function syncWorkspace(userId: string, body: any): Promise<Response> {
  const chainId = String(body?.chainWorkspaceId || '').toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(chainId)) return json(400, { error: 'chainWorkspaceId must be a bytes32 hex string' })

  const { data: profile } = await admin
    .from('user_profiles').select('wallet_address').eq('user_id', userId).maybeSingle()
  const wallet = profile?.wallet_address
  if (!wallet) return json(412, { error: 'Link your wallet to your account first' })

  let ws: any
  try {
    ws = await registry.getWorkspace(chainId)
  } catch {
    return json(502, { error: 'Could not read the workspace from the chain' })
  }
  if (ws.owner === ethers.ZeroAddress) return json(404, { error: 'Workspace not found on-chain' })

  const { data: existing } = await admin
    .from('workspaces').select('id').eq('chain_workspace_id', chainId).maybeSingle()

  if (!(await registry.isMember(chainId, wallet))) {
    if (existing) {
      await admin.from('workspace_members').delete().eq('workspace_id', existing.id).eq('user_id', userId)
    }
    return json(403, { error: 'Your wallet is not a member of this workspace on-chain' })
  }

  const { data: ownerProfile } = await admin
    .from('user_profiles').select('user_id').ilike('wallet_address', ws.owner).maybeSingle()
  const fields = {
    name: ws.name || 'Workspace',
    description: ws.description || '',
    is_private: !ws.isPublic,
    owner_id: ownerProfile?.user_id ?? null,
  }

  let workspaceId: string
  if (existing) {
    workspaceId = existing.id
    await admin.from('workspaces').update(fields).eq('id', workspaceId)
  } else {
    const { data, error } = await admin
      .from('workspaces').insert({ ...fields, chain_workspace_id: chainId }).select('id').single()
    if (error) {
      // Lost a race with another first sync: use the row that won.
      const { data: again } = await admin
        .from('workspaces').select('id').eq('chain_workspace_id', chainId).single()
      if (!again) return json(500, { error: error.message })
      workspaceId = again.id
    } else {
      workspaceId = data.id
    }
  }

  const isOwner = ws.owner.toLowerCase() === wallet.toLowerCase()
  const { error: memberError } = await admin.from('workspace_members').upsert(
    { workspace_id: workspaceId, user_id: userId, role: isOwner ? 'owner' : 'member' },
    { onConflict: 'workspace_id,user_id' },
  )
  if (memberError) return json(500, { error: memberError.message })

  return json(200, { workspaceId })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: auth } = await admin.auth.getUser(token)
  if (!auth?.user) return json(401, { error: 'Sign in required' })

  let body: any
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'JSON body required' })
  }
  try {
    if (body.action === 'link-wallet') return await linkWallet(auth.user.id, body)
    if (body.action === 'sync-workspace') return await syncWorkspace(auth.user.id, body)
    return json(400, { error: 'Unknown action' })
  } catch (err) {
    console.error('[chain-bridge]', err)
    return json(500, { error: 'Internal error' })
  }
})
