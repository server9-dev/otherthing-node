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

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),

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
