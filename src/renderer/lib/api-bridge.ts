/**
 * Unified API bridge for Electron desktop app
 * Uses electronAPI (preload) when available, REST API as fallback
 */

// Capture the original electronAPI before we potentially overwrite it
const _originalElectronAPI = typeof window !== 'undefined' && (window as any).electronAPI ? (window as any).electronAPI : null;
const hasElectronAPI = !!_originalElectronAPI;
const useRestApi = !hasElectronAPI;

console.log('[API Bridge] Initializing, hasElectronAPI:', hasElectronAPI, 'useRestApi:', useRestApi);

// REST API base URL
const SIDECAR_API = 'http://localhost:8080/api/v1';
const API_BASE = 'http://localhost:8080';

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
  isElectron: typeof window !== 'undefined' && 'electronAPI' in window,

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
    return _originalElectronAPI.getHardware();
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
    return _originalElectronAPI.getDetectedHardware();
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
    return _originalElectronAPI.getDrives();
  },

  // ============ Node Status ============

  async getNodeStatus(): Promise<NodeStatus> {
    if (useRestApi) {
      try {
        const response = await fetch(`${API_BASE}/health`);
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
    return _originalElectronAPI.getNodeStatus();
  },

  async startNode(config: { orchestratorUrl?: string; workspaceIds: string[] }): Promise<CommandResult> {
    if (useRestApi) {
      return { success: true };
    }
    return _originalElectronAPI.startNode(config);
  },

  async stopNode(): Promise<CommandResult> {
    if (useRestApi) {
      return { success: true };
    }
    return _originalElectronAPI.stopNode();
  },

  // ============ Network ============

  async connectToNetwork(config: { url?: string; workspaceIds?: string[] }): Promise<CommandResult> {
    if (useRestApi) {
      return { success: true };
    }
    return _originalElectronAPI.connectToNetwork(config);
  },

  async disconnectFromNetwork(): Promise<CommandResult> {
    if (useRestApi) {
      return { success: true };
    }
    return _originalElectronAPI.disconnectFromNetwork();
  },

  async isNetworkConnected(): Promise<boolean> {
    if (useRestApi) {
      try {
        const response = await fetch(`${API_BASE}/health`);
        return response.ok;
      } catch {
        return false;
      }
    }
    return _originalElectronAPI.isNetworkConnected();
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
    return _originalElectronAPI.getOllamaStatus();
  },

  async startOllama(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/start', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return _originalElectronAPI.startOllama();
  },

  async stopOllama(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/stop', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return _originalElectronAPI.stopOllama();
  },

  async getOllamaModels(): Promise<any[]> {
    if (useRestApi) {
      try {
        return await fetchApi('/ollama/models');
      } catch {
        return [];
      }
    }
    return _originalElectronAPI.getOllamaModels();
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
    return _originalElectronAPI.pullOllamaModel(modelName);
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
    return _originalElectronAPI.deleteOllamaModel(modelName);
  },

  async setOllamaPath(path: string): Promise<CommandResult> {
    if (useRestApi) {
      return { success: true };
    }
    return _originalElectronAPI.setOllamaPath(path);
  },

  async getOllamaPath(): Promise<string | null> {
    if (useRestApi) {
      return null;
    }
    return _originalElectronAPI.getOllamaPath();
  },

  async installOllama(): Promise<CommandResult> {
    if (useRestApi) {
      return { success: false, error: 'Please install Ollama manually from ollama.ai' };
    }
    return _originalElectronAPI.installOllama();
  },

  onOllamaPullProgress(callback: (data: any) => void) {
    if (!useRestApi && _originalElectronAPI?.onOllamaPullProgress) {
      _originalElectronAPI.onOllamaPullProgress(callback);
    }
  },

  onOllamaInstallProgress(callback: (percent: number) => void) {
    if (!useRestApi && _originalElectronAPI?.onOllamaInstallProgress) {
      _originalElectronAPI.onOllamaInstallProgress(callback);
    }
  },

  async browseForFile(options?: any): Promise<string | null> {
    if (useRestApi) {
      return null;
    }
    return _originalElectronAPI.browseForFile(options);
  },

  // ============ IPFS ============

  async getIPFSStatus(): Promise<IpfsStatus> {
    if (useRestApi) {
      try {
        const data = await fetchApi<any>('/ipfs/status');
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
    return _originalElectronAPI.getIPFSStatus();
  },

  async startIPFS(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ipfs/start', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return _originalElectronAPI.startIPFS();
  },

  async stopIPFS(): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi('/ipfs/stop', { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return _originalElectronAPI.stopIPFS();
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
    return _originalElectronAPI.ipfsAddContent(content);
  },

  async ipfsPin(cid: string): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi(`/ipfs/pin/${encodeURIComponent(cid)}`, { method: 'POST' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return _originalElectronAPI.ipfsPin(cid);
  },

  async ipfsUnpin(cid: string): Promise<CommandResult> {
    if (useRestApi) {
      try {
        return await fetchApi(`/ipfs/pin/${encodeURIComponent(cid)}`, { method: 'DELETE' });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return _originalElectronAPI.ipfsUnpin(cid);
  },

  // Store progress callback for SSE updates
  _ipfsProgressCallback: null as ((percent: number) => void) | null,

  async downloadIPFSBinary(): Promise<CommandResult> {
    if (useRestApi) {
      return new Promise((resolve) => {
        const eventSource = new EventSource(`${API_BASE}/api/v1/ipfs/download`);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.status === 'downloading' && api._ipfsProgressCallback) {
              api._ipfsProgressCallback(data.progress);
            } else if (data.status === 'complete') {
              if (api._ipfsProgressCallback) api._ipfsProgressCallback(100);
              eventSource.close();
              resolve({ success: true });
            } else if (data.status === 'error') {
              eventSource.close();
              resolve({ success: false, error: data.error });
            }
          } catch (err) {
            console.error('[API] SSE parse error:', err);
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          resolve({ success: false, error: 'Download connection failed' });
        };
      });
    }
    return _originalElectronAPI.downloadIPFSBinary();
  },

  async getIPFSStorageLimit(): Promise<number | null> {
    if (useRestApi) {
      return 50; // Default 50GB
    }
    return _originalElectronAPI.getIPFSStorageLimit?.() || 50;
  },

  async setIPFSStorageLimit(limit: number): Promise<CommandResult> {
    if (useRestApi) {
      return { success: true };
    }
    return _originalElectronAPI.setIPFSStorageLimit?.(limit) || { success: true };
  },

  onIPFSDownloadProgress(callback: (percent: number) => void) {
    if (useRestApi) {
      api._ipfsProgressCallback = callback;
    } else if (_originalElectronAPI?.onIPFSDownloadProgress) {
      _originalElectronAPI.onIPFSDownloadProgress(callback);
    }
  },

  // ============ Window Controls (Electron) ============

  async minimizeWindow() {
    return _originalElectronAPI?.minimizeWindow();
  },

  async maximizeWindow() {
    return _originalElectronAPI?.maximizeWindow();
  },

  async closeWindow() {
    return _originalElectronAPI?.closeWindow();
  },

  async toggleFullscreen() {
    return _originalElectronAPI?.toggleFullscreen();
  },

  async isFullscreen(): Promise<boolean> {
    return _originalElectronAPI?.isFullscreen() ?? false;
  },

  // ============ External Links ============

  async openDashboard() {
    return _originalElectronAPI?.openDashboard();
  },

  // ============ Event Subscriptions ============

  onNodeStatus(callback: (status: any) => void) {
    if (useRestApi) {
      const poll = async () => {
        try {
          const status = await api.getNodeStatus();
          callback(status);
        } catch {}
      };
      poll();
      setInterval(poll, 5000);
    } else {
      _originalElectronAPI.onNodeStatus(callback);
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
      _originalElectronAPI.onOllamaStatusChange(callback);
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
      _originalElectronAPI.onIPFSStatus(callback);
    }
  },

  onFullscreenChange(callback: (isFullscreen: boolean) => void) {
    if (!useRestApi) {
      _originalElectronAPI.onFullscreenChange(callback);
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
    return _originalElectronAPI.getResourceLimits();
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
    return _originalElectronAPI.setResourceLimits(limits);
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
    return _originalElectronAPI.getStoragePath();
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
    return _originalElectronAPI.setStoragePath(path);
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
    return _originalElectronAPI.getRemoteControlEnabled();
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
    return _originalElectronAPI.setRemoteControlEnabled(enabled);
  },
};

// For backwards compatibility, expose as window.electronAPI too
if (useRestApi && typeof window !== 'undefined') {
  (window as any).electronAPI = api;
}

export default api;
