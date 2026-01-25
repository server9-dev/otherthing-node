/**
 * MCP Adapter Types
 *
 * Type definitions for RhizOS MCP adapters.
 */

import { z } from 'zod';

// ============ Adapter Registration ============

export interface AdapterInfo {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  requirements: AdapterRequirements;
}

export interface AdapterRequirements {
  gpu?: {
    required: boolean;
    min_vram_mb?: number;
    compute_apis?: ('cuda' | 'rocm' | 'vulkan' | 'metal')[];
  };
  cpu?: {
    min_cores?: number;
    features?: string[];
  };
  memory?: {
    min_mb: number;
  };
}

// ============ Adapter Methods ============

export interface AdapterMethod {
  name: string;
  description: string;
  parameters: z.ZodType<unknown>;
  returns: z.ZodType<unknown>;
}

// ============ Execution Context ============

export interface ExecutionContext {
  job_id: string;
  timeout_seconds: number;
  hardware: {
    gpus: GpuInfo[];
    cpu_cores: number;
    memory_mb: number;
  };
  on_progress?: (progress: number, message?: string) => void;
}

export interface GpuInfo {
  index: number;
  vendor: string;
  model: string;
  vram_mb: number;
}

// ============ Common Payloads ============

export const LlmInferenceRequestSchema = z.object({
  model: z.string(),
  prompt: z.string(),
  max_tokens: z.number().optional().default(2048),
  temperature: z.number().optional().default(0.7),
  top_p: z.number().optional().default(0.9),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional().default(false),
});

export type LlmInferenceRequest = z.infer<typeof LlmInferenceRequestSchema>;

export const LlmInferenceResponseSchema = z.object({
  text: z.string(),
  tokens_generated: z.number(),
  tokens_prompt: z.number(),
  finish_reason: z.enum(['stop', 'length', 'error']),
});

export type LlmInferenceResponse = z.infer<typeof LlmInferenceResponseSchema>;

export const ImageGenRequestSchema = z.object({
  model: z.string(),
  prompt: z.string(),
  negative_prompt: z.string().optional(),
  width: z.number().default(1024),
  height: z.number().default(1024),
  steps: z.number().default(30),
  guidance_scale: z.number().default(7.5),
  seed: z.number().optional(),
});

export type ImageGenRequest = z.infer<typeof ImageGenRequestSchema>;

export const ImageGenResponseSchema = z.object({
  images: z.array(z.object({
    data: z.string(), // base64
    width: z.number(),
    height: z.number(),
  })),
  seed: z.number(),
});

export type ImageGenResponse = z.infer<typeof ImageGenResponseSchema>;

// ============ Node/Ollama Types (for model selector) ============

export interface OllamaModel {
  name: string;
  size: number;
  quantization_level?: string;
}

export interface ConnectedNode {
  id: string;
  name?: string;
  available: boolean;
  capabilities: {
    ollama?: {
      installed: boolean;
      endpoint?: string;
      models?: OllamaModel[];
    };
    gpus: Array<{
      model: string;
      vram_mb: number;
    }>;
    memory?: {
      total_mb: number;
      available_mb: number;
    };
    storage?: {
      path?: string;
      available_gb?: number;
    };
  };
}
