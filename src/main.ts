import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import { NodeService } from './node-service';
import { HardwareDetector } from './hardware';
import { createServer } from 'http';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let nodeService: NodeService | null = null;
let httpServer: ReturnType<typeof createServer> | null = null;

const DEFAULT_ORCHESTRATOR = 'ws://155.117.46.228/ws/node';
const HTTP_PORT = 3847;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (nodeService?.isRunning()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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
  createWindow();
  const updateTray = createTray();
  startHttpServer();

  nodeService = new NodeService(DEFAULT_ORCHESTRATOR);

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

  ipcMain.handle('start-node', async (_, { orchestratorUrl, workspaceIds }) => {
    if (!nodeService) return { success: false, error: 'Node service not initialized' };

    try {
      await nodeService.start(orchestratorUrl || DEFAULT_ORCHESTRATOR, workspaceIds);
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
  httpServer?.close();
});
