/**
 * Auth Routes - signup, login, logout, me
 */

import { Request, Response } from 'express';
import {
  signup,
  loginWithPassword,
  logout,
} from '../middleware/auth';
import type { RouteDependencies } from './types';

export function registerAuthRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.post('/api/v1/auth/signup', async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }
    const result = await signup(username, password);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ token: result.token, user: result.user });
  });

  app.post('/api/v1/auth/login', async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }
    const result = await loginWithPassword(username, password);
    if (!result.success) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({ token: result.token, user: result.user });
  });

  app.post('/api/v1/auth/logout', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      logout(authHeader.slice(7));
    }
    res.json({ success: true });
  });

  app.get('/api/v1/auth/me', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    res.json({ authenticated: true, userId: session.userId, username: session.username });
  });
}
