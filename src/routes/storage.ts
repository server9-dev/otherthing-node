/**
 * Storage Routes - file upload/download/IPFS, API keys
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';

// Storage Files storage (in-memory with content)
const storageStore: Map<string, any[]> = new Map();
const storageContent: Map<string, string> = new Map();

// API Keys storage (in-memory)
const apiKeysStore: Map<string, any[]> = new Map();

export function registerStorageRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // ============ Storage Files Endpoints ============

  app.get('/api/v1/workspaces/:id/storage/files', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const files = storageStore.get(workspaceId) || [];
    res.json({ files });
  });

  app.post('/api/v1/workspaces/:id/storage/upload', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const { content, filename, mimeType } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const cid = `Qm${uuidv4().replace(/-/g, '').slice(0, 44)}`;
    const file = {
      id: uuidv4(),
      cid,
      name: filename || 'untitled.txt',
      size: Buffer.byteLength(content, 'utf8'),
      mimeType: mimeType || 'text/plain',
      addedBy: session.username,
      addedAt: new Date().toISOString(),
      pinned: true,
    };

    storageContent.set(cid, content);

    if (!storageStore.has(workspaceId)) {
      storageStore.set(workspaceId, []);
    }
    storageStore.get(workspaceId)!.push(file);
    res.status(201).json({ file });
  });

  app.get('/api/v1/workspaces/:id/storage/content/:cid', localAuth, (req: Request, res: Response) => {
    const cid = req.params.cid as string;
    const content = storageContent.get(cid);
    if (!content) {
      res.status(404).json({ error: 'Content not found' });
      return;
    }
    res.json({ content });
  });

  app.delete('/api/v1/workspaces/:id/storage/files/:fileId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const fileId = req.params.fileId as string;
    const files = storageStore.get(workspaceId) || [];
    const fileIndex = files.findIndex(f => f.id === fileId);
    if (fileIndex === -1) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const file = files[fileIndex];
    storageContent.delete(file.cid);
    files.splice(fileIndex, 1);
    res.json({ success: true });
  });

  // ============ API Keys Endpoints ============

  app.get('/api/v1/workspaces/:id/api-keys', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const apiKeys = apiKeysStore.get(workspaceId) || [];
    res.json({ apiKeys });
  });

  app.post('/api/v1/workspaces/:id/api-keys', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const { provider, name, key } = req.body;

    if (!key) {
      res.status(400).json({ error: 'API key is required' });
      return;
    }

    const maskedKey = key.length > 8
      ? `${key.slice(0, 4)}...${key.slice(-4)}`
      : '****';

    const apiKey = {
      id: uuidv4(),
      provider: provider || 'custom',
      name: name || 'API Key',
      maskedKey,
      addedBy: session.username,
      addedAt: new Date().toISOString(),
    };

    if (!apiKeysStore.has(workspaceId)) {
      apiKeysStore.set(workspaceId, []);
    }
    apiKeysStore.get(workspaceId)!.push(apiKey);
    res.status(201).json({ apiKey });
  });

  app.delete('/api/v1/workspaces/:id/api-keys/:keyId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const keyId = req.params.keyId as string;
    const keys = apiKeysStore.get(workspaceId) || [];
    const keyIndex = keys.findIndex(k => k.id === keyId);
    if (keyIndex === -1) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }
    keys.splice(keyIndex, 1);
    res.json({ success: true });
  });

  // ============ Usage Summary Endpoint ============

  app.get('/api/v1/workspaces/:id/usage/summary', localAuth, (req: Request, res: Response) => {
    res.json({
      summary: {
        totalCostCents: 0,
        totalTokens: 0,
        totalComputeSeconds: 0,
        byProvider: {},
        byFlow: {},
      },
    });
  });
}
