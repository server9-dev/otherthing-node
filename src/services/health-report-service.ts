/**
 * Health Report Service — 48h team health & project velocity reports
 */

import type { OllamaManager } from '../ollama-manager';
import { ipfsExportService } from './ipfs-export-service';
import { schedulerService } from './scheduler-service';

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

    // Calculate metrics
    const recentMessages = messages.filter(m => new Date(m.timestamp) >= since);
    const uniqueSpeakers = new Set(recentMessages.map(m => m.sender)).size;

    const taskMetrics = {
      created: tasks.filter(t => new Date(t.createdAt) >= since).length,
      completed: tasks.filter(t => t.status === 'done').length,
      inProgress: tasks.filter(t => t.status === 'in-progress').length,
      blocked: tasks.filter(t => t.status === 'blocked').length,
    };

    const prompt = `Analyze team health for the last 48 hours:

Participation:
- ${uniqueSpeakers} active speakers
- ${recentMessages.length} messages sent
- ${artifacts.length} artifacts exported

Task velocity:
- ${taskMetrics.created} tasks created
- ${taskMetrics.completed} completed
- ${taskMetrics.inProgress} in progress
- ${taskMetrics.blocked} blocked

Provide predictions about potential issues and recommendations. Respond in JSON:
{
  "predictions": ["Prediction 1"],
  "recommendations": ["Recommendation 1"]
}`;

    try {
      const result = await this.ollamaManager.chat({
        model: await this.selectModel(),
        messages: [
          { role: 'system', content: 'You are an AI team health analyst. Respond only with valid JSON.' },
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
