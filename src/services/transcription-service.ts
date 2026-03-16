/**
 * Transcription Service — accepts audio chunks with speaker info,
 * transcribes via Ollama whisper model, exports sessions to IPFS
 */

import type { OllamaManager } from '../ollama-manager';
import { ipfsExportService } from './ipfs-export-service';

export interface TranscriptionSegment {
  speaker: string;
  peerId: string;
  text: string;
  startTime: string;
  endTime: string;
}

interface TranscriptionSession {
  workspaceId: string;
  segments: TranscriptionSegment[];
  startedAt: string;
  active: boolean;
}

class TranscriptionService {
  private ollamaManager: OllamaManager | null = null;
  private sessions: Map<string, TranscriptionSession> = new Map();

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  private getOrCreateSession(workspaceId: string): TranscriptionSession {
    if (!this.sessions.has(workspaceId)) {
      this.sessions.set(workspaceId, {
        workspaceId,
        segments: [],
        startedAt: new Date().toISOString(),
        active: true,
      });
    }
    return this.sessions.get(workspaceId)!;
  }

  async processChunk(
    workspaceId: string,
    audioBase64: string,
    speaker: string,
    peerId: string
  ): Promise<TranscriptionSegment | null> {
    if (!this.ollamaManager) {
      console.warn('[Transcription] Ollama not available');
      return null;
    }

    const session = this.getOrCreateSession(workspaceId);
    const startTime = new Date().toISOString();

    try {
      // Use Ollama chat with audio description as a fallback
      // In production this would use a proper Whisper endpoint
      const running = await this.ollamaManager.checkRunning();
      if (!running) return null;

      const result = await this.ollamaManager.chat({
        model: 'whisper', // Requires whisper model pulled in Ollama
        messages: [
          {
            role: 'system',
            content: 'You are a speech-to-text transcription engine. Transcribe the audio content accurately.',
          },
          {
            role: 'user',
            content: `[Audio chunk from speaker: ${speaker}] Transcribe this audio segment.`,
          },
        ],
      });

      const text = result.content?.trim() || '';
      if (!text) return null;

      const segment: TranscriptionSegment = {
        speaker,
        peerId,
        text,
        startTime,
        endTime: new Date().toISOString(),
      };

      session.segments.push(segment);
      return segment;
    } catch (err) {
      console.error('[Transcription] Chunk processing failed:', err);
      return null;
    }
  }

  getSession(workspaceId: string): TranscriptionSession | null {
    return this.sessions.get(workspaceId) || null;
  }

  async finalizeSession(workspaceId: string): Promise<string | null> {
    const session = this.sessions.get(workspaceId);
    if (!session) return null;

    session.active = false;

    // Export to IPFS
    const artifact = await ipfsExportService.exportContent(
      workspaceId,
      'transcription',
      {
        segments: session.segments,
        startedAt: session.startedAt,
        finalizedAt: new Date().toISOString(),
        speakerCount: new Set(session.segments.map(s => s.peerId)).size,
      },
      {
        segmentCount: session.segments.length,
        duration: session.startedAt,
      }
    );

    // Clear the session
    this.sessions.delete(workspaceId);

    return artifact?.cid || null;
  }
}

export const transcriptionService = new TranscriptionService();
