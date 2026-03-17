/**
 * Safety, Flag & Ban Routes — content moderation API
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { safetyService } from '../services/safety-service';
import { auditService } from '../services/audit-service';
import { banService } from '../services/ban-service';
import { flagService } from '../services/flag-service';

export function registerSafetyRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // ── Content Scanning ──

  // Scan text content on demand
  app.post('/api/v1/safety/scan-text', localAuth, async (req: Request, res: Response) => {
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const result = await safetyService.scanText(text);
    res.json({ result });
  });

  // Scan image description on demand
  app.post('/api/v1/safety/scan-image', localAuth, async (req: Request, res: Response) => {
    const { description } = req.body;
    if (!description) { res.status(400).json({ error: 'description required' }); return; }
    const result = await safetyService.scanImageDescription(description);
    res.json({ result });
  });

  // ── Audit Log ──

  app.get('/api/v1/safety/audit', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.query.workspaceId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const entries = auditService.getLog(workspaceId, limit);
    res.json({ entries });
  });

  app.get('/api/v1/safety/audit/violations', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.query.workspaceId as string | undefined;
    const violations = auditService.getViolations(workspaceId);
    res.json({ violations });
  });

  app.get('/api/v1/safety/audit/stats', localAuth, (req: Request, res: Response) => {
    const stats = auditService.getStats();
    res.json({ stats });
  });

  app.get('/api/v1/safety/audit/user/:userId', localAuth, (req: Request, res: Response) => {
    const score = auditService.getUserScore(req.params.userId as string);
    res.json({ score: score || { userId: req.params.userId, totalScanned: 0, violations: 0, warnings: 0, lastViolation: null, categories: {} } });
  });

  // ── Flags ──

  app.post('/api/v1/workspaces/:id/flags', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const { contentType, contentId, category, description } = req.body;

    if (!contentType || !contentId || !category) {
      res.status(400).json({ error: 'contentType, contentId, and category are required' });
      return;
    }

    const flag = flagService.create({
      workspaceId,
      reporterId: session.userId,
      contentType,
      contentId,
      category,
      description: description || '',
    });
    res.status(201).json({ flag });
  });

  app.get('/api/v1/workspaces/:id/flags', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const status = req.query.status as string;
    const flags = status === 'pending'
      ? flagService.getPending(workspaceId)
      : flagService.getAll(workspaceId);
    res.json({ flags });
  });

  app.post('/api/v1/flags/:flagId/review', localAuth, (req: Request, res: Response) => {
    const { action, actionTaken } = req.body;
    if (!action || !['actioned', 'dismissed'].includes(action)) {
      res.status(400).json({ error: 'action must be "actioned" or "dismissed"' });
      return;
    }
    const flag = flagService.review(req.params.flagId as string, action, actionTaken);
    if (flag) {
      res.json({ flag });
    } else {
      res.status(404).json({ error: 'Flag not found' });
    }
  });

  app.get('/api/v1/workspaces/:id/flags/stats', localAuth, (req: Request, res: Response) => {
    const stats = flagService.getStats(req.params.id as string);
    res.json({ stats });
  });

  // ── Bans ──

  app.get('/api/v1/bans/check/:userId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.query.workspaceId as string | undefined;
    const result = banService.isBanned(req.params.userId as string, workspaceId);
    res.json(result);
  });

  app.get('/api/v1/bans/user/:userId', localAuth, (req: Request, res: Response) => {
    const bans = banService.getUserBans(req.params.userId as string);
    res.json({ bans });
  });

  app.get('/api/v1/workspaces/:id/bans', localAuth, (req: Request, res: Response) => {
    const bans = banService.getActiveBans(req.params.id as string);
    res.json({ bans });
  });

  app.post('/api/v1/bans', localAuth, (req: Request, res: Response) => {
    const { userId, workspaceId, type, reason, category } = req.body;
    if (!userId || !type || !reason) {
      res.status(400).json({ error: 'userId, type, and reason are required' });
      return;
    }
    const ban = banService.issueBan(userId, workspaceId || null, type, reason, category);
    res.status(201).json({ ban });
  });

  app.delete('/api/v1/bans/:banId', localAuth, (req: Request, res: Response) => {
    const success = banService.revokeBan(req.params.banId as string);
    res.json({ success });
  });
}
