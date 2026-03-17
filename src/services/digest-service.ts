/**
 * Digest Service — twice-daily AI digest of workspace activity
 */

import type { OllamaManager } from '../ollama-manager';
import { ipfsExportService } from './ipfs-export-service';
import { schedulerService } from './scheduler-service';

export interface DigestResult {
  workspaceId: string;
  summary: string;
  decisions: string[];
  issues: string[];
  suggestedTasks: Array<{ title: string; description: string; priority: string }>;
  generatedAt: string;
  cid: string | null;
}

class DigestService {
  private ollamaManager: OllamaManager | null = null;
  private digests: Map<string, DigestResult[]> = new Map();
  private taskCreator: ((workspaceId: string, task: any) => void) | null = null;

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  setTaskCreator(fn: (workspaceId: string, task: any) => void): void {
    this.taskCreator = fn;
  }

  registerScheduledJob(): void {
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    schedulerService.register('digest-all-workspaces', TWELVE_HOURS, async () => {
      const workspaceIds = ipfsExportService.getAllWorkspaceIds();
      for (const wsId of workspaceIds) {
        try {
          await this.generateDigest(wsId);
        } catch (err) {
          console.error(`[Digest] Failed for workspace ${wsId}:`, err);
        }
      }
    });
  }

  async generateDigest(workspaceId: string): Promise<DigestResult | null> {
    // Gather artifacts from the last 12 hours
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const chatArtifacts = ipfsExportService.getArtifactsSince(workspaceId, since, 'chat');
    const transcriptArtifacts = ipfsExportService.getArtifactsSince(workspaceId, since, 'transcription');
    const whiteboardArtifacts = ipfsExportService.getArtifactsSince(workspaceId, since, 'whiteboard');

    // Fetch content from IPFS for recent artifacts
    const artifactContents: string[] = [];

    for (const a of [...chatArtifacts, ...transcriptArtifacts].slice(-5)) {
      const content = await ipfsExportService.getContent(a.cid);
      if (content) {
        artifactContents.push(`[${a.type} export at ${a.timestamp}]:\n${JSON.stringify(content.content).slice(0, 2000)}`);
      }
    }

    // Try AI, fall back to raw metrics if no model available
    const model = await this.selectModel();
    let parsed: any = null;

    if (model && this.ollamaManager) {
      try {
        const result = await this.ollamaManager.chat({
          model,
          messages: [
            { role: 'system', content: 'You are an AI project manager. Respond only with valid JSON.' },
            { role: 'user', content: `Analyze workspace activity (last 12h): ${chatArtifacts.length} chat exports, ${transcriptArtifacts.length} transcriptions, ${whiteboardArtifacts.length} whiteboard exports.\n${artifactContents.length > 0 ? 'Content:\n' + artifactContents.join('\n\n') : ''}\nRespond as JSON: { "summary": "...", "decisions": [], "issues": [], "suggestedTasks": [{"title":"","description":"","priority":"medium"}] }` },
          ],
          temperature: 0.3,
        });
        try {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          parsed = JSON.parse(jsonMatch?.[0] || result.content);
        } catch {
          parsed = { summary: result.content.slice(0, 500), decisions: [], issues: [], suggestedTasks: [] };
        }
      } catch (err) {
        console.warn('[Digest] AI call failed, using raw metrics:', (err as Error).message);
      }
    }

    if (!parsed) {
      parsed = {
        summary: `Activity (last 12h): ${chatArtifacts.length} chat exports, ${transcriptArtifacts.length} transcriptions, ${whiteboardArtifacts.length} whiteboard exports.${!model ? ' Pull an Ollama model for AI-powered analysis.' : ''}`,
        decisions: [], issues: [], suggestedTasks: [],
      };
    }

    // Export digest to IPFS
    const artifact = await ipfsExportService.exportContent(workspaceId, 'digest', parsed, {
      artifactsAnalyzed: chatArtifacts.length + transcriptArtifacts.length + whiteboardArtifacts.length,
      aiEnhanced: !!model,
    });

    const digest: DigestResult = {
      workspaceId,
      summary: parsed.summary || '',
      decisions: parsed.decisions || [],
      issues: parsed.issues || [],
      suggestedTasks: parsed.suggestedTasks || [],
      generatedAt: new Date().toISOString(),
      cid: artifact?.cid || null,
    };

    if (!this.digests.has(workspaceId)) {
      this.digests.set(workspaceId, []);
    }
    this.digests.get(workspaceId)!.push(digest);

    // Auto-create suggested tasks
    if (this.taskCreator && digest.suggestedTasks.length > 0) {
      for (const task of digest.suggestedTasks) {
        this.taskCreator(workspaceId, {
          title: task.title,
          description: task.description,
          priority: task.priority || 'medium',
          status: 'todo',
        });
      }
    }

    return digest;
  }

  getLatest(workspaceId: string): DigestResult | null {
    const all = this.digests.get(workspaceId);
    return all && all.length > 0 ? all[all.length - 1] : null;
  }

  getHistory(workspaceId: string): DigestResult[] {
    return this.digests.get(workspaceId) || [];
  }

  private async selectModel(): Promise<string | null> {
    if (!this.ollamaManager) return null;
    try {
      const running = await this.ollamaManager.checkRunning();
      if (!running) return null;
      const status = await this.ollamaManager.getStatus();
      const models = status.models || [];
      if (models.length === 0) return null;
      return models[0].name;
    } catch {
      return null;
    }
  }
}

export const digestService = new DigestService();
