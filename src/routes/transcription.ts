/**
 * Transcription Routes — audio chunk submission, session management
 * Segments are shared via Appwrite so all call participants see live transcription.
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { transcriptionService } from '../services/transcription-service';
import { appwriteService } from '../services/appwrite-service';

export function registerTranscriptionRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Submit audio chunk with speaker info
  app.post('/api/v1/workspaces/:id/transcription/chunk', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { audio, speaker, peerId } = req.body;

    if (!audio || !speaker || !peerId) {
      res.status(400).json({ error: 'audio, speaker, and peerId are required' });
      return;
    }

    const segment = await transcriptionService.processChunk(workspaceId, audio, speaker, peerId);

    if (segment) {
      // Share segment via Appwrite so all callers see it live
      if (appwriteService.isInitialized()) {
        appwriteService.createChatMessage({
          workspaceId,
          sender: peerId,
          senderName: speaker,
          content: `[Transcription] ${speaker}: ${segment.text}`,
        }).catch(() => {});
      }

      res.status(201).json({ segment });
    } else {
      res.status(503).json({ error: 'Transcription unavailable or empty result' });
    }
  });

  // Get current transcription session (local + poll from Appwrite for peer segments)
  app.get('/api/v1/workspaces/:id/transcription/session', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = transcriptionService.getSession(workspaceId);

    // Also fetch recent transcription messages from Appwrite (from other callers)
    let peerSegments: any[] = [];
    if (appwriteService.isInitialized()) {
      try {
        const result = await appwriteService.listChatMessages(workspaceId, 50);
        peerSegments = result.documents
          .filter((d: any) => d.content?.startsWith('[Transcription]'))
          .map((d: any) => {
            const match = d.content.match(/\[Transcription\] (.+?): (.+)/);
            return match ? {
              speaker: match[1],
              peerId: d.sender,
              text: match[2],
              startTime: d.timestamp,
              endTime: d.timestamp,
            } : null;
          })
          .filter(Boolean)
          .reverse();
      } catch {}
    }

    const localSegments = session?.segments || [];
    // Merge and deduplicate by text + speaker
    const seen = new Set(localSegments.map(s => `${s.speaker}:${s.text}`));
    const merged = [...localSegments];
    for (const ps of peerSegments) {
      const key = `${ps.speaker}:${ps.text}`;
      if (!seen.has(key)) {
        merged.push(ps);
        seen.add(key);
      }
    }

    res.json({
      workspaceId,
      segments: merged,
      startedAt: session?.startedAt || null,
      active: session?.active || false,
      segmentCount: merged.length,
    });
  });

  // Finalize session and export to IPFS
  app.post('/api/v1/workspaces/:id/transcription/finalize', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const cid = await transcriptionService.finalizeSession(workspaceId);

    if (cid) {
      res.json({ success: true, cid });
    } else {
      res.json({ success: false, message: 'No active session or IPFS unavailable' });
    }
  });
}
