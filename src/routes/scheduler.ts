/**
 * Scheduler Routes — view and trigger scheduled jobs
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { schedulerService } from '../services/scheduler-service';

export function registerSchedulerRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // List all scheduled jobs
  app.get('/api/v1/scheduler/jobs', localAuth, (req: Request, res: Response) => {
    const jobs = schedulerService.getJobs();
    res.json({ jobs });
  });

  // Manually trigger a job
  app.post('/api/v1/scheduler/jobs/:name/trigger', localAuth, async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const success = await schedulerService.trigger(name);

    if (success) {
      res.json({ success: true, message: `Job "${name}" triggered` });
    } else {
      res.status(404).json({ error: `Job "${name}" not found or already running` });
    }
  });
}
