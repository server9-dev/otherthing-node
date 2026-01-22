import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { EventEmitter } from 'events';
import { app } from 'electron';

const execAsync = promisify(exec);

// Ollama download URLs
const OLLAMA_WINDOWS_URL = 'https://ollama.com/download/OllamaSetup.exe';
const OLLAMA_LINUX_INSTALL = 'https://ollama.com/install.sh';

export interface OllamaModel {
  name: string;
  size: number; // bytes
  quantization?: string;
  family?: string;
  parameterSize?: string;
  modifiedAt?: string;
}

export interface OllamaStatus {
  installed: boolean;
  version?: string;
  running: boolean;
  models: OllamaModel[];
  endpoint?: string;
}

export class OllamaManager extends EventEmitter {
  private ollamaPath: string | null = null;
  private isRunning = false;
  private process: ChildProcess | null = null;

  constructor() {
    super();
    this.detectOllamaPath();
  }

  /**
   * Detect where Ollama is installed
   */
  private async detectOllamaPath(): Promise<void> {
    const platform = process.platform;

    // Common paths to check
    const possiblePaths: string[] = [];

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
      const userProfile = process.env.USERPROFILE || '';

      possiblePaths.push(
        // Standard Ollama install locations
        path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
        path.join(localAppData, 'Ollama', 'ollama.exe'),
        path.join(programFiles, 'Ollama', 'ollama.exe'),
        path.join(userProfile, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
        path.join(userProfile, 'AppData', 'Local', 'Ollama', 'ollama.exe'),
        'C:\\Program Files\\Ollama\\ollama.exe',
        'C:\\Ollama\\ollama.exe',
        // Also check if ollama is in the user's path
        path.join(userProfile, '.ollama', 'ollama.exe'),
      );
    } else if (platform === 'darwin') {
      possiblePaths.push(
        '/usr/local/bin/ollama',
        '/opt/homebrew/bin/ollama',
        path.join(process.env.HOME || '', '.ollama', 'ollama'),
      );
    } else {
      possiblePaths.push(
        '/usr/local/bin/ollama',
        '/usr/bin/ollama',
        path.join(process.env.HOME || '', '.ollama', 'ollama'),
      );
    }

    for (const p of possiblePaths) {
      if (p && fs.existsSync(p)) {
        this.ollamaPath = p;
        this.emit('log', { message: `Found Ollama at ${p}`, type: 'info' });
        return;
      }
    }

    // Try to find via PATH using 'where' on Windows (with timeout)
    try {
      const { stdout } = await execAsync(
        platform === 'win32' ? 'where ollama 2>nul' : 'which ollama',
        { timeout: 5000 }  // 5 second timeout to prevent hanging
      );
      const foundPath = stdout.trim().split('\n')[0].trim();
      if (foundPath && fs.existsSync(foundPath)) {
        this.ollamaPath = foundPath;
        this.emit('log', { message: `Found Ollama in PATH: ${foundPath}`, type: 'info' });
      }
    } catch {
      // Not found in PATH or timed out
    }
  }

  /**
   * Check if Ollama is installed
   */
  isInstalled(): boolean {
    return this.ollamaPath !== null;
  }

  /**
   * Get Ollama version
   */
  async getVersion(): Promise<string | null> {
    if (!this.ollamaPath) return null;

    try {
      const { stdout } = await execAsync(`"${this.ollamaPath}" --version`);
      // Output is like "ollama version 0.1.27"
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Check if Ollama server is running
   */
  async checkRunning(): Promise<boolean> {
    // Try multiple endpoints (localhost, and common WSL2/Docker hosts)
    const endpoints = [
      'http://127.0.0.1:11434',
      'http://localhost:11434',
      'http://host.docker.internal:11434',
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${endpoint}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          this.isRunning = true;
          this.ollamaEndpoint = endpoint;
          return true;
        }
      } catch {
        // Try next endpoint
      }
    }

    this.isRunning = false;
    return false;
  }

  // Store the working endpoint
  private ollamaEndpoint = 'http://127.0.0.1:11434';

  /**
   * Get list of installed models
   */
  async getModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return [];

      const data = await response.json() as { models?: any[] };
      if (!data.models) return [];

      return data.models.map((m: any) => ({
        name: m.name,
        size: m.size || 0,
        modifiedAt: m.modified_at,
        family: m.details?.family,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get the host address for Ollama endpoint.
   *
   * For local development with WSL, we use 'localhost' because WSL2 has
   * localhost forwarding that automatically routes localhost to the Windows host.
   * This is simpler and more reliable than trying to detect external IPs.
   *
   * For production/remote scenarios, we could detect external IPs, but
   * that would also require Ollama to be configured to listen on 0.0.0.0.
   */
  private getAccessibleHost(): string {
    // For WSL compatibility, localhost works because of WSL2 localhost forwarding
    // This is the simplest and most reliable approach
    return 'localhost';
  }

  /**
   * Get full status
   */
  async getStatus(): Promise<OllamaStatus> {
    await this.detectOllamaPath();
    const running = await this.checkRunning();

    // Use externally accessible IP so WSL/other machines can connect
    const host = this.getAccessibleHost();
    const endpoint = running ? `http://${host}:11434` : undefined;

    return {
      installed: this.isInstalled(),
      version: await this.getVersion() || undefined,
      running,
      models: running ? await this.getModels() : [],
      endpoint,
    };
  }

  /**
   * Start Ollama server
   */
  async start(): Promise<void> {
    if (!this.ollamaPath) {
      throw new Error('Ollama not installed');
    }

    // Check if already running
    if (await this.checkRunning()) {
      this.emit('log', { message: 'Ollama already running', type: 'info' });
      return;
    }

    this.emit('log', { message: 'Starting Ollama server...', type: 'info' });

    // Start Ollama serve in background
    // Set OLLAMA_HOST to 0.0.0.0 so it listens on all interfaces (needed for WSL access)
    const env = {
      ...process.env,
      OLLAMA_HOST: '0.0.0.0:11434',
    };

    this.process = spawn(this.ollamaPath, ['serve'], {
      detached: true,
      stdio: 'ignore',
      env,
    });

    this.process.unref();

    // Wait for server to be ready
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (await this.checkRunning()) {
        this.emit('log', { message: 'Ollama server started', type: 'success' });
        return;
      }
    }

    throw new Error('Ollama server failed to start');
  }

  /**
   * Stop Ollama server (if we started it)
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isRunning = false;
  }

  /**
   * Pull a model
   */
  async pullModel(modelName: string, onProgress?: (status: string, percent?: number) => void): Promise<void> {
    if (!await this.checkRunning()) {
      throw new Error('Ollama server not running');
    }

    this.emit('log', { message: `Pulling model ${modelName}...`, type: 'info' });

    const response = await fetch('http://127.0.0.1:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.status) {
            let percent: number | undefined;
            if (data.completed && data.total) {
              percent = Math.round((data.completed / data.total) * 100);
            }
            onProgress?.(data.status, percent);
            this.emit('pullProgress', { model: modelName, status: data.status, percent });
          }
          if (data.error) {
            throw new Error(data.error);
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }

    this.emit('log', { message: `Model ${modelName} pulled successfully`, type: 'success' });
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<void> {
    if (!await this.checkRunning()) {
      throw new Error('Ollama server not running');
    }

    const response = await fetch('http://127.0.0.1:11434/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete model: ${response.statusText}`);
    }

    this.emit('log', { message: `Model ${modelName} deleted`, type: 'success' });
  }

  /**
   * Download and install Ollama
   */
  async install(onProgress?: (percent: number) => void): Promise<void> {
    const platform = process.platform;

    if (platform === 'win32') {
      await this.installWindows(onProgress);
    } else if (platform === 'linux') {
      await this.installLinux(onProgress);
    } else if (platform === 'darwin') {
      throw new Error('Please install Ollama from https://ollama.com/download');
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // Re-detect after installation
    await this.detectOllamaPath();
  }

  /**
   * Install Ollama on Windows - downloads and runs installer visibly
   */
  private async installWindows(onProgress?: (percent: number) => void): Promise<void> {
    // First check if Ollama is already installed
    await this.detectOllamaPath();
    if (this.isInstalled()) {
      this.emit('log', { message: 'Ollama is already installed - skipping download', type: 'success' });
      onProgress?.(100);
      return;
    }

    const tempDir = app.getPath('temp');
    const installerPath = path.join(tempDir, 'OllamaSetup.exe');

    this.emit('log', { message: 'Downloading Ollama installer...', type: 'info' });
    onProgress?.(5);

    // Use curl.exe which is built into Windows 10/11
    const downloadCmd = `curl.exe -L -o "${installerPath}" "${OLLAMA_WINDOWS_URL}"`;

    try {
      this.emit('log', { message: 'Downloading (~250MB, please wait)...', type: 'info' });
      onProgress?.(10);

      await execAsync(downloadCmd, {
        timeout: 600000,  // 10 minute timeout for large download
        windowsHide: true
      });
      onProgress?.(50);
    } catch (error) {
      // Try alternative with PowerShell if curl fails
      this.emit('log', { message: 'Trying alternative download method...', type: 'info' });
      try {
        const psCmd = `powershell -Command "& {$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${OLLAMA_WINDOWS_URL}' -OutFile '${installerPath}'}"`;
        await execAsync(psCmd, { timeout: 600000 });
        onProgress?.(50);
      } catch (psError) {
        throw new Error(`Failed to download Ollama: ${error}`);
      }
    }

    // Verify download
    if (!fs.existsSync(installerPath)) {
      throw new Error('Download failed - installer file not found');
    }

    const stats = fs.statSync(installerPath);
    if (stats.size < 1000000) { // Less than 1MB means download failed
      fs.unlinkSync(installerPath);
      throw new Error('Download incomplete - file too small');
    }

    this.emit('log', { message: 'Launching Ollama installer - please complete the installation...', type: 'info' });
    onProgress?.(60);

    // Open the installer using shell - this shows the full installer UI
    const { shell } = require('electron');
    shell.openPath(installerPath);

    // Wait for user to complete installation (they need to click through the installer)
    this.emit('log', { message: 'Waiting for you to complete the Ollama installer...', type: 'info' });

    // Poll for Ollama to be installed (check every 3 seconds for up to 3 minutes)
    let installed = false;
    this.emit('log', { message: 'Polling for Ollama installation (up to 3 minutes)...', type: 'info' });

    for (let i = 0; i < 60; i++) {  // Reduced from 100 to 60 (3 minutes)
      await new Promise(resolve => setTimeout(resolve, 3000));

      try {
        await this.detectOllamaPath();
        if (this.isInstalled()) {
          installed = true;
          this.emit('log', { message: 'Ollama detected during polling!', type: 'success' });
          break;
        }
      } catch (e) {
        // Detection failed, continue polling
      }

      // Update progress slowly while waiting (60-85%)
      onProgress?.(60 + Math.min(Math.floor(i / 2), 25));
    }

    this.emit('log', { message: `Polling complete. Installed: ${installed}`, type: 'info' });
    onProgress?.(88);

    // Cleanup installer
    try {
      if (fs.existsSync(installerPath)) {
        fs.unlinkSync(installerPath);
        this.emit('log', { message: 'Installer cleanup complete', type: 'info' });
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    onProgress?.(92);

    // Wait a moment for installation to finalize
    await new Promise(resolve => setTimeout(resolve, 1500));

    onProgress?.(95);

    // Final detection attempt
    try {
      await this.detectOllamaPath();
    } catch (e) {
      this.emit('log', { message: 'Final detection attempt failed, but continuing', type: 'info' });
    }

    onProgress?.(98);

    // If not found, it's ok - user can set path manually
    if (this.isInstalled()) {
      onProgress?.(100);
      this.emit('log', { message: 'Ollama installed successfully', type: 'success' });
    } else {
      onProgress?.(100);
      this.emit('log', { message: 'Ollama installer completed - please set the path if not auto-detected', type: 'info' });
      // Don't throw - let the wizard continue and user can set path manually
    }
  }

  /**
   * Manually set Ollama path (for when auto-detection fails)
   */
  setOllamaPath(ollamaPath: string): boolean {
    if (fs.existsSync(ollamaPath)) {
      this.ollamaPath = ollamaPath;
      this.emit('log', { message: `Ollama path set to: ${ollamaPath}`, type: 'success' });
      return true;
    }
    return false;
  }

  /**
   * Get current Ollama path
   */
  getOllamaPath(): string | null {
    return this.ollamaPath;
  }

  /**
   * Install Ollama on Linux
   */
  private async installLinux(onProgress?: (percent: number) => void): Promise<void> {
    this.emit('log', { message: 'Installing Ollama via install script...', type: 'info' });

    try {
      // Download and run the install script
      const { stdout, stderr } = await execAsync('curl -fsSL https://ollama.com/install.sh | sh', {
        timeout: 300000,
      });

      this.emit('log', { message: 'Ollama install script completed', type: 'info' });
    } catch (error) {
      throw new Error(`Ollama installation failed: ${error}`);
    }

    // Re-detect
    await this.detectOllamaPath();

    if (!this.isInstalled()) {
      throw new Error('Ollama installation failed');
    }

    this.emit('log', { message: 'Ollama installed successfully', type: 'success' });
  }

  /**
   * Get Ollama path
   */
  getPath(): string | null {
    return this.ollamaPath;
  }
}
