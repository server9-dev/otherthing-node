/**
 * Semantic Memory Service
 *
 * Provides semantic memory storage and retrieval for AI agents using
 * ELID-encoded embeddings. This enables vector search without a vector
 * database by storing locality-preserving string IDs in simple JSON storage.
 *
 * Features:
 * - Store conversation context with semantic embeddings
 * - Retrieve relevant memories by semantic similarity
 * - Works with any embedding model supported by Ollama
 * - Persists to disk in JSON format
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { OllamaManager } from '../ollama-manager';
import { elidService, ElidMemoryEntry, ElidSearchResult, ElidEncodingProfile } from './elid-service';

/**
 * Memory types for categorization
 */
export type MemoryType = 'conversation' | 'fact' | 'task' | 'code' | 'file' | 'custom';

/**
 * Memory entry with full metadata
 */
export interface SemanticMemory extends ElidMemoryEntry {
  workspaceId: string;
  type: MemoryType;
  source?: string;
  tags?: string[];
}

/**
 * Memory store configuration
 */
export interface MemoryStoreConfig {
  storagePath: string;
  embeddingModel: string;
  encodingProfile: ElidEncodingProfile;
  maxMemories: number;
}

/**
 * Search options for memory retrieval
 */
export interface MemorySearchOptions {
  limit?: number;
  maxDistance?: number;
  type?: MemoryType;
  tags?: string[];
  minTimestamp?: number;
  maxTimestamp?: number;
}

const DEFAULT_CONFIG: MemoryStoreConfig = {
  storagePath: '',
  embeddingModel: 'nomic-embed-text',
  encodingProfile: 'mini128',
  maxMemories: 10000,
};

export class SemanticMemoryService {
  private config: MemoryStoreConfig;
  private memories: Map<string, SemanticMemory[]> = new Map(); // workspaceId -> memories
  private ollamaManager: OllamaManager | null = null;
  private initialized = false;

  constructor(config: Partial<MemoryStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the Ollama manager for generating embeddings
   */
  setOllamaManager(ollama: OllamaManager): void {
    this.ollamaManager = ollama;
  }

  /**
   * Initialize the memory service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize ELID service
    await elidService.initialize();

    // Load existing memories from disk if storage path is set
    if (this.config.storagePath) {
      await this.loadFromDisk();
    }

    this.initialized = true;
    console.log('[SemanticMemory] Service initialized');
  }

  /**
   * Generate embedding for text using Ollama
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.ollamaManager) {
      throw new Error('Ollama manager not set - call setOllamaManager first');
    }

    const result = await this.ollamaManager.embeddings({
      model: this.config.embeddingModel,
      prompt: text,
    });

    return result.embeddings[0];
  }

  /**
   * Store a memory with semantic embedding
   *
   * @param workspaceId - Workspace to store memory in
   * @param content - Text content to store
   * @param type - Type of memory
   * @param metadata - Optional additional metadata
   * @returns The created memory entry
   */
  async store(
    workspaceId: string,
    content: string,
    type: MemoryType = 'conversation',
    metadata: Record<string, unknown> = {}
  ): Promise<SemanticMemory> {
    await this.initialize();

    // Generate embedding
    const embedding = await this.generateEmbedding(content);

    // Encode to ELID
    const elidStr = elidService.encodeEmbedding(embedding, this.config.encodingProfile);

    // Create memory entry
    const memory: SemanticMemory = {
      id: uuidv4(),
      elid: elidStr,
      content,
      workspaceId,
      type,
      metadata,
      timestamp: Date.now(),
      tags: metadata.tags as string[] | undefined,
      source: metadata.source as string | undefined,
    };

    // Get or create workspace memories
    if (!this.memories.has(workspaceId)) {
      this.memories.set(workspaceId, []);
    }

    const workspaceMemories = this.memories.get(workspaceId)!;

    // Enforce max memories limit (remove oldest)
    if (workspaceMemories.length >= this.config.maxMemories) {
      workspaceMemories.shift();
    }

    workspaceMemories.push(memory);

    // Persist to disk
    await this.saveToDisk(workspaceId);

    console.log(`[SemanticMemory] Stored memory ${memory.id} in workspace ${workspaceId}`);
    return memory;
  }

  /**
   * Store multiple memories in batch
   */
  async storeBatch(
    workspaceId: string,
    items: Array<{ content: string; type?: MemoryType; metadata?: Record<string, unknown> }>
  ): Promise<SemanticMemory[]> {
    const results: SemanticMemory[] = [];
    for (const item of items) {
      const memory = await this.store(
        workspaceId,
        item.content,
        item.type || 'conversation',
        item.metadata || {}
      );
      results.push(memory);
    }
    return results;
  }

  /**
   * Search for relevant memories by semantic similarity
   *
   * @param workspaceId - Workspace to search in
   * @param query - Query text
   * @param options - Search options
   * @returns Array of matching memories with similarity scores
   */
  async search(
    workspaceId: string,
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<ElidSearchResult[]> {
    await this.initialize();

    const {
      limit = 10,
      maxDistance = 64,
      type,
      tags,
      minTimestamp,
      maxTimestamp,
    } = options;

    // Get workspace memories
    const workspaceMemories = this.memories.get(workspaceId) || [];

    if (workspaceMemories.length === 0) {
      return [];
    }

    // Pre-filter by non-semantic criteria
    let filtered = workspaceMemories;

    if (type) {
      filtered = filtered.filter(m => m.type === type);
    }

    if (tags && tags.length > 0) {
      filtered = filtered.filter(m =>
        m.tags && tags.some(t => m.tags!.includes(t))
      );
    }

    if (minTimestamp) {
      filtered = filtered.filter(m => m.timestamp >= minTimestamp);
    }

    if (maxTimestamp) {
      filtered = filtered.filter(m => m.timestamp <= maxTimestamp);
    }

    if (filtered.length === 0) {
      return [];
    }

    // Generate query embedding and encode
    const queryEmbedding = await this.generateEmbedding(query);
    const queryElid = elidService.encodeEmbedding(queryEmbedding, this.config.encodingProfile);

    // Find similar using ELID
    const results = elidService.findSimilar(queryElid, filtered, limit, maxDistance);

    console.log(`[SemanticMemory] Search found ${results.length} results for query in workspace ${workspaceId}`);
    return results;
  }

  /**
   * Get recent memories from a workspace
   */
  getRecent(workspaceId: string, limit: number = 10): SemanticMemory[] {
    const workspaceMemories = this.memories.get(workspaceId) || [];
    return workspaceMemories
      .slice(-limit)
      .reverse();
  }

  /**
   * Get a specific memory by ID
   */
  get(workspaceId: string, memoryId: string): SemanticMemory | undefined {
    const workspaceMemories = this.memories.get(workspaceId) || [];
    return workspaceMemories.find(m => m.id === memoryId);
  }

  /**
   * Delete a memory by ID
   */
  async delete(workspaceId: string, memoryId: string): Promise<boolean> {
    const workspaceMemories = this.memories.get(workspaceId);
    if (!workspaceMemories) return false;

    const index = workspaceMemories.findIndex(m => m.id === memoryId);
    if (index === -1) return false;

    workspaceMemories.splice(index, 1);
    await this.saveToDisk(workspaceId);
    return true;
  }

  /**
   * Clear all memories for a workspace
   */
  async clear(workspaceId: string): Promise<void> {
    this.memories.set(workspaceId, []);
    await this.saveToDisk(workspaceId);
    console.log(`[SemanticMemory] Cleared all memories for workspace ${workspaceId}`);
  }

  /**
   * Get memory statistics
   */
  getStats(workspaceId: string): {
    totalMemories: number;
    byType: Record<MemoryType, number>;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    const workspaceMemories = this.memories.get(workspaceId) || [];

    const byType: Record<MemoryType, number> = {
      conversation: 0,
      fact: 0,
      task: 0,
      code: 0,
      file: 0,
      custom: 0,
    };

    for (const m of workspaceMemories) {
      byType[m.type]++;
    }

    return {
      totalMemories: workspaceMemories.length,
      byType,
      oldestTimestamp: workspaceMemories.length > 0 ? workspaceMemories[0].timestamp : null,
      newestTimestamp: workspaceMemories.length > 0 ? workspaceMemories[workspaceMemories.length - 1].timestamp : null,
    };
  }

  // ============ Persistence ============

  private getStorageFilePath(workspaceId: string): string {
    if (!this.config.storagePath) {
      // Default to app data directory
      const appDataPath = process.env.APPDATA ||
        (process.platform === 'darwin'
          ? path.join(process.env.HOME || '', 'Library', 'Application Support')
          : path.join(process.env.HOME || '', '.config'));

      this.config.storagePath = path.join(appDataPath, 'otherthing-node', 'memories');
    }

    // Ensure directory exists
    if (!fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, { recursive: true });
    }

    return path.join(this.config.storagePath, `${workspaceId}.json`);
  }

  private async saveToDisk(workspaceId: string): Promise<void> {
    if (!this.config.storagePath && !process.env.APPDATA && !process.env.HOME) {
      return; // Skip persistence in environments without home directory
    }

    const filePath = this.getStorageFilePath(workspaceId);
    const workspaceMemories = this.memories.get(workspaceId) || [];

    try {
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(workspaceMemories, null, 2),
        'utf-8'
      );
    } catch (err) {
      console.error(`[SemanticMemory] Failed to save memories: ${err}`);
    }
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.config.storagePath) return;

    try {
      if (!fs.existsSync(this.config.storagePath)) {
        return;
      }

      const files = await fs.promises.readdir(this.config.storagePath);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const workspaceId = file.replace('.json', '');
        const filePath = path.join(this.config.storagePath, file);

        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const memories = JSON.parse(content) as SemanticMemory[];
          this.memories.set(workspaceId, memories);
          console.log(`[SemanticMemory] Loaded ${memories.length} memories for workspace ${workspaceId}`);
        } catch (err) {
          console.error(`[SemanticMemory] Failed to load ${file}: ${err}`);
        }
      }
    } catch (err) {
      console.error(`[SemanticMemory] Failed to load memories from disk: ${err}`);
    }
  }

  /**
   * Export all memories for a workspace
   */
  exportMemories(workspaceId: string): SemanticMemory[] {
    return this.memories.get(workspaceId) || [];
  }

  /**
   * Import memories into a workspace
   */
  async importMemories(workspaceId: string, memories: SemanticMemory[]): Promise<void> {
    if (!this.memories.has(workspaceId)) {
      this.memories.set(workspaceId, []);
    }

    const workspaceMemories = this.memories.get(workspaceId)!;
    workspaceMemories.push(...memories);

    // Enforce max limit
    while (workspaceMemories.length > this.config.maxMemories) {
      workspaceMemories.shift();
    }

    await this.saveToDisk(workspaceId);
  }
}

// Singleton instance
export const semanticMemory = new SemanticMemoryService();
