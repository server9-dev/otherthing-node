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

main().catch(console.error);
