/**
 * Node Routes - workspace node management
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { adapterManager } from '../adapters/adapter-manager';
import type { RouteDependencies, WorkspaceNodeRecord } from './types';

export function registerNodeRoutes(deps: RouteDependencies): void {
  const { app, localAuth, workspaceManager, workspaceNodes, localNodeShareKey } = deps;

  app.get('/api/v1/workspaces/:id/nodes', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const nodes = workspaceNodes.get(workspaceId) || [];
    res.json({ nodes });
  });

  app.post('/api/v1/workspaces/:id/nodes/add-by-key', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { shareKey } = req.body;

    if (!shareKey) {
      res.status(400).json({ error: 'Share key is required' });
      return;
    }

    // Check workspace exists (local manager or on-chain hex ID)
    const isOnChainId = workspaceId.startsWith('0x') && workspaceId.length === 66;
    if (!isOnChainId) {
      const workspace = workspaceManager.getWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
    }

    if (!workspaceNodes.has(workspaceId)) {
      workspaceNodes.set(workspaceId, []);
    }

    const nodes = workspaceNodes.get(workspaceId)!;

    if (nodes.some(n => n.shareKey === shareKey)) {
      res.status(400).json({ error: 'Node already added to this workspace' });
      return;
    }

    const isLocalNode = shareKey === localNodeShareKey;

    let nodeRecord: WorkspaceNodeRecord;

    if (isLocalNode) {
      nodeRecord = {
        id: `node-${uuidv4().slice(0, 8)}`,
        shareKey,
        name: os.hostname(),
        status: 'online',
        hardware: {
          cpuCores: os.cpus().length,
          memoryMb: Math.round(os.totalmem() / 1024 / 1024),
          gpuCount: 0,
        },
        addedAt: new Date().toISOString(),
        isLocal: true,
      };
    } else {
      nodeRecord = {
        id: `node-${uuidv4().slice(0, 8)}`,
        shareKey,
        name: undefined,
        status: 'offline',
        hardware: undefined,
        addedAt: new Date().toISOString(),
        isLocal: false,
      };
    }

    nodes.push(nodeRecord);
    console.log(`[ApiServer] Added node ${nodeRecord.id} (${shareKey}) to workspace ${workspaceId}`);

    res.status(201).json({ node: nodeRecord });
  });

  app.delete('/api/v1/workspaces/:id/nodes/:nodeId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const nodeId = req.params.nodeId as string;

    const nodes = workspaceNodes.get(workspaceId);
    if (!nodes) {
      res.status(404).json({ error: 'Workspace has no nodes' });
      return;
    }

    const nodeIndex = nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) {
      res.status(404).json({ error: 'Node not found in workspace' });
      return;
    }

    const removedNode = nodes.splice(nodeIndex, 1)[0];
    console.log(`[ApiServer] Removed node ${nodeId} from workspace ${workspaceId}`);

    res.json({ success: true, removedNode });
  });

  // My Nodes Endpoint (for web UI node detection)
  app.get('/api/v1/my-nodes', localAuth, async (req: Request, res: Response) => {
    try {
      const ollamaManager = deps.managers.ollamaManager;
      const ollamaStatus = ollamaManager ? await ollamaManager.getStatus() : null;

      const adapters = adapterManager.listAdapters().map(reg => ({
        name: reg.info.name,
        version: reg.info.version,
        capabilities: reg.info.capabilities,
      }));

      res.json({
        nodes: [{
          id: 'local-node',
          shareKey: localNodeShareKey,
          available: true,
          workspaceIds: [],
          workspaceNames: ['Local'],
          isOwner: true,
          isUnclaimed: false,
          capabilities: {
            cpu: {
              model: 'Local CPU',
              cores: os.cpus().length,
              threads: os.cpus().length,
            },
            memory: {
              total_mb: Math.round(os.totalmem() / 1024 / 1024),
              available_mb: Math.round(os.freemem() / 1024 / 1024),
            },
            gpus: [],
            storage: {
              total_gb: 500,
              available_gb: 100,
            },
            ollama: ollamaStatus?.running ? {
              installed: true,
              models: ollamaStatus.models || [],
              endpoint: ollamaStatus.endpoint || 'http://localhost:11434',
            } : undefined,
            mcp_adapters: adapters,
          },
        }],
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Assign node to workspaces
  app.post('/api/v1/nodes/:nodeId/workspaces', localAuth, (req: Request, res: Response) => {
    const nodeId = req.params.nodeId as string;
    const { workspaceIds } = req.body;
    const assignedWorkspaces = (workspaceIds || []).map((id: string) => ({ id, name: 'Workspace' }));
    res.json({
      success: true,
      nodeId,
      workspaces: assignedWorkspaces,
      message: 'Node assignment acknowledged (local mode)',
    });
  });

  // Nodes Endpoint (compatibility)
  app.get('/api/v1/nodes', localAuth, (req: Request, res: Response) => {
    res.json({
      nodes: [{
        id: 'local',
        name: 'Local Node',
        status: 'online',
        ollama: deps.managers.ollamaManager ? 'available' : 'unavailable',
        sandbox: deps.managers.sandboxManager ? 'available' : 'unavailable',
      }],
    });
  });
}
