/**
 * Signaling Routes — WebRTC signaling relay via Appwrite
 *
 * Since each user runs their own localhost server, the WebSocket
 * signaling can't cross machines. This relay uses Appwrite documents
 * as a message bus for SDP offers/answers/ICE candidates.
 *
 * Once the WebRTC connection is established (peer-to-peer), the
 * signaling channel is no longer needed.
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { appwriteService } from '../services/appwrite-service';

export function registerSignalingRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Send a signaling message (SDP offer/answer, ICE candidate, join/leave)
  app.post('/api/v1/workspaces/:id/signal', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { fromPeerId, targetPeerId, type, payload } = req.body;

    if (!fromPeerId || !targetPeerId || !type || !payload) {
      res.status(400).json({ error: 'fromPeerId, targetPeerId, type, and payload required' });
      return;
    }

    if (!appwriteService.isInitialized()) {
      res.status(503).json({ error: 'Signaling unavailable — Appwrite not connected' });
      return;
    }

    try {
      await appwriteService.sendSignal({
        workspaceId, fromPeerId, targetPeerId, type,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to send signal' });
    }
  });

  // Broadcast a signal to all peers (for join/leave notifications)
  app.post('/api/v1/workspaces/:id/signal/broadcast', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { fromPeerId, type, payload } = req.body;

    if (!appwriteService.isInitialized()) {
      res.status(503).json({ error: 'Signaling unavailable' });
      return;
    }

    try {
      // Write a single signal with targetPeerId='all' — everyone polling picks it up
      await appwriteService.sendSignal({
        workspaceId,
        fromPeerId,
        targetPeerId: 'all',
        type,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to broadcast signal' });
    }
  });

  // Poll for signaling messages addressed to this peer
  app.get('/api/v1/workspaces/:id/signal/poll', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const peerId = req.query.peerId as string;
    const since = req.query.since as string || new Date(Date.now() - 30000).toISOString();

    if (!peerId) {
      res.status(400).json({ error: 'peerId query param required' });
      return;
    }

    if (!appwriteService.isInitialized()) {
      res.json({ signals: [] });
      return;
    }

    try {
      const result = await appwriteService.pollSignals(workspaceId, peerId, since);
      const signals = result.documents.map((d: any) => ({
        id: d.$id,
        fromPeerId: d.fromPeerId,
        type: d.type,
        payload: d.payload,
        timestamp: d.timestamp,
      }));
      res.json({ signals });
    } catch (err) {
      res.json({ signals: [] });
    }
  });

  // Cleanup old signals (call periodically or on session end)
  app.post('/api/v1/workspaces/:id/signal/cleanup', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await appwriteService.cleanupSignals(workspaceId);
    res.json({ success: true });
  });
}
