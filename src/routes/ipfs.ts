/**
 * IPFS Routes - IPFS management
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';

export function registerIPFSRoutes(deps: RouteDependencies): void {
  const { app } = deps;

  app.get('/api/v1/ipfs/status', async (req: Request, res: Response) => {
    try {
      const ipfsManager = deps.managers.ipfsManager;
      if (!ipfsManager) {
        res.json({ running: false, has_binary: false, peer_id: null, stats: null });
        return;
      }
      const stats = await ipfsManager.getStats();
      res.json({
        running: stats.isOnline,
        has_binary: ipfsManager.hasBinary(),
        peer_id: stats.peerId || null,
        stats: stats,
      });
    } catch (err) {
      console.error('[API] IPFS status error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/v1/ipfs/start', async (req: Request, res: Response) => {
    try {
      const ipfsManager = deps.managers.ipfsManager;
      if (!ipfsManager) {
        res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
        return;
      }
      await ipfsManager.start();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/v1/ipfs/stop', async (req: Request, res: Response) => {
    try {
      const ipfsManager = deps.managers.ipfsManager;
      if (!ipfsManager) {
        res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
        return;
      }
      await ipfsManager.stop();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/v1/ipfs/add', async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content) {
        res.status(400).json({ success: false, error: 'Content required' });
        return;
      }
      const ipfsManager = deps.managers.ipfsManager;
      if (!ipfsManager) {
        res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
        return;
      }
      const cid = await ipfsManager.addContent(content);
      res.json({ success: true, cid });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/v1/ipfs/pin/:cid', async (req: Request, res: Response) => {
    try {
      const { cid } = req.params;
      const ipfsManager = deps.managers.ipfsManager;
      if (!ipfsManager) {
        res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
        return;
      }
      await ipfsManager.pin(cid as string);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.delete('/api/v1/ipfs/pin/:cid', async (req: Request, res: Response) => {
    try {
      const { cid } = req.params;
      const ipfsManager = deps.managers.ipfsManager;
      if (!ipfsManager) {
        res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
        return;
      }
      await ipfsManager.unpin(cid as string);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // Download IPFS binary with SSE progress
  app.get('/api/v1/ipfs/download', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const manager = deps.managers.ipfsManager || new (require('../ipfs-manager').IPFSManager)(
      require('../electron-compat').getUserDataPath()
    );

    if (manager.hasBinary()) {
      res.write(`data: ${JSON.stringify({ progress: 100, status: 'complete' })}\n\n`);
      res.end();
      return;
    }

    const sendProgress = (percent: number) => {
      res.write(`data: ${JSON.stringify({ progress: percent, status: 'downloading' })}\n\n`);
    };

    manager.downloadBinary(sendProgress)
      .then(() => {
        res.write(`data: ${JSON.stringify({ progress: 100, status: 'complete' })}\n\n`);
        res.end();
      })
      .catch((err: Error) => {
        res.write(`data: ${JSON.stringify({ progress: -1, status: 'error', error: String(err) })}\n\n`);
        res.end();
      });

    req.on('close', () => {
      // Client disconnected - cleanup if needed
    });
  });

  // Non-SSE download endpoint
  app.post('/api/v1/ipfs/download', async (req: Request, res: Response) => {
    try {
      const manager = deps.managers.ipfsManager || new (require('../ipfs-manager').IPFSManager)(
        require('../electron-compat').getUserDataPath()
      );

      if (manager.hasBinary()) {
        res.json({ success: true, message: 'IPFS binary already installed' });
        return;
      }

      await manager.downloadBinary();
      res.json({ success: true, message: 'IPFS binary downloaded successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });
}
