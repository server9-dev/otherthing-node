/**
 * Premium Service — checks if a wallet has active premium subscription
 *
 * Premium unlocks hosted AI inference for users without local GPUs.
 * Cost: 20 OTT/month. Checked via on-chain balance or subscription flag.
 */

export interface PremiumStatus {
  active: boolean;
  tier: 'free' | 'premium';
  expiresAt: string | null;
  features: string[];
}

const FREE_FEATURES = ['keyword-safety', 'raw-metrics', 'task-management', 'chat', 'ipfs-storage', 'escrow'];
const PREMIUM_FEATURES = [...FREE_FEATURES, 'ai-digest', 'ai-health-report', 'ai-handoff', 'ai-dispute', 'ai-chat', 'remote-inference'];

class PremiumService {
  // In-memory premium status cache (wallet address -> status)
  // In production this would check on-chain subscription contract
  private subscriptions: Map<string, { expiresAt: string }> = new Map();

  /**
   * Check if a wallet has active premium.
   * For now: checks in-memory cache. In production: reads from a
   * PremiumSubscription smart contract or checks OTT balance.
   */
  isPremium(walletAddress: string): PremiumStatus {
    if (!walletAddress) {
      return { active: false, tier: 'free', expiresAt: null, features: FREE_FEATURES };
    }

    const sub = this.subscriptions.get(walletAddress.toLowerCase());
    if (sub && new Date(sub.expiresAt) > new Date()) {
      return {
        active: true,
        tier: 'premium',
        expiresAt: sub.expiresAt,
        features: PREMIUM_FEATURES,
      };
    }

    return { active: false, tier: 'free', expiresAt: null, features: FREE_FEATURES };
  }

  /**
   * Activate premium for a wallet. In production this would be called
   * by a chain sync listener watching for OTT transfer to the subscription contract.
   */
  activate(walletAddress: string, durationDays = 30): PremiumStatus {
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    this.subscriptions.set(walletAddress.toLowerCase(), { expiresAt });
    console.log(`[Premium] Activated for ${walletAddress} until ${expiresAt}`);
    return this.isPremium(walletAddress);
  }

  /**
   * Deactivate premium (admin or expiry).
   */
  deactivate(walletAddress: string): void {
    this.subscriptions.delete(walletAddress.toLowerCase());
  }

  /**
   * List all active subscriptions (admin).
   */
  getActiveSubscriptions(): Array<{ wallet: string; expiresAt: string }> {
    const active: Array<{ wallet: string; expiresAt: string }> = [];
    const now = new Date();
    for (const [wallet, sub] of this.subscriptions) {
      if (new Date(sub.expiresAt) > now) {
        active.push({ wallet, expiresAt: sub.expiresAt });
      }
    }
    return active;
  }
}

export const premiumService = new PremiumService();
