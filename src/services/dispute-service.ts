/**
 * Dispute Service — AI-powered dispute analysis for milestone tasks
 */

import type { OllamaManager } from '../ollama-manager';
import { ipfsExportService } from './ipfs-export-service';

export interface DisputeAnalysis {
  taskId: string;
  milestoneIndex: number;
  recommendation: 'release' | 'partial' | 'deny';
  reasoning: string;
  evidence: string[];
  confidence: number;
  generatedAt: string;
  cid: string | null;
}

class DisputeService {
  private ollamaManager: OllamaManager | null = null;
  private analyses: Map<string, DisputeAnalysis> = new Map();

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  async analyzeDispute(
    taskId: string,
    milestoneIndex: number,
    workspaceId: string,
    context: {
      milestoneDescription: string;
      milestoneAmount: string;
      workCid: string;
      taskDescription: string;
      chatExcerpts?: string[];
      codeEvidence?: string[];
    }
  ): Promise<DisputeAnalysis | null> {
    if (!this.ollamaManager) return null;

    const running = await this.ollamaManager.checkRunning();
    if (!running) return null;

    // Gather relevant workspace artifacts
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
    const chatArtifacts = ipfsExportService.getArtifactsSince(workspaceId, since, 'chat');
    const transcriptArtifacts = ipfsExportService.getArtifactsSince(workspaceId, since, 'transcription');

    const prompt = `You are a neutral dispute arbitrator for a milestone-based task payment system.

TASK: ${context.taskDescription}
MILESTONE #${milestoneIndex + 1}: ${context.milestoneDescription}
AMOUNT: ${context.milestoneAmount}
WORK SUBMITTED (CID): ${context.workCid || 'none'}

${context.chatExcerpts?.length ? 'RELEVANT CHAT EXCERPTS:\n' + context.chatExcerpts.join('\n') : ''}
${context.codeEvidence?.length ? 'CODE EVIDENCE:\n' + context.codeEvidence.join('\n') : ''}

WORKSPACE ACTIVITY: ${chatArtifacts.length} chat exports and ${transcriptArtifacts.length} transcription exports in the last 7 days.

Analyze this dispute and provide a recommendation. Respond in JSON:
{
  "recommendation": "release" | "partial" | "deny",
  "reasoning": "Detailed explanation",
  "evidence": ["Evidence point 1", "Evidence point 2"],
  "confidence": 0.0 to 1.0
}

Be fair and consider both sides. This is advisory only — no on-chain action will be taken automatically.`;

    try {
      const result = await this.ollamaManager.chat({
        model: await this.selectModel(),
        messages: [
          { role: 'system', content: 'You are a neutral AI arbitrator. Respond only with valid JSON. Be fair and evidence-based.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      });

      let parsed: any;
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch?.[0] || result.content);
      } catch {
        parsed = {
          recommendation: 'partial',
          reasoning: result.content.slice(0, 1000),
          evidence: [],
          confidence: 0.3,
        };
      }

      const artifact = await ipfsExportService.exportContent(workspaceId, 'dispute-analysis', {
        taskId,
        milestoneIndex,
        analysis: parsed,
      });

      const analysis: DisputeAnalysis = {
        taskId,
        milestoneIndex,
        recommendation: parsed.recommendation || 'partial',
        reasoning: parsed.reasoning || '',
        evidence: parsed.evidence || [],
        confidence: parsed.confidence || 0.5,
        generatedAt: new Date().toISOString(),
        cid: artifact?.cid || null,
      };

      this.analyses.set(`${taskId}-${milestoneIndex}`, analysis);
      return analysis;
    } catch (err) {
      console.error('[Dispute] Analysis failed:', err);
      return null;
    }
  }

  getAnalysis(taskId: string, milestoneIndex: number): DisputeAnalysis | null {
    return this.analyses.get(`${taskId}-${milestoneIndex}`) || null;
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

export const disputeService = new DisputeService();
