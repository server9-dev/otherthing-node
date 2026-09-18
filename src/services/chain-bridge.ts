/**
 * Bridge between on-chain workspaces (WorkspaceRegistry, bytes32 ids) and
 * their linked Postgres workspaces (uuid). The trusted work — verifying wallet
 * signatures and checking on-chain membership — happens in the `chain-bridge`
 * edge function; this module just calls it as the current user.
 */

import { ethers } from 'ethers';
import { db, currentUser } from './supabase-client';

export const WORKSPACE_REGISTRY_ADDRESS =
  process.env.WORKSPACE_REGISTRY_ADDRESS || '0x8433285448DB684b9a37b4bc97DBDcd72e148DCa';
export const CHAIN_RPC_URL = process.env.CHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

const CHAIN_WORKSPACE_RE = /^0x[0-9a-fA-F]{64}$/;
export const isChainWorkspaceId = (id: unknown): id is string =>
  typeof id === 'string' && CHAIN_WORKSPACE_RE.test(id);

/** Must match linkMessage() in supabase/functions/chain-bridge and the renderer. */
export function linkMessage(userId: string, address: string, issuedAt: string): string {
  return `Link this wallet to your OtherThing account.\n\nAccount: ${userId}\nWallet: ${address.toLowerCase()}\nIssued: ${issuedAt}`;
}

export class BridgeError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function callBridge(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await db().functions.invoke('chain-bridge', { body });
  if (error) {
    let message = error.message;
    let status = 502;
    const response = (error as any).context as Response | undefined;
    if (response && typeof response.json === 'function') {
      status = response.status;
      try { message = ((await response.json()) as { error?: string }).error || message; } catch {}
    }
    throw new BridgeError(message, status);
  }
  return data;
}

// userId:chainId -> uuid. Short-lived so on-chain leaves are noticed.
const resolved = new Map<string, { id: string; expires: number }>();
const RESOLVE_TTL_MS = 5 * 60_000;

/**
 * Postgres workspace id for an on-chain workspace, for the current user.
 * Re-checks on-chain membership through the edge function at most every 5 min.
 */
export async function resolveChainWorkspace(chainId: string): Promise<string> {
  const user = currentUser();
  if (!user) throw new BridgeError('Sign in required', 401);
  const key = `${user.id}:${chainId.toLowerCase()}`;
  const hit = resolved.get(key);
  if (hit && hit.expires > Date.now()) return hit.id;

  const { workspaceId } = await callBridge({ action: 'sync-workspace', chainWorkspaceId: chainId.toLowerCase() });
  resolved.set(key, { id: workspaceId, expires: Date.now() + RESOLVE_TTL_MS });
  return workspaceId;
}

/** Link a wallet the node holds (headless nodes) to the current account. */
export async function linkWalletWithKey(wallet: ethers.Wallet): Promise<void> {
  const user = currentUser();
  if (!user) throw new BridgeError('Sign in required', 401);
  const issuedAt = new Date().toISOString();
  const signature = await wallet.signMessage(linkMessage(user.id, wallet.address, issuedAt));
  await callBridge({ action: 'link-wallet', address: wallet.address, issuedAt, signature });
}
