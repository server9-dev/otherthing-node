/**
 * Ollama Routes - Ollama management
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';

export function registerOllamaRoutes(deps: RouteDependencies): void {
  const { app, ollamaManager } = deps;

  app.get('/api/v1/ollama/status', async (req: Request, res: Response) => {
    try {
      if (!ollamaManager) {
        res.json({ installed: false, running: false, models: [] });
        return;
      }
      const status = await ollamaManager.getStatus();
      res.json(status);
    } catch (err) {
      console.error('[API] Ollama status error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/v1/ollama/start', async (req: Request, res: Response) => {
    try {
      if (!ollamaManager) {
        res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
        return;
      }
      await ollamaManager.start();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/v1/ollama/stop', async (req: Request, res: Response) => {
    try {
      if (!ollamaManager) {
        res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
        return;
      }
      await ollamaManager.stop();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.get('/api/v1/ollama/models', async (req: Request, res: Response) => {
    try {
      if (!ollamaManager) {
        res.json([]);
        return;
      }
      const status = await ollamaManager.getStatus();
      res.json(status.models || []);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/v1/ollama/pull', async (req: Request, res: Response) => {
    try {
      const { model } = req.body;
      if (!model) {
        res.status(400).json({ success: false, error: 'Model name required' });
        return;
      }
      if (!ollamaManager) {
        res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
        return;
      }
      await ollamaManager.pullModel(model);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.delete('/api/v1/ollama/models/:model', async (req: Request, res: Response) => {
    try {
      const { model } = req.params;
      if (!ollamaManager) {
        res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
        return;
      }
      await ollamaManager.deleteModel(model as string);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });
}
