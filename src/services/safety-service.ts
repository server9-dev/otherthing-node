/**
 * Safety Service — content moderation engine
 *
 * Two-pass design for instant chat:
 *   Pass 1: Synchronous keyword blocklist (<1ms) — blocks obvious prohibited content
 *   Pass 2: Async LlamaGuard via Ollama — catches nuanced violations, retroactively removes
 *
 * Policy: assume all users are minors. Block everything S1-S13 EXCEPT profanity.
 */

import type { OllamaManager } from '../ollama-manager';

export type ViolationCategory =
  | 'S1'  // Violent crimes
  | 'S2'  // Child safety (ALWAYS block)
  | 'S3'  // Non-consensual intimate content
  | 'S4'  // Illegal content
  | 'S5'  // Defamation / harassment
  | 'S6'  // High-risk professional advice
  | 'S7'  // Privacy violations / doxxing
  | 'S8'  // IP violations
  | 'S9'  // Weapons / controlled substances
  | 'S10' // Hate speech
  | 'S11' // Self-harm
  | 'S12' // Sexual content
  | 'S13'; // Election manipulation

export interface ScanResult {
  safe: boolean;
  category: ViolationCategory | null;
  reason: string;
  method: 'keyword' | 'llamaguard' | 'vision';
}

// Patterns that indicate prohibited content (NOT profanity — profanity is allowed)
// These are kept minimal and targeted to avoid false positives on dev discussions
const KEYWORD_PATTERNS: Array<{ pattern: RegExp; category: ViolationCategory; reason: string }> = [
  // S2 — Child safety (zero tolerance)
  { pattern: /\bc\s*s\s*a\s*m\b/i, category: 'S2', reason: 'Child safety violation' },
  { pattern: /\bchild\s+(porn|exploitation|abuse\s+material)/i, category: 'S2', reason: 'Child safety violation' },
  { pattern: /\bminor\s+(nude|naked|sexual)/i, category: 'S2', reason: 'Child safety violation' },
  { pattern: /\bunderage\s+(sex|nude|naked)/i, category: 'S2', reason: 'Child safety violation' },

  // S1 — Violent crimes / threats
  { pattern: /\b(i('ll|m\s+going\s+to)|gonna|going\s+to)\s+(kill|murder|shoot|stab|bomb)\s+(you|him|her|them|everyone)/i, category: 'S1', reason: 'Violent threat' },
  { pattern: /\bhow\s+to\s+(make\s+a\s+bomb|build\s+.*explosive|synthesize\s+.*poison)/i, category: 'S1', reason: 'Violence instruction' },

  // S4 — Illegal content (narrow patterns to avoid false positives on security/dev discussions)
  { pattern: /\bhow\s+to\s+hack\s+into\s+(someone|a\s+person|their)\b/i, category: 'S4', reason: 'Illegal activity instruction' },
  { pattern: /\b(credit\s+card\s+fraud\s+guide|identity\s+theft\s+tutorial|money\s+laundering\s+step)/i, category: 'S4', reason: 'Financial crime' },

  // S9 — Weapons / drugs synthesis
  { pattern: /\bhow\s+to\s+(make|synthesize|cook)\s+(meth|fentanyl|heroin|cocaine)/i, category: 'S9', reason: 'Drug synthesis instruction' },
  { pattern: /\b(3d\s*print.*gun|ghost\s+gun\s+build|untraceable\s+firearm)/i, category: 'S9', reason: 'Weapons manufacturing' },

  // S7 — Doxxing
  { pattern: /\b(dox|doxx|swat)\s+(this|that|the)\s+(person|user|guy|kid)/i, category: 'S7', reason: 'Doxxing / swatting' },

  // S12 — Sexual content (strict — all users treated as minors)
  { pattern: /\b(porn|hentai|xxx|nsfw\s+content)\b/i, category: 'S12', reason: 'Sexual content (minor-safe policy)' },
];

class SafetyService {
  private ollamaManager: OllamaManager | null = null;
  private scanQueue: Array<{ id: string; workspaceId: string; content: string; onViolation: (result: ScanResult) => void }> = [];
  private processing = false;

  setOllamaManager(ollama: OllamaManager | null): void {
    this.ollamaManager = ollama;
  }

  /**
   * Pass 1: Instant keyword scan (<1ms). Call synchronously before saving content.
   * Returns null if safe, ScanResult if blocked.
   */
  scanKeywords(text: string): ScanResult | null {
    const lower = text.toLowerCase();
    for (const { pattern, category, reason } of KEYWORD_PATTERNS) {
      if (pattern.test(lower)) {
        return { safe: false, category, reason, method: 'keyword' };
      }
    }
    return null;
  }

  /**
   * Pass 2: Queue async LlamaGuard scan. Runs in background after message is saved.
   * Calls onViolation callback if content is flagged.
   */
  queueAsyncScan(
    id: string,
    workspaceId: string,
    content: string,
    onViolation: (result: ScanResult) => void
  ): void {
    this.scanQueue.push({ id, workspaceId, content, onViolation });
    this.processQueue();
  }

  /**
   * Blocking scan via LlamaGuard. Use for file uploads where waiting is acceptable.
   */
  async scanText(text: string): Promise<ScanResult> {
    // Fast keyword check first
    const keyword = this.scanKeywords(text);
    if (keyword) return keyword;

    // LlamaGuard deep scan
    return this.llamaguardScan(text);
  }

  /**
   * Scan image content description via LlamaGuard Vision.
   * Pass the base64 image or a text description of the image content.
   */
  async scanImageDescription(description: string): Promise<ScanResult> {
    if (!this.ollamaManager) {
      // Fail-open if Ollama unavailable — log but allow
      console.warn('[Safety] Ollama unavailable for image scan, allowing');
      return { safe: true, category: null, reason: '', method: 'vision' };
    }

    try {
      const running = await this.ollamaManager.checkRunning();
      if (!running) {
        return { safe: true, category: null, reason: '', method: 'vision' };
      }

      const result = await this.ollamaManager.chat({
        model: 'llama3.2-vision:11b',
        messages: [
          {
            role: 'system',
            content: `You are a content safety classifier. ALL users are treated as minors.
Classify the described content against these categories. Block everything except profanity/swearing.

Categories:
S1: Violent crimes / threats
S2: Child exploitation (ALWAYS report)
S3: Non-consensual intimate content
S4: Illegal activity
S5: Harassment / bullying
S7: Privacy violations / doxxing
S9: Weapons / drugs
S10: Hate speech / discrimination
S11: Self-harm
S12: Sexual / adult content

Respond ONLY with one line:
SAFE - if content is acceptable
UNSAFE:<category> - <brief reason> if content violates policy

Profanity and swearing are ALLOWED. Do not flag profanity.`,
          },
          { role: 'user', content: `Classify this content: ${description}` },
        ],
        temperature: 0,
      });

      return this.parseLlamaguardResponse(result.content, 'vision');
    } catch (err) {
      console.error('[Safety] Vision scan failed:', err);
      return { safe: true, category: null, reason: '', method: 'vision' };
    }
  }

  private async llamaguardScan(text: string): Promise<ScanResult> {
    if (!this.ollamaManager) {
      return { safe: true, category: null, reason: '', method: 'llamaguard' };
    }

    try {
      const running = await this.ollamaManager.checkRunning();
      if (!running) {
        return { safe: true, category: null, reason: '', method: 'llamaguard' };
      }

      const model = await this.selectModel();
      const result = await this.ollamaManager.chat({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a content safety classifier for a developer workspace. ALL users are treated as minors.
Block content matching these categories:
S1: Violent crimes/threats  S2: Child exploitation  S3: Non-consensual intimate content
S4: Illegal activity  S5: Harassment  S7: Doxxing  S9: Weapons/drugs
S10: Hate speech  S11: Self-harm  S12: Sexual/adult content  S13: Election manipulation

ALLOWED: profanity, swearing, curse words, technical security discussions, code with security contexts, pentesting discussions.

Respond ONLY with one line:
SAFE
UNSAFE:<category> - <reason>`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
      });

      return this.parseLlamaguardResponse(result.content, 'llamaguard');
    } catch (err) {
      console.error('[Safety] LlamaGuard scan failed:', err);
      return { safe: true, category: null, reason: '', method: 'llamaguard' };
    }
  }

  private parseLlamaguardResponse(response: string, method: 'llamaguard' | 'vision'): ScanResult {
    const line = response.trim().split('\n')[0].trim();

    if (line.startsWith('UNSAFE')) {
      const match = line.match(/UNSAFE[:\s]*(S\d+)?\s*[-–]?\s*(.*)/i);
      const category = (match?.[1]?.toUpperCase() as ViolationCategory) || 'S4';
      const reason = match?.[2]?.trim() || 'Content policy violation';
      return { safe: false, category, reason, method };
    }

    return { safe: true, category: null, reason: '', method };
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.scanQueue.length === 0) return;
    this.processing = true;

    while (this.scanQueue.length > 0) {
      const item = this.scanQueue.shift()!;
      try {
        const result = await this.llamaguardScan(item.content);
        if (!result.safe) {
          console.log(`[Safety] Async violation found in ${item.id}: ${result.category} - ${result.reason}`);
          item.onViolation(result);
        }
      } catch (err) {
        console.error(`[Safety] Async scan error for ${item.id}:`, err);
      }
    }

    this.processing = false;
  }

  private async selectModel(): Promise<string> {
    if (!this.ollamaManager) return 'llama3.2';
    try {
      const status = await this.ollamaManager.getStatus();
      const models = status.models || [];
      // Prefer smaller/faster models for safety scanning
      const preferred = models.find((m: any) =>
        m.name.includes('gemma3') || m.name.includes('qwen3:8b') || m.name.includes('llama3.2')
      );
      return preferred?.name || models[0]?.name || 'llama3.2';
    } catch {
      return 'llama3.2';
    }
  }
}

export const safetyService = new SafetyService();
