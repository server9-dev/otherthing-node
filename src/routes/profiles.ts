/**
 * Profile Routes - user profiles + wallet linking
 */

import { Request, Response } from 'express';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { appwriteService } from '../services/appwrite-service';
import type { RouteDependencies } from './types';

// In-memory challenge store (nonce => { userId, challenge, expiresAt })
const walletChallenges: Map<string, { userId: string; challenge: string; expiresAt: number }> = new Map();

export function registerProfileRoutes(deps: RouteDependencies): void {
  const { app, localAuth } = deps;

  // Get current user's profile
  app.get('/api/v1/profile', localAuth, async (req: Request, res: Response) => {
    const session = (req as any).session;
    try {
      if (!appwriteService.isInitialized()) {
        res.json({ profile: { userId: session.userId, username: session.username } });
        return;
      }
      let profile = await appwriteService.getUserProfile(session.userId);
      if (!profile) {
        // Auto-create profile on first access
        profile = await appwriteService.createUserProfile({
          userId: session.userId,
          displayName: session.username,
        });
      }
      res.json({ profile });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get profile', details: String(err) });
    }
  });

  // Update profile
  app.put('/api/v1/profile', localAuth, async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { displayName, bio, avatar } = req.body;

    try {
      if (!appwriteService.isInitialized()) {
        res.json({ profile: { userId: session.userId, displayName, bio, avatar } });
        return;
      }

      let profile = await appwriteService.getUserProfile(session.userId);
      if (!profile) {
        profile = await appwriteService.createUserProfile({
          userId: session.userId,
          displayName,
          bio,
          avatar,
        });
      } else {
        const updateData: any = {};
        if (displayName !== undefined) updateData.displayName = displayName;
        if (bio !== undefined) updateData.bio = bio;
        if (avatar !== undefined) updateData.avatar = avatar;
        profile = await appwriteService.updateUserProfile(profile.$id, updateData);
      }

      res.json({ profile });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update profile', details: String(err) });
    }
  });

  // Get wallet linking challenge
  app.post('/api/v1/profile/wallet-challenge', localAuth, (req: Request, res: Response) => {
    const session = (req as any).session;
    const nonce = uuidv4();
    const ts = Date.now();
    const challenge = `OtherThing Wallet Link\nUser: ${session.userId}\nTimestamp: ${ts}\nNonce: ${nonce}`;

    walletChallenges.set(nonce, {
      userId: session.userId,
      challenge,
      expiresAt: ts + 5 * 60 * 1000, // 5 min expiry
    });

    res.json({ challenge, nonce });
  });

  // Link wallet (verify signature + store association)
  app.post('/api/v1/profile/link-wallet', localAuth, async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { nonce, signature, walletAddress, chainId } = req.body;

    if (!nonce || !signature || !walletAddress) {
      res.status(400).json({ error: 'nonce, signature, and walletAddress are required' });
      return;
    }

    // Verify challenge exists and hasn't expired
    const stored = walletChallenges.get(nonce);
    if (!stored) {
      res.status(400).json({ error: 'Invalid or expired nonce' });
      return;
    }

    if (Date.now() > stored.expiresAt) {
      walletChallenges.delete(nonce);
      res.status(400).json({ error: 'Challenge expired' });
      return;
    }

    if (stored.userId !== session.userId) {
      res.status(400).json({ error: 'Challenge does not match current user' });
      return;
    }

    // Verify signature
    try {
      const recoveredAddress = ethers.verifyMessage(stored.challenge, signature);
      if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        res.status(401).json({ error: 'Signature verification failed' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    walletChallenges.delete(nonce);

    // Store wallet association
    try {
      if (!appwriteService.isInitialized()) {
        res.json({ success: true, walletAddress, chainId: chainId || 11155111 });
        return;
      }

      let profile = await appwriteService.getUserProfile(session.userId);
      if (!profile) {
        profile = await appwriteService.createUserProfile({ userId: session.userId });
      }

      await appwriteService.linkWallet(profile.$id, walletAddress, chainId || 11155111);

      res.json({ success: true, walletAddress, chainId: chainId || 11155111 });
    } catch (err) {
      res.status(500).json({ error: 'Failed to link wallet', details: String(err) });
    }
  });

  // Unlink wallet
  app.delete('/api/v1/profile/unlink-wallet', localAuth, async (req: Request, res: Response) => {
    const session = (req as any).session;

    try {
      if (!appwriteService.isInitialized()) {
        res.json({ success: true });
        return;
      }

      const profile = await appwriteService.getUserProfile(session.userId);
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      await appwriteService.unlinkWallet(profile.$id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to unlink wallet', details: String(err) });
    }
  });

  // Public profile by wallet address
  app.get('/api/v1/profile/:address', async (req: Request, res: Response) => {
    const address = req.params.address as string;

    try {
      if (!appwriteService.isInitialized()) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const profile = await appwriteService.getUserByWallet(address);
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      // Return public fields only
      res.json({
        profile: {
          displayName: profile.displayName,
          avatar: profile.avatar,
          bio: profile.bio,
          walletAddress: profile.walletAddress,
          reputation: profile.reputation,
          totalEarned: profile.totalEarned,
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get profile', details: String(err) });
    }
  });
}
