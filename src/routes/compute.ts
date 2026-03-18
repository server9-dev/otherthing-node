/**
 * Compute Routes - sandbox, GPU, zlayer, code-server
 */

import { Request, Response } from 'express';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { cloudGPUProvider } from '../services/cloud-gpu-provider';
import { HardwareDetector } from '../hardware';
import type { RouteDependencies } from './types';
import { ipfsExportService } from '../services/ipfs-export-service';
import { healthReportService } from '../services/health-report-service';
import { setWorkspaceToolRefs } from '../services/workspace-tools';
import { safetyService } from '../services/safety-service';
import { auditService } from '../services/audit-service';
import { banService } from '../services/ban-service';

export function registerComputeRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Compute Summary Endpoint
  app.get('/api/v1/workspaces/:id/compute', localAuth, async (req: Request, res: Response) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    let localModels: string[] = [];
    const ollamaManager = deps.managers.ollamaManager;
    if (ollamaManager) {
      try {
        const status = await ollamaManager.getStatus();
        localModels = (status.models || []).map(m => m.name);
      } catch {
        // Ignore errors
      }
    }

    res.json({
      compute: {
        nodes: 1,
        totalCores: cpus.length,
        totalMemoryMb: Math.round(totalMem / 1024 / 1024),
        availableMemoryMb: Math.round(freeMem / 1024 / 1024),
        gpus: 0,
        localNodes: 1,
        localModels,
        hasLocalCompute: true,
        hasCloudKeys: false,
        cloudProviders: [],
      },
    });
  });

  // ============ Sandbox Endpoints ============

  app.get('/api/v1/workspaces/:id/sandbox/files', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const dirPath = (req.query.path as string) || '.';
    const sandboxManager = deps.managers.sandboxManager;
    if (!sandboxManager) {
      res.status(503).json({ error: 'Sandbox not configured' });
      return;
    }
    const result = await sandboxManager.listFiles(workspaceId, dirPath);
    if (result.success) {
      res.json({ files: result.files });
    } else {
      res.status(500).json({ error: result.error });
    }
  });

  app.get('/api/v1/workspaces/:id/sandbox/file', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const filePath = (req.query.path as string) || '';
    const sandboxManager = deps.managers.sandboxManager;
    if (!sandboxManager) {
      res.status(503).json({ error: 'Sandbox not configured' });
      return;
    }
    const result = await sandboxManager.readFile(workspaceId, filePath);
    if (result.success) {
      res.json({ content: result.content });
    } else {
      res.status(404).json({ error: result.error });
    }
  });

  app.put('/api/v1/workspaces/:id/sandbox/file', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const filePath = (req.query.path as string) || req.body.path || '';
    const { content } = req.body;
    const sandboxManager = deps.managers.sandboxManager;
    if (!sandboxManager) {
      res.status(503).json({ error: 'Sandbox not configured' });
      return;
    }
    const result = await sandboxManager.writeFile(workspaceId, filePath, content);
    if (result.success) {
      res.json({ success: true, path: result.path });
    } else {
      res.status(500).json({ error: result.error });
    }
  });

  app.delete('/api/v1/workspaces/:id/sandbox/file', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const filePath = (req.query.path as string) || '';
    const sandboxManager = deps.managers.sandboxManager;
    if (!sandboxManager) {
      res.status(503).json({ error: 'Sandbox not configured' });
      return;
    }
    const result = await sandboxManager.deleteFile(workspaceId, filePath);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: result.error });
    }
  });

  // Container runtime stub (prevents 404 spam from ContainersPanel)
  app.get('/api/v1/containers/runtime', (req: Request, res: Response) => {
    res.json({
      installed: false,
      runtime: null,
      version: null,
      message: 'Container runtime managed via ZLayer',
    });
  });

  app.get('/api/v1/containers', (req: Request, res: Response) => {
    res.json({ containers: [] });
  });

  // Settings - storage path (reads from node config)
  app.get('/api/v1/settings/storage-path', (req: Request, res: Response) => {
    const configPath = require('path').join(
      require('./types').default?.storagePath ||
      require('path').join(require('os').homedir(), '.otherthing')
    );
    // Read from saved config
    try {
      const nodeConfigPath = require('path').join(
        require('../electron-compat').getUserDataPath(), 'node-config.json'
      );
      if (require('fs').existsSync(nodeConfigPath)) {
        const config = JSON.parse(require('fs').readFileSync(nodeConfigPath, 'utf-8'));
        res.json({ path: config.storagePath || require('path').join(require('os').homedir(), '.otherthing') });
        return;
      }
    } catch {}
    res.json({ path: require('path').join(require('os').homedir(), '.otherthing') });
  });

  app.post('/api/v1/settings/storage-path', localAuth, (req: Request, res: Response) => {
    // Note: changing storage path requires app restart to take effect.
    // We save it to config but don't hot-reload IPFS (would lose data).
    const { path: newPath } = req.body;
    try {
      const nodeConfigPath = require('path').join(
        require('../electron-compat').getUserDataPath(), 'node-config.json'
      );
      if (require('fs').existsSync(nodeConfigPath)) {
        const config = JSON.parse(require('fs').readFileSync(nodeConfigPath, 'utf-8'));
        config.storagePath = newPath;
        require('fs').writeFileSync(nodeConfigPath, JSON.stringify(config, null, 2));
      }
    } catch (err) {
      console.error('[Settings] Failed to save storage path:', err);
    }
    res.json({ success: true, message: 'Storage path saved. Restart app to apply.' });
  });

  app.get('/api/v1/settings/resource-limits', (req: Request, res: Response) => {
    res.json({});
  });

  app.post('/api/v1/settings/resource-limits', localAuth, (req: Request, res: Response) => {
    res.json({ success: true });
  });

  app.get('/api/v1/settings/remote-control', (req: Request, res: Response) => {
    res.json({ enabled: false });
  });

  app.post('/api/v1/settings/remote-control', localAuth, (req: Request, res: Response) => {
    res.json({ success: true });
  });

  // ============ Team Chat (in-memory) ============

  const chatMessages: Map<string, any[]> = new Map();

  // Expose refs for workspace tools and health reports
  // (tasksStore is in tasks.ts, so we create a shared ref here for chat)
  setWorkspaceToolRefs(new Map(), chatMessages, deps.workspaceManager);
  healthReportService.setStoreRefs(new Map(), chatMessages);

  app.get('/api/v1/workspaces/:id/chat', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const msgs = chatMessages.get(workspaceId) || [];
    res.json({ messages: msgs.slice(-limit) });
  });

  app.post('/api/v1/workspaces/:id/chat', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const { content, senderAddress, displayName } = req.body;

    if (!content?.trim()) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const senderId = senderAddress || session.userId;

    // Ban check
    const banCheck = banService.isBanned(senderId, workspaceId);
    if (banCheck.banned) {
      res.status(403).json({ error: 'You are banned from this workspace', ban: banCheck.ban });
      return;
    }

    // Pass 1: Instant keyword scan (<1ms)
    const keywordResult = safetyService.scanKeywords(content.trim());
    if (keywordResult) {
      auditService.log({
        workspaceId, contentType: 'chat', contentId: 'blocked-pre-save',
        userId: senderId, action: 'blocked',
        category: keywordResult.category, reason: keywordResult.reason, method: keywordResult.method,
      });
      banService.handleViolation(senderId, workspaceId, keywordResult.category || 'S4', keywordResult.reason);
      res.status(422).json({ error: 'Content blocked', category: keywordResult.category, reason: keywordResult.reason });
      return;
    }

    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspaceId,
      sender: senderId,
      senderName: displayName || session.username,
      content: content.trim(),
      timestamp: new Date().toISOString(),
      moderation: null as any,
    };

    if (!chatMessages.has(workspaceId)) {
      chatMessages.set(workspaceId, []);
    }
    const msgs = chatMessages.get(workspaceId)!;
    msgs.push(msg);

    // Keyword scan is the primary gate for chat (instant, no false positives).
    // LlamaGuard async scan disabled for chat — too many false positives on
    // technical dev discussions (security, pentesting, vulnerability talk).
    // LlamaGuard is still used for file uploads where blocking is acceptable.
    auditService.log({
      workspaceId, contentType: 'chat', contentId: msg.id,
      userId: senderId, action: 'allowed',
      category: null, reason: '', method: 'keyword',
    });

    // Auto-export to IPFS every 100 messages
    if (msgs.length > 0 && msgs.length % 100 === 0) {
      ipfsExportService.exportContent(workspaceId, 'chat', msgs.slice(-100), {
        messageCount: 100,
        autoExport: true,
      }).catch(() => {});
    }

    // Keep last 500 messages per workspace
    if (msgs.length > 500) msgs.splice(0, msgs.length - 500);

    res.status(201).json({ message: msg });
  });

  // ── Code Server (code-server per workspace) ──
  const codeServers: Map<string, { process: ChildProcess; port: number }> = new Map();
  const CODE_SERVER_BASE_PORT = 13370;

  function findCodeServerBin(): string | null {
    const candidates = [
      path.join(os.homedir(), '.local', 'code-server', 'bin', 'code-server'),
      path.join(os.homedir(), '.local', 'bin', 'code-server'),
      '/usr/bin/code-server',
      '/usr/local/bin/code-server',
    ];
    const fs = require('fs');
    return candidates.find(p => fs.existsSync(p)) || null;
  }

  app.post('/api/v1/workspaces/:id/code-server', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;

    // Already running?
    const existing = codeServers.get(workspaceId);
    if (existing) {
      res.json({ port: existing.port, status: 'running' });
      return;
    }

    const bin = findCodeServerBin();
    if (!bin) {
      res.status(500).json({ error: 'code-server not found. Install via: curl -fsSL https://code-server.dev/install.sh | sh' });
      return;
    }

    // Assign a unique port per workspace
    const usedPorts = new Set(Array.from(codeServers.values()).map(s => s.port));
    let port = CODE_SERVER_BASE_PORT;
    while (usedPorts.has(port)) port++;

    // Workspace folder — use home dir as default, can be made workspace-specific later
    const folder = req.body?.folder || os.homedir();

    const proc = spawn(bin, [
      '--auth', 'none',
      '--bind-addr', `127.0.0.1:${port}`,
      '--disable-telemetry',
      '--disable-getting-started-override',
      '--disable-workspace-trust',
      folder,
    ], {
      stdio: 'pipe',
      env: {
        ...process.env,
        // Disable built-in extensions that depend on Git Base (not bundled in code-server)
        CS_DISABLE_GETTING_STARTED_OVERRIDE: '1',
      },
    });

    proc.on('error', (err) => {
      console.error(`[CodeServer] Failed to start for workspace ${workspaceId}:`, err);
      codeServers.delete(workspaceId);
    });

    proc.on('exit', (code) => {
      console.log(`[CodeServer] Exited for workspace ${workspaceId} with code ${code}`);
      codeServers.delete(workspaceId);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('HTTP server listening')) {
        console.log(`[CodeServer] Ready for workspace ${workspaceId} on port ${port}`);
      }
    });

    codeServers.set(workspaceId, { process: proc, port });
    console.log(`[CodeServer] Starting for workspace ${workspaceId} on port ${port}`);

    res.json({ port, status: 'starting' });
  });

  app.get('/api/v1/workspaces/:id/code-server', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const existing = codeServers.get(workspaceId);
    if (existing) {
      res.json({ port: existing.port, status: 'running' });
    } else {
      res.json({ port: null, status: 'stopped' });
    }
  });

  app.delete('/api/v1/workspaces/:id/code-server', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const existing = codeServers.get(workspaceId);
    if (existing) {
      existing.process.kill();
      codeServers.delete(workspaceId);
    }
    res.json({ status: 'stopped' });
  });

  // Clean up code-servers on process exit
  process.on('exit', () => {
    for (const [, server] of codeServers) {
      server.process.kill();
    }
  });

  // Stats Endpoint
  app.get('/api/v1/stats', localAuth, (req: Request, res: Response) => {
    res.json({
      mode: 'local',
      nodes: 1,
      ollama: deps.managers.ollamaManager ? 'available' : 'unavailable',
      sandbox: deps.managers.sandboxManager ? 'available' : 'unavailable',
      ipfs: deps.managers.ipfsManager ? 'available' : 'unavailable',
    });
  });

  // Hardware Detection Endpoint
  app.get('/api/v1/hardware', async (req: Request, res: Response) => {
    try {
      const hardware = await HardwareDetector.detect();
      res.json(hardware);
    } catch (err) {
      console.error('[API] Hardware detection error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Drive List Endpoint
  app.get('/api/v1/drives', async (req: Request, res: Response) => {
    try {
      const drives = await HardwareDetector.getDrives();
      res.json(drives);
    } catch (err) {
      console.error('[API] Drive detection error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Models Endpoint
  app.get('/api/v1/models', localAuth, async (req: Request, res: Response) => {
    const ollamaManager = deps.managers.ollamaManager;
    if (!ollamaManager) {
      res.json({ models: [], provider: 'none' });
      return;
    }
    const status = await ollamaManager.getStatus();
    res.json({
      models: status.models || [],
      provider: 'ollama',
      endpoint: status.endpoint,
    });
  });

  // ============ Cloud GPU Endpoints ============

  app.post('/api/v1/gpu/configure', localAuth, async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        res.status(400).json({ success: false, error: 'API key required' });
        return;
      }
      cloudGPUProvider.initialize({ apiKey });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.get('/api/v1/gpu/offers', localAuth, async (req: Request, res: Response) => {
    try {
      if (!cloudGPUProvider.isConfigured()) {
        res.status(400).json({ error: 'Cloud GPU not configured' });
        return;
      }
      const maxPrice = parseFloat(req.query.maxPrice as string) || 2.0;
      const minVram = parseInt(req.query.minVram as string) || 0;
      const gpuType = req.query.gpuType as string;

      const offers = await cloudGPUProvider.searchOffers({
        maxPricePerHour: maxPrice,
        minGpuMemoryGb: minVram,
        gpuName: gpuType !== 'any' ? gpuType : undefined,
        verifiedOnly: true,
        sortBy: 'price',
      });
      res.json({ offers });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/v1/gpu/instances', localAuth, async (req: Request, res: Response) => {
    try {
      if (!cloudGPUProvider.isConfigured()) {
        res.json({ instances: [], billing: null });
        return;
      }
      const instances = await cloudGPUProvider.getInstances();
      const billing = await cloudGPUProvider.getBilling();
      res.json({ instances, billing });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/v1/gpu/rent', localAuth, async (req: Request, res: Response) => {
    try {
      const { offerId } = req.body;
      if (!offerId) {
        res.status(400).json({ error: 'Offer ID required' });
        return;
      }
      if (!cloudGPUProvider.isConfigured()) {
        res.status(400).json({ error: 'Cloud GPU not configured' });
        return;
      }
      const instance = await cloudGPUProvider.rentInstance(offerId);
      res.json({ success: true, instance });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/v1/gpu/instances/:id/tunnel', localAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = parseInt(req.params.id as string);
      const localPort = parseInt(req.query.port as string) || 11434;
      const tunnel = await cloudGPUProvider.createTunnel(instanceId, localPort);
      res.json({ success: true, tunnel });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/v1/gpu/instances/:id/tunnel', localAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = parseInt(req.params.id as string);
      cloudGPUProvider.disconnectTunnel(instanceId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/v1/gpu/instances/:id', localAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = parseInt(req.params.id as string);
      await cloudGPUProvider.terminateInstance(instanceId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/v1/gpu/instances/:id/pull', localAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = parseInt(req.params.id as string);
      const { model } = req.body;
      if (!model) {
        res.status(400).json({ error: 'Model name required' });
        return;
      }
      await cloudGPUProvider.pullModel(instanceId, model);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/v1/gpu/instances/:id/models', localAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = parseInt(req.params.id as string);
      const models = await cloudGPUProvider.listRemoteModels(instanceId);
      res.json({ models });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

}
