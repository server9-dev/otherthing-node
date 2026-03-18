/**
 * Flow Routes - flow CRUD
 * Persisted to Appwrite (shared across members), in-memory cache for speed.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';
import { appwriteService } from '../services/appwrite-service';

const flowsStore: Map<string, any[]> = new Map();
const loadedWorkspaces: Set<string> = new Set();

async function loadFromAppwrite(workspaceId: string): Promise<void> {
  if (loadedWorkspaces.has(workspaceId) || !appwriteService.isInitialized()) return;
  try {
    const result = await appwriteService.listWorkspaceFlows(workspaceId);
    const flows = result.documents.map((d: any) => ({
      id: d.$id,
      name: d.name,
      description: d.description || '',
      definition: d.flow ? JSON.parse(d.flow) : { nodes: [], connections: [] },
      type: d.type || 'flow',
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      _appwriteId: d.$id,
    }));
    flowsStore.set(workspaceId, flows);
    loadedWorkspaces.add(workspaceId);
  } catch (err) {
    console.warn('[Flows] Appwrite load failed:', err);
  }
}

export function registerFlowRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.get('/api/v1/workspaces/:id/flows', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadFromAppwrite(workspaceId);
    const flows = flowsStore.get(workspaceId) || [];
    res.json({ flows });
  });

  app.post('/api/v1/workspaces/:id/flows', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    await loadFromAppwrite(workspaceId);

    const flow: any = {
      id: uuidv4(),
      name: req.body.name || 'Untitled Flow',
      description: req.body.description || '',
      definition: req.body.definition || req.body.flow || { nodes: [], connections: [] },
      type: req.body.type || 'flow',
      createdBy: session.username,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (!flowsStore.has(workspaceId)) flowsStore.set(workspaceId, []);
    flowsStore.get(workspaceId)!.push(flow);

    if (appwriteService.isInitialized()) {
      appwriteService.createWorkspaceFlow(workspaceId, {
        name: flow.name,
        description: flow.description,
        flow: JSON.stringify(flow.definition),
        createdBy: flow.createdBy,
      }).then(doc => {
        flow._appwriteId = doc.$id;
        flow.id = doc.$id;
      }).catch(err => console.warn('[Flows] Appwrite write failed:', err));
    }

    res.status(201).json({ flow });
  });

  app.delete('/api/v1/workspaces/:id/flows/:flowId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const flowId = req.params.flowId as string;
    await loadFromAppwrite(workspaceId);

    const flows = flowsStore.get(workspaceId) || [];
    const flowIndex = flows.findIndex(f => f.id === flowId || f._appwriteId === flowId);
    if (flowIndex === -1) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }

    const awId = flows[flowIndex]._appwriteId || flowId;
    flows.splice(flowIndex, 1);

    if (appwriteService.isInitialized()) {
      appwriteService.deleteWorkspaceFlow(awId)
        .catch(err => console.warn('[Flows] Appwrite delete failed:', err));
    }

    res.json({ success: true });
  });
}
