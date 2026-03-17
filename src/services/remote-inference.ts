/**
 * Remote Inference Service — relay AI requests to OtherThing's hosted endpoint
 *
 * Speaks the same Ollama /api/chat protocol so all existing services
 * (digest, health, handoff, dispute, safety) work without changes.
 * Premium users without local GPUs get routed here automatically.
 */

export interface RemoteInferenceConfig {
  endpoint: string;   // e.g. https://inference.otherthing.dev
  apiKey: string;      // platform API key for auth
  model?: string;      // default model on the remote server
}

class RemoteInferenceService {
  private config: RemoteInferenceConfig | null = null;
  private available = false;

  configure(config: RemoteInferenceConfig): void {
    this.config = config;
    this.available = true;
    console.log(`[RemoteInference] Configured: ${config.endpoint}`);
  }

  isConfigured(): boolean {
    return this.available && !!this.config;
  }

  getEndpoint(): string | null {
    return this.config?.endpoint || null;
  }

  /**
   * Check if the remote inference server is reachable.
   */
  async checkHealth(): Promise<boolean> {
    if (!this.config) return false;
    try {
      const res = await fetch(`${this.config.endpoint}/api/tags`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * List models available on the remote server.
   */
  async getModels(): Promise<Array<{ name: string; size: number }>> {
    if (!this.config) return [];
    try {
      const res = await fetch(`${this.config.endpoint}/api/tags`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map((m: any) => ({ name: m.name, size: m.size }));
    } catch {
      return [];
    }
  }

  /**
   * Run inference via the remote server. Same interface as OllamaManager.chat().
   */
  async chat(request: {
    model?: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    max_tokens?: number;
    temperature?: number;
  }): Promise<{
    content: string;
    model: string;
    tokens_used?: number;
    remote: true;
  }> {
    if (!this.config) throw new Error('Remote inference not configured');

    const model = request.model || this.config.model || 'gemma3:4b';

    const res = await fetch(`${this.config.endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: false,
        options: {
          num_predict: request.max_tokens || 4096,
          temperature: request.temperature || 0.7,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'Unknown error');
      throw new Error(`Remote inference failed (${res.status}): ${err}`);
    }

    const data = await res.json();

    return {
      content: data.message?.content || data.response || '',
      model,
      tokens_used: data.eval_count,
      remote: true,
    };
  }

  /**
   * Stream inference via SSE — for the chat endpoint.
   * Returns a ReadableStream that can be piped to the client.
   */
  async chatStream(request: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    max_tokens?: number;
  }): Promise<Response> {
    if (!this.config) throw new Error('Remote inference not configured');

    const model = request.model || this.config.model || 'gemma3:4b';

    return fetch(`${this.config.endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: true,
        options: {
          num_predict: request.max_tokens || 4096,
          temperature: request.temperature || 0.7,
        },
      }),
    });
  }
}

export const remoteInferenceService = new RemoteInferenceService();
