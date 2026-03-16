/**
 * IPFS Export Service — exports workspace artifacts (chat, whiteboard, transcription, digest) to IPFS
 */

import type { IPFSManager } from '../ipfs-manager';

export interface WorkspaceArtifact {
  cid: string;
  type: 'chat' | 'whiteboard' | 'transcription' | 'digest' | 'handoff' | 'health-report' | 'dispute-analysis';
  workspaceId: string;
  timestamp: string;
  metadata: Record<string, any>;
}

class IPFSExportService {
  private ipfsManager: IPFSManager | null = null;
  // In-memory artifact index per workspace
  private artifacts: Map<string, WorkspaceArtifact[]> = new Map();

  setIPFSManager(ipfs: IPFSManager | null): void {
    this.ipfsManager = ipfs;
  }

  async exportContent(
    workspaceId: string,
    type: WorkspaceArtifact['type'],
    content: any,
    metadata: Record<string, any> = {}
  ): Promise<WorkspaceArtifact | null> {
    if (!this.ipfsManager || !this.ipfsManager.getIsRunning()) {
      console.warn('[IPFSExport] IPFS not available, skipping export');
      return null;
    }

    try {
      const payload = JSON.stringify({
        type,
        workspaceId,
        exportedAt: new Date().toISOString(),
        metadata,
        content,
      }, null, 2);

      const cid = await this.ipfsManager.addContent(payload, `${type}-${workspaceId}-${Date.now()}.json`);

      const artifact: WorkspaceArtifact = {
        cid,
        type,
        workspaceId,
        timestamp: new Date().toISOString(),
        metadata,
      };

      if (!this.artifacts.has(workspaceId)) {
        this.artifacts.set(workspaceId, []);
      }
      this.artifacts.get(workspaceId)!.push(artifact);

      console.log(`[IPFSExport] Exported ${type} for workspace ${workspaceId}: ${cid}`);
      return artifact;
    } catch (err) {
      console.error(`[IPFSExport] Failed to export ${type}:`, err);
      return null;
    }
  }

  async getContent(cid: string): Promise<any | null> {
    if (!this.ipfsManager || !this.ipfsManager.getIsRunning()) {
      return null;
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const tmpPath = path.join(os.tmpdir(), `ipfs-export-${cid}`);
      await this.ipfsManager.get(cid, tmpPath);
      const content = fs.readFileSync(tmpPath, 'utf-8');
      fs.unlinkSync(tmpPath);
      return JSON.parse(content);
    } catch (err) {
      console.error(`[IPFSExport] Failed to retrieve ${cid}:`, err);
      return null;
    }
  }

  getArtifacts(workspaceId: string, type?: WorkspaceArtifact['type']): WorkspaceArtifact[] {
    const all = this.artifacts.get(workspaceId) || [];
    if (type) return all.filter(a => a.type === type);
    return all;
  }

  getArtifactsSince(
    workspaceId: string,
    since: Date,
    type?: WorkspaceArtifact['type']
  ): WorkspaceArtifact[] {
    const all = this.getArtifacts(workspaceId, type);
    return all.filter(a => new Date(a.timestamp) >= since);
  }

  getLatestArtifact(workspaceId: string, type: WorkspaceArtifact['type']): WorkspaceArtifact | null {
    const typed = this.getArtifacts(workspaceId, type);
    return typed.length > 0 ? typed[typed.length - 1] : null;
  }

  getAllWorkspaceIds(): string[] {
    return Array.from(this.artifacts.keys());
  }
}

export const ipfsExportService = new IPFSExportService();
