/**
 * Container Service
 *
 * Manages container operations via the Rust backend.
 * This is Phase 1 of ZLayer integration - providing Docker/Podman support
 * as a foundation for future native container orchestration.
 */

// Container status
export type ContainerStatus = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead' | 'unknown';

// Port mapping
export interface PortMapping {
  container_port: number;
  host_port: number | null;
  protocol: string;
}

// Container information
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  created: number;
  ports: PortMapping[];
  labels: Record<string, string>;
}

// Image information
export interface ImageInfo {
  id: string;
  repo_tags: string[];
  size: number;
  created: number;
}

// Container creation request
export interface CreateContainerRequest {
  name: string;
  image: string;
  cmd?: string[];
  env?: string[];
  ports?: PortMapping[];
  volumes?: string[];
  labels?: Record<string, string>;
  memory_limit?: number;
  cpu_shares?: number;
  gpu?: boolean;
}

// Exec result
export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

// Runtime info
export interface RuntimeInfo {
  available: boolean;
  runtime_type: string;
  version: string;
  api_version: string;
  os: string;
  arch: string;
}

// API base URL (same as other services)
const API_BASE = 'http://localhost:8080/api/v1';

// Event callback type
type ContainerEventCallback = (event: ContainerEvent) => void;

// Container event
export interface ContainerEvent {
  type: 'status_change' | 'created' | 'started' | 'stopped' | 'removed' | 'error';
  containerId?: string;
  containerName?: string;
  status?: ContainerStatus;
  error?: string;
}

export class ContainerService {
  private eventListeners: Set<ContainerEventCallback> = new Set();
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastContainerStates: Map<string, ContainerStatus> = new Map();

  /**
   * Get container runtime info
   */
  async getRuntimeInfo(): Promise<RuntimeInfo | null> {
    try {
      const response = await fetch(`${API_BASE}/containers/runtime`);
      if (!response.ok) return null;
      return response.json();
    } catch (err) {
      console.error('[ContainerService] Failed to get runtime info:', err);
      return null;
    }
  }

  /**
   * Detect container runtime
   */
  async detectRuntime(): Promise<RuntimeInfo | null> {
    try {
      const response = await fetch(`${API_BASE}/containers/runtime/detect`, { method: 'POST' });
      if (!response.ok) return null;
      return response.json();
    } catch (err) {
      console.error('[ContainerService] Failed to detect runtime:', err);
      return null;
    }
  }

  /**
   * Check if runtime is available
   */
  async isAvailable(): Promise<boolean> {
    const info = await this.getRuntimeInfo();
    return info?.available ?? false;
  }

  /**
   * List containers
   */
  async listContainers(all: boolean = false): Promise<ContainerInfo[]> {
    try {
      const response = await fetch(`${API_BASE}/containers?all=${all}`);
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      return data.containers || [];
    } catch (err) {
      console.error('[ContainerService] Failed to list containers:', err);
      return [];
    }
  }

  /**
   * List images
   */
  async listImages(): Promise<ImageInfo[]> {
    try {
      const response = await fetch(`${API_BASE}/containers/images`);
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      return data.images || [];
    } catch (err) {
      console.error('[ContainerService] Failed to list images:', err);
      return [];
    }
  }

  /**
   * Pull an image
   */
  async pullImage(image: string, onProgress?: (progress: string) => void): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/containers/images/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      if (!response.ok) throw new Error(await response.text());
      return true;
    } catch (err) {
      console.error('[ContainerService] Failed to pull image:', err);
      return false;
    }
  }

  /**
   * Create a container
   */
  async createContainer(request: CreateContainerRequest): Promise<string | null> {
    try {
      const response = await fetch(`${API_BASE}/containers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      this.emitEvent({ type: 'created', containerId: data.id, containerName: request.name });
      return data.id;
    } catch (err) {
      console.error('[ContainerService] Failed to create container:', err);
      this.emitEvent({ type: 'error', error: String(err) });
      return null;
    }
  }

  /**
   * Start a container
   */
  async startContainer(containerId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/containers/${containerId}/start`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error(await response.text());
      this.emitEvent({ type: 'started', containerId, status: 'running' });
      return true;
    } catch (err) {
      console.error('[ContainerService] Failed to start container:', err);
      this.emitEvent({ type: 'error', containerId, error: String(err) });
      return false;
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(containerId: string, timeout?: number): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/containers/${containerId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout }),
      });
      if (!response.ok) throw new Error(await response.text());
      this.emitEvent({ type: 'stopped', containerId, status: 'exited' });
      return true;
    } catch (err) {
      console.error('[ContainerService] Failed to stop container:', err);
      this.emitEvent({ type: 'error', containerId, error: String(err) });
      return false;
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId: string, force: boolean = false): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/containers/${containerId}?force=${force}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await response.text());
      this.emitEvent({ type: 'removed', containerId });
      return true;
    } catch (err) {
      console.error('[ContainerService] Failed to remove container:', err);
      this.emitEvent({ type: 'error', containerId, error: String(err) });
      return false;
    }
  }

  /**
   * Get container logs
   */
  async getLogs(containerId: string, tail?: number): Promise<string> {
    try {
      const response = await fetch(`${API_BASE}/containers/${containerId}/logs?tail=${tail || 100}`);
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      return data.logs || '';
    } catch (err) {
      console.error('[ContainerService] Failed to get logs:', err);
      return '';
    }
  }

  /**
   * Execute command in container
   */
  async exec(containerId: string, cmd: string[]): Promise<ExecResult | null> {
    try {
      const response = await fetch(`${API_BASE}/containers/${containerId}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    } catch (err) {
      console.error('[ContainerService] Failed to exec:', err);
      return null;
    }
  }

  /**
   * Inspect a container
   */
  async inspectContainer(containerId: string): Promise<ContainerInfo | null> {
    try {
      const response = await fetch(`${API_BASE}/containers/${containerId}`);
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    } catch (err) {
      console.error('[ContainerService] Failed to inspect container:', err);
      return null;
    }
  }

  /**
   * Subscribe to container events
   */
  subscribe(callback: ContainerEventCallback): () => void {
    this.eventListeners.add(callback);
    this.startPolling();

    return () => {
      this.eventListeners.delete(callback);
      if (this.eventListeners.size === 0) {
        this.stopPolling();
      }
    };
  }

  /**
   * Start polling for container status changes
   */
  private startPolling(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(async () => {
      try {
        const containers = await this.listContainers(true);
        for (const container of containers) {
          const lastStatus = this.lastContainerStates.get(container.id);
          if (lastStatus && lastStatus !== container.status) {
            this.emitEvent({
              type: 'status_change',
              containerId: container.id,
              containerName: container.name,
              status: container.status,
            });
          }
          this.lastContainerStates.set(container.id, container.status);
        }
      } catch (err) {
        // Silently handle polling errors
      }
    }, 5000);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: ContainerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[ContainerService] Event listener error:', err);
      }
    }
  }

  /**
   * Create and start a container in one operation
   */
  async run(request: CreateContainerRequest): Promise<string | null> {
    const containerId = await this.createContainer(request);
    if (!containerId) return null;

    const started = await this.startContainer(containerId);
    if (!started) {
      await this.removeContainer(containerId, true);
      return null;
    }

    return containerId;
  }

  /**
   * Run a workspace as a container
   * This is the bridge to ZLayer-style deployment specs
   */
  async runWorkspaceContainer(
    workspaceId: string,
    image: string,
    options?: {
      cmd?: string[];
      env?: string[];
      volumes?: string[];
      memory?: number;
      cpuShares?: number;
      gpu?: boolean;
    }
  ): Promise<string | null> {
    return this.run({
      name: `workspace-${workspaceId}`,
      image,
      cmd: options?.cmd,
      env: options?.env,
      volumes: options?.volumes,
      memory_limit: options?.memory,
      cpu_shares: options?.cpuShares,
      gpu: options?.gpu,
      labels: {
        'workspace_id': workspaceId,
        'managed_by': 'otherthing-node',
      },
    });
  }
}

// Singleton instance
export const containerService = new ContainerService();
