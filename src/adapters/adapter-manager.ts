/**
 * MCP Adapter Manager
 *
 * Manages registration and execution of MCP adapters.
 * Provides a unified interface for the API server to access adapter capabilities.
 */

import { BaseAdapter } from './base';
import { LlmInferenceAdapter } from './llm-inference';
import { AgentAdapter } from './agent';
import { ExecutionContext, AdapterInfo } from '../types/index';

export interface AdapterRegistration {
  adapter: BaseAdapter;
  info: AdapterInfo;
  methods: string[];
}

export class AdapterManager {
  private adapters: Map<string, BaseAdapter> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[AdapterManager] Initializing MCP adapters...');

    // Register built-in adapters
    const llmAdapter = new LlmInferenceAdapter();
    const agentAdapter = new AgentAdapter();

    await this.registerAdapter(llmAdapter);
    await this.registerAdapter(agentAdapter);

    this.initialized = true;
    console.log(`[AdapterManager] Initialized ${this.adapters.size} adapters`);
  }

  async registerAdapter(adapter: BaseAdapter): Promise<void> {
    try {
      await adapter.initialize();
      this.adapters.set(adapter.info.name, adapter);
      console.log(`[AdapterManager] Registered adapter: ${adapter.info.name} v${adapter.info.version}`);
    } catch (err) {
      console.error(`[AdapterManager] Failed to register adapter ${adapter.info.name}:`, err);
    }
  }

  getAdapter(name: string): BaseAdapter | undefined {
    return this.adapters.get(name);
  }

  listAdapters(): AdapterRegistration[] {
    return Array.from(this.adapters.values()).map(adapter => ({
      adapter,
      info: adapter.info,
      methods: Array.from(adapter.methods.keys()),
    }));
  }

  /**
   * Get all adapters as MCP-compatible tool definitions
   */
  getMcpTools(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }> = [];

    for (const adapter of this.adapters.values()) {
      tools.push(...adapter.getMcpTools());
    }

    return tools;
  }

  /**
   * Execute an adapter method
   */
  async execute(
    adapterName: string,
    method: string,
    params: unknown,
    context?: Partial<ExecutionContext>
  ): Promise<unknown> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterName}`);
    }

    if (!adapter.canHandle(method)) {
      throw new Error(`Method not found: ${adapterName}/${method}`);
    }

    // Validate parameters
    const validation = adapter.validateParams(method, params);
    if (!validation.valid) {
      throw new Error(`Invalid parameters: ${validation.errors?.join(', ')}`);
    }

    // Build execution context
    const fullContext: ExecutionContext = {
      job_id: context?.job_id || `job-${Date.now()}`,
      timeout_seconds: context?.timeout_seconds || 300,
      hardware: context?.hardware || {
        gpus: [],
        cpu_cores: require('os').cpus().length,
        memory_mb: Math.round(require('os').totalmem() / 1024 / 1024),
      },
      on_progress: context?.on_progress,
    };

    return adapter.execute(method, params, fullContext);
  }

  /**
   * Execute by MCP tool name (adapter/method format)
   */
  async executeByToolName(
    toolName: string,
    params: unknown,
    context?: Partial<ExecutionContext>
  ): Promise<unknown> {
    const [adapterName, method] = toolName.split('/');
    if (!adapterName || !method) {
      throw new Error(`Invalid tool name format: ${toolName}. Expected: adapter/method`);
    }
    return this.execute(adapterName, method, params, context);
  }

  async shutdown(): Promise<void> {
    console.log('[AdapterManager] Shutting down adapters...');
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.shutdown();
      } catch (err) {
        console.error(`[AdapterManager] Error shutting down ${adapter.info.name}:`, err);
      }
    }
    this.adapters.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const adapterManager = new AdapterManager();
