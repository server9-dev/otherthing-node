import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/cyberpunk.css';
import './styles/animations.css';

// Initialize API bridge (sets up window.electronAPI for Tauri compatibility)
import './lib/api-bridge';

// Use HashRouter for Electron compatibility
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
