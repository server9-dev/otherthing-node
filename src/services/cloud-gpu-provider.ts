/**
 * Cloud GPU Provider
 *
 * Enables renting cloud GPUs and tunneling them to local workspaces
 * for seamless Ollama integration. Abstracts underlying GPU marketplace.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// ============ Types ============

export interface CloudGPUConfig {
  apiKey: string;
  defaultImage?: string;
  defaultDiskGb?: number;
  autoTerminateMinutes?: number;
}

export interface GPUOffer {
  id: number;
  machineId: number;
  gpuName: string;
  gpuCount: number;
  gpuMemoryMb: number;
  cpuCores: number;
  ramMb: number;
  diskGb: number;
  dlperfScore: number;           // Deep learning performance score
  pricePerHour: number;          // USD
  location: string;
  internetSpeed: number;         // Mbps
  reliability: number;           // 0-1
  verified: boolean;
  cudaVersion: string;
  driverVersion: string;
}

export interface GPUInstance {
  id: number;
  offerId: number;
  status: GPUInstanceStatus;
  gpuName: string;
  gpuCount: number;
  image: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  jupyterUrl?: string;
  pricePerHour: number;
  totalCost: number;
  startedAt: Date;
  diskGb: number;
  publicIp?: string;
  ports: Record<number, number>;  // container port -> host port
}

export type GPUInstanceStatus =
  | 'creating'
  | 'running'
  | 'loading'      // Image loading
  | 'exited'
  | 'error'
  | 'destroying';

export interface GPUSearchFilters {
  gpuName?: string;              // e.g., "RTX 4090", "A6000", "A100"
  minGpuMemoryGb?: number;
  maxPricePerHour?: number;
  minReliability?: number;       // 0-1
  minDlperf?: number;            // Deep learning perf score
  verifiedOnly?: boolean;
  minInternetSpeed?: number;     // Mbps
  region?: 'us' | 'eu' | 'asia' | 'any';
  sortBy?: 'price' | 'performance' | 'reliability' | 'dlperf';
}

export interface GPURentOptions {
  image?: string;                // Docker image, default: "ollama/ollama"
  diskGb?: number;               // Disk space, default: 20
  jupyterEnabled?: boolean;
  env?: Record<string, string>;  // Environment variables
  onStart?: string;              // Startup script
  label?: string;                // Instance label
  autoTerminateHours?: number;
}

export interface TunnelInfo {
  instanceId: number;
  localPort: number;
  remotePort: number;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  process?: ChildProcess;
  error?: string;
}

export interface GPUBilling {
  balance: number;
  currentInstances: number;
  runningCostPerHour: number;
  totalSpentToday: number;
  totalSpentMonth: number;
}

// ============ Events ============

export interface CloudGPUProviderEvents {
  'offer:found': (offers: GPUOffer[]) => void;
  'instance:created': (instance: GPUInstance) => void;
  'instance:status': (instance: GPUInstance) => void;
  'instance:terminated': (instanceId: number) => void;
  'tunnel:status': (tunnel: TunnelInfo) => void;
  'error': (error: Error) => void;
}

// ============ Provider ============

const GPU_API_BASE = 'https://console.vast.ai/api/v0';  // Backend abstracted
const DEFAULT_OLLAMA_IMAGE = 'ollama/ollama';
const DEFAULT_DISK_GB = 20;
const OLLAMA_PORT = 11434;

export class CloudGPUProvider extends EventEmitter {
  private apiKey: string | null = null;
  private instances: Map<number, GPUInstance> = new Map();
  private tunnels: Map<number, TunnelInfo> = new Map();
  private pollIntervals: Map<number, NodeJS.Timeout> = new Map();
  private config: CloudGPUConfig | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize with API key
   */
  initialize(config: CloudGPUConfig): void {
    this.apiKey = config.apiKey;
    this.config = config;
    console.log('[CloudGPU] Initialized');
  }

  /**
   * Check if provider is configured
   */
  isConfigured(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * Make authenticated API request
   */
  private async apiRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Cloud GPU API key not configured');
    }

    const url = `${GPU_API_BASE}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vast API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // ============ Search & Discovery ============

  /**
   * Search for available GPU offers
   */
  async searchOffers(filters: GPUSearchFilters = {}): Promise<GPUOffer[]> {
    // Build query string for Vast.ai search
    const query = this.buildSearchQuery(filters);

    const response = await this.apiRequest<{ offers: RawVastOffer[] }>(
      `/bundles/?q=${encodeURIComponent(query)}`
    );

    const offers = response.offers.map(this.mapRawOffer);

    // Sort results
    if (filters.sortBy) {
      offers.sort((a, b) => {
        switch (filters.sortBy) {
          case 'price': return a.pricePerHour - b.pricePerHour;
          case 'performance': return b.dlperfScore - a.dlperfScore;
          case 'reliability': return b.reliability - a.reliability;
          case 'dlperf': return b.dlperfScore - a.dlperfScore;
          default: return 0;
        }
      });
    }

    this.emit('offer:found', offers);
    return offers;
  }

  /**
   * Get recommended offers for Ollama/LLM workloads
   */
  async getRecommendedForLLM(budget?: number): Promise<GPUOffer[]> {
    return this.searchOffers({
      minGpuMemoryGb: 24,         // Need VRAM for LLMs
      minReliability: 0.95,
      verifiedOnly: true,
      maxPricePerHour: budget ?? 2.0,
      sortBy: 'dlperf',
    });
  }

  /**
   * Build search query as JSON dict for Vast API
   */
  private buildSearchQuery(filters: GPUSearchFilters): string {
    const query: Record<string, unknown> = {
      rentable: { eq: true },
      rented: { eq: false },
      type: 'on-demand',
    };

    if (filters.gpuName) {
      query.gpu_name = { eq: filters.gpuName };
    }
    if (filters.minGpuMemoryGb) {
      query.gpu_ram = { gte: filters.minGpuMemoryGb * 1024 };
    }
    if (filters.maxPricePerHour) {
      query.dph_total = { lte: filters.maxPricePerHour };
    }
    if (filters.minReliability) {
      query.reliability = { gte: filters.minReliability };
    }
    if (filters.minDlperf) {
      query.dlperf = { gte: filters.minDlperf };
    }
    if (filters.verifiedOnly) {
      query.verified = { eq: true };
    }
    if (filters.minInternetSpeed) {
      query.inet_down = { gte: filters.minInternetSpeed };
    }
    if (filters.region && filters.region !== 'any') {
      const regionMap = { us: 'US', eu: 'EU', asia: 'AS' };
      query.geolocation = { eq: regionMap[filters.region] };
    }

    // Add sorting
    if (filters.sortBy) {
      const sortMap: Record<string, string> = {
        price: 'dph_total',
        performance: 'dlperf',
        reliability: 'reliability',
        dlperf: 'dlperf',
      };
      query.order = [[sortMap[filters.sortBy], filters.sortBy === 'price' ? 'asc' : 'desc']];
    } else {
      query.order = [['dph_total', 'asc']]; // Default: cheapest first
    }

    return JSON.stringify(query);
  }

  // ============ Instance Management ============

  /**
   * Rent a GPU instance
   */
  async rentInstance(offerId: number, options: GPURentOptions = {}): Promise<GPUInstance> {
    const image = options.image ?? this.config?.defaultImage ?? DEFAULT_OLLAMA_IMAGE;
    const diskGb = options.diskGb ?? this.config?.defaultDiskGb ?? DEFAULT_DISK_GB;

    // Build onstart script to setup Ollama
    const onStartScript = options.onStart ?? this.buildOllamaStartScript();

    const payload = {
      client_id: 'me',
      image: image,
      disk: diskGb,
      label: options.label ?? 'otherthing-workspace',
      onstart: onStartScript,
      runtype: 'ssh_direc ssh_proxy',  // Enable SSH access
      env: {
        OLLAMA_HOST: '0.0.0.0',
        ...options.env,
      },
    };

    // Create the instance by accepting the offer
    const response = await this.apiRequest<{ new_contract: number }>(
      `/asks/${offerId}/`,
      'PUT',
      payload
    );

    const instanceId = response.new_contract;
    console.log(`[CloudGPU] Created instance ${instanceId} from offer ${offerId}`);

    // Poll for instance details
    const instance = await this.waitForInstance(instanceId);
    this.instances.set(instanceId, instance);
    this.emit('instance:created', instance);

    // Start polling for status updates
    this.startStatusPolling(instanceId);

    return instance;
  }

  /**
   * Build startup script for Ollama
   */
  private buildOllamaStartScript(): string {
    return `#!/bin/bash
# Start Ollama server
ollama serve &

# Wait for Ollama to be ready
sleep 5

# Pull a default model (can be changed)
ollama pull qwen2.5-coder:7b &

echo "Ollama ready on port 11434"
`;
  }

  /**
   * Wait for instance to be ready
   */
  private async waitForInstance(instanceId: number, timeoutMs = 120000): Promise<GPUInstance> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const instances = await this.apiRequest<{ instances: RawVastInstance[] }>('/instances/');
      const raw = instances.instances.find(i => i.id === instanceId);

      if (raw) {
        const instance = this.mapRawInstance(raw);

        if (instance.status === 'running') {
          return instance;
        }
        if (instance.status === 'error') {
          throw new Error(`Instance ${instanceId} failed to start`);
        }

        this.emit('instance:status', instance);
      }

      await this.sleep(3000);
    }

    throw new Error(`Timeout waiting for instance ${instanceId}`);
  }

  /**
   * Get all active instances
   */
  async getInstances(): Promise<GPUInstance[]> {
    const response = await this.apiRequest<{ instances: RawVastInstance[] }>('/instances/');
    const instances = response.instances.map(this.mapRawInstance);

    // Update local cache
    instances.forEach(i => this.instances.set(i.id, i));

    return instances;
  }

  /**
   * Get a specific instance
   */
  async getInstance(instanceId: number): Promise<GPUInstance | null> {
    const instances = await this.getInstances();
    return instances.find(i => i.id === instanceId) ?? null;
  }

  /**
   * Terminate an instance
   */
  async terminateInstance(instanceId: number): Promise<void> {
    // Stop tunnel first
    this.disconnectTunnel(instanceId);

    // Stop polling
    this.stopStatusPolling(instanceId);

    await this.apiRequest(`/instances/${instanceId}/`, 'DELETE');

    this.instances.delete(instanceId);
    this.emit('instance:terminated', instanceId);

    console.log(`[CloudGPU] Terminated instance ${instanceId}`);
  }

  /**
   * Start polling instance status
   */
  private startStatusPolling(instanceId: number): void {
    const interval = setInterval(async () => {
      try {
        const instance = await this.getInstance(instanceId);
        if (instance) {
          this.emit('instance:status', instance);

          // Auto-cleanup if instance died
          if (instance.status === 'exited' || instance.status === 'error') {
            this.stopStatusPolling(instanceId);
          }
        }
      } catch (err) {
        console.error(`[CloudGPU] Error polling instance ${instanceId}:`, err);
      }
    }, 30000); // Every 30 seconds

    this.pollIntervals.set(instanceId, interval);
  }

  /**
   * Stop polling instance status
   */
  private stopStatusPolling(instanceId: number): void {
    const interval = this.pollIntervals.get(instanceId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(instanceId);
    }
  }

  // ============ SSH Tunnel Management ============

  /**
   * Create SSH tunnel to instance's Ollama port
   * Makes remote Ollama available at localhost:{localPort}
   */
  async createTunnel(
    instanceId: number,
    localPort: number = 11434,
    remotePort: number = OLLAMA_PORT
  ): Promise<TunnelInfo> {
    const instance = this.instances.get(instanceId) ?? await this.getInstance(instanceId);

    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }
    if (instance.status !== 'running') {
      throw new Error(`Instance ${instanceId} is not running (status: ${instance.status})`);
    }

    // Kill existing tunnel if any
    this.disconnectTunnel(instanceId);

    const tunnelInfo: TunnelInfo = {
      instanceId,
      localPort,
      remotePort,
      status: 'connecting',
    };

    this.tunnels.set(instanceId, tunnelInfo);
    this.emit('tunnel:status', tunnelInfo);

    try {
      // Build SSH command
      // -N: Don't execute remote command
      // -L: Local port forwarding
      // -o StrictHostKeyChecking=no: Auto-accept host key (for dynamic cloud IPs)
      const sshArgs = [
        '-N',
        '-L', `${localPort}:localhost:${remotePort}`,
        '-p', instance.sshPort.toString(),
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        `${instance.sshUser}@${instance.sshHost}`,
      ];

      const sshProcess = spawn('ssh', sshArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      tunnelInfo.process = sshProcess;

      sshProcess.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        console.log(`[CloudGPU] SSH tunnel stderr: ${msg}`);

        if (msg.includes('Permission denied')) {
          tunnelInfo.status = 'error';
          tunnelInfo.error = 'SSH authentication failed';
          this.emit('tunnel:status', tunnelInfo);
        }
      });

      sshProcess.on('error', (err) => {
        console.error(`[CloudGPU] SSH tunnel error:`, err);
        tunnelInfo.status = 'error';
        tunnelInfo.error = err.message;
        this.emit('tunnel:status', tunnelInfo);
      });

      sshProcess.on('close', (code) => {
        console.log(`[CloudGPU] SSH tunnel closed with code ${code}`);
        tunnelInfo.status = 'disconnected';
        tunnelInfo.process = undefined;
        this.emit('tunnel:status', tunnelInfo);
      });

      // Wait a moment for connection to establish
      await this.sleep(2000);

      // Verify tunnel is working by checking if Ollama responds
      const isConnected = await this.verifyTunnel(localPort);

      if (isConnected) {
        tunnelInfo.status = 'connected';
        console.log(`[CloudGPU] Tunnel connected: localhost:${localPort} -> ${instance.sshHost}:${remotePort}`);
      } else {
        tunnelInfo.status = 'connecting';
        console.log(`[CloudGPU] Tunnel established, waiting for Ollama...`);
      }

      this.emit('tunnel:status', tunnelInfo);
      return tunnelInfo;

    } catch (err) {
      tunnelInfo.status = 'error';
      tunnelInfo.error = err instanceof Error ? err.message : 'Unknown error';
      this.emit('tunnel:status', tunnelInfo);
      throw err;
    }
  }

  /**
   * Verify tunnel is working by pinging Ollama
   */
  private async verifyTunnel(localPort: number): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${localPort}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect SSH tunnel
   */
  disconnectTunnel(instanceId: number): void {
    const tunnel = this.tunnels.get(instanceId);
    if (tunnel?.process) {
      tunnel.process.kill('SIGTERM');
      tunnel.status = 'disconnected';
      tunnel.process = undefined;
      this.emit('tunnel:status', tunnel);
    }
    this.tunnels.delete(instanceId);
  }

  /**
   * Get tunnel status
   */
  getTunnel(instanceId: number): TunnelInfo | undefined {
    return this.tunnels.get(instanceId);
  }

  /**
   * Get all active tunnels
   */
  getAllTunnels(): TunnelInfo[] {
    return Array.from(this.tunnels.values());
  }

  // ============ Billing ============

  /**
   * Get billing information
   */
  async getBilling(): Promise<GPUBilling> {
    const [userInfo, instances] = await Promise.all([
      this.apiRequest<{ credit: number }>('/users/current/'),
      this.getInstances(),
    ]);

    const runningInstances = instances.filter(i => i.status === 'running');
    const runningCostPerHour = runningInstances.reduce((sum, i) => sum + i.pricePerHour, 0);
    const totalCost = instances.reduce((sum, i) => sum + i.totalCost, 0);

    return {
      balance: userInfo.credit,
      currentInstances: runningInstances.length,
      runningCostPerHour,
      totalSpentToday: totalCost,  // Approximate - would need invoice API for accurate
      totalSpentMonth: totalCost,
    };
  }

  // ============ Utility Methods ============

  /**
   * Pull a model on the remote instance
   */
  async pullModel(instanceId: number, modelName: string): Promise<void> {
    const tunnel = this.tunnels.get(instanceId);
    if (!tunnel || tunnel.status !== 'connected') {
      throw new Error('Tunnel not connected');
    }

    const response = await fetch(`http://localhost:${tunnel.localPort}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${await response.text()}`);
    }

    console.log(`[CloudGPU] Pulling model ${modelName} on instance ${instanceId}`);
  }

  /**
   * List models available on remote instance
   */
  async listRemoteModels(instanceId: number): Promise<string[]> {
    const tunnel = this.tunnels.get(instanceId);
    if (!tunnel || tunnel.status !== 'connected') {
      throw new Error('Tunnel not connected');
    }

    const response = await fetch(`http://localhost:${tunnel.localPort}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${await response.text()}`);
    }

    const data = await response.json() as { models: { name: string }[] };
    return data.models.map(m => m.name);
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    // Disconnect all tunnels
    for (const instanceId of this.tunnels.keys()) {
      this.disconnectTunnel(instanceId);
    }

    // Stop all polling
    for (const instanceId of this.pollIntervals.keys()) {
      this.stopStatusPolling(instanceId);
    }

    console.log('[CloudGPU] Cleanup complete');
  }

  // ============ Mapping Helpers ============

  private mapRawOffer = (raw: RawVastOffer): GPUOffer => ({
    id: raw.id,
    machineId: raw.machine_id,
    gpuName: raw.gpu_name,
    gpuCount: raw.num_gpus,
    gpuMemoryMb: raw.gpu_ram,
    cpuCores: raw.cpu_cores_effective,
    ramMb: raw.cpu_ram,
    diskGb: raw.disk_space,
    dlperfScore: raw.dlperf ?? 0,
    pricePerHour: raw.dph_total,
    location: raw.geolocation ?? 'Unknown',
    internetSpeed: raw.inet_down ?? 0,
    reliability: raw.reliability ?? 0,
    verified: raw.verified ?? false,
    cudaVersion: raw.cuda_max_good ?? 'Unknown',
    driverVersion: raw.driver_version ?? 'Unknown',
  });

  private mapRawInstance = (raw: RawVastInstance): GPUInstance => ({
    id: raw.id,
    offerId: raw.machine_id,
    status: this.mapInstanceStatus(raw.actual_status),
    gpuName: raw.gpu_name,
    gpuCount: raw.num_gpus,
    image: raw.image_uuid,
    sshHost: raw.ssh_host,
    sshPort: raw.ssh_port,
    sshUser: 'root',
    jupyterUrl: raw.jupyter_url,
    pricePerHour: raw.dph_total,
    totalCost: raw.total_cost ?? 0,
    startedAt: new Date(raw.start_date * 1000),
    diskGb: raw.disk_space,
    publicIp: raw.public_ipaddr,
    ports: raw.ports ?? {},
  });

  private mapInstanceStatus(status: string): GPUInstanceStatus {
    const statusMap: Record<string, GPUInstanceStatus> = {
      'running': 'running',
      'loading': 'loading',
      'created': 'creating',
      'creating': 'creating',
      'exited': 'exited',
      'offline': 'exited',
      'error': 'error',
      'destroying': 'destroying',
    };
    return statusMap[status] ?? 'error';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Raw API Types ============

interface RawVastOffer {
  id: number;
  machine_id: number;
  gpu_name: string;
  num_gpus: number;
  gpu_ram: number;
  cpu_cores_effective: number;
  cpu_ram: number;
  disk_space: number;
  dlperf?: number;
  dph_total: number;
  geolocation?: string;
  inet_down?: number;
  reliability?: number;
  verified?: boolean;
  cuda_max_good?: string;
  driver_version?: string;
}

interface RawVastInstance {
  id: number;
  machine_id: number;
  actual_status: string;
  gpu_name: string;
  num_gpus: number;
  image_uuid: string;
  ssh_host: string;
  ssh_port: number;
  jupyter_url?: string;
  dph_total: number;
  total_cost?: number;
  start_date: number;
  disk_space: number;
  public_ipaddr?: string;
  ports?: Record<number, number>;
}

// ============ Singleton Export ============

export const cloudGPUProvider = new CloudGPUProvider();
