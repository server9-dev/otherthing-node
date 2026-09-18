// livekit-token — issues a LiveKit access token for a workspace's voice room,
// only to members of that workspace.
//
// POST /functions/v1/livekit-token   (Authorization: Bearer <user access token>)
//   { workspaceId }   uuid, or the on-chain bytes32 id of a bridged workspace
//   -> { url, token, room }

import { createClient } from 'npm:@supabase/supabase-js@2'
import { AccessToken } from 'npm:livekit-server-sdk@2'

const LIVEKIT_URL = Deno.env.get('LIVEKIT_URL') || 'wss://livekit.otherthing.ai'
const API_KEY = Deno.env.get('LIVEKIT_API_KEY')!
const API_SECRET = Deno.env.get('LIVEKIT_API_SECRET')!
const TOKEN_TTL = '2h'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHAIN_RE = /^0x[0-9a-f]{64}$/i

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  if (!API_KEY || !API_SECRET) return json(503, { error: 'Voice is not configured on this server' })

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: auth } = await admin.auth.getUser(token)
  if (!auth?.user) return json(401, { error: 'Sign in required' })

  let body: any
  try { body = await req.json() } catch { return json(400, { error: 'JSON body required' }) }
  const requested = String(body?.workspaceId || '')

  let workspaceId: string | null = null
  if (UUID_RE.test(requested)) {
    workspaceId = requested.toLowerCase()
  } else if (CHAIN_RE.test(requested)) {
    const { data } = await admin.from('workspaces').select('id')
      .eq('chain_workspace_id', requested.toLowerCase()).maybeSingle()
    workspaceId = data?.id ?? null
  }
  if (!workspaceId) return json(404, { error: 'Workspace not found — open it once to sync' })

  const { data: member } = await admin.from('workspace_members').select('role')
    .eq('workspace_id', workspaceId).eq('user_id', auth.user.id).maybeSingle()
  if (!member) return json(403, { error: 'Not a member of this workspace' })

  const { data: profile } = await admin.from('user_profiles').select('display_name')
    .eq('user_id', auth.user.id).maybeSingle()

  const room = `ws-${workspaceId}`
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: auth.user.id,
    name: profile?.display_name || auth.user.email?.split('@')[0] || 'Member',
    ttl: TOKEN_TTL,
  })
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true })

  return json(200, { url: LIVEKIT_URL, token: await at.toJwt(), room })
})
