import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { getTempPath } from './electron-compat';
import { IPFSManager } from './ipfs-manager';
import { zlayerService, ZLayerSpec } from './services/zlayer-service';

// Execution backend type
export type ExecutionBackend = 'native' | 'zlayer' | 'wasm';

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface SandboxMeta {
  workspaceId: string;
  createdAt: string;
  lastSyncCid: string | null;
  totalSize: number;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

// Security: blocked command patterns
const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+(-rf?|--force)?\s*\/(?!\s)/, // rm -rf / or rm /
  /sudo\s/i,
  /su\s+-?\s*$/,
  /chmod\s+777/,
  /curl\s+.*\|\s*(ba)?sh/i, // curl | sh
  /wget\s+.*\|\s*(ba)?sh/i, // wget | sh
  /mkfs\./,
  /fdisk\s/,
  /dd\s+if=/,
  />\s*\/dev\/sd/, // Writing to disk devices
  /format\s+[a-z]:/i, // Windows format
  /del\s+\/[sfq]/i, // Windows dangerous delete
  /rmdir\s+\/s/i, // Windows recursive delete
  /reg\s+(delete|add)/i, // Windows registry
  /net\s+user/i, // Windows user management
  /powershell.*-enc/i, // Encoded PowerShell
];

// Security: blocked path patterns (prevent traversal)
const BLOCKED_PATH_PATTERNS = [
  /\.\.[\/\\]/, // Path traversal
  /^[\/\\]/, // Absolute paths starting with /
  /^[a-zA-Z]:[\/\\]/, // Windows absolute paths like C:\
];

// Allowed file extensions for code files
const ALLOWED_EXTENSIONS = [
  // Code
  '.py', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.go', '.rs', '.rb', '.php', '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.m',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  // Config
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.xml', '.html', '.css', '.scss', '.less',
  // Data
  '.txt', '.md', '.csv', '.log',
  // Build
  '.dockerfile', '.makefile', '.gradle',
];

export class SandboxManager extends EventEmitter {
  private basePath: string;
  private ipfsManager: IPFSManager | null = null;
  private maxSandboxSizeBytes: number = 500 * 1024 * 1024; // 500MB default
  private executionBackend: ExecutionBackend = 'native';
  private zlayerInitialized: boolean = false;

  constructor(storagePath: string) {
    super();
    this.basePath = path.join(storagePath, 'otherthing-storage', 'workspaces');
  }

  /**
   * Set the execution backend (native, zlayer, or wasm)
   */
  setExecutionBackend(backend: ExecutionBackend): void {
    this.executionBackend = backend;
    this.log(`Execution backend set to: ${backend}`, 'info');
  }

  /**
   * Get current execution backend
   */
  getExecutionBackend(): ExecutionBackend {
    return this.executionBackend;
  }

  /**
   * Initialize ZLayer for isolated execution
   */
  async initializeZLayer(): Promise<boolean> {
    if (this.zlayerInitialized) return true;

    try {
      const info = await zlayerService.initialize();
      if (info.installed) {
        this.zlayerInitialized = true;
        this.log(`ZLayer initialized (version: ${await zlayerService.getVersion()})`, 'success');
        return true;
      } else {
        this.log('ZLayer not installed', 'info');
        return false;
      }
    } catch (err) {
      this.log(`Failed to initialize ZLayer: ${err}`, 'error');
      return false;
    }
  }

  /**
   * Check if ZLayer is available
   */
  isZLayerAvailable(): boolean {
    return this.zlayerInitialized && zlayerService.isInstalled();
  }

  /**
   * Set the IPFS manager for sync operations
   */
  setIPFSManager(ipfs: IPFSManager): void {
    this.ipfsManager = ipfs;
  }

  /**
   * Set max sandbox size in bytes
   */
  setMaxSandboxSize(bytes: number): void {
    this.maxSandboxSizeBytes = bytes;
  }

  /**
   * Get the sandbox path for a workspace
   */
  getSandboxPath(workspaceId: string): string {
    return path.join(this.basePath, workspaceId, 'sandbox');
  }

  /**
   * Get the meta file path for a workspace
   */
  private getMetaPath(workspaceId: string): string {
    return path.join(this.basePath, workspaceId, '.sandbox-meta.json');
  }

  /**
   * Validate workspace ID (prevent path traversal)
   */
  private validateWorkspaceId(workspaceId: string): boolean {
    // Must be UUID-like or alphanumeric with dashes
    return /^[a-zA-Z0-9\-_]+$/.test(workspaceId) && workspaceId.length <= 64;
  }

  /**
   * Validate a relative path (prevent path traversal)
   */
  private validatePath(relativePath: string): { valid: boolean; error?: string } {
    // Check for blocked patterns
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(relativePath)) {
        return { valid: false, error: 'Path traversal or absolute path not allowed' };
      }
    }

    // Normalize and check it doesn't escape sandbox
    const normalized = path.normalize(relativePath);
    if (normalized.startsWith('..')) {
      return { valid: false, error: 'Path would escape sandbox' };
    }

    return { valid: true };
  }

  /**
   * Validate a command for security
   */
  private validateCommand(command: string): { valid: boolean; error?: string } {
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        return { valid: false, error: `Command blocked for security: matches pattern ${pattern}` };
      }
    }
    return { valid: true };
  }

  /**
   * Validate file extension
   */
  private validateExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    // Allow files without extension (like Makefile, Dockerfile)
    if (!ext) {
      const basename = path.basename(filePath).toLowerCase();
      return ['makefile', 'dockerfile', 'jenkinsfile', 'vagrantfile', 'readme', 'license'].includes(basename);
    }
    return ALLOWED_EXTENSIONS.includes(ext);
  }

  /**
   * Create a sandbox for a workspace
   */
  async createSandbox(workspaceId: string): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, error: 'Invalid workspace ID' };
    }

    const sandboxPath = this.getSandboxPath(workspaceId);

    try {
      // Create directory structure
      const dirs = [
        sandboxPath,
        path.join(sandboxPath, 'code'),
        path.join(sandboxPath, 'output'),
        path.join(sandboxPath, 'data'),
      ];

      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      // Create meta file
      const meta: SandboxMeta = {
        workspaceId,
        createdAt: new Date().toISOString(),
        lastSyncCid: null,
        totalSize: 0,
      };

      fs.writeFileSync(this.getMetaPath(workspaceId), JSON.stringify(meta, null, 2));

      this.log(`Created sandbox for workspace ${workspaceId}`, 'success');
      return { success: true, path: sandboxPath };
    } catch (error) {
      this.log(`Failed to create sandbox: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Ensure sandbox exists, create if not
   */
  async ensureSandbox(workspaceId: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const sandboxPath = this.getSandboxPath(workspaceId);
    if (fs.existsSync(sandboxPath)) {
      return { success: true, path: sandboxPath };
    }
    return this.createSandbox(workspaceId);
  }

  /**
   * Write a file to the sandbox
   */
  async writeFile(
    workspaceId: string,
    relativePath: string,
    content: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    // Validate inputs
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, error: 'Invalid workspace ID' };
    }

    const pathValidation = this.validatePath(relativePath);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }

    if (!this.validateExtension(relativePath)) {
      return { success: false, error: `File extension not allowed: ${path.extname(relativePath)}` };
    }

    // Ensure sandbox exists
    const sandboxResult = await this.ensureSandbox(workspaceId);
    if (!sandboxResult.success) {
      return sandboxResult;
    }

    const fullPath = path.join(sandboxResult.path!, relativePath);

    try {
      // Check size limits
      const currentSize = await this.getSandboxSize(workspaceId);
      const newContentSize = Buffer.byteLength(content, 'utf8');

      if (currentSize + newContentSize > this.maxSandboxSizeBytes) {
        return { success: false, error: `Sandbox size limit exceeded (max ${this.maxSandboxSizeBytes / 1024 / 1024}MB)` };
      }

      // Create parent directories if needed
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Write the file
      fs.writeFileSync(fullPath, content, 'utf8');

      this.log(`Wrote file: ${relativePath} (${newContentSize} bytes)`, 'info');
      return { success: true, path: relativePath };
    } catch (error) {
      this.log(`Failed to write file: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(
    workspaceId: string,
    relativePath: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    // Validate inputs
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, error: 'Invalid workspace ID' };
    }

    const pathValidation = this.validatePath(relativePath);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }

    const sandboxPath = this.getSandboxPath(workspaceId);
    const fullPath = path.join(sandboxPath, relativePath);

    try {
      // Check file exists within sandbox
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'File not found' };
      }

      // Verify path is within sandbox (extra safety check)
      const realPath = fs.realpathSync(fullPath);
      const realSandbox = fs.realpathSync(sandboxPath);
      if (!realPath.startsWith(realSandbox)) {
        return { success: false, error: 'Path traversal detected' };
      }

      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        return { success: false, error: 'Path is a directory, not a file' };
      }

      // Limit read size to prevent memory issues
      const maxReadSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxReadSize) {
        return { success: false, error: `File too large to read (max ${maxReadSize / 1024 / 1024}MB)` };
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      return { success: true, content };
    } catch (error) {
      this.log(`Failed to read file: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * List files in the sandbox
   */
  async listFiles(
    workspaceId: string,
    relativePath: string = '.'
  ): Promise<{ success: boolean; files?: FileInfo[]; error?: string }> {
    // Validate inputs
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, error: 'Invalid workspace ID' };
    }

    const pathValidation = this.validatePath(relativePath);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }

    const sandboxPath = this.getSandboxPath(workspaceId);
    const fullPath = path.join(sandboxPath, relativePath);

    try {
      if (!fs.existsSync(fullPath)) {
        return { success: true, files: [] };
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path is not a directory' };
      }

      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry.name);
        const entryStats = fs.statSync(entryPath);
        const entryRelPath = path.join(relativePath, entry.name).replace(/\\/g, '/');

        files.push({
          name: entry.name,
          path: entryRelPath === '.' ? entry.name : entryRelPath,
          isDirectory: entry.isDirectory(),
          size: entryStats.size,
          modifiedAt: entryStats.mtime.toISOString(),
        });
      }

      // Sort: directories first, then by name
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return { success: true, files };
    } catch (error) {
      this.log(`Failed to list files: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete a file from the sandbox
   */
  async deleteFile(
    workspaceId: string,
    relativePath: string
  ): Promise<{ success: boolean; error?: string }> {
    // Validate inputs
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, error: 'Invalid workspace ID' };
    }

    const pathValidation = this.validatePath(relativePath);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }

    // Prevent deleting the root sandbox dirs
    const normalized = path.normalize(relativePath);
    if (['code', 'output', 'data', '.', ''].includes(normalized)) {
      return { success: false, error: 'Cannot delete root sandbox directories' };
    }

    const sandboxPath = this.getSandboxPath(workspaceId);
    const fullPath = path.join(sandboxPath, relativePath);

    try {
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'File not found' };
      }

      // Verify path is within sandbox
      const realPath = fs.realpathSync(fullPath);
      const realSandbox = fs.realpathSync(sandboxPath);
      if (!realPath.startsWith(realSandbox)) {
        return { success: false, error: 'Path traversal detected' };
      }

      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true });
      } else {
        fs.unlinkSync(fullPath);
      }

      this.log(`Deleted: ${relativePath}`, 'info');
      return { success: true };
    } catch (error) {
      this.log(`Failed to delete file: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Execute a command in the sandbox
   */
  async execute(
    workspaceId: string,
    command: string,
    timeout: number = 30000
  ): Promise<ExecutionResult> {
    // Validate inputs
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: 'Invalid workspace ID' };
    }

    const commandValidation = this.validateCommand(command);
    if (!commandValidation.valid) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: commandValidation.error };
    }

    const sandboxResult = await this.ensureSandbox(workspaceId);
    if (!sandboxResult.success) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: sandboxResult.error };
    }

    const sandboxPath = sandboxResult.path!;

    // Import exec here to avoid issues
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      this.log(`Executing: ${command.slice(0, 100)}...`, 'info');

      const { stdout, stderr } = await execAsync(command, {
        cwd: sandboxPath,
        timeout,
        maxBuffer: 5 * 1024 * 1024, // 5MB output limit
        env: {
          ...process.env,
          // Restrict some environment variables for security
          HOME: sandboxPath,
          USERPROFILE: sandboxPath,
          TMPDIR: path.join(sandboxPath, 'output'),
          TEMP: path.join(sandboxPath, 'output'),
          TMP: path.join(sandboxPath, 'output'),
        },
      });

      this.log(`Command completed successfully`, 'success');
      return {
        success: true,
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      };
    } catch (error: any) {
      // exec throws on non-zero exit code
      const exitCode = error.code ?? -1;
      const stdout = error.stdout || '';
      const stderr = error.stderr || error.message || '';

      this.log(`Command exited with code ${exitCode}`, error.killed ? 'error' : 'info');
      return {
        success: exitCode === 0,
        stdout,
        stderr,
        exitCode,
        error: error.killed ? 'Command timed out' : undefined,
      };
    }
  }

  /**
   * Execute a command using ZLayer container isolation
   */
  async executeWithZLayer(
    workspaceId: string,
    command: string,
    options?: {
      image?: string;
      timeout?: number;
      env?: Record<string, string>;
      gpu?: boolean;
    }
  ): Promise<ExecutionResult> {
    if (!this.zlayerInitialized) {
      const initialized = await this.initializeZLayer();
      if (!initialized) {
        return {
          success: false,
          stdout: '',
          stderr: 'ZLayer not available',
          exitCode: -1,
          error: 'ZLayer not installed or failed to initialize',
        };
      }
    }

    // Validate inputs
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: 'Invalid workspace ID' };
    }

    const sandboxResult = await this.ensureSandbox(workspaceId);
    if (!sandboxResult.success) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: sandboxResult.error };
    }

    const sandboxPath = sandboxResult.path!;
    const image = options?.image || 'python:3.11-slim';

    this.log(`Executing with ZLayer (${image}): ${command.slice(0, 100)}...`, 'info');

    try {
      // Create a temporary deployment spec for execution
      const spec: ZLayerSpec = {
        name: `exec-${workspaceId}-${Date.now()}`,
        type: 'job',
        image,
        env: {
          WORKSPACE_PATH: '/workspace',
          ...options?.env,
        },
        volumes: [
          {
            type: 'bind',
            source: sandboxPath,
            target: '/workspace',
          },
        ],
        resources: {
          memory: '512Mi',
          cpu: 1,
          gpu: options?.gpu,
        },
        labels: {
          'workspace_id': workspaceId,
          'execution_type': 'command',
          'managed_by': 'otherthing-node',
        },
      };

      // Deploy and run
      const deployId = await zlayerService.deploy(spec);
      if (!deployId) {
        return {
          success: false,
          stdout: '',
          stderr: 'Failed to deploy ZLayer job',
          exitCode: -1,
          error: 'ZLayer deployment failed',
        };
      }

      // Execute the command in the container
      const result = await zlayerService.execInWorkspace(workspaceId, ['sh', '-c', command]);

      // Cleanup the job
      await zlayerService.remove(spec.name);

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error: any) {
      this.log(`ZLayer execution failed: ${error}`, 'error');
      return {
        success: false,
        stdout: '',
        stderr: error.message || String(error),
        exitCode: -1,
        error: 'ZLayer execution failed',
      };
    }
  }

  /**
   * Execute a WASM module in ZLayer's sandboxed runtime
   */
  async executeWasm(
    workspaceId: string,
    wasmPath: string,
    options?: {
      args?: string[];
      env?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<ExecutionResult> {
    if (!this.zlayerInitialized) {
      const initialized = await this.initializeZLayer();
      if (!initialized) {
        return {
          success: false,
          stdout: '',
          stderr: 'ZLayer not available for WASM execution',
          exitCode: -1,
          error: 'ZLayer not installed',
        };
      }
    }

    // Validate inputs
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: 'Invalid workspace ID' };
    }

    const sandboxResult = await this.ensureSandbox(workspaceId);
    if (!sandboxResult.success) {
      return { success: false, stdout: '', stderr: '', exitCode: -1, error: sandboxResult.error };
    }

    // Resolve WASM path relative to sandbox
    const fullWasmPath = path.isAbsolute(wasmPath)
      ? wasmPath
      : path.join(sandboxResult.path!, wasmPath);

    if (!fs.existsSync(fullWasmPath)) {
      return {
        success: false,
        stdout: '',
        stderr: `WASM module not found: ${wasmPath}`,
        exitCode: -1,
        error: 'WASM module not found',
      };
    }

    this.log(`Executing WASM module: ${wasmPath}`, 'info');

    try {
      const result = await zlayerService.runWasm(fullWasmPath, {
        args: options?.args,
        env: {
          WORKSPACE_ID: workspaceId,
          ...options?.env,
        },
        timeout: options?.timeout || 60000,
      });

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error: any) {
      this.log(`WASM execution failed: ${error}`, 'error');
      return {
        success: false,
        stdout: '',
        stderr: error.message || String(error),
        exitCode: -1,
        error: 'WASM execution failed',
      };
    }
  }

  /**
   * Execute with automatic backend selection
   * Uses the configured execution backend (native, zlayer, or wasm)
   */
  async executeAuto(
    workspaceId: string,
    command: string,
    options?: {
      preferBackend?: ExecutionBackend;
      image?: string;
      wasmModule?: string;
      timeout?: number;
      env?: Record<string, string>;
      gpu?: boolean;
    }
  ): Promise<ExecutionResult> {
    const backend = options?.preferBackend || this.executionBackend;

    // If WASM module specified, use WASM execution
    if (options?.wasmModule) {
      return this.executeWasm(workspaceId, options.wasmModule, {
        args: [command],
        env: options.env,
        timeout: options.timeout,
      });
    }

    // Use the specified backend
    switch (backend) {
      case 'zlayer':
        if (this.isZLayerAvailable() || await this.initializeZLayer()) {
          return this.executeWithZLayer(workspaceId, command, {
            image: options?.image,
            timeout: options?.timeout,
            env: options?.env,
            gpu: options?.gpu,
          });
        }
        // Fall through to native if ZLayer unavailable
        this.log('ZLayer unavailable, falling back to native execution', 'info');

      case 'native':
      default:
        return this.execute(workspaceId, command, options?.timeout);
    }
  }

  /**
   * Deploy a persistent workspace container with ZLayer
   */
  async deployWorkspaceContainer(
    workspaceId: string,
    options?: {
      image?: string;
      wasmModule?: string;
      ports?: number[];
      env?: Record<string, string>;
      memory?: string;
      cpu?: number;
      gpu?: boolean;
    }
  ): Promise<{ success: boolean; serviceId?: string; error?: string }> {
    if (!this.zlayerInitialized) {
      const initialized = await this.initializeZLayer();
      if (!initialized) {
        return { success: false, error: 'ZLayer not available' };
      }
    }

    const sandboxResult = await this.ensureSandbox(workspaceId);
    if (!sandboxResult.success) {
      return { success: false, error: sandboxResult.error };
    }

    try {
      const serviceId = await zlayerService.deployWorkspace(
        workspaceId,
        sandboxResult.path!,
        {
          image: options?.image,
          wasmModule: options?.wasmModule,
          ports: options?.ports,
          env: options?.env,
          memory: options?.memory,
          cpu: options?.cpu,
          gpu: options?.gpu,
        }
      );

      if (serviceId) {
        this.log(`Deployed workspace container: ${serviceId}`, 'success');
        return { success: true, serviceId };
      } else {
        return { success: false, error: 'Deployment returned no service ID' };
      }
    } catch (error: any) {
      this.log(`Failed to deploy workspace container: ${error}`, 'error');
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Stop and remove a workspace container
   */
  async stopWorkspaceContainer(workspaceId: string): Promise<boolean> {
    const serviceName = `workspace-${workspaceId}`;
    try {
      await zlayerService.stop(serviceName);
      await zlayerService.remove(serviceName);
      this.log(`Stopped workspace container: ${serviceName}`, 'success');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get workspace container status
   */
  async getWorkspaceContainerStatus(workspaceId: string): Promise<{
    running: boolean;
    status?: string;
    replicas?: { ready: number; desired: number };
  }> {
    const serviceName = `workspace-${workspaceId}`;
    try {
      const status = await zlayerService.getStatus(serviceName);
      if (status) {
        return {
          running: status.status === 'running',
          status: status.status,
          replicas: {
            ready: status.replicas.ready,
            desired: status.replicas.desired,
          },
        };
      }
    } catch {}

    return { running: false };
  }

  /**
   * Get total size of sandbox in bytes
   */
  async getSandboxSize(workspaceId: string): Promise<number> {
    const sandboxPath = this.getSandboxPath(workspaceId);
    if (!fs.existsSync(sandboxPath)) {
      return 0;
    }

    let totalSize = 0;

    const walkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else {
          totalSize += fs.statSync(fullPath).size;
        }
      }
    };

    try {
      walkDir(sandboxPath);
    } catch {
      // Ignore errors during size calculation
    }

    return totalSize;
  }

  /**
   * Sync sandbox to IPFS
   */
  async syncToIPFS(workspaceId: string): Promise<{ success: boolean; cid?: string; error?: string }> {
    if (!this.ipfsManager) {
      return { success: false, error: 'IPFS not configured' };
    }

    if (!this.ipfsManager.getIsRunning()) {
      return { success: false, error: 'IPFS not running' };
    }

    const sandboxPath = this.getSandboxPath(workspaceId);
    if (!fs.existsSync(sandboxPath)) {
      return { success: false, error: 'Sandbox not found' };
    }

    try {
      // Create a manifest of all files
      const manifest: Record<string, string> = {};
      const files = await this.listFilesRecursive(workspaceId);

      // Don't sync if there are no files
      if (files.length === 0 || files.every(f => f.isDirectory)) {
        return { success: false, error: 'No files to sync' };
      }

      // Add each file to IPFS and record CID
      for (const file of files) {
        if (!file.isDirectory) {
          const fullPath = path.join(sandboxPath, file.path);
          const cid = await this.ipfsManager.add(fullPath);
          manifest[file.path] = cid;
        }
      }

      // Create and add manifest
      const manifestContent = JSON.stringify({
        workspaceId,
        syncedAt: new Date().toISOString(),
        files: manifest,
      }, null, 2);

      const manifestCid = await this.ipfsManager.addContent(manifestContent, 'sandbox-manifest.json');
      await this.ipfsManager.pin(manifestCid);

      // Update meta
      const metaPath = this.getMetaPath(workspaceId);
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SandboxMeta;
        meta.lastSyncCid = manifestCid;
        meta.totalSize = await this.getSandboxSize(workspaceId);
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      }

      this.log(`Synced sandbox to IPFS: ${manifestCid}`, 'success');
      return { success: true, cid: manifestCid };
    } catch (error) {
      this.log(`Failed to sync to IPFS: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Restore sandbox from IPFS
   */
  async syncFromIPFS(workspaceId: string, manifestCid: string): Promise<{ success: boolean; error?: string }> {
    if (!this.ipfsManager) {
      return { success: false, error: 'IPFS not configured' };
    }

    if (!this.ipfsManager.getIsRunning()) {
      return { success: false, error: 'IPFS not running' };
    }

    try {
      // Get manifest
      const tempManifest = path.join(getTempPath(), `manifest-${Date.now()}.json`);
      await this.ipfsManager.get(manifestCid, tempManifest);
      const manifest = JSON.parse(fs.readFileSync(tempManifest, 'utf8'));
      fs.unlinkSync(tempManifest);

      // Ensure sandbox exists
      await this.ensureSandbox(workspaceId);
      const sandboxPath = this.getSandboxPath(workspaceId);

      // Restore each file
      for (const [relativePath, cid] of Object.entries(manifest.files)) {
        const fullPath = path.join(sandboxPath, relativePath);
        const parentDir = path.dirname(fullPath);

        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        await this.ipfsManager.get(cid as string, fullPath);
      }

      this.log(`Restored sandbox from IPFS: ${manifestCid}`, 'success');
      return { success: true };
    } catch (error) {
      this.log(`Failed to restore from IPFS: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete a sandbox
   */
  async deleteSandbox(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.validateWorkspaceId(workspaceId)) {
      return { success: false, error: 'Invalid workspace ID' };
    }

    const workspacePath = path.join(this.basePath, workspaceId);

    try {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true });
        this.log(`Deleted sandbox for workspace ${workspaceId}`, 'success');
      }
      return { success: true };
    } catch (error) {
      this.log(`Failed to delete sandbox: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  }

  /**
   * List all files recursively
   */
  private async listFilesRecursive(workspaceId: string, relativePath: string = '.'): Promise<FileInfo[]> {
    const result = await this.listFiles(workspaceId, relativePath);
    if (!result.success || !result.files) {
      return [];
    }

    const allFiles: FileInfo[] = [];

    for (const file of result.files) {
      allFiles.push(file);
      if (file.isDirectory) {
        const subFiles = await this.listFilesRecursive(workspaceId, file.path);
        allFiles.push(...subFiles);
      }
    }

    return allFiles;
  }

  /**
   * Get sandbox metadata
   */
  async getMeta(workspaceId: string): Promise<SandboxMeta | null> {
    const metaPath = this.getMetaPath(workspaceId);
    if (!fs.existsSync(metaPath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Update storage path (requires no active sandboxes)
   */
  updateStoragePath(newPath: string): void {
    this.basePath = path.join(newPath, 'otherthing-storage', 'workspaces');
  }

  private log(message: string, type: 'info' | 'success' | 'error' = 'info') {
    this.emit('log', { message: `[Sandbox] ${message}`, type });
  }
}
