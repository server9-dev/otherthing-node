/**
 * Health Report Service — 48h team health & project velocity reports
 * Includes per-individual metrics, warnings, and recommendations.
 */

import type { OllamaManager } from '../ollama-manager';
import { ipfsExportService } from './ipfs-export-service';
import { schedulerService } from './scheduler-service';

export interface IndividualMetrics {
  userId: string;
  displayName: string;
  messageCount: number;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksBlocked: number;
  lastActive: string | null;
  warnings: string[];
  recommendations: string[];
}

export interface HealthReport {
  workspaceId: string;
  participationMetrics: {
    activeSpeakers: number;
    messageCount: number;
    artifactCount: number;
  };
  taskVelocity: {
    created: number;
    completed: number;
    inProgress: number;
    blocked: number;
  };
  individuals: IndividualMetrics[];
  predictions: string[];
  recommendations: string[];
  generatedAt: string;
  cid: string | null;
}

class HealthReportService {
  private ollamaManager: OllamaManager | null = null;
  private reports: Map<string, HealthReport[]> = new Map();
  private taskStoreRef: Map<string, any[]> | null = null;
  private chatStoreRef: Map<string, any[]> | null = null;

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  setStoreRefs(tasks: Map<string, any[]>, chat: Map<string, any[]>): void {
    this.taskStoreRef = tasks;
    this.chatStoreRef = chat;
  }

  registerScheduledJob(): void {
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
    schedulerService.register('health-report-all-workspaces', FORTY_EIGHT_HOURS, async () => {
      const workspaceIds = ipfsExportService.getAllWorkspaceIds();
      for (const wsId of workspaceIds) {
        try {
          await this.generateReport(wsId);
        } catch (err) {
          console.error(`[Health] Report failed for workspace ${wsId}:`, err);
        }
      }
    });
  }

  async generateReport(workspaceId: string): Promise<HealthReport | null> {
    if (!this.ollamaManager) return null;

    const running = await this.ollamaManager.checkRunning();
    if (!running) return null;

    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const artifacts = ipfsExportService.getArtifactsSince(workspaceId, since);
    const tasks = this.taskStoreRef?.get(workspaceId) || [];
    const messages = this.chatStoreRef?.get(workspaceId) || [];

    // All messages (not filtered by time for individual metrics — we want the full picture)
    const recentMessages = messages;
    const uniqueSpeakers = new Set(recentMessages.map(m => m.sender)).size;

    const taskMetrics = {
      created: tasks.length,
      completed: tasks.filter(t => t.status === 'done').length,
      inProgress: tasks.filter(t => t.status === 'in-progress').length,
      blocked: tasks.filter(t => t.status === 'blocked').length,
    };

    // ── Per-individual metrics ──
    const userMap = new Map<string, { name: string; msgs: number; lastActive: string | null }>();
    for (const m of recentMessages) {
      const key = m.sender || m.senderName;
      const existing = userMap.get(key);
      if (existing) {
        existing.msgs++;
        if (!existing.lastActive || m.timestamp > existing.lastActive) existing.lastActive = m.timestamp;
        if (m.senderName && m.senderName !== 'local') existing.name = m.senderName;
      } else {
        userMap.set(key, { name: m.senderName || key, msgs: 1, lastActive: m.timestamp });
      }
    }

    // Build a name-to-address lookup from chat messages for task matching
    const nameToIds = new Map<string, Set<string>>();
    for (const m of recentMessages) {
      const name = m.senderName || m.sender;
      const sender = m.sender || m.senderName;
      if (!nameToIds.has(name)) nameToIds.set(name, new Set());
      nameToIds.get(name)!.add(sender);
      if (m.senderName) nameToIds.get(name)!.add(m.senderName);
    }

    const individuals: IndividualMetrics[] = [];
    for (const [userId, info] of userMap) {
      // Match tasks by assignee — check userId, displayName, and any associated addresses
      const matchIds = new Set<string>([userId, info.name]);
      const extraIds = nameToIds.get(info.name);
      if (extraIds) extraIds.forEach(id => matchIds.add(id));

      const assigned = tasks.filter(t => t.assignee && matchIds.has(t.assignee));
      const completed = assigned.filter(t => t.status === 'done').length;
      const blocked = assigned.filter(t => t.status === 'blocked').length;
      const inProgress = assigned.filter(t => t.status === 'in-progress').length;

      const warnings: string[] = [];
      const recs: string[] = [];

      // Generate individual warnings/recommendations
      if (info.msgs < 3 && recentMessages.length > 10) {
        warnings.push('Low participation — fewer than 3 messages in this period');
        recs.push('Check in with this team member to ensure they are not blocked or disengaged');
      }
      if (blocked > 0) {
        warnings.push(`${blocked} blocked task${blocked > 1 ? 's' : ''} assigned to this member`);
        recs.push('Review blocked tasks and help unblock — may need a different approach or resource');
      }
      if (assigned.length > 0 && completed === 0 && inProgress > 0) {
        recs.push('Has in-progress tasks but no completions — check if scope is too large or needs splitting');
      }
      if (assigned.length === 0) {
        recs.push('No tasks assigned — consider assigning work to increase engagement');
      }
      if (info.msgs > recentMessages.length * 0.4) {
        warnings.push('Dominating conversation (>40% of all messages) — may be blocking others from speaking up');
      }
      if (completed >= 2) {
        recs.push('Strong performer this sprint — consider assigning stretch goals or mentoring responsibilities');
      }

      individuals.push({
        userId,
        displayName: info.name,
        messageCount: info.msgs,
        tasksAssigned: assigned.length,
        tasksCompleted: completed,
        tasksBlocked: blocked,
        lastActive: info.lastActive,
        warnings,
        recommendations: recs,
      });
    }

    // Sort by message count descending
    individuals.sort((a, b) => b.messageCount - a.messageCount);

    // ── Build AI prompt with individual context ──
    const individualSummary = individuals.map(ind =>
      `${ind.displayName}: ${ind.messageCount} msgs, ${ind.tasksAssigned} tasks (${ind.tasksCompleted} done, ${ind.tasksBlocked} blocked)${ind.warnings.length > 0 ? ' [WARNINGS: ' + ind.warnings.join('; ') + ']' : ''}`
    ).join('\n');

    const prompt = `Analyze team health for a developer workspace:

TEAM METRICS:
- ${uniqueSpeakers} active speakers, ${recentMessages.length} total messages
- ${artifacts.length} artifacts exported to IPFS
- Tasks: ${taskMetrics.created} total, ${taskMetrics.completed} completed, ${taskMetrics.inProgress} in progress, ${taskMetrics.blocked} blocked

INDIVIDUAL BREAKDOWN:
${individualSummary}

Provide team-level predictions and recommendations. Consider workload balance, blocked items, participation gaps, and collaboration patterns.

Respond in JSON:
{
  "predictions": ["Prediction about team trajectory"],
  "recommendations": ["Actionable team-level recommendation"]
}`;

    try {
      const result = await this.ollamaManager.chat({
        model: await this.selectModel(),
        messages: [
          { role: 'system', content: 'You are an AI team health analyst for a developer workspace. Respond only with valid JSON. Be specific and actionable.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });

      let parsed: any;
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] || result.content);
      } catch {
        parsed = { predictions: [], recommendations: [] };
      }

      const report: HealthReport = {
        workspaceId,
        participationMetrics: {
          activeSpeakers: uniqueSpeakers,
          messageCount: recentMessages.length,
          artifactCount: artifacts.length,
        },
        taskVelocity: taskMetrics,
        individuals,
        predictions: parsed.predictions || [],
        recommendations: parsed.recommendations || [],
        generatedAt: new Date().toISOString(),
        cid: null,
      };

      const artifact = await ipfsExportService.exportContent(workspaceId, 'health-report', report);
      report.cid = artifact?.cid || null;

      if (!this.reports.has(workspaceId)) {
        this.reports.set(workspaceId, []);
      }
      this.reports.get(workspaceId)!.push(report);

      return report;
    } catch (err) {
      console.error('[Health] Report generation failed:', err);
      return null;
    }
  }

  getLatest(workspaceId: string): HealthReport | null {
    const all = this.reports.get(workspaceId);
    return all && all.length > 0 ? all[all.length - 1] : null;
  }

  getHistory(workspaceId: string): HealthReport[] {
    return this.reports.get(workspaceId) || [];
  }

  private async selectModel(): Promise<string> {
    if (!this.ollamaManager) return 'llama3.2';
    try {
      const status = await this.ollamaManager.getStatus();
      const models = status.models || [];
      const preferred = models.find((m: any) =>
        m.name.includes('qwen') || m.name.includes('llama') || m.name.includes('gemma')
      );
      return preferred?.name || models[0]?.name || 'llama3.2';
    } catch {
      return 'llama3.2';
    }
  }
}

export const healthReportService = new HealthReportService();
