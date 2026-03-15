/**
 * Repo Routes - repo management + analysis
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { analyzeRepository, RepoAnalysis } from '../services/repo-analyzer';
import type { RouteDependencies } from './types';

function getReposDir(): string {
  const dir = path.join(require('os').homedir(), '.otherthing', 'repos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Repos storage (in-memory)
const reposStore: Map<string, any[]> = new Map();

// Analysis cache (keyed by repo path)
const analysisCache: Map<string, { analysis: RepoAnalysis; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function registerRepoRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.get('/api/v1/workspaces/:id/repos', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const repos = reposStore.get(workspaceId) || [];
    res.json({ repos });
  });

  app.post('/api/v1/workspaces/:id/repos', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const repo: any = {
      id: uuidv4(),
      url: req.body.url || '',
      name: req.body.name || 'unknown',
      status: 'cloning',
      addedBy: session.username,
      addedAt: new Date().toISOString(),
    };
    if (!reposStore.has(workspaceId)) {
      reposStore.set(workspaceId, []);
    }
    reposStore.get(workspaceId)!.push(repo);

    // Return immediately, clone + analyze in background
    res.status(201).json({ repo });

    // Background: clone then analyze
    const repoDir = path.join(getReposDir(), `${workspaceId}-${repo.id}`);
    (async () => {
      try {
        console.log(`[Repos] Cloning ${repo.url} to ${repoDir}...`);
        execSync(`git clone --depth 1 ${JSON.stringify(repo.url)} ${JSON.stringify(repoDir)}`, {
          timeout: 120000,
          stdio: 'pipe',
        });
        repo.localPath = repoDir;
        repo.status = 'analyzing';
        console.log(`[Repos] Clone complete, analyzing...`);

        const analysis = await analyzeRepository(repoDir);
        repo.analysis = analysis;
        repo.status = 'ready';
        repo.analyzedAt = new Date().toISOString();
        console.log(`[Repos] Analysis complete for ${repo.name}`);
      } catch (err: any) {
        console.error(`[Repos] Clone/analyze failed for ${repo.name}:`, err.message);
        repo.status = 'error';
        repo.error = err.message || 'Clone or analysis failed';
      }
    })();
  });

  app.post('/api/v1/workspaces/:id/repos/:repoId/analyze', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const repoId = req.params.repoId as string;

    const repos = reposStore.get(workspaceId) || [];
    const repo = repos.find(r => r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    // Check if we have a local clone path
    if (!repo.localPath) {
      // Return mock analysis for repos without local path
      repo.status = 'analyzing';
      res.json({
        analysis: {
          repoName: repo.name,
          primaryLanguage: 'TypeScript',
          totalCommits: 0,
          contributors: [],
          techStack: [],
          topFiles: [],
        },
      });
      setTimeout(() => {
        repo.status = 'ready';
        repo.analyzedAt = new Date().toISOString();
      }, 1000);
      return;
    }

    try {
      repo.status = 'analyzing';
      const analysis = await analyzeRepository(repo.localPath);
      repo.status = 'ready';
      repo.analysis = analysis;
      repo.analyzedAt = new Date().toISOString();

      res.json({ analysis });
    } catch (err) {
      repo.status = 'error';
      repo.error = String(err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/v1/workspaces/:id/repos/:repoId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const repoId = req.params.repoId as string;
    const repos = reposStore.get(workspaceId) || [];
    const repoIndex = repos.findIndex(r => r.id === repoId);
    if (repoIndex === -1) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    repos.splice(repoIndex, 1);
    res.json({ success: true });
  });

  // ============ Repository Analysis Endpoints ============

  app.post('/api/v1/repos/analyze', localAuth, async (req: Request, res: Response) => {
    const { path: repoPath } = req.body;
    if (!repoPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }

    try {
      const cached = analysisCache.get(repoPath);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        res.json({ analysis: cached.analysis, cached: true });
        return;
      }

      console.log(`[API] Analyzing repository: ${repoPath}`);
      const analysis = await analyzeRepository(repoPath);

      analysisCache.set(repoPath, { analysis, timestamp: Date.now() });

      res.json({ analysis, cached: false });
    } catch (err) {
      console.error('[API] Repository analysis failed:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/v1/repos/analysis', localAuth, (req: Request, res: Response) => {
    const repoPath = req.query.path as string;
    if (!repoPath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const cached = analysisCache.get(repoPath);
    if (cached) {
      const stale = Date.now() - cached.timestamp > CACHE_TTL;
      res.json({ analysis: cached.analysis, cached: true, stale });
    } else {
      res.status(404).json({ error: 'No cached analysis found' });
    }
  });

  app.delete('/api/v1/repos/analysis', localAuth, (req: Request, res: Response) => {
    const repoPath = req.query.path as string;
    if (repoPath) {
      analysisCache.delete(repoPath);
    } else {
      analysisCache.clear();
    }
    res.json({ success: true });
  });
}
