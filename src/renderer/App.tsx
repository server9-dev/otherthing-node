import { Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { LayoutDashboard, Server, Settings as SettingsIcon, Wifi, WifiOff, HardDrive, Users, Bot, Store, Maximize2, Minimize2 } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { NodeControl } from './pages/NodeControl';
import { Settings } from './pages/Settings';
import { WorkspacePage } from './pages/Workspace';
import { AgentsPage } from './pages/Agents';
import { Marketplace } from './pages/Marketplace';
import { ModuleProvider } from './context/ModuleContext';
import { CredentialProvider } from './context/CredentialContext';
import { Web3Provider } from './context/Web3Context';
import { WalletButton } from './components';

// Import logo - files in public/ are served at root
import logoUrl from '/logo.png?url';

function App() {
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Check connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch('http://localhost:8080/health');
        setConnected(res.ok);
        if (res.ok) setLastUpdate(new Date());
      } catch {
        setConnected(false);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fullscreen state tracking
  useEffect(() => {
    // Check initial fullscreen state
    if (window.electronAPI?.isFullscreen) {
      window.electronAPI.isFullscreen().then(setIsFullscreen);
    }

    // Listen for fullscreen changes
    if (window.electronAPI?.onFullscreenChange) {
      window.electronAPI.onFullscreenChange(setIsFullscreen);
    }
  }, []);

  const toggleFullscreen = () => {
    if (window.electronAPI?.toggleFullscreen) {
      window.electronAPI.toggleFullscreen();
    }
  };

  return (
    <Web3Provider>
      <CredentialProvider>
        <ModuleProvider>
          <div className="app-container">
            {/* Header */}
            <header className="app-header">
              <div className="header-logo">
                <img
                  src={logoUrl}
                  alt="OtherThing"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                  }}
                />
                <h1 className="logo-text">OtherThing</h1>
              </div>

              <nav className="header-nav">
                <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <LayoutDashboard size={16} />
                  <span>Dashboard</span>
                </NavLink>
                <NavLink to="/workspaces" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Users size={16} />
                  <span>Workspaces</span>
                </NavLink>
                <NavLink to="/agents" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Bot size={16} />
                  <span>Agents</span>
                </NavLink>
                <NavLink to="/node" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Server size={16} />
                  <span>Node</span>
                </NavLink>
                <NavLink to="/marketplace" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Store size={16} />
                  <span>Marketplace</span>
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <SettingsIcon size={16} />
                  <span>Settings</span>
                </NavLink>
              </nav>

              <div className="header-status">
                <button
                  onClick={toggleFullscreen}
                  className="fullscreen-btn"
                  title={isFullscreen ? 'Exit Fullscreen (F11)' : 'Fullscreen (F11)'}
                >
                  {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <WalletButton />
                <span className="status-divider">|</span>
                {connected ? (
                  <>
                    <Wifi size={16} className="status-icon online" />
                    <span className="status-dot online" />
                    <span className="status-text online">Running</span>
                    {lastUpdate && (
                      <span className="status-time">
                        {lastUpdate.toLocaleTimeString('en-US', { hour12: false })}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <WifiOff size={16} className="status-icon offline" />
                    <span className="status-dot offline" />
                    <span className="status-text offline">Starting...</span>
                  </>
                )}
              </div>
            </header>

            {/* Main Content */}
            <main className="app-main">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/workspaces" element={<WorkspacePage />} />
                <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/workspace/:workspaceId/agents" element={<AgentsPage />} />
                <Route path="/node" element={<NodeControl />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </main>
          </div>
        </ModuleProvider>
      </CredentialProvider>
    </Web3Provider>
  );
}

export default App;
