/**
 * Workspace Routes - CRUD, join, leave, delete
 *
 * Workspaces and membership live in Supabase (see services/workspace-directory.ts).
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { WorkspaceDirectory } from '../services/workspace-directory';

export function registerWorkspaceRoutes(deps: RouteDependencies): void {
  const { app, localAuth, workspaceManager } = deps;
  const directory = new WorkspaceDirectory(workspaceManager);

  const handle = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    };

  app.get('/api/v1/workspaces', localAuth, handle(async (req, res) => {
    const session = (req as any).session;
    const workspaces = await directory.listMine(session.userId);
    res.json({ workspaces });
  }));

  app.post('/api/v1/workspaces', localAuth, handle(async (req, res) => {
    const session = (req as any).session;
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    const workspace = await directory.create(session.userId, name, description || '');
    res.status(201).json(workspace);
  }));

  // Join workspace by invite code (must be before :id routes)
  app.post('/api/v1/workspaces/join', localAuth, handle(async (req, res) => {
    const inviteCode = req.body?.inviteCode;
    if (!inviteCode) {
      res.status(400).json({ error: 'Invite code is required' });
      return;
    }
    const workspace = await directory.join(inviteCode);
    res.json({ success: true, workspace });
  }));

  app.get('/api/v1/workspaces/:id', localAuth, handle(async (req, res) => {
    const workspace = await directory.get(req.params.id as string);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json({ workspace });
  }));

  app.delete('/api/v1/workspaces/:id', localAuth, handle(async (req, res) => {
    await directory.remove(req.params.id as string);
    res.json({ success: true });
  }));

  // Leave workspace
  app.post('/api/v1/workspaces/:id/leave', localAuth, handle(async (req, res) => {
    const session = (req as any).session;
    await directory.leave(req.params.id as string, session.userId);
    res.json({ success: true });
  }));

  app.post('/api/v1/workspaces/:id/invite-code', localAuth, handle(async (req, res) => {
    const inviteCode = await directory.regenerateInviteCode(req.params.id as string);
    res.json({ success: true, inviteCode });
  }));
}
