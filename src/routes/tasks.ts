/**
 * Task Routes - task CRUD
 * Persisted to Supabase (shared across members), in-memory cache for speed.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';
import { supabaseService } from '../services/supabase-service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In-memory cache (populated from Supabase on first read)
const tasksStore: Map<string, any[]> = new Map();
const loadedWorkspaces: Set<string> = new Set();

async function loadFromDb(workspaceId: string): Promise<void> {
  if (loadedWorkspaces.has(workspaceId)) return;
  if (!supabaseService.isInitialized()) return;

  try {
    const result = await supabaseService.listWorkspaceBoardTasks(workspaceId);
    const tasks = result.documents.map((d: any) => ({
      id: d.$id,
      title: d.title,
      description: d.description || '',
      status: d.status || 'todo',
      priority: d.priority || 'medium',
      bounty: d.bounty,
      deadline: d.deadline,
      assignee: d.assignee,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
    tasksStore.set(workspaceId, tasks);
    loadedWorkspaces.add(workspaceId);
  } catch (err) {
    console.warn('[Tasks] DB load failed, using local:', err);
  }
}

export function registerTaskRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.get('/api/v1/workspaces/:id/tasks', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadFromDb(workspaceId);
    const tasks = tasksStore.get(workspaceId) || [];
    res.json({ tasks });
  });

  app.post('/api/v1/workspaces/:id/tasks', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadFromDb(workspaceId);

    const milestones = req.body.milestones || [];
    const bounty = req.body.bounty || (milestones.length > 0
      ? milestones.reduce((sum: number, m: any) => sum + (parseFloat(m.amount) || 0), 0).toString()
      : undefined);

    const task: any = {
      // DB ids are uuids; keep a client-supplied id only if it is one.
      id: UUID_RE.test(req.body.id || '') ? req.body.id : uuidv4(),
      title: req.body.title || '',
      description: req.body.description || '',
      status: req.body.status || 'todo',
      priority: req.body.priority || 'medium',
      milestones: milestones.length > 0 ? milestones : undefined,
      bounty,
      deadline: req.body.deadline || undefined,
      assignee: req.body.assignee || undefined,
      createdAt: req.body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (!tasksStore.has(workspaceId)) {
      tasksStore.set(workspaceId, []);
    }
    tasksStore.get(workspaceId)!.push(task);

    // Persist to Supabase under the same id
    if (supabaseService.isInitialized()) {
      supabaseService.createWorkspaceTask({
        id: task.id,
        workspaceId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee: task.assignee,
        bounty: task.bounty,
        deadline: task.deadline,
      }).catch(err => console.warn('[Tasks] DB write failed:', err));
    }

    res.status(201).json({ task });
  });

  app.patch('/api/v1/workspaces/:id/tasks/:taskId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const taskId = req.params.taskId as string;
    await loadFromDb(workspaceId);

    const tasks = tasksStore.get(workspaceId) || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    tasks[taskIndex] = { ...tasks[taskIndex], ...req.body, updatedAt: new Date().toISOString() };

    // Sync to Supabase (service whitelists the writable columns)
    if (supabaseService.isInitialized()) {
      supabaseService.updateWorkspaceTask(taskId, req.body)
        .catch(err => console.warn('[Tasks] DB update failed:', err));
    }

    res.json({ task: tasks[taskIndex] });
  });

  app.delete('/api/v1/workspaces/:id/tasks/:taskId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const taskId = req.params.taskId as string;
    await loadFromDb(workspaceId);

    const tasks = tasksStore.get(workspaceId) || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    tasks.splice(taskIndex, 1);

    if (supabaseService.isInitialized()) {
      supabaseService.deleteWorkspaceTask(taskId)
        .catch(err => console.warn('[Tasks] DB delete failed:', err));
    }

    res.json({ success: true });
  });
}
