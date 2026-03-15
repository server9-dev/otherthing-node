/**
 * Workspace Routes - CRUD, join, leave, delete
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';

export function registerWorkspaceRoutes(deps: RouteDependencies): void {
  const { app, localAuth, workspaceManager } = deps;

  app.get('/api/v1/workspaces', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const workspaces = workspaceManager.getUserWorkspaces(session.userId);
    res.json({ workspaces });
  });

  app.post('/api/v1/workspaces', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    const workspace = workspaceManager.createWorkspace(
      name,
      description || '',
      session.userId,
      session.username,
      true
    );
    res.status(201).json(workspace);
  });

  // Join workspace by invite code (must be before :id routes)
  app.post('/api/v1/workspaces/join', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const inviteCode = req.body?.inviteCode;

    if (!inviteCode) {
      res.status(400).json({ error: 'Invite code is required' });
      return;
    }

    const result = workspaceManager.joinWorkspace(
      inviteCode.trim(),
      session.userId,
      session.username
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, workspace: result.workspace });
  });

  app.get('/api/v1/workspaces/:id', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json({ workspace });
  });

  app.delete('/api/v1/workspaces/:id', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const workspaceId = req.params.id as string;
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (workspace.ownerId !== session.userId) {
      res.status(403).json({ error: 'Only owner can delete workspace' });
      return;
    }
    workspaceManager.deleteWorkspace(workspaceId, session.userId);
    res.json({ success: true });
  });

  // Leave workspace
  app.post('/api/v1/workspaces/:id/leave', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const workspaceId = req.params.id as string;

    const result = workspaceManager.leaveWorkspace(workspaceId, session.userId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true });
  });
}
