import { contextBridge, ipcRenderer } from 'electron';

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

contextBridge.exposeInMainWorld('electronAPI', {
  getHardware: () => ipcRenderer.invoke('get-hardware'),
  getDetectedHardware: () => ipcRenderer.invoke('get-detected-hardware'),
  getNodeStatus: () => ipcRenderer.invoke('get-node-status'),
  startNode: (config: { orchestratorUrl?: string; workspaceIds: string[] }) =>
    ipcRenderer.invoke('start-node', config),
  stopNode: () => ipcRenderer.invoke('stop-node'),
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),

  // Network connection (optional - node works locally without this)
  connectToNetwork: (config: { url?: string; workspaceIds?: string[] }) =>
    ipcRenderer.invoke('connect-to-network', config),
  disconnectFromNetwork: () => ipcRenderer.invoke('disconnect-from-network'),
  isNetworkConnected: () => ipcRenderer.invoke('is-network-connected'),

  // Resource limits
  getResourceLimits: () => ipcRenderer.invoke('get-resource-limits'),
  setResourceLimits: (limits: ResourceLimits) => ipcRenderer.invoke('set-resource-limits', limits),

  // Drive/storage selection
  getDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke('get-drives'),
  getStoragePath: (): Promise<string | null> => ipcRenderer.invoke('get-storage-path'),
  setStoragePath: (path: string | null): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('set-storage-path', path),

  // IPFS operations
  startIPFS: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('ipfs-start'),
  stopIPFS: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('ipfs-stop'),
  getIPFSStatus: (): Promise<{ running: boolean; hasBinary: boolean; peerId: string | null; stats: any }> =>
    ipcRenderer.invoke('ipfs-status'),
  downloadIPFSBinary: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('ipfs-download-binary'),
  onIPFSDownloadProgress: (callback: (percent: number) => void) => {
    ipcRenderer.on('ipfs-download-progress', (_, percent) => callback(percent));
  },
  onIPFSStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('ipfs-status', (_, status) => callback(status));
  },

  // IPFS file operations (Phase 4)
  ipfsAdd: (filePath: string): Promise<{ success: boolean; cid?: string; error?: string }> =>
    ipcRenderer.invoke('ipfs-add', filePath),
  ipfsAddContent: (content: string, filename?: string): Promise<{ success: boolean; cid?: string; error?: string }> =>
    ipcRenderer.invoke('ipfs-add-content', content, filename),
  ipfsGet: (cid: string, outputPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ipfs-get', cid, outputPath),
  ipfsPin: (cid: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ipfs-pin', cid),
  ipfsUnpin: (cid: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ipfs-unpin', cid),
  setIPFSStorageLimit: (limitGb: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ipfs-set-storage-limit', limitGb),
  getIPFSStorageLimit: (): Promise<number | null> =>
    ipcRenderer.invoke('ipfs-get-storage-limit'),

  // Ollama operations
  getOllamaStatus: (): Promise<{ installed: boolean; running: boolean; version?: string; models: any[]; endpoint?: string }> =>
    ipcRenderer.invoke('ollama-status'),
  installOllama: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama-install'),
  startOllama: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama-start'),
  stopOllama: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama-stop'),
  pullOllamaModel: (modelName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama-pull-model', modelName),
  deleteOllamaModel: (modelName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama-delete-model', modelName),
  getOllamaModels: (): Promise<any[]> =>
    ipcRenderer.invoke('ollama-models'),
  onOllamaInstallProgress: (callback: (percent: number) => void) => {
    ipcRenderer.on('ollama-install-progress', (_, percent) => callback(percent));
  },
  onOllamaPullProgress: (callback: (data: { model: string; status: string; percent?: number }) => void) => {
    ipcRenderer.on('ollama-pull-progress', (_, data) => callback(data));
  },
  onOllamaStatusChange: (callback: (status: any) => void) => {
    ipcRenderer.on('ollama-status-change', (_, status) => callback(status));
  },
  setOllamaPath: (ollamaPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama-set-path', ollamaPath),
  getOllamaPath: (): Promise<string | null> =>
    ipcRenderer.invoke('ollama-get-path'),
  browseForFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
    ipcRenderer.invoke('browse-for-file', options || {}),

  // Sandbox operations
  hasSandbox: (): Promise<boolean> =>
    ipcRenderer.invoke('sandbox-has'),
  sandboxWriteFile: (
    workspaceId: string,
    relativePath: string,
    content: string
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('sandbox-write-file', workspaceId, relativePath, content),
  sandboxReadFile: (
    workspaceId: string,
    relativePath: string
  ): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('sandbox-read-file', workspaceId, relativePath),
  sandboxListFiles: (
    workspaceId: string,
    relativePath?: string
  ): Promise<{ success: boolean; files?: any[]; error?: string }> =>
    ipcRenderer.invoke('sandbox-list-files', workspaceId, relativePath),
  sandboxDeleteFile: (
    workspaceId: string,
    relativePath: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sandbox-delete-file', workspaceId, relativePath),
  sandboxExecute: (
    workspaceId: string,
    command: string,
    timeout?: number
  ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }> =>
    ipcRenderer.invoke('sandbox-execute', workspaceId, command, timeout),
  sandboxSyncToIPFS: (
    workspaceId: string
  ): Promise<{ success: boolean; cid?: string; error?: string }> =>
    ipcRenderer.invoke('sandbox-sync-to-ipfs', workspaceId),
  sandboxSyncFromIPFS: (
    workspaceId: string,
    cid: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sandbox-sync-from-ipfs', workspaceId, cid),
  sandboxGetSize: (
    workspaceId: string
  ): Promise<number> =>
    ipcRenderer.invoke('sandbox-get-size', workspaceId),

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  toggleFullscreen: () => ipcRenderer.invoke('window-fullscreen'),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window-is-fullscreen'),
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    ipcRenderer.on('fullscreen-change', (_, isFullscreen) => callback(isFullscreen));
  },

  // Remote control opt-in
  getRemoteControlEnabled: () => ipcRenderer.invoke('get-remote-control'),
  setRemoteControlEnabled: (enabled: boolean) => ipcRenderer.invoke('set-remote-control', enabled),

  // Dashboard
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  onNodeStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('node-status', (_, status) => callback(status));
  },
  onNodeLog: (callback: (log: any) => void) => {
    ipcRenderer.on('node-log', (_, log) => callback(log));
  },
  onLimitsChange: (callback: (limits: ResourceLimits) => void) => {
    ipcRenderer.on('limits-change', (_, limits) => callback(limits));
  },
});
