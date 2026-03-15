/**
 * Milestone Routes - full milestone task lifecycle endpoints
 */

import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { web3Service } from '../services/web3-service';
import { appwriteService } from '../services/appwrite-service';
import type { RouteDependencies } from './types';

export function registerMilestoneRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Create milestone task
  app.post('/api/v1/workspaces/:id/milestone-tasks', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { descriptionCid, deadline, milestones } = req.body;

    if (!descriptionCid || !deadline || !milestones || !Array.isArray(milestones)) {
      res.status(400).json({ error: 'descriptionCid, deadline, and milestones array are required' });
      return;
    }

    try {
      const milestoneDescriptions = milestones.map((m: any) => m.description);
      const milestoneAmounts = milestones.map((m: any) => ethers.parseEther(String(m.amount)));
      const deadlineTs = Math.floor(new Date(deadline).getTime() / 1000);

      const taskId = await web3Service.createMilestoneTask(
        workspaceId,
        descriptionCid,
        deadlineTs,
        milestoneDescriptions,
        milestoneAmounts
      );

      // Mirror to Appwrite
      if (appwriteService.isInitialized()) {
        try {
          await appwriteService.createTask({
            taskId,
            workspaceId,
            title: `Milestone Task`,
            description: descriptionCid,
            milestones,
            status: 'created',
            createdBy: web3Service.address || '',
          });
        } catch (err) {
          console.warn('[Milestones] Appwrite mirror failed:', err);
        }
      }

      res.status(201).json({ success: true, taskId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create milestone task', details: String(err) });
    }
  });

  // Assign worker to task
  app.post('/api/v1/milestone-tasks/:taskId/assign', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const { workerAddress, nodeId } = req.body;

    if (!workerAddress || !nodeId) {
      res.status(400).json({ error: 'workerAddress and nodeId are required' });
      return;
    }

    try {
      const tx = await web3Service.assignMilestoneWorker(taskId, workerAddress, nodeId);
      const receipt = await tx.wait();

      // Update Appwrite mirror
      if (appwriteService.isInitialized()) {
        try {
          const existing = await appwriteService.getTaskByChainId(taskId);
          if (existing) {
            await appwriteService.updateTask(existing.$id, {
              assigneeAddress: workerAddress,
              status: 'assigned',
            });
          }
        } catch (err) {
          console.warn('[Milestones] Appwrite mirror failed:', err);
        }
      }

      res.json({ success: true, txHash: receipt?.hash });
    } catch (err) {
      res.status(500).json({ error: 'Failed to assign worker', details: String(err) });
    }
  });

  // Submit milestone work
  app.post('/api/v1/milestone-tasks/:taskId/milestones/:index/submit', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const milestoneIndex = parseInt(req.params.index as string);
    const { workCid } = req.body;

    if (!workCid) {
      res.status(400).json({ error: 'workCid is required' });
      return;
    }

    try {
      const tx = await web3Service.submitMilestone(taskId, milestoneIndex, workCid);
      const receipt = await tx.wait();
      res.json({ success: true, txHash: receipt?.hash });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit milestone', details: String(err) });
    }
  });

  // Approve milestone
  app.post('/api/v1/milestone-tasks/:taskId/milestones/:index/approve', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const milestoneIndex = parseInt(req.params.index as string);

    try {
      const tx = await web3Service.approveMilestoneEscrow(taskId, milestoneIndex);
      const receipt = await tx.wait();
      res.json({ success: true, txHash: receipt?.hash });
    } catch (err) {
      res.status(500).json({ error: 'Failed to approve milestone', details: String(err) });
    }
  });

  // Release milestone payment
  app.post('/api/v1/milestone-tasks/:taskId/milestones/:index/release', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const milestoneIndex = parseInt(req.params.index as string);

    try {
      const tx = await web3Service.releaseMilestonePayment(taskId, milestoneIndex);
      const receipt = await tx.wait();
      res.json({ success: true, txHash: receipt?.hash });
    } catch (err) {
      res.status(500).json({ error: 'Failed to release payment', details: String(err) });
    }
  });

  // Dispute milestone
  app.post('/api/v1/milestone-tasks/:taskId/milestones/:index/dispute', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const milestoneIndex = parseInt(req.params.index as string);

    try {
      const tx = await web3Service.disputeMilestone(taskId, milestoneIndex);
      const receipt = await tx.wait();
      res.json({ success: true, txHash: receipt?.hash });
    } catch (err) {
      res.status(500).json({ error: 'Failed to dispute milestone', details: String(err) });
    }
  });

  // Cancel task
  app.post('/api/v1/milestone-tasks/:taskId/cancel', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;

    try {
      const tx = await web3Service.cancelMilestoneTask(taskId);
      const receipt = await tx.wait();

      // Update Appwrite mirror
      if (appwriteService.isInitialized()) {
        try {
          const existing = await appwriteService.getTaskByChainId(taskId);
          if (existing) {
            await appwriteService.updateTask(existing.$id, { status: 'cancelled' });
          }
        } catch (err) {
          console.warn('[Milestones] Appwrite mirror failed:', err);
        }
      }

      res.json({ success: true, txHash: receipt?.hash });
    } catch (err) {
      res.status(500).json({ error: 'Failed to cancel task', details: String(err) });
    }
  });

  // Get task details
  app.get('/api/v1/milestone-tasks/:taskId', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;

    try {
      const task = await web3Service.getMilestoneTask(taskId);
      const milestones = await web3Service.getMilestones(taskId);
      res.json({ task, milestones });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get task', details: String(err) });
    }
  });

  // List workspace milestone tasks (from Appwrite)
  app.get('/api/v1/workspaces/:id/milestone-tasks', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;

    try {
      if (appwriteService.isInitialized()) {
        const result = await appwriteService.listWorkspaceTasks(workspaceId);
        res.json({ tasks: result.documents });
        return;
      }
      res.json({ tasks: [] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list tasks', details: String(err) });
    }
  });
}
