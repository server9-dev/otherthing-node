import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { IPFSManager } from './ipfs-manager';

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

  constructor(storagePath: string) {
    super();
    this.basePath = path.join(storagePath, 'otherthing-storage', 'workspaces');
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
      const tempManifest = path.join(app.getPath('temp'), `manifest-${Date.now()}.json`);
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
