/**
 * Ollama Routes - Ollama management
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { handoffService } from '../services/handoff-service';
import { remoteInferenceService } from '../services/remote-inference';
import { premiumService } from '../services/premium-service';

export function registerOllamaRoutes(deps: RouteDependencies): void {
  const { app } = deps;

  app.get('/api/v1/ollama/status', async (req: Request, res: Response) => {
    try {
      const ollamaManager = deps.managers.ollamaManager;
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
      const ollamaManager = deps.managers.ollamaManager;
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
      const ollamaManager = deps.managers.ollamaManager;
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
      const ollamaManager = deps.managers.ollamaManager;
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
      const ollamaManager = deps.managers.ollamaManager;
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

  // Streaming chat endpoint (SSE)
  // Local Ollama first, premium users fall back to hosted inference
  app.post('/api/v1/ollama/chat', async (req: Request, res: Response) => {
    const ollamaManager = deps.managers.ollamaManager;
    const { model, messages, temperature, max_tokens, workspaceId, wallet } = req.body;
    if (!messages) {
      res.status(400).json({ error: 'messages required' });
      return;
    }

    // Inject handoff doc as context when workspace is specified
    if (workspaceId) {
      const handoffContent = handoffService.getHandoffContent(workspaceId);
      if (handoffContent) {
        const contextMsg = {
          role: 'system',
          content: `[Workspace Context — Living Handoff Document]\n${handoffContent}`,
        };
        const firstNonSystem = messages.findIndex((m: any) => m.role !== 'system');
        if (firstNonSystem > 0) {
          messages.splice(firstNonSystem, 0, contextMsg);
        } else {
          messages.unshift(contextMsg);
        }
      }
    }

    // Try local Ollama first
    let useLocal = false;
    if (ollamaManager) {
      const running = await ollamaManager.checkRunning();
      if (running) useLocal = true;
    }

    // Premium fallback: hosted inference (no hardware needed)
    if (!useLocal && remoteInferenceService.isConfigured()) {
      const isPremium = wallet ? premiumService.isPremium(wallet).active : false;
      if (isPremium) {
        try {
          const result = await remoteInferenceService.chat({
            model,
            messages,
            temperature,
            max_tokens,
          });
          // Send as single SSE event (non-streaming for remote)
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.write(`data: ${JSON.stringify({ message: { content: result.content }, done: true, model: result.model })}\n\n`);
          res.end();
          return;
        } catch (err: any) {
          res.status(503).json({ error: err.message });
          return;
        }
      }
    }

    if (!useLocal) {
      res.status(503).json({ error: 'No AI available. Run Ollama locally or upgrade to Premium.' });
      return;
    }

    if (!model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }

    const endpoint = ollamaManager!.getEndpoint();

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const ollamaRes = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: {
            ...(temperature !== undefined && { temperature }),
            ...(max_tokens !== undefined && { num_predict: max_tokens }),
          },
        }),
        signal: controller.signal,
      });

      if (!ollamaRes.ok || !ollamaRes.body) {
        res.write(`data: ${JSON.stringify({ error: 'Ollama request failed' })}\n\n`);
        res.end();
        return;
      }

      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            if (chunk.done) {
              res.end();
              return;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer);
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } catch {}
      }

      res.end();
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      try {
        res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
        res.end();
      } catch {}
    }
  });

  app.delete('/api/v1/ollama/models/:model', async (req: Request, res: Response) => {
    try {
      const { model } = req.params;
      const ollamaManager = deps.managers.ollamaManager;
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
