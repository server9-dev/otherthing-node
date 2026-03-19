/**
 * Inference Relay — background worker that picks up inference requests
 * from workspace peers via Appwrite and runs them on local Ollama.
 *
 * This enables P2P compute sharing over the internet without direct
 * network access between nodes.
 */

import type { OllamaManager } from '../ollama-manager';
import { appwriteService } from './appwrite-service';

class InferenceRelay {
  private ollamaManager: OllamaManager | null = null;
  private polling = false;
  private interval: NodeJS.Timeout | null = null;
  private lastPoll: string = new Date().toISOString();
  private processedRequests: Set<string> = new Set();

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  /**
   * Start polling for inference requests addressed to this node.
   * Called with the local userId so we know which signals are for us.
   */
  start(userId: string): void {
    if (this.polling) return;
    this.polling = true;
    this.lastPoll = new Date().toISOString();

    console.log('[InferenceRelay] Started — listening for peer inference requests');

    this.interval = setInterval(async () => {
      if (!this.ollamaManager || !appwriteService.isInitialized()) return;

      try {
        const running = await this.ollamaManager.checkRunning();
        if (!running) return;

        // Check all workspaces we know about for inference requests
        // Use a broad poll — check signals addressed to our userId
        // We need to know which workspaces to poll. Use the sync service cache.
        const { ipfsSyncService } = require('./ipfs-sync-service');

        // For each synced workspace, poll for inference requests
        // This is a simple approach — in production you'd use a single subscription
        const workspaceIds = Array.from(
          (ipfsSyncService as any).synced || new Set()
        ) as string[];

        for (const wsId of workspaceIds) {
          try {
            const signals = await appwriteService.pollSignals(wsId, userId, this.lastPoll);
            const requests = signals.documents.filter((s: any) =>
              s.type === 'inference-request' && !this.processedRequests.has(s.$id)
            );

            for (const req of requests) {
              this.processedRequests.add(req.$id);
              this.handleRequest(wsId, req).catch(err =>
                console.error('[InferenceRelay] Request handling failed:', err)
              );
            }
          } catch {}
        }

        this.lastPoll = new Date().toISOString();

        // Cleanup old processed IDs (prevent memory leak)
        if (this.processedRequests.size > 1000) {
          const arr = Array.from(this.processedRequests);
          this.processedRequests = new Set(arr.slice(-500));
        }
      } catch (err) {
        // Silent — don't spam logs
      }
    }, 2000); // Poll every 2 seconds
  }

  private async handleRequest(workspaceId: string, signal: any): Promise<void> {
    if (!this.ollamaManager) return;

    const data = JSON.parse(signal.payload);
    const { requestId, model, messages, temperature, max_tokens } = data;

    console.log(`[InferenceRelay] Processing inference request ${requestId} for model ${model}`);

    try {
      const result = await this.ollamaManager.chat({
        model,
        messages,
        temperature,
        max_tokens,
      });

      // Send response back through Appwrite
      await appwriteService.sendSignal({
        workspaceId,
        fromPeerId: 'relay',
        targetPeerId: signal.fromPeerId,
        type: 'inference-response',
        payload: JSON.stringify({
          requestId,
          content: result.content,
          model: result.model,
          tokens_used: result.tokens_used,
        }),
      });

      console.log(`[InferenceRelay] Completed inference request ${requestId} (${result.content.length} chars)`);
    } catch (err) {
      console.error(`[InferenceRelay] Inference failed for ${requestId}:`, err);

      // Send error response
      await appwriteService.sendSignal({
        workspaceId,
        fromPeerId: 'relay',
        targetPeerId: signal.fromPeerId,
        type: 'inference-response',
        payload: JSON.stringify({
          requestId,
          content: `Error: inference failed on peer node`,
          error: true,
        }),
      }).catch(() => {});
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.polling = false;
    console.log('[InferenceRelay] Stopped');
  }
}

export const inferenceRelay = new InferenceRelay();
