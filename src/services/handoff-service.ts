/**
 * Handoff Service — generates living handoff documents from digest + workspace state
 */

import type { OllamaManager } from '../ollama-manager';
import { ipfsExportService } from './ipfs-export-service';
import { digestService } from './digest-service';

interface HandoffDoc {
  workspaceId: string;
  content: string;
  generatedAt: string;
  cid: string | null;
}

class HandoffService {
  private ollamaManager: OllamaManager | null = null;
  private handoffs: Map<string, HandoffDoc> = new Map();
  private contextGatherer: ((workspaceId: string) => Promise<any>) | null = null;

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  setContextGatherer(fn: (workspaceId: string) => Promise<any>): void {
    this.contextGatherer = fn;
  }

  async updateHandoff(workspaceId: string): Promise<HandoffDoc | null> {
    if (!this.ollamaManager) {
      console.warn('[Handoff] Ollama not available');
      return null;
    }

    const running = await this.ollamaManager.checkRunning();
    if (!running) return null;

    // Gather context
    const latestDigest = digestService.getLatest(workspaceId);
    const recentArtifacts = ipfsExportService.getArtifactsSince(
      workspaceId,
      new Date(Date.now() - 48 * 60 * 60 * 1000)
    );

    let externalContext: any = {};
    if (this.contextGatherer) {
      try {
        externalContext = await this.contextGatherer(workspaceId);
      } catch {}
    }

    const prompt = `Generate a comprehensive project handoff document for workspace "${workspaceId}".

This document should allow any new team member to understand the current state of the project.

Latest Digest: ${latestDigest ? JSON.stringify({
  summary: latestDigest.summary,
  decisions: latestDigest.decisions,
  issues: latestDigest.issues,
  suggestedTasks: latestDigest.suggestedTasks,
}) : 'No digest available yet.'}

Recent Activity:
- ${recentArtifacts.length} artifacts in the last 48h
- Types: ${[...new Set(recentArtifacts.map(a => a.type))].join(', ') || 'none'}

${externalContext.tasks ? `Active Tasks: ${JSON.stringify(externalContext.tasks.slice(0, 10))}` : ''}
${externalContext.repos ? `Repositories: ${JSON.stringify(externalContext.repos)}` : ''}

Write a structured handoff document with sections:
1. Project Status Overview
2. Recent Decisions & Changes
3. Active Issues & Blockers
4. Current Tasks & Priorities
5. Key Context for New Contributors`;

    try {
      const result = await this.ollamaManager.chat({
        model: await this.selectModel(),
        messages: [
          { role: 'system', content: 'You are an AI project manager writing a handoff document. Be clear, structured, and comprehensive.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });

      const artifact = await ipfsExportService.exportContent(workspaceId, 'handoff', {
        document: result.content,
        digestCid: latestDigest?.cid,
        artifactsConsidered: recentArtifacts.length,
      });

      const handoff: HandoffDoc = {
        workspaceId,
        content: result.content,
        generatedAt: new Date().toISOString(),
        cid: artifact?.cid || null,
      };

      this.handoffs.set(workspaceId, handoff);
      return handoff;
    } catch (err) {
      console.error('[Handoff] Generation failed:', err);
      return null;
    }
  }

  getHandoffContent(workspaceId: string): string | null {
    return this.handoffs.get(workspaceId)?.content || null;
  }

  getHandoff(workspaceId: string): HandoffDoc | null {
    return this.handoffs.get(workspaceId) || null;
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

export const handoffService = new HandoffService();
