/**
 * Premium & Remote Inference Routes
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';
import { premiumService } from '../services/premium-service';
import { remoteInferenceService } from '../services/remote-inference';

export function registerPremiumRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Check premium status for a wallet
  app.get('/api/v1/premium/status', localAuth, (req: Request, res: Response) => {
    const wallet = req.query.wallet as string || '';
    const status = premiumService.isPremium(wallet);
    res.json(status);
  });

  // Activate premium (in production: called by chain sync on OTT payment)
  app.post('/api/v1/premium/activate', localAuth, (req: Request, res: Response) => {
    const { wallet, days } = req.body;
    if (!wallet) {
      res.status(400).json({ error: 'wallet address required' });
      return;
    }
    const status = premiumService.activate(wallet, days || 30);
    res.json(status);
  });

  // Deactivate premium
  app.post('/api/v1/premium/deactivate', localAuth, (req: Request, res: Response) => {
    const { wallet } = req.body;
    if (!wallet) {
      res.status(400).json({ error: 'wallet address required' });
      return;
    }
    premiumService.deactivate(wallet);
    res.json({ success: true });
  });

  // List active subscriptions (admin)
  app.get('/api/v1/premium/subscriptions', localAuth, (req: Request, res: Response) => {
    const subs = premiumService.getActiveSubscriptions();
    res.json({ subscriptions: subs });
  });

  // Remote inference health check
  app.get('/api/v1/inference/remote/status', localAuth, async (req: Request, res: Response) => {
    const configured = remoteInferenceService.isConfigured();
    if (!configured) {
      res.json({ configured: false, healthy: false, endpoint: null, models: [] });
      return;
    }
    const healthy = await remoteInferenceService.checkHealth();
    const models = healthy ? await remoteInferenceService.getModels() : [];
    res.json({
      configured: true,
      healthy,
      endpoint: remoteInferenceService.getEndpoint(),
      models,
    });
  });

  // Configure remote inference (admin/setup)
  app.post('/api/v1/inference/remote/configure', localAuth, (req: Request, res: Response) => {
    const { apiKey, model, dailyLimit } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: 'apiKey required' });
      return;
    }
    remoteInferenceService.configure({ apiKey, model, dailyLimit });
    res.json({ success: true });
  });
}
