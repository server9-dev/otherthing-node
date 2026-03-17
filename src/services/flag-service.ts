/**
 * Flag Service — user reporting and escalation queue
 */

export interface Flag {
  id: string;
  workspaceId: string;
  reporterId: string;
  contentType: 'chat' | 'file' | 'whiteboard' | 'task';
  contentId: string;
  category: 'harassment' | 'illegal' | 'child-safety' | 'spam' | 'sexual' | 'other';
  description: string;
  status: 'pending' | 'reviewed' | 'actioned' | 'dismissed';
  createdAt: string;
  reviewedAt: string | null;
  actionTaken: string | null;
}

class FlagService {
  private flags: Flag[] = [];

  create(flag: Omit<Flag, 'id' | 'status' | 'createdAt' | 'reviewedAt' | 'actionTaken'>): Flag {
    const full: Flag = {
      ...flag,
      id: `flag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      actionTaken: null,
    };
    this.flags.push(full);

    // Auto-escalate child-safety and illegal flags
    if (flag.category === 'child-safety' || flag.category === 'illegal') {
      console.log(`[Flag] AUTO-ESCALATED: ${flag.category} flag on ${flag.contentType} ${flag.contentId}`);
    }

    return full;
  }

  review(flagId: string, action: 'actioned' | 'dismissed', actionTaken?: string): Flag | null {
    const flag = this.flags.find(f => f.id === flagId);
    if (!flag) return null;
    flag.status = action;
    flag.reviewedAt = new Date().toISOString();
    flag.actionTaken = actionTaken || null;
    return flag;
  }

  getPending(workspaceId?: string): Flag[] {
    return this.flags.filter(f => {
      if (f.status !== 'pending') return false;
      if (workspaceId) return f.workspaceId === workspaceId;
      return true;
    });
  }

  getAll(workspaceId?: string): Flag[] {
    if (workspaceId) return this.flags.filter(f => f.workspaceId === workspaceId);
    return this.flags;
  }

  getStats(workspaceId?: string): { total: number; pending: number; actioned: number; dismissed: number } {
    const flags = workspaceId ? this.flags.filter(f => f.workspaceId === workspaceId) : this.flags;
    return {
      total: flags.length,
      pending: flags.filter(f => f.status === 'pending').length,
      actioned: flags.filter(f => f.status === 'actioned').length,
      dismissed: flags.filter(f => f.status === 'dismissed').length,
    };
  }
}

export const flagService = new FlagService();
