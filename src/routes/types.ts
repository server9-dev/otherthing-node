/**
 * Route Dependencies - shared context passed to all route modules
 */

import type express from 'express';
import type { WorkspaceManager } from '../services/workspace-manager';
import type { OllamaManager } from '../ollama-manager';
import type { SandboxManager } from '../sandbox-manager';
import type { IPFSManager } from '../ipfs-manager';
import type { WebSocket } from 'ws';

// Agent execution storage (matches UI's AgentExecution interface)
export interface AgentExecutionLocal {
  id: string;
  workspaceId: string;
  userId: string;
  goal: string;
  agentType: string;
  model: string;
  provider: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'pulling_model';
  progress: number;
  progressMessage: string;
  actions: Array<{
    thought: string;
    tool?: string;
    input?: string;
    output?: string;
  }>;
  result?: string;
  error?: string;
  securityAlerts?: string[];
  tokensUsed: number;
  iterations: number;
  createdAt: string;
  completedAt?: string;
  computeSource?: 'local' | 'cloud';
  nodeId?: string;
  modelPulled?: boolean;
  taskCategory?: string;
  sandboxCid?: string;
}

// On-chain verified node tracking
export interface OnChainNodeRecord {
  nodeId: string;          // bytes32 from blockchain
  walletAddress: string;   // Owner's wallet
  localNodeId: string;     // Local node ID
  verifiedAt: string;      // ISO timestamp
  computeSeconds: number;  // Accumulated compute time to report
  lastReported: string;    // Last time we reported to chain
}

// Workspace node record (nodes added to workspaces)
export interface WorkspaceNodeRecord {
  id: string;
  shareKey: string;
  name?: string;
  status: 'online' | 'offline';
  hardware?: {
    cpuCores: number;
    memoryMb: number;
    gpuCount: number;
  };
  addedAt: string;
  isLocal: boolean;
}

// Mutable container for managers that are set after construction
export interface ManagerRefs {
  ollamaManager: OllamaManager | null;
  sandboxManager: SandboxManager | null;
  ipfsManager: IPFSManager | null;
}

export interface RouteDependencies {
  app: express.Application;
  workspaceManager: WorkspaceManager;
  managers: ManagerRefs;
  localAuth: express.RequestHandler;
  agentExecutions: Map<string, AgentExecutionLocal>;
  onChainNodes: Map<string, OnChainNodeRecord>;
  workspaceNodes: Map<string, WorkspaceNodeRecord[]>;
  localNodeShareKey: string;
  agentsWsClients: Map<string, Set<WebSocket>>;
  broadcastAgentProgress: (execution: AgentExecutionLocal) => void;
}

// Convenience accessors (read from mutable ref)
export function getOllamaManager(deps: RouteDependencies): OllamaManager | null {
  return deps.managers.ollamaManager;
}
export function getSandboxManager(deps: RouteDependencies): SandboxManager | null {
  return deps.managers.sandboxManager;
}
export function getIPFSManager(deps: RouteDependencies): IPFSManager | null {
  return deps.managers.ipfsManager;
}
