/**
 * ELID Service
 *
 * Wraps the ELID WASM library for encoding embeddings into locality-preserving
 * string IDs and provides string similarity functions.
 *
 * ELID enables vector search without a vector database by converting embeddings
 * into sortable string IDs that preserve locality - similar embeddings produce
 * similar IDs that can be compared or range-queried in standard databases.
 */

import * as elid from 'elid-wasm/pkg/elid.js';

// Re-export ELID types for convenience
export { ElidProfile, ElidVectorPrecision, ElidDimensionMode } from 'elid-wasm/pkg/elid.js';

/**
 * Encoding profile for ELID
 */
export type ElidEncodingProfile = 'mini128' | 'morton' | 'hilbert' | 'lossless' | 'compressed';

/**
 * Memory entry with ELID-encoded embedding
 */
export interface ElidMemoryEntry {
  id: string;
  elid: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Search result with similarity score
 */
export interface ElidSearchResult {
  entry: ElidMemoryEntry;
  distance: number;
  similarity: number;
}

export class ElidService {
  private initialized = false;

  /**
   * Initialize the ELID WASM module
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // ELID WASM is already loaded via the import
    this.initialized = true;
    console.log('[ELID] Service initialized');
  }

  /**
   * Encode an embedding vector to an ELID string
   *
   * @param embedding - Array of numbers (embedding vector)
   * @param profile - Encoding profile to use
   * @returns ELID string
   */
  encodeEmbedding(
    embedding: number[],
    profile: ElidEncodingProfile = 'mini128'
  ): string {
    const floatArray = new Float64Array(embedding);

    switch (profile) {
      case 'mini128':
        return elid.encodeElid(floatArray, elid.ElidProfile.Mini128);
      case 'morton':
        return elid.encodeElid(floatArray, elid.ElidProfile.Morton10x10);
      case 'hilbert':
        return elid.encodeElid(floatArray, elid.ElidProfile.Hilbert10x10);
      case 'lossless':
        return elid.encodeElidLossless(floatArray);
      case 'compressed':
        return elid.encodeElidCompressed(floatArray, 0.5); // 50% retention
      default:
        return elid.encodeElid(floatArray, elid.ElidProfile.Mini128);
    }
  }

  /**
   * Encode with specific compression ratio
   *
   * @param embedding - Array of numbers (embedding vector)
   * @param retentionPct - Information retention percentage (0.0-1.0)
   * @returns ELID string
   */
  encodeCompressed(embedding: number[], retentionPct: number): string {
    const floatArray = new Float64Array(embedding);
    return elid.encodeElidCompressed(floatArray, retentionPct);
  }

  /**
   * Encode with maximum length constraint
   *
   * @param embedding - Array of numbers (embedding vector)
   * @param maxChars - Maximum output string length
   * @returns ELID string
   */
  encodeMaxLength(embedding: number[], maxChars: number): string {
    const floatArray = new Float64Array(embedding);
    return elid.encodeElidMaxLength(floatArray, maxChars);
  }

  /**
   * Decode an ELID string back to an embedding (only works for reversible profiles)
   *
   * @param elidStr - ELID string
   * @returns Embedding array or null if not reversible
   */
  decodeEmbedding(elidStr: string): number[] | null {
    if (!elid.isElidReversible(elidStr)) {
      return null;
    }
    const result = elid.decodeElidToEmbedding(elidStr);
    return result ? Array.from(result as Float64Array) : null;
  }

  /**
   * Check if an ELID can be decoded back to an embedding
   */
  isReversible(elidStr: string): boolean {
    return elid.isElidReversible(elidStr);
  }

  /**
   * Compute Hamming distance between two Mini128 ELIDs
   * Lower distance = more similar (0-128 range)
   */
  hammingDistance(elid1: string, elid2: string): number {
    return elid.elidHammingDistance(elid1, elid2);
  }

  /**
   * Convert Hamming distance to similarity score (0.0-1.0)
   */
  hammingToSimilarity(distance: number): number {
    return 1 - (distance / 128);
  }

  /**
   * Find most similar entries from a list using Hamming distance
   *
   * @param queryElid - Query ELID string
   * @param entries - List of entries with ELID strings
   * @param limit - Maximum number of results
   * @param maxDistance - Maximum Hamming distance to include (default: 64 = 50% similarity)
   */
  findSimilar(
    queryElid: string,
    entries: ElidMemoryEntry[],
    limit: number = 10,
    maxDistance: number = 64
  ): ElidSearchResult[] {
    const results: ElidSearchResult[] = [];

    for (const entry of entries) {
      try {
        const distance = this.hammingDistance(queryElid, entry.elid);
        if (distance <= maxDistance) {
          results.push({
            entry,
            distance,
            similarity: this.hammingToSimilarity(distance),
          });
        }
      } catch (err) {
        // Skip entries with incompatible ELID formats
        console.warn(`[ELID] Skipping entry ${entry.id}: ${err}`);
      }
    }

    // Sort by distance (ascending) and limit
    return results
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  // ============ String Similarity Functions ============

  /**
   * Compute Levenshtein edit distance between two strings
   */
  levenshtein(a: string, b: string): number {
    return elid.levenshtein(a, b);
  }

  /**
   * Compute normalized Levenshtein similarity (0.0-1.0)
   */
  normalizedLevenshtein(a: string, b: string): number {
    return elid.normalizedLevenshtein(a, b);
  }

  /**
   * Compute Jaro similarity (0.0-1.0)
   */
  jaro(a: string, b: string): number {
    return elid.jaro(a, b);
  }

  /**
   * Compute Jaro-Winkler similarity (0.0-1.0)
   * Gives more favorable ratings to strings with common prefixes
   */
  jaroWinkler(a: string, b: string): number {
    return elid.jaroWinkler(a, b);
  }

  /**
   * Compute SimHash fingerprint for a string
   * Similar strings produce numerically close hashes
   */
  simhash(text: string): number {
    return elid.simhash(text);
  }

  /**
   * Compute SimHash similarity between two strings (0.0-1.0)
   */
  simhashSimilarity(a: string, b: string): number {
    return elid.simhashSimilarity(a, b);
  }

  /**
   * Find the best matching string similarity using multiple algorithms
   */
  bestMatch(a: string, b: string): number {
    return elid.bestMatch(a, b);
  }

  /**
   * Find the best match for a query in a list of candidates
   * @returns Object with index and score of best match
   */
  findBestMatch(query: string, candidates: string[]): { index: number; score: number } {
    return elid.findBestMatch(query, candidates) as { index: number; score: number };
  }

  /**
   * Find all matches above a similarity threshold
   * @returns Array of { index, score } objects
   */
  findMatchesAboveThreshold(
    query: string,
    candidates: string[],
    threshold: number = 0.5
  ): Array<{ index: number; score: number }> {
    return elid.findMatchesAboveThreshold(query, candidates, threshold) as Array<{ index: number; score: number }>;
  }

  /**
   * Get ELID metadata (only for FullVector profiles)
   */
  getMetadata(elidStr: string): {
    originalDims: number;
    encodedDims: number;
    isLossless: boolean;
  } | null {
    return elid.getElidMetadata(elidStr);
  }
}

// Singleton instance
export const elidService = new ElidService();
