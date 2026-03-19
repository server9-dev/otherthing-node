/**
 * Workspace Sync Service — connects members' IPFS nodes and shares Ollama models
 *
 * When a user opens a workspace:
 * 1. Register this node's IPFS peer info + Ollama models in Appwrite
 * 2. Connect to other members' IPFS nodes
 * 3. Make other members' Ollama models available for inference
 */

import * as os from 'os';
import type { IPFSManager } from '../ipfs-manager';
import type { OllamaManager } from '../ollama-manager';
import { appwriteService } from './appwrite-service';

export interface WorkspacePeer {
  userId: string;
  displayName: string;
  peerId: string;
  addresses: string[];
  ollamaEndpoint: string | null;
  ollamaModels: string[];
  lastSeen: string;
}

class WorkspaceSyncService {
  private ipfsManager: IPFSManager | null = null;
  private ollamaManager: OllamaManager | null = null;
  private synced: Set<string> = new Set();
  private peerCache: Map<string, WorkspacePeer[]> = new Map();

  setIPFSManager(ipfs: IPFSManager | null): void {
    this.ipfsManager = ipfs;
  }

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  async syncWorkspace(workspaceId: string, userId: string): Promise<{
    registered: boolean;
    peersFound: number;
    peersConnected: number;
  }> {
    if (!appwriteService.isInitialized()) {
      return { registered: false, peersFound: 0, peersConnected: 0 };
    }

    // Gather this node's info
    let peerId = '';
    let addresses: string[] = [];
    let ollamaEndpoint: string | null = null;
    let ollamaModels: string[] = [];
    const displayName = userId;

    // IPFS info (optional — might not be running)
    if (this.ipfsManager && this.ipfsManager.getIsRunning()) {
      peerId = this.ipfsManager.getPeerId() || '';
      try {
        const stats = await this.ipfsManager.getStats();
        addresses = stats.addresses || [];
      } catch {}
    }

    // Ollama info — use LAN IP so other workspace members can reach it
    if (this.ollamaManager) {
      try {
        const running = await this.ollamaManager.checkRunning();
        if (running) {
          // Get LAN IP for cross-machine access
          const lanIp = this.getLanIP();
          const localEndpoint = this.ollamaManager.getEndpoint();
          // Replace localhost/127.0.0.1 with LAN IP
          ollamaEndpoint = lanIp
            ? localEndpoint.replace(/127\.0\.0\.1|localhost/, lanIp)
            : localEndpoint;
          const status = await this.ollamaManager.getStatus();
          ollamaModels = (status.models || []).map((m: any) => m.name);
        }
      } catch {}
    }

    // Register in Appwrite
    let registered = false;
    try {
      await appwriteService.registerPeer(workspaceId, {
        peerId: peerId || `node-${userId}`,
        addresses,
        userId,
        ollamaEndpoint: ollamaEndpoint || undefined,
        ollamaModels,
        displayName,
      });
      registered = true;
    } catch (err) {
      console.warn('[Sync] Failed to register peer:', err);
    }

    // Fetch all peers and connect IPFS
    let peersFound = 0;
    let peersConnected = 0;
    try {
      const result = await appwriteService.listWorkspacePeers(workspaceId);
      const myPeerId = peerId || `node-${userId}`;
      const peers = result.documents
        .filter((p: any) => p.peerId !== myPeerId && p.userId !== userId)
        .map((p: any) => ({
          userId: p.userId,
          displayName: p.displayName || p.userId,
          peerId: p.peerId,
          addresses: p.addresses || [],
          ollamaEndpoint: p.ollamaEndpoint || null,
          ollamaModels: p.ollamaModels ? (typeof p.ollamaModels === 'string' ? JSON.parse(p.ollamaModels) : p.ollamaModels) : [],
          lastSeen: p.lastSeen,
        }));

      peersFound = peers.length;
      this.peerCache.set(workspaceId, peers);

      // Connect IPFS nodes
      if (this.ipfsManager && this.ipfsManager.getIsRunning()) {
        for (const peer of peers) {
          for (const addr of peer.addresses) {
            const fullAddr = addr.includes(peer.peerId) ? addr : `${addr}/p2p/${peer.peerId}`;
            try {
              await this.ipfsManager.connectPeer(fullAddr);
              peersConnected++;
              break;
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn('[Sync] Failed to fetch peers:', err);
    }

    this.synced.add(workspaceId);
    return { registered, peersFound, peersConnected };
  }

  /**
   * Get all workspace peers with their models — used by the model dropdown
   */
  getWorkspacePeers(workspaceId: string): WorkspacePeer[] {
    return this.peerCache.get(workspaceId) || [];
  }

  isSynced(workspaceId: string): boolean {
    return this.synced.has(workspaceId);
  }

  private getLanIP(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return null;
  }
}

export const ipfsSyncService = new WorkspaceSyncService();
