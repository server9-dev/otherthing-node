/**
 * Inference Relay — background worker that picks up inference requests
 * from workspace peers via the Supabase `signaling` table and runs them on
 * local Ollama.
 *
 * P2P compute sharing over the internet — no direct connection needed.
 *
 * Runs outside any HTTP request, so `db()` resolves to the node session.
 * Transport is a 2s poll for now. `handleSignal` is the single entry point per
 * request, so switching to a Supabase realtime subscription on `signaling`
 * (filter target_peer_id=in.(...)) only means replacing `pollOnce`.
 */

import os from 'os';
import type { OllamaManager } from '../ollama-manager';
import { supabaseService } from './supabase-service';
import { ipfsSyncService } from './ipfs-sync-service';

/** Stable per-machine fallback ID — used whenever no wallet address is available. */
const MACHINE_NODE_ID = process.env.OTHERTHING_NODE_ID || `node-${os.hostname()}`;

const POLL_INTERVAL_MS = 2000;
/**
 * Each poll looks back this far (server timestamps vs. local clock), with
 * already-handled request ids deduped, so modest clock skew can't drop requests.
 */
const LOOKBACK_MS = 60_000;

export const INFERENCE_REQUEST = 'inference-request';
export const INFERENCE_RESPONSE = 'inference-response';

class InferenceRelay {
  private ollamaManager: OllamaManager | null = null;
  private polling = false;
  private busy = false;
  private interval: NodeJS.Timeout | null = null;
  private processedRequests: Set<string> = new Set();
  private nodeIds: Set<string> = new Set([MACHINE_NODE_ID]); // all IDs this node is known by

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
    console.log('[InferenceRelay] Started — listening for peer inference requests');
    this.interval = setInterval(() => {
      if (this.busy) return; // previous poll still running
      this.busy = true;
      this.pollOnce().catch(() => {}).finally(() => { this.busy = false; });
    }, POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    if (!this.ollamaManager || !supabaseService.isInitialized()) return;
    const workspaceIds = ipfsSyncService.getSyncedWorkspaces();
    if (workspaceIds.length === 0) return;
    if (!(await this.ollamaManager.checkRunning())) return;

    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const ids = Array.from(this.nodeIds);

    for (const wsId of workspaceIds) {
      try {
        const signals = await supabaseService.pollSignals(wsId, ids, since, { types: [INFERENCE_REQUEST] });
        for (const signal of signals.documents) this.handleSignal(wsId, signal);
      } catch (err) {
        console.warn(`[InferenceRelay] Poll failed for ${wsId}:`, (err as Error).message);
      }
    }

    if (this.processedRequests.size > 1000) {
      this.processedRequests = new Set(Array.from(this.processedRequests).slice(-500));
    }
  }

  /** Entry point for one signal row (from polling now, realtime later). */
  handleSignal(workspaceId: string, signal: any): void {
    if (signal.type !== INFERENCE_REQUEST || this.processedRequests.has(signal.$id)) return;
    if (!this.nodeIds.has(signal.targetPeerId)) return;
    this.processedRequests.add(signal.$id);
    this.handleRequest(workspaceId, signal).catch(err =>
      console.error('[InferenceRelay] Failed:', err)
    );
  }

  private async handleRequest(workspaceId: string, signal: any): Promise<void> {
    if (!this.ollamaManager) return;

    let data: any;
    try {
      data = JSON.parse(signal.payload);
    } catch {
      return;
    }
    const { requestId, model, messages, temperature, max_tokens } = data;

    console.log(`[InferenceRelay] Running "${model}" for peer ${signal.fromPeerId} (${requestId})`);

    // Reply as the ID we were addressed by, to the requester's node ID
    const reply = (payload: Record<string, any>) => supabaseService.sendSignal({
      workspaceId,
      fromPeerId: signal.targetPeerId,
      targetPeerId: signal.fromPeerId,
      type: INFERENCE_RESPONSE,
      payload: JSON.stringify({ requestId, ...payload }),
    });

    try {
      const result = await this.ollamaManager.chat({ model, messages, temperature, max_tokens });
      await reply({ content: result.content, model: result.model, tokens_used: result.tokens_used });
      console.log(`[InferenceRelay] Done (${result.content.length} chars)`);
    } catch (err) {
      console.error(`[InferenceRelay] Inference failed:`, err);
      await reply({ content: 'Error: inference failed on peer node', error: true }).catch(() => {});
    }
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.polling = false;
  }
}

export const inferenceRelay = new InferenceRelay();
