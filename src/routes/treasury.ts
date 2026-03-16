/**
 * Treasury Routes - OTT Treasury info and pack tiers
 */

import { Request, Response } from 'express';
import { CONTRACT_ADDRESSES } from '../services/web3-service';
import type { RouteDependencies } from './types';

const TREASURY_ABI = [
  'function circulatingTreasuryOTT() view returns (uint256)',
  'function redemptionFeeBps() view returns (uint256)',
  'function getBackingPerOTT() view returns (uint256)',
  'function getRedeemAmount(uint256 ottAmount) view returns (uint256)',
];

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
];

const PACK_TIERS = [
  { name: 'Starter', ottAmount: 100, usdcCost: 100 },
  { name: 'Builder', ottAmount: 500, usdcCost: 500 },
  { name: 'Team', ottAmount: 1000, usdcCost: 1000 },
  { name: 'Enterprise', ottAmount: 5000, usdcCost: 5000 },
];

export function registerTreasuryRoutes(deps: RouteDependencies): void {
  const { app } = deps;

  // Get treasury info (on-chain reads)
  app.get('/api/v1/treasury/info', async (req: Request, res: Response) => {
    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');

      const network = (req.query.network as string) || 'sepolia';
      const addresses = CONTRACT_ADDRESSES[network];

      if (!addresses?.OTTTreasury || !addresses?.USDC) {
        res.json({
          backingPerOTT: '0',
          treasuryUsdcBalance: '0',
          circulatingSupply: '0',
          redemptionFeeBps: 500,
          deployed: false,
        });
        return;
      }

      const treasury = new ethers.Contract(addresses.OTTTreasury, TREASURY_ABI, provider);
      const usdc = new ethers.Contract(addresses.USDC, USDC_ABI, provider);

      const [circulatingOTT, feeBps, treasuryUsdc] = await Promise.all([
        treasury.circulatingTreasuryOTT(),
        treasury.redemptionFeeBps(),
        usdc.balanceOf(addresses.OTTTreasury),
      ]);

      let backingPerOTT = '0';
      if (circulatingOTT > 0n) {
        const backing = await treasury.getBackingPerOTT();
        backingPerOTT = ethers.formatEther(backing);
      }

      res.json({
        backingPerOTT,
        treasuryUsdcBalance: ethers.formatUnits(treasuryUsdc, 6),
        circulatingSupply: ethers.formatEther(circulatingOTT),
        redemptionFeeBps: Number(feeBps),
        deployed: true,
      });
    } catch (err: any) {
      console.error('Failed to fetch treasury info:', err);
      res.status(500).json({ error: 'Failed to fetch treasury info' });
    }
  });

  // Get pack tiers (static)
  app.get('/api/v1/treasury/packs', (req: Request, res: Response) => {
    res.json({ packs: PACK_TIERS });
  });
}
