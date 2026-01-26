/**
 * Unified API bridge that works with both Electron and Tauri
 * In Tauri mode, uses the sidecar REST API at localhost:8080
 */

// Detect if we're running in Tauri or if electronAPI is missing (use REST API as fallback)
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
const hasElectronAPI = typeof window !== 'undefined' && 'electronAPI' in window && (window as any).electronAPI;

// Use REST API if in Tauri OR if electronAPI is not available
const useRestApi = isTauri || !hasElectronAPI;

console.log('[API Bridge] Initializing, isTauri:', isTauri, 'hasElectronAPI:', hasElectronAPI, 'useRestApi:', useRestApi);

// Lazy load Tauri APIs only when needed
let tauriWindow: any = null;
let tauriShell: any = null;

async function getTauriWindow() {
  if (!tauriWindow && isTauri) {
    tauriWindow = await import('@tauri-apps/api/window');
  }
  return tauriWindow;
}

async function getTauriShell() {
  if (!tauriShell && isTauri) {
    tauriShell = await import('@tauri-apps/plugin-shell');
  }
  return tauriShell;
}

// Sidecar API base URL
const SIDECAR_API = 'http://localhost:8080/api/v1';

// Types
interface ResourceLimits {
  cpuCores?: number;
  ramPercent?: number;
  storageGb?: number;
  gpuVramPercent?: number[];
}

interface DriveInfo {
  mount: string;
  label: string;
  type: string;
  size_gb: number;
  available_gb: number;
  used_percent: number;
}

interface CommandResult {
  success: boolean;
  error?: string;
}

interface NodeStatus {
  running: boolean;
  connected: boolean;
  node_id: string | null;
  share_key: string | null;
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: any[];
}

interface IpfsStatus {
  running: boolean;
  has_binary: boolean;
  peer_id: string | null;
  stats: any | null;
}

// Helper for REST calls
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${SIDECAR_API}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }
  return response.json();
}

// The unified API
export const api = {
  // Platform detection
  isTauri,
  isElectron: !isTauri && typeof window !== 'undefined' && 'electronAPI' in window,

  // ============ Hardware ============

  async getHardware() {
    if (useRestApi) {
      try {
        return await fetchApi('/hardware');
      } catch (err) {
        console.error('Hardware detection error:', err);
        return null;
      }
    }
    return (window as any).electronAPI.getHardware();
  },

  async getDetectedHardware() {
    if (useRestApi) {
      try {
        return await fetchApi('/hardware');
      } catch (err) {
        console.error('Hardware detection error:', err);
        return null;
      }
    }
    return (window as any).electronAPI.getDetectedHardware();
  },

  async getDrives(): Promise<DriveInfo[]> {
    if (useRestApi) {
      try {
        return await fetchApi('/drives');
      } catch (err) {
        console.error('Drive detection error:', err);
        return [];
      }
    }
    return (window as any).electronAPI.getDrives();
  },

  // ============ Node Status ============

  async getNodeStatus(): Promise<NodeStatus> {
    if (useRestApi) {
      try {
        // Health endpoint is at root, not under /api/v1
        const response = await fetch('http://localhost:8080/health');
        const health = await response.json();
        return {
          running: health.status === 'ok',
          connected: true,
          node_id: 'local-node',
          share_key: health.shareKey || null,
        };
      } catch {
        return { running: false, connected: false, node_id: null, share_key: null };
      }
    }
    return (window as any).electronAPI.getNodeStatus();
  },

  async startNode(config: { orchestratorUrl?: string; workspaceIds: string[] }): Promise<CommandResult> {
    if (useRestApi) {
      // Node is already running as sidecar
      return { success: true };
    }
    return (window as any).electronAPI.startNode(config);
  },

  async stopNode(): Promise<CommandResult> {
    if (useRestApi) {
      // Can't stop sidecar from frontend
      return { success: true };
    }
    return (window as any).electronAPI.stopNode();
  },

  // ============ Network ============

  async connectToNetwork(config: { url?: string; workspaceIds?: string[] }): Promise<CommandResult> {
    if (useRestApi) {
      // Network managed by sidecar
      return { success: true };
    }
    return (window as any).electronAPI.connectToNetwork(config);
  },

  async disconnectFromNetwork(): Promise<CommandResult> {
    if (useRestApi) {
      return { success: true };
    }
    return (window as any).electronAPI.disconnectFromNetwork();
  },

  async isNetworkConnected(): Promise<boolean> {
    if (useRestApi) {
      try {
        const response = await fetch('http://localhost:8080/health');
        return response.ok;
      } catch {
        return false;
      }
    }
    return (window as any).electronAPI.isNetworkConnected();
  },

  // ============ Ollama ============

  async getOllamaStatus(): Promise<OllamaStatus> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/status');
      } catch (err) {
        console.error('Ollama status error:', err);
        return { installed: false, running: false, models: [] };
      }
    }
    return (window as any).electronAPI.getOllamaStatus();
  },

  async startOllama(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/start', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.startOllama();
  },

  async stopOllama(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/stop', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.stopOllama();
  },

  async getOllamaModels(): Promise<any[]> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/models');
      } catch {
        return [];
      }
    }
    return (window as any).electronAPI.getOllamaModels();
  },

  async pullOllamaModel(modelName: string): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/pull', {
          method: 'POST',
          body: JSON.stringify({ model: modelName }),
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.pullOllamaModel(modelName);
  },

  async deleteOllamaModel(modelName: string): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi(`/ollama/models/${encodeURIComponent(modelName)}`, {
          method: 'DELETE',
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.deleteOllamaModel(modelName);
  },

  async setOllamaPath(path: string): Promise<CommandResult> {
    if (useRestApi) {
      // TODO: Add endpoint if needed
      return { success: true };
    }
    return (window as any).electronAPI.setOllamaPath(path);
  },

  async getOllamaPath(): Promise<string | null> {
    if (useRestApi) {
      return null;
    }
    return (window as any).electronAPI.getOllamaPath();
  },

  async installOllama(): Promise<CommandResult> {
    if (useRestApi) {
      // Ollama should be installed manually in Tauri mode
      return { success: false, error: 'Please install Ollama manually from ollama.ai' };
    }
    return (window as any).electronAPI.installOllama();
  },

  onOllamaPullProgress(callback: (data: any) => void) {
    if (useRestApi) {
      // No-op in Tauri mode - pull progress not yet implemented
    } else if ((window as any).electronAPI?.onOllamaPullProgress) {
      (window as any).electronAPI.onOllamaPullProgress(callback);
    }
  },

  onOllamaInstallProgress(callback: (percent: number) => void) {
    if (useRestApi) {
      // No-op in Tauri mode
    } else if ((window as any).electronAPI?.onOllamaInstallProgress) {
      (window as any).electronAPI.onOllamaInstallProgress(callback);
    }
  },

  async browseForFile(options?: any): Promise<string | null> {
    if (useRestApi) {
      // TODO: Implement file dialog for Tauri
      return null;
    }
    return (window as any).electronAPI.browseForFile(options);
  },

  // ============ IPFS ============

  async getIPFSStatus(): Promise<IpfsStatus> {
    if (useRestApi) {
      try {
        const data = await fetchApi<any>('/ipfs/status');
        // Transform property names to match what components expect
        return {
          running: data.running,
          hasBinary: data.has_binary,
          peerId: data.peer_id,
          stats: data.stats,
        } as any;
      } catch (err) {
        console.error('IPFS status error:', err);
        return { running: false, hasBinary: false, peerId: null, stats: null } as any;
      }
    }
    return (window as any).electronAPI.getIPFSStatus();
  },

  async startIPFS(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ipfs/start', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.startIPFS();
  },

  async stopIPFS(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ipfs/stop', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.stopIPFS();
  },

  async ipfsAddContent(content: string): Promise<{ success: boolean; cid?: string; error?: string }> {
    if (useRestApi) {
      try {
        const result = await fetchApi<{ success: boolean; cid: string }>('/ipfs/add', {
          method: 'POST',
          body: JSON.stringify({ content }),
        });
        return result;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.ipfsAddContent(content);
  },

  async ipfsPin(cid: string): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi(`/ipfs/pin/${encodeURIComponent(cid)}`, { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.ipfsPin(cid);
  },

  async ipfsUnpin(cid: string): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi(`/ipfs/pin/${encodeURIComponent(cid)}`, { method: 'DELETE' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.ipfsUnpin(cid);
  },

  async downloadIPFSBinary(): Promise<CommandResult> {
    if (useRestApi) {
      // IPFS binary should be bundled or downloaded separately in Tauri
      return { success: false, error: 'Please install IPFS manually' };
    }
    return (window as any).electronAPI.downloadIPFSBinary();
  },

  async getIPFSStorageLimit(): Promise<number | null> {
    if (useRestApi) {
      return 50; // Default 50GB
    }
    return (window as any).electronAPI.getIPFSStorageLimit?.() || 50;
  },

  async setIPFSStorageLimit(limit: number): Promise<CommandResult> {
    if (useRestApi) {
      // TODO: Implement storage limit setting
      return { success: true };
    }
    return (window as any).electronAPI.setIPFSStorageLimit?.(limit) || { success: true };
  },

  onIPFSDownloadProgress(callback: (percent: number) => void) {
    if (useRestApi) {
      // No-op in Tauri mode
    } else if ((window as any).electronAPI?.onIPFSDownloadProgress) {
      (window as any).electronAPI.onIPFSDownloadProgress(callback);
    }
  },

  // ============ Window Controls (Tauri native) ============

  async minimizeWindow() {
    if (useRestApi) {
      const { getCurrentWindow } = await getTauriWindow();
      const win = getCurrentWindow();
      return win.minimize();
    }
    return (window as any).electronAPI.minimizeWindow();
  },

  async maximizeWindow() {
    if (useRestApi) {
      const { getCurrentWindow } = await getTauriWindow();
      const win = getCurrentWindow();
      const isMaximized = await win.isMaximized();
      return isMaximized ? win.unmaximize() : win.maximize();
    }
    return (window as any).electronAPI.maximizeWindow();
  },

  async closeWindow() {
    if (useRestApi) {
      const { getCurrentWindow } = await getTauriWindow();
      const win = getCurrentWindow();
      return win.close();
    }
    return (window as any).electronAPI.closeWindow();
  },

  async toggleFullscreen() {
    if (useRestApi) {
      const { getCurrentWindow } = await getTauriWindow();
      const win = getCurrentWindow();
      const isFullscreen = await win.isFullscreen();
      return win.setFullscreen(!isFullscreen);
    }
    return (window as any).electronAPI.toggleFullscreen();
  },

  async isFullscreen(): Promise<boolean> {
    if (useRestApi) {
      const { getCurrentWindow } = await getTauriWindow();
      const win = getCurrentWindow();
      return win.isFullscreen();
    }
    return (window as any).electronAPI.isFullscreen();
  },

  // ============ External Links ============

  async openDashboard() {
    if (useRestApi) {
      const { open } = await getTauriShell();
      await open('http://155.117.46.228');
      return;
    }
    return (window as any).electronAPI.openDashboard();
  },

  // ============ Event Subscriptions ============
  // For Tauri, we'll poll the API instead of using events

  onNodeStatus(callback: (status: any) => void) {
    if (useRestApi) {
      // Poll every 5 seconds
      const poll = async () => {
        try {
          const status = await api.getNodeStatus();
          callback(status);
        } catch {}
      };
      poll();
      setInterval(poll, 5000);
    } else {
      (window as any).electronAPI.onNodeStatus(callback);
    }
  },

  onOllamaStatusChange(callback: (status: any) => void) {
    if (useRestApi) {
      const poll = async () => {
        try {
          const status = await api.getOllamaStatus();
          callback(status);
        } catch {}
      };
      poll();
      setInterval(poll, 5000);
    } else {
      (window as any).electronAPI.onOllamaStatusChange(callback);
    }
  },

  onIPFSStatus(callback: (status: any) => void) {
    if (useRestApi) {
      const poll = async () => {
        try {
          const status = await api.getIPFSStatus();
          callback(status);
        } catch {}
      };
      poll();
      setInterval(poll, 5000);
    } else {
      (window as any).electronAPI.onIPFSStatus(callback);
    }
  },

  onFullscreenChange(callback: (isFullscreen: boolean) => void) {
    if (useRestApi) {
      // Tauri doesn't have a direct fullscreen event, so we skip this
    } else {
      (window as any).electronAPI.onFullscreenChange(callback);
    }
  },

  // ============ Settings ============

  async getResourceLimits(): Promise<ResourceLimits> {
    if (useRestApi) {
      try {
        return await fetchApi('/settings/resource-limits');
      } catch {
        return {};
      }
    }
    return (window as any).electronAPI.getResourceLimits();
  },

  async setResourceLimits(limits: ResourceLimits): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/settings/resource-limits', {
          method: 'POST',
          body: JSON.stringify(limits),
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.setResourceLimits(limits);
  },

  async getStoragePath(): Promise<string | null> {
    if (useRestApi) {
      try {
        const result = await fetchApi<{ path: string | null }>('/settings/storage-path');
        return result.path;
      } catch {
        return null;
      }
    }
    return (window as any).electronAPI.getStoragePath();
  },

  async setStoragePath(path: string | null): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/settings/storage-path', {
          method: 'POST',
          body: JSON.stringify({ path }),
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.setStoragePath(path);
  },

  async getRemoteControlEnabled(): Promise<boolean> {
    if (useRestApi) {
      try {
        const result = await fetchApi<{ enabled: boolean }>('/settings/remote-control');
        return result.enabled;
      } catch {
        return false;
      }
    }
    return (window as any).electronAPI.getRemoteControlEnabled();
  },

  async setRemoteControlEnabled(enabled: boolean): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/settings/remote-control', {
          method: 'POST',
          body: JSON.stringify({ enabled }),
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return (window as any).electronAPI.setRemoteControlEnabled(enabled);
  },
};

// For backwards compatibility, expose as window.electronAPI too
if (useRestApi && typeof window !== 'undefined') {
  (window as any).electronAPI = api;
}

export default api;
