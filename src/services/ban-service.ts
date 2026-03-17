/**
 * Ban Service — tiered enforcement (warning, temporary, permanent)
 */

export type BanType = 'warning' | 'temporary' | 'permanent';

export interface Ban {
  id: string;
  userId: string;
  workspaceId: string | null; // null = platform-wide
  type: BanType;
  reason: string;
  category: string | null;
  issuedAt: string;
  expiresAt: string | null; // null for permanent
  isActive: boolean;
}

class BanService {
  private bans: Ban[] = [];

  // Auto-escalation thresholds
  private readonly WARNINGS_TO_TEMP = 3;
  private readonly TEMPS_TO_PERM = 2;
  private readonly TEMP_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  issueBan(userId: string, workspaceId: string | null, type: BanType, reason: string, category: string | null = null): Ban {
    const ban: Ban = {
      id: `ban-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      workspaceId,
      type,
      reason,
      category,
      issuedAt: new Date().toISOString(),
      expiresAt: type === 'temporary' ? new Date(Date.now() + this.TEMP_DURATION_MS).toISOString() : null,
      isActive: true,
    };
    this.bans.push(ban);
    console.log(`[Ban] ${type.toUpperCase()} ban issued to ${userId}: ${reason}`);
    return ban;
  }

  /**
   * Auto-escalate based on violation history.
   * S2/S4 = instant permanent. Otherwise warning -> temp -> perm.
   */
  handleViolation(userId: string, workspaceId: string, category: string, reason: string): Ban {
    // S2 (child safety) and S4 (illegal) = instant permanent
    if (category === 'S2' || category === 'S4') {
      return this.issueBan(userId, null, 'permanent', reason, category);
    }

    const userBans = this.bans.filter(b => b.userId === userId && b.isActive);
    const warnings = userBans.filter(b => b.type === 'warning').length;
    const temps = userBans.filter(b => b.type === 'temporary').length;

    if (temps >= this.TEMPS_TO_PERM) {
      return this.issueBan(userId, null, 'permanent', reason, category);
    }
    if (warnings >= this.WARNINGS_TO_TEMP) {
      return this.issueBan(userId, workspaceId, 'temporary', reason, category);
    }
    return this.issueBan(userId, workspaceId, 'warning', reason, category);
  }

  /**
   * Check if user is banned. Auto-deactivates expired temp bans.
   */
  isBanned(userId: string, workspaceId?: string): { banned: boolean; ban: Ban | null } {
    for (const ban of this.bans) {
      if (ban.userId !== userId || !ban.isActive) continue;
      if (ban.type === 'warning') continue; // warnings don't block

      // Auto-deactivate expired temp bans
      if (ban.type === 'temporary' && ban.expiresAt && new Date(ban.expiresAt) < new Date()) {
        ban.isActive = false;
        continue;
      }

      // Platform-wide ban applies everywhere
      if (!ban.workspaceId) return { banned: true, ban };
      // Workspace-specific ban
      if (workspaceId && ban.workspaceId === workspaceId) return { banned: true, ban };
    }
    return { banned: false, ban: null };
  }

  revokeBan(banId: string): boolean {
    const ban = this.bans.find(b => b.id === banId);
    if (!ban) return false;
    ban.isActive = false;
    return true;
  }

  getUserBans(userId: string): Ban[] {
    return this.bans.filter(b => b.userId === userId);
  }

  getActiveBans(workspaceId?: string): Ban[] {
    return this.bans.filter(b => {
      if (!b.isActive) return false;
      if (b.type === 'warning') return false;
      if (b.type === 'temporary' && b.expiresAt && new Date(b.expiresAt) < new Date()) {
        b.isActive = false;
        return false;
      }
      if (workspaceId) return !b.workspaceId || b.workspaceId === workspaceId;
      return true;
    });
  }
}

export const banService = new BanService();
