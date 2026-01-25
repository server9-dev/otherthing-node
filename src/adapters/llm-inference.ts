/**
 * LLM Inference Adapter
 *
 * Multi-provider LLM inference supporting Ollama, OpenAI, Anthropic, and more.
 * Unified interface for text generation across different backends.
 */

import { z } from 'zod';
import {
  AdapterInfo,
  AdapterMethod,
  ExecutionContext,
  LlmInferenceRequestSchema,
  LlmInferenceResponse,
} from '../types/index';
import { BaseAdapter } from './base';

// Provider types
type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'azure' | 'bedrock';

interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  organization?: string;
  region?: string;
}

// Extended request schema with provider selection
// Override prompt to be optional since messages can be provided instead
const ExtendedLlmRequestSchema = z.object({
  model: z.string(),
  prompt: z.string().optional(),
  max_tokens: z.number().optional().default(2048),
  temperature: z.number().optional().default(0.7),
  top_p: z.number().optional().default(0.9),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional().default(false),
  provider: z.enum(['ollama', 'openai', 'anthropic', 'azure', 'bedrock']).optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })).optional(),
}).refine(data => data.prompt || data.messages, {
  message: 'Either prompt or messages must be provided',
});

type ExtendedLlmRequest = z.infer<typeof ExtendedLlmRequestSchema>;

// Known models by provider
const PROVIDER_MODELS: Record<ProviderType, { default: string; known: string[] }> = {
  ollama: {
    default: 'llama3.2',
    known: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'qwen2.5-coder:7b', 'deepseek-coder'],
  },
  openai: {
    default: 'gpt-4o',
    known: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o3-mini'],
  },
  anthropic: {
    default: 'claude-sonnet-4-5',
    known: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5', 'claude-3-5-sonnet-20241022'],
  },
  azure: {
    default: 'gpt-4o',
    known: ['gpt-4o', 'gpt-4', 'gpt-35-turbo'],
  },
  bedrock: {
    default: 'anthropic.claude-3-sonnet-20240229-v1:0',
    known: ['anthropic.claude-3-sonnet-20240229-v1:0', 'anthropic.claude-3-haiku-20240307-v1:0'],
  },
};

export class LlmInferenceAdapter extends BaseAdapter {
  readonly info: AdapterInfo = {
    name: 'llm-inference',
    version: '0.2.0',
    description: 'Multi-provider LLM inference (Ollama, OpenAI, Anthropic, Azure, Bedrock)',
    capabilities: ['text-generation', 'chat-completion', 'multi-provider'],
    requirements: {
      gpu: {
        required: false,
        min_vram_mb: 4096,
        compute_apis: ['cuda', 'rocm'],
      },
      memory: {
        min_mb: 8192,
      },
    },
  };

  readonly methods: Map<string, AdapterMethod> = new Map([
    [
      'generate',
      {
        name: 'generate',
        description: 'Generate text from a prompt using an LLM',
        parameters: ExtendedLlmRequestSchema,
        returns: z.object({
          text: z.string(),
          tokens_generated: z.number(),
        }),
      },
    ],
    [
      'chat',
      {
        name: 'chat',
        description: 'Chat completion with message history',
        parameters: ExtendedLlmRequestSchema,
        returns: z.object({
          text: z.string(),
          tokens_generated: z.number(),
        }),
      },
    ],
    [
      'list_models',
      {
        name: 'list_models',
        description: 'List available models for a provider',
        parameters: z.object({
          provider: z.enum(['ollama', 'openai', 'anthropic', 'azure', 'bedrock']).optional(),
        }),
        returns: z.array(z.object({
          name: z.string(),
          provider: z.string(),
          size: z.number().optional(),
        })),
      },
    ],
    [
      'list_providers',
      {
        name: 'list_providers',
        description: 'List available LLM providers',
        parameters: z.object({}),
        returns: z.array(z.object({
          name: z.string(),
          available: z.boolean(),
          default_model: z.string(),
        })),
      },
    ],
    [
      'embed',
      {
        name: 'embed',
        description: 'Generate embeddings for text',
        parameters: z.object({
          model: z.string(),
          provider: z.enum(['ollama', 'openai', 'anthropic', 'azure', 'bedrock']).optional(),
          text: z.string(),
          api_key: z.string().optional(),
        }),
        returns: z.object({
          embedding: z.array(z.number()),
          model: z.string(),
          dimensions: z.number(),
        }),
      },
    ],
  ]);

  private providers: Map<ProviderType, ProviderConfig> = new Map();

  async initialize(): Promise<void> {
    await super.initialize();

    // Check available providers
    await this.detectProviders();
  }

  private async detectProviders(): Promise<void> {
    // Ollama (local)
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        this.providers.set('ollama', { type: 'ollama', baseUrl: 'http://localhost:11434' });
        console.log('[llm-inference] Ollama detected');
      }
    } catch {
      // Ollama not available
    }

    // OpenAI (check env)
    if (process.env.OPENAI_API_KEY) {
      this.providers.set('openai', {
        type: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        organization: process.env.OPENAI_ORGANIZATION,
      });
      console.log('[llm-inference] OpenAI configured');
    }

    // Anthropic (check env)
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', {
        type: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      });
      console.log('[llm-inference] Anthropic configured');
    }

    // Azure OpenAI (check env)
    if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
      this.providers.set('azure', {
        type: 'azure',
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
      });
      console.log('[llm-inference] Azure OpenAI configured');
    }

    // AWS Bedrock (check env)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.providers.set('bedrock', {
        type: 'bedrock',
        region: process.env.AWS_REGION || 'us-east-1',
      });
      console.log('[llm-inference] AWS Bedrock configured');
    }
  }

  async execute(
    method: string,
    params: unknown,
    context: ExecutionContext
  ): Promise<unknown> {
    switch (method) {
      case 'generate':
        return this.generate(params, context);
      case 'chat':
        return this.chat(params, context);
      case 'list_models':
        return this.listModels(params);
      case 'list_providers':
        return this.listProviders();
      case 'embed':
        return this.generateEmbedding(params, context);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private getProvider(request: ExtendedLlmRequest): ProviderConfig {
    // Use specified provider or find best available
    const providerType = request.provider || this.selectBestProvider(request.model);

    // Check for runtime API key or base_url override
    if (request.api_key || request.base_url) {
      return {
        type: providerType,
        apiKey: request.api_key,
        baseUrl: request.base_url || this.providers.get(providerType)?.baseUrl,
      };
    }

    const config = this.providers.get(providerType);
    if (!config) {
      // For Ollama without a detected local instance, create a config
      // This allows remote Ollama nodes to work even if local Ollama isn't running
      if (providerType === 'ollama') {
        return {
          type: 'ollama',
          baseUrl: 'http://localhost:11434',
        };
      }
      throw new Error(`Provider '${providerType}' not available. Configure API key or use Ollama locally.`);
    }

    return config;
  }

  private selectBestProvider(model: string): ProviderType {
    // Check if model hints at a provider
    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) {
      if (this.providers.has('openai')) return 'openai';
      if (this.providers.has('azure')) return 'azure';
    }
    if (model.startsWith('claude')) {
      if (this.providers.has('anthropic')) return 'anthropic';
      if (this.providers.has('bedrock')) return 'bedrock';
    }

    // Default to Ollama if available, otherwise first available
    if (this.providers.has('ollama')) return 'ollama';

    const firstProvider = this.providers.keys().next().value;
    if (firstProvider) return firstProvider;

    throw new Error('No LLM providers available');
  }

  private async generate(
    params: unknown,
    context: ExecutionContext
  ): Promise<LlmInferenceResponse> {
    const request = ExtendedLlmRequestSchema.parse(params);
    const provider = this.getProvider(request);

    console.log(`[llm-inference] Generating with ${provider.type}/${request.model}`);

    switch (provider.type) {
      case 'ollama':
        return this.generateOllama(request, provider);
      case 'openai':
      case 'azure':
        return this.generateOpenAI(request, provider);
      case 'anthropic':
        return this.generateAnthropic(request, provider);
      case 'bedrock':
        return this.generateBedrock(request, provider);
      default:
        throw new Error(`Unsupported provider: ${provider.type}`);
    }
  }

  private async chat(
    params: unknown,
    context: ExecutionContext
  ): Promise<LlmInferenceResponse> {
    const request = ExtendedLlmRequestSchema.parse(params);
    const provider = this.getProvider(request);

    // Ensure we have either messages or prompt
    if (!request.messages && !request.prompt) {
      throw new Error('Either messages or prompt must be provided');
    }

    // For Ollama, convert messages to a single prompt
    if (provider.type === 'ollama') {
      const prompt = request.messages
        ? request.messages.map(m => `${m.role}: ${m.content}`).join('\n\n')
        : request.prompt;
      return this.generateOllama({ ...request, prompt: prompt! }, provider);
    }

    // For OpenAI/Azure, use chat endpoint directly
    if (provider.type === 'openai' || provider.type === 'azure') {
      // Ensure messages exist, convert from prompt if needed
      const messages = request.messages || [{ role: 'user' as const, content: request.prompt! }];
      return this.generateOpenAI({ ...request, messages }, provider);
    }

    // For Anthropic
    if (provider.type === 'anthropic') {
      const messages = request.messages || [{ role: 'user' as const, content: request.prompt! }];
      return this.generateAnthropic({ ...request, messages }, provider);
    }

    // Fallback: convert messages to prompt for generate
    const prompt = request.messages
      ? request.messages.map(m => `${m.role}: ${m.content}`).join('\n\n')
      : request.prompt;
    return this.generate({ ...request, prompt: prompt! }, context);
  }

  // ============ Provider Implementations ============

  private async generateOllama(
    request: ExtendedLlmRequest,
    config: ProviderConfig
  ): Promise<LlmInferenceResponse> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        stream: false,
        options: {
          temperature: request.temperature,
          top_p: request.top_p,
          num_predict: request.max_tokens,
          stop: request.stop_sequences,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      response: string;
      eval_count: number;
      prompt_eval_count: number;
      done_reason?: string;
    };

    return {
      text: data.response,
      tokens_generated: data.eval_count || 0,
      tokens_prompt: data.prompt_eval_count || 0,
      finish_reason: data.done_reason === 'stop' ? 'stop' : 'length',
    };
  }

  private async generateOpenAI(
    request: ExtendedLlmRequest,
    config: ProviderConfig
  ): Promise<LlmInferenceResponse> {
    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    const isAzure = config.type === 'azure';

    const messages = request.messages || [{ role: 'user' as const, content: request.prompt }];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isAzure) {
      headers['api-key'] = config.apiKey!;
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      if (config.organization) {
        headers['OpenAI-Organization'] = config.organization;
      }
    }

    const endpoint = isAzure
      ? `${baseUrl}/openai/deployments/${request.model}/chat/completions?api-version=2024-02-15-preview`
      : `${baseUrl}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: isAzure ? undefined : request.model,
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        stop: request.stop_sequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content || '',
      tokens_generated: data.usage?.completion_tokens || 0,
      tokens_prompt: data.usage?.prompt_tokens || 0,
      finish_reason: data.choices[0]?.finish_reason === 'stop' ? 'stop' : 'length',
    };
  }

  private async generateAnthropic(
    request: ExtendedLlmRequest,
    config: ProviderConfig
  ): Promise<LlmInferenceResponse> {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';

    const messages = request.messages || [{ role: 'user' as const, content: request.prompt }];

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model,
        messages: messages.filter(m => m.role !== 'system'),
        system: messages.find(m => m.role === 'system')?.content,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        stop_sequences: request.stop_sequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };

    const text = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    return {
      text,
      tokens_generated: data.usage?.output_tokens || 0,
      tokens_prompt: data.usage?.input_tokens || 0,
      finish_reason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  private async generateBedrock(
    request: ExtendedLlmRequest,
    config: ProviderConfig
  ): Promise<LlmInferenceResponse> {
    // AWS Bedrock requires AWS SDK - for now, throw helpful error
    throw new Error(
      'AWS Bedrock requires @aws-sdk/client-bedrock-runtime. ' +
      'Install it and implement signing logic for production use.'
    );
  }

  // ============ Model Listing ============

  private async listModels(params: unknown): Promise<Array<{ name: string; provider: string; size?: number }>> {
    const { provider } = z.object({ provider: z.string().optional() }).parse(params);
    const models: Array<{ name: string; provider: string; size?: number }> = [];

    const providersToCheck = provider
      ? [provider as ProviderType]
      : Array.from(this.providers.keys());

    for (const p of providersToCheck) {
      if (p === 'ollama' && this.providers.has('ollama')) {
        // Fetch actual Ollama models
        try {
          const config = this.providers.get('ollama')!;
          const response = await fetch(`${config.baseUrl}/api/tags`);
          if (response.ok) {
            const data = await response.json() as { models: Array<{ name: string; size: number }> };
            for (const m of data.models || []) {
              models.push({ name: m.name, provider: 'ollama', size: m.size });
            }
          }
        } catch {
          // Add known models as fallback
          for (const m of PROVIDER_MODELS.ollama.known) {
            models.push({ name: m, provider: 'ollama' });
          }
        }
      } else if (this.providers.has(p)) {
        // Add known models for configured providers
        for (const m of PROVIDER_MODELS[p]?.known || []) {
          models.push({ name: m, provider: p });
        }
      }
    }

    return models;
  }

  private listProviders(): Array<{ name: string; available: boolean; default_model: string }> {
    return Object.entries(PROVIDER_MODELS).map(([name, config]) => ({
      name,
      available: this.providers.has(name as ProviderType),
      default_model: config.default,
    }));
  }

  /**
   * Generate embeddings for text
   */
  private async generateEmbedding(
    params: unknown,
    context: ExecutionContext
  ): Promise<{ embedding: number[]; model: string; dimensions: number }> {
    const request = z.object({
      model: z.string(),
      provider: z.enum(['ollama', 'openai', 'anthropic', 'azure', 'bedrock']).optional(),
      text: z.string(),
      api_key: z.string().optional(),
    }).parse(params);

    const providerType = request.provider || this.selectBestProvider(request.model);

    switch (providerType) {
      case 'ollama':
        return this.ollamaEmbed(request.model, request.text);
      case 'openai':
        return this.openaiEmbed(request.model, request.text, request.api_key);
      default:
        throw new Error(`Embeddings not supported for provider: ${providerType}`);
    }
  }

  private async ollamaEmbed(
    model: string,
    text: string
  ): Promise<{ embedding: number[]; model: string; dimensions: number }> {
    const baseUrl = this.providers.get('ollama')?.baseUrl || 'http://localhost:11434';

    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { embedding: number[] };

    return {
      embedding: data.embedding,
      model,
      dimensions: data.embedding.length,
    };
  }

  private async openaiEmbed(
    model: string,
    text: string,
    apiKey?: string
  ): Promise<{ embedding: number[]; model: string; dimensions: number }> {
    const key = apiKey || this.providers.get('openai')?.apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OpenAI API key required for embeddings');

    const embeddingModel = model.includes('embed') ? model : 'text-embedding-3-small';

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    const embedding = data.data[0].embedding;

    return {
      embedding,
      model: embeddingModel,
      dimensions: embedding.length,
    };
  }
}
