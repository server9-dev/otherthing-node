/**
 * UAF Routes - Universal Architecture Framework
 */

import { Request, Response } from 'express';
import type { RouteDependencies } from './types';

export function registerUAFRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Lazy import UAF services
  const { uafService } = require('../services/uaf-service');
  const { uafViewGenerator } = require('../services/uaf-views');

  // Get UAF grid overview
  app.get('/api/v1/workspaces/:workspaceId/uaf/grid', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const grid = await uafService.getGrid(workspaceId);
      res.json({ grid });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get UAF grid', details: String(err) });
    }
  });

  // Get UAF statistics
  app.get('/api/v1/workspaces/:workspaceId/uaf/stats', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const stats = await uafService.getStats(workspaceId);
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get UAF stats', details: String(err) });
    }
  });

  // Create UAF element
  app.post('/api/v1/workspaces/:workspaceId/uaf/elements', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { name, description, viewpoint, modelKind, elementType, properties, tags } = req.body;
      const userId = (req as any).session?.userId || 'local-user';

      const element = await uafService.createElement(
        workspaceId,
        { name, description, viewpoint, modelKind, elementType, properties, tags },
        userId
      );

      res.status(201).json(element);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create UAF element', details: String(err) });
    }
  });

  // Query UAF elements
  app.get('/api/v1/workspaces/:workspaceId/uaf/elements', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { viewpoint, modelKind, elementType, search, limit, offset } = req.query;

      const elements = await uafService.queryElements({
        workspaceId,
        viewpoint: viewpoint as string,
        modelKind: modelKind as string,
        elementType: elementType as string,
        search: search as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });

      res.json({ elements, total: elements.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to query UAF elements', details: String(err) });
    }
  });

  // Get single UAF element
  app.get('/api/v1/workspaces/:workspaceId/uaf/elements/:elementId', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId, elementId } = req.params;
      const element = await uafService.getElement(workspaceId, elementId);

      if (!element) {
        return res.status(404).json({ error: 'Element not found' });
      }

      res.json(element);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get UAF element', details: String(err) });
    }
  });

  // Update UAF element
  app.put('/api/v1/workspaces/:workspaceId/uaf/elements/:elementId', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId, elementId } = req.params;
      const updates = req.body;
      const userId = (req as any).session?.userId || 'local-user';

      const element = await uafService.updateElement(workspaceId, elementId, updates, userId);

      if (!element) {
        return res.status(404).json({ error: 'Element not found' });
      }

      res.json(element);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update UAF element', details: String(err) });
    }
  });

  // Delete UAF element
  app.delete('/api/v1/workspaces/:workspaceId/uaf/elements/:elementId', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId, elementId } = req.params;
      const success = await uafService.deleteElement(workspaceId, elementId);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete UAF element', details: String(err) });
    }
  });

  // Create UAF relationship
  app.post('/api/v1/workspaces/:workspaceId/uaf/relationships', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { sourceId, targetId, relationshipType, name, description, properties } = req.body;
      const userId = (req as any).session?.userId || 'local-user';

      const relationship = await uafService.createRelationship(
        workspaceId,
        { sourceId, targetId, relationshipType, name, description, properties },
        userId
      );

      res.status(201).json(relationship);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create UAF relationship', details: String(err) });
    }
  });

  // Query UAF relationships
  app.get('/api/v1/workspaces/:workspaceId/uaf/relationships', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { sourceId, targetId, relationshipType, limit, offset } = req.query;

      const relationships = await uafService.queryRelationships({
        workspaceId,
        sourceId: sourceId as string,
        targetId: targetId as string,
        relationshipType: relationshipType as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });

      res.json({ relationships, total: relationships.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to query UAF relationships', details: String(err) });
    }
  });

  // Delete UAF relationship
  app.delete('/api/v1/workspaces/:workspaceId/uaf/relationships/:relationshipId', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId, relationshipId } = req.params;
      const success = await uafService.deleteRelationship(workspaceId, relationshipId);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete UAF relationship', details: String(err) });
    }
  });

  // Generate UAF view (Mermaid diagram)
  app.post('/api/v1/workspaces/:workspaceId/uaf/views', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { viewType, viewpoint, modelKind, elementIds, includeRelationships } = req.body;

      let diagram: string;

      switch (viewType) {
        case 'capability_taxonomy':
          diagram = await uafViewGenerator.generateCapabilityTaxonomy(workspaceId);
          break;
        case 'operational_flow':
          diagram = await uafViewGenerator.generateOperationalFlow(workspaceId);
          break;
        case 'resource_structure':
          diagram = await uafViewGenerator.generateResourceStructure(workspaceId);
          break;
        case 'project_timeline':
          diagram = await uafViewGenerator.generateProjectTimeline(workspaceId);
          break;
        case 'grid_overview':
          diagram = await uafViewGenerator.generateGridOverview(workspaceId);
          break;
        default:
          diagram = await uafViewGenerator.generateView({
            workspaceId,
            viewpoint,
            modelKind,
            elementIds,
            includeRelationships: includeRelationships !== false,
          });
      }

      res.json({ viewType, diagram });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate UAF view', details: String(err) });
    }
  });

  // Export UAF architecture
  app.get('/api/v1/workspaces/:workspaceId/uaf/export', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { format } = req.query;

      const json = await uafService.exportArchitecture(workspaceId);

      if (format === 'file') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="uaf-architecture-${workspaceId}.json"`);
        res.send(json);
      } else {
        res.json(JSON.parse(json));
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to export UAF architecture', details: String(err) });
    }
  });

  // Import UAF architecture
  app.post('/api/v1/workspaces/:workspaceId/uaf/import', localAuth, async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { architecture } = req.body;
      const userId = (req as any).session?.userId || 'local-user';

      const json = typeof architecture === 'string' ? architecture : JSON.stringify(architecture);
      const result = await uafService.importArchitecture(workspaceId, json, userId);

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to import UAF architecture', details: String(err) });
    }
  });

  console.log('[ApiServer] UAF API routes registered');
}
