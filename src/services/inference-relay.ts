/**
 * Inference Relay — background worker that picks up inference requests
 * from workspace peers via Appwrite and runs them on local Ollama.
 *
 * P2P compute sharing over the internet — no direct connection needed.
 */

import os from 'os';
import type { OllamaManager } from '../ollama-manager';
import { appwriteService } from './appwrite-service';

/** Stable per-machine fallback ID — used whenever no wallet address is available. */
const MACHINE_NODE_ID = `node-${os.hostname()}`;

class InferenceRelay {
  private ollamaManager: OllamaManager | null = null;
  private polling = false;
  private interval: NodeJS.Timeout | null = null;
  private lastPoll: string = new Date().toISOString();
  private processedRequests: Set<string> = new Set();
  private nodeIds: Set<string> = new Set(); // all IDs this node is known by

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  /** The ID peers can always reach this machine by, with or without a wallet. */
  get machineNodeId(): string {
    return MACHINE_NODE_ID;
  }

  /** Register an ID that this node should respond to */
  registerNodeId(id: string): void {
    this.nodeIds.add(id);
  }

  start(): void {
    if (this.polling) return;
    this.polling = true;
    this.lastPoll = new Date().toISOString();

    // Always respond to these
    this.nodeIds.add('local-user');
    this.nodeIds.add(MACHINE_NODE_ID);

    console.log('[InferenceRelay] Started — listening for peer inference requests');

    this.interval = setInterval(async () => {
      if (!this.ollamaManager || !appwriteService.isInitialized()) return;

      try {
        const running = await this.ollamaManager.checkRunning();
        if (!running) return;

        const { ipfsSyncService } = require('./ipfs-sync-service');
        const workspaceIds = Array.from(
          (ipfsSyncService as any).synced || new Set()
        ) as string[];

        for (const wsId of workspaceIds) {
          // Poll for requests addressed to any of our known IDs
          for (const nodeId of this.nodeIds) {
            try {
              const signals = await appwriteService.pollSignals(wsId, nodeId, this.lastPoll);
              const requests = signals.documents.filter((s: any) =>
                s.type === 'inference-request' && !this.processedRequests.has(s.$id)
              );

              for (const req of requests) {
                this.processedRequests.add(req.$id);
                this.handleRequest(wsId, req).catch(err =>
                  console.error('[InferenceRelay] Failed:', err)
                );
              }
            } catch {}
          }
        }

        this.lastPoll = new Date().toISOString();

        if (this.processedRequests.size > 1000) {
          const arr = Array.from(this.processedRequests);
          this.processedRequests = new Set(arr.slice(-500));
        }
      } catch {}
    }, 2000);
  }

  private async handleRequest(workspaceId: string, signal: any): Promise<void> {
    if (!this.ollamaManager) return;

    const data = JSON.parse(signal.payload);
    const { requestId, model, messages, temperature, max_tokens } = data;

    console.log(`[InferenceRelay] Running "${model}" for peer ${signal.fromPeerId} (${requestId})`);

    try {
      const result = await this.ollamaManager.chat({ model, messages, temperature, max_tokens });

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

      console.log(`[InferenceRelay] Done (${result.content.length} chars)`);
    } catch (err) {
      console.error(`[InferenceRelay] Inference failed:`, err);
      await appwriteService.sendSignal({
        workspaceId,
        fromPeerId: 'relay',
        targetPeerId: signal.fromPeerId,
        type: 'inference-response',
        payload: JSON.stringify({ requestId, content: 'Error: inference failed on peer node', error: true }),
      }).catch(() => {});
    }
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.polling = false;
  }
}

export const inferenceRelay = new InferenceRelay();
