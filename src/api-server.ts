/**
 * Local API Server
 *
 * Express HTTP server embedded in the Node app.
 * Provides the same API as the orchestrator but runs locally.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { WorkspaceManager, Workspace } from './services/workspace-manager';
import { agentService, AgentExecution } from './services/agent-service';
import {
  requireAuth,
  signup,
  loginWithPassword,
  logout,
} from './middleware/auth';

// Local mode - bypass auth for desktop app
const localAuth = (req: Request, res: Response, next: express.NextFunction) => {
  // For local desktop app, auto-authenticate as local user
  (req as any).session = {
    userId: 'local-user',
    username: 'local',
    token: 'local-token',
  };
  next();
};
import { OllamaManager } from './ollama-manager';
import { SandboxManager } from './sandbox-manager';
import { IPFSManager } from './ipfs-manager';
import { web3Service, CONTRACT_ADDRESSES } from './services/web3-service';
import { HardwareDetector } from './hardware';
import { adapterManager } from './adapters/adapter-manager';
import { cloudGPUProvider } from './services/cloud-gpu-provider';
import { GitService } from './services/git-service';
import { analyzeRepository, RepoAnalysis } from './services/repo-analyzer';

const PORT = 8080;

// Agent execution storage (matches UI's AgentExecution interface)
interface AgentExecutionLocal {
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
interface OnChainNodeRecord {
  nodeId: string;          // bytes32 from blockchain
  walletAddress: string;   // Owner's wallet
  localNodeId: string;     // Local node ID
  verifiedAt: string;      // ISO timestamp
  computeSeconds: number;  // Accumulated compute time to report
  lastReported: string;    // Last time we reported to chain
}

// Workspace node record (nodes added to workspaces)
interface WorkspaceNodeRecord {
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

export class ApiServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private workspaceManager: WorkspaceManager;
  private ollamaManager: OllamaManager | null = null;
  private sandboxManager: SandboxManager | null = null;
  private ipfsManager: IPFSManager | null = null;
  private agentsWsClients: Map<string, Set<WebSocket>> = new Map();
  private agentExecutions: Map<string, AgentExecutionLocal> = new Map();
  // On-chain node tracking
  private onChainNodes: Map<string, OnChainNodeRecord> = new Map(); // keyed by localNodeId
  private computeReportInterval: NodeJS.Timeout | null = null;
  // Workspace nodes storage (keyed by workspaceId)
  private workspaceNodes: Map<string, WorkspaceNodeRecord[]> = new Map();
  // Local node share key (generated once)
  private localNodeShareKey: string = this.generateShareKey();

  constructor() {
    this.app = express();
    this.workspaceManager = new WorkspaceManager();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private generateShareKey(): string {
    // Generate an 8-character alphanumeric share key
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (0, O, 1, I)
    let key = '';
    for (let i = 0; i < 8; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  }

  setManagers(
    ollama: OllamaManager | null,
    sandbox: SandboxManager | null,
    ipfs: IPFSManager | null
  ): void {
    this.ollamaManager = ollama;
    this.sandboxManager = sandbox;
    this.ipfsManager = ipfs;
    agentService.setManagers(ollama, sandbox);
  }

  private setupMiddleware(): void {
    // Allow all origins for local development
    this.app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Health Check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', version: '1.0.0', mode: 'local' });
    });

    // Auth Endpoints
    this.app.post('/api/v1/auth/signup', async (req, res) => {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }
      const result = await signup(username, password);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.status(201).json({ token: result.token, user: result.user });
    });

    this.app.post('/api/v1/auth/login', async (req, res) => {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }
      const result = await loginWithPassword(username, password);
      if (!result.success) {
        res.status(401).json({ error: result.error });
        return;
      }
      res.json({ token: result.token, user: result.user });
    });

    this.app.post('/api/v1/auth/logout', (req, res) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        logout(authHeader.slice(7));
      }
      res.json({ success: true });
    });

    this.app.get('/api/v1/auth/me', localAuth, (req, res) => {
      const session = (req as any).session;
      res.json({ authenticated: true, userId: session.userId, username: session.username });
    });

    // Workspace Endpoints
    this.app.get('/api/v1/workspaces', localAuth, (req, res) => {
      const session = (req as any).session;
      const workspaces = this.workspaceManager.getUserWorkspaces(session.userId);
      res.json({ workspaces });
    });

    this.app.post('/api/v1/workspaces', localAuth, (req, res) => {
      const session = (req as any).session;
      const { name, description } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }
      const workspace = this.workspaceManager.createWorkspace(
        name,
        description || '',
        session.userId,
        session.username,
        true
      );
      res.status(201).json(workspace);
    });

    // Join workspace by invite code (must be before :id routes)
    this.app.post('/api/v1/workspaces/join', localAuth, (req, res) => {
      const session = (req as any).session;
      const inviteCode = req.body?.inviteCode;

      if (!inviteCode) {
        res.status(400).json({ error: 'Invite code is required' });
        return;
      }

      const result = this.workspaceManager.joinWorkspace(
        inviteCode.trim(),
        session.userId,
        session.username
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true, workspace: result.workspace });
    });

    this.app.get('/api/v1/workspaces/:id', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      res.json({ workspace });
    });

    this.app.delete('/api/v1/workspaces/:id', localAuth, (req, res) => {
      const session = (req as any).session;
      const workspaceId = req.params.id as string;
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      if (workspace.ownerId !== session.userId) {
        res.status(403).json({ error: 'Only owner can delete workspace' });
        return;
      }
      this.workspaceManager.deleteWorkspace(workspaceId, session.userId);
      res.json({ success: true });
    });

    // Leave workspace
    this.app.post('/api/v1/workspaces/:id/leave', localAuth, (req, res) => {
      const session = (req as any).session;
      const workspaceId = req.params.id as string;

      const result = this.workspaceManager.leaveWorkspace(workspaceId, session.userId);

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true });
    });

    // Agent Endpoints (AgentExecution - running agents with goals)
    this.app.get('/api/v1/workspaces/:id/agents', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const agents = Array.from(this.agentExecutions.values())
        .filter(a => a.workspaceId === workspaceId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json({ agents });
    });

    this.app.post('/api/v1/workspaces/:id/agents', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const session = (req as any).session;
      const { goal, agentType, model, provider, preferLocal } = req.body;

      if (!goal) {
        res.status(400).json({ error: 'Goal is required' });
        return;
      }

      // Get available models from Ollama
      let availableModels: string[] = [];
      let selectedModel = model || '';
      let selectedProvider = provider || 'ollama';

      if (this.ollamaManager) {
        try {
          const status = await this.ollamaManager.getStatus();
          availableModels = (status.models || []).map(m => m.name);
          // Auto-select a model if not specified
          if (!selectedModel && availableModels.length > 0) {
            selectedModel = availableModels.find(m => m.includes('llama') || m.includes('qwen')) || availableModels[0];
          }
        } catch {
          // Ignore
        }
      }

      if (!selectedModel) {
        selectedModel = 'llama3.2:3b';
      }

      // Create agent execution
      const execution: AgentExecutionLocal = {
        id: uuidv4(),
        workspaceId,
        userId: session.userId,
        goal,
        agentType: agentType || 'react',
        model: selectedModel,
        provider: selectedProvider,
        status: 'pending',
        progress: 0,
        progressMessage: 'Starting agent...',
        actions: [],
        tokensUsed: 0,
        iterations: 0,
        createdAt: new Date().toISOString(),
        computeSource: 'local',
        nodeId: 'local-node',
        modelPulled: availableModels.includes(selectedModel),
      };

      this.agentExecutions.set(execution.id, execution);

      // Start the agent execution in the background
      this.runAgentExecution(execution);

      res.status(201).json({ agent: execution });
    });

    // Agent analyze endpoint (stub - returns mock analysis)
    this.app.post('/api/v1/workspaces/:id/agents/analyze', localAuth, async (req, res) => {
      const { goal } = req.body;

      // Get available models from Ollama
      let models: string[] = [];
      if (this.ollamaManager) {
        try {
          const status = await this.ollamaManager.getStatus();
          models = (status.models || []).map(m => m.name);
        } catch {
          // Ignore
        }
      }

      // Pick a model (prefer smaller ones for simple tasks)
      const defaultModel = models.find(m => m.includes('llama') || m.includes('qwen')) || models[0] || 'llama3.2:3b';

      // Return analysis in the format UI expects
      res.json({
        category: 'general',
        complexity: 'medium',
        estimatedSteps: 5,
        recommendation: {
          provider: 'ollama',
          model: defaultModel,
          needsPull: !models.includes(defaultModel),
        },
      });
    });

    // Agent scan endpoint (stub - returns mock security scan)
    this.app.post('/api/v1/workspaces/:id/agents/scan', localAuth, (req, res) => {
      const { goal } = req.body;
      // Return a stub scan response (UI expects 'alerts' not 'warnings')
      res.json({
        safe: true,
        alerts: [],
        blockedPatterns: [],
        sanitizedGoal: goal || '',
      });
    });

    this.app.get('/api/v1/workspaces/:id/agents/:agentId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const agentId = req.params.agentId as string;
      const execution = this.agentExecutions.get(agentId);
      if (!execution || execution.workspaceId !== workspaceId) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      res.json({ agent: execution });
    });

    this.app.delete('/api/v1/workspaces/:id/agents/:agentId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const agentId = req.params.agentId as string;
      const execution = this.agentExecutions.get(agentId);
      if (!execution || execution.workspaceId !== workspaceId) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      // Mark as failed/cancelled
      execution.status = 'failed';
      execution.error = 'Cancelled by user';
      execution.completedAt = new Date().toISOString();
      res.json({ success: true });
    });

    // Tasks storage (in-memory)
    const tasksStore: Map<string, any[]> = new Map();

    // Tasks Endpoints
    this.app.get('/api/v1/workspaces/:id/tasks', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const tasks = tasksStore.get(workspaceId) || [];
      res.json({ tasks });
    });

    this.app.post('/api/v1/workspaces/:id/tasks', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const task = {
        id: req.body.id || uuidv4(),
        title: req.body.title || '',
        description: req.body.description || '',
        status: req.body.status || 'todo',
        priority: req.body.priority || 'medium',
        createdAt: req.body.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!tasksStore.has(workspaceId)) {
        tasksStore.set(workspaceId, []);
      }
      tasksStore.get(workspaceId)!.push(task);
      res.status(201).json({ task });
    });

    this.app.patch('/api/v1/workspaces/:id/tasks/:taskId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const taskId = req.params.taskId as string;
      const tasks = tasksStore.get(workspaceId) || [];
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex === -1) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      tasks[taskIndex] = { ...tasks[taskIndex], ...req.body, updatedAt: new Date().toISOString() };
      res.json({ task: tasks[taskIndex] });
    });

    this.app.delete('/api/v1/workspaces/:id/tasks/:taskId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const taskId = req.params.taskId as string;
      const tasks = tasksStore.get(workspaceId) || [];
      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex === -1) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      tasks.splice(taskIndex, 1);
      res.json({ success: true });
    });

    // Workspace Nodes Endpoints
    this.app.get('/api/v1/workspaces/:id/nodes', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const nodes = this.workspaceNodes.get(workspaceId) || [];
      res.json({ nodes });
    });

    this.app.post('/api/v1/workspaces/:id/nodes/add-by-key', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const { shareKey } = req.body;

      if (!shareKey) {
        res.status(400).json({ error: 'Share key is required' });
        return;
      }

      // Check if workspace exists
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Initialize workspace nodes array if needed
      if (!this.workspaceNodes.has(workspaceId)) {
        this.workspaceNodes.set(workspaceId, []);
      }

      const nodes = this.workspaceNodes.get(workspaceId)!;

      // Check if node already exists in workspace
      if (nodes.some(n => n.shareKey === shareKey)) {
        res.status(400).json({ error: 'Node already added to this workspace' });
        return;
      }

      // Check if this is the local node
      const isLocalNode = shareKey === this.localNodeShareKey;
      const os = require('os');

      let nodeRecord: WorkspaceNodeRecord;

      if (isLocalNode) {
        // Add local node with full hardware info
        nodeRecord = {
          id: `node-${uuidv4().slice(0, 8)}`,
          shareKey,
          name: os.hostname(),
          status: 'online',
          hardware: {
            cpuCores: os.cpus().length,
            memoryMb: Math.round(os.totalmem() / 1024 / 1024),
            gpuCount: 0,
          },
          addedAt: new Date().toISOString(),
          isLocal: true,
        };
      } else {
        // For remote nodes, we'd need to verify the share key with a node registry
        // For now, add it as a pending/offline node
        nodeRecord = {
          id: `node-${uuidv4().slice(0, 8)}`,
          shareKey,
          name: undefined,
          status: 'offline',
          hardware: undefined,
          addedAt: new Date().toISOString(),
          isLocal: false,
        };
      }

      nodes.push(nodeRecord);
      console.log(`[ApiServer] Added node ${nodeRecord.id} (${shareKey}) to workspace ${workspaceId}`);

      res.status(201).json({ node: nodeRecord });
    });

    // Remove node from workspace
    this.app.delete('/api/v1/workspaces/:id/nodes/:nodeId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const nodeId = req.params.nodeId as string;

      const nodes = this.workspaceNodes.get(workspaceId);
      if (!nodes) {
        res.status(404).json({ error: 'Workspace has no nodes' });
        return;
      }

      const nodeIndex = nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) {
        res.status(404).json({ error: 'Node not found in workspace' });
        return;
      }

      const removedNode = nodes.splice(nodeIndex, 1)[0];
      console.log(`[ApiServer] Removed node ${nodeId} from workspace ${workspaceId}`);

      res.json({ success: true, removedNode });
    });

    // API Keys storage (in-memory)
    const apiKeysStore: Map<string, any[]> = new Map();

    // API Keys Endpoints
    this.app.get('/api/v1/workspaces/:id/api-keys', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const apiKeys = apiKeysStore.get(workspaceId) || [];
      res.json({ apiKeys });
    });

    this.app.post('/api/v1/workspaces/:id/api-keys', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const session = (req as any).session;
      const { provider, name, key } = req.body;

      if (!key) {
        res.status(400).json({ error: 'API key is required' });
        return;
      }

      // Mask the key (show first 4 and last 4 chars)
      const maskedKey = key.length > 8
        ? `${key.slice(0, 4)}...${key.slice(-4)}`
        : '****';

      const apiKey = {
        id: uuidv4(),
        provider: provider || 'custom',
        name: name || 'API Key',
        maskedKey,
        addedBy: session.username,
        addedAt: new Date().toISOString(),
      };

      if (!apiKeysStore.has(workspaceId)) {
        apiKeysStore.set(workspaceId, []);
      }
      apiKeysStore.get(workspaceId)!.push(apiKey);
      res.status(201).json({ apiKey });
    });

    this.app.delete('/api/v1/workspaces/:id/api-keys/:keyId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const keyId = req.params.keyId as string;
      const keys = apiKeysStore.get(workspaceId) || [];
      const keyIndex = keys.findIndex(k => k.id === keyId);
      if (keyIndex === -1) {
        res.status(404).json({ error: 'API key not found' });
        return;
      }
      keys.splice(keyIndex, 1);
      res.json({ success: true });
    });

    // Flows storage (in-memory)
    const flowsStore: Map<string, any[]> = new Map();

    // Flows Endpoints
    this.app.get('/api/v1/workspaces/:id/flows', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const flows = flowsStore.get(workspaceId) || [];
      res.json({ flows });
    });

    this.app.post('/api/v1/workspaces/:id/flows', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const session = (req as any).session;
      const flow = {
        id: uuidv4(),
        name: req.body.name || 'Untitled Flow',
        description: req.body.description || '',
        flow: req.body.flow || { nodes: [], connections: [] },
        createdBy: session.username,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!flowsStore.has(workspaceId)) {
        flowsStore.set(workspaceId, []);
      }
      flowsStore.get(workspaceId)!.push(flow);
      res.status(201).json({ flow });
    });

    this.app.delete('/api/v1/workspaces/:id/flows/:flowId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const flowId = req.params.flowId as string;
      const flows = flowsStore.get(workspaceId) || [];
      const flowIndex = flows.findIndex(f => f.id === flowId);
      if (flowIndex === -1) {
        res.status(404).json({ error: 'Flow not found' });
        return;
      }
      flows.splice(flowIndex, 1);
      res.json({ success: true });
    });

    // Repos storage (in-memory)
    const reposStore: Map<string, any[]> = new Map();

    // Repos Endpoints
    this.app.get('/api/v1/workspaces/:id/repos', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const repos = reposStore.get(workspaceId) || [];
      res.json({ repos });
    });

    this.app.post('/api/v1/workspaces/:id/repos', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const session = (req as any).session;
      const repo = {
        id: uuidv4(),
        url: req.body.url || '',
        name: req.body.name || 'unknown',
        status: 'pending',
        addedBy: session.username,
        addedAt: new Date().toISOString(),
      };
      if (!reposStore.has(workspaceId)) {
        reposStore.set(workspaceId, []);
      }
      reposStore.get(workspaceId)!.push(repo);
      res.status(201).json({ repo });
    });

    this.app.post('/api/v1/workspaces/:id/repos/:repoId/analyze', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const repoId = req.params.repoId as string;
      const repos = reposStore.get(workspaceId) || [];
      const repo = repos.find(r => r.id === repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      // Update repo status
      repo.status = 'analyzing';
      // Return mock analysis (actual analysis would be done by on-bored tool)
      res.json({
        analysis: {
          repoName: repo.name,
          primaryLanguage: 'TypeScript',
          totalCommits: 0,
          contributors: [],
          techStack: [],
          topFiles: [],
        },
      });
      // Mark as ready after a delay (simulate analysis)
      setTimeout(() => {
        repo.status = 'ready';
        repo.analyzedAt = new Date().toISOString();
      }, 1000);
    });

    this.app.delete('/api/v1/workspaces/:id/repos/:repoId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const repoId = req.params.repoId as string;
      const repos = reposStore.get(workspaceId) || [];
      const repoIndex = repos.findIndex(r => r.id === repoId);
      if (repoIndex === -1) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      repos.splice(repoIndex, 1);
      res.json({ success: true });
    });

    // Storage Files storage (in-memory with content)
    const storageStore: Map<string, any[]> = new Map();
    const storageContent: Map<string, string> = new Map();

    // Storage Files Endpoints
    this.app.get('/api/v1/workspaces/:id/storage/files', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const files = storageStore.get(workspaceId) || [];
      res.json({ files });
    });

    this.app.post('/api/v1/workspaces/:id/storage/upload', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const session = (req as any).session;
      const { content, filename, mimeType } = req.body;

      if (!content) {
        res.status(400).json({ error: 'Content is required' });
        return;
      }

      // Generate a mock CID
      const cid = `Qm${uuidv4().replace(/-/g, '').slice(0, 44)}`;
      const file = {
        id: uuidv4(),
        cid,
        name: filename || 'untitled.txt',
        size: Buffer.byteLength(content, 'utf8'),
        mimeType: mimeType || 'text/plain',
        addedBy: session.username,
        addedAt: new Date().toISOString(),
        pinned: true,
      };

      // Store the content
      storageContent.set(cid, content);

      if (!storageStore.has(workspaceId)) {
        storageStore.set(workspaceId, []);
      }
      storageStore.get(workspaceId)!.push(file);
      res.status(201).json({ file });
    });

    this.app.get('/api/v1/workspaces/:id/storage/content/:cid', localAuth, (req, res) => {
      const cid = req.params.cid as string;
      const content = storageContent.get(cid);
      if (!content) {
        res.status(404).json({ error: 'Content not found' });
        return;
      }
      res.json({ content });
    });

    this.app.delete('/api/v1/workspaces/:id/storage/files/:fileId', localAuth, (req, res) => {
      const workspaceId = req.params.id as string;
      const fileId = req.params.fileId as string;
      const files = storageStore.get(workspaceId) || [];
      const fileIndex = files.findIndex(f => f.id === fileId);
      if (fileIndex === -1) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const file = files[fileIndex];
      // Remove content
      storageContent.delete(file.cid);
      files.splice(fileIndex, 1);
      res.json({ success: true });
    });

    // Usage Summary Endpoint
    this.app.get('/api/v1/workspaces/:id/usage/summary', localAuth, (req, res) => {
      // Return in the format UI expects (UsageSummary interface)
      res.json({
        summary: {
          totalCostCents: 0,
          totalTokens: 0,
          totalComputeSeconds: 0,
          byProvider: {},
          byFlow: {},
        },
      });
    });

    // Compute Summary Endpoint
    this.app.get('/api/v1/workspaces/:id/compute', localAuth, async (req, res) => {
      const cpus = require('os').cpus();
      const totalMem = require('os').totalmem();
      const freeMem = require('os').freemem();

      // Get local models from Ollama if available
      let localModels: string[] = [];
      if (this.ollamaManager) {
        try {
          const status = await this.ollamaManager.getStatus();
          localModels = (status.models || []).map(m => m.name);
        } catch {
          // Ignore errors
        }
      }

      res.json({
        compute: {
          nodes: 1,
          totalCores: cpus.length,
          totalMemoryMb: Math.round(totalMem / 1024 / 1024),
          availableMemoryMb: Math.round(freeMem / 1024 / 1024),
          gpus: 0,
          // Fields expected by the UI
          localNodes: 1,
          localModels,
          hasLocalCompute: true,
          hasCloudKeys: false,
          cloudProviders: [],
        },
      });
    });

    // Sandbox Endpoints
    this.app.get('/api/v1/workspaces/:id/sandbox/files', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const dirPath = (req.query.path as string) || '.';
      if (!this.sandboxManager) {
        res.status(503).json({ error: 'Sandbox not configured' });
        return;
      }
      const result = await this.sandboxManager.listFiles(workspaceId, dirPath);
      if (result.success) {
        res.json({ files: result.files });
      } else {
        res.status(500).json({ error: result.error });
      }
    });

    this.app.get('/api/v1/workspaces/:id/sandbox/file', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const filePath = (req.query.path as string) || '';
      if (!this.sandboxManager) {
        res.status(503).json({ error: 'Sandbox not configured' });
        return;
      }
      const result = await this.sandboxManager.readFile(workspaceId, filePath);
      if (result.success) {
        res.json({ content: result.content });
      } else {
        res.status(404).json({ error: result.error });
      }
    });

    this.app.put('/api/v1/workspaces/:id/sandbox/file', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const filePath = (req.query.path as string) || req.body.path || '';
      const { content } = req.body;
      if (!this.sandboxManager) {
        res.status(503).json({ error: 'Sandbox not configured' });
        return;
      }
      const result = await this.sandboxManager.writeFile(workspaceId, filePath, content);
      if (result.success) {
        res.json({ success: true, path: result.path });
      } else {
        res.status(500).json({ error: result.error });
      }
    });

    this.app.delete('/api/v1/workspaces/:id/sandbox/file', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const filePath = (req.query.path as string) || '';
      if (!this.sandboxManager) {
        res.status(503).json({ error: 'Sandbox not configured' });
        return;
      }
      const result = await this.sandboxManager.deleteFile(workspaceId, filePath);
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: result.error });
      }
    });

    // Models Endpoint
    this.app.get('/api/v1/models', localAuth, async (req, res) => {
      if (!this.ollamaManager) {
        res.json({ models: [], provider: 'none' });
        return;
      }
      const status = await this.ollamaManager.getStatus();
      res.json({
        models: status.models || [],
        provider: 'ollama',
        endpoint: status.endpoint,
      });
    });

    // Stats Endpoint
    this.app.get('/api/v1/stats', localAuth, (req, res) => {
      res.json({
        mode: 'local',
        nodes: 1,
        ollama: this.ollamaManager ? 'available' : 'unavailable',
        sandbox: this.sandboxManager ? 'available' : 'unavailable',
        ipfs: this.ipfsManager ? 'available' : 'unavailable',
      });
    });

    // Nodes Endpoint (compatibility)
    this.app.get('/api/v1/nodes', localAuth, (req, res) => {
      res.json({
        nodes: [{
          id: 'local',
          name: 'Local Node',
          status: 'online',
          ollama: this.ollamaManager ? 'available' : 'unavailable',
          sandbox: this.sandboxManager ? 'available' : 'unavailable',
        }],
      });
    });

    // Hardware Detection Endpoint (for Tauri/sidecar)
    this.app.get('/api/v1/hardware', async (req, res) => {
      try {
        const hardware = await HardwareDetector.detect();
        res.json(hardware);
      } catch (err) {
        console.error('[API] Hardware detection error:', err);
        res.status(500).json({ error: String(err) });
      }
    });

    // Drive List Endpoint (for storage selection)
    this.app.get('/api/v1/drives', async (req, res) => {
      try {
        const drives = await HardwareDetector.getDrives();
        res.json(drives);
      } catch (err) {
        console.error('[API] Drive detection error:', err);
        res.status(500).json({ error: String(err) });
      }
    });

    // ============ Ollama Endpoints ============

    this.app.get('/api/v1/ollama/status', async (req, res) => {
      try {
        if (!this.ollamaManager) {
          res.json({ installed: false, running: false, models: [] });
          return;
        }
        const status = await this.ollamaManager.getStatus();
        res.json(status);
      } catch (err) {
        console.error('[API] Ollama status error:', err);
        res.status(500).json({ error: String(err) });
      }
    });

    this.app.post('/api/v1/ollama/start', async (req, res) => {
      try {
        if (!this.ollamaManager) {
          res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
          return;
        }
        await this.ollamaManager.start();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    this.app.post('/api/v1/ollama/stop', async (req, res) => {
      try {
        if (!this.ollamaManager) {
          res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
          return;
        }
        await this.ollamaManager.stop();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    this.app.get('/api/v1/ollama/models', async (req, res) => {
      try {
        if (!this.ollamaManager) {
          res.json([]);
          return;
        }
        const status = await this.ollamaManager.getStatus();
        res.json(status.models || []);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    this.app.post('/api/v1/ollama/pull', async (req, res) => {
      try {
        const { model } = req.body;
        if (!model) {
          res.status(400).json({ success: false, error: 'Model name required' });
          return;
        }
        if (!this.ollamaManager) {
          res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
          return;
        }
        await this.ollamaManager.pullModel(model);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    this.app.delete('/api/v1/ollama/models/:model', async (req, res) => {
      try {
        const { model } = req.params;
        if (!this.ollamaManager) {
          res.status(400).json({ success: false, error: 'Ollama manager not initialized' });
          return;
        }
        await this.ollamaManager.deleteModel(model);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    // ============ IPFS Endpoints ============

    this.app.get('/api/v1/ipfs/status', async (req, res) => {
      try {
        if (!this.ipfsManager) {
          res.json({ running: false, has_binary: false, peer_id: null, stats: null });
          return;
        }
        const stats = await this.ipfsManager.getStats();
        res.json({
          running: stats.isOnline,
          has_binary: this.ipfsManager.hasBinary(),
          peer_id: stats.peerId || null,
          stats: stats,
        });
      } catch (err) {
        console.error('[API] IPFS status error:', err);
        res.status(500).json({ error: String(err) });
      }
    });

    this.app.post('/api/v1/ipfs/start', async (req, res) => {
      try {
        if (!this.ipfsManager) {
          res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
          return;
        }
        await this.ipfsManager.start();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    this.app.post('/api/v1/ipfs/stop', async (req, res) => {
      try {
        if (!this.ipfsManager) {
          res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
          return;
        }
        await this.ipfsManager.stop();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    this.app.post('/api/v1/ipfs/add', async (req, res) => {
      try {
        const { content } = req.body;
        if (!content) {
          res.status(400).json({ success: false, error: 'Content required' });
          return;
        }
        if (!this.ipfsManager) {
          res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
          return;
        }
        const cid = await this.ipfsManager.addContent(content);
        res.json({ success: true, cid });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    this.app.post('/api/v1/ipfs/pin/:cid', async (req, res) => {
      try {
        const { cid } = req.params;
        if (!this.ipfsManager) {
          res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
          return;
        }
        await this.ipfsManager.pin(cid);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    this.app.delete('/api/v1/ipfs/pin/:cid', async (req, res) => {
      try {
        const { cid } = req.params;
        if (!this.ipfsManager) {
          res.status(400).json({ success: false, error: 'IPFS manager not initialized' });
          return;
        }
        await this.ipfsManager.unpin(cid);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    // Download IPFS binary with SSE progress
    this.app.get('/api/v1/ipfs/download', (req, res) => {
      // Server-Sent Events for progress
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Create temporary IPFS manager if needed
      const manager = this.ipfsManager || new (require('./ipfs-manager').IPFSManager)(
        require('./electron-compat').getUserDataPath()
      );

      // Check if already downloaded
      if (manager.hasBinary()) {
        res.write(`data: ${JSON.stringify({ progress: 100, status: 'complete' })}\n\n`);
        res.end();
        return;
      }

      // Send progress events
      const sendProgress = (percent: number) => {
        res.write(`data: ${JSON.stringify({ progress: percent, status: 'downloading' })}\n\n`);
      };

      // Start download
      manager.downloadBinary(sendProgress)
        .then(() => {
          res.write(`data: ${JSON.stringify({ progress: 100, status: 'complete' })}\n\n`);
          res.end();
        })
        .catch((err: Error) => {
          res.write(`data: ${JSON.stringify({ progress: -1, status: 'error', error: String(err) })}\n\n`);
          res.end();
        });

      // Handle client disconnect
      req.on('close', () => {
        // Client disconnected - cleanup if needed
      });
    });

    // Non-SSE download endpoint (for simple clients)
    this.app.post('/api/v1/ipfs/download', async (req, res) => {
      try {
        const manager = this.ipfsManager || new (require('./ipfs-manager').IPFSManager)(
          require('./electron-compat').getUserDataPath()
        );

        if (manager.hasBinary()) {
          res.json({ success: true, message: 'IPFS binary already installed' });
          return;
        }

        await manager.downloadBinary();
        res.json({ success: true, message: 'IPFS binary downloaded successfully' });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    // ============ Cloud GPU Endpoints ============

    // Configure cloud GPU provider
    this.app.post('/api/v1/gpu/configure', localAuth, async (req, res) => {
      try {
        const { apiKey } = req.body;
        if (!apiKey) {
          res.status(400).json({ success: false, error: 'API key required' });
          return;
        }
        cloudGPUProvider.initialize({ apiKey });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    // Search available GPU offers
    this.app.get('/api/v1/gpu/offers', localAuth, async (req, res) => {
      try {
        if (!cloudGPUProvider.isConfigured()) {
          res.status(400).json({ error: 'Cloud GPU not configured' });
          return;
        }
        const maxPrice = parseFloat(req.query.maxPrice as string) || 2.0;
        const minVram = parseInt(req.query.minVram as string) || 0;
        const gpuType = req.query.gpuType as string;

        const offers = await cloudGPUProvider.searchOffers({
          maxPricePerHour: maxPrice,
          minGpuMemoryGb: minVram,
          gpuName: gpuType !== 'any' ? gpuType : undefined,
          verifiedOnly: true,
          sortBy: 'price',
        });
        res.json({ offers });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Get active instances
    this.app.get('/api/v1/gpu/instances', localAuth, async (req, res) => {
      try {
        if (!cloudGPUProvider.isConfigured()) {
          res.json({ instances: [], billing: null });
          return;
        }
        const instances = await cloudGPUProvider.getInstances();
        const billing = await cloudGPUProvider.getBilling();
        res.json({ instances, billing });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Rent a GPU
    this.app.post('/api/v1/gpu/rent', localAuth, async (req, res) => {
      try {
        const { offerId } = req.body;
        if (!offerId) {
          res.status(400).json({ error: 'Offer ID required' });
          return;
        }
        if (!cloudGPUProvider.isConfigured()) {
          res.status(400).json({ error: 'Cloud GPU not configured' });
          return;
        }
        const instance = await cloudGPUProvider.rentInstance(offerId);
        res.json({ success: true, instance });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Create tunnel to instance
    this.app.post('/api/v1/gpu/instances/:id/tunnel', localAuth, async (req, res) => {
      try {
        const instanceId = parseInt(req.params.id as string);
        const localPort = parseInt(req.query.port as string) || 11434;
        const tunnel = await cloudGPUProvider.createTunnel(instanceId, localPort);
        res.json({ success: true, tunnel });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Disconnect tunnel
    this.app.delete('/api/v1/gpu/instances/:id/tunnel', localAuth, async (req, res) => {
      try {
        const instanceId = parseInt(req.params.id as string);
        cloudGPUProvider.disconnectTunnel(instanceId);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Terminate instance
    this.app.delete('/api/v1/gpu/instances/:id', localAuth, async (req, res) => {
      try {
        const instanceId = parseInt(req.params.id as string);
        await cloudGPUProvider.terminateInstance(instanceId);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Pull model on remote instance
    this.app.post('/api/v1/gpu/instances/:id/pull', localAuth, async (req, res) => {
      try {
        const instanceId = parseInt(req.params.id as string);
        const { model } = req.body;
        if (!model) {
          res.status(400).json({ error: 'Model name required' });
          return;
        }
        await cloudGPUProvider.pullModel(instanceId, model);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // List models on remote instance
    this.app.get('/api/v1/gpu/instances/:id/models', localAuth, async (req, res) => {
      try {
        const instanceId = parseInt(req.params.id as string);
        const models = await cloudGPUProvider.listRemoteModels(instanceId);
        res.json({ models });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // ============ Git Service Endpoints ============

    // Get GitHub OAuth URL
    this.app.get('/api/v1/git/github/auth-url', localAuth, (req, res) => {
      const session = (req as any).session;
      const { url, state } = GitService.getGitHubOAuthUrl(session.userId);
      res.json({ url, state });
    });

    // GitHub OAuth callback
    this.app.get('/auth/github/callback', async (req, res) => {
      const { code, state } = req.query;
      if (!code || !state) {
        res.status(400).send('Missing code or state');
        return;
      }
      const result = await GitService.handleGitHubCallback(code as string, state as string);
      if (result.success) {
        res.send(`
          <html>
            <body style="background: #18181b; color: #fafafa; font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h2 style="color: #00ff88;">GitHub Connected!</h2>
                <p>You can close this window.</p>
              </div>
            </body>
          </html>
        `);
      } else {
        res.status(400).send(`
          <html>
            <body style="background: #18181b; color: #fafafa; font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h2 style="color: #ef4444;">Connection Failed</h2>
                <p>${result.error}</p>
              </div>
            </body>
          </html>
        `);
      }
    });

    // Get GitHub connection status
    this.app.get('/api/v1/git/github/status', localAuth, (req, res) => {
      const session = (req as any).session;
      const github = GitService.getGitHubUser(session.userId);
      if (github) {
        res.json({ connected: true, user: github.user });
      } else {
        res.json({ connected: false });
      }
    });

    // Disconnect GitHub
    this.app.post('/api/v1/git/github/disconnect', localAuth, (req, res) => {
      const session = (req as any).session;
      GitService.disconnectGitHub(session.userId);
      res.json({ success: true });
    });

    // List GitHub repositories
    this.app.get('/api/v1/git/github/repos', localAuth, async (req, res) => {
      const session = (req as any).session;
      const result = await GitService.listGitHubRepos(session.userId);
      if (result.success) {
        res.json({ repos: result.repos });
      } else {
        res.status(400).json({ error: result.error });
      }
    });

    // Get SSH keys
    this.app.get('/api/v1/git/ssh-keys', localAuth, (req, res) => {
      const keys = GitService.getSSHKeys();
      res.json({ keys });
    });

    // Generate SSH key
    this.app.post('/api/v1/git/ssh-keys/generate', localAuth, (req, res) => {
      const { name } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }
      const result = GitService.generateSSHKey(name);
      if (result.success) {
        res.json({ success: true, key: result.key });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    });

    // Import SSH key
    this.app.post('/api/v1/git/ssh-keys/import', localAuth, (req, res) => {
      const { name, privateKey } = req.body;
      if (!name || !privateKey) {
        res.status(400).json({ error: 'Name and privateKey are required' });
        return;
      }
      const result = GitService.importSSHKey(name, privateKey);
      if (result.success) {
        res.json({ success: true, key: result.key });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    });

    // Delete SSH key
    this.app.delete('/api/v1/git/ssh-keys/:keyId', localAuth, (req, res) => {
      const keyId = req.params.keyId as string;
      const result = GitService.deleteSSHKey(keyId);
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    });

    // Clone repository
    this.app.post('/api/v1/git/clone', localAuth, async (req, res) => {
      const session = (req as any).session;
      const { url, targetDir, branch, depth } = req.body;
      if (!url || !targetDir) {
        res.status(400).json({ error: 'url and targetDir are required' });
        return;
      }
      const credentials = GitService.getCredentials(session.userId);
      const result = await GitService.cloneRepo({
        url,
        targetDir,
        credentials: credentials || undefined,
        branch,
        depth,
      });
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    });

    // ============ Repository Analysis Endpoints ============

    // Analysis cache (keyed by repo path)
    const analysisCache: Map<string, { analysis: RepoAnalysis; timestamp: number }> = new Map();
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Analyze a local repository
    this.app.post('/api/v1/repos/analyze', localAuth, async (req, res) => {
      const { path: repoPath } = req.body;
      if (!repoPath) {
        res.status(400).json({ error: 'path is required' });
        return;
      }

      try {
        // Check cache
        const cached = analysisCache.get(repoPath);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          res.json({ analysis: cached.analysis, cached: true });
          return;
        }

        console.log(`[API] Analyzing repository: ${repoPath}`);
        const analysis = await analyzeRepository(repoPath);

        // Cache result
        analysisCache.set(repoPath, { analysis, timestamp: Date.now() });

        res.json({ analysis, cached: false });
      } catch (err) {
        console.error('[API] Repository analysis failed:', err);
        res.status(500).json({ error: String(err) });
      }
    });

    // Get cached analysis
    this.app.get('/api/v1/repos/analysis', localAuth, (req, res) => {
      const repoPath = req.query.path as string;
      if (!repoPath) {
        res.status(400).json({ error: 'path query parameter is required' });
        return;
      }

      const cached = analysisCache.get(repoPath);
      if (cached) {
        const stale = Date.now() - cached.timestamp > CACHE_TTL;
        res.json({ analysis: cached.analysis, cached: true, stale });
      } else {
        res.status(404).json({ error: 'No cached analysis found' });
      }
    });

    // Clear analysis cache
    this.app.delete('/api/v1/repos/analysis', localAuth, (req, res) => {
      const repoPath = req.query.path as string;
      if (repoPath) {
        analysisCache.delete(repoPath);
      } else {
        analysisCache.clear();
      }
      res.json({ success: true });
    });

    // Workspace repo analysis (analyze a workspace's connected repo)
    this.app.post('/api/v1/workspaces/:id/repos/:repoId/analyze', localAuth, async (req, res) => {
      const workspaceId = req.params.id as string;
      const repoId = req.params.repoId as string;

      // Get repo from workspace
      const repos = reposStore.get(workspaceId) || [];
      const repo = repos.find(r => r.id === repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Check if we have a local clone path
      if (!repo.localPath) {
        // Need to clone first
        res.status(400).json({ error: 'Repository not cloned yet. Clone it first.' });
        return;
      }

      try {
        repo.status = 'analyzing';
        const analysis = await analyzeRepository(repo.localPath);
        repo.status = 'ready';
        repo.analysis = analysis;
        repo.analyzedAt = new Date().toISOString();

        res.json({ analysis });
      } catch (err) {
        repo.status = 'error';
        repo.error = String(err);
        res.status(500).json({ error: String(err) });
      }
    });

    // ============ MCP Adapter Endpoints ============

    // List all registered adapters
    this.app.get('/api/v1/adapters', async (req, res) => {
      try {
        const adapters = adapterManager.listAdapters().map(reg => ({
          name: reg.info.name,
          version: reg.info.version,
          description: reg.info.description,
          capabilities: reg.info.capabilities,
          methods: reg.methods,
        }));
        res.json({ adapters });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Get MCP-compatible tool definitions
    this.app.get('/api/v1/adapters/tools', async (req, res) => {
      try {
        const tools = adapterManager.getMcpTools();
        res.json({ tools });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Get specific adapter info
    this.app.get('/api/v1/adapters/:name', async (req, res) => {
      try {
        const adapter = adapterManager.getAdapter(req.params.name);
        if (!adapter) {
          res.status(404).json({ error: `Adapter not found: ${req.params.name}` });
          return;
        }
        res.json({
          name: adapter.info.name,
          version: adapter.info.version,
          description: adapter.info.description,
          capabilities: adapter.info.capabilities,
          requirements: adapter.info.requirements,
          methods: Array.from(adapter.methods.entries()).map(([name, method]) => ({
            name,
            description: method.description,
          })),
        });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Execute adapter method
    this.app.post('/api/v1/adapters/:name/:method', localAuth, async (req, res) => {
      const name = req.params.name as string;
      const method = req.params.method as string;
      const params = req.body;

      try {
        console.log(`[API] Executing adapter method: ${name}/${method}`);
        const result = await adapterManager.execute(name, method, params, {
          on_progress: (progress, message) => {
            // Could broadcast via WebSocket if needed
            console.log(`[API] ${name}/${method} progress: ${progress}% - ${message}`);
          },
        });
        res.json({ success: true, result });
      } catch (err: any) {
        console.error(`[API] Adapter execution error:`, err);
        res.status(400).json({
          success: false,
          error: err.message || String(err),
        });
      }
    });

    // Execute by MCP tool name (adapter/method format)
    this.app.post('/api/v1/mcp/execute', localAuth, async (req, res) => {
      const { tool, params } = req.body;

      if (!tool) {
        res.status(400).json({ error: 'Tool name required' });
        return;
      }

      try {
        console.log(`[API] Executing MCP tool: ${tool}`);
        const result = await adapterManager.executeByToolName(tool, params || {});
        res.json({ success: true, result });
      } catch (err: any) {
        console.error(`[API] MCP execution error:`, err);
        res.status(400).json({
          success: false,
          error: err.message || String(err),
        });
      }
    });

    // My Nodes Endpoint (for web UI node detection)
    this.app.get('/api/v1/my-nodes', localAuth, async (req, res) => {
      try {
        // Get hardware info from Ollama manager or use defaults
        const ollamaStatus = this.ollamaManager ? await this.ollamaManager.getStatus() : null;
        const os = require('os');

        // Get registered MCP adapters
        const adapters = adapterManager.listAdapters().map(reg => ({
          name: reg.info.name,
          version: reg.info.version,
          capabilities: reg.info.capabilities,
        }));

        res.json({
          nodes: [{
            id: 'local-node',
            shareKey: this.localNodeShareKey,
            available: true,
            workspaceIds: [],
            workspaceNames: ['Local'],
            isOwner: true,
            isUnclaimed: false,
            capabilities: {
              cpu: {
                model: 'Local CPU',
                cores: os.cpus().length,
                threads: os.cpus().length,
              },
              memory: {
                total_mb: Math.round(os.totalmem() / 1024 / 1024),
                available_mb: Math.round(os.freemem() / 1024 / 1024),
              },
              gpus: [],
              storage: {
                total_gb: 500,
                available_gb: 100,
              },
              ollama: ollamaStatus?.running ? {
                installed: true,
                models: ollamaStatus.models || [],
                endpoint: ollamaStatus.endpoint || 'http://localhost:11434',
              } : undefined,
              mcp_adapters: adapters,
            },
          }],
        });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Assign node to workspaces (stub - in local mode, node is always available)
    this.app.post('/api/v1/nodes/:nodeId/workspaces', localAuth, (req, res) => {
      const nodeId = req.params.nodeId as string;
      const { workspaceIds } = req.body;
      // In local mode, we just acknowledge the request
      // UI expects { workspaces: [...] } with .length property
      const assignedWorkspaces = (workspaceIds || []).map((id: string) => ({ id, name: 'Workspace' }));
      res.json({
        success: true,
        nodeId,
        workspaces: assignedWorkspaces,
        message: 'Node assignment acknowledged (local mode)',
      });
    });

    // ============ Web3 / Blockchain Endpoints ============

    // Get contract addresses for the frontend
    this.app.get('/api/v1/web3/contracts', (req, res) => {
      res.json({
        sepolia: CONTRACT_ADDRESSES.sepolia,
        localhost: CONTRACT_ADDRESSES.localhost,
        // Include ABIs endpoint info
        abiEndpoints: {
          OTT: '/api/v1/web3/abi/ott',
          NodeRegistry: '/api/v1/web3/abi/node-registry',
          TaskEscrow: '/api/v1/web3/abi/task-escrow',
        },
      });
    });

    // Set contract addresses (after deployment)
    this.app.post('/api/v1/web3/contracts', localAuth, (req, res) => {
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
    this.app.post('/api/v1/web3/fund-wallet', localAuth, async (req, res) => {
      const { address } = req.body;
      if (!address) {
        res.status(400).json({ error: 'Address required' });
        return;
      }

      try {
        const { ethers } = await import('ethers');

        // Test funder wallet - REMOVE IN PRODUCTION
        const FUNDER_KEY = process.env.FUNDER_PRIVATE_KEY || '0x8ccc85bee32302669e4fed58d038a8373634dee36de8ae168f7cf07739b21979';
        const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
        const funderWallet = new ethers.Wallet(FUNDER_KEY, provider);

        const OTT_ADDRESS = CONTRACT_ADDRESSES.sepolia.OTT;
        const OTT_ABI = [
          'function transfer(address to, uint256 amount) returns (bool)',
          'function balanceOf(address) view returns (uint256)',
        ];

        // Check funder balances
        const funderEth = await provider.getBalance(funderWallet.address);
        const ottContract = new ethers.Contract(OTT_ADDRESS, OTT_ABI, funderWallet);
        const funderOtt = await ottContract.balanceOf(funderWallet.address);

        const ethAmount = ethers.parseEther('0.01'); // 0.01 ETH for gas
        const ottAmount = ethers.parseEther('500');  // 500 OTT for staking + testing

        if (funderEth < ethAmount) {
          res.status(400).json({ error: 'Funder wallet has insufficient ETH' });
          return;
        }
        if (funderOtt < ottAmount) {
          res.status(400).json({ error: 'Funder wallet has insufficient OTT' });
          return;
        }

        // Send ETH
        console.log(`[Fund] Sending 0.01 ETH to ${address}...`);
        const ethTx = await funderWallet.sendTransaction({
          to: address,
          value: ethAmount,
        });
        await ethTx.wait();

        // Send OTT
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
    this.app.get('/api/v1/web3/node-capabilities', localAuth, async (req, res) => {
      const os = require('os');
      const cpus = os.cpus();
      const totalMem = os.totalmem();

      // Check Ollama status
      let hasOllama = false;
      if (this.ollamaManager) {
        try {
          const status = await this.ollamaManager.getStatus();
          hasOllama = status.running;
        } catch {
          // Ignore
        }
      }

      // Check Sandbox status
      const hasSandbox = this.sandboxManager !== null;

      res.json({
        capabilities: {
          cpuCores: cpus.length,
          memoryMb: Math.round(totalMem / 1024 / 1024),
          gpuCount: 0, // TODO: Detect GPU
          gpuVramMb: 0,
          hasOllama,
          hasSandbox,
        },
        hostname: os.hostname(),
        platform: os.platform(),
      });
    });

    // Supported networks info
    this.app.get('/api/v1/web3/networks', (req, res) => {
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

    // Verify and link an on-chain node
    this.app.post('/api/v1/web3/nodes/verify', localAuth, async (req, res) => {
      const { onChainNodeId, walletAddress, signature, challenge, localNodeId } = req.body;

      if (!onChainNodeId || !walletAddress || !signature || !challenge || !localNodeId) {
        res.status(400).json({ error: 'Missing required fields: onChainNodeId, walletAddress, signature, challenge, localNodeId' });
        return;
      }

      try {
        // Initialize web3 service for verification
        await web3Service.initWithRpc('https://ethereum-sepolia-rpc.publicnode.com', 'sepolia');

        // Verify the signature
        const signatureValid = web3Service.verifySignature(challenge, signature, walletAddress);
        if (!signatureValid) {
          res.status(401).json({ error: 'Invalid signature - wallet ownership not proven' });
          return;
        }

        // Verify node ownership on-chain
        const isOwner = await web3Service.verifyNodeOwnership(onChainNodeId, walletAddress);
        if (!isOwner) {
          res.status(401).json({ error: 'Wallet does not own this on-chain node' });
          return;
        }

        // Verify node is eligible (active, not slashed)
        const isEligible = await web3Service.isNodeEligible(onChainNodeId);
        if (!isEligible) {
          res.status(400).json({ error: 'On-chain node is not eligible (inactive or slashed)' });
          return;
        }

        // Get node details from chain
        const nodeDetails = await web3Service.getNode(onChainNodeId);

        // Store the verified node
        const record: OnChainNodeRecord = {
          nodeId: onChainNodeId,
          walletAddress,
          localNodeId,
          verifiedAt: new Date().toISOString(),
          computeSeconds: 0,
          lastReported: new Date().toISOString(),
        };
        this.onChainNodes.set(localNodeId, record);

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

    // Get on-chain verified nodes
    this.app.get('/api/v1/web3/nodes/verified', localAuth, (req, res) => {
      const nodes = Array.from(this.onChainNodes.values()).map(n => ({
        onChainNodeId: n.nodeId,
        walletAddress: n.walletAddress,
        localNodeId: n.localNodeId,
        verifiedAt: n.verifiedAt,
        computeSeconds: n.computeSeconds,
        lastReported: n.lastReported,
      }));
      res.json({ nodes });
    });

    // Report compute time for a node (called after job completion)
    this.app.post('/api/v1/web3/nodes/:localNodeId/compute', localAuth, (req, res) => {
      const localNodeId = req.params.localNodeId as string;
      const { seconds } = req.body;

      if (typeof seconds !== 'number' || seconds < 0) {
        res.status(400).json({ error: 'Invalid seconds value' });
        return;
      }

      const record = this.onChainNodes.get(localNodeId);
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

    // Get pending compute time to report
    this.app.get('/api/v1/web3/nodes/:localNodeId/pending-compute', localAuth, (req, res) => {
      const localNodeId = req.params.localNodeId as string;
      const record = this.onChainNodes.get(localNodeId);

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

    // Unlink an on-chain node
    this.app.delete('/api/v1/web3/nodes/:localNodeId', localAuth, (req, res) => {
      const localNodeId = req.params.localNodeId as string;
      const existed = this.onChainNodes.delete(localNodeId);

      if (!existed) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }

      console.log(`[ApiServer] On-chain node unlinked: ${localNodeId}`);
      res.json({ success: true });
    });

    // Submit compute report to blockchain
    // Note: This requires the reporter wallet to be an authorized reporter on the contract
    this.app.post('/api/v1/web3/nodes/:localNodeId/report', localAuth, async (req, res) => {
      const localNodeId = req.params.localNodeId as string;
      const { privateKey } = req.body; // Reporter's private key (should be an authorized reporter)

      if (!privateKey) {
        res.status(400).json({ error: 'Private key required for blockchain transaction' });
        return;
      }

      const record = this.onChainNodes.get(localNodeId);
      if (!record) {
        res.status(404).json({ error: 'Node not verified on-chain' });
        return;
      }

      if (record.computeSeconds <= 0) {
        res.json({ success: true, message: 'No compute time to report', computeSeconds: 0 });
        return;
      }

      try {
        // Initialize web3 with the reporter's private key
        await web3Service.initWithPrivateKey(
          privateKey,
          'https://ethereum-sepolia-rpc.publicnode.com',
          'sepolia'
        );

        // Check if this wallet is an authorized reporter
        const isAuthorized = await web3Service.isAuthorizedReporter(web3Service.address!);
        if (!isAuthorized) {
          res.status(403).json({ error: 'Wallet is not an authorized reporter on the contract' });
          return;
        }

        // Report compute time to blockchain
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

    // Get all on-chain stats (for dashboard)
    this.app.get('/api/v1/web3/stats', localAuth, async (req, res) => {
      try {
        await web3Service.initWithRpc('https://ethereum-sepolia-rpc.publicnode.com', 'sepolia');

        const totalVerifiedNodes = this.onChainNodes.size;
        let totalPendingCompute = 0;
        for (const record of this.onChainNodes.values()) {
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

  private async runAgentExecution(execution: AgentExecutionLocal): Promise<void> {
    try {
      // Update status to running
      execution.status = 'running';
      execution.progressMessage = 'Agent is thinking...';
      this.broadcastAgentProgress(execution);

      // Use the agentService to run the execution
      const result = await agentService.executeAgent(
        execution.workspaceId,
        execution.id,
        execution.goal,
        {
          model: execution.model,
          maxIterations: 10,
        }
      );

      // Subscribe to updates from agentService
      agentService.subscribe(execution.workspaceId, (exec) => {
        // Update our local execution with the service's execution data
        const localExec = this.agentExecutions.get(exec.id);
        if (localExec) {
          localExec.status = exec.status as AgentExecutionLocal['status'];
          localExec.progress = exec.progress || 0;
          localExec.progressMessage = exec.progressMessage || '';
          localExec.result = exec.result;
          localExec.error = exec.error;
          localExec.tokensUsed = exec.tokensUsed || 0;
          localExec.iterations = exec.iterations || 0;
          if (exec.status === 'completed' || exec.status === 'failed') {
            localExec.completedAt = new Date().toISOString();
          }
          this.broadcastAgentProgress(localExec);
        }
      });

    } catch (err) {
      execution.status = 'failed';
      execution.error = String(err);
      execution.completedAt = new Date().toISOString();
      this.broadcastAgentProgress(execution);
    }
  }

  private broadcastAgentProgress(execution: AgentExecutionLocal): void {
    const clients = this.agentsWsClients.get(execution.workspaceId);
    if (!clients) return;

    const message = JSON.stringify({
      type: 'agent_progress',
      agentId: execution.id,
      progress: execution.progress,
      message: execution.progressMessage,
      action: execution.status === 'completed' || execution.status === 'failed' ? {
        final: true,
        result: { status: execution.status, result: execution.result },
      } : undefined,
    });

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private broadcastAgentUpdate(workspaceId: string, execution: AgentExecution): void {
    const clients = this.agentsWsClients.get(workspaceId);
    if (!clients) return;

    const message = JSON.stringify({
      type: 'agent_update',
      execution: {
        id: execution.id,
        agentId: execution.agentId,
        status: execution.status,
        result: execution.result,
        error: execution.error,
        tokensUsed: execution.tokensUsed,
        iterations: execution.iterations,
        sandboxCid: execution.sandboxCid,
        computeInfo: execution.computeInfo,
      },
    });

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  start(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Initialize MCP adapters
      try {
        await adapterManager.initialize();
        console.log('[ApiServer] MCP adapters initialized');
      } catch (err) {
        console.error('[ApiServer] Failed to initialize adapters:', err);
      }

      this.server = http.createServer(this.app);

      this.wss = new WebSocketServer({ server: this.server, path: '/ws/agents' });

      this.wss.on('connection', (ws) => {
        console.log('[ApiServer] WebSocket client connected');

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'subscribe' && msg.workspaceId) {
              if (!this.agentsWsClients.has(msg.workspaceId)) {
                this.agentsWsClients.set(msg.workspaceId, new Set());
              }
              this.agentsWsClients.get(msg.workspaceId)!.add(ws);
              console.log(`[ApiServer] Client subscribed to workspace ${msg.workspaceId}`);
            }
          } catch (err) {
            console.error('[ApiServer] Invalid WebSocket message:', err);
          }
        });

        ws.on('close', () => {
          for (const clients of this.agentsWsClients.values()) {
            clients.delete(ws);
          }
        });
      });

      this.server.listen(PORT, () => {
        console.log(`[ApiServer] HTTP API listening on http://localhost:${PORT}`);
        console.log(`[ApiServer] WebSocket at ws://localhost:${PORT}/ws/agents`);
        resolve();
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[ApiServer] Port ${PORT} in use, trying ${PORT + 1}`);
          this.server?.listen(PORT + 1);
        } else {
          reject(err);
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) this.wss.close();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

export const apiServer = new ApiServer();
