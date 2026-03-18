/**
 * IPFS Sync Service — auto-connect workspace members' IPFS nodes
 *
 * When a user opens a workspace:
 * 1. Register this node's IPFS peer ID + addresses in Appwrite
 * 2. Fetch all other members' peer info from Appwrite
 * 3. Connect to each peer's IPFS node via swarm connect
 *
 * This ensures all members can resolve each other's CIDs for
 * files, artifacts, and exports stored in IPFS.
 */

import type { IPFSManager } from '../ipfs-manager';
import { appwriteService } from './appwrite-service';

class IPFSSyncService {
  private ipfsManager: IPFSManager | null = null;
  private synced: Set<string> = new Set(); // workspaceIds already synced this session

  setIPFSManager(ipfs: IPFSManager | null): void {
    this.ipfsManager = ipfs;
  }

  /**
   * Call when a user opens a workspace.
   * Registers this node and connects to all other members' IPFS nodes.
   */
  async syncWorkspace(workspaceId: string, userId: string): Promise<{
    registered: boolean;
    peersFound: number;
    peersConnected: number;
  }> {
    if (!this.ipfsManager || !this.ipfsManager.getIsRunning() || !appwriteService.isInitialized()) {
      return { registered: false, peersFound: 0, peersConnected: 0 };
    }

    // Get our peer info
    const peerId = this.ipfsManager.getPeerId();
    if (!peerId) {
      return { registered: false, peersFound: 0, peersConnected: 0 };
    }

    let addresses: string[] = [];
    try {
      const stats = await this.ipfsManager.getStats();
      addresses = stats.addresses || [];
    } catch {}

    // Register our node in Appwrite
    let registered = false;
    try {
      await appwriteService.registerPeer(workspaceId, {
        peerId,
        addresses,
        userId,
      });
      registered = true;
    } catch (err) {
      console.warn('[IPFSSync] Failed to register peer:', err);
    }

    // Fetch all peers for this workspace
    let peersFound = 0;
    let peersConnected = 0;
    try {
      const result = await appwriteService.listWorkspacePeers(workspaceId);
      const peers = result.documents.filter((p: any) => p.peerId !== peerId); // exclude self
      peersFound = peers.length;

      // Connect to each peer
      for (const peer of peers) {
        for (const addr of peer.addresses) {
          // Only try addresses that include the peer ID
          const fullAddr = addr.includes(peer.peerId) ? addr : `${addr}/p2p/${peer.peerId}`;
          try {
            await this.ipfsManager.connectPeer(fullAddr);
            peersConnected++;
            console.log(`[IPFSSync] Connected to peer ${peer.userId} at ${fullAddr}`);
            break; // one successful connection per peer is enough
          } catch {
            // Try next address
          }
        }
      }
    } catch (err) {
      console.warn('[IPFSSync] Failed to fetch/connect peers:', err);
    }

    this.synced.add(workspaceId);
    console.log(`[IPFSSync] Workspace ${workspaceId.slice(0, 10)}...: registered=${registered}, peers=${peersFound}, connected=${peersConnected}`);

    return { registered, peersFound, peersConnected };
  }

  isSynced(workspaceId: string): boolean {
    return this.synced.has(workspaceId);
  }
}

export const ipfsSyncService = new IPFSSyncService();
