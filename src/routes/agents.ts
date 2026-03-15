/**
 * Agent Routes - agent execution, analyze, scan
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { agentService, AgentExecution } from '../services/agent-service';
import type { RouteDependencies, AgentExecutionLocal } from './types';
import { WebSocket } from 'ws';

export function registerAgentRoutes(deps: RouteDependencies): void {
  const { app, localAuth, agentExecutions, agentsWsClients, broadcastAgentProgress } = deps;

  app.get('/api/v1/workspaces/:id/agents', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const agents = Array.from(agentExecutions.values())
      .filter(a => a.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ agents });
  });

  app.post('/api/v1/workspaces/:id/agents', localAuth, async (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const session = (req as any).session;
    const { goal, agentType, model, provider, preferLocal } = req.body;

    if (!goal) {
      res.status(400).json({ error: 'Goal is required' });
      return;
    }

    // Get available models from Ollama
    let availableModels: string[] = [];
    let selectedModel = model || '';
    let selectedProvider = provider || 'ollama';

    const ollamaManager = deps.managers.ollamaManager;
    if (ollamaManager) {
      try {
        const status = await ollamaManager.getStatus();
        availableModels = (status.models || []).map(m => m.name);
        if (!selectedModel && availableModels.length > 0) {
          selectedModel = availableModels.find(m => m.includes('llama') || m.includes('qwen')) || availableModels[0];
        }
      } catch {
        // Ignore
      }
    }

    if (!selectedModel) {
      selectedModel = 'llama3.2:3b';
    }

    const execution: AgentExecutionLocal = {
      id: uuidv4(),
      workspaceId,
      userId: session.userId,
      goal,
      agentType: agentType || 'react',
      model: selectedModel,
      provider: selectedProvider,
      status: 'pending',
      progress: 0,
      progressMessage: 'Starting agent...',
      actions: [],
      tokensUsed: 0,
      iterations: 0,
      createdAt: new Date().toISOString(),
      computeSource: 'local',
      nodeId: 'local-node',
      modelPulled: availableModels.includes(selectedModel),
    };

    agentExecutions.set(execution.id, execution);

    // Start the agent execution in the background
    runAgentExecution(execution, deps);

    res.status(201).json({ agent: execution });
  });

  // Agent analyze endpoint
  app.post('/api/v1/workspaces/:id/agents/analyze', localAuth, async (req: Request, res: Response) => {
    const { goal } = req.body;

    let models: string[] = [];
    const ollamaManager = deps.managers.ollamaManager;
    if (ollamaManager) {
      try {
        const status = await ollamaManager.getStatus();
        models = (status.models || []).map(m => m.name);
      } catch {
        // Ignore
      }
    }

    const defaultModel = models.find(m => m.includes('llama') || m.includes('qwen')) || models[0] || 'llama3.2:3b';

    res.json({
      category: 'general',
      complexity: 'medium',
      estimatedSteps: 5,
      recommendation: {
        provider: 'ollama',
        model: defaultModel,
        needsPull: !models.includes(defaultModel),
      },
    });
  });

  // Agent scan endpoint
  app.post('/api/v1/workspaces/:id/agents/scan', localAuth, (req: Request, res: Response) => {
    const { goal } = req.body;
    res.json({
      safe: true,
      alerts: [],
      blockedPatterns: [],
      sanitizedGoal: goal || '',
    });
  });

  app.get('/api/v1/workspaces/:id/agents/:agentId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const agentId = req.params.agentId as string;
    const execution = agentExecutions.get(agentId);
    if (!execution || execution.workspaceId !== workspaceId) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ agent: execution });
  });

  app.delete('/api/v1/workspaces/:id/agents/:agentId', localAuth, (req: Request, res: Response) => {
    const workspaceId = req.params.id as string;
    const agentId = req.params.agentId as string;
    const execution = agentExecutions.get(agentId);
    if (!execution || execution.workspaceId !== workspaceId) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    execution.status = 'failed';
    execution.error = 'Cancelled by user';
    execution.completedAt = new Date().toISOString();
    res.json({ success: true });
  });
}

async function runAgentExecution(execution: AgentExecutionLocal, deps: RouteDependencies): Promise<void> {
  const { agentExecutions, broadcastAgentProgress } = deps;
  try {
    execution.status = 'running';
    execution.progressMessage = 'Agent is thinking...';
    broadcastAgentProgress(execution);

    const result = await agentService.executeAgent(
      execution.workspaceId,
      execution.id,
      execution.goal,
      {
        model: execution.model,
        maxIterations: 10,
      }
    );

    agentService.subscribe(execution.workspaceId, (exec) => {
      const localExec = agentExecutions.get(exec.id);
      if (localExec) {
        localExec.status = exec.status as AgentExecutionLocal['status'];
        localExec.progress = exec.progress || 0;
        localExec.progressMessage = exec.progressMessage || '';
        localExec.result = exec.result;
        localExec.error = exec.error;
        localExec.tokensUsed = exec.tokensUsed || 0;
        localExec.iterations = exec.iterations || 0;
        if (exec.status === 'completed' || exec.status === 'failed') {
          localExec.completedAt = new Date().toISOString();
        }
        broadcastAgentProgress(localExec);
      }
    });

  } catch (err) {
    execution.status = 'failed';
    execution.error = String(err);
    execution.completedAt = new Date().toISOString();
    broadcastAgentProgress(execution);
  }
}
