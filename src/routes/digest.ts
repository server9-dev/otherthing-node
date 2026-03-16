/**
 * Digest & Handoff Routes
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { digestService } from '../services/digest-service';
import { handoffService } from '../services/handoff-service';

export function registerDigestRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Generate digest on demand
  app.post('/api/v1/workspaces/:id/digest/generate', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const digest = await digestService.generateDigest(workspaceId);

    if (digest) {
      // Auto-update handoff after digest
      handoffService.updateHandoff(workspaceId).catch(() => {});
      res.json({ digest });
    } else {
      res.status(503).json({ error: 'Digest generation failed — Ollama may not be running' });
    }
  });

  // Get latest digest
  app.get('/api/v1/workspaces/:id/digest/latest', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const digest = digestService.getLatest(workspaceId);

    if (digest) {
      res.json({ digest });
    } else {
      res.json({ digest: null, message: 'No digest generated yet' });
    }
  });

  // Get digest history
  app.get('/api/v1/workspaces/:id/digest/history', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const history = digestService.getHistory(workspaceId);
    res.json({ digests: history });
  });

  // Get handoff document
  app.get('/api/v1/workspaces/:id/handoff', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const handoff = handoffService.getHandoff(workspaceId);

    if (handoff) {
      res.json({ handoff });
    } else {
      res.json({ handoff: null, message: 'No handoff document generated yet' });
    }
  });

  // Regenerate handoff document
  app.post('/api/v1/workspaces/:id/handoff/regenerate', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const handoff = await handoffService.updateHandoff(workspaceId);

    if (handoff) {
      res.json({ handoff });
    } else {
      res.status(503).json({ error: 'Handoff generation failed' });
    }
  });
}
