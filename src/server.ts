/**
 * Headless Server
 *
 * Runs the API server without Electron for server/CLI deployments.
 * Use this for WSL, Docker, or any headless environment.
 */

import 'dotenv/config';
import * as path from 'path';
import * as os from 'os';
import { apiServer } from './api-server';
import { OllamaManager } from './ollama-manager';
import { SandboxManager } from './sandbox-manager';
import { IPFSManager } from './ipfs-manager';
import { nodeSession } from './services/supabase-client';
import { WorkspaceDirectory } from './services/workspace-directory';
import { ipfsSyncService } from './services/ipfs-sync-service';
import { inferenceRelay } from './services/inference-relay';
import { ethers } from 'ethers';
import {
  resolveChainWorkspace, linkWalletWithKey, CHAIN_RPC_URL, WORKSPACE_REGISTRY_ADDRESS,
} from './services/chain-bridge';

const PORT = process.env.API_PORT || 8080;

async function main() {
  console.log('[Server] Starting headless otherthing-node server...');

  // Default storage path
  const storagePath = process.env.STORAGE_PATH || path.join(os.homedir(), '.otherthing');
  console.log(`[Server] Storage path: ${storagePath}`);

  // Initialize managers
  const ollamaManager = new OllamaManager();
  const sandboxManager = new SandboxManager(storagePath);
  const ipfsManager = new IPFSManager(storagePath);

  // Set managers on API server
  apiServer.setManagers(ollamaManager, sandboxManager, ipfsManager);

  // Start Ollama if available
  try {
    const ollamaStatus = await ollamaManager.getStatus();
    if (ollamaStatus.installed) {
      console.log('[Server] Ollama detected, starting...');
      await ollamaManager.start();
      console.log('[Server] Ollama running');
    } else {
      console.log('[Server] Ollama not installed, skipping');
    }
  } catch (err) {
    console.log('[Server] Ollama not available:', err);
  }

  // Start the API server
  try {
    await apiServer.start();
    console.log(`[Server] API server running at http://localhost:${PORT}`);
    console.log('[Server] WebSocket at ws://localhost:${PORT}/ws/agents');
    console.log('[Server] Ready for requests!');
    startWorkspacePresence();
    console.log('');
    console.log('[Server] Public endpoints (via Cloudflare Tunnel):');
    console.log('  - https://api.otherthing.ai/health');
    console.log('  - https://api.otherthing.ai/api/v1/...');
  } catch (err) {
    console.error('[Server] Failed to start API server:', err);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    await apiServer.stop();
    await ollamaManager.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Server] Shutting down...');
    await apiServer.stop();
    await ollamaManager.stop();
    process.exit(0);
  });
}

/**
 * On-chain workspaces (the ones the app's UI uses). OTHERTHING_JOIN_CHAIN_WORKSPACES
 * is a comma-separated list of `workspaceId:inviteCode` — the same string the
 * app copies as an invite. The node joins on-chain with OTHERTHING_NODE_WALLET_KEY
 * (needs a little Sepolia ETH for gas), links that wallet to its account, and
 * the chain-bridge function then grants it the linked Postgres workspace.
 */
async function joinChainWorkspaces(): Promise<boolean> {
  const invites = (process.env.OTHERTHING_JOIN_CHAIN_WORKSPACES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const key = process.env.OTHERTHING_NODE_WALLET_KEY;
  if (!invites.length) return true;
  if (!key) {
    console.error('[Server] OTHERTHING_JOIN_CHAIN_WORKSPACES needs OTHERTHING_NODE_WALLET_KEY');
    return true;
  }
  const wallet = new ethers.Wallet(key, new ethers.JsonRpcProvider(CHAIN_RPC_URL));
  const registry = new ethers.Contract(WORKSPACE_REGISTRY_ADDRESS, [
    'function isMember(bytes32, address) view returns (bool)',
    'function joinWithInviteCode(bytes32 workspaceId, string inviteCode)',
  ], wallet);

  await linkWalletWithKey(wallet);
  console.log(`[Server] Node wallet ${wallet.address} linked to its account`);

  let ok = true;
  for (const invite of invites) {
    const [chainId, code] = invite.split(':');
    try {
      if (!(await registry.isMember(chainId, wallet.address))) {
        console.log(`[Server] Joining on-chain workspace ${chainId.slice(0, 10)}…`);
        const tx = await registry.joinWithInviteCode(chainId, code);
        await tx.wait();
      }
      const workspaceId = await resolveChainWorkspace(chainId);
      console.log(`[Server] On-chain workspace ${chainId.slice(0, 10)}… → ${workspaceId}`);
    } catch (err) {
      console.error(`[Server] Could not join on-chain workspace ${chainId.slice(0, 10)}… (will retry):`, (err as any).shortMessage || (err as Error).message);
      ok = false;
    }
  }
  return ok;
}

/**
 * Headless nodes have no UI to open a workspace, so they join and announce
 * themselves here. OTHERTHING_JOIN_WORKSPACES is a comma-separated list of
 * invite codes; joining is idempotent. Every workspace the node's account
 * belongs to is then synced (peer row + model list) and re-announced every
 * 5 minutes so last_seen and the model list stay fresh.
 */
function startWorkspacePresence(): void {
  const directory = new WorkspaceDirectory(apiServer.getWorkspaceManager());
  const inviteCodes = (process.env.OTHERTHING_JOIN_WORKSPACES || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  const nodeId = inferenceRelay.machineNodeId;
  let joined = false;

  const announce = async () => {
    const user = nodeSession.current?.user;
    if (!user) return;
    try {
      if (!joined) {
        const chainOk = await joinChainWorkspaces();
        for (const code of inviteCodes) {
          const ws = await directory.join(code).catch(err => {
            console.error(`[Server] Could not join workspace with code ${code}: ${err.message}`);
            return null;
          });
          if (ws) console.log(`[Server] Member of workspace "${ws.name}" (${ws.id})`);
        }
        joined = chainOk;
      }
      inferenceRelay.registerNodeId(nodeId);
      for (const ws of await directory.listMine(user.id)) {
        const result = await ipfsSyncService.syncWorkspace(ws.id, nodeId, os.hostname());
        if (!result.registered) console.warn(`[Server] Peer registration failed for "${ws.name}"`);
      }
    } catch (err) {
      console.error('[Server] Workspace presence update failed:', (err as Error).message);
    }
  };

  if (!nodeSession.current) {
    console.log('[Server] Not signed in — set OTHERTHING_NODE_EMAIL / OTHERTHING_NODE_PASSWORD to share this node with workspaces');
  }
  announce();
  setInterval(announce, 5 * 60_000);
}

main().catch(console.error);
