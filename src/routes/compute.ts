/**
 * Compute Routes - sandbox, GPU, zlayer
 */

import { Request, Response } from 'express';
import os from 'os';
import { cloudGPUProvider } from '../services/cloud-gpu-provider';
import { HardwareDetector } from '../hardware';
import { zlayerService } from '../services/zlayer-service';
import type { RouteDependencies } from './types';

export function registerComputeRoutes(deps: RouteDependencies): void {
  const { app, localAuth, ollamaManager, sandboxManager } = deps;

  // Compute Summary Endpoint
  app.get('/api/v1/workspaces/:id/compute', localAuth, async (req: Request, res: Response) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    let localModels: string[] = [];
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

  // Stats Endpoint
  app.get('/api/v1/stats', localAuth, (req: Request, res: Response) => {
    res.json({
      mode: 'local',
      nodes: 1,
      ollama: ollamaManager ? 'available' : 'unavailable',
      sandbox: sandboxManager ? 'available' : 'unavailable',
      ipfs: deps.ipfsManager ? 'available' : 'unavailable',
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

  // ============ ZLayer Container Orchestration API ============

  app.get('/api/v1/zlayer/status', localAuth, async (req: Request, res: Response) => {
    try {
      const info = await zlayerService.initialize();
      const version = info.installed ? await zlayerService.getVersion() : null;

      res.json({
        success: true,
        installed: info.installed,
        version,
        wasmSupported: info.wasmSupported,
        platform: info.platform,
        arch: info.arch,
        cliPath: info.cliPath,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get ZLayer status', details: String(err) });
    }
  });

  app.post('/api/v1/zlayer/install', localAuth, async (req: Request, res: Response) => {
    try {
      const success = await zlayerService.install((percent, message) => {
        console.log(`[ZLayer Install] ${percent}%: ${message}`);
      });

      if (success) {
        const version = await zlayerService.getVersion();
        res.json({ success: true, version });
      } else {
        res.status(500).json({ error: 'ZLayer installation failed' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to install ZLayer', details: String(err) });
    }
  });

  app.get('/api/v1/zlayer/services', localAuth, async (req: Request, res: Response) => {
    try {
      const services = await zlayerService.listServices();
      res.json({ success: true, services });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list services', details: String(err) });
    }
  });

  app.get('/api/v1/zlayer/services/:name', localAuth, async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const status = await zlayerService.getStatus(name);

      if (status) {
        res.json({ success: true, ...status });
      } else {
        res.status(404).json({ error: 'Service not found' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to get service status', details: String(err) });
    }
  });

  app.post('/api/v1/zlayer/deploy', localAuth, async (req: Request, res: Response) => {
    try {
      const spec = req.body;

      if (!spec.name) {
        return res.status(400).json({ error: 'Service name is required' });
      }

      const serviceId = await zlayerService.deploy(spec);

      if (serviceId) {
        res.json({ success: true, serviceId });
      } else {
        res.status(500).json({ error: 'Deployment failed' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to deploy service', details: String(err) });
    }
  });

  app.post('/api/v1/zlayer/services/:name/stop', localAuth, async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const success = await zlayerService.stop(name);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to stop service', details: String(err) });
    }
  });

  app.delete('/api/v1/zlayer/services/:name', localAuth, async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const success = await zlayerService.remove(name);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove service', details: String(err) });
    }
  });

  app.post('/api/v1/zlayer/services/:name/scale', localAuth, async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const { replicas } = req.body;

      if (typeof replicas !== 'number' || replicas < 0) {
        return res.status(400).json({ error: 'Valid replicas count is required' });
      }

      const success = await zlayerService.scale(name, replicas);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to scale service', details: String(err) });
    }
  });

  app.get('/api/v1/zlayer/services/:name/logs', localAuth, async (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const tail = parseInt(req.query.tail as string) || 100;
      const logs = await zlayerService.getLogs(name, tail);

      res.json({ success: true, logs });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get logs', details: String(err) });
    }
  });

  app.post('/api/v1/zlayer/wasm/run', localAuth, async (req: Request, res: Response) => {
    try {
      const { wasmPath, args, env, timeout } = req.body;

      if (!wasmPath) {
        return res.status(400).json({ error: 'WASM path is required' });
      }

      const result = await zlayerService.runWasm(wasmPath, { args, env, timeout });
      res.json({ success: result.exitCode === 0, ...result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to run WASM', details: String(err) });
    }
  });

  app.post('/api/v1/zlayer/build', localAuth, async (req: Request, res: Response) => {
    try {
      const { contextPath, tag, dockerfile, buildArgs } = req.body;

      if (!contextPath) {
        return res.status(400).json({ error: 'Context path is required' });
      }

      const imageTag = await zlayerService.build(contextPath, { tag, dockerfile, buildArgs });

      if (imageTag) {
        res.json({ success: true, tag: imageTag });
      } else {
        res.status(500).json({ error: 'Build failed' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to build image', details: String(err) });
    }
  });

  app.post('/api/v1/zlayer/workspaces/:workspaceId/deploy', localAuth, async (req: Request, res: Response) => {
    try {
      const workspaceId = req.params.workspaceId as string;
      const options = req.body;

      if (!sandboxManager) {
        return res.status(500).json({ error: 'Sandbox manager not available' });
      }

      const workspacePath = sandboxManager.getSandboxPath(workspaceId);
      if (!workspacePath) {
        return res.status(400).json({ error: 'Workspace path not available' });
      }

      const serviceId = await zlayerService.deployWorkspace(workspaceId, workspacePath, options);

      if (serviceId) {
        res.json({ success: true, serviceId });
      } else {
        res.status(500).json({ error: 'Workspace deployment failed' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to deploy workspace', details: String(err) });
    }
  });
}
