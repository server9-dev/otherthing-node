// API Configuration for the merged Electron app
// Since we're running in the same process, we connect directly to localhost:8080

const API_BASE = 'http://localhost:8080';

export function apiUrl(path: string): string {
  // Path should start with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}

export const API_BASE_URL = API_BASE;

// Open WebUI on the shared GPU node, shown in the workspace AI tab.
// Must also be listed in frame-src in index.html's Content-Security-Policy.
export const AI_CHAT_URL: string = import.meta.env.VITE_AI_CHAT_URL || 'https://gpu.otherthing.ai';
