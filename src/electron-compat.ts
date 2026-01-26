/**
 * Electron compatibility layer - provides fallbacks when running without Electron
 */
import * as path from 'path';
import * as os from 'os';

const APP_NAME = 'otherthing-node';

export function getUserDataPath(): string {
  try {
    const { app } = require('electron');
    if (app && app.getPath) {
      return app.getPath('userData');
    }
  } catch {
    // Electron not available
  }
  // Fallback for standalone Node.js
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  } else {
    return path.join(os.homedir(), '.config', APP_NAME);
  }
}

export function getTempPath(): string {
  try {
    const { app } = require('electron');
    if (app && app.getPath) {
      return app.getPath('temp');
    }
  } catch {
    // Electron not available
  }
  return os.tmpdir();
}

export function isElectronAvailable(): boolean {
  try {
    const { app } = require('electron');
    return !!(app && app.getPath);
  } catch {
    return false;
  }
}
