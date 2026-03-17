/**
 * Audit Service — logs all content moderation decisions
 */

import type { ViolationCategory, ScanResult } from './safety-service';
import { ipfsExportService } from './ipfs-export-service';

export interface AuditEntry {
  id: string;
  timestamp: string;
  workspaceId: string;
  contentType: 'chat' | 'file' | 'whiteboard' | 'transcription';
  contentId: string;
  userId: string;
  action: 'allowed' | 'blocked' | 'removed';
  category: ViolationCategory | null;
  reason: string;
  method: string;
}

export interface UserSafetyScore {
  userId: string;
  totalScanned: number;
  violations: number;
  warnings: number;
  lastViolation: string | null;
  categories: Record<string, number>;
}

class AuditService {
  private auditLog: AuditEntry[] = [];
  private safetyScores: Map<string, UserSafetyScore> = new Map();

  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLog.push(full);

    // Update safety score
    this.updateScore(entry.userId, entry.action, entry.category);

    // Keep last 10000 entries in memory
    if (this.auditLog.length > 10000) {
      this.auditLog.splice(0, this.auditLog.length - 10000);
    }

    if (entry.action === 'blocked' || entry.action === 'removed') {
      console.log(`[Audit] ${entry.action.toUpperCase()} ${entry.contentType} from ${entry.userId} in ${entry.workspaceId}: [${entry.category}] ${entry.reason}`);
    }

    return full;
  }

  private updateScore(userId: string, action: string, category: ViolationCategory | null): void {
    if (!this.safetyScores.has(userId)) {
      this.safetyScores.set(userId, {
        userId,
        totalScanned: 0,
        violations: 0,
        warnings: 0,
        lastViolation: null,
        categories: {},
      });
    }
    const score = this.safetyScores.get(userId)!;
    score.totalScanned++;

    if (action === 'blocked' || action === 'removed') {
      score.violations++;
      score.lastViolation = new Date().toISOString();
      if (category) {
        score.categories[category] = (score.categories[category] || 0) + 1;
      }
    }
  }

  getLog(workspaceId?: string, limit = 100): AuditEntry[] {
    let entries = this.auditLog;
    if (workspaceId) {
      entries = entries.filter(e => e.workspaceId === workspaceId);
    }
    return entries.slice(-limit);
  }

  getViolations(workspaceId?: string, limit = 50): AuditEntry[] {
    return this.getLog(workspaceId, 10000)
      .filter(e => e.action === 'blocked' || e.action === 'removed')
      .slice(-limit);
  }

  getUserScore(userId: string): UserSafetyScore | null {
    return this.safetyScores.get(userId) || null;
  }

  getStats(): { total: number; blocked: number; removed: number; allowed: number } {
    const total = this.auditLog.length;
    const blocked = this.auditLog.filter(e => e.action === 'blocked').length;
    const removed = this.auditLog.filter(e => e.action === 'removed').length;
    return { total, blocked, removed, allowed: total - blocked - removed };
  }

  async exportToIPFS(workspaceId: string): Promise<string | null> {
    const entries = this.getLog(workspaceId, 10000);
    const artifact = await ipfsExportService.exportContent(workspaceId, 'dispute-analysis', {
      type: 'audit-export',
      entries,
      stats: this.getStats(),
      exportedAt: new Date().toISOString(),
    });
    return artifact?.cid || null;
  }
}

export const auditService = new AuditService();
