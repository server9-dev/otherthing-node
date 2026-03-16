/**
 * Export Routes — IPFS export of workspace artifacts
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { ipfsExportService } from '../services/ipfs-export-service';

export function registerExportRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Export chat messages to IPFS
  app.post('/api/v1/workspaces/:id/exports/chat', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages array required' });
      return;
    }

    const artifact = await ipfsExportService.exportContent(workspaceId, 'chat', messages, {
      messageCount: messages.length,
      dateRange: messages.length > 0
        ? { from: messages[0].timestamp, to: messages[messages.length - 1].timestamp }
        : null,
    });

    if (artifact) {
      res.status(201).json({ artifact });
    } else {
      res.status(503).json({ error: 'IPFS not available' });
    }
  });

  // Export whiteboard data to IPFS
  app.post('/api/v1/workspaces/:id/exports/whiteboard', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { data } = req.body;

    if (!data) {
      res.status(400).json({ error: 'whiteboard data required' });
      return;
    }

    const artifact = await ipfsExportService.exportContent(workspaceId, 'whiteboard', data, {
      elementCount: Array.isArray(data.elements) ? data.elements.length : 0,
    });

    if (artifact) {
      res.status(201).json({ artifact });
    } else {
      res.status(503).json({ error: 'IPFS not available' });
    }
  });

  // List artifacts for a workspace
  app.get('/api/v1/workspaces/:id/exports', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const type = req.query.type as string | undefined;
    const since = req.query.since as string | undefined;

    let artifacts;
    if (since) {
      artifacts = ipfsExportService.getArtifactsSince(
        workspaceId,
        new Date(since),
        type as any
      );
    } else {
      artifacts = ipfsExportService.getArtifacts(workspaceId, type as any);
    }

    res.json({ artifacts });
  });

  // Retrieve artifact content by CID
  app.get('/api/v1/exports/:cid', localAuth, async (req: Request, res: Response) => {
    const cid = req.params.cid as string;
    const content = await ipfsExportService.getContent(cid);

    if (content) {
      res.json(content);
    } else {
      res.status(404).json({ error: 'Artifact not found or IPFS unavailable' });
    }
  });
}
