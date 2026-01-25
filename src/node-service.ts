import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { HardwareDetector, HardwareInfo } from './hardware';
import { IPFSManager, IPFSStats } from './ipfs-manager';
import { OllamaManager, OllamaStatus, OllamaModel } from './ollama-manager';
import { SandboxManager, FileInfo, ExecutionResult } from './sandbox-manager';
import { Web3Service } from './services/web3-service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const execAsync = promisify(exec);

// Generate a share key (8 alphanumeric chars, easy to read)
function generateShareKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 1, 0 for clarity
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

interface NodeConfig {
  shareKey: string;
  nodeId: string;
  resourceLimits: ResourceLimits;
  remoteControlEnabled: boolean;
  storagePath: string | null;  // Selected drive/path for shared storage
  // On-chain credentials (optional - for blockchain-verified nodes)
  onChainNodeId: string | null;  // bytes32 nodeId from NodeRegistry contract
  walletAddress: string | null;  // Wallet address that owns the on-chain node
}

interface Job {
  id: string;
  type: string;
  payload: any;
  workspace_id: string;
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface ResourceLimits {
  cpuCores?: number;
  ramPercent?: number;
  storageGb?: number;
  gpuVramPercent?: number[];
}

export class NodeService extends EventEmitter {
  private ws: WebSocket | null = null;
  private running = false;        // Local services running
  private networkConnected = false;  // Connected to remote network (optional)
  private nodeId: string;
  private shareKey: string; // Share key for adding this node to workspaces (locally generated)
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private orchestratorUrl: string | null = null;
  private workspaceIds: string[] = [];
  private hardware: HardwareInfo | null = null;
  private currentJobs: Map<string, Job> = new Map();
  private resourceLimits: ResourceLimits = {};
  private remoteControlEnabled = false;
  private storagePath: string | null = null;
  private configPath: string;
  private ipfsManager: IPFSManager | null = null;
  private ipfsEnabled = false;
  private ollamaManager: OllamaManager;
  private sandboxManager: SandboxManager | null = null;
  private joinedWorkspaces: Set<string> = new Set(); // Track workspaces we've joined to avoid duplicate processing
  // On-chain integration
  private onChainNodeId: string | null = null;
  private walletAddress: string | null = null;
  private web3Service: Web3Service;
  private jobComputeTime: Map<string, number> = new Map(); // Track compute time per job

  constructor() {
    super();

    // Load or create config with persistent share key
    this.configPath = path.join(app.getPath('userData'), 'node-config.json');
    const config = this.loadOrCreateConfig();
    this.shareKey = config.shareKey;
    this.nodeId = config.nodeId;
    this.resourceLimits = config.resourceLimits;
    this.remoteControlEnabled = config.remoteControlEnabled;
    this.storagePath = config.storagePath;
    this.onChainNodeId = config.onChainNodeId;
    this.walletAddress = config.walletAddress;

    // Initialize Web3 service
    this.web3Service = new Web3Service();

    // Initialize IPFS manager and Sandbox manager if storage path is set
    if (this.storagePath) {
      this.initIPFS(this.storagePath);
      this.initSandbox(this.storagePath);
    }

    // Initialize Ollama manager
    this.ollamaManager = new OllamaManager();
    this.ollamaManager.on('log', (entry) => {
      this.log(`[Ollama] ${entry.message}`, entry.type);
    });
    this.ollamaManager.on('pullProgress', (data) => {
      this.emit('ollamaPullProgress', data);
    });
  }

  private initIPFS(storagePath: string): void {
    this.ipfsManager = new IPFSManager(storagePath);

    // Forward IPFS logs to our log handler
    this.ipfsManager.on('log', (entry) => {
      this.log(`[IPFS] ${entry.message}`, entry.type);
    });

    this.ipfsManager.on('started', () => {
      this.ipfsEnabled = true;
      this.emit('ipfsStatusChange', { running: true, peerId: this.ipfsManager?.getPeerId() });
    });

    this.ipfsManager.on('stopped', () => {
      this.ipfsEnabled = false;
      this.emit('ipfsStatusChange', { running: false, peerId: null });
    });
  }

  private initSandbox(storagePath: string): void {
    this.sandboxManager = new SandboxManager(storagePath);

    // Forward Sandbox logs to our log handler
    this.sandboxManager.on('log', (entry) => {
      this.log(entry.message, entry.type);
    });

    // Connect sandbox to IPFS if available
    if (this.ipfsManager) {
      this.sandboxManager.setIPFSManager(this.ipfsManager);
    }
  }

  private loadOrCreateConfig(): NodeConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(data) as Partial<NodeConfig>;
        // Ensure all fields exist
        return {
          shareKey: config.shareKey || generateShareKey(),
          nodeId: config.nodeId || `node-${Math.random().toString(36).slice(2, 10)}`,
          resourceLimits: config.resourceLimits || {},
          remoteControlEnabled: config.remoteControlEnabled ?? false,
          storagePath: config.storagePath ?? null,
          onChainNodeId: config.onChainNodeId ?? null,
          walletAddress: config.walletAddress ?? null,
        };
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }

    // Create new config
    const config: NodeConfig = {
      shareKey: generateShareKey(),
      nodeId: `node-${Math.random().toString(36).slice(2, 10)}`,
      resourceLimits: {},
      remoteControlEnabled: false,
      storagePath: null,
      onChainNodeId: null,
      walletAddress: null,
    };
    this.saveConfig(config);
    return config;
  }

  private saveConfig(config?: NodeConfig) {
    try {
      const toSave: NodeConfig = config || {
        shareKey: this.shareKey,
        nodeId: this.nodeId,
        resourceLimits: this.resourceLimits,
        remoteControlEnabled: this.remoteControlEnabled,
        storagePath: this.storagePath,
        onChainNodeId: this.onChainNodeId,
        walletAddress: this.walletAddress,
      };
      fs.writeFileSync(this.configPath, JSON.stringify(toSave, null, 2));
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  }

  private log(message: string, type: LogEntry['type'] = 'info') {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.emit('log', { time, message, type });
  }

  /**
   * Start the node in local mode (no network connection).
   * This initializes hardware detection and local services.
   */
  async startLocal(): Promise<void> {
    if (this.running) {
      this.log('Node is already running', 'info');
      return;
    }

    this.log('Starting in local mode...', 'info');
    this.log('Detecting hardware...', 'info');
    this.hardware = await HardwareDetector.detect();
    this.log(`CPU: ${this.hardware.cpu.model} (${this.hardware.cpu.cores} cores)`, 'info');
    this.log(`RAM: ${(this.hardware.memory.total_mb / 1024).toFixed(1)} GB`, 'info');
    if (this.hardware.gpus.length > 0) {
      this.hardware.gpus.forEach((gpu) => {
        this.log(`GPU: ${gpu.model} (${(gpu.vram_mb / 1024).toFixed(0)} GB VRAM)`, 'info');
      });
    }

    this.running = true;
    this.log('Local node ready', 'success');
    this.emit('statusChange');
  }

  /**
   * Connect to a remote orchestrator network (optional).
   * The node works fully locally without this.
   */
  async connectToNetwork(orchestratorUrl: string, workspaceIds: string[] = []): Promise<void> {
    if (this.networkConnected) {
      this.log('Already connected to network', 'error');
      return;
    }

    // Ensure local mode is started first
    if (!this.running) {
      await this.startLocal();
    }

    this.orchestratorUrl = orchestratorUrl;
    this.workspaceIds = workspaceIds;

    this.log(`Connecting to network: ${orchestratorUrl}...`, 'info');
    await this.connect();
  }

  /**
   * Disconnect from the network but keep local services running.
   */
  disconnectFromNetwork(): void {
    if (!this.networkConnected) {
      this.log('Not connected to network', 'info');
      return;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.networkConnected = false;
    this.orchestratorUrl = null;
    this.log('Disconnected from network (local mode active)', 'info');
    this.emit('statusChange');
  }

  /**
   * Legacy start method for backwards compatibility.
   * Now calls startLocal + connectToNetwork.
   */
  async start(orchestratorUrl: string, workspaceIds: string[]): Promise<void> {
    await this.startLocal();
    await this.connectToNetwork(orchestratorUrl, workspaceIds);
  }

  private async connect(): Promise<void> {
    if (!this.running || !this.orchestratorUrl) return;

    this.log(`Connecting to ${this.orchestratorUrl}...`, 'info');

    try {
      this.ws = new WebSocket(this.orchestratorUrl);

      this.ws.on('open', async () => {
        this.log('Connected to network', 'success');
        this.networkConnected = true;
        this.emit('statusChange');

        // Send registration with persistent nodeId and shareKey
        // Get Ollama status for registration
        const ollamaStatus = await this.ollamaManager.getStatus();
        this.log(`Ollama status: installed=${ollamaStatus.installed}, running=${ollamaStatus.running}, models=${ollamaStatus.models?.length || 0}`, 'info');

        // Generate on-chain authentication if we have an on-chain node linked
        let onChainAuth: { nodeId: string; walletAddress: string; signature: string; challenge: string } | undefined;
        if (this.onChainNodeId && this.walletAddress && this.web3Service.connected) {
          try {
            const challenge = Web3Service.generateChallenge(this.onChainNodeId);
            const signature = await this.web3Service.signChallenge(challenge);
            onChainAuth = {
              nodeId: this.onChainNodeId,
              walletAddress: this.walletAddress,
              signature,
              challenge,
            };
            this.log(`On-chain auth generated for node ${this.onChainNodeId.slice(0, 10)}...`, 'info');
          } catch (err) {
            this.log(`Failed to generate on-chain auth: ${err}`, 'error');
          }
        }

        const registerMsg = {
          type: 'register',
          share_key: this.shareKey, // Send our locally generated share key
          capabilities: {
            node_id: this.nodeId, // Use persistent node ID
            gpus: this.hardware?.gpus.map((g) => ({
              vendor: g.vendor,
              model: g.model,
              vram_mb: g.vram_mb,
              supports: {
                cuda: g.vendor === 'nvidia',
                rocm: g.vendor === 'amd',
                vulkan: true,
                metal: g.vendor === 'apple',
                opencl: true,
              },
            })) || [],
            cpu: {
              model: this.hardware?.cpu.model || 'Unknown',
              cores: this.hardware?.cpu.cores || 1,
              threads: this.hardware?.cpu.threads || 1,
              features: [],
            },
            memory: {
              total_mb: this.hardware?.memory.total_mb || 1024,
              available_mb: this.hardware?.memory.available_mb || 512,
            },
            storage: {
              total_gb: this.hardware?.storage.total_gb || 10,
              available_gb: this.hardware?.storage.available_gb || 5,
              path: this.storagePath,  // Selected storage drive/path
            },
            mcp_adapters: [],
            ollama: ollamaStatus.running ? {
              installed: true,
              version: ollamaStatus.version,
              models: ollamaStatus.models.map((m: any) => ({
                name: m.name,
                size: m.size || 0,
                quantization: m.details?.quantization_level,
              })),
              endpoint: ollamaStatus.endpoint || 'http://localhost:11434',
            } : undefined,
          },
          workspace_ids: this.workspaceIds,
          resource_limits: this.resourceLimits,
          remote_control_enabled: this.remoteControlEnabled,
          // On-chain authentication (if linked)
          on_chain_auth: onChainAuth,
        };

        this.ws?.send(JSON.stringify(registerMsg));
        this.log(`Registering as ${this.nodeId} with key ${this.shareKey}...`, 'info');

        // Start heartbeat
        this.heartbeatInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'heartbeat',
              available: true,
              current_jobs: this.currentJobs.size,
              remote_control_enabled: this.remoteControlEnabled,
            }));
          }
        }, 15000); // Every 15 seconds
      });

      this.ws.on('message', async (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
            case 'registered':
              // Server confirms our registration - keep using our local nodeId and shareKey
              this.log(`Registered as node ${this.nodeId}`, 'success');
              this.log(`Share Key: ${this.shareKey} (use this to add node to workspaces)`, 'success');
              // Update workspace assignments from server
              if (msg.workspace_ids && Array.isArray(msg.workspace_ids)) {
                this.workspaceIds = msg.workspace_ids;
                if (this.workspaceIds.length > 0) {
                  this.log(`Assigned to ${this.workspaceIds.length} workspace(s)`, 'success');
                }
              }
              this.emit('statusChange');
              break;

            case 'job_assignment':
              this.log(`Received job: ${msg.job.id}`, 'info');
              await this.executeJob(msg.job);
              break;

            case 'job_cancelled':
              this.log(`Job cancelled: ${msg.job_id}`, 'info');
              this.currentJobs.delete(msg.job_id);
              break;

            case 'update_limits':
              this.resourceLimits = msg.limits || {};
              this.log(`Resource limits updated: CPU=${msg.limits?.cpuCores || 'all'} cores, RAM=${msg.limits?.ramPercent || 100}%`, 'success');
              this.emit('limitsChange', this.resourceLimits);
              break;

            case 'workspaces_updated':
              this.workspaceIds = msg.workspaceIds || [];
              this.log(`Assigned to ${this.workspaceIds.length} workspace(s)`, 'success');
              this.emit('statusChange');
              break;

            case 'workspace_joined':
              // Received swarm key for workspace IPFS
              try {
                // Skip if we've already processed this workspace
                if (this.joinedWorkspaces.has(msg.workspace_id)) {
                  this.log(`Already joined workspace ${msg.workspace_id}, skipping`, 'info');
                  break;
                }
                this.joinedWorkspaces.add(msg.workspace_id);
                this.log(`Joined workspace ${msg.workspace_id}`, 'success');

                if (msg.ipfs_swarm_key && this.ipfsManager) {
                  this.log(`Setting up IPFS for workspace...`, 'info');
                  await this.ipfsManager.setSwarmKey(msg.ipfs_swarm_key);

                  // Connect to bootstrap peers
                  if (msg.bootstrap_peers && Array.isArray(msg.bootstrap_peers)) {
                    for (const peer of msg.bootstrap_peers) {
                      try {
                        await this.ipfsManager.connectPeer(peer);
                      } catch (err) {
                        // Ignore connection errors
                      }
                    }
                  }

                  // Start IPFS if not running
                  if (!this.ipfsManager.getIsRunning()) {
                    try {
                      await this.ipfsManager.start();
                      // Send IPFS ready message
                      const stats = await this.ipfsManager.getStats();
                      this.ws?.send(JSON.stringify({
                        type: 'ipfs_ready',
                        peer_id: stats.peerId,
                        addresses: stats.addresses,
                      }));
                    } catch (err) {
                      this.log(`Failed to start IPFS: ${err}`, 'error');
                    }
                  }
                }
              } catch (err) {
                this.log(`Error handling workspace_joined: ${err}`, 'error');
              }
              break;

            case 'error':
              this.log(`Error: ${msg.message}`, 'error');
              break;

            // IPFS Storage Operations (from orchestrator)
            case 'ipfs_store':
              // Store content in IPFS and return CID
              if (!this.ipfsManager?.getIsRunning()) {
                this.ws?.send(JSON.stringify({
                  type: 'ipfs_store_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'IPFS not running',
                }));
                break;
              }
              try {
                const content = typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content);
                const cid = await this.ipfsManager.addContent(content, msg.filename);
                await this.ipfsManager.pin(cid);
                this.log(`Stored content: ${cid}`, 'success');
                this.ws?.send(JSON.stringify({
                  type: 'ipfs_store_result',
                  request_id: msg.request_id,
                  success: true,
                  cid,
                }));
              } catch (err) {
                this.log(`IPFS store failed: ${err}`, 'error');
                this.ws?.send(JSON.stringify({
                  type: 'ipfs_store_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'ipfs_retrieve':
              // Retrieve content from IPFS by CID
              if (!this.ipfsManager?.getIsRunning()) {
                this.ws?.send(JSON.stringify({
                  type: 'ipfs_retrieve_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'IPFS not running',
                }));
                break;
              }
              try {
                const tempPath = path.join(app.getPath('temp'), `ipfs-get-${Date.now()}`);
                await this.ipfsManager.get(msg.cid, tempPath);
                const content = fs.readFileSync(tempPath, 'utf-8');
                fs.unlinkSync(tempPath); // Cleanup
                this.log(`Retrieved content: ${msg.cid}`, 'success');
                this.ws?.send(JSON.stringify({
                  type: 'ipfs_retrieve_result',
                  request_id: msg.request_id,
                  success: true,
                  cid: msg.cid,
                  content,
                }));
              } catch (err) {
                this.log(`IPFS retrieve failed: ${err}`, 'error');
                this.ws?.send(JSON.stringify({
                  type: 'ipfs_retrieve_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            // ============ Sandbox Operations ============

            case 'sandbox_write_file':
              // Write a file to workspace sandbox
              this.log(`Sandbox write request: ${msg.path}`, 'info');
              if (!this.sandboxManager) {
                this.log('Sandbox write failed: no storage path configured', 'error');
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_write_file_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'Sandbox not configured (no storage path)',
                }));
                break;
              }
              try {
                const result = await this.sandboxManager.writeFile(
                  msg.workspace_id,
                  msg.path,
                  msg.content
                );
                this.log(`Sandbox write result: ${result.success ? 'success' : result.error}`, result.success ? 'info' : 'error');
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_write_file_result',
                  request_id: msg.request_id,
                  ...result,
                }));
              } catch (err) {
                this.log(`Sandbox write error: ${err}`, 'error');
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_write_file_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'sandbox_read_file':
              // Read a file from workspace sandbox
              if (!this.sandboxManager) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_read_file_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'Sandbox not configured (no storage path)',
                }));
                break;
              }
              try {
                const result = await this.sandboxManager.readFile(
                  msg.workspace_id,
                  msg.path
                );
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_read_file_result',
                  request_id: msg.request_id,
                  ...result,
                }));
              } catch (err) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_read_file_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'sandbox_list_files':
              // List files in workspace sandbox
              if (!this.sandboxManager) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_list_files_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'Sandbox not configured (no storage path)',
                }));
                break;
              }
              try {
                const result = await this.sandboxManager.listFiles(
                  msg.workspace_id,
                  msg.path || '.'
                );
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_list_files_result',
                  request_id: msg.request_id,
                  ...result,
                }));
              } catch (err) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_list_files_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'sandbox_delete_file':
              // Delete a file from workspace sandbox
              if (!this.sandboxManager) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_delete_file_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'Sandbox not configured (no storage path)',
                }));
                break;
              }
              try {
                const result = await this.sandboxManager.deleteFile(
                  msg.workspace_id,
                  msg.path
                );
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_delete_file_result',
                  request_id: msg.request_id,
                  ...result,
                }));
              } catch (err) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_delete_file_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'sandbox_execute':
              // Execute a command in workspace sandbox
              if (!this.sandboxManager) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_execute_result',
                  request_id: msg.request_id,
                  success: false,
                  stdout: '',
                  stderr: '',
                  exitCode: -1,
                  error: 'Sandbox not configured (no storage path)',
                }));
                break;
              }
              try {
                const result = await this.sandboxManager.execute(
                  msg.workspace_id,
                  msg.command,
                  msg.timeout || 30000
                );
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_execute_result',
                  request_id: msg.request_id,
                  ...result,
                }));
              } catch (err) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_execute_result',
                  request_id: msg.request_id,
                  success: false,
                  stdout: '',
                  stderr: '',
                  exitCode: -1,
                  error: String(err),
                }));
              }
              break;

            case 'sandbox_sync_ipfs':
              // Sync workspace sandbox to IPFS
              if (!this.sandboxManager) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_sync_ipfs_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'Sandbox not configured (no storage path)',
                }));
                break;
              }
              try {
                const result = await this.sandboxManager.syncToIPFS(msg.workspace_id);
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_sync_ipfs_result',
                  request_id: msg.request_id,
                  ...result,
                }));
              } catch (err) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_sync_ipfs_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'sandbox_restore_ipfs':
              // Restore workspace sandbox from IPFS
              if (!this.sandboxManager) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_restore_ipfs_result',
                  request_id: msg.request_id,
                  success: false,
                  error: 'Sandbox not configured (no storage path)',
                }));
                break;
              }
              try {
                const result = await this.sandboxManager.syncFromIPFS(
                  msg.workspace_id,
                  msg.cid
                );
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_restore_ipfs_result',
                  request_id: msg.request_id,
                  ...result,
                }));
              } catch (err) {
                this.ws?.send(JSON.stringify({
                  type: 'sandbox_restore_ipfs_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'pull_model':
              // Pull an Ollama model
              try {
                this.log(`Pulling model: ${msg.model}`, 'info');
                await this.ollamaManager.pullModel(msg.model, (status, percent) => {
                  this.ws?.send(JSON.stringify({
                    type: 'pull_model_progress',
                    request_id: msg.request_id,
                    model: msg.model,
                    status,
                    percent,
                  }));
                });
                this.ws?.send(JSON.stringify({
                  type: 'pull_model_result',
                  request_id: msg.request_id,
                  success: true,
                  model: msg.model,
                }));
              } catch (err) {
                this.ws?.send(JSON.stringify({
                  type: 'pull_model_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;

            case 'llm_inference':
              // Execute LLM inference on node's local Ollama
              try {
                this.log(`LLM inference request: model=${msg.model}`, 'info');
                const result = await this.ollamaManager.chat({
                  model: msg.model,
                  messages: msg.messages,
                  max_tokens: msg.max_tokens,
                  temperature: msg.temperature,
                });
                this.log(`LLM inference complete: ${result.tokens_used || 'unknown'} tokens`, 'info');
                this.ws?.send(JSON.stringify({
                  type: 'llm_inference_result',
                  request_id: msg.request_id,
                  success: true,
                  response: result,
                }));
              } catch (err) {
                this.log(`LLM inference failed: ${err}`, 'error');
                this.ws?.send(JSON.stringify({
                  type: 'llm_inference_result',
                  request_id: msg.request_id,
                  success: false,
                  error: String(err),
                }));
              }
              break;
          }
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      });

      this.ws.on('error', (error: Error) => {
        this.log(`WebSocket error: ${error.message}`, 'error');
      });

      this.ws.on('close', () => {
        this.log('Disconnected from network', 'info');
        this.networkConnected = false;
        // Keep nodeId - it's a persistent local value
        this.emit('statusChange');

        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }

        // Attempt to reconnect if we have an orchestrator URL set
        if (this.running && this.orchestratorUrl) {
          this.log('Reconnecting in 5 seconds...', 'info');
          this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
        }
      });

    } catch (error) {
      this.log(`Connection failed: ${error}`, 'error');
      if (this.running) {
        this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
      }
    }
  }

  private async executeJob(job: Job): Promise<void> {
    this.currentJobs.set(job.id, job);
    this.log(`Executing job ${job.id} (${job.type})`, 'info');

    try {
      let result: any;

      switch (job.type) {
        case 'shell':
          result = await this.executeShellJob(job);
          break;

        case 'docker':
          result = await this.executeDockerJob(job);
          break;

        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      // Report success
      this.ws?.send(JSON.stringify({
        type: 'job_result',
        job_id: job.id,
        status: 'completed',
        result,
      }));

      this.log(`Job ${job.id} completed`, 'success');

    } catch (error) {
      // Report failure
      this.ws?.send(JSON.stringify({
        type: 'job_result',
        job_id: job.id,
        status: 'failed',
        error: String(error),
      }));

      this.log(`Job ${job.id} failed: ${error}`, 'error');

    } finally {
      this.currentJobs.delete(job.id);
    }
  }

  private async executeShellJob(job: Job): Promise<any> {
    const { command, timeout = 60000 } = job.payload;

    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return { stdout, stderr };
  }

  private async executeDockerJob(job: Job): Promise<any> {
    const { image, command, env = {} } = job.payload;

    // Build docker run command
    const envArgs = Object.entries(env)
      .map(([k, v]) => `-e ${k}="${v}"`)
      .join(' ');

    const dockerCmd = `docker run --rm ${envArgs} ${image} ${command}`;

    const { stdout, stderr } = await execAsync(dockerCmd, {
      timeout: 300000, // 5 min timeout for docker jobs
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    return { stdout, stderr };
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.log('Stopping node...', 'info');

    // Disconnect from network if connected
    if (this.networkConnected) {
      this.disconnectFromNetwork();
    }

    // Stop IPFS daemon
    if (this.ipfsManager?.getIsRunning()) {
      await this.ipfsManager.stop();
    }

    this.running = false;
    // Keep nodeId and shareKey - they are persistent local values
    this.log('Node stopped', 'info');
    this.emit('statusChange');
  }

  isRunning(): boolean {
    return this.running;
  }

  isConnected(): boolean {
    return this.networkConnected;
  }

  isNetworkConnected(): boolean {
    return this.networkConnected;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getShareKey(): string {
    return this.shareKey;
  }

  getResourceLimits(): ResourceLimits {
    return this.resourceLimits;
  }

  setResourceLimits(limits: ResourceLimits): void {
    this.resourceLimits = limits;
    this.saveConfig();
    this.log(`Resource limits updated: CPU=${limits.cpuCores || 'all'} cores, RAM=${limits.ramPercent || 100}%, Storage=${limits.storageGb || 'all'}GB`, 'success');
    this.emit('limitsChange', this.resourceLimits);
  }

  getHardware(): HardwareInfo | null {
    return this.hardware;
  }

  getWorkspaceIds(): string[] {
    return this.workspaceIds;
  }

  getRemoteControlEnabled(): boolean {
    return this.remoteControlEnabled;
  }

  setRemoteControlEnabled(enabled: boolean): void {
    this.remoteControlEnabled = enabled;
    this.saveConfig();
    this.log(`Remote control ${enabled ? 'enabled' : 'disabled'}`, 'success');
    this.emit('statusChange');
  }

  getStoragePath(): string | null {
    return this.storagePath;
  }

  setStoragePath(newPath: string | null): void {
    // Stop IPFS if running
    if (this.ipfsManager?.getIsRunning()) {
      this.ipfsManager.stop();
    }

    this.storagePath = newPath;
    this.saveConfig();

    // Reinitialize IPFS manager and Sandbox manager with new path
    if (newPath) {
      this.initIPFS(newPath);
      this.initSandbox(newPath);
    } else {
      this.ipfsManager = null;
      this.sandboxManager = null;
    }

    this.log(`Storage path set to: ${newPath || 'not selected'}`, 'success');
    this.emit('statusChange');
  }

  // IPFS Methods
  async startIPFS(): Promise<void> {
    if (!this.ipfsManager) {
      throw new Error('No storage path configured');
    }
    await this.ipfsManager.start();
  }

  async stopIPFS(): Promise<void> {
    if (this.ipfsManager) {
      await this.ipfsManager.stop();
    }
  }

  async setIPFSSwarmKey(key: string): Promise<void> {
    if (!this.ipfsManager) {
      throw new Error('No storage path configured');
    }
    await this.ipfsManager.setSwarmKey(key);
  }

  async connectIPFSPeer(multiaddr: string): Promise<void> {
    if (!this.ipfsManager?.getIsRunning()) {
      throw new Error('IPFS not running');
    }
    await this.ipfsManager.connectPeer(multiaddr);
  }

  async getIPFSStats(): Promise<IPFSStats | null> {
    if (!this.ipfsManager) {
      return null;
    }
    return this.ipfsManager.getStats();
  }

  isIPFSRunning(): boolean {
    return this.ipfsManager?.getIsRunning() ?? false;
  }

  hasIPFSBinary(): boolean {
    return this.ipfsManager?.hasBinary() ?? false;
  }

  async downloadIPFSBinary(onProgress?: (percent: number) => void): Promise<void> {
    // Create a temporary IPFS manager if none exists (for binary check/download)
    if (!this.ipfsManager) {
      // Use a temp path for now - will be reinitialized when user selects storage
      const tempPath = app.getPath('userData');
      this.ipfsManager = new IPFSManager(tempPath);
      this.ipfsManager.on('log', (entry) => {
        this.log(`[IPFS] ${entry.message}`, entry.type);
      });
    }
    await this.ipfsManager.downloadBinary(onProgress);
  }

  canCheckIPFSBinary(): boolean {
    // Can check binary status even without storage path
    if (!this.ipfsManager) {
      const tempPath = app.getPath('userData');
      const tempManager = new IPFSManager(tempPath);
      return tempManager.hasBinary();
    }
    return this.ipfsManager.hasBinary();
  }

  getIPFSPeerId(): string | null {
    return this.ipfsManager?.getPeerId() ?? null;
  }

  // IPFS File Operations (Phase 4)
  async ipfsAdd(filePath: string): Promise<string> {
    if (!this.ipfsManager?.getIsRunning()) {
      throw new Error('IPFS not running');
    }
    return await this.ipfsManager.add(filePath);
  }

  async ipfsAddContent(content: string, filename?: string): Promise<string> {
    if (!this.ipfsManager?.getIsRunning()) {
      throw new Error('IPFS not running');
    }
    return await this.ipfsManager.addContent(content, filename);
  }

  async ipfsGet(cid: string, outputPath: string): Promise<void> {
    if (!this.ipfsManager?.getIsRunning()) {
      throw new Error('IPFS not running');
    }
    await this.ipfsManager.get(cid, outputPath);
  }

  async ipfsPin(cid: string): Promise<void> {
    if (!this.ipfsManager?.getIsRunning()) {
      throw new Error('IPFS not running');
    }
    await this.ipfsManager.pin(cid);
  }

  async ipfsUnpin(cid: string): Promise<void> {
    if (!this.ipfsManager?.getIsRunning()) {
      throw new Error('IPFS not running');
    }
    await this.ipfsManager.unpin(cid);
  }

  async setIPFSStorageLimit(limitGb: number): Promise<void> {
    if (!this.ipfsManager) {
      throw new Error('IPFS not initialized');
    }
    await this.ipfsManager.setStorageLimit(limitGb);
  }

  async getIPFSStorageLimit(): Promise<number | null> {
    if (!this.ipfsManager) {
      return null;
    }
    return await this.ipfsManager.getStorageLimit();
  }

  // Ollama Methods
  async getOllamaStatus(): Promise<OllamaStatus> {
    return await this.ollamaManager.getStatus();
  }

  isOllamaInstalled(): boolean {
    return this.ollamaManager.isInstalled();
  }

  async installOllama(onProgress?: (percent: number) => void): Promise<void> {
    await this.ollamaManager.install(onProgress);
  }

  async startOllama(): Promise<void> {
    await this.ollamaManager.start();
    this.emit('ollamaStatusChange', await this.ollamaManager.getStatus());
  }

  async stopOllama(): Promise<void> {
    await this.ollamaManager.stop();
    this.emit('ollamaStatusChange', await this.ollamaManager.getStatus());
  }

  async pullOllamaModel(modelName: string, onProgress?: (status: string, percent?: number) => void): Promise<void> {
    await this.ollamaManager.pullModel(modelName, onProgress);
    this.emit('ollamaStatusChange', await this.ollamaManager.getStatus());
  }

  async deleteOllamaModel(modelName: string): Promise<void> {
    await this.ollamaManager.deleteModel(modelName);
    this.emit('ollamaStatusChange', await this.ollamaManager.getStatus());
  }

  async getOllamaModels(): Promise<OllamaModel[]> {
    return await this.ollamaManager.getModels();
  }

  setOllamaPath(ollamaPath: string): boolean {
    return this.ollamaManager.setOllamaPath(ollamaPath);
  }

  getOllamaPath(): string | null {
    return this.ollamaManager.getOllamaPath();
  }

  // Sandbox Methods (for local UI access)
  hasSandbox(): boolean {
    return this.sandboxManager !== null;
  }

  async sandboxWriteFile(
    workspaceId: string,
    relativePath: string,
    content: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.sandboxManager) {
      return { success: false, error: 'Sandbox not configured (no storage path)' };
    }
    return this.sandboxManager.writeFile(workspaceId, relativePath, content);
  }

  async sandboxReadFile(
    workspaceId: string,
    relativePath: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!this.sandboxManager) {
      return { success: false, error: 'Sandbox not configured (no storage path)' };
    }
    return this.sandboxManager.readFile(workspaceId, relativePath);
  }

  async sandboxListFiles(
    workspaceId: string,
    relativePath?: string
  ): Promise<{ success: boolean; files?: FileInfo[]; error?: string }> {
    if (!this.sandboxManager) {
      return { success: false, error: 'Sandbox not configured (no storage path)' };
    }
    return this.sandboxManager.listFiles(workspaceId, relativePath);
  }

  async sandboxDeleteFile(
    workspaceId: string,
    relativePath: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.sandboxManager) {
      return { success: false, error: 'Sandbox not configured (no storage path)' };
    }
    return this.sandboxManager.deleteFile(workspaceId, relativePath);
  }

  async sandboxExecute(
    workspaceId: string,
    command: string,
    timeout?: number
  ): Promise<ExecutionResult> {
    if (!this.sandboxManager) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: 'Sandbox not configured (no storage path)' };
    }
    return this.sandboxManager.execute(workspaceId, command, timeout);
  }

  async sandboxSyncToIPFS(
    workspaceId: string
  ): Promise<{ success: boolean; cid?: string; error?: string }> {
    if (!this.sandboxManager) {
      return { success: false, error: 'Sandbox not configured (no storage path)' };
    }
    return this.sandboxManager.syncToIPFS(workspaceId);
  }

  async sandboxSyncFromIPFS(
    workspaceId: string,
    cid: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.sandboxManager) {
      return { success: false, error: 'Sandbox not configured (no storage path)' };
    }
    return this.sandboxManager.syncFromIPFS(workspaceId, cid);
  }

  async sandboxGetSize(workspaceId: string): Promise<number> {
    if (!this.sandboxManager) {
      return 0;
    }
    return this.sandboxManager.getSandboxSize(workspaceId);
  }

  // Manager getters for API server
  getOllamaManager(): OllamaManager | null {
    return this.ollamaManager;
  }

  getSandboxManager(): SandboxManager | null {
    return this.sandboxManager;
  }

  getIPFSManager(): IPFSManager | null {
    return this.ipfsManager;
  }

  // ============ On-Chain Node Methods ============

  /**
   * Link this node to an on-chain registered node.
   * The wallet must have already registered the node on-chain via the desktop UI.
   */
  async linkOnChainNode(onChainNodeId: string, walletAddress: string, privateKey: string): Promise<boolean> {
    try {
      // Initialize web3 service with private key for signing
      await this.web3Service.initWithPrivateKey(
        privateKey,
        'https://ethereum-sepolia-rpc.publicnode.com',
        'sepolia'
      );

      // Verify ownership
      const isOwner = await this.web3Service.verifyNodeOwnership(onChainNodeId, walletAddress);
      if (!isOwner) {
        this.log(`Wallet ${walletAddress} does not own on-chain node ${onChainNodeId}`, 'error');
        return false;
      }

      // Verify node is eligible
      const isEligible = await this.web3Service.isNodeEligible(onChainNodeId);
      if (!isEligible) {
        this.log(`On-chain node ${onChainNodeId} is not eligible (inactive or slashed)`, 'error');
        return false;
      }

      // Save the on-chain credentials
      this.onChainNodeId = onChainNodeId;
      this.walletAddress = walletAddress;
      this.saveConfig();

      this.log(`Linked to on-chain node ${onChainNodeId.slice(0, 10)}...`, 'success');
      this.emit('statusChange');
      return true;
    } catch (err) {
      this.log(`Failed to link on-chain node: ${err}`, 'error');
      return false;
    }
  }

  /**
   * Unlink from on-chain node
   */
  unlinkOnChainNode(): void {
    this.onChainNodeId = null;
    this.walletAddress = null;
    this.web3Service.disconnect();
    this.saveConfig();
    this.log('Unlinked from on-chain node', 'info');
    this.emit('statusChange');
  }

  /**
   * Get on-chain node info
   */
  async getOnChainNodeInfo(): Promise<any | null> {
    if (!this.onChainNodeId) return null;
    try {
      return await this.web3Service.getNode(this.onChainNodeId);
    } catch {
      return null;
    }
  }

  /**
   * Check if node is linked to on-chain
   */
  isOnChainLinked(): boolean {
    return this.onChainNodeId !== null && this.walletAddress !== null;
  }

  /**
   * Get on-chain node ID
   */
  getOnChainNodeId(): string | null {
    return this.onChainNodeId;
  }

  /**
   * Get linked wallet address
   */
  getWalletAddress(): string | null {
    return this.walletAddress;
  }

  /**
   * Get Web3 service for advanced operations
   */
  getWeb3Service(): Web3Service {
    return this.web3Service;
  }

  /**
   * Track compute time for a job (for on-chain reporting)
   */
  trackJobComputeTime(jobId: string, seconds: number): void {
    const current = this.jobComputeTime.get(jobId) || 0;
    this.jobComputeTime.set(jobId, current + seconds);
  }

  /**
   * Get total compute time tracked
   */
  getTotalComputeTime(): number {
    let total = 0;
    for (const seconds of this.jobComputeTime.values()) {
      total += seconds;
    }
    return total;
  }

  /**
   * Clear compute time tracking (after reporting to chain)
   */
  clearComputeTime(): void {
    this.jobComputeTime.clear();
  }
}
