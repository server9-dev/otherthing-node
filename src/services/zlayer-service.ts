/**
 * ZLayer Service
 *
 * Native integration with ZLayer container orchestration platform.
 * Provides container/WASM orchestration without requiring Docker daemon.
 *
 * Features:
 * - Daemonless container runtime (libcontainer)
 * - WASM support (WASIp1/p2 via wasmtime)
 * - Built-in image builder
 * - Encrypted overlay networking
 * - Autoscaling support
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import * as https from 'https';

const execAsync = promisify(exec);

// ZLayer installation URLs
const ZLAYER_INSTALL_SCRIPT = 'https://zlayer.dev/install.sh';
const ZLAYER_RELEASES_BASE = 'https://github.com/BlackLeafDigital/ZLayer/releases/latest/download';

// Service resource types
export type ServiceType = 'service' | 'job' | 'cron';

// Autoscaling modes
export type AutoscaleMode = 'adaptive' | 'fixed' | 'manual';

// Node allocation modes
export type AllocationMode = 'shared' | 'dedicated' | 'exclusive';

// Health check types
export type HealthCheckType = 'tcp' | 'http' | 'command';

/**
 * ZLayer deployment specification
 */
export interface ZLayerSpec {
  name: string;
  version?: string;
  type?: ServiceType;
  image?: string;
  wasm?: {
    module: string;
    runtime?: 'wasmtime' | 'wasmer';
  };
  replicas?: number;
  resources?: {
    cpu?: number;
    memory?: string;
    gpu?: boolean;
  };
  env?: Record<string, string>;
  ports?: Array<{
    container: number;
    host?: number;
    protocol?: 'tcp' | 'udp';
  }>;
  volumes?: Array<{
    type: 'bind' | 'named' | 'tmpfs' | 's3';
    source?: string;
    target: string;
    readonly?: boolean;
  }>;
  healthCheck?: {
    type: HealthCheckType;
    endpoint?: string;
    port?: number;
    command?: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
  };
  autoscale?: {
    mode: AutoscaleMode;
    min?: number;
    max?: number;
    targetCpu?: number;
    targetMemory?: number;
    targetRps?: number;
  };
  network?: {
    overlay?: boolean;
    encrypted?: boolean;
  };
  labels?: Record<string, string>;
}

/**
 * Service status
 */
export interface ServiceStatus {
  name: string;
  type: ServiceType;
  status: 'pending' | 'running' | 'stopped' | 'failed' | 'scaling';
  replicas: {
    desired: number;
    ready: number;
    available: number;
  };
  endpoints?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Build progress event
 */
export interface BuildProgress {
  stage: string;
  progress: number;
  message: string;
}

/**
 * ZLayer runtime info
 */
export interface ZLayerInfo {
  installed: boolean;
  version?: string;
  cliPath?: string;
  buildPath?: string;
  runtimePath?: string;
  wasmSupported: boolean;
  platform: string;
  arch: string;
}

export class ZLayerService extends EventEmitter {
  private cliPath: string | null = null;
  private buildPath: string | null = null;
  private runtimePath: string | null = null;
  private initialized = false;
  private processes: Map<string, ChildProcess> = new Map();

  constructor() {
    super();
  }

  /**
   * Initialize and detect ZLayer installation
   */
  async initialize(): Promise<ZLayerInfo> {
    if (this.initialized) {
      return this.getInfo();
    }

    await this.detectInstallation();
    this.initialized = true;

    return this.getInfo();
  }

  /**
   * Detect ZLayer installation paths
   */
  private async detectInstallation(): Promise<void> {
    const platform = process.platform;
    const possiblePaths: string[] = [];

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
      const userProfile = process.env.USERPROFILE || '';

      possiblePaths.push(
        path.join(localAppData, 'Programs', 'ZLayer', 'zlayer-cli.exe'),
        path.join(localAppData, 'ZLayer', 'zlayer-cli.exe'),
        path.join(programFiles, 'ZLayer', 'zlayer-cli.exe'),
        path.join(userProfile, '.zlayer', 'bin', 'zlayer-cli.exe'),
      );
    } else {
      possiblePaths.push(
        '/usr/local/bin/zlayer-cli',
        '/usr/bin/zlayer-cli',
        path.join(process.env.HOME || '', '.zlayer', 'bin', 'zlayer-cli'),
        path.join(process.env.HOME || '', '.local', 'bin', 'zlayer-cli'),
      );
    }

    // Check each path
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        this.cliPath = p;
        this.emit('log', { message: `Found zlayer-cli at ${p}`, type: 'info' });
        break;
      }
    }

    // Try to find via PATH
    if (!this.cliPath) {
      try {
        const { stdout } = await execAsync(
          platform === 'win32' ? 'where zlayer-cli 2>nul' : 'which zlayer-cli',
          { timeout: 5000 }
        );
        const foundPath = stdout.trim().split('\n')[0].trim();
        if (foundPath && fs.existsSync(foundPath)) {
          this.cliPath = foundPath;
          this.emit('log', { message: `Found zlayer-cli in PATH: ${foundPath}`, type: 'info' });
        }
      } catch {
        // Not found in PATH
      }
    }

    // Also look for zlayer-build
    const buildPaths = this.cliPath
      ? [this.cliPath.replace('zlayer-cli', 'zlayer-build')]
      : [];

    if (platform !== 'win32') {
      buildPaths.push(
        '/usr/local/bin/zlayer-build',
        path.join(process.env.HOME || '', '.zlayer', 'bin', 'zlayer-build'),
      );
    }

    for (const p of buildPaths) {
      const actualPath = platform === 'win32' ? p.replace('.exe', '') + '.exe' : p;
      if (fs.existsSync(actualPath)) {
        this.buildPath = actualPath;
        break;
      }
    }
  }

  /**
   * Get ZLayer info
   */
  getInfo(): ZLayerInfo {
    return {
      installed: this.cliPath !== null,
      version: undefined, // Will be populated by getVersion()
      cliPath: this.cliPath || undefined,
      buildPath: this.buildPath || undefined,
      runtimePath: this.runtimePath || undefined,
      wasmSupported: true, // ZLayer supports WASM natively
      platform: process.platform,
      arch: process.arch,
    };
  }

  /**
   * Check if ZLayer is installed
   */
  isInstalled(): boolean {
    return this.cliPath !== null;
  }

  /**
   * Get ZLayer version
   */
  async getVersion(): Promise<string | null> {
    if (!this.cliPath) return null;

    try {
      const { stdout } = await execAsync(`"${this.cliPath}" --version`, { timeout: 5000 });
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Install ZLayer
   */
  async install(onProgress?: (percent: number, message: string) => void): Promise<boolean> {
    const platform = process.platform;

    this.emit('log', { message: 'Installing ZLayer...', type: 'info' });
    onProgress?.(5, 'Starting installation...');

    try {
      if (platform === 'linux' || platform === 'darwin') {
        // Use the install script
        onProgress?.(10, 'Downloading install script...');

        const { stdout, stderr } = await execAsync(
          `curl -fsSL ${ZLAYER_INSTALL_SCRIPT} | bash`,
          { timeout: 300000 }
        );

        this.emit('log', { message: 'Install script completed', type: 'info' });
        onProgress?.(90, 'Installation complete');

      } else if (platform === 'win32') {
        // Download Windows binary directly
        onProgress?.(10, 'Downloading ZLayer for Windows...');

        const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
        const downloadUrl = `${ZLAYER_RELEASES_BASE}/zlayer-cli-windows-${arch}.exe`;

        const installDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ZLayer');
        if (!fs.existsSync(installDir)) {
          fs.mkdirSync(installDir, { recursive: true });
        }

        const targetPath = path.join(installDir, 'zlayer-cli.exe');

        // Download using curl (available on Windows 10+)
        await execAsync(`curl -fsSL -o "${targetPath}" "${downloadUrl}"`, { timeout: 300000 });

        onProgress?.(80, 'Adding to PATH...');

        // Add to user PATH
        try {
          await execAsync(`setx PATH "%PATH%;${installDir}"`, { timeout: 10000 });
        } catch {
          this.emit('log', { message: 'Could not add to PATH automatically', type: 'warning' });
        }

        onProgress?.(90, 'Installation complete');
      }

      // Re-detect installation
      await this.detectInstallation();

      if (this.isInstalled()) {
        onProgress?.(100, 'ZLayer installed successfully');
        this.emit('log', { message: 'ZLayer installed successfully', type: 'success' });
        return true;
      } else {
        throw new Error('Installation completed but ZLayer not found');
      }
    } catch (err) {
      this.emit('log', { message: `Installation failed: ${err}`, type: 'error' });
      onProgress?.(0, `Installation failed: ${err}`);
      return false;
    }
  }

  // ============ Deployment Operations ============

  /**
   * Deploy a service using a ZLayer spec
   */
  async deploy(spec: ZLayerSpec, onProgress?: (progress: BuildProgress) => void): Promise<string | null> {
    if (!this.cliPath) {
      throw new Error('ZLayer not installed');
    }

    // Generate YAML spec file
    const specYaml = this.generateSpecYaml(spec);
    const tempFile = path.join(os.tmpdir(), `zlayer-${spec.name}-${Date.now()}.yaml`);

    try {
      fs.writeFileSync(tempFile, specYaml, 'utf-8');

      onProgress?.({ stage: 'deploying', progress: 10, message: 'Starting deployment...' });

      const { stdout, stderr } = await execAsync(
        `"${this.cliPath}" deploy "${tempFile}" --json`,
        { timeout: 300000 }
      );

      onProgress?.({ stage: 'complete', progress: 100, message: 'Deployment complete' });

      // Parse deployment ID from output
      try {
        const result = JSON.parse(stdout);
        return result.id || result.name || spec.name;
      } catch {
        return spec.name;
      }
    } finally {
      // Cleanup temp file
      try {
        fs.unlinkSync(tempFile);
      } catch {}
    }
  }

  /**
   * Generate YAML spec from ZLayerSpec object
   */
  private generateSpecYaml(spec: ZLayerSpec): string {
    const lines: string[] = [
      `name: ${spec.name}`,
    ];

    if (spec.version) lines.push(`version: "${spec.version}"`);
    if (spec.type) lines.push(`type: ${spec.type}`);

    if (spec.image) {
      lines.push(`image: ${spec.image}`);
    } else if (spec.wasm) {
      lines.push(`wasm:`);
      lines.push(`  module: ${spec.wasm.module}`);
      if (spec.wasm.runtime) lines.push(`  runtime: ${spec.wasm.runtime}`);
    }

    if (spec.replicas !== undefined) {
      lines.push(`replicas: ${spec.replicas}`);
    }

    if (spec.resources) {
      lines.push(`resources:`);
      if (spec.resources.cpu) lines.push(`  cpu: ${spec.resources.cpu}`);
      if (spec.resources.memory) lines.push(`  memory: "${spec.resources.memory}"`);
      if (spec.resources.gpu) lines.push(`  gpu: true`);
    }

    if (spec.env && Object.keys(spec.env).length > 0) {
      lines.push(`env:`);
      for (const [key, value] of Object.entries(spec.env)) {
        lines.push(`  ${key}: "${value}"`);
      }
    }

    if (spec.ports && spec.ports.length > 0) {
      lines.push(`ports:`);
      for (const port of spec.ports) {
        lines.push(`  - container: ${port.container}`);
        if (port.host) lines.push(`    host: ${port.host}`);
        if (port.protocol) lines.push(`    protocol: ${port.protocol}`);
      }
    }

    if (spec.volumes && spec.volumes.length > 0) {
      lines.push(`volumes:`);
      for (const vol of spec.volumes) {
        lines.push(`  - type: ${vol.type}`);
        if (vol.source) lines.push(`    source: "${vol.source}"`);
        lines.push(`    target: "${vol.target}"`);
        if (vol.readonly) lines.push(`    readonly: true`);
      }
    }

    if (spec.healthCheck) {
      lines.push(`healthCheck:`);
      lines.push(`  type: ${spec.healthCheck.type}`);
      if (spec.healthCheck.endpoint) lines.push(`  endpoint: "${spec.healthCheck.endpoint}"`);
      if (spec.healthCheck.port) lines.push(`  port: ${spec.healthCheck.port}`);
      if (spec.healthCheck.command) lines.push(`  command: ${JSON.stringify(spec.healthCheck.command)}`);
      if (spec.healthCheck.interval) lines.push(`  interval: "${spec.healthCheck.interval}"`);
      if (spec.healthCheck.timeout) lines.push(`  timeout: "${spec.healthCheck.timeout}"`);
      if (spec.healthCheck.retries) lines.push(`  retries: ${spec.healthCheck.retries}`);
    }

    if (spec.autoscale) {
      lines.push(`autoscale:`);
      lines.push(`  mode: ${spec.autoscale.mode}`);
      if (spec.autoscale.min) lines.push(`  min: ${spec.autoscale.min}`);
      if (spec.autoscale.max) lines.push(`  max: ${spec.autoscale.max}`);
      if (spec.autoscale.targetCpu) lines.push(`  targetCpu: ${spec.autoscale.targetCpu}`);
      if (spec.autoscale.targetMemory) lines.push(`  targetMemory: ${spec.autoscale.targetMemory}`);
      if (spec.autoscale.targetRps) lines.push(`  targetRps: ${spec.autoscale.targetRps}`);
    }

    if (spec.network) {
      lines.push(`network:`);
      if (spec.network.overlay) lines.push(`  overlay: true`);
      if (spec.network.encrypted) lines.push(`  encrypted: true`);
    }

    if (spec.labels && Object.keys(spec.labels).length > 0) {
      lines.push(`labels:`);
      for (const [key, value] of Object.entries(spec.labels)) {
        lines.push(`  ${key}: "${value}"`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get service status
   */
  async getStatus(serviceName: string): Promise<ServiceStatus | null> {
    if (!this.cliPath) return null;

    try {
      const { stdout } = await execAsync(
        `"${this.cliPath}" status "${serviceName}" --json`,
        { timeout: 30000 }
      );

      return JSON.parse(stdout) as ServiceStatus;
    } catch {
      return null;
    }
  }

  /**
   * List all services
   */
  async listServices(): Promise<ServiceStatus[]> {
    if (!this.cliPath) return [];

    try {
      const { stdout } = await execAsync(
        `"${this.cliPath}" list --json`,
        { timeout: 30000 }
      );

      const result = JSON.parse(stdout);
      return result.services || [];
    } catch {
      return [];
    }
  }

  /**
   * Stop a service
   */
  async stop(serviceName: string): Promise<boolean> {
    if (!this.cliPath) return false;

    try {
      await execAsync(
        `"${this.cliPath}" stop "${serviceName}"`,
        { timeout: 60000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a service
   */
  async remove(serviceName: string): Promise<boolean> {
    if (!this.cliPath) return false;

    try {
      await execAsync(
        `"${this.cliPath}" remove "${serviceName}" --force`,
        { timeout: 60000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scale a service
   */
  async scale(serviceName: string, replicas: number): Promise<boolean> {
    if (!this.cliPath) return false;

    try {
      await execAsync(
        `"${this.cliPath}" scale "${serviceName}" ${replicas}`,
        { timeout: 60000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get service logs
   */
  async getLogs(serviceName: string, tail?: number): Promise<string> {
    if (!this.cliPath) return '';

    try {
      const { stdout } = await execAsync(
        `"${this.cliPath}" logs "${serviceName}" --tail=${tail || 100}`,
        { timeout: 30000 }
      );
      return stdout;
    } catch {
      return '';
    }
  }

  // ============ WASM Operations ============

  /**
   * Run a WASM module directly
   */
  async runWasm(
    wasmPath: string,
    options?: {
      args?: string[];
      env?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.cliPath) {
      throw new Error('ZLayer not installed');
    }

    const args = options?.args?.join(' ') || '';
    const envArgs = options?.env
      ? Object.entries(options.env).map(([k, v]) => `-e ${k}="${v}"`).join(' ')
      : '';

    try {
      const { stdout, stderr } = await execAsync(
        `"${this.cliPath}" run-wasm "${wasmPath}" ${envArgs} -- ${args}`,
        { timeout: options?.timeout || 60000 }
      );

      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code || 1,
      };
    }
  }

  // ============ Build Operations ============

  /**
   * Build an image using zlayer-build
   */
  async build(
    contextPath: string,
    options?: {
      tag?: string;
      dockerfile?: string;
      buildArgs?: Record<string, string>;
    },
    onProgress?: (progress: BuildProgress) => void
  ): Promise<string | null> {
    const buildCmd = this.buildPath || this.cliPath;
    if (!buildCmd) {
      throw new Error('ZLayer build tool not installed');
    }

    const tag = options?.tag || `local/${path.basename(contextPath)}:latest`;
    const dockerfile = options?.dockerfile ? `-f "${options.dockerfile}"` : '';
    const buildArgs = options?.buildArgs
      ? Object.entries(options.buildArgs).map(([k, v]) => `--build-arg ${k}="${v}"`).join(' ')
      : '';

    onProgress?.({ stage: 'building', progress: 10, message: 'Starting build...' });

    try {
      const { stdout, stderr } = await execAsync(
        `"${buildCmd}" build "${contextPath}" -t "${tag}" ${dockerfile} ${buildArgs}`,
        { timeout: 600000 }
      );

      onProgress?.({ stage: 'complete', progress: 100, message: 'Build complete' });
      return tag;
    } catch (err: any) {
      onProgress?.({ stage: 'failed', progress: 0, message: err.message });
      return null;
    }
  }

  // ============ Workspace Integration ============

  /**
   * Create a ZLayer spec for a workspace
   */
  createWorkspaceSpec(
    workspaceId: string,
    workspacePath: string,
    options?: {
      image?: string;
      wasmModule?: string;
      cmd?: string[];
      env?: Record<string, string>;
      ports?: number[];
      memory?: string;
      cpu?: number;
      gpu?: boolean;
    }
  ): ZLayerSpec {
    const spec: ZLayerSpec = {
      name: `workspace-${workspaceId}`,
      type: 'service',
      labels: {
        'workspace_id': workspaceId,
        'managed_by': 'otherthing-node',
      },
    };

    if (options?.wasmModule) {
      spec.wasm = {
        module: options.wasmModule,
        runtime: 'wasmtime',
      };
    } else {
      spec.image = options?.image || 'python:3.11-slim';
    }

    spec.env = {
      WORKSPACE_ID: workspaceId,
      WORKSPACE_PATH: '/workspace',
      ...options?.env,
    };

    spec.volumes = [
      {
        type: 'bind',
        source: workspacePath,
        target: '/workspace',
      },
    ];

    if (options?.ports) {
      spec.ports = options.ports.map(p => ({
        container: p,
        protocol: 'tcp' as const,
      }));
    }

    spec.resources = {};
    if (options?.memory) spec.resources.memory = options.memory;
    if (options?.cpu) spec.resources.cpu = options.cpu;
    if (options?.gpu) spec.resources.gpu = true;

    spec.healthCheck = {
      type: 'tcp',
      port: spec.ports?.[0]?.container || 8080,
      interval: '10s',
      timeout: '5s',
      retries: 3,
    };

    return spec;
  }

  /**
   * Deploy a workspace as a ZLayer service
   */
  async deployWorkspace(
    workspaceId: string,
    workspacePath: string,
    options?: Parameters<typeof this.createWorkspaceSpec>[2]
  ): Promise<string | null> {
    const spec = this.createWorkspaceSpec(workspaceId, workspacePath, options);
    return this.deploy(spec);
  }

  /**
   * Execute a command in a workspace service
   */
  async execInWorkspace(
    workspaceId: string,
    command: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.cliPath) {
      throw new Error('ZLayer not installed');
    }

    const serviceName = `workspace-${workspaceId}`;

    try {
      const { stdout, stderr } = await execAsync(
        `"${this.cliPath}" exec "${serviceName}" -- ${command.join(' ')}`,
        { timeout: 60000 }
      );

      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code || 1,
      };
    }
  }
}

// Singleton instance
export const zlayerService = new ZLayerService();
