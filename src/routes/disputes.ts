/**
 * Dispute Routes — AI dispute analysis for milestone tasks
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { disputeService } from '../services/dispute-service';

export function registerDisputeRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Analyze a disputed milestone
  app.post('/api/v1/milestone-tasks/:taskId/milestones/:index/analyze-dispute', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const milestoneIndex = parseInt(req.params.index as string);
    const {
      workspaceId, milestoneDescription, milestoneAmount,
      workCid, taskDescription, chatExcerpts, codeEvidence,
    } = req.body;

    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId is required' });
      return;
    }

    const analysis = await disputeService.analyzeDispute(taskId, milestoneIndex, workspaceId, {
      milestoneDescription: milestoneDescription || '',
      milestoneAmount: milestoneAmount || '0',
      workCid: workCid || '',
      taskDescription: taskDescription || '',
      chatExcerpts,
      codeEvidence,
    });

    if (analysis) {
      res.json({ analysis });
    } else {
      res.status(503).json({ error: 'Dispute analysis failed — Ollama may not be running' });
    }
  });

  // Get existing dispute analysis
  app.get('/api/v1/milestone-tasks/:taskId/milestones/:index/dispute-analysis', localAuth, (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const milestoneIndex = parseInt(req.params.index as string);

    const analysis = disputeService.getAnalysis(taskId, milestoneIndex);

    if (analysis) {
      res.json({ analysis });
    } else {
      res.json({ analysis: null, message: 'No analysis available' });
    }
  });
}
