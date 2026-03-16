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
    if (!this.ollamaManager) {
      console.warn('[Digest] Ollama not available');
      return null;
    }

    const running = await this.ollamaManager.checkRunning();
    if (!running) return null;

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

    const prompt = `You are an AI project manager analyzing workspace activity. Generate a structured digest.

Recent workspace activity (last 12h):
- ${chatArtifacts.length} chat exports
- ${transcriptArtifacts.length} transcription exports
- ${whiteboardArtifacts.length} whiteboard exports

${artifactContents.length > 0 ? 'Activity content:\n' + artifactContents.join('\n\n') : 'No detailed content available.'}

Respond in JSON format:
{
  "summary": "Brief 2-3 sentence summary of activity",
  "decisions": ["Decision 1", "Decision 2"],
  "issues": ["Issue or blocker 1"],
  "suggestedTasks": [{"title": "Task", "description": "Details", "priority": "high|medium|low"}]
}`;

    try {
      const result = await this.ollamaManager.chat({
        model: await this.selectModel(),
        messages: [
          { role: 'system', content: 'You are an AI project manager. Respond only with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });

      let parsed: any;
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] || result.content);
      } catch {
        parsed = {
          summary: result.content.slice(0, 500),
          decisions: [],
          issues: [],
          suggestedTasks: [],
        };
      }

      // Export digest to IPFS
      const artifact = await ipfsExportService.exportContent(workspaceId, 'digest', parsed, {
        artifactsAnalyzed: chatArtifacts.length + transcriptArtifacts.length + whiteboardArtifacts.length,
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
    } catch (err) {
      console.error('[Digest] Generation failed:', err);
      return null;
    }
  }

  getLatest(workspaceId: string): DigestResult | null {
    const all = this.digests.get(workspaceId);
    return all && all.length > 0 ? all[all.length - 1] : null;
  }

  getHistory(workspaceId: string): DigestResult[] {
    return this.digests.get(workspaceId) || [];
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

export const digestService = new DigestService();
