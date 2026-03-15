/**
 * Memory Routes - Semantic Memory (ELID Integration)
 */

import { Request, Response } from 'express';
import { semanticMemory } from '../services/semantic-memory';
import type { RouteDependencies } from './types';

export function registerMemoryRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Initialize semantic memory with Ollama when available
  const ollamaManager = deps.managers.ollamaManager;
  if (ollamaManager) {
    semanticMemory.setOllamaManager(ollamaManager);
  }

  // Store a memory
  app.post('/api/v1/memory/:workspaceId', localAuth, async (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const { content, type, metadata } = req.body;

      if (!content) {
        return res.status(400).json({ error: 'Content is required' });
      }

      const memory = await semanticMemory.store(
        workspaceId,
        content,
        type || 'conversation',
        metadata || {}
      );

      res.json({ success: true, memory });
    } catch (err) {
      res.status(500).json({ error: 'Failed to store memory', details: String(err) });
    }
  });

  // Search memories
  app.post('/api/v1/memory/:workspaceId/search', localAuth, async (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const { query, limit, maxDistance, type, tags } = req.body;

      if (!query) {
        return res.status(400).json({ error: 'Query is required' });
      }

      const results = await semanticMemory.search(workspaceId, query, {
        limit: limit || 10,
        maxDistance: maxDistance || 64,
        type,
        tags,
      });

      res.json({
        success: true,
        count: results.length,
        results: results.map(r => ({
          ...r.entry,
          distance: r.distance,
          similarity: r.similarity,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to search memories', details: String(err) });
    }
  });

  // Get recent memories
  app.get('/api/v1/memory/:workspaceId/recent', localAuth, (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const limit = parseInt(req.query.limit as string) || 10;

      const memories = semanticMemory.getRecent(workspaceId, limit);

      res.json({ success: true, count: memories.length, memories });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get recent memories', details: String(err) });
    }
  });

  // Get memory stats
  app.get('/api/v1/memory/:workspaceId/stats', localAuth, (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const stats = semanticMemory.getStats(workspaceId);

      res.json({ success: true, ...stats });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get memory stats', details: String(err) });
    }
  });

  // Delete a specific memory
  app.delete('/api/v1/memory/:workspaceId/:memoryId', localAuth, async (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const memoryId = req.params.memoryId as string;
      const deleted = await semanticMemory.delete(workspaceId, memoryId);

      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Memory not found' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete memory', details: String(err) });
    }
  });

  // Clear all memories for a workspace
  app.delete('/api/v1/memory/:workspaceId', localAuth, async (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      await semanticMemory.clear(workspaceId);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to clear memories', details: String(err) });
    }
  });

  // Export memories
  app.get('/api/v1/memory/:workspaceId/export', localAuth, (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const memories = semanticMemory.exportMemories(workspaceId);

      res.json({ success: true, workspaceId, count: memories.length, memories });
    } catch (err) {
      res.status(500).json({ error: 'Failed to export memories', details: String(err) });
    }
  });

  // Import memories
  app.post('/api/v1/memory/:workspaceId/import', localAuth, async (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const { memories } = req.body;

      if (!Array.isArray(memories)) {
        return res.status(400).json({ error: 'Memories array is required' });
      }

      await semanticMemory.importMemories(workspaceId, memories);

      res.json({ success: true, imported: memories.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to import memories', details: String(err) });
    }
  });
}
