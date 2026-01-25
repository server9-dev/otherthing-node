import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, globalShortcut, session } from 'electron';
import * as path from 'path';
import { NodeService } from './node-service';
import { HardwareDetector } from './hardware';
import { createServer } from 'http';
import { apiServer } from './api-server';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let nodeService: NodeService | null = null;
let httpServer: ReturnType<typeof createServer> | null = null;

const DEFAULT_NETWORK_URL = 'ws://155.117.46.228/ws/node';  // Optional network connection
const HTTP_PORT = 3847;

const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:1420';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    frame: true,
    fullscreenable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // Required for WalletConnect
      allowRunningInsecureContent: true,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  // In development, load Vite dev server; in production, load built files
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // DevTools can be opened manually with Ctrl+Shift+I if needed
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (nodeService?.isRunning()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Notify renderer of fullscreen state changes
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-change', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-change', false);
  });

  // Register F11 for fullscreen toggle
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);

  const updateTrayMenu = () => {
    const running = nodeService?.isRunning() ?? false;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'OtherThing Node',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: running ? 'Stop Node' : 'Start Node',
        click: async () => {
          if (running) {
            await nodeService?.stop();
          } else {
            mainWindow?.show();
          }
          updateTrayMenu();
        },
      },
      {
        label: 'Open Dashboard',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Open Web Console',
        click: () => {
          shell.openExternal('http://155.117.46.228');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: async () => {
          await nodeService?.stop();
          app.quit();
        },
      },
    ]);

    tray?.setContextMenu(contextMenu);
    tray?.setToolTip(running ? 'OtherThing Node - Running' : 'OtherThing Node - Stopped');
  };

  updateTrayMenu();

  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  return updateTrayMenu;
}

function startHttpServer() {
  httpServer = createServer(async (req, res) => {
    // CORS headers including Private Network Access for browser security
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/hardware' && req.method === 'GET') {
      try {
        const hardware = await HardwareDetector.detect();
        res.writeHead(200);
        res.end(JSON.stringify(hardware));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to detect hardware' }));
      }
      return;
    }

    if (req.url === '/status' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        running: nodeService?.isRunning() ?? false,
        nodeId: nodeService?.getNodeId() ?? null,
        connected: nodeService?.isConnected() ?? false,
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`Hardware API listening on http://127.0.0.1:${HTTP_PORT}`);
  });
}

app.whenReady().then(async () => {
  // Remove CSP headers to allow WalletConnect
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    // Remove CSP headers that might block WalletConnect
    delete responseHeaders['content-security-policy'];
    delete responseHeaders['Content-Security-Policy'];
    delete responseHeaders['x-content-security-policy'];
    delete responseHeaders['X-Content-Security-Policy'];
    callback({ responseHeaders });
  });

  // Allow loading WalletConnect verification URLs
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: false });
  });

  createWindow();
  const updateTray = createTray();
  startHttpServer();

  nodeService = new NodeService();

  // Auto-start in local mode
  nodeService.startLocal().then(() => {
    console.log('[Main] Node started in local mode');

    // Set managers for API server after node is initialized
    apiServer.setManagers(
      nodeService!.getOllamaManager(),
      nodeService!.getSandboxManager(),
      nodeService!.getIPFSManager()
    );
  }).catch(err => {
    console.error('[Main] Failed to start node:', err);
  });

  // Start the API server (embedded orchestrator)
  apiServer.start().then(() => {
    console.log('[Main] API server started on http://localhost:8080');
  }).catch(err => {
    console.error('[Main] Failed to start API server:', err);
  });

  nodeService.on('statusChange', () => {
    updateTray();
    mainWindow?.webContents.send('node-status', {
      running: nodeService?.isRunning(),
      connected: nodeService?.isConnected(),
      nodeId: nodeService?.getNodeId(),
      shareKey: nodeService?.getShareKey(),
      workspaceIds: nodeService?.getWorkspaceIds() ?? [],
    });
  });

  nodeService.on('log', (log) => {
    mainWindow?.webContents.send('node-log', log);
  });

  nodeService.on('limitsChange', (limits) => {
    mainWindow?.webContents.send('limits-change', limits);
  });

  nodeService.on('ipfsStatusChange', (status) => {
    mainWindow?.webContents.send('ipfs-status', status);
  });

  nodeService.on('ollamaStatusChange', (status) => {
    mainWindow?.webContents.send('ollama-status-change', status);
  });

  nodeService.on('ollamaPullProgress', (data) => {
    mainWindow?.webContents.send('ollama-pull-progress', data);
  });

  // IPC handlers
  ipcMain.handle('get-hardware', async () => {
    return await HardwareDetector.detect();
  });

  ipcMain.handle('get-node-status', () => {
    return {
      running: nodeService?.isRunning() ?? false,
      connected: nodeService?.isConnected() ?? false,
      nodeId: nodeService?.getNodeId() ?? null,
      shareKey: nodeService?.getShareKey() ?? null,
    };
  });

  // Legacy start-node handler - now connects to network
  ipcMain.handle('start-node', async (_, { orchestratorUrl, workspaceIds }) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };

    try {
      await nodeService.connectToNetwork(orchestratorUrl || DEFAULT_NETWORK_URL, workspaceIds);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('stop-node', async () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };

    try {
      await nodeService.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // New network handlers
  ipcMain.handle('connect-to-network', async (_, { url, workspaceIds }) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.connectToNetwork(url || DEFAULT_NETWORK_URL, workspaceIds || []);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('disconnect-from-network', () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      nodeService.disconnectFromNetwork();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('is-network-connected', () => {
    return nodeService?.isNetworkConnected() ?? false;
  });

  ipcMain.handle('get-workspaces', async () => {
    try {
      const res = await fetch('http://155.117.46.228/api/v1/workspaces');
      if (res.ok) {
        return await res.json();
      }
      return { workspaces: [] };
    } catch {
      return { workspaces: [] };
    }
  });

  ipcMain.handle('get-resource-limits', () => {
    return nodeService?.getResourceLimits() ?? {};
  });

  ipcMain.handle('set-resource-limits', (_, limits) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      nodeService.setResourceLimits(limits);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('get-detected-hardware', async () => {
    return nodeService?.getHardware() ?? await HardwareDetector.detect();
  });

  // Window controls
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window-fullscreen', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  ipcMain.handle('window-is-fullscreen', () => {
    return mainWindow?.isFullScreen() ?? false;
  });

  // Remote control opt-in
  ipcMain.handle('get-remote-control', () => {
    return nodeService?.getRemoteControlEnabled() ?? false;
  });

  ipcMain.handle('set-remote-control', (_, enabled: boolean) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      nodeService.setRemoteControlEnabled(enabled);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Open dashboard in browser
  ipcMain.handle('open-dashboard', () => {
    shell.openExternal('http://155.117.46.228');
  });

  // Drive/storage selection
  ipcMain.handle('get-drives', async () => {
    return await HardwareDetector.getDrives();
  });

  ipcMain.handle('get-storage-path', () => {
    return nodeService?.getStoragePath() ?? null;
  });

  ipcMain.handle('set-storage-path', (_, path: string | null) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      nodeService.setStoragePath(path);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // IPFS handlers
  ipcMain.handle('ipfs-start', async () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.startIPFS();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-stop', async () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.stopIPFS();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-status', async () => {
    if (!nodeService) return { running: false, hasBinary: false, stats: null };
    return {
      running: nodeService.isIPFSRunning(),
      hasBinary: nodeService.hasIPFSBinary(),
      peerId: nodeService.getIPFSPeerId(),
      stats: await nodeService.getIPFSStats(),
    };
  });

  ipcMain.handle('ipfs-download-binary', async () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.downloadIPFSBinary((percent: number) => {
        mainWindow?.webContents.send('ipfs-download-progress', percent);
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // IPFS File Operations (Phase 4)
  ipcMain.handle('ipfs-add', async (_, filePath: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      const cid = await nodeService.ipfsAdd(filePath);
      return { success: true, cid };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-add-content', async (_, content: string, filename?: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      const cid = await nodeService.ipfsAddContent(content, filename);
      return { success: true, cid };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-get', async (_, cid: string, outputPath: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.ipfsGet(cid, outputPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-pin', async (_, cid: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.ipfsPin(cid);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-unpin', async (_, cid: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.ipfsUnpin(cid);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-set-storage-limit', async (_, limitGb: number) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.setIPFSStorageLimit(limitGb);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ipfs-get-storage-limit', async () => {
    if (!nodeService) return null;
    return await nodeService.getIPFSStorageLimit();
  });

  // Ollama handlers
  ipcMain.handle('ollama-status', async () => {
    if (!nodeService) return { installed: false, running: false, models: [] };
    return await nodeService.getOllamaStatus();
  });

  ipcMain.handle('ollama-install', async () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.installOllama((percent: number) => {
        mainWindow?.webContents.send('ollama-install-progress', percent);
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ollama-start', async () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.startOllama();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ollama-stop', async () => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.stopOllama();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ollama-pull-model', async (_, modelName: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.pullOllamaModel(modelName, (status: string, percent?: number) => {
        mainWindow?.webContents.send('ollama-pull-progress', { model: modelName, status, percent });
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ollama-delete-model', async (_, modelName: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    try {
      await nodeService.deleteOllamaModel(modelName);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ollama-models', async () => {
    if (!nodeService) return [];
    return await nodeService.getOllamaModels();
  });

  ipcMain.handle('ollama-set-path', (_, ollamaPath: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    const success = nodeService.setOllamaPath(ollamaPath);
    return { success, error: success ? undefined : 'Invalid path - file not found' };
  });

  ipcMain.handle('ollama-get-path', () => {
    if (!nodeService) return null;
    return nodeService.getOllamaPath();
  });

  ipcMain.handle('browse-for-file', async (_, options: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: options.title || 'Select File',
      filters: options.filters || [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Sandbox operations
  ipcMain.handle('sandbox-has', () => {
    if (!nodeService) return false;
    return nodeService.hasSandbox();
  });

  ipcMain.handle('sandbox-write-file', async (_, workspaceId: string, relativePath: string, content: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    return nodeService.sandboxWriteFile(workspaceId, relativePath, content);
  });

  ipcMain.handle('sandbox-read-file', async (_, workspaceId: string, relativePath: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    return nodeService.sandboxReadFile(workspaceId, relativePath);
  });

  ipcMain.handle('sandbox-list-files', async (_, workspaceId: string, relativePath?: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    return nodeService.sandboxListFiles(workspaceId, relativePath);
  });

  ipcMain.handle('sandbox-delete-file', async (_, workspaceId: string, relativePath: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    return nodeService.sandboxDeleteFile(workspaceId, relativePath);
  });

  ipcMain.handle('sandbox-execute', async (_, workspaceId: string, command: string, timeout?: number) => {
    if (!nodeService) return { success: false, stdout: '', stderr: '', exitCode: -1, error: 'Node service not initialized' };
    return nodeService.sandboxExecute(workspaceId, command, timeout);
  });

  ipcMain.handle('sandbox-sync-to-ipfs', async (_, workspaceId: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    return nodeService.sandboxSyncToIPFS(workspaceId);
  });

  ipcMain.handle('sandbox-sync-from-ipfs', async (_, workspaceId: string, cid: string) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };
    return nodeService.sandboxSyncFromIPFS(workspaceId, cid);
  });

  ipcMain.handle('sandbox-get-size', async (_, workspaceId: string) => {
    if (!nodeService) return 0;
    return nodeService.sandboxGetSize(workspaceId);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!nodeService?.isRunning()) {
      app.quit();
    }
  }
});

app.on('before-quit', async () => {
  await nodeService?.stop();
  await apiServer.stop();
  httpServer?.close();
});
