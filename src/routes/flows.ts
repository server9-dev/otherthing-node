/**
 * Flow Routes - flow CRUD
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';

// Flows storage (in-memory)
const flowsStore: Map<string, any[]> = new Map();

export function registerFlowRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.get('/api/v1/workspaces/:id/flows', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const flows = flowsStore.get(workspaceId) || [];
    res.json({ flows });
  });

  app.post('/api/v1/workspaces/:id/flows', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const flow = {
      id: uuidv4(),
      name: req.body.name || 'Untitled Flow',
      description: req.body.description || '',
      flow: req.body.flow || { nodes: [], connections: [] },
      createdBy: session.username,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!flowsStore.has(workspaceId)) {
      flowsStore.set(workspaceId, []);
    }
    flowsStore.get(workspaceId)!.push(flow);
    res.status(201).json({ flow });
  });

  app.delete('/api/v1/workspaces/:id/flows/:flowId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const flowId = req.params.flowId as string;
    const flows = flowsStore.get(workspaceId) || [];
    const flowIndex = flows.findIndex(f => f.id === flowId);
    if (flowIndex === -1) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }
    flows.splice(flowIndex, 1);
    res.json({ success: true });
  });
}
