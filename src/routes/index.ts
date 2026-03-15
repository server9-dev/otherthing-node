/**
 * Route Aggregator - registers all route modules
 */

import type { RouteDependencies } from './types';

import { registerAuthRoutes } from './auth';
import { registerWorkspaceRoutes } from './workspaces';
import { registerAgentRoutes } from './agents';
import { registerTaskRoutes } from './tasks';
import { registerNodeRoutes } from './nodes';
import { registerFlowRoutes } from './flows';
import { registerRepoRoutes } from './repos';
import { registerStorageRoutes } from './storage';
import { registerComputeRoutes } from './compute';
import { registerWeb3Routes } from './web3';
import { registerOllamaRoutes } from './ollama';
import { registerIPFSRoutes } from './ipfs';
import { registerGitRoutes } from './git';
import { registerAdapterRoutes } from './adapters';
import { registerUAFRoutes } from './uaf';
import { registerMemoryRoutes } from './memory';
import { registerProfileRoutes } from './profiles';
import { registerAgreementRoutes } from './agreements';
import { registerMilestoneRoutes } from './milestones';
import { registerIPRoutes } from './ip';

export function registerAllRoutes(deps: RouteDependencies): void {
  // Health Check (stays in api-server.ts or here)
  deps.app.get('/health', (req, res) => {
    res.json({ status: 'healthy', version: '1.0.0', mode: 'local' });
  });

  registerAuthRoutes(deps);
  registerWorkspaceRoutes(deps);
  registerAgentRoutes(deps);
  registerTaskRoutes(deps);
  registerNodeRoutes(deps);
  registerFlowRoutes(deps);
  registerRepoRoutes(deps);
  registerStorageRoutes(deps);
  registerComputeRoutes(deps);
  registerWeb3Routes(deps);
  registerOllamaRoutes(deps);
  registerIPFSRoutes(deps);
  registerGitRoutes(deps);
  registerAdapterRoutes(deps);
  registerUAFRoutes(deps);
  registerMemoryRoutes(deps);
  registerProfileRoutes(deps);
  registerAgreementRoutes(deps);
  registerMilestoneRoutes(deps);
  registerIPRoutes(deps);
}

export type { RouteDependencies } from './types';
