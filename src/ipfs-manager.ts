import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { app } from 'electron';

const execAsync = promisify(exec);

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

    // Binary is in app resources
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
    const binaryName = process.platform === 'win32' ? 'ipfs.exe' : 'ipfs';
    this.ipfsBinaryPath = path.join(resourcesPath, 'ipfs', binaryName);
  }

  /**
   * Check if IPFS binary exists
   */
  hasBinary(): boolean {
    return fs.existsSync(this.ipfsBinaryPath);
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
