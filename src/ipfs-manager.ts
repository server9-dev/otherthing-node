import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { app } from 'electron';
import * as https from 'https';
import * as zlib from 'zlib';
import * as tar from 'tar';

const execAsync = promisify(exec);

// IPFS Kubo version to download
const IPFS_VERSION = 'v0.24.0';
const IPFS_DOWNLOAD_BASE = 'https://dist.ipfs.tech/kubo';

export interface IPFSStats {
  repoSize: number;      // bytes
  numObjects: number;
  peerId: string | null;
  addresses: string[];
  isOnline: boolean;
}

export class IPFSManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private repoPath: string;
  private ipfsBinaryPath: string;
  private swarmKey: string | null = null;
  private peerId: string | null = null;
  private isInitialized = false;
  private isRunning = false;

  constructor(storagePath: string) {
    super();

    // IPFS repo lives in the user's selected storage path
    this.repoPath = path.join(storagePath, 'otherthing-storage', 'ipfs');

    // Binary is stored in userData (writable location that persists across updates)
    const userDataPath = app.getPath('userData');
    const binaryName = process.platform === 'win32' ? 'ipfs.exe' : 'ipfs';
    this.ipfsBinaryPath = path.join(userDataPath, 'bin', binaryName);
  }

  /**
   * Check if IPFS binary exists
   */
  hasBinary(): boolean {
    return fs.existsSync(this.ipfsBinaryPath);
  }

  /**
   * Get the download URL for IPFS binary based on platform
   */
  private getDownloadUrl(): string {
    const platform = process.platform;
    const arch = process.arch;

    let osName: string;
    let archName: string;

    switch (platform) {
      case 'win32':
        osName = 'windows';
        break;
      case 'darwin':
        osName = 'darwin';
        break;
      case 'linux':
        osName = 'linux';
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    switch (arch) {
      case 'x64':
        archName = 'amd64';
        break;
      case 'arm64':
        archName = 'arm64';
        break;
      default:
        throw new Error(`Unsupported architecture: ${arch}`);
    }

    const ext = platform === 'win32' ? 'zip' : 'tar.gz';
    return `${IPFS_DOWNLOAD_BASE}/${IPFS_VERSION}/kubo_${IPFS_VERSION}_${osName}-${archName}.${ext}`;
  }

  /**
   * Download and install IPFS binary if not present
   */
  async downloadBinary(onProgress?: (percent: number) => void): Promise<void> {
    if (this.hasBinary()) {
      this.emit('log', { message: 'IPFS binary already exists', type: 'info' });
      return;
    }

    const url = this.getDownloadUrl();
    const isZip = url.endsWith('.zip');
    const tempDir = app.getPath('temp');
    const downloadPath = path.join(tempDir, `ipfs-download-${Date.now()}${isZip ? '.zip' : '.tar.gz'}`);

    this.emit('log', { message: `Downloading IPFS from ${url}...`, type: 'info' });

    // Download the file
    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(downloadPath);

      const request = (urlStr: string) => {
        https.get(urlStr, { headers: { 'User-Agent': 'OtherThing-Node' } }, (response) => {
          // Handle redirects
          if (response.statusCode === 302 || response.statusCode === 301) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              request(redirectUrl);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Download failed with status ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloadedSize = 0;

          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            if (totalSize > 0 && onProgress) {
              onProgress(Math.round((downloadedSize / totalSize) * 100));
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(downloadPath, () => {});
          reject(err);
        });
      };

      request(url);
    });

    this.emit('log', { message: 'Download complete, extracting...', type: 'info' });

    // Create the bin directory in userData (writable location)
    const ipfsDir = path.dirname(this.ipfsBinaryPath);
    if (!fs.existsSync(ipfsDir)) {
      fs.mkdirSync(ipfsDir, { recursive: true });
    }

    // Extract the binary
    if (isZip) {
      // For Windows, use unzip (or implement zip extraction)
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(downloadPath);
      const entries = zip.getEntries();

      for (const entry of entries) {
        if (entry.entryName.endsWith('ipfs.exe')) {
          zip.extractEntryTo(entry, ipfsDir, false, true);
          break;
        }
      }
    } else {
      // For Unix, extract tar.gz
      await tar.x({
        file: downloadPath,
        cwd: tempDir,
      });

      // Find and move the binary
      const extractedDir = path.join(tempDir, 'kubo');
      const binaryName = process.platform === 'win32' ? 'ipfs.exe' : 'ipfs';
      const extractedBinary = path.join(extractedDir, binaryName);

      if (fs.existsSync(extractedBinary)) {
        fs.copyFileSync(extractedBinary, this.ipfsBinaryPath);
        fs.chmodSync(this.ipfsBinaryPath, 0o755);
      }

      // Cleanup extracted directory
      fs.rmSync(extractedDir, { recursive: true, force: true });
    }

    // Cleanup download file
    fs.unlinkSync(downloadPath);

    if (this.hasBinary()) {
      this.emit('log', { message: 'IPFS binary installed successfully', type: 'success' });
    } else {
      throw new Error('Failed to extract IPFS binary');
    }
  }

  /**
   * Initialize IPFS repo if it doesn't exist
   */
  async init(): Promise<void> {
    if (!this.hasBinary()) {
      throw new Error(`IPFS binary not found at ${this.ipfsBinaryPath}`);
    }

    // Create storage directory if needed
    const storageDir = path.dirname(this.repoPath);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // Check if already initialized
    const configPath = path.join(this.repoPath, 'config');
    if (fs.existsSync(configPath)) {
      this.isInitialized = true;
      this.emit('log', { message: 'IPFS repo already initialized', type: 'info' });
      return;
    }

    // Initialize IPFS repo
    this.emit('log', { message: 'Initializing IPFS repo...', type: 'info' });

    try {
      await this.runCommand(['init', '--profile=lowpower']);
      this.isInitialized = true;

      // Configure for private network mode
      await this.configureForPrivateNetwork();

      this.emit('log', { message: 'IPFS repo initialized', type: 'success' });
    } catch (error) {
      this.emit('log', { message: `IPFS init failed: ${error}`, type: 'error' });
      throw error;
    }
  }

  /**
   * Configure IPFS for private network operation
   */
  private async configureForPrivateNetwork(): Promise<void> {
    // Disable public bootstrap nodes
    await this.runCommand(['bootstrap', 'rm', '--all']);

    // Disable DHT (we'll use direct connections only)
    await this.runCommand(['config', 'Routing.Type', 'none']);

    // Disable mDNS discovery (only connect to workspace peers)
    await this.runCommand(['config', 'Discovery.MDNS.Enabled', 'false', '--json']);

    // Reduce resource usage
    await this.runCommand(['config', 'Swarm.ConnMgr.LowWater', '10', '--json']);
    await this.runCommand(['config', 'Swarm.ConnMgr.HighWater', '50', '--json']);

    // Enable relay for NAT traversal
    await this.runCommand(['config', 'Swarm.RelayClient.Enabled', 'true', '--json']);

    this.emit('log', { message: 'Configured for private network', type: 'info' });
  }

  /**
   * Set storage limit for IPFS datastore
   * @param limitGb Storage limit in gigabytes
   */
  async setStorageLimit(limitGb: number): Promise<void> {
    if (!this.hasBinary()) {
      throw new Error('IPFS binary not found');
    }

    const limitStr = `${limitGb}GB`;
    await this.runCommand(['config', 'Datastore.StorageMax', limitStr]);
    this.emit('log', { message: `IPFS storage limit set to ${limitStr}`, type: 'success' });
  }

  /**
   * Get current storage limit
   */
  async getStorageLimit(): Promise<number | null> {
    if (!this.hasBinary()) {
      return null;
    }

    try {
      const result = await this.runCommand(['config', 'Datastore.StorageMax']);
      const limitStr = result.trim();
      // Parse "10GB" format
      const match = limitStr.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B)?$/i);
      if (match) {
        const value = parseFloat(match[1]);
        const unit = (match[2] || 'B').toUpperCase();
        switch (unit) {
          case 'KB': return value / (1024 * 1024);
          case 'MB': return value / 1024;
          case 'GB': return value;
          case 'TB': return value * 1024;
          default: return value / (1024 * 1024 * 1024);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Set the swarm key for workspace isolation
   */
  async setSwarmKey(key: string): Promise<void> {
    this.swarmKey = key;

    // Write swarm key file
    const swarmKeyPath = path.join(this.repoPath, 'swarm.key');
    const swarmKeyContent = `/key/swarm/psk/1.0.0/\n/base16/\n${key}`;

    fs.writeFileSync(swarmKeyPath, swarmKeyContent);
    this.emit('log', { message: 'Swarm key set', type: 'success' });
  }

  /**
   * Start the IPFS daemon
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.emit('log', { message: 'IPFS already running', type: 'info' });
      return;
    }

    if (!this.isInitialized) {
      await this.init();
    }

    this.emit('log', { message: 'Starting IPFS daemon...', type: 'info' });

    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, IPFS_PATH: this.repoPath };

      // Add LIBP2P_FORCE_PNET=1 to enforce private network
      if (this.swarmKey) {
        env['LIBP2P_FORCE_PNET'] = '1';
      }

      this.process = spawn(this.ipfsBinaryPath, ['daemon', '--enable-gc'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let started = false;

      this.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();

        // Check for successful startup
        if (output.includes('Daemon is ready')) {
          started = true;
          this.isRunning = true;
          this.emit('log', { message: 'IPFS daemon started', type: 'success' });
          this.emit('started');
          this.fetchPeerId();
          resolve();
        }

        // Log API address
        if (output.includes('API server listening on')) {
          const match = output.match(/API server listening on (.+)/);
          if (match) {
            this.emit('log', { message: `IPFS API: ${match[1]}`, type: 'info' });
          }
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const error = data.toString();
        // Ignore some common non-error messages
        if (!error.includes('Swarm listening on')) {
          this.emit('log', { message: `IPFS: ${error.trim()}`, type: 'info' });
        }
      });

      this.process.on('error', (err) => {
        this.emit('log', { message: `IPFS process error: ${err}`, type: 'error' });
        if (!started) {
          reject(err);
        }
      });

      this.process.on('exit', (code) => {
        this.isRunning = false;
        this.emit('log', { message: `IPFS daemon exited with code ${code}`, type: 'info' });
        this.emit('stopped');

        if (!started) {
          reject(new Error(`IPFS daemon exited with code ${code}`));
        }
      });

      // Timeout for startup
      setTimeout(() => {
        if (!started) {
          this.process?.kill();
          reject(new Error('IPFS daemon startup timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Stop the IPFS daemon
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.process) {
      return;
    }

    this.emit('log', { message: 'Stopping IPFS daemon...', type: 'info' });

    return new Promise((resolve) => {
      const proc = this.process;
      if (!proc) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 5000);

      proc.once('exit', () => {
        clearTimeout(timeout);
        this.isRunning = false;
        this.process = null;
        resolve();
      });

      // Graceful shutdown
      proc.kill('SIGTERM');
    });
  }

  /**
   * Add a file to IPFS
   */
  async add(filePath: string): Promise<string> {
    if (!this.isRunning) {
      throw new Error('IPFS daemon not running');
    }

    const result = await this.runCommand(['add', '-Q', filePath]);
    const cid = result.trim();
    this.emit('log', { message: `Added ${path.basename(filePath)}: ${cid}`, type: 'success' });
    return cid;
  }

  /**
   * Add content from buffer/string
   */
  async addContent(content: Buffer | string, filename?: string): Promise<string> {
    if (!this.isRunning) {
      throw new Error('IPFS daemon not running');
    }

    // Write to temp file and add
    const tempDir = app.getPath('temp');
    const tempPath = path.join(tempDir, filename || `ipfs-add-${Date.now()}`);
    fs.writeFileSync(tempPath, content);

    try {
      const cid = await this.add(tempPath);
      return cid;
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get content by CID
   */
  async get(cid: string, outputPath: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('IPFS daemon not running');
    }

    await this.runCommand(['get', cid, '-o', outputPath]);
    this.emit('log', { message: `Retrieved ${cid}`, type: 'success' });
  }

  /**
   * Pin content
   */
  async pin(cid: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('IPFS daemon not running');
    }

    await this.runCommand(['pin', 'add', cid]);
    this.emit('log', { message: `Pinned ${cid}`, type: 'success' });
  }

  /**
   * Unpin content
   */
  async unpin(cid: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('IPFS daemon not running');
    }

    await this.runCommand(['pin', 'rm', cid]);
    this.emit('log', { message: `Unpinned ${cid}`, type: 'info' });
  }

  /**
   * Connect to a peer
   */
  async connectPeer(multiaddr: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('IPFS daemon not running');
    }

    try {
      await this.runCommand(['swarm', 'connect', multiaddr]);
      this.emit('log', { message: `Connected to peer`, type: 'success' });
    } catch (error) {
      this.emit('log', { message: `Failed to connect to peer: ${error}`, type: 'error' });
    }
  }

  /**
   * Get peer ID
   */
  private async fetchPeerId(): Promise<void> {
    try {
      const result = await this.runCommand(['id', '-f', '<id>']);
      this.peerId = result.trim();
      this.emit('log', { message: `Peer ID: ${this.peerId}`, type: 'info' });
    } catch (error) {
      // Ignore - might not be fully started yet
    }
  }

  /**
   * Get IPFS stats
   */
  async getStats(): Promise<IPFSStats> {
    const stats: IPFSStats = {
      repoSize: 0,
      numObjects: 0,
      peerId: this.peerId,
      addresses: [],
      isOnline: this.isRunning,
    };

    if (!this.isRunning) {
      return stats;
    }

    try {
      // Get repo stats
      const repoStats = await this.runCommand(['repo', 'stat']);
      const sizeMatch = repoStats.match(/RepoSize:\s+(\d+)/);
      if (sizeMatch) {
        stats.repoSize = parseInt(sizeMatch[1]);
      }
      const objMatch = repoStats.match(/NumObjects:\s+(\d+)/);
      if (objMatch) {
        stats.numObjects = parseInt(objMatch[1]);
      }

      // Get addresses
      const idInfo = await this.runCommand(['id']);
      const idJson = JSON.parse(idInfo);
      stats.addresses = idJson.Addresses || [];
      stats.peerId = idJson.ID;

    } catch (error) {
      // Partial stats are fine
    }

    return stats;
  }

  /**
   * Run an IPFS command
   */
  private async runCommand(args: string[]): Promise<string> {
    const env = { ...process.env, IPFS_PATH: this.repoPath };
    const cmd = `"${this.ipfsBinaryPath}" ${args.map(a => `"${a}"`).join(' ')}`;

    const { stdout, stderr } = await execAsync(cmd, { env, timeout: 60000 });

    if (stderr && !stderr.includes('Swarm')) {
      // Some stderr is normal (like swarm listening messages)
    }

    return stdout;
  }

  /**
   * Get running status
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get peer ID
   */
  getPeerId(): string | null {
    return this.peerId;
  }

  /**
   * Get repo path
   */
  getRepoPath(): string {
    return this.repoPath;
  }

  /**
   * Update storage path (requires restart)
   */
  updateStoragePath(newPath: string): void {
    if (this.isRunning) {
      throw new Error('Cannot change storage path while IPFS is running');
    }
    this.repoPath = path.join(newPath, 'otherthing-storage', 'ipfs');
    this.isInitialized = false;
  }
}
