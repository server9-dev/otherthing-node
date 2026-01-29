/**
 * Local Agent Service
 *
 * Executes agents locally using the node's Ollama and Sandbox managers.
 * No WebSocket roundtrips needed - everything runs in the same process.
 */

import { v4 as uuidv4 } from 'uuid';
import { AgentAdapter } from '../adapters/agent';
import { OllamaManager } from '../ollama-manager';
import { SandboxManager } from '../sandbox-manager';
import { selectModel } from './model-selector';

// Execution status
export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// Agent execution record
export interface AgentExecution {
  id: string;
  workspaceId: string;
  agentId: string;
  goal: string;
  model: string;
  provider: 'ollama';
  status: AgentStatus;
  progress?: number;
  progressMessage?: string;
  result?: string;
  error?: string;
  tokensUsed: number;
  iterations: number;
  maxIterations: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  sandboxCid?: string;
  computeInfo?: string;
}

// Event emitter for real-time updates
type AgentEventCallback = (execution: AgentExecution) => void;

export class LocalAgentService {
  private executions: Map<string, AgentExecution> = new Map();
  private agentAdapter: AgentAdapter;
  private ollamaManager: OllamaManager | null = null;
  private sandboxManager: SandboxManager | null = null;
  private eventListeners: Map<string, Set<AgentEventCallback>> = new Map();

  constructor() {
    this.agentAdapter = new AgentAdapter();
    // Initialize the adapter to register tools
    this.agentAdapter.initialize().catch(err => {
      console.error('[AgentService] Failed to initialize agent adapter:', err);
    });
  }

  /**
   * Set the managers for local execution
   */
  setManagers(ollama: OllamaManager | null, sandbox: SandboxManager | null): void {
    this.ollamaManager = ollama;
    this.sandboxManager = sandbox;
  }

  /**
   * Subscribe to agent execution updates for a workspace
   */
  subscribe(workspaceId: string, callback: AgentEventCallback): () => void {
    if (!this.eventListeners.has(workspaceId)) {
      this.eventListeners.set(workspaceId, new Set());
    }
    this.eventListeners.get(workspaceId)!.add(callback);

    return () => {
      this.eventListeners.get(workspaceId)?.delete(callback);
    };
  }

  /**
   * Emit an event to all listeners for a workspace
   */
  private emit(execution: AgentExecution): void {
    const listeners = this.eventListeners.get(execution.workspaceId);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(execution);
        } catch (err) {
          console.error('[AgentService] Error in event listener:', err);
        }
      }
    }
  }

  /**
   * Execute an agent with the given goal
   */
  async executeAgent(
    workspaceId: string,
    agentId: string,
    goal: string,
    options: {
      model?: string;
      maxIterations?: number;
      tools?: string[];
      systemPrompt?: string;
    } = {}
  ): Promise<AgentExecution> {
    // Use the provided agentId as the execution ID so the API server can track updates
    const executionId = agentId;
    const maxIterations = options.maxIterations || 10;

    // Check if Ollama is available
    if (!this.ollamaManager) {
      const execution: AgentExecution = {
        id: executionId,
        workspaceId,
        agentId,
        goal,
        model: options.model || 'unknown',
        provider: 'ollama',
        status: 'failed',
        error: 'Ollama not available',
        tokensUsed: 0,
        iterations: 0,
        maxIterations,
        createdAt: new Date(),
      };
      this.executions.set(executionId, execution);
      return execution;
    }

    // Get available models from local Ollama
    const ollamaStatus = await this.ollamaManager.getStatus();
    const availableModels = ollamaStatus.models || [];

    // Select best model for the task
    let selectedModel = options.model;
    let selectionInfo = '';

    if (!selectedModel || selectedModel === 'auto') {
      // Use model selector with local models only
      const localNode = {
        id: 'local',
        name: 'Local Node',
        models: availableModels.map(m => ({
          name: m.name,
          size: m.size || 0,
          quantization: m.quantization || 'unknown',
        })),
      };

      const selection = selectModel(goal, [localNode], undefined);
      selectedModel = selection.model;
      selectionInfo = selection.reason;
      console.log(`[AgentService] Model selection: ${selectedModel} (${selectionInfo})`);
    }

    // Verify the model exists locally
    const modelExists = availableModels.some(m => m.name === selectedModel);
    if (!modelExists) {
      // Try to find a similar model
      const modelFamily = selectedModel?.split(':')[0] || '';
      const familyMatch = availableModels.find(m => m.name.startsWith(modelFamily));
      if (familyMatch) {
        console.log(`[AgentService] Model ${selectedModel} not found, using ${familyMatch.name}`);
        selectedModel = familyMatch.name;
      } else if (availableModels.length > 0) {
        console.log(`[AgentService] Model ${selectedModel} not found, using ${availableModels[0].name}`);
        selectedModel = availableModels[0].name;
      } else {
        const execution: AgentExecution = {
          id: executionId,
          workspaceId,
          agentId,
          goal,
          model: selectedModel || 'unknown',
          provider: 'ollama',
          status: 'failed',
          error: 'No Ollama models available',
          tokensUsed: 0,
          iterations: 0,
          maxIterations,
          createdAt: new Date(),
        };
        this.executions.set(executionId, execution);
        return execution;
      }
    }

    // Create execution record
    const execution: AgentExecution = {
      id: executionId,
      workspaceId,
      agentId,
      goal,
      model: selectedModel!,
      provider: 'ollama',
      status: 'pending',
      tokensUsed: 0,
      iterations: 0,
      maxIterations,
      createdAt: new Date(),
      computeInfo: `Local Ollama (${selectedModel})`,
    };

    this.executions.set(executionId, execution);
    this.emit(execution);

    // Start execution in background
    this.runAgent(execution, options).catch(err => {
      console.error('[AgentService] Agent execution error:', err);
      execution.status = 'failed';
      execution.error = String(err);
      execution.completedAt = new Date();
      this.emit(execution);
    });

    return execution;
  }

  /**
   * Run the agent (internal)
   */
  private async runAgent(
    execution: AgentExecution,
    options: {
      tools?: string[];
      systemPrompt?: string;
    }
  ): Promise<void> {
    execution.status = 'running';
    execution.startedAt = new Date();
    this.emit(execution);

    console.log(`[AgentService] Starting agent: ${execution.goal.slice(0, 50)}...`);

    // Create LLM function that uses local Ollama
    const llmFunction = async (request: {
      model: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      max_tokens?: number;
      temperature?: number;
    }) => {
      if (!this.ollamaManager) {
        throw new Error('Ollama not available');
      }

      const result = await this.ollamaManager.chat({
        model: request.model,
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
      });

      return {
        text: result.content,
        tokens_generated: result.tokens_used || 0,
      };
    };

    // Create sandbox tool context
    const toolContext: any = {
      workspaceId: execution.workspaceId,
      nodeId: null,  // Local execution doesn't use remote nodes
      sandboxManager: this.sandboxManager,
      llmFunction,
    };

    // Build agent run request
    const request = {
      goal: execution.goal,
      model: execution.model,
      agent_type: 'react' as const,
      max_iterations: execution.maxIterations,
      max_tokens: 4096,
      temperature: 0.7,
      verbose: true,
      security_enabled: true,
      tools: options.tools,
      tool_context: toolContext,
    };

    // Create execution context
    const context = {
      job_id: execution.id,
      timeout_seconds: 300,
      hardware: { gpus: [], cpu_cores: 8, memory_mb: 16000 },
    };

    try {
      // Run the agent via execute method
      const result = await this.agentAdapter.execute('run', request, context) as {
        result?: string;
        status?: string;
        iterations?: number;
        tokens_used?: number;
        error?: string;
      };

      execution.status = result.status === 'completed' ? 'completed' : 'failed';
      execution.result = result.result;
      execution.error = result.error;
      execution.tokensUsed = result.tokens_used || 0;
      execution.iterations = result.iterations || 0;
      execution.completedAt = new Date();

      // Sync sandbox to IPFS if we have files
      if (this.sandboxManager && execution.status === 'completed') {
        try {
          const syncResult = await this.sandboxManager.syncToIPFS(execution.workspaceId);
          if (syncResult.success && syncResult.cid) {
            execution.sandboxCid = syncResult.cid;
            console.log(`[AgentService] Sandbox synced to IPFS: ${syncResult.cid}`);
          }
        } catch (syncError) {
          console.warn(`[AgentService] Failed to sync sandbox to IPFS: ${syncError}`);
        }
      }

      console.log(
        `[AgentService] Agent ${execution.status === 'completed' ? 'completed' : 'failed'}: ` +
        `${execution.tokensUsed} tokens, ${execution.iterations} iterations`
      );

      this.emit(execution);
    } catch (err) {
      execution.status = 'failed';
      execution.error = String(err);
      execution.completedAt = new Date();
      this.emit(execution);
      throw err;
    }
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): AgentExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get all executions for a workspace
   */
  getExecutionsForWorkspace(workspaceId: string): AgentExecution[] {
    return Array.from(this.executions.values())
      .filter(e => e.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Cancel an execution
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution) return false;
    if (execution.status !== 'pending' && execution.status !== 'running') return false;

    execution.status = 'cancelled';
    execution.completedAt = new Date();
    this.emit(execution);
    return true;
  }
}

// Singleton instance
export const agentService = new LocalAgentService();
