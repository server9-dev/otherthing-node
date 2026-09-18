/**
 * Workspace Sync Service — connects members' IPFS nodes and shares Ollama models
 *
 * When a user opens a workspace:
 * 1. Upsert this node's row in workspace_peers (node_id, IPFS info, Ollama models)
 * 2. Connect to other members' IPFS nodes
 * 3. Make other members' Ollama models available for inference (via the relay)
 */

import * as os from 'os';
import type { IPFSManager } from '../ipfs-manager';
import type { OllamaManager } from '../ollama-manager';
import { supabaseService } from './supabase-service';

export interface WorkspacePeer {
  /** Stable node ID the peer's inference relay answers to (target for requests). */
  nodeId: string;
  /** Auth user that owns the node. */
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

  /**
   * Register this node in the workspace and refresh the peer list.
   * `nodeId` is the ID the local inference relay answers to (wallet address
   * or machine ID) and becomes workspace_peers.node_id.
   */
  async syncWorkspace(workspaceId: string, nodeId: string, displayNameOverride?: string): Promise<{
    registered: boolean;
    peersFound: number;
    peersConnected: number;
  }> {
    if (!supabaseService.isInitialized()) {
      return { registered: false, peersFound: 0, peersConnected: 0 };
    }

    // Gather this node's info
    let peerId = '';
    let addresses: string[] = [];
    let ollamaEndpoint: string | null = null;
    let ollamaModels: string[] = [];
    const displayName = displayNameOverride || nodeId;

    // IPFS info (optional — might not be running)
    if (this.ipfsManager && this.ipfsManager.getIsRunning()) {
      peerId = this.ipfsManager.getPeerId() || '';
      try {
        const stats = await this.ipfsManager.getStats();
        addresses = stats.addresses || [];
      } catch {}
    }

    // Ollama info — model names from /api/tags; endpoint uses LAN IP so
    // members on the same network can reach it directly
    if (this.ollamaManager) {
      try {
        const running = await this.ollamaManager.checkRunning();
        if (running) {
          const lanIp = this.getLanIP();
          const localEndpoint = this.ollamaManager.getEndpoint();
          ollamaEndpoint = lanIp
            ? localEndpoint.replace(/127\.0\.0\.1|localhost/, lanIp)
            : localEndpoint;
          ollamaModels = (await this.ollamaManager.getModels()).map(m => m.name);
        }
      } catch {}
    }

    let registered = false;
    try {
      await supabaseService.registerPeer(workspaceId, {
        nodeId,
        peerId,
        addresses,
        ollamaEndpoint,
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
      const peers = await this.refreshPeers(workspaceId, nodeId);
      peersFound = peers.length;

      // Connect IPFS nodes
      if (this.ipfsManager && this.ipfsManager.getIsRunning()) {
        for (const peer of peers) {
          if (!peer.peerId) continue;
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
   * Reload a workspace's peers (other nodes, not `selfNodeId`) from Supabase.
   */
  async refreshPeers(workspaceId: string, selfNodeId: string): Promise<WorkspacePeer[]> {
    const result = await supabaseService.listWorkspacePeers(workspaceId);
    const peers: WorkspacePeer[] = result.documents
      .filter((p: any) => p.nodeId !== selfNodeId)
      .map((p: any) => ({
        nodeId: p.nodeId,
        userId: p.userId,
        displayName: p.displayName || p.nodeId,
        peerId: p.peerId || '',
        addresses: Array.isArray(p.addresses) ? p.addresses : [],
        ollamaEndpoint: p.ollamaEndpoint || null,
        ollamaModels: Array.isArray(p.ollamaModels) ? p.ollamaModels : [],
        lastSeen: p.lastSeen,
      }));
    this.peerCache.set(workspaceId, peers);
    return peers;
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

  /** Workspaces this node has registered in (the inference relay polls these). */
  getSyncedWorkspaces(): string[] {
    return Array.from(this.synced);
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
