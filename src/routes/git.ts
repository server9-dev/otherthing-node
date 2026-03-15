/**
 * Git Routes - Git/SSH key routes + GitHub OAuth
 */

import { Request, Response } from 'express';
import { GitService } from '../services/git-service';
import type { RouteDependencies } from './types';

export function registerGitRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Get GitHub OAuth URL
  app.get('/api/v1/git/github/auth-url', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const { url, state } = GitService.getGitHubOAuthUrl(session.userId);
    res.json({ url, state });
  });

  // GitHub OAuth callback
  app.get('/auth/github/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }
    const result = await GitService.handleGitHubCallback(code as string, state as string);
    if (result.success) {
      res.send(`
        <html>
          <body style="background: #18181b; color: #fafafa; font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center;">
              <h2 style="color: #00ff88;">GitHub Connected!</h2>
              <p>You can close this window.</p>
            </div>
          </body>
        </html>
      `);
    } else {
      res.status(400).send(`
        <html>
          <body style="background: #18181b; color: #fafafa; font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center;">
              <h2 style="color: #ef4444;">Connection Failed</h2>
              <p>${result.error}</p>
            </div>
          </body>
        </html>
      `);
    }
  });

  // Get GitHub connection status
  app.get('/api/v1/git/github/status', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const github = GitService.getGitHubUser(session.userId);
    if (github) {
      res.json({ connected: true, user: github.user });
    } else {
      res.json({ connected: false });
    }
  });

  // Disconnect GitHub
  app.post('/api/v1/git/github/disconnect', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    GitService.disconnectGitHub(session.userId);
    res.json({ success: true });
  });

  // List GitHub repositories
  app.get('/api/v1/git/github/repos', localAuth, async (req: Request, res: Response) => {
    const session = (req as any).session;
    const result = await GitService.listGitHubRepos(session.userId);
    if (result.success) {
      res.json({ repos: result.repos });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  // Get SSH keys
  app.get('/api/v1/git/ssh-keys', localAuth, (req: Request, res: Response) => {
    const keys = GitService.getSSHKeys();
    res.json({ keys });
  });

  // Generate SSH key
  app.post('/api/v1/git/ssh-keys/generate', localAuth, (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    const result = GitService.generateSSHKey(name);
    if (result.success) {
      res.json({ success: true, key: result.key });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  // Import SSH key
  app.post('/api/v1/git/ssh-keys/import', localAuth, (req: Request, res: Response) => {
    const { name, privateKey } = req.body;
    if (!name || !privateKey) {
      res.status(400).json({ error: 'Name and privateKey are required' });
      return;
    }
    const result = GitService.importSSHKey(name, privateKey);
    if (result.success) {
      res.json({ success: true, key: result.key });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  // Delete SSH key
  app.delete('/api/v1/git/ssh-keys/:keyId', localAuth, (req: Request, res: Response) => {
    const keyId = req.params.keyId as string;
    const result = GitService.deleteSSHKey(keyId);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  // Clone repository
  app.post('/api/v1/git/clone', localAuth, async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { url, targetDir, branch, depth } = req.body;
    if (!url || !targetDir) {
      res.status(400).json({ error: 'url and targetDir are required' });
      return;
    }
    const credentials = GitService.getCredentials(session.userId);
    const result = await GitService.cloneRepo({
      url,
      targetDir,
      credentials: credentials || undefined,
      branch,
      depth,
    });
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });
}
