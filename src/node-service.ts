import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { HardwareDetector, HardwareInfo } from './hardware';
import { IPFSManager, IPFSStats } from './ipfs-manager';
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
  private running = false;
  private connected = false;
  private nodeId: string;
  private shareKey: string; // Share key for adding this node to workspaces (locally generated)
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private orchestratorUrl: string;
  private workspaceIds: string[] = [];
  private hardware: HardwareInfo | null = null;
  private currentJobs: Map<string, Job> = new Map();
  private resourceLimits: ResourceLimits = {};
  private remoteControlEnabled = false;
  private storagePath: string | null = null;
  private configPath: string;
  private ipfsManager: IPFSManager | null = null;
  private ipfsEnabled = false;

  constructor(defaultOrchestratorUrl: string) {
    super();
    this.orchestratorUrl = defaultOrchestratorUrl;

    // Load or create config with persistent share key
    this.configPath = path.join(app.getPath('userData'), 'node-config.json');
    const config = this.loadOrCreateConfig();
    this.shareKey = config.shareKey;
    this.nodeId = config.nodeId;
    this.resourceLimits = config.resourceLimits;
    this.remoteControlEnabled = config.remoteControlEnabled;
    this.storagePath = config.storagePath;

    // Initialize IPFS manager if storage path is set
    if (this.storagePath) {
      this.initIPFS(this.storagePath);
    }
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

  async start(orchestratorUrl: string, workspaceIds: string[]): Promise<void> {
    if (this.running) {
      this.log('Node is already running', 'error');
      return;
    }

    this.orchestratorUrl = orchestratorUrl;
    this.workspaceIds = workspaceIds;

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
    this.emit('statusChange');

    await this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.running) return;

    this.log(`Connecting to ${this.orchestratorUrl}...`, 'info');

    try {
      this.ws = new WebSocket(this.orchestratorUrl);

      this.ws.on('open', () => {
        this.log('WebSocket connected', 'success');
        this.connected = true;
        this.emit('statusChange');

        // Send registration with persistent nodeId and shareKey
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
          },
          workspace_ids: this.workspaceIds,
          resource_limits: this.resourceLimits,
          remote_control_enabled: this.remoteControlEnabled,
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
              if (msg.ipfs_swarm_key && this.ipfsManager) {
                this.log(`Received IPFS swarm key for workspace ${msg.workspace_id}`, 'info');
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
          }
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      });

      this.ws.on('error', (error: Error) => {
        this.log(`WebSocket error: ${error.message}`, 'error');
      });

      this.ws.on('close', () => {
        this.log('Disconnected from orchestrator', 'info');
        this.connected = false;
        // Keep nodeId - it's a persistent local value
        this.emit('statusChange');

        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }

        // Attempt to reconnect if still running
        if (this.running) {
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
    this.running = false;

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

    // Stop IPFS daemon
    if (this.ipfsManager?.getIsRunning()) {
      await this.ipfsManager.stop();
    }

    this.connected = false;
    // Keep nodeId and shareKey - they are persistent local values
    this.log('Node stopped', 'info');
    this.emit('statusChange');
  }

  isRunning(): boolean {
    return this.running;
  }

  isConnected(): boolean {
    return this.connected;
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

    // Reinitialize IPFS manager with new path
    if (newPath) {
      this.initIPFS(newPath);
    } else {
      this.ipfsManager = null;
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
}
