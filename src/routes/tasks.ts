/**
 * Task Routes - task CRUD
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { RouteDependencies } from './types';

// Tasks storage (in-memory)
const tasksStore: Map<string, any[]> = new Map();

export function registerTaskRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.get('/api/v1/workspaces/:id/tasks', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const tasks = tasksStore.get(workspaceId) || [];
    res.json({ tasks });
  });

  app.post('/api/v1/workspaces/:id/tasks', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const milestones = req.body.milestones || [];
    const bounty = req.body.bounty || (milestones.length > 0
      ? milestones.reduce((sum: number, m: any) => sum + (parseFloat(m.amount) || 0), 0).toString()
      : undefined);
    const task = {
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
    res.status(201).json({ task });
  });

  app.patch('/api/v1/workspaces/:id/tasks/:taskId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const taskId = req.params.taskId as string;
    const tasks = tasksStore.get(workspaceId) || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    tasks[taskIndex] = { ...tasks[taskIndex], ...req.body, updatedAt: new Date().toISOString() };
    res.json({ task: tasks[taskIndex] });
  });

  app.delete('/api/v1/workspaces/:id/tasks/:taskId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const taskId = req.params.taskId as string;
    const tasks = tasksStore.get(workspaceId) || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    tasks.splice(taskIndex, 1);
    res.json({ success: true });
  });
}
