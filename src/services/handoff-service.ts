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

    const model = await this.selectModel();
    let content: string;

    if (model && this.ollamaManager) {
      try {
        const result = await this.ollamaManager.chat({
          model,
          messages: [
            { role: 'system', content: 'You are an AI project manager writing a handoff document. Be clear, structured, and comprehensive.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        });
        content = result.content;
      } catch (err) {
        console.warn('[Handoff] AI unavailable, generating raw handoff');
        content = this.rawHandoff(latestDigest, recentArtifacts, externalContext);
      }
    } else {
      content = this.rawHandoff(latestDigest, recentArtifacts, externalContext);
    }

    try {
      const artifact = await ipfsExportService.exportContent(workspaceId, 'handoff', {
        document: content,
        digestCid: latestDigest?.cid,
        artifactsConsidered: recentArtifacts.length,
      });

      const handoff: HandoffDoc = {
        workspaceId,
        content,
        generatedAt: new Date().toISOString(),
        cid: artifact?.cid || null,
      };

      this.handoffs.set(workspaceId, handoff);
      return handoff;
    } catch (err) {
      console.error('[Handoff] Export failed:', err);
      return null;
    }
  }

  getHandoffContent(workspaceId: string): string | null {
    return this.handoffs.get(workspaceId)?.content || null;
  }

  getHandoff(workspaceId: string): HandoffDoc | null {
    return this.handoffs.get(workspaceId) || null;
  }

  private rawHandoff(digest: any, artifacts: any[], ctx: any): string {
    const lines = ['# Project Handoff', '', `Generated: ${new Date().toISOString()}`, ''];
    if (digest) {
      lines.push('## Latest Digest', digest.summary || 'No summary', '');
      if (digest.decisions?.length) lines.push('## Decisions', ...digest.decisions.map((d: string) => `- ${d}`), '');
      if (digest.issues?.length) lines.push('## Issues', ...digest.issues.map((i: string) => `- ${i}`), '');
    }
    lines.push(`## Recent Activity`, `- ${artifacts.length} artifacts in the last 48h`, '');
    if (ctx.tasks?.length) lines.push('## Tasks', ...ctx.tasks.slice(0, 10).map((t: any) => `- [${t.status}] ${t.title}`), '');
    lines.push('', '*AI-enhanced handoff available with an Ollama model installed.*');
    return lines.join('\n');
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

export const handoffService = new HandoffService();
