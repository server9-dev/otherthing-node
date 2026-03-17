/**
 * Sandbox Preview Routes — start/stop preview dev servers for workspace repos
 */

import { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import type { RouteDependencies } from './types';

const previews: Map<string, { process: ChildProcess; port: number | null; status: string }> = new Map();

export function registerSandboxPreviewRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  app.post('/api/v1/workspaces/:id/sandbox/preview/start', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const { command, cwd } = req.body;

    const existing = previews.get(workspaceId);
    if (existing && existing.status === 'running') {
      res.json({ status: 'running', port: existing.port });
      return;
    }

    const cmd = command || 'pnpm dev';
    const dir = cwd || require('os').homedir();

    // Sanitize: only allow alphanumeric commands, no shell metacharacters
    if (/[;&|`$(){}]/.test(cmd)) {
      res.status(400).json({ error: 'Invalid command — shell metacharacters not allowed' });
      return;
    }

    const [bin, ...args] = cmd.split(' ');

    const proc = spawn(bin, args, {
      cwd: dir,
      stdio: 'pipe',
      shell: false, // no shell — prevents injection
      env: { ...process.env },
    });

    const entry = { process: proc, port: null as number | null, status: 'starting' };
    previews.set(workspaceId, entry);

    // Detect port from stdout/stderr
    const detectPort = (data: Buffer) => {
      const output = data.toString();
      // Match common patterns: "localhost:3000", "port 3000", ":3000"
      const portMatch = output.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/i)
        || output.match(/port\s+(\d{4,5})/i);
      if (portMatch && !entry.port) {
        entry.port = parseInt(portMatch[1]);
        entry.status = 'running';
        console.log(`[SandboxPreview] Detected port ${entry.port} for workspace ${workspaceId}`);
      }
    };

    proc.stdout?.on('data', detectPort);
    proc.stderr?.on('data', detectPort);

    proc.on('exit', (code) => {
      console.log(`[SandboxPreview] Process exited for workspace ${workspaceId} with code ${code}`);
      previews.delete(workspaceId);
    });

    proc.on('error', (err) => {
      console.error(`[SandboxPreview] Error for workspace ${workspaceId}:`, err);
      entry.status = 'error';
    });

    res.json({ status: 'starting', message: `Running "${cmd}" in ${dir}` });
  });

  app.get('/api/v1/workspaces/:id/sandbox/preview/status', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const entry = previews.get(workspaceId);

    if (entry) {
      res.json({ status: entry.status, port: entry.port });
    } else {
      res.json({ status: 'stopped', port: null });
    }
  });

  app.post('/api/v1/workspaces/:id/sandbox/preview/stop', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const entry = previews.get(workspaceId);

    if (entry) {
      entry.process.kill();
      previews.delete(workspaceId);
    }

    res.json({ status: 'stopped' });
  });
}

// Clean up on process exit
process.on('exit', () => {
  for (const [, entry] of previews) {
    entry.process.kill();
  }
});
