/**
 * IP Routes - register IP, get IP, list license types
 */

import { Request, Response } from 'express';
import { web3Service, LicenseType } from '../services/web3-service';
import { appwriteService } from '../services/appwrite-service';
import type { RouteDependencies } from './types';

const LICENSE_TYPES = [
  { value: LicenseType.MIT, name: 'MIT', description: 'MIT License - permissive' },
  { value: LicenseType.Apache2, name: 'Apache-2.0', description: 'Apache License 2.0' },
  { value: LicenseType.Proprietary, name: 'Proprietary', description: 'Proprietary/All Rights Reserved' },
  { value: LicenseType.WorkForHire, name: 'Work for Hire', description: 'Work for hire - IP belongs to requester' },
  { value: LicenseType.Custom, name: 'Custom', description: 'Custom license terms (see licenseCid)' },
];

export function registerIPRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // List available license types
  app.get('/api/v1/ip/license-types', (req: Request, res: Response) => {
    res.json({ licenseTypes: LICENSE_TYPES });
  });

  // Register IP for a task
  app.post('/api/v1/workspaces/:id/ip', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { taskId, licenseType, licenseCid } = req.body;

    if (!taskId || licenseType === undefined) {
      res.status(400).json({ error: 'taskId and licenseType are required' });
      return;
    }

    try {
      const registrationId = await web3Service.registerIP(
        workspaceId,
        taskId,
        licenseType as LicenseType,
        licenseCid || ''
      );

      // Mirror to Appwrite
      if (appwriteService.isInitialized()) {
        try {
          const licenseTypeName = LICENSE_TYPES.find(l => l.value === licenseType)?.name || 'Custom';
          await appwriteService.registerIP({
            workspaceId,
            taskId,
            creatorAddress: web3Service.address || '',
            licenseType: licenseTypeName,
            licenseCid,
          });
        } catch (err) {
          console.warn('[IP] Appwrite mirror failed:', err);
        }
      }

      res.status(201).json({ success: true, registrationId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to register IP', details: String(err) });
    }
  });

  // Get IP registration for a task
  app.get('/api/v1/ip/task/:taskId', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;

    try {
      // Try Appwrite first
      if (appwriteService.isInitialized()) {
        const ip = await appwriteService.getIPForTask(taskId);
        if (ip) {
          res.json({ ip });
          return;
        }
      }

      // Fallback to on-chain
      const ip = await web3Service.getIPForTask(taskId);
      res.json({ ip });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get IP registration', details: String(err) });
    }
  });

  // Check if IP is registered for a task
  app.get('/api/v1/ip/task/:taskId/check', localAuth, async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;

    try {
      const hasIP = await web3Service.hasIPRegistered(taskId);
      res.json({ hasIP, taskId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to check IP', details: String(err) });
    }
  });

  // List IP registrations for a workspace
  app.get('/api/v1/workspaces/:id/ip', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;

    try {
      if (appwriteService.isInitialized()) {
        const result = await appwriteService.listWorkspaceIP(workspaceId);
        res.json({ registrations: result.documents });
        return;
      }
      res.json({ registrations: [] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list IP registrations', details: String(err) });
    }
  });
}
