/**
 * Storage Routes - file upload/download/IPFS, API keys
 * Persisted to Appwrite (shared across members), in-memory cache for speed.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';
import { safetyService } from '../services/safety-service';
import { auditService } from '../services/audit-service';
import { appwriteService } from '../services/appwrite-service';

// Local cache
const storageStore: Map<string, any[]> = new Map();
const storageContent: Map<string, string> = new Map();
const apiKeysStore: Map<string, any[]> = new Map();
const loadedFiles: Set<string> = new Set();
const loadedKeys: Set<string> = new Set();

async function loadFiles(workspaceId: string): Promise<void> {
  if (loadedFiles.has(workspaceId) || !appwriteService.isInitialized()) return;
  try {
    const result = await appwriteService.listStoredFiles(workspaceId);
    storageStore.set(workspaceId, result.documents.map((d: any) => ({
      id: d.$id, cid: d.cid, name: d.name, size: d.size,
      mimeType: d.mimeType, addedBy: d.addedBy, addedAt: d.addedAt,
      pinned: d.pinned, _appwriteId: d.$id,
    })));
    loadedFiles.add(workspaceId);
  } catch (err) {
    console.warn('[Storage] Appwrite load failed:', err);
  }
}

async function loadApiKeys(workspaceId: string): Promise<void> {
  if (loadedKeys.has(workspaceId) || !appwriteService.isInitialized()) return;
  try {
    const result = await appwriteService.listWorkspaceApiKeys(workspaceId);
    apiKeysStore.set(workspaceId, result.documents.map((d: any) => ({
      id: d.$id, provider: d.provider, name: d.name,
      maskedKey: d.encryptedKey, addedBy: d.addedBy, addedAt: d.addedAt,
      _appwriteId: d.$id,
    })));
    loadedKeys.add(workspaceId);
  } catch (err) {
    console.warn('[Storage] Appwrite API keys load failed:', err);
  }
}

export function registerStorageRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // ============ Storage Files Endpoints ============

  app.get('/api/v1/workspaces/:id/storage/files', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadFiles(workspaceId);
    const files = storageStore.get(workspaceId) || [];
    res.json({ files });
  });

  app.post('/api/v1/workspaces/:id/storage/upload', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const { content, filename, mimeType } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    // Safety scan text-based files
    const isText = !mimeType || mimeType.startsWith('text/') || mimeType === 'application/json';
    if (isText && typeof content === 'string') {
      const result = await safetyService.scanText(content);
      if (!result.safe) {
        auditService.log({
          workspaceId, contentType: 'file', contentId: filename || 'upload',
          userId: session.username, action: 'blocked',
          category: result.category, reason: result.reason, method: result.method,
        });
        res.status(422).json({ error: 'File blocked: content policy violation', category: result.category, reason: result.reason });
        return;
      }
    }

    if (mimeType && mimeType.startsWith('image/')) {
      const imageResult = await safetyService.scanImageDescription(`Uploaded image file: ${filename || 'unknown'}, type: ${mimeType}`);
      if (!imageResult.safe) {
        auditService.log({
          workspaceId, contentType: 'file', contentId: filename || 'upload',
          userId: session.username, action: 'blocked',
          category: imageResult.category, reason: imageResult.reason, method: imageResult.method,
        });
        res.status(422).json({ error: 'File blocked: content policy violation', category: imageResult.category, reason: imageResult.reason });
        return;
      }
    }

    auditService.log({
      workspaceId, contentType: 'file', contentId: filename || 'upload',
      userId: session.username, action: 'allowed',
      category: null, reason: '', method: 'scan',
    });

    const cid = `Qm${uuidv4().replace(/-/g, '').slice(0, 44)}`;
    const file: any = {
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
    if (!storageStore.has(workspaceId)) storageStore.set(workspaceId, []);
    storageStore.get(workspaceId)!.push(file);

    // Persist to Appwrite
    if (appwriteService.isInitialized()) {
      appwriteService.createStoredFile(workspaceId, {
        cid: file.cid, name: file.name, size: file.size,
        mimeType: file.mimeType, addedBy: file.addedBy, pinned: true,
      }).then(doc => {
        file._appwriteId = doc.$id;
        file.id = doc.$id;
      }).catch(err => console.warn('[Storage] Appwrite write failed:', err));
    }

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

  app.delete('/api/v1/workspaces/:id/storage/files/:fileId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const fileId = req.params.fileId as string;
    await loadFiles(workspaceId);

    const files = storageStore.get(workspaceId) || [];
    const fileIndex = files.findIndex(f => f.id === fileId || f._appwriteId === fileId);
    if (fileIndex === -1) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const file = files[fileIndex];
    storageContent.delete(file.cid);
    files.splice(fileIndex, 1);

    if (appwriteService.isInitialized()) {
      appwriteService.deleteStoredFile(file._appwriteId || fileId)
        .catch(err => console.warn('[Storage] Appwrite delete failed:', err));
    }

    res.json({ success: true });
  });

  // ============ API Keys Endpoints ============

  app.get('/api/v1/workspaces/:id/api-keys', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadApiKeys(workspaceId);
    const apiKeys = apiKeysStore.get(workspaceId) || [];
    res.json({ apiKeys });
  });

  app.post('/api/v1/workspaces/:id/api-keys', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const { provider, name, key } = req.body;

    if (!key) {
      res.status(400).json({ error: 'API key is required' });
      return;
    }

    const maskedKey = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****';

    const apiKey: any = {
      id: uuidv4(),
      provider: provider || 'custom',
      name: name || 'API Key',
      maskedKey,
      addedBy: session.username,
      addedAt: new Date().toISOString(),
    };

    if (!apiKeysStore.has(workspaceId)) apiKeysStore.set(workspaceId, []);
    apiKeysStore.get(workspaceId)!.push(apiKey);

    if (appwriteService.isInitialized()) {
      appwriteService.createWorkspaceApiKey(workspaceId, {
        provider: apiKey.provider, name: apiKey.name,
        encryptedKey: maskedKey, addedBy: apiKey.addedBy,
      }).then(doc => {
        apiKey._appwriteId = doc.$id;
        apiKey.id = doc.$id;
      }).catch(err => console.warn('[Storage] Appwrite API key write failed:', err));
    }

    res.status(201).json({ apiKey });
  });

  app.delete('/api/v1/workspaces/:id/api-keys/:keyId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const keyId = req.params.keyId as string;
    await loadApiKeys(workspaceId);

    const keys = apiKeysStore.get(workspaceId) || [];
    const keyIndex = keys.findIndex(k => k.id === keyId || k._appwriteId === keyId);
    if (keyIndex === -1) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    const awId = keys[keyIndex]._appwriteId || keyId;
    keys.splice(keyIndex, 1);

    if (appwriteService.isInitialized()) {
      appwriteService.deleteWorkspaceApiKey(awId)
        .catch(err => console.warn('[Storage] Appwrite API key delete failed:', err));
    }

    res.json({ success: true });
  });

  // ============ Usage Summary Endpoint ============

  app.get('/api/v1/workspaces/:id/usage/summary', localAuth, (req: Request, res: Response) => {
    res.json({
      summary: {
        totalCostCents: 0, totalTokens: 0, totalComputeSeconds: 0,
        byProvider: {}, byFlow: {},
      },
    });
  });
}
