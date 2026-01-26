/**
 * Sidecar entry point - runs the Node.js backend services
 * Used by Tauri to provide full backend functionality
 */

import { NodeService } from './node-service';
import { apiServer } from './api-server';

const nodeService = new NodeService();

async function main() {
  console.log('[Sidecar] Starting Node.js backend services...');

  // Start node in local mode
  try {
    await nodeService.startLocal();
    console.log('[Sidecar] Node started in local mode');

    // Set managers for API server
    apiServer.setManagers(
      nodeService.getOllamaManager(),
      nodeService.getSandboxManager(),
      nodeService.getIPFSManager()
    );
  } catch (err) {
    console.error('[Sidecar] Failed to start node:', err);
  }

  // Start the API server
  try {
    await apiServer.start();
    console.log('[Sidecar] API server started on http://localhost:8080');
  } catch (err) {
    console.error('[Sidecar] Failed to start API server:', err);
  }

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[Sidecar] Shutting down...');
    await nodeService.stop();
    await apiServer.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[Sidecar] Shutting down...');
    await nodeService.stop();
    await apiServer.stop();
    process.exit(0);
  });

  // Keep process alive
  console.log('[Sidecar] Backend services running');
}

main().catch(console.error);
