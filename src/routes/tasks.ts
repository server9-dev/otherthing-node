/**
 * Task Routes - task CRUD
 * Persisted to Appwrite (shared across members), in-memory cache for speed.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';
import { appwriteService } from '../services/appwrite-service';

// In-memory cache (populated from Appwrite on first read)
const tasksStore: Map<string, any[]> = new Map();
const loadedWorkspaces: Set<string> = new Set();

async function loadFromAppwrite(workspaceId: string): Promise<void> {
  if (loadedWorkspaces.has(workspaceId)) return;
  if (!appwriteService.isInitialized()) return;

  try {
    const result = await appwriteService.listWorkspaceBoardTasks(workspaceId);
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
      _appwriteId: d.$id,
    }));
    tasksStore.set(workspaceId, tasks);
    loadedWorkspaces.add(workspaceId);
  } catch (err) {
    console.warn('[Tasks] Appwrite load failed, using local:', err);
  }
}

export function registerTaskRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.get('/api/v1/workspaces/:id/tasks', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadFromAppwrite(workspaceId);
    const tasks = tasksStore.get(workspaceId) || [];
    res.json({ tasks });
  });

  app.post('/api/v1/workspaces/:id/tasks', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadFromAppwrite(workspaceId);

    const milestones = req.body.milestones || [];
    const bounty = req.body.bounty || (milestones.length > 0
      ? milestones.reduce((sum: number, m: any) => sum + (parseFloat(m.amount) || 0), 0).toString()
      : undefined);

    const task: any = {
      id: req.body.id || uuidv4(),
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

    // Persist to Appwrite
    if (appwriteService.isInitialized()) {
      appwriteService.createWorkspaceTask({
        workspaceId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee: task.assignee,
        bounty: task.bounty,
        deadline: task.deadline,
      }).then(doc => {
        task._appwriteId = doc.$id;
        task.id = doc.$id;
      }).catch(err => console.warn('[Tasks] Appwrite write failed:', err));
    }

    res.status(201).json({ task });
  });

  app.patch('/api/v1/workspaces/:id/tasks/:taskId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const taskId = req.params.taskId as string;
    await loadFromAppwrite(workspaceId);

    const tasks = tasksStore.get(workspaceId) || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId || t._appwriteId === taskId);
    if (taskIndex === -1) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    tasks[taskIndex] = { ...tasks[taskIndex], ...req.body, updatedAt: new Date().toISOString() };

    // Sync to Appwrite
    const awId = tasks[taskIndex]._appwriteId || taskId;
    if (appwriteService.isInitialized()) {
      appwriteService.updateWorkspaceTask(awId, req.body)
        .catch(err => console.warn('[Tasks] Appwrite update failed:', err));
    }

    res.json({ task: tasks[taskIndex] });
  });

  app.delete('/api/v1/workspaces/:id/tasks/:taskId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const taskId = req.params.taskId as string;
    await loadFromAppwrite(workspaceId);

    const tasks = tasksStore.get(workspaceId) || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId || t._appwriteId === taskId);
    if (taskIndex === -1) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const awId = tasks[taskIndex]._appwriteId || taskId;
    tasks.splice(taskIndex, 1);

    // Delete from Appwrite
    if (appwriteService.isInitialized()) {
      appwriteService.deleteWorkspaceTask(awId)
        .catch(err => console.warn('[Tasks] Appwrite delete failed:', err));
    }

    res.json({ success: true });
  });
}
