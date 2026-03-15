/**
 * Chain Sync Service
 *
 * Subscribes to contract events via ethers and mirrors state to Appwrite.
 * Provides catch-up logic on startup by scanning from last known block.
 */

import { ethers, Contract } from 'ethers';
import { appwriteService } from './appwrite-service';
import {
  CONTRACT_ADDRESSES,
  MILESTONE_ESCROW_ABI,
  AGREEMENT_REGISTRY_ABI,
  IP_REGISTRY_ABI,
} from './web3-service';

export class ChainSyncService {
  private provider: ethers.JsonRpcProvider | null = null;
  private milestoneEscrowContract: Contract | null = null;
  private agreementRegistryContract: Contract | null = null;
  private ipRegistryContract: Contract | null = null;
  private running = false;
  private lastSyncedBlock = 0;

  async start(rpcUrl: string, network: 'sepolia' | 'localhost' = 'sepolia'): Promise<void> {
    if (!appwriteService.isInitialized()) {
      console.log('[ChainSync] Appwrite not initialized, skipping chain sync');
      return;
    }

    const addresses = CONTRACT_ADDRESSES[network];
    if (!addresses.MilestoneEscrow && !addresses.AgreementRegistry && !addresses.IPRegistry) {
      console.log('[ChainSync] Phase 2 contracts not deployed, skipping chain sync');
      return;
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.running = true;

    // Initialize contracts (read-only, no signer needed)
    if (addresses.MilestoneEscrow) {
      this.milestoneEscrowContract = new Contract(
        addresses.MilestoneEscrow, MILESTONE_ESCROW_ABI, this.provider
      );
    }
    if (addresses.AgreementRegistry) {
      this.agreementRegistryContract = new Contract(
        addresses.AgreementRegistry, AGREEMENT_REGISTRY_ABI, this.provider
      );
    }
    if (addresses.IPRegistry) {
      this.ipRegistryContract = new Contract(
        addresses.IPRegistry, IP_REGISTRY_ABI, this.provider
      );
    }

    // Get current block for catch-up reference
    try {
      this.lastSyncedBlock = await this.provider.getBlockNumber();
    } catch {
      this.lastSyncedBlock = 0;
    }

    // Subscribe to live events
    this.subscribeToEvents();

    console.log(`[ChainSync] Started, listening from block ${this.lastSyncedBlock}`);
  }

  stop(): void {
    this.running = false;

    if (this.milestoneEscrowContract) {
      this.milestoneEscrowContract.removeAllListeners();
    }
    if (this.agreementRegistryContract) {
      this.agreementRegistryContract.removeAllListeners();
    }
    if (this.ipRegistryContract) {
      this.ipRegistryContract.removeAllListeners();
    }

    this.provider = null;
    console.log('[ChainSync] Stopped');
  }

  private subscribeToEvents(): void {
    // ============ Milestone Escrow Events ============
    if (this.milestoneEscrowContract) {
      this.milestoneEscrowContract.on('TaskCreated', async (taskId, creator, workspaceId, totalAmount) => {
        console.log(`[ChainSync] TaskCreated: ${taskId}`);
        try {
          await appwriteService.createTask({
            taskId,
            workspaceId: workspaceId,
            title: 'On-chain Task',
            status: 'created',
            createdBy: creator,
          });
        } catch (err) {
          console.error('[ChainSync] Failed to sync TaskCreated:', err);
        }
      });

      this.milestoneEscrowContract.on('WorkerAssigned', async (taskId, worker) => {
        console.log(`[ChainSync] WorkerAssigned: ${taskId} -> ${worker}`);
        try {
          const existing = await appwriteService.getTaskByChainId(taskId);
          if (existing) {
            await appwriteService.updateTask(existing.$id, {
              assigneeAddress: worker,
              status: 'assigned',
            });
          }
        } catch (err) {
          console.error('[ChainSync] Failed to sync WorkerAssigned:', err);
        }
      });

      this.milestoneEscrowContract.on('MilestoneApproved', async (taskId, milestoneIndex) => {
        console.log(`[ChainSync] MilestoneApproved: ${taskId} #${milestoneIndex}`);
        try {
          const existing = await appwriteService.getTaskByChainId(taskId);
          if (existing) {
            await appwriteService.updateTask(existing.$id, { status: 'in_progress' });
          }
        } catch (err) {
          console.error('[ChainSync] Failed to sync MilestoneApproved:', err);
        }
      });

      this.milestoneEscrowContract.on('MilestonePaymentReleased', async (taskId, milestoneIndex, worker, amount) => {
        console.log(`[ChainSync] MilestonePaymentReleased: ${taskId} #${milestoneIndex}`);
        try {
          const existing = await appwriteService.getTaskByChainId(taskId);
          if (existing) {
            // Check if this was the last milestone
            const task = await this.milestoneEscrowContract!.getTask(taskId);
            const milestoneCount = Number(task[9]); // milestoneCount field
            if (Number(milestoneIndex) === milestoneCount - 1) {
              await appwriteService.updateTask(existing.$id, { status: 'completed' });
            }
          }
        } catch (err) {
          console.error('[ChainSync] Failed to sync MilestonePaymentReleased:', err);
        }
      });

      this.milestoneEscrowContract.on('TaskCancelled', async (taskId) => {
        console.log(`[ChainSync] TaskCancelled: ${taskId}`);
        try {
          const existing = await appwriteService.getTaskByChainId(taskId);
          if (existing) {
            await appwriteService.updateTask(existing.$id, { status: 'cancelled' });
          }
        } catch (err) {
          console.error('[ChainSync] Failed to sync TaskCancelled:', err);
        }
      });
    }

    // ============ Agreement Registry Events ============
    if (this.agreementRegistryContract) {
      this.agreementRegistryContract.on('AgreementSigned', async (agreementId, signer) => {
        console.log(`[ChainSync] AgreementSigned: #${agreementId} by ${signer}`);
        try {
          await appwriteService.recordSignature({
            agreementId: String(agreementId),
            signerAddress: signer,
          });
        } catch (err) {
          console.error('[ChainSync] Failed to sync AgreementSigned:', err);
        }
      });
    }

    // ============ IP Registry Events ============
    if (this.ipRegistryContract) {
      this.ipRegistryContract.on('IPRegistered', async (registrationId, workspaceId, taskId, creator) => {
        console.log(`[ChainSync] IPRegistered: #${registrationId} task ${taskId}`);
        try {
          // Fetch full registration data
          const ip = await this.ipRegistryContract!.getIPForTask(taskId);
          await appwriteService.registerIP({
            workspaceId: workspaceId,
            taskId: taskId,
            creatorAddress: creator,
            licenseType: ['MIT', 'Apache2', 'Proprietary', 'WorkForHire', 'Custom'][Number(ip[4])] || 'Custom',
            licenseCid: ip[5],
          });
        } catch (err) {
          console.error('[ChainSync] Failed to sync IPRegistered:', err);
        }
      });
    }
  }

  /**
   * Catch-up: scan historical events from a given block number
   */
  async catchUp(fromBlock: number): Promise<void> {
    if (!this.provider) return;

    console.log(`[ChainSync] Catching up from block ${fromBlock}...`);

    try {
      const currentBlock = await this.provider.getBlockNumber();

      if (this.milestoneEscrowContract) {
        const taskEvents = await this.milestoneEscrowContract.queryFilter('TaskCreated', fromBlock, currentBlock);
        console.log(`[ChainSync] Found ${taskEvents.length} TaskCreated events to catch up`);

        for (const event of taskEvents) {
          const parsed = this.milestoneEscrowContract.interface.parseLog(event as any);
          if (parsed) {
            try {
              const existing = await appwriteService.getTaskByChainId(parsed.args[0]);
              if (!existing) {
                await appwriteService.createTask({
                  taskId: parsed.args[0],
                  workspaceId: parsed.args[2],
                  title: 'On-chain Task',
                  status: 'created',
                  createdBy: parsed.args[1],
                });
              }
            } catch {
              // Skip duplicates
            }
          }
        }
      }

      this.lastSyncedBlock = currentBlock;
      console.log(`[ChainSync] Catch-up complete, now at block ${currentBlock}`);
    } catch (err) {
      console.error('[ChainSync] Catch-up failed:', err);
    }
  }
}

export const chainSyncService = new ChainSyncService();
