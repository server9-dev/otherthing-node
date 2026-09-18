/// <reference types="vite/client" />

interface Window {
  /** Preload bridge (src/preload.ts), or the REST fallback installed by lib/api-bridge.ts. */
  electronAPI?: any;
}
