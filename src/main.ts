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
