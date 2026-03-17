/**
 * Health Report Routes
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { healthReportService } from '../services/health-report-service';

export function registerHealthReportRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.post('/api/v1/workspaces/:id/health-report/generate', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    try {
      const report = await healthReportService.generateReport(workspaceId);
      if (report) {
        res.json({ report });
      } else {
        res.status(503).json({ error: 'Health report generation failed — Ollama may not be running' });
      }
    } catch (err: any) {
      res.status(503).json({ error: err.message || 'Health report generation failed' });
    }
  });

  app.get('/api/v1/workspaces/:id/health-report/latest', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const report = healthReportService.getLatest(workspaceId);
    res.json({ report: report || null });
  });

  app.get('/api/v1/workspaces/:id/health-report/history', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const history = healthReportService.getHistory(workspaceId);
    res.json({ reports: history });
  });
}
