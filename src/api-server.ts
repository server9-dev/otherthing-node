/**
 * Local API Server
 *
 * Express HTTP server embedded in the Node app.
 * Provides the same API as the orchestrator but runs locally.
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

import { WorkspaceManager } from './services/workspace-manager';
import { agentService, AgentExecution } from './services/agent-service';
import { OllamaManager } from './ollama-manager';
import { SandboxManager } from './sandbox-manager';
import { IPFSManager } from './ipfs-manager';
import { adapterManager } from './adapters/adapter-manager';
import { requireUser, nodeSession, isSupabaseConfigured, verifyAccessToken, db } from './services/supabase-client';
import { resolveChainWorkspace, isChainWorkspaceId, BridgeError } from './services/chain-bridge';
import { registerAllRoutes } from './routes';
import { chainSyncService } from './services/chain-sync';
import { ipfsExportService } from './services/ipfs-export-service';
import { schedulerService } from './services/scheduler-service';
import { transcriptionService } from './services/transcription-service';
import { digestService } from './services/digest-service';
import { handoffService } from './services/handoff-service';
import { disputeService } from './services/dispute-service';
import { healthReportService } from './services/health-report-service';
import { safetyService } from './services/safety-service';
import { inferenceRelay } from './services/inference-relay';
import { ipfsSyncService } from './services/ipfs-sync-service';
import { remoteInferenceService } from './services/remote-inference';
import { PLATFORM } from './platform-config';
import type { AgentExecutionLocal, OnChainNodeRecord, WorkspaceNodeRecord, ManagerRefs } from './routes/types';

const PORT = 8080;

// Every API route requires a signed-in Supabase user (see services/supabase-client.ts).
// Kept under the old name because all route modules receive it as `localAuth`.
const localAuth = requireUser;

const CHAIN_WS_PATH_RE = /^\/api\/v1\/workspaces\/(0x[0-9a-fA-F]{64})(\/[^?]*)?/;
const CHAIN_NATIVE_SUBPATH_RE = /^\/(agreements|milestone-tasks|ip|bans|flags)(\/|$)/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * OTHERTHING_WEB_MODE=1: this node serves the web app (e.g. app.otherthing.ai)
 * to many users. Only collaboration and inference routes are exposed — nothing
 * that runs commands, touches the disk, spends money or changes the node's
 * identity (agents, sandboxes, git/repos, storage, IPFS, model pulls, GPU
 * rental, wallet/treasury, settings, node session handoff).
 */
const WEB_MODE = process.env.OTHERTHING_WEB_MODE === '1';
const WEB_ALLOWED_ROUTES: RegExp[] = [
  /^\/api\/v1\/auth\/(config|me)$/,
  /^\/api\/v1\/workspaces(\/join)?$/,
  /^\/api\/v1\/workspaces\/[^/]+(\/(leave|invite-code))?$/,
  /^\/api\/v1\/workspaces\/[^/]+\/(chat|tasks|flows|uaf|agreements|milestone-tasks|ip|signal|digest|handoff|models|usage|compute)(\/.*)?$/,
  /^\/api\/v1\/(agreements|milestone-tasks|ip|profile)(\/.*)?$/,
  /^\/api\/v1\/ollama\/(status|models|chat)$/,
  /^\/api\/v1\/models$/,
];
const WEB_READ_ONLY_ROUTES: RegExp[] = [
  /^\/api\/v1\/workspaces\/[^/]+\/nodes$/,
];

export class ApiServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private workspaceManager: WorkspaceManager;
  private managerRefs: ManagerRefs = { ollamaManager: null, sandboxManager: null, ipfsManager: null };
  private agentsWsClients: Map<string, Set<WebSocket>> = new Map();
  private agentExecutions: Map<string, AgentExecutionLocal> = new Map();
  // On-chain node tracking
  private onChainNodes: Map<string, OnChainNodeRecord> = new Map();
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
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let key = '';
    for (let i = 0; i < 8; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  }

  getWorkspaceManager(): WorkspaceManager {
    return this.workspaceManager;
  }

  setManagers(
    ollama: OllamaManager | null,
    sandbox: SandboxManager | null,
    ipfs: IPFSManager | null
  ): void {
    this.managerRefs.ollamaManager = ollama;
    this.managerRefs.sandboxManager = sandbox;
    this.managerRefs.ipfsManager = ipfs;
    agentService.setManagers(ollama, sandbox);

    // Wire up services
    ipfsExportService.setIPFSManager(ipfs);
    ipfsSyncService.setIPFSManager(ipfs);
    ipfsSyncService.setOllamaManager(ollama);
    safetyService.setOllamaManager(ollama);
    digestService.setOllamaManager(ollama);
    handoffService.setOllamaManager(ollama);
    disputeService.setOllamaManager(ollama);
    healthReportService.setOllamaManager(ollama);

    // Register scheduled jobs
    digestService.registerScheduledJob();
    healthReportService.registerScheduledJob();

    // Start inference relay — picks up peer inference requests and runs them locally
    if (ollama) {
      inferenceRelay.setOllamaManager(ollama);
      inferenceRelay.start();
    }

    // Configure remote inference for premium tier
    remoteInferenceService.configure({
      apiKey: PLATFORM.inference.apiKey,
      model: PLATFORM.inference.model,
      dailyLimit: PLATFORM.inference.dailyLimit,
    });
  }

  private setupMiddleware(): void {
    this.app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    this.app.use(express.json({ limit: '50mb' }));

    if (WEB_MODE) {
      this.app.use('/api', (req, res, next) => {
        const path = '/api' + req.path;
        if (WEB_ALLOWED_ROUTES.some(re => re.test(path))) return next();
        if (req.method === 'GET' && WEB_READ_ONLY_ROUTES.some(re => re.test(path))) return next();
        res.status(404).json({ error: 'Not available in the web app — use the desktop app' });
      });
      console.log('[ApiServer] Web mode: only collaboration and inference routes are served');
    }

    // The UI addresses workspaces by their on-chain id (bytes32). Everything
    // stored in Postgres is keyed by the linked workspace's uuid, so rewrite
    // those requests. Chain-native sub-resources keep the bytes32 id.
    this.app.use((req, res, next) => {
      const m = req.url.match(CHAIN_WS_PATH_RE);
      const chainInPath = m && m[2] && !CHAIN_NATIVE_SUBPATH_RE.test(m[2]) ? m[1] : null;
      const chainInBody = req.path === '/api/v1/ollama/chat' && isChainWorkspaceId(req.body?.workspaceId)
        ? req.body.workspaceId as string : null;
      const chainId = chainInPath || chainInBody;
      if (!chainId) return next();

      requireUser(req, res, async () => {
        try {
          const workspaceId = await resolveChainWorkspace(chainId);
          if (chainInPath) req.url = req.url.replace(chainId, workspaceId);
          if (chainInBody) req.body.workspaceId = workspaceId;
          next();
        } catch (err) {
          const status = err instanceof BridgeError ? err.status : 502;
          res.status(status).json({ error: (err as Error).message });
        }
      });
    });

    // Workspace sub-resources are cached in memory per workspace, so check
    // membership here instead of relying on each route's database query.
    const memberCache = new Map<string, number>(); // `${userId}:${ws}` -> expiry
    this.app.use('/api/v1/workspaces/:id/', (req, res, next) => {
      const ws = req.params.id as string;
      if (!UUID_RE.test(ws)) return next(); // join, chain (bytes32) ids, ...
      requireUser(req, res, async () => {
        const key = `${(req as any).session.userId}:${ws}`;
        if ((memberCache.get(key) || 0) > Date.now()) return next();
        const { data, error } = await db().rpc('is_member', { ws });
        if (error || !data) {
          res.status(403).json({ error: 'Not a member of this workspace' });
          return;
        }
        memberCache.set(key, Date.now() + 60_000);
        next();
      });
    });
  }

  private setupRoutes(): void {
    registerAllRoutes({
      app: this.app,
      workspaceManager: this.workspaceManager,
      managers: this.managerRefs,
      localAuth,
      agentExecutions: this.agentExecutions,
      onChainNodes: this.onChainNodes,
      workspaceNodes: this.workspaceNodes,
      localNodeShareKey: this.localNodeShareKey,
      agentsWsClients: this.agentsWsClients,
      broadcastAgentProgress: this.broadcastAgentProgress.bind(this),
    });

    // Web mode: serve the web build of the renderer (VITE_WEB=1) from this origin
    if (WEB_MODE) {
      const webRoot = process.env.OTHERTHING_WEB_ROOT || path.join(__dirname, 'renderer');
      this.app.use(express.static(webRoot, { index: 'index.html', maxAge: '1h' }));
      this.app.get(/^(?!\/api\/|\/ws\/).*/, (req, res) => res.sendFile(path.join(webRoot, 'index.html')));
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
      // Restore the node's Supabase session (saved sign-in, or
      // OTHERTHING_NODE_EMAIL/PASSWORD on headless nodes)
      if (isSupabaseConfigured()) {
        try {
          const user = await nodeSession.restore();
          console.log(user
            ? `[ApiServer] Supabase: signed in as ${user.email || user.id}`
            : '[ApiServer] Supabase: not signed in — waiting for sign-in');
        } catch (err) {
          console.error('[ApiServer] Failed to restore Supabase session:', err);
        }
      } else {
        console.warn('[ApiServer] Supabase not configured (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY) — workspace sync disabled');
      }

      // Initialize MCP adapters
      try {
        await adapterManager.initialize();
        console.log('[ApiServer] MCP adapters initialized');
      } catch (err) {
        console.error('[ApiServer] Failed to initialize adapters:', err);
      }

      // Start chain sync (Phase 6)
      try {
        await chainSyncService.start(PLATFORM.chain.rpcUrl, PLATFORM.chain.network);
        console.log('[ApiServer] Chain sync started');
      } catch (err) {
        console.warn('[ApiServer] Chain sync failed to start:', err);
      }

      this.server = http.createServer(this.app);

      // Browsers can't set headers on a WebSocket, so the access token rides in ?token=
      this.wss = new WebSocketServer({
        server: this.server,
        path: '/ws/agents',
        verifyClient: (info, done) => {
          const token = new URL(info.req.url || '', 'http://localhost').searchParams.get('token');
          if (!token) return done(false, 401, 'Sign in required');
          verifyAccessToken(token)
            .then(user => done(!!user, 401, 'Session expired — sign in again'))
            .catch(() => done(false, 401, 'Session expired — sign in again'));
        },
      });

      // Track call participants: workspaceId -> Set<{ ws, peerId, displayName }>
      const callParticipants: Map<string, Set<{ ws: WebSocket; peerId: string; displayName: string }>> = new Map();

      this.wss.on('connection', (ws) => {
        console.log('[ApiServer] WebSocket client connected');
        let wsPeerId: string | null = null;
        let wsWorkspaceId: string | null = null;

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());

            // Existing: workspace subscription
            if (msg.type === 'subscribe' && msg.workspaceId) {
              if (!this.agentsWsClients.has(msg.workspaceId)) {
                this.agentsWsClients.set(msg.workspaceId, new Set());
              }
              this.agentsWsClients.get(msg.workspaceId)!.add(ws);
              console.log(`[ApiServer] Client subscribed to workspace ${msg.workspaceId}`);
            }

            // Voice/Video signaling: join call
            if (msg.type === 'call-join' && msg.workspaceId && msg.peerId) {
              wsWorkspaceId = msg.workspaceId;
              wsPeerId = msg.peerId;
              if (!callParticipants.has(msg.workspaceId)) {
                callParticipants.set(msg.workspaceId, new Set());
              }
              const participants = callParticipants.get(msg.workspaceId)!;
              // Send existing participants to the new joiner
              const existing = Array.from(participants).map(p => ({ peerId: p.peerId, displayName: p.displayName }));
              ws.send(JSON.stringify({ type: 'call-peers', peers: existing }));
              // Notify existing participants about the new joiner
              for (const p of participants) {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(JSON.stringify({ type: 'call-peer-joined', peerId: msg.peerId, displayName: msg.displayName || 'Unknown' }));
                }
              }
              participants.add({ ws, peerId: msg.peerId, displayName: msg.displayName || 'Unknown' });
              console.log(`[ApiServer] ${msg.displayName || msg.peerId} joined call in workspace ${msg.workspaceId} (${participants.size} participants)`);
            }

            // Voice/Video signaling: leave call
            if (msg.type === 'call-leave' && msg.workspaceId && msg.peerId) {
              const participants = callParticipants.get(msg.workspaceId);
              if (participants) {
                for (const p of participants) {
                  if (p.peerId === msg.peerId) { participants.delete(p); break; }
                }
                for (const p of participants) {
                  if (p.ws.readyState === WebSocket.OPEN) {
                    p.ws.send(JSON.stringify({ type: 'call-peer-left', peerId: msg.peerId }));
                  }
                }
                if (participants.size === 0) callParticipants.delete(msg.workspaceId);
              }
            }

            // WebRTC signaling: relay SDP offer/answer and ICE candidates to target peer
            if ((msg.type === 'sdp-offer' || msg.type === 'sdp-answer' || msg.type === 'ice-candidate') && msg.workspaceId && msg.targetPeerId) {
              const participants = callParticipants.get(msg.workspaceId);
              if (participants) {
                for (const p of participants) {
                  if (p.peerId === msg.targetPeerId && p.ws.readyState === WebSocket.OPEN) {
                    p.ws.send(JSON.stringify({ ...msg, fromPeerId: msg.peerId }));
                    break;
                  }
                }
              }
            }
          } catch (err) {
            console.error('[ApiServer] Invalid WebSocket message:', err);
          }
        });

        ws.on('close', () => {
          // Clean up agent subscriptions
          for (const clients of this.agentsWsClients.values()) {
            clients.delete(ws);
          }
          // Clean up call participant
          if (wsWorkspaceId && wsPeerId) {
            const participants = callParticipants.get(wsWorkspaceId);
            if (participants) {
              for (const p of participants) {
                if (p.peerId === wsPeerId) { participants.delete(p); break; }
              }
              for (const p of participants) {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(JSON.stringify({ type: 'call-peer-left', peerId: wsPeerId }));
                }
              }
              if (participants.size === 0) callParticipants.delete(wsWorkspaceId);
            }
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
