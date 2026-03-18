/**
 * Repo Routes - repo management + analysis + IPFS storage
 *
 * Repos are cloned locally, then added to IPFS so any workspace member
 * can pull them. Changes are synced back to IPFS on push.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { analyzeRepository, RepoAnalysis } from '../services/repo-analyzer';
import type { RouteDependencies } from './types';
import { appwriteService } from '../services/appwrite-service';

const loadedRepos: Set<string> = new Set();

async function loadReposFromAppwrite(workspaceId: string): Promise<void> {
  if (loadedRepos.has(workspaceId) || !appwriteService.isInitialized()) return;
  try {
    const result = await appwriteService.listWorkspaceRepos(workspaceId);
    const repos = result.documents.map((d: any) => ({
      id: d.$id, url: d.url, name: d.name, status: d.status || 'ready',
      ipfsCid: d.ipfsCid, addedBy: d.addedBy, addedAt: d.addedAt,
      _appwriteId: d.$id,
    }));
    reposStore.set(workspaceId, repos);
    loadedRepos.add(workspaceId);
  } catch (err) {
    console.warn('[Repos] Appwrite load failed:', err);
  }
}

function getReposDir(): string {
  const dir = path.join(os.homedir(), '.otherthing', 'repos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Repos storage (in-memory, keyed by workspaceId)
const reposStore: Map<string, any[]> = new Map();

// Analysis cache (keyed by repo path)
const analysisCache: Map<string, { analysis: RepoAnalysis; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function registerRepoRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Helper to get IPFS manager (may be null if not running)
  const getIpfs = () => deps.managers.ipfsManager;

  // ── List repos ────────────────────────────────────────────
  app.get('/api/v1/workspaces/:id/repos', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    await loadReposFromAppwrite(workspaceId);
    const repos = reposStore.get(workspaceId) || [];
    res.json({ repos });
  });

  // ── Connect / clone a repo ────────────────────────────────
  app.post('/api/v1/workspaces/:id/repos', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const repo: any = {
      id: uuidv4(),
      url: req.body.url || '',
      name: req.body.name || 'unknown',
      status: 'cloning',
      ipfsCid: null,
      addedBy: session.username,
      addedAt: new Date().toISOString(),
    };
    if (!reposStore.has(workspaceId)) {
      reposStore.set(workspaceId, []);
    }
    reposStore.get(workspaceId)!.push(repo);

    // Persist to Appwrite
    if (appwriteService.isInitialized()) {
      appwriteService.createWorkspaceRepo(workspaceId, {
        url: repo.url, name: repo.name, addedBy: repo.addedBy,
      }).then(doc => {
        repo._appwriteId = doc.$id;
      }).catch(err => console.warn('[Repos] Appwrite write failed:', err));
    }

    // Return immediately, clone + analyze + IPFS in background
    res.status(201).json({ repo });

    const repoDir = path.join(getReposDir(), `${workspaceId}-${repo.id}`);
    (async () => {
      try {
        // Validate URL format to prevent command injection
        if (!/^(https?:\/\/|git@|ssh:\/\/)[\w.@:/-]+$/.test(repo.url)) {
          throw new Error('Invalid repository URL format');
        }
        console.log(`[Repos] Cloning ${repo.url} to ${repoDir}...`);
        spawnSync('git', ['clone', '--depth', '1', repo.url, repoDir], {
          timeout: 120000,
          stdio: 'pipe',
        });
        repo.localPath = repoDir;
        repo.status = 'analyzing';
        console.log(`[Repos] Clone complete, analyzing...`);

        const analysis = await analyzeRepository(repoDir);
        repo.analysis = analysis;
        repo.analyzedAt = new Date().toISOString();
        console.log(`[Repos] Analysis complete for ${repo.name}`);

        // Add to IPFS for workspace sharing
        const ipfs = getIpfs();
        if (ipfs) {
          try {
            repo.status = 'syncing';
            console.log(`[Repos] Adding ${repo.name} to IPFS...`);
            const cid = await ipfs.add(repoDir);
            repo.ipfsCid = cid;
            await ipfs.pin(cid);
            console.log(`[Repos] ${repo.name} added to IPFS: ${cid}`);
          } catch (ipfsErr: any) {
            console.warn(`[Repos] IPFS add failed for ${repo.name}: ${ipfsErr.message}`);
            // Not fatal — repo still works locally
          }
        }

        repo.status = 'ready';
      } catch (err: any) {
        console.error(`[Repos] Clone/analyze failed for ${repo.name}:`, err.message);
        repo.status = 'error';
        repo.error = err.message || 'Clone or analysis failed';
      }
    })();
  });

  // ── Sync repo to IPFS (push local changes) ────────────────
  app.post('/api/v1/workspaces/:id/repos/:repoId/sync', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const repoId = req.params.repoId as string;

    const repos = reposStore.get(workspaceId) || [];
    const repo = repos.find(r => r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    if (!repo.localPath || !existsSync(repo.localPath)) {
      res.status(400).json({ error: 'Repository has no local clone' });
      return;
    }

    const ipfs = getIpfs();
    if (!ipfs) {
      res.status(503).json({ error: 'IPFS is not running' });
      return;
    }

    try {
      const previousCid = repo.ipfsCid;
      console.log(`[Repos] Syncing ${repo.name} to IPFS...`);
      const cid = await ipfs.add(repo.localPath);
      repo.ipfsCid = cid;
      repo.lastSyncedAt = new Date().toISOString();
      await ipfs.pin(cid);

      // Unpin old version
      if (previousCid && previousCid !== cid) {
        try { await ipfs.unpin(previousCid); } catch {}
      }

      console.log(`[Repos] ${repo.name} synced to IPFS: ${cid}`);
      res.json({ cid, previousCid, status: 'synced' });
    } catch (err: any) {
      console.error(`[Repos] Sync failed for ${repo.name}:`, err.message);
      res.status(500).json({ error: `Sync failed: ${err.message}` });
    }
  });

  // ── Pull repo from IPFS (for workspace members without local clone) ──
  app.post('/api/v1/workspaces/:id/repos/:repoId/pull', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const repoId = req.params.repoId as string;

    const repos = reposStore.get(workspaceId) || [];
    const repo = repos.find(r => r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    if (!repo.ipfsCid) {
      res.status(400).json({ error: 'Repository has no IPFS CID — needs to be synced first' });
      return;
    }

    const ipfs = getIpfs();
    if (!ipfs) {
      res.status(503).json({ error: 'IPFS is not running' });
      return;
    }

    try {
      const repoDir = path.join(getReposDir(), `${workspaceId}-${repo.id}`);

      console.log(`[Repos] Pulling ${repo.name} from IPFS (${repo.ipfsCid})...`);
      await ipfs.get(repo.ipfsCid, repoDir);
      repo.localPath = repoDir;
      repo.status = 'ready';

      console.log(`[Repos] ${repo.name} pulled from IPFS to ${repoDir}`);
      res.json({ localPath: repoDir, cid: repo.ipfsCid, status: 'pulled' });
    } catch (err: any) {
      console.error(`[Repos] Pull failed for ${repo.name}:`, err.message);
      res.status(500).json({ error: `Pull failed: ${err.message}` });
    }
  });

  // ── Analyze repo ──────────────────────────────────────────
  app.post('/api/v1/workspaces/:id/repos/:repoId/analyze', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const repoId = req.params.repoId as string;

    const repos = reposStore.get(workspaceId) || [];
    const repo = repos.find(r => r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    if (!repo.localPath) {
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

  // ── Delete repo ───────────────────────────────────────────
  app.delete('/api/v1/workspaces/:id/repos/:repoId', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const repoId = req.params.repoId as string;
    const repos = reposStore.get(workspaceId) || [];
    const repoIndex = repos.findIndex(r => r.id === repoId);
    if (repoIndex === -1) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const repo = repos[repoIndex];

    // Unpin from IPFS if it was stored there
    if (repo.ipfsCid) {
      const ipfs = getIpfs();
      if (ipfs) {
        try { await ipfs.unpin(repo.ipfsCid); } catch {}
      }
    }

    repos.splice(repoIndex, 1);
    res.json({ success: true });
  });

  // ── Standalone analysis endpoints ─────────────────────────

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
