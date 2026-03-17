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
import { WebSocketServer, WebSocket } from 'ws';

import { WorkspaceManager } from './services/workspace-manager';
import { agentService, AgentExecution } from './services/agent-service';
import { OllamaManager } from './ollama-manager';
import { SandboxManager } from './sandbox-manager';
import { IPFSManager } from './ipfs-manager';
import { adapterManager } from './adapters/adapter-manager';
import { appwriteService } from './services/appwrite-service';
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
import { remoteInferenceService } from './services/remote-inference';
import type { AgentExecutionLocal, OnChainNodeRecord, WorkspaceNodeRecord, ManagerRefs } from './routes/types';

const PORT = 8080;

// Local mode - bypass auth for desktop app
const localAuth = (req: Request, res: Response, next: express.NextFunction) => {
  (req as any).session = {
    userId: 'local-user',
    username: 'local',
    token: 'local-token',
  };
  next();
};

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

  setManagers(
    ollama: OllamaManager | null,
    sandbox: SandboxManager | null,
    ipfs: IPFSManager | null
  ): void {
    this.managerRefs.ollamaManager = ollama;
    this.managerRefs.sandboxManager = sandbox;
    this.managerRefs.ipfsManager = ipfs;
    agentService.setManagers(ollama, sandbox);

    // Wire up AI services
    ipfsExportService.setIPFSManager(ipfs);
    transcriptionService.setOllamaManager(ollama);
    safetyService.setOllamaManager(ollama);
    digestService.setOllamaManager(ollama);
    handoffService.setOllamaManager(ollama);
    disputeService.setOllamaManager(ollama);
    healthReportService.setOllamaManager(ollama);

    // Register scheduled jobs
    digestService.registerScheduledJob();
    healthReportService.registerScheduledJob();

    // Configure remote inference via OpenRouter if API key is set
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (openRouterKey) {
      remoteInferenceService.configure({
        apiKey: openRouterKey,
        model: process.env.OPENROUTER_MODEL || 'google/gemma-3-4b-it:free',
        dailyLimit: parseInt(process.env.OPENROUTER_DAILY_LIMIT || '100'),
      });
    }
  }

  private setupMiddleware(): void {
    this.app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    this.app.use(express.json());
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
      // Initialize Appwrite
      if (process.env.APPWRITE_PROJECT_ID && process.env.APPWRITE_API_KEY) {
        try {
          appwriteService.init({
            endpoint: process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1',
            projectId: process.env.APPWRITE_PROJECT_ID,
            apiKey: process.env.APPWRITE_API_KEY,
          });
          console.log('[ApiServer] Appwrite initialized');
        } catch (err) {
          console.error('[ApiServer] Failed to initialize Appwrite:', err);
        }
      } else {
        console.log('[ApiServer] Appwrite not configured (missing env vars)');
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
        await chainSyncService.start('https://ethereum-sepolia-rpc.publicnode.com', 'sepolia');
        console.log('[ApiServer] Chain sync started');
      } catch (err) {
        console.warn('[ApiServer] Chain sync failed to start:', err);
      }

      this.server = http.createServer(this.app);

      this.wss = new WebSocketServer({ server: this.server, path: '/ws/agents' });

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
