/**
 * Transcription Routes — audio chunk submission, session management
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { transcriptionService } from '../services/transcription-service';

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
      res.status(201).json({ segment });
    } else {
      res.status(503).json({ error: 'Transcription unavailable or empty result' });
    }
  });

  // Get current transcription session
  app.get('/api/v1/workspaces/:id/transcription/session', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = transcriptionService.getSession(workspaceId);

    if (session) {
      res.json({
        workspaceId: session.workspaceId,
        segments: session.segments,
        startedAt: session.startedAt,
        active: session.active,
        segmentCount: session.segments.length,
      });
    } else {
      res.json({ workspaceId, segments: [], active: false, segmentCount: 0 });
    }
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
