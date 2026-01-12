import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { HardwareDetector, HardwareInfo } from './hardware';
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
  private configPath: string;

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

            case 'error':
              this.log(`Error: ${msg.message}`, 'error');
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
}
