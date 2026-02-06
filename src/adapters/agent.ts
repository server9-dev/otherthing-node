/**
 * Agent Adapter
 *
 * Autonomous AI agent execution with tool use, multi-step reasoning,
 * and security scanning. Supports multiple agent architectures.
 */

import { z } from 'zod';
import {
  AdapterInfo,
  AdapterMethod,
  ExecutionContext,
} from '../types/index';
import { BaseAdapter } from './base';
import { LlmInferenceAdapter } from './llm-inference';
import { SecurityScanner, RiskLevel, scanForThreats } from '../security/index';
import { semanticMemory, MemoryType } from '../services/semantic-memory';
import { OllamaManager } from '../ollama-manager';

// Agent architectures
type AgentArchitecture = 'react' | 'plan-execute' | 'simple';

// Sandbox manager interface for local mode
interface SandboxManagerInterface {
  writeFile(workspaceId: string, path: string, content: string): Promise<{ success: boolean; path?: string; error?: string }>;
  readFile(workspaceId: string, path: string): Promise<{ success: boolean; content?: string; error?: string }>;
  listFiles(workspaceId: string, path?: string): Promise<{ success: boolean; files?: any[]; error?: string }>;
  deleteFile(workspaceId: string, path: string): Promise<{ success: boolean; error?: string }>;
  execute(workspaceId: string, command: string, timeout?: number): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }>;
}

// Tool context for sandbox operations (supports both local and remote modes)
interface ToolContext {
  workspaceId: string;
  // Local mode: direct sandbox manager
  sandboxManager?: SandboxManagerInterface;
  // Remote mode: via node manager
  nodeId?: string | null;
  nodeManager?: {
    sandboxWriteFile(nodeId: string, workspaceId: string, path: string, content: string): Promise<{ success: boolean; path?: string; error?: string }>;
    sandboxReadFile(nodeId: string, workspaceId: string, path: string): Promise<{ success: boolean; content?: string; error?: string }>;
    sandboxListFiles(nodeId: string, workspaceId: string, path?: string): Promise<{ success: boolean; files?: any[]; error?: string }>;
    sandboxDeleteFile(nodeId: string, workspaceId: string, path: string): Promise<{ success: boolean; error?: string }>;
    sandboxExecute(nodeId: string, workspaceId: string, command: string, timeout?: number): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }>;
  } | null;
}

// Tool definition
interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context?: ToolContext) => Promise<string>;
}

// LLM function type for node-based inference
export type LlmFunction = (request: {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  max_tokens?: number;
  temperature?: number;
}) => Promise<{ text: string; tokens_generated: number }>;

// Agent request schema
export const AgentRunRequestSchema = z.object({
  goal: z.string().min(1),
  agent_type: z.enum(['react', 'plan-execute', 'simple']).optional().default('react'),
  provider: z.enum(['ollama', 'openai', 'anthropic', 'azure', 'bedrock']).optional(),
  model: z.string().optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(), // Ollama endpoint URL for remote nodes
  tools: z.array(z.string()).optional(),
  max_iterations: z.number().optional().default(10),
  max_tokens: z.number().optional().default(4096),
  temperature: z.number().optional().default(0.7),
  verbose: z.boolean().optional().default(false),
  security_enabled: z.boolean().optional().default(true),
  // Tool context for sandbox operations (passed from orchestrator)
  tool_context: z.object({
    workspaceId: z.string(),
    nodeId: z.string().nullable(),
    nodeManager: z.any().nullable(),
    // Custom LLM function for node-based inference
    llmFunction: z.any().nullable().optional(),
  }).optional(),
});

export const AgentRunResponseSchema = z.object({
  result: z.string(),
  iterations: z.number(),
  actions: z.array(z.object({
    thought: z.string(),
    tool: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
  })),
  status: z.enum(['completed', 'max_iterations', 'error', 'blocked']),
  tokens_used: z.number(),
  security_alerts: z.array(z.string()).optional(),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;
export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;

// Action from LLM
interface AgentAction {
  thought: string;
  tool?: string;
  input?: string;
  output?: string;
}

export class AgentAdapter extends BaseAdapter {
  readonly info: AdapterInfo = {
    name: 'agent',
    version: '0.2.0',
    description: 'Autonomous AI agent with tool use and security scanning',
    capabilities: ['agent-execution', 'multi-step-reasoning', 'tool-orchestration', 'security-scanning'],
    requirements: {
      memory: {
        min_mb: 4096,
      },
    },
  };

  readonly methods: Map<string, AdapterMethod> = new Map([
    [
      'run',
      {
        name: 'run',
        description: 'Run an autonomous agent to complete a goal',
        parameters: AgentRunRequestSchema,
        returns: AgentRunResponseSchema,
      },
    ],
    [
      'list_architectures',
      {
        name: 'list_architectures',
        description: 'List available agent architectures',
        parameters: z.object({}),
        returns: z.array(z.object({
          name: z.string(),
          description: z.string(),
        })),
      },
    ],
    [
      'list_tools',
      {
        name: 'list_tools',
        description: 'List available tools for agents',
        parameters: z.object({}),
        returns: z.array(z.object({
          name: z.string(),
          description: z.string(),
        })),
      },
    ],
  ]);

  private llmAdapter: LlmInferenceAdapter;
  private securityScanner: SecurityScanner;
  private tools: Map<string, ToolDef> = new Map();
  private currentToolContext: ToolContext | null = null;

  constructor() {
    super();
    this.llmAdapter = new LlmInferenceAdapter();
    this.securityScanner = new SecurityScanner();
    this.registerBuiltinTools();
  }

  async initialize(): Promise<void> {
    await super.initialize();
    await this.llmAdapter.initialize();
    // Always register local filesystem tools for direct access
    this.registerLocalTools();
  }

  /**
   * Call LLM (chat mode) - uses custom function if provided, otherwise falls back to adapter
   */
  private async callLlm(
    request: AgentRunRequest,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    context: ExecutionContext
  ): Promise<{ text: string; tokens_generated: number }> {
    const llmFunction = request.tool_context?.llmFunction as LlmFunction | undefined;

    if (llmFunction) {
      // Use custom LLM function (node-based inference)
      return llmFunction({
        model: request.model || 'llama3.2:3b',
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
      });
    }

    // Fall back to built-in adapter
    const response = await this.llmAdapter.execute('chat', {
      model: request.model || 'gpt-4o',
      provider: request.provider,
      api_key: request.api_key,
      base_url: request.base_url,
      messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
    }, context) as { text: string; tokens_generated: number };

    return response;
  }

  /**
   * Call LLM (generate mode) - uses custom function if provided, otherwise falls back to adapter
   */
  private async callLlmGenerate(
    request: AgentRunRequest,
    prompt: string,
    context: ExecutionContext,
    options?: { max_tokens?: number; temperature?: number }
  ): Promise<{ text: string; tokens_generated: number }> {
    const llmFunction = request.tool_context?.llmFunction as LlmFunction | undefined;

    if (llmFunction) {
      // Convert prompt to messages format for node-based inference
      return llmFunction({
        model: request.model || 'llama3.2:3b',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options?.max_tokens || request.max_tokens,
        temperature: options?.temperature || request.temperature,
      });
    }

    // Fall back to built-in adapter
    const response = await this.llmAdapter.execute('generate', {
      model: request.model || 'gpt-4o',
      provider: request.provider,
      api_key: request.api_key,
      base_url: request.base_url,
      prompt,
      max_tokens: options?.max_tokens || request.max_tokens,
      temperature: options?.temperature || request.temperature,
    }, context) as { text: string; tokens_generated: number };

    return response;
  }

  async execute(
    method: string,
    params: unknown,
    context: ExecutionContext
  ): Promise<unknown> {
    switch (method) {
      case 'run':
        return this.runAgent(params, context);
      case 'list_architectures':
        return this.listArchitectures();
      case 'list_tools':
        return this.listTools();
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // ============ Agent Execution ============

  private async runAgent(
    params: unknown,
    context: ExecutionContext
  ): Promise<AgentRunResponse> {
    const request = AgentRunRequestSchema.parse(params);
    const { goal, agent_type, max_iterations, verbose, security_enabled, tool_context } = request;

    // Set tool context for this execution
    if (tool_context) {
      this.currentToolContext = tool_context as ToolContext;
      // Register sandbox tools if we have sandbox access (local or remote)
      if ((tool_context as ToolContext).sandboxManager || (tool_context.nodeId && tool_context.nodeManager)) {
        this.registerSandboxTools();
      }
    } else {
      this.currentToolContext = null;
    }

    console.log(`[agent] Starting ${agent_type} agent for goal: ${goal.slice(0, 50)}...`);

    // Security check on the goal itself
    if (security_enabled) {
      const goalScan = this.securityScanner.scan(goal);
      if (!goalScan.safe && (goalScan.riskLevel === RiskLevel.Critical || goalScan.riskLevel === RiskLevel.High)) {
        return {
          result: `Blocked: Security threat detected in goal - ${goalScan.summary}`,
          iterations: 0,
          actions: [],
          status: 'blocked',
          tokens_used: 0,
          security_alerts: goalScan.threats.map(t => t.pattern.description),
        };
      }
    }

    // Run appropriate agent architecture
    switch (agent_type) {
      case 'react':
        return this.runReactAgent(request, context);
      case 'plan-execute':
        return this.runPlanExecuteAgent(request, context);
      case 'simple':
        return this.runSimpleAgent(request, context);
      default:
        throw new Error(`Unknown agent type: ${agent_type}`);
    }
  }

  /**
   * ReAct Agent: Reason and Act in interleaved steps
   */
  private async runReactAgent(
    request: AgentRunRequest,
    context: ExecutionContext
  ): Promise<AgentRunResponse> {
    const { goal, max_iterations, verbose, security_enabled } = request;

    const actions: AgentAction[] = [];
    const securityAlerts: string[] = [];
    let totalTokens = 0;
    let iteration = 0;
    let finalResult = '';

    // Build tool descriptions for system prompt
    const toolDescriptions = this.buildToolDescriptions(request.tools);

    // Conversation history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: this.buildReactSystemPrompt(toolDescriptions),
      },
      {
        role: 'user',
        content: `Goal: ${goal}\n\nBegin working on this goal. Use the Thought/Action/Action Input/Observation format.`,
      },
    ];

    while (iteration < max_iterations) {
      iteration++;
      context.on_progress?.(
        (iteration / max_iterations) * 100,
        `Iteration ${iteration}/${max_iterations}`
      );

      // Get LLM response (uses node-based inference if llmFunction provided)
      const response = await this.callLlm(request, messages, context);
      totalTokens += response.tokens_generated;

      // Parse the response
      const parsed = this.parseReactResponse(response.text);

      if (verbose) {
        console.log(`[agent] Iteration ${iteration}:`, parsed);
      }

      actions.push(parsed);

      // Check if agent wants to finish
      if (parsed.tool === 'finish' || parsed.tool === 'final_answer') {
        finalResult = parsed.input || response.text;
        break;
      }

      // Security check on action
      if (security_enabled && parsed.input) {
        const actionScan = this.securityScanner.scan(parsed.input);
        if (!actionScan.safe) {
          securityAlerts.push(...actionScan.threats.map(t => t.pattern.description));

          if (actionScan.riskLevel === RiskLevel.Critical || actionScan.riskLevel === RiskLevel.High) {
            parsed.output = `[BLOCKED] Security threat detected: ${actionScan.summary}`;
            actions[actions.length - 1] = parsed;

            // Add observation to history
            messages.push({ role: 'assistant', content: response.text });
            messages.push({
              role: 'user',
              content: `Observation: ${parsed.output}\n\nThe action was blocked for security reasons. Please try a different approach.`,
            });
            continue;
          }
        }
      }

      // Execute tool if specified
      if (parsed.tool && parsed.input) {
        const toolResult = await this.executeTool(parsed.tool, parsed.input);
        parsed.output = toolResult;
        actions[actions.length - 1] = parsed;

        // Add to conversation
        messages.push({ role: 'assistant', content: response.text });
        messages.push({ role: 'user', content: `Observation: ${toolResult}` });
      } else {
        // No tool, just add the response
        messages.push({ role: 'assistant', content: response.text });

        // Check if this looks like a final answer
        if (response.text.toLowerCase().includes('final answer') ||
            response.text.toLowerCase().includes('goal achieved') ||
            response.text.toLowerCase().includes('task complete')) {
          finalResult = response.text;
          break;
        }
      }
    }

    const status = iteration >= max_iterations ? 'max_iterations' :
                   finalResult ? 'completed' : 'error';

    return {
      result: finalResult || 'Agent did not produce a final result',
      iterations: iteration,
      actions,
      status,
      tokens_used: totalTokens,
      security_alerts: securityAlerts.length > 0 ? securityAlerts : undefined,
    };
  }

  /**
   * Plan-Execute Agent: Create a plan first, then execute steps
   */
  private async runPlanExecuteAgent(
    request: AgentRunRequest,
    context: ExecutionContext
  ): Promise<AgentRunResponse> {
    const { goal, max_iterations, verbose, security_enabled } = request;

    const actions: AgentAction[] = [];
    const securityAlerts: string[] = [];
    let totalTokens = 0;

    // Step 1: Generate plan
    const planPrompt = `Create a step-by-step plan to achieve this goal:

Goal: ${goal}

Create a numbered list of specific steps. Be concise but thorough.
Format:
1. Step one
2. Step two
...

Plan:`;

    const planResponse = await this.callLlmGenerate(request, planPrompt, context, {
      max_tokens: 1024,
      temperature: 0.3,
    });

    totalTokens += planResponse.tokens_generated;

    // Parse steps from plan
    const steps = this.parsePlanSteps(planResponse.text);

    actions.push({
      thought: `Created plan with ${steps.length} steps`,
      tool: 'plan',
      input: planResponse.text,
    });

    if (verbose) {
      console.log(`[agent] Plan created with ${steps.length} steps`);
    }

    // Step 2: Execute each step
    let currentContext = '';
    let iteration = 0;

    for (const step of steps.slice(0, max_iterations)) {
      iteration++;
      context.on_progress?.(
        (iteration / Math.min(steps.length, max_iterations)) * 100,
        `Step ${iteration}/${steps.length}: ${step.slice(0, 30)}...`
      );

      // Security check
      if (security_enabled) {
        const stepScan = this.securityScanner.scan(step);
        if (!stepScan.safe && (stepScan.riskLevel === RiskLevel.Critical || stepScan.riskLevel === RiskLevel.High)) {
          securityAlerts.push(...stepScan.threats.map(t => t.pattern.description));
          actions.push({
            thought: `Step blocked: ${step}`,
            tool: 'security_block',
            output: stepScan.summary,
          });
          continue;
        }
      }

      // Execute step
      const executePrompt = `You are executing a plan step by step.

Previous context: ${currentContext || 'None'}

Current step: ${step}

Execute this step and provide the result. Be specific about what was done.

Result:`;

      const stepResponse = await this.callLlmGenerate(request, executePrompt, context);

      totalTokens += stepResponse.tokens_generated;

      actions.push({
        thought: `Executing: ${step}`,
        tool: 'execute_step',
        input: step,
        output: stepResponse.text,
      });

      currentContext += `\n- ${step}: ${stepResponse.text.slice(0, 200)}`;
    }

    // Final summary
    const summaryPrompt = `Summarize the results of completing this goal:

Goal: ${goal}

Steps completed:
${actions.filter(a => a.tool === 'execute_step').map(a => `- ${a.input}: ${a.output?.slice(0, 100)}`).join('\n')}

Provide a final answer summarizing what was accomplished:`;

    const summaryResponse = await this.callLlmGenerate(request, summaryPrompt, context, {
      max_tokens: 1024,
      temperature: 0.3,
    });

    totalTokens += summaryResponse.tokens_generated;

    return {
      result: summaryResponse.text,
      iterations: iteration,
      actions,
      status: 'completed',
      tokens_used: totalTokens,
      security_alerts: securityAlerts.length > 0 ? securityAlerts : undefined,
    };
  }

  /**
   * Simple Agent: Single LLM call with tool descriptions
   */
  private async runSimpleAgent(
    request: AgentRunRequest,
    context: ExecutionContext
  ): Promise<AgentRunResponse> {
    const { goal, security_enabled } = request;

    const toolDescriptions = this.buildToolDescriptions(request.tools);

    const prompt = `You are a helpful AI assistant with access to tools.

Available tools:
${toolDescriptions}

Goal: ${goal}

Provide a direct answer to achieve this goal. If you need to use a tool, explain what you would do.

Response:`;

    const response = await this.callLlmGenerate(request, prompt, context);

    const securityAlerts: string[] = [];
    if (security_enabled) {
      const scan = this.securityScanner.scan(response.text);
      if (!scan.safe) {
        securityAlerts.push(...scan.threats.map(t => t.pattern.description));
      }
    }

    return {
      result: response.text,
      iterations: 1,
      actions: [{
        thought: 'Direct response',
        output: response.text,
      }],
      status: 'completed',
      tokens_used: response.tokens_generated,
      security_alerts: securityAlerts.length > 0 ? securityAlerts : undefined,
    };
  }

  // ============ Helper Methods ============

  private buildReactSystemPrompt(toolDescriptions: string): string {
    return `You are an autonomous AI agent that reasons step by step to accomplish goals.

You have access to the following tools:
${toolDescriptions}

Use this format:

Thought: Consider what to do next
Action: the tool to use (one of the available tools, or "finish" when done)
Action Input: the input to the tool
Observation: the result (this will be provided to you)

When you have completed the goal, use:
Action: finish
Action Input: your final answer

Begin!`;
  }

  private buildToolDescriptions(allowedTools?: string[]): string {
    const tools = allowedTools
      ? Array.from(this.tools.entries()).filter(([name]) => allowedTools.includes(name))
      : Array.from(this.tools.entries());

    if (tools.length === 0) {
      return '- think: reason about the problem\n- finish: provide final answer';
    }

    return tools
      .map(([name, tool]) => `- ${name}: ${tool.description}`)
      .join('\n') + '\n- finish: provide final answer';
  }

  private parseReactResponse(text: string): AgentAction {
    const thoughtMatch = text.match(/Thought:\s*(.+?)(?=\n|Action:|$)/si);
    const actionMatch = text.match(/Action:\s*(.+?)(?=\n|Action Input:|$)/si);
    const inputMatch = text.match(/Action Input:\s*(.+?)(?=\n|Observation:|$)/si);

    return {
      thought: thoughtMatch?.[1]?.trim() || text.slice(0, 200),
      tool: actionMatch?.[1]?.trim().toLowerCase(),
      input: inputMatch?.[1]?.trim(),
    };
  }

  private parsePlanSteps(planText: string): string[] {
    const lines = planText.split('\n');
    const steps: string[] = [];

    for (const line of lines) {
      const match = line.match(/^\d+\.\s*(.+)/);
      if (match) {
        steps.push(match[1].trim());
      }
    }

    return steps.length > 0 ? steps : [planText];
  }

  private async executeTool(toolName: string, input: string): Promise<string> {
    const normalizedName = toolName.toLowerCase().trim();
    const tool = this.tools.get(normalizedName);

    console.log(`[agent] Executing tool: ${normalizedName}, input: ${input.slice(0, 100)}...`);
    console.log(`[agent] Available tools: ${Array.from(this.tools.keys()).join(', ')}`);

    if (!tool) {
      console.log(`[agent] Tool not found: ${normalizedName}`);
      return `Tool '${toolName}' not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`;
    }

    try {
      // Clean up input - remove surrounding quotes if present
      let cleanInput = input.trim();
      if ((cleanInput.startsWith('"') && cleanInput.endsWith('"')) ||
          (cleanInput.startsWith("'") && cleanInput.endsWith("'"))) {
        cleanInput = cleanInput.slice(1, -1);
      }

      console.log(`[agent] Cleaned input: ${cleanInput}`);
      const result = await tool.execute({ input: cleanInput }, this.currentToolContext || undefined);
      console.log(`[agent] Tool result: ${result.slice(0, 200)}...`);
      return result;
    } catch (error) {
      console.error(`[agent] Tool execution error:`, error);
      return `Error executing ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // ============ Tool Management ============

  private registerBuiltinTools(): void {
    // Think tool (always available)
    this.tools.set('think', {
      name: 'think',
      description: 'Reason about the problem without taking action',
      parameters: { input: 'string' },
      execute: async (params) => `Thought recorded: ${params.input}`,
    });

    // Search tool (simulated)
    this.tools.set('search', {
      name: 'search',
      description: 'Search for information on the web',
      parameters: { query: 'string' },
      execute: async (params) => `Search results for "${params.input}": [Simulated search - integrate real search API]`,
    });

    // Calculate tool
    this.tools.set('calculate', {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: { expression: 'string' },
      execute: async (params) => {
        try {
          // Simple eval for math (in production, use a proper math parser)
          const expr = String(params.input).replace(/[^0-9+\-*/().%\s]/g, '');
          const result = Function(`"use strict"; return (${expr})`)();
          return `Result: ${result}`;
        } catch {
          return `Error: Could not evaluate expression`;
        }
      },
    });
  }

  /**
   * Register a custom tool
   */
  registerTool(tool: ToolDef): void {
    this.tools.set(tool.name.toLowerCase(), tool);
  }

  /**
   * Register sandbox tools when tool context is available
   * Supports both local (sandboxManager) and remote (nodeManager) modes
   */
  private registerSandboxTools(): void {
    // Write file tool
    this.tools.set('write_file', {
      name: 'write_file',
      description: 'Write content to a file in the workspace sandbox. Input format: path|content (e.g., "code/hello.py|print(\'hello\')")',
      parameters: { input: 'string (path|content)' },
      execute: async (params, ctx) => {
        const input = String(params.input);
        const pipeIndex = input.indexOf('|');
        if (pipeIndex === -1) {
          return 'Error: Invalid format. Use: path|content (e.g., "code/hello.py|print(\'hello\')")';
        }
        const filePath = input.slice(0, pipeIndex).trim();
        const content = input.slice(pipeIndex + 1);

        // Local mode: use sandboxManager directly
        if (ctx?.sandboxManager) {
          const result = await ctx.sandboxManager.writeFile(
            ctx.workspaceId,
            filePath,
            content
          );
          if (result.success) {
            return `File written successfully: ${filePath}`;
          } else {
            return `Error writing file: ${result.error}`;
          }
        }

        // Remote mode: use nodeManager
        if (ctx?.nodeId && ctx?.nodeManager) {
          const result = await ctx.nodeManager.sandboxWriteFile(
            ctx.nodeId,
            ctx.workspaceId,
            filePath,
            content
          );
          if (result.success) {
            return `File written successfully: ${filePath}`;
          } else {
            return `Error writing file: ${result.error}`;
          }
        }

        return 'Error: Sandbox not available';
      },
    });

    // Read file tool
    this.tools.set('read_file', {
      name: 'read_file',
      description: 'Read content from a file in the workspace sandbox',
      parameters: { input: 'string (file path)' },
      execute: async (params, ctx) => {
        const filePath = String(params.input).trim();

        // Local mode
        if (ctx?.sandboxManager) {
          const result = await ctx.sandboxManager.readFile(ctx.workspaceId, filePath);
          if (result.success && result.content !== undefined) {
            return `File content:\n${result.content}`;
          } else {
            return `Error reading file: ${result.error}`;
          }
        }

        // Remote mode
        if (ctx?.nodeId && ctx?.nodeManager) {
          const result = await ctx.nodeManager.sandboxReadFile(ctx.nodeId, ctx.workspaceId, filePath);
          if (result.success && result.content !== undefined) {
            return `File content:\n${result.content}`;
          } else {
            return `Error reading file: ${result.error}`;
          }
        }

        return 'Error: Sandbox not available';
      },
    });

    // List files tool
    this.tools.set('list_files', {
      name: 'list_files',
      description: 'List files in a directory within the workspace sandbox. Use "." for root.',
      parameters: { input: 'string (directory path)' },
      execute: async (params, ctx) => {
        const dirPath = String(params.input).trim() || '.';

        // Local mode
        if (ctx?.sandboxManager) {
          const result = await ctx.sandboxManager.listFiles(ctx.workspaceId, dirPath);
          if (result.success && result.files) {
            if (result.files.length === 0) return 'Directory is empty';
            return result.files.map(f =>
              `${f.isDirectory ? '[DIR]' : '[FILE]'} ${f.name} (${f.size} bytes)`
            ).join('\n');
          } else {
            return `Error listing files: ${result.error}`;
          }
        }

        // Remote mode
        if (ctx?.nodeId && ctx?.nodeManager) {
          const result = await ctx.nodeManager.sandboxListFiles(ctx.nodeId, ctx.workspaceId, dirPath);
          if (result.success && result.files) {
            if (result.files.length === 0) return 'Directory is empty';
            return result.files.map(f =>
              `${f.isDirectory ? '[DIR]' : '[FILE]'} ${f.name} (${f.size} bytes)`
            ).join('\n');
          } else {
            return `Error listing files: ${result.error}`;
          }
        }

        return 'Error: Sandbox not available';
      },
    });

    // Delete file tool
    this.tools.set('delete_file', {
      name: 'delete_file',
      description: 'Delete a file or directory from the workspace sandbox',
      parameters: { input: 'string (file path)' },
      execute: async (params, ctx) => {
        const filePath = String(params.input).trim();

        // Local mode
        if (ctx?.sandboxManager) {
          const result = await ctx.sandboxManager.deleteFile(ctx.workspaceId, filePath);
          if (result.success) {
            return `Deleted: ${filePath}`;
          } else {
            return `Error deleting: ${result.error}`;
          }
        }

        // Remote mode
        if (ctx?.nodeId && ctx?.nodeManager) {
          const result = await ctx.nodeManager.sandboxDeleteFile(ctx.nodeId, ctx.workspaceId, filePath);
          if (result.success) {
            return `Deleted: ${filePath}`;
          } else {
            return `Error deleting: ${result.error}`;
          }
        }

        return 'Error: Sandbox not available';
      },
    });

    // Shell execute tool
    this.tools.set('shell', {
      name: 'shell',
      description: 'Execute a shell command in the workspace sandbox. Commands run in the sandbox directory.',
      parameters: { input: 'string (command)' },
      execute: async (params, ctx) => {
        const command = String(params.input).trim();

        // Security scan the command
        const scan = scanForThreats(command);
        if (!scan.safe && (scan.riskLevel === RiskLevel.Critical || scan.riskLevel === RiskLevel.High)) {
          return `Command blocked for security: ${scan.summary}`;
        }

        let result: { success: boolean; stdout: string; stderr: string; exitCode: number; error?: string };

        // Local mode
        if (ctx?.sandboxManager) {
          result = await ctx.sandboxManager.execute(ctx.workspaceId, command, 30000);
        }
        // Remote mode
        else if (ctx?.nodeId && ctx?.nodeManager) {
          result = await ctx.nodeManager.sandboxExecute(ctx.nodeId, ctx.workspaceId, command, 30000);
        } else {
          return 'Error: Sandbox not available';
        }

        let output = '';
        if (result.stdout) output += `stdout:\n${result.stdout}\n`;
        if (result.stderr) output += `stderr:\n${result.stderr}\n`;
        output += `Exit code: ${result.exitCode}`;

        if (!result.success && result.error) {
          output += `\nError: ${result.error}`;
        }

        return output || 'Command completed with no output';
      },
    });

    // Run Python tool (convenience wrapper)
    this.tools.set('run_python', {
      name: 'run_python',
      description: 'Execute a Python script in the workspace sandbox. Input is the script path or inline code.',
      parameters: { input: 'string (script path or code)' },
      execute: async (params, ctx) => {
        const input = String(params.input).trim();

        // Check if it's a file path or inline code
        const isFile = input.endsWith('.py') && !input.includes('\n');
        const command = isFile ? `python ${input}` : `python -c "${input.replace(/"/g, '\\"')}"`;

        let result: { success: boolean; stdout: string; stderr: string; exitCode: number; error?: string };

        // Local mode
        if (ctx?.sandboxManager) {
          result = await ctx.sandboxManager.execute(ctx.workspaceId, command, 60000);
        }
        // Remote mode
        else if (ctx?.nodeId && ctx?.nodeManager) {
          result = await ctx.nodeManager.sandboxExecute(ctx.nodeId, ctx.workspaceId, command, 60000);
        } else {
          return 'Error: Sandbox not available';
        }

        let output = '';
        if (result.stdout) output += result.stdout;
        if (result.stderr) output += `\nstderr: ${result.stderr}`;
        if (result.exitCode !== 0) output += `\nExit code: ${result.exitCode}`;

        return output || 'Script completed with no output';
      },
    });

    console.log('[agent] Registered sandbox tools: write_file, read_file, list_files, delete_file, shell, run_python');
  }

  /**
   * Register local filesystem tools for direct access (no sandbox)
   * These allow agents to read/explore the actual local filesystem
   */
  private registerLocalTools(): void {
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    // Local read file - read any file on the system
    this.tools.set('local_read_file', {
      name: 'local_read_file',
      description: 'Read content from any file on the local filesystem. Use absolute paths like /home/user/project/file.txt',
      parameters: { input: 'string (absolute file path)' },
      execute: async (params) => {
        const filePath = String(params.input).trim();
        try {
          if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
          }
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            return `Error: Path is a directory, use local_list_dir instead: ${filePath}`;
          }
          if (stats.size > 100000) {
            // Read first 100KB for large files
            const content = fs.readFileSync(filePath, 'utf-8').slice(0, 100000);
            return `File content (truncated to 100KB):\n${content}\n...[truncated]`;
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          return `File content:\n${content}`;
        } catch (err: any) {
          return `Error reading file: ${err.message}`;
        }
      },
    });

    // Local list directory
    this.tools.set('local_list_dir', {
      name: 'local_list_dir',
      description: 'List files and directories at an absolute path. Example: /home/user/project',
      parameters: { input: 'string (absolute directory path)' },
      execute: async (params) => {
        const dirPath = String(params.input).trim();
        try {
          if (!fs.existsSync(dirPath)) {
            return `Error: Directory not found: ${dirPath}`;
          }
          const stats = fs.statSync(dirPath);
          if (!stats.isDirectory()) {
            return `Error: Path is a file, not a directory: ${dirPath}`;
          }
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          if (entries.length === 0) {
            return 'Directory is empty';
          }
          const result = entries.map((entry: any) => {
            const fullPath = path.join(dirPath, entry.name);
            try {
              const entryStats = fs.statSync(fullPath);
              const size = entryStats.isDirectory() ? '' : ` (${entryStats.size} bytes)`;
              return `${entry.isDirectory() ? '[DIR] ' : '[FILE]'} ${entry.name}${size}`;
            } catch {
              return `${entry.isDirectory() ? '[DIR] ' : '[FILE]'} ${entry.name}`;
            }
          });
          return result.join('\n');
        } catch (err: any) {
          return `Error listing directory: ${err.message}`;
        }
      },
    });

    // Local shell command
    this.tools.set('local_shell', {
      name: 'local_shell',
      description: 'Execute a shell command on the local system. Use for running commands like ls, cat, grep, find, etc.',
      parameters: { input: 'string (shell command)' },
      execute: async (params) => {
        const command = String(params.input).trim();
        try {
          const output = execSync(command, {
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          });
          return output || 'Command completed with no output';
        } catch (err: any) {
          if (err.stdout || err.stderr) {
            return `${err.stdout || ''}${err.stderr ? '\nstderr: ' + err.stderr : ''}\nExit code: ${err.status || 1}`;
          }
          return `Error executing command: ${err.message}`;
        }
      },
    });

    // Local find files (grep/find helper)
    this.tools.set('local_find', {
      name: 'local_find',
      description: 'Find files matching a pattern in a directory. Input format: directory|pattern (e.g., "/home/user/project|*.ts")',
      parameters: { input: 'string (directory|pattern)' },
      execute: async (params) => {
        const input = String(params.input).trim();
        const pipeIndex = input.indexOf('|');
        if (pipeIndex === -1) {
          return 'Error: Invalid format. Use: directory|pattern (e.g., "/home/user/project|*.ts")';
        }
        const dirPath = input.slice(0, pipeIndex).trim();
        const pattern = input.slice(pipeIndex + 1).trim();

        try {
          const output = execSync(`find "${dirPath}" -name "${pattern}" -type f 2>/dev/null | head -50`, {
            encoding: 'utf-8',
            timeout: 30000,
          });
          return output || 'No files found matching pattern';
        } catch (err: any) {
          return `Error: ${err.message}`;
        }
      },
    });

    console.log('[agent] Registered local filesystem tools: local_read_file, local_list_dir, local_shell, local_find');
  }

  /**
   * Register semantic memory tools for storing and retrieving context
   * These enable agents to remember information across conversations
   */
  registerMemoryTools(ollamaManager: OllamaManager): void {
    // Initialize semantic memory with Ollama
    semanticMemory.setOllamaManager(ollamaManager);

    // Memory store tool
    this.tools.set('memory_store', {
      name: 'memory_store',
      description: 'Store information in semantic memory for later retrieval. Input format: type|content (types: conversation, fact, task, code, file). Example: "fact|The user prefers TypeScript over JavaScript"',
      parameters: { input: 'string (type|content)' },
      execute: async (params, ctx) => {
        const input = String(params.input).trim();
        const pipeIndex = input.indexOf('|');

        let type: MemoryType = 'conversation';
        let content = input;

        if (pipeIndex !== -1) {
          const typeStr = input.slice(0, pipeIndex).trim().toLowerCase();
          content = input.slice(pipeIndex + 1).trim();

          if (['conversation', 'fact', 'task', 'code', 'file', 'custom'].includes(typeStr)) {
            type = typeStr as MemoryType;
          }
        }

        if (!content) {
          return 'Error: No content provided to store';
        }

        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const memory = await semanticMemory.store(workspaceId, content, type, {
            source: 'agent',
          });
          return `Stored memory (id: ${memory.id}, type: ${type}): "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`;
        } catch (err: any) {
          return `Error storing memory: ${err.message}`;
        }
      },
    });

    // Memory search tool
    this.tools.set('memory_search', {
      name: 'memory_search',
      description: 'Search semantic memory for relevant information. Returns memories similar to your query. Input: search query text',
      parameters: { input: 'string (search query)' },
      execute: async (params, ctx) => {
        const query = String(params.input).trim();

        if (!query) {
          return 'Error: No search query provided';
        }

        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const results = await semanticMemory.search(workspaceId, query, {
            limit: 5,
            maxDistance: 64, // 50% similarity threshold
          });

          if (results.length === 0) {
            return 'No relevant memories found';
          }

          const formatted = results.map((r, i) =>
            `${i + 1}. [${(r.similarity * 100).toFixed(0)}% similar, type: ${(r.entry as any).type}]\n   ${r.entry.content.slice(0, 200)}${r.entry.content.length > 200 ? '...' : ''}`
          );

          return `Found ${results.length} relevant memories:\n\n${formatted.join('\n\n')}`;
        } catch (err: any) {
          return `Error searching memory: ${err.message}`;
        }
      },
    });

    // Memory recent tool
    this.tools.set('memory_recent', {
      name: 'memory_recent',
      description: 'Get the most recent memories. Input: optional number of memories to retrieve (default: 5)',
      parameters: { input: 'string (optional count)' },
      execute: async (params, ctx) => {
        const input = String(params.input).trim();
        const limit = parseInt(input) || 5;
        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const memories = semanticMemory.getRecent(workspaceId, limit);

          if (memories.length === 0) {
            return 'No memories stored yet';
          }

          const formatted = memories.map((m, i) => {
            const date = new Date(m.timestamp).toLocaleString();
            return `${i + 1}. [${m.type}] ${date}\n   ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`;
          });

          return `Recent ${memories.length} memories:\n\n${formatted.join('\n\n')}`;
        } catch (err: any) {
          return `Error getting recent memories: ${err.message}`;
        }
      },
    });

    // Memory stats tool
    this.tools.set('memory_stats', {
      name: 'memory_stats',
      description: 'Get statistics about stored memories',
      parameters: { input: 'string (ignored)' },
      execute: async (params, ctx) => {
        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const stats = semanticMemory.getStats(workspaceId);

          const typeBreakdown = Object.entries(stats.byType)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `  - ${type}: ${count}`)
            .join('\n');

          return `Memory Statistics:
Total memories: ${stats.totalMemories}
By type:
${typeBreakdown || '  (none)'}
Oldest: ${stats.oldestTimestamp ? new Date(stats.oldestTimestamp).toLocaleString() : 'N/A'}
Newest: ${stats.newestTimestamp ? new Date(stats.newestTimestamp).toLocaleString() : 'N/A'}`;
        } catch (err: any) {
          return `Error getting memory stats: ${err.message}`;
        }
      },
    });

    console.log('[agent] Registered semantic memory tools: memory_store, memory_search, memory_recent, memory_stats');
  }

  /**
   * Register UAF (Unified Architecture Framework) tools for architecture modeling
   * These enable agents to create and manage enterprise architecture elements
   */
  registerUAFTools(): void {
    // Lazy import to avoid circular dependencies
    const { uafService } = require('../services/uaf-service');
    const { uafViewGenerator } = require('../services/uaf-views');
    const { UAF_VIEWPOINTS, UAF_MODEL_KINDS } = require('../services/uaf-types');

    // UAF create element tool
    this.tools.set('uaf_create_element', {
      name: 'uaf_create_element',
      description: 'Create a UAF architecture element. Input format: viewpoint|modelKind|elementType|name|description. Viewpoints: strategic,operational,resources,services,personnel,security,projects,standards. ModelKinds: taxonomy,structure,connectivity,processes,states,scenarios,information. ElementTypes: capability,operational_activity,system,software,service,etc.',
      parameters: { input: 'string (viewpoint|modelKind|elementType|name|description)' },
      execute: async (params, ctx) => {
        const input = String(params.input).trim();
        const parts = input.split('|').map(p => p.trim());

        if (parts.length < 4) {
          return 'Error: Invalid format. Use: viewpoint|modelKind|elementType|name|description';
        }

        const [viewpoint, modelKind, elementType, name, description = ''] = parts;
        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const element = await uafService.createElement(
            workspaceId,
            { name, description, viewpoint, modelKind, elementType, properties: {} },
            'agent'
          );
          return `Created UAF element: ${element.name} (id: ${element.id}, viewpoint: ${viewpoint}, type: ${elementType})`;
        } catch (err: any) {
          return `Error creating element: ${err.message}`;
        }
      },
    });

    // UAF query elements tool
    this.tools.set('uaf_query_elements', {
      name: 'uaf_query_elements',
      description: 'Query UAF elements in the architecture. Input format: optional filters as viewpoint|modelKind|search. Leave empty to get all elements.',
      parameters: { input: 'string (optional: viewpoint|modelKind|search)' },
      execute: async (params, ctx) => {
        const input = String(params.input).trim();
        const workspaceId = ctx?.workspaceId || 'default';

        const filter: any = { workspaceId, limit: 20 };

        if (input) {
          const parts = input.split('|').map(p => p.trim());
          if (parts[0] && parts[0] !== '*') filter.viewpoint = parts[0];
          if (parts[1] && parts[1] !== '*') filter.modelKind = parts[1];
          if (parts[2]) filter.search = parts[2];
        }

        try {
          const elements = await uafService.queryElements(filter);

          if (elements.length === 0) {
            return 'No UAF elements found matching the criteria';
          }

          const formatted = elements.slice(0, 10).map((e: any, i: number) =>
            `${i + 1}. [${e.viewpoint}/${e.modelKind}] ${e.name} (${e.elementType})\n   ${e.description?.slice(0, 100) || 'No description'}`
          );

          return `Found ${elements.length} UAF elements:\n\n${formatted.join('\n\n')}${elements.length > 10 ? `\n\n... and ${elements.length - 10} more` : ''}`;
        } catch (err: any) {
          return `Error querying elements: ${err.message}`;
        }
      },
    });

    // UAF link elements tool
    this.tools.set('uaf_link_elements', {
      name: 'uaf_link_elements',
      description: 'Create a relationship between UAF elements. Input format: sourceId|targetId|relationshipType. RelationshipTypes: composes,specializes,realizes,performs,enables,requires,traces_to,etc.',
      parameters: { input: 'string (sourceId|targetId|relationshipType)' },
      execute: async (params, ctx) => {
        const input = String(params.input).trim();
        const parts = input.split('|').map(p => p.trim());

        if (parts.length < 3) {
          return 'Error: Invalid format. Use: sourceId|targetId|relationshipType';
        }

        const [sourceId, targetId, relationshipType] = parts;
        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const rel = await uafService.createRelationship(
            workspaceId,
            { sourceId, targetId, relationshipType },
            'agent'
          );
          return `Created relationship: ${relationshipType} from ${sourceId.slice(0, 8)} to ${targetId.slice(0, 8)} (id: ${rel.id})`;
        } catch (err: any) {
          return `Error creating relationship: ${err.message}`;
        }
      },
    });

    // UAF generate view tool
    this.tools.set('uaf_generate_view', {
      name: 'uaf_generate_view',
      description: 'Generate a Mermaid diagram for UAF elements. Input format: viewType|viewpoint (optional). ViewTypes: capability_taxonomy,operational_flow,resource_structure,grid_overview,etc.',
      parameters: { input: 'string (viewType|viewpoint)' },
      execute: async (params, ctx) => {
        const input = String(params.input).trim();
        const parts = input.split('|').map(p => p.trim());
        const viewType = parts[0] || 'grid_overview';
        const viewpoint = parts[1];
        const workspaceId = ctx?.workspaceId || 'default';

        try {
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
            case 'grid_overview':
              diagram = await uafViewGenerator.generateGridOverview(workspaceId);
              break;
            default:
              diagram = await uafViewGenerator.generateView({
                workspaceId,
                viewpoint: viewpoint as any,
                includeRelationships: true,
              });
          }

          return `Generated ${viewType} diagram:\n\n\`\`\`mermaid\n${diagram}\n\`\`\``;
        } catch (err: any) {
          return `Error generating view: ${err.message}`;
        }
      },
    });

    // UAF stats tool
    this.tools.set('uaf_stats', {
      name: 'uaf_stats',
      description: 'Get statistics about the UAF architecture in the workspace',
      parameters: { input: 'string (ignored)' },
      execute: async (params, ctx) => {
        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const stats = await uafService.getStats(workspaceId);

          const vpBreakdown = Object.entries(stats.byViewpoint)
            .filter(([_, count]) => (count as number) > 0)
            .map(([vp, count]) => `  - ${vp}: ${count}`)
            .join('\n');

          const typeBreakdown = Object.entries(stats.byElementType)
            .filter(([_, count]) => (count as number) > 0)
            .map(([type, count]) => `  - ${type}: ${count}`)
            .join('\n');

          return `UAF Architecture Statistics:
Total elements: ${stats.totalElements}
Total relationships: ${stats.totalRelationships}

By viewpoint:
${vpBreakdown || '  (none)'}

By element type:
${typeBreakdown || '  (none)'}`;
        } catch (err: any) {
          return `Error getting stats: ${err.message}`;
        }
      },
    });

    // UAF export tool
    this.tools.set('uaf_export', {
      name: 'uaf_export',
      description: 'Export the UAF architecture to JSON format',
      parameters: { input: 'string (ignored)' },
      execute: async (params, ctx) => {
        const workspaceId = ctx?.workspaceId || 'default';

        try {
          const json = await uafService.exportArchitecture(workspaceId);
          const architecture = JSON.parse(json);

          return `Exported UAF architecture (${architecture.elements.length} elements, ${architecture.relationships.length} relationships):\n\n${json.slice(0, 2000)}${json.length > 2000 ? '\n\n... (truncated)' : ''}`;
        } catch (err: any) {
          return `Error exporting architecture: ${err.message}`;
        }
      },
    });

    console.log('[agent] Registered UAF tools: uaf_create_element, uaf_query_elements, uaf_link_elements, uaf_generate_view, uaf_stats, uaf_export');
  }

  // ============ Info Methods ============

  private listArchitectures(): Array<{ name: string; description: string }> {
    return [
      {
        name: 'react',
        description: 'ReAct agent - Reason and Act in interleaved steps. Best for complex multi-step tasks.',
      },
      {
        name: 'plan-execute',
        description: 'Plan then execute - Creates a complete plan first, then executes each step. Best for well-defined goals.',
      },
      {
        name: 'simple',
        description: 'Simple single-turn agent - One LLM call with tool awareness. Best for quick tasks.',
      },
    ];
  }

  private listTools(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description,
    }));
  }
}
