/**
 * Auth Routes - Supabase session handoff between the renderer and the node.
 *
 * The renderer signs in directly against Supabase Auth (email + password).
 * These routes let it bootstrap its client, hand its session to the node's
 * background workers, and sign the node out again.
 */

import { Request, Response } from 'express';
import {
  requireUser,
  nodeSession,
  getSupabaseConfig,
  verifyAccessToken,
} from '../services/supabase-client';
import type { RouteDependencies } from './types';

export function registerAuthRoutes(deps: RouteDependencies): void {
  const { app } = deps;

  // Public: the publishable key is safe to expose by design.
  app.get('/api/v1/auth/config', (_req: Request, res: Response) => {
    const { url, publishableKey } = getSupabaseConfig();
    // The node may reach Supabase on a private address (SUPABASE_URL); browsers
    // of a web-mode node need the public one.
    res.json({ url: process.env.SUPABASE_PUBLIC_URL || url, publishableKey });
  });

  // Hand the signed-in renderer session to the node's background workers.
  app.post('/api/v1/auth/session', requireUser, async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { access_token, refresh_token } = req.body || {};
    if (typeof access_token !== 'string' || typeof refresh_token !== 'string' || !access_token || !refresh_token) {
      res.status(400).json({ error: 'access_token and refresh_token required' });
      return;
    }

    // The session being handed over must belong to the caller.
    if (access_token !== session.token) {
      const owner = await verifyAccessToken(access_token).catch(() => null);
      if (!owner || owner.id !== session.userId) {
        res.status(403).json({ error: 'Session does not belong to the signed-in user' });
        return;
      }
    }

    try {
      const user = await nodeSession.setSession(access_token, refresh_token);
      if (user.id !== session.userId) {
        await nodeSession.signOut();
        res.status(403).json({ error: 'Session does not belong to the signed-in user' });
        return;
      }
      res.json({ success: true, userId: user.id });
    } catch (err: any) {
      console.error('[Auth] Failed to adopt node session:', err?.message || err);
      res.status(401).json({ error: 'Could not adopt session' });
    }
  });

  app.post('/api/v1/auth/signout', requireUser, async (_req: Request, res: Response) => {
    await nodeSession.signOut();
    res.json({ success: true });
  });

  app.get('/api/v1/auth/me', requireUser, (req: Request, res: Response) => {
    const session = (req as any).session;
    const node = nodeSession.current;
    res.json({
      userId: session.userId,
      username: session.username,
      email: session.email ?? null,
      // Whether the node's background workers are running as this same user.
      nodeSignedIn: !!node && node.user.id === session.userId,
    });
  });
}
