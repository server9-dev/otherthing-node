/**
 * Data Service Layer
 *
 * Wraps both WorkspaceManager (local) and appwriteService (cloud).
 * Strategy: Appwrite first for reads, local fallback. Dual-write for writes.
 */

import { appwriteService } from './appwrite-service';
import { WorkspaceManager, Workspace } from './workspace-manager';

interface OfflineWrite {
  method: string;
  args: any[];
  timestamp: string;
}

export class DataService {
  private workspaceManager: WorkspaceManager;
  private offlineQueue: OfflineWrite[] = [];
  private _syncStatus: 'online' | 'offline' | 'syncing' = 'offline';

  constructor(workspaceManager: WorkspaceManager) {
    this.workspaceManager = workspaceManager;
    this._syncStatus = appwriteService.isInitialized() ? 'online' : 'offline';
  }

  get syncStatus(): 'online' | 'offline' | 'syncing' {
    return this._syncStatus;
  }

  private get isOnline(): boolean {
    return appwriteService.isInitialized();
  }

  private enqueueOffline(method: string, args: any[]): void {
    this.offlineQueue.push({ method, args, timestamp: new Date().toISOString() });
  }

  async flushOfflineQueue(): Promise<{ flushed: number; failed: number }> {
    if (!this.isOnline || this.offlineQueue.length === 0) {
      return { flushed: 0, failed: 0 };
    }

    this._syncStatus = 'syncing';
    let flushed = 0;
    let failed = 0;
    const remaining: OfflineWrite[] = [];

    for (const entry of this.offlineQueue) {
      try {
        const fn = (this as any)[entry.method];
        if (typeof fn === 'function') {
          await fn.apply(this, entry.args);
          flushed++;
        }
      } catch {
        failed++;
        remaining.push(entry);
      }
    }

    this.offlineQueue = remaining;
    this._syncStatus = this.isOnline ? 'online' : 'offline';
    return { flushed, failed };
  }

  // ============ WORKSPACE OPERATIONS ============

  async createWorkspace(
    name: string,
    description: string,
    userId: string,
    username: string,
    isPrivate: boolean
  ): Promise<Workspace> {
    // Always write to local first (primary for workspace data)
    const workspace = this.workspaceManager.createWorkspace(name, description, userId, username, isPrivate);

    // Async dual-write to Appwrite
    if (this.isOnline) {
      try {
        await appwriteService.createWorkspace({ name, description, ownerId: userId, isPrivate });
      } catch (err) {
        console.warn('[DataService] Appwrite write failed, queuing:', err);
        this.enqueueOffline('_syncCreateWorkspace', [name, description, userId, isPrivate]);
      }
    }

    return workspace;
  }

  getWorkspace(workspaceId: string): Workspace | null {
    // Local is authoritative for workspace data
    return this.workspaceManager.getWorkspace(workspaceId);
  }

  getUserWorkspaces(userId: string): Workspace[] {
    return this.workspaceManager.getUserWorkspaces(userId);
  }

  joinWorkspace(inviteCode: string, userId: string, username: string) {
    return this.workspaceManager.joinWorkspace(inviteCode, userId, username);
  }

  leaveWorkspace(workspaceId: string, userId: string) {
    return this.workspaceManager.leaveWorkspace(workspaceId, userId);
  }

  deleteWorkspace(workspaceId: string, userId: string): void {
    this.workspaceManager.deleteWorkspace(workspaceId, userId);

    if (this.isOnline) {
      appwriteService.deleteWorkspace(workspaceId).catch(err => {
        console.warn('[DataService] Appwrite delete failed:', err);
      });
    }
  }

  // ============ USER PROFILES ============

  async getUserProfile(userId: string): Promise<any> {
    if (this.isOnline) {
      try {
        const profile = await appwriteService.getUserProfile(userId);
        if (profile) return profile;
      } catch {
        // Fall through to null
      }
    }
    return null;
  }

  async createOrUpdateProfile(userId: string, data: {
    displayName?: string;
    bio?: string;
    avatar?: string;
  }): Promise<any> {
    if (!this.isOnline) {
      this.enqueueOffline('createOrUpdateProfile', [userId, data]);
      return { userId, ...data };
    }

    const existing = await appwriteService.getUserProfile(userId);
    if (existing) {
      return await appwriteService.updateUserProfile(existing.$id, data);
    } else {
      return await appwriteService.createUserProfile({ userId, ...data });
    }
  }

  async linkWallet(userId: string, walletAddress: string, chainId: number): Promise<any> {
    if (!this.isOnline) throw new Error('Appwrite not available for wallet linking');

    const profile = await appwriteService.getUserProfile(userId);
    if (!profile) {
      return await appwriteService.createUserProfile({
        userId,
        displayName: undefined,
        avatar: undefined,
        bio: undefined,
      }).then(p => appwriteService.linkWallet(p.$id, walletAddress, chainId));
    }
    return await appwriteService.linkWallet(profile.$id, walletAddress, chainId);
  }

  async unlinkWallet(userId: string): Promise<any> {
    if (!this.isOnline) throw new Error('Appwrite not available for wallet unlinking');
    const profile = await appwriteService.getUserProfile(userId);
    if (!profile) throw new Error('Profile not found');
    return await appwriteService.unlinkWallet(profile.$id);
  }

  async getUserByWallet(walletAddress: string): Promise<any> {
    if (!this.isOnline) return null;
    return await appwriteService.getUserByWallet(walletAddress);
  }

  // ============ AGREEMENTS ============

  async createAgreement(data: {
    workspaceId: string;
    documentHash: string;
    title: string;
    type: string;
    issuerAddress: string;
    expiresAt?: string;
    required: boolean;
  }): Promise<any> {
    if (!this.isOnline) throw new Error('Appwrite not available');
    return await appwriteService.createAgreement(data);
  }

  async listAgreements(workspaceId: string): Promise<any[]> {
    if (!this.isOnline) return [];
    const result = await appwriteService.listAgreements(workspaceId);
    return result.documents;
  }

  async recordSignature(data: {
    agreementId: string;
    signerAddress: string;
    txHash?: string;
  }): Promise<any> {
    if (!this.isOnline) throw new Error('Appwrite not available');
    return await appwriteService.recordSignature(data);
  }

  async getSignatures(agreementId: string): Promise<any[]> {
    if (!this.isOnline) return [];
    const result = await appwriteService.getSignatures(agreementId);
    return result.documents;
  }

  // ============ TASKS ============

  async createTask(data: {
    taskId: string;
    workspaceId: string;
    title?: string;
    description?: string;
    milestones?: any;
    assigneeAddress?: string;
    status: string;
    createdBy: string;
  }): Promise<any> {
    if (!this.isOnline) {
      this.enqueueOffline('createTask', [data]);
      return data;
    }
    return await appwriteService.createTask(data);
  }

  async listWorkspaceTasks(workspaceId: string): Promise<any[]> {
    if (!this.isOnline) return [];
    const result = await appwriteService.listWorkspaceTasks(workspaceId);
    return result.documents;
  }

  async updateTask(docId: string, data: Partial<any>): Promise<any> {
    if (!this.isOnline) throw new Error('Appwrite not available');
    return await appwriteService.updateTask(docId, data);
  }

  async getTaskByChainId(taskId: string): Promise<any> {
    if (!this.isOnline) return null;
    return await appwriteService.getTaskByChainId(taskId);
  }

  // ============ IP REGISTRATIONS ============

  async registerIP(data: {
    workspaceId: string;
    taskId: string;
    creatorAddress: string;
    licenseType: string;
    licenseCid?: string;
    txHash?: string;
  }): Promise<any> {
    if (!this.isOnline) throw new Error('Appwrite not available');
    return await appwriteService.registerIP(data);
  }

  async getIPForTask(taskId: string): Promise<any> {
    if (!this.isOnline) return null;
    return await appwriteService.getIPForTask(taskId);
  }

  async listWorkspaceIP(workspaceId: string): Promise<any[]> {
    if (!this.isOnline) return [];
    const result = await appwriteService.listWorkspaceIP(workspaceId);
    return result.documents;
  }

  // ============ RESOURCE USAGE ============

  async recordUsage(data: {
    workspaceId: string;
    type: string;
    provider?: string;
    tokensUsed?: number;
    computeSeconds?: number;
    costCents?: number;
    userId?: string;
    flowId?: string;
    flowName?: string;
  }): Promise<void> {
    if (this.isOnline) {
      try {
        await appwriteService.recordUsage(data);
      } catch {
        this.enqueueOffline('recordUsage', [data]);
      }
    }
  }
}

// Export factory
export function createDataService(workspaceManager: WorkspaceManager): DataService {
  return new DataService(workspaceManager);
}
