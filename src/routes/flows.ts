/**
 * Flow Routes - flow CRUD
 * Persisted to Supabase (shared across members), in-memory cache for speed.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';
import { supabaseService } from '../services/supabase-service';

const flowsStore: Map<string, any[]> = new Map();
const loadedWorkspaces: Set<string> = new Set();

async function loadFromDb(workspaceId: string): Promise<void> {
  if (loadedWorkspaces.has(workspaceId) || !supabaseService.isInitialized()) return;
  try {
    const result = await supabaseService.listWorkspaceFlows(workspaceId);
    const flows = result.documents.map((d: any) => ({
      id: d.$id,
      name: d.name,
      description: d.description || '',
      definition: d.flow || { nodes: [], connections: [] },
      type: 'flow',
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
    flowsStore.set(workspaceId, flows);
    loadedWorkspaces.add(workspaceId);
  } catch (err) {
    console.warn('[Flows] DB load failed:', err);
  }
}

export function registerFlowRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.get('/api/v1/workspaces/:id/flows', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadFromDb(workspaceId);
    const flows = flowsStore.get(workspaceId) || [];
    res.json({ flows });
  });

  app.post('/api/v1/workspaces/:id/flows', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    await loadFromDb(workspaceId);

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

    // Same id locally and in the DB, so clients can act on it immediately.
    if (supabaseService.isInitialized()) {
      supabaseService.createWorkspaceFlow(workspaceId, {
        id: flow.id,
        name: flow.name,
        description: flow.description,
        flow: flow.definition,
      }).catch(err => console.warn('[Flows] DB write failed:', err));
    }

    res.status(201).json({ flow });
  });

  app.delete('/api/v1/workspaces/:id/flows/:flowId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const flowId = req.params.flowId as string;
    await loadFromDb(workspaceId);

    const flows = flowsStore.get(workspaceId) || [];
    const flowIndex = flows.findIndex(f => f.id === flowId);
    if (flowIndex === -1) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }

    flows.splice(flowIndex, 1);

    if (supabaseService.isInitialized()) {
      supabaseService.deleteWorkspaceFlow(flowId)
        .catch(err => console.warn('[Flows] DB delete failed:', err));
    }

    res.json({ success: true });
  });
}
