/**
 * Adapter Routes - MCP adapter routes
 */

import { Request, Response } from 'express';
import { adapterManager } from '../adapters/adapter-manager';
import type { RouteDependencies } from './types';

export function registerAdapterRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // List all registered adapters
  app.get('/api/v1/adapters', async (req: Request, res: Response) => {
    try {
      const adapters = adapterManager.listAdapters().map(reg => ({
        name: reg.info.name,
        version: reg.info.version,
        description: reg.info.description,
        capabilities: reg.info.capabilities,
        methods: reg.methods,
      }));
      res.json({ adapters });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get MCP-compatible tool definitions
  app.get('/api/v1/adapters/tools', async (req: Request, res: Response) => {
    try {
      const tools = adapterManager.getMcpTools();
      res.json({ tools });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get specific adapter info
  app.get('/api/v1/adapters/:name', async (req: Request, res: Response) => {
    try {
      const adapter = adapterManager.getAdapter(req.params.name as string);
      if (!adapter) {
        res.status(404).json({ error: `Adapter not found: ${req.params.name}` });
        return;
      }
      res.json({
        name: adapter.info.name,
        version: adapter.info.version,
        description: adapter.info.description,
        capabilities: adapter.info.capabilities,
        requirements: adapter.info.requirements,
        methods: Array.from(adapter.methods.entries()).map(([name, method]) => ({
          name,
          description: method.description,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Execute adapter method
  app.post('/api/v1/adapters/:name/:method', localAuth, async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const method = req.params.method as string;
    const params = req.body;

    try {
      console.log(`[API] Executing adapter method: ${name}/${method}`);
      const result = await adapterManager.execute(name, method, params, {
        on_progress: (progress, message) => {
          console.log(`[API] ${name}/${method} progress: ${progress}% - ${message}`);
        },
      });
      res.json({ success: true, result });
    } catch (err: any) {
      console.error(`[API] Adapter execution error:`, err);
      res.status(400).json({
        success: false,
        error: err.message || String(err),
      });
    }
  });

  // Execute by MCP tool name
  app.post('/api/v1/mcp/execute', localAuth, async (req: Request, res: Response) => {
    const { tool, params } = req.body;

    if (!tool) {
      res.status(400).json({ error: 'Tool name required' });
      return;
    }

    try {
      console.log(`[API] Executing MCP tool: ${tool}`);
      const result = await adapterManager.executeByToolName(tool, params || {});
      res.json({ success: true, result });
    } catch (err: any) {
      console.error(`[API] MCP execution error:`, err);
      res.status(400).json({
        success: false,
        error: err.message || String(err),
      });
    }
  });
}
