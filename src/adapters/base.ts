/**
 * Base Adapter Class
 *
 * Abstract base class for all RhizOS MCP adapters.
 * Provides common functionality and defines the adapter interface.
 */

import {
  AdapterInfo,
  AdapterMethod,
  ExecutionContext,
} from '../types/index';

export abstract class BaseAdapter {
  abstract readonly info: AdapterInfo;
  abstract readonly methods: Map<string, AdapterMethod>;

  /**
   * Initialize the adapter
   * Called once when the adapter is loaded
   */
  async initialize(): Promise<void> {
    console.log(`[${this.info.name}] Initializing adapter v${this.info.version}`);
  }

  /**
   * Shutdown the adapter
   * Called when the node is shutting down
   */
  async shutdown(): Promise<void> {
    console.log(`[${this.info.name}] Shutting down adapter`);
  }

  /**
   * Check if this adapter can handle a given method
   */
  canHandle(method: string): boolean {
    return this.methods.has(method);
  }

  /**
   * Execute a method
   */
  abstract execute(
    method: string,
    params: unknown,
    context: ExecutionContext
  ): Promise<unknown>;

  /**
   * Validate parameters for a method
   */
  validateParams(method: string, params: unknown): { valid: boolean; errors?: string[] } {
    const methodDef = this.methods.get(method);
    if (!methodDef) {
      return { valid: false, errors: [`Unknown method: ${method}`] };
    }

    const result = methodDef.parameters.safeParse(params);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }

    return { valid: true };
  }

  /**
   * Get adapter capabilities as MCP tools
   */
  getMcpTools(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return Array.from(this.methods.entries()).map(([name, method]) => ({
      name: `${this.info.name}/${name}`,
      description: method.description,
      inputSchema: {
        type: 'object',
        // TODO: Convert Zod schema to JSON Schema
        properties: {},
      },
    }));
  }
}
