/**
 * Remote Inference Service — relay AI requests via OpenRouter
 *
 * OpenAI-compatible API, pay-per-token, scales to zero.
 * Premium users without local GPUs get routed here automatically.
 * Rate limited to prevent runaway costs before paid users onboard.
 */

export interface RemoteInferenceConfig {
  apiKey: string;
  model?: string;           // default model
  dailyLimit?: number;      // max requests per day platform-wide
}

class RemoteInferenceService {
  private config: RemoteInferenceConfig | null = null;
  private available = false;

  // Rate limiting
  private requestsToday = 0;
  private rateLimitResetDate: string = new Date().toDateString();

  configure(config: RemoteInferenceConfig): void {
    this.config = config;
    this.available = true;
    console.log(`[RemoteInference] OpenRouter configured (limit: ${config.dailyLimit || 100}/day)`);
  }

  isConfigured(): boolean {
    return this.available && !!this.config;
  }

  getEndpoint(): string | null {
    return this.config ? 'https://openrouter.ai' : null;
  }

  getRemainingRequests(): number {
    this.checkReset();
    return (this.config?.dailyLimit || 100) - this.requestsToday;
  }

  private checkReset(): void {
    const today = new Date().toDateString();
    if (today !== this.rateLimitResetDate) {
      this.requestsToday = 0;
      this.rateLimitResetDate = today;
    }
  }

  private checkRateLimit(): boolean {
    this.checkReset();
    const limit = this.config?.dailyLimit || 100;
    if (this.requestsToday >= limit) {
      console.warn(`[RemoteInference] Daily limit reached (${limit})`);
      return false;
    }
    return true;
  }

  async checkHealth(): Promise<boolean> {
    if (!this.config) return false;
    if (!this.checkRateLimit()) return false;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<Array<{ name: string; id: string }>> {
    if (!this.config) return [];
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data: any = await res.json();
      // Return a curated subset, not the full 200+ model list
      const preferred = ['google/gemma-3-4b-it:free', 'meta-llama/llama-3.1-8b-instruct:free', 'qwen/qwen3-8b:free'];
      return (data.data || [])
        .filter((m: any) => preferred.some(p => m.id.includes(p.split(':')[0])))
        .slice(0, 10)
        .map((m: any) => ({ name: m.name || m.id, id: m.id }));
    } catch {
      return [];
    }
  }

  /**
   * Run inference via OpenRouter. Same return shape as OllamaManager.chat().
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
    if (!this.checkRateLimit()) throw new Error('Daily inference limit reached. Try again tomorrow or use a local model.');

    const model = request.model || this.config.model || 'google/gemma-3-4b-it:free';

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://otherthing.dev',
        'X-Title': 'OtherThing Workspace',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature || 0.7,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    this.requestsToday++;

    if (!res.ok) {
      const err = await res.text().catch(() => 'Unknown error');
      throw new Error(`OpenRouter request failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      model,
      tokens_used: data.usage?.total_tokens,
      remote: true,
    };
  }

  /**
   * Stream inference via SSE — for the chat endpoint.
   */
  async chatStream(request: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    max_tokens?: number;
  }): Promise<Response> {
    if (!this.config) throw new Error('Remote inference not configured');
    if (!this.checkRateLimit()) throw new Error('Daily inference limit reached');

    const model = request.model || this.config.model || 'google/gemma-3-4b-it:free';
    this.requestsToday++;

    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://otherthing.dev',
        'X-Title': 'OtherThing Workspace',
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature || 0.7,
        stream: true,
      }),
    });
  }
}

export const remoteInferenceService = new RemoteInferenceService();
