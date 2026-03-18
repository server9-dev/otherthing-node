/**
 * Transcription Service — real audio transcription with speaker attribution
 *
 * Two backends:
 *   1. Groq Whisper API (premium) — fast, accurate, $0.02/hr audio
 *   2. Local whisper.cpp (free) — if binary is available
 *   3. Fallback: skip transcription gracefully
 *
 * Audio arrives as base64 webm chunks from MediaRecorder (per-speaker stream).
 * Each chunk is tagged with speaker name and peer ID.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PLATFORM } from '../platform-config';
import { ipfsExportService } from './ipfs-export-service';
import { premiumService } from './premium-service';

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
  private sessions: Map<string, TranscriptionSession> = new Map();
  private whisperPath: string | null = null;

  constructor() {
    this.detectWhisperCpp();
  }

  private detectWhisperCpp(): void {
    const candidates = [
      '/usr/local/bin/whisper-cpp',
      '/usr/bin/whisper-cpp',
      path.join(os.homedir(), '.local', 'bin', 'whisper-cpp'),
      'whisper-cpp',
    ];
    for (const p of candidates) {
      try {
        execSync(`${p} --help 2>/dev/null`, { stdio: 'pipe', timeout: 3000 });
        this.whisperPath = p;
        console.log(`[Transcription] whisper.cpp found at ${p}`);
        return;
      } catch {}
    }
    console.log('[Transcription] whisper.cpp not found — will use Groq API for premium users');
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
    peerId: string,
    wallet?: string
  ): Promise<TranscriptionSegment | null> {
    const session = this.getOrCreateSession(workspaceId);
    const startTime = new Date().toISOString();

    // Write audio to temp file
    const tmpDir = os.tmpdir();
    const audioPath = path.join(tmpDir, `ot-audio-${Date.now()}.webm`);
    const wavPath = audioPath.replace('.webm', '.wav');

    try {
      fs.writeFileSync(audioPath, Buffer.from(audioBase64, 'base64'));

      let text: string | null = null;

      // Try Groq Whisper API first (premium or platform-wide)
      text = await this.transcribeGroq(audioPath);

      // Fallback to local whisper.cpp
      if (!text && this.whisperPath) {
        text = this.transcribeLocal(audioPath, wavPath);
      }

      // Clean up temp files
      try { fs.unlinkSync(audioPath); } catch {}
      try { fs.unlinkSync(wavPath); } catch {}

      if (!text || !text.trim()) return null;

      const segment: TranscriptionSegment = {
        speaker,
        peerId,
        text: text.trim(),
        startTime,
        endTime: new Date().toISOString(),
      };

      session.segments.push(segment);
      return segment;
    } catch (err) {
      console.error('[Transcription] Chunk processing failed:', err);
      try { fs.unlinkSync(audioPath); } catch {}
      try { fs.unlinkSync(wavPath); } catch {}
      return null;
    }
  }

  /**
   * Transcribe via Groq Whisper API
   */
  private async transcribeGroq(audioPath: string): Promise<string | null> {
    const groqKey = (PLATFORM as any).groq?.apiKey;
    if (!groqKey) return null;

    try {
      const audioData = fs.readFileSync(audioPath);
      const blob = new Blob([audioData], { type: 'audio/webm' });

      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('response_format', 'text');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.warn('[Transcription] Groq API error:', res.status);
        return null;
      }

      const text = await res.text();
      return text || null;
    } catch (err) {
      console.warn('[Transcription] Groq API failed:', err);
      return null;
    }
  }

  /**
   * Transcribe via local whisper.cpp binary
   */
  private transcribeLocal(audioPath: string, wavPath: string): string | null {
    if (!this.whisperPath) return null;

    try {
      // Convert webm to wav (whisper.cpp needs wav)
      try {
        execSync(`ffmpeg -i ${audioPath} -ar 16000 -ac 1 -y ${wavPath} 2>/dev/null`, {
          timeout: 10000, stdio: 'pipe',
        });
      } catch {
        // ffmpeg not available — try opusdec or just skip
        console.warn('[Transcription] ffmpeg not available for audio conversion');
        return null;
      }

      const result = execSync(
        `${this.whisperPath} -f ${wavPath} --no-timestamps -l auto 2>/dev/null`,
        { timeout: 30000, encoding: 'utf-8' }
      );

      return result.trim() || null;
    } catch (err) {
      console.warn('[Transcription] Local whisper failed:', err);
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

    this.sessions.delete(workspaceId);
    return artifact?.cid || null;
  }
}

export const transcriptionService = new TranscriptionService();
