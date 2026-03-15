/**
 * Web3 Routes - blockchain/contract routes + on-chain node verification
 */

import { Request, Response } from 'express';
import os from 'os';
import { web3Service, CONTRACT_ADDRESSES } from '../services/web3-service';
import type { RouteDependencies, OnChainNodeRecord } from './types';

export function registerWeb3Routes(deps: RouteDependencies): void {
  const { app, localAuth, onChainNodes } = deps;

  // Get contract addresses for the frontend
  app.get('/api/v1/web3/contracts', (req: Request, res: Response) => {
    res.json({
      sepolia: CONTRACT_ADDRESSES.sepolia,
      localhost: CONTRACT_ADDRESSES.localhost,
      abiEndpoints: {
        OTT: '/api/v1/web3/abi/ott',
        NodeRegistry: '/api/v1/web3/abi/node-registry',
        TaskEscrow: '/api/v1/web3/abi/task-escrow',
      },
    });
  });

  // Set contract addresses (after deployment)
  app.post('/api/v1/web3/contracts', localAuth, (req: Request, res: Response) => {
    const { network, addresses } = req.body;
    if (!network || !addresses) {
      res.status(400).json({ error: 'Network and addresses required' });
      return;
    }
    if (network !== 'sepolia' && network !== 'localhost') {
      res.status(400).json({ error: 'Invalid network' });
      return;
    }
    const networkKey = network as 'sepolia' | 'localhost';
    CONTRACT_ADDRESSES[networkKey] = addresses;
    res.json({ success: true, network, addresses });
  });

  // Fund wallet with test ETH and OTT (TESTING ONLY)
  app.post('/api/v1/web3/fund-wallet', localAuth, async (req: Request, res: Response) => {
    const { address } = req.body;
    if (!address) {
      res.status(400).json({ error: 'Address required' });
      return;
    }

    try {
      const { ethers } = await import('ethers');

      const FUNDER_KEY = process.env.FUNDER_PRIVATE_KEY;
      if (!FUNDER_KEY) {
        res.status(500).json({ error: 'FUNDER_PRIVATE_KEY not configured' });
        return;
      }
      const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
      const funderWallet = new ethers.Wallet(FUNDER_KEY, provider);

      const OTT_ADDRESS = CONTRACT_ADDRESSES.sepolia.OTT;
      const OTT_ABI = [
        'function transfer(address to, uint256 amount) returns (bool)',
        'function balanceOf(address) view returns (uint256)',
      ];

      const funderEth = await provider.getBalance(funderWallet.address);
      const ottContract = new ethers.Contract(OTT_ADDRESS, OTT_ABI, funderWallet);
      const funderOtt = await ottContract.balanceOf(funderWallet.address);

      const ethAmount = ethers.parseEther('0.01');
      const ottAmount = ethers.parseEther('500');

      if (funderEth < ethAmount) {
        res.status(400).json({ error: 'Funder wallet has insufficient ETH' });
        return;
      }
      if (funderOtt < ottAmount) {
        res.status(400).json({ error: 'Funder wallet has insufficient OTT' });
        return;
      }

      console.log(`[Fund] Sending 0.01 ETH to ${address}...`);
      const ethTx = await funderWallet.sendTransaction({
        to: address,
        value: ethAmount,
      });
      await ethTx.wait();

      console.log(`[Fund] Sending 500 OTT to ${address}...`);
      const ottTx = await ottContract.transfer(address, ottAmount);
      await ottTx.wait();

      console.log(`[Fund] Wallet ${address} funded successfully`);
      res.json({
        success: true,
        address,
        ethSent: '0.01',
        ottSent: '500',
        ethTx: ethTx.hash,
        ottTx: ottTx.hash,
      });
    } catch (err: any) {
      console.error('[Fund] Error funding wallet:', err);
      res.status(500).json({ error: err.message || 'Failed to fund wallet' });
    }
  });

  // Get node hardware info for blockchain registration
  app.get('/api/v1/web3/node-capabilities', localAuth, async (req: Request, res: Response) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();

    let hasOllama = false;
    const ollamaManager = deps.managers.ollamaManager;
    if (ollamaManager) {
      try {
        const status = await ollamaManager.getStatus();
        hasOllama = status.running;
      } catch {
        // Ignore
      }
    }

    const hasSandbox = deps.managers.sandboxManager !== null;

    res.json({
      capabilities: {
        cpuCores: cpus.length,
        memoryMb: Math.round(totalMem / 1024 / 1024),
        gpuCount: 0,
        gpuVramMb: 0,
        hasOllama,
        hasSandbox,
      },
      hostname: os.hostname(),
      platform: os.platform(),
    });
  });

  // Supported networks info
  app.get('/api/v1/web3/networks', (req: Request, res: Response) => {
    res.json({
      networks: [
        {
          name: 'Sepolia Testnet',
          chainId: 11155111,
          rpcUrl: 'https://rpc.sepolia.org',
          explorer: 'https://sepolia.etherscan.io',
          faucet: 'https://sepoliafaucet.com',
          currency: 'ETH',
        },
        {
          name: 'Localhost (Hardhat)',
          chainId: 31337,
          rpcUrl: 'http://127.0.0.1:8545',
          explorer: null,
          faucet: null,
          currency: 'ETH',
        },
      ],
    });
  });

  // ============ On-Chain Node Verification Routes ============

  app.post('/api/v1/web3/nodes/verify', localAuth, async (req: Request, res: Response) => {
    const { onChainNodeId, walletAddress, signature, challenge, localNodeId } = req.body;

    if (!onChainNodeId || !walletAddress || !signature || !challenge || !localNodeId) {
      res.status(400).json({ error: 'Missing required fields: onChainNodeId, walletAddress, signature, challenge, localNodeId' });
      return;
    }

    try {
      await web3Service.initWithRpc('https://ethereum-sepolia-rpc.publicnode.com', 'sepolia');

      const signatureValid = web3Service.verifySignature(challenge, signature, walletAddress);
      if (!signatureValid) {
        res.status(401).json({ error: 'Invalid signature - wallet ownership not proven' });
        return;
      }

      const isOwner = await web3Service.verifyNodeOwnership(onChainNodeId, walletAddress);
      if (!isOwner) {
        res.status(401).json({ error: 'Wallet does not own this on-chain node' });
        return;
      }

      const isEligible = await web3Service.isNodeEligible(onChainNodeId);
      if (!isEligible) {
        res.status(400).json({ error: 'On-chain node is not eligible (inactive or slashed)' });
        return;
      }

      const nodeDetails = await web3Service.getNode(onChainNodeId);

      const record: OnChainNodeRecord = {
        nodeId: onChainNodeId,
        walletAddress,
        localNodeId,
        verifiedAt: new Date().toISOString(),
        computeSeconds: 0,
        lastReported: new Date().toISOString(),
      };
      onChainNodes.set(localNodeId, record);

      console.log(`[ApiServer] On-chain node verified: ${onChainNodeId.slice(0, 16)}... for local node ${localNodeId}`);

      res.json({
        success: true,
        verified: true,
        onChainNodeId,
        walletAddress,
        nodeDetails: {
          stakedAmount: web3Service.formatOtt(nodeDetails.stakedAmount),
          pendingRewards: web3Service.formatOtt(nodeDetails.pendingRewards),
          reputation: Number(nodeDetails.reputation) / 100,
          isActive: nodeDetails.isActive,
          capabilities: nodeDetails.capabilities,
        },
      });
    } catch (err) {
      console.error('[ApiServer] On-chain verification error:', err);
      res.status(500).json({ error: 'Failed to verify on-chain node', details: String(err) });
    }
  });

  app.get('/api/v1/web3/nodes/verified', localAuth, (req: Request, res: Response) => {
    const nodes = Array.from(onChainNodes.values()).map(n => ({
      onChainNodeId: n.nodeId,
      walletAddress: n.walletAddress,
      localNodeId: n.localNodeId,
      verifiedAt: n.verifiedAt,
      computeSeconds: n.computeSeconds,
      lastReported: n.lastReported,
    }));
    res.json({ nodes });
  });

  app.post('/api/v1/web3/nodes/:localNodeId/compute', localAuth, (req: Request, res: Response) => {
    const localNodeId = req.params.localNodeId as string;
    const { seconds } = req.body;

    if (typeof seconds !== 'number' || seconds < 0) {
      res.status(400).json({ error: 'Invalid seconds value' });
      return;
    }

    const record = onChainNodes.get(localNodeId);
    if (!record) {
      res.status(404).json({ error: 'Node not verified on-chain' });
      return;
    }

    record.computeSeconds += seconds;
    console.log(`[ApiServer] Added ${seconds}s compute time to node ${localNodeId}, total: ${record.computeSeconds}s`);

    res.json({
      success: true,
      localNodeId,
      totalComputeSeconds: record.computeSeconds,
    });
  });

  app.get('/api/v1/web3/nodes/:localNodeId/pending-compute', localAuth, (req: Request, res: Response) => {
    const localNodeId = req.params.localNodeId as string;
    const record = onChainNodes.get(localNodeId);

    if (!record) {
      res.status(404).json({ error: 'Node not verified on-chain' });
      return;
    }

    res.json({
      localNodeId,
      onChainNodeId: record.nodeId,
      pendingComputeSeconds: record.computeSeconds,
      lastReported: record.lastReported,
    });
  });

  app.delete('/api/v1/web3/nodes/:localNodeId', localAuth, (req: Request, res: Response) => {
    const localNodeId = req.params.localNodeId as string;
    const existed = onChainNodes.delete(localNodeId);

    if (!existed) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    console.log(`[ApiServer] On-chain node unlinked: ${localNodeId}`);
    res.json({ success: true });
  });

  app.post('/api/v1/web3/nodes/:localNodeId/report', localAuth, async (req: Request, res: Response) => {
    const localNodeId = req.params.localNodeId as string;
    const { privateKey } = req.body;

    if (!privateKey) {
      res.status(400).json({ error: 'Private key required for blockchain transaction' });
      return;
    }

    const record = onChainNodes.get(localNodeId);
    if (!record) {
      res.status(404).json({ error: 'Node not verified on-chain' });
      return;
    }

    if (record.computeSeconds <= 0) {
      res.json({ success: true, message: 'No compute time to report', computeSeconds: 0 });
      return;
    }

    try {
      await web3Service.initWithPrivateKey(
        privateKey,
        'https://ethereum-sepolia-rpc.publicnode.com',
        'sepolia'
      );

      const isAuthorized = await web3Service.isAuthorizedReporter(web3Service.address!);
      if (!isAuthorized) {
        res.status(403).json({ error: 'Wallet is not an authorized reporter on the contract' });
        return;
      }

      const tx = await web3Service.reportCompute(record.nodeId, record.computeSeconds);
      const receipt = await tx.wait();

      const reportedSeconds = record.computeSeconds;
      record.computeSeconds = 0;
      record.lastReported = new Date().toISOString();

      console.log(`[ApiServer] Reported ${reportedSeconds}s compute time for node ${record.nodeId.slice(0, 16)}... tx: ${receipt?.hash}`);

      res.json({
        success: true,
        onChainNodeId: record.nodeId,
        reportedComputeSeconds: reportedSeconds,
        txHash: receipt?.hash,
      });
    } catch (err) {
      console.error('[ApiServer] Failed to report compute:', err);
      res.status(500).json({ error: 'Failed to submit compute report', details: String(err) });
    }
  });

  app.get('/api/v1/web3/stats', localAuth, async (req: Request, res: Response) => {
    try {
      await web3Service.initWithRpc('https://ethereum-sepolia-rpc.publicnode.com', 'sepolia');

      const totalVerifiedNodes = onChainNodes.size;
      let totalPendingCompute = 0;
      for (const record of onChainNodes.values()) {
        totalPendingCompute += record.computeSeconds;
      }

      res.json({
        verifiedNodes: totalVerifiedNodes,
        pendingComputeSeconds: totalPendingCompute,
        contracts: CONTRACT_ADDRESSES.sepolia,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get stats', details: String(err) });
    }
  });
}
