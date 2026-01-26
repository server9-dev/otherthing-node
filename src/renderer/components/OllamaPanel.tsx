import { useState, useEffect, useCallback } from 'react';
import { Cpu, Play, Square, Download, Trash2, Plus, Check, AlertTriangle, RefreshCw, FolderOpen } from 'lucide-react';
import { CyberButton } from './CyberButton';
import { api } from '../lib/api-bridge';

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  models: OllamaModel[];
  endpoint?: string;
}

const POPULAR_MODELS = [
  { name: 'llama3.2:3b', size: '2.0 GB', desc: 'Fast, efficient 3B model' },
  { name: 'llama3.2:1b', size: '1.3 GB', desc: 'Smallest Llama model' },
  { name: 'mistral:7b', size: '4.1 GB', desc: 'Great all-rounder' },
  { name: 'codellama:7b', size: '3.8 GB', desc: 'Optimized for code' },
  { name: 'phi3:mini', size: '2.3 GB', desc: 'Microsoft Phi-3' },
  { name: 'gemma2:2b', size: '1.6 GB', desc: 'Google Gemma 2B' },
];

interface OllamaPanelProps {
  sharedModels?: string[];
  onShareChange?: (models: string[]) => void;
}

export function OllamaPanel({ sharedModels = [], onShareChange }: OllamaPanelProps) {
  const [status, setStatus] = useState<OllamaStatus>({
    installed: false,
    running: false,
    models: [],
  });
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState(0);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModelName, setCustomModelName] = useState('');
  const [localSharedModels, setLocalSharedModels] = useState<string[]>(sharedModels);

  const refreshStatus = useCallback(async () => {
    try {
      const ollamaStatus = await api.getOllamaStatus();
      setStatus(ollamaStatus);
    } catch (err) {
      console.error('Failed to get Ollama status:', err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();

    // Listen for pull progress
    if (true) { // Always run in Tauri mode
      api.onOllamaPullProgress((data: { model: string; status: string; percent?: number }) => {
        if (data.percent !== undefined) {
          setPullProgress(data.percent);
        }
        if (data.status === 'success' || data.percent === 100) {
          setPullingModel(null);
          refreshStatus();
        }
      });
    }

    // Listen for status changes
    if (true) { // Always run in Tauri mode
      api.onOllamaStatusChange((newStatus: any) => {
        setStatus(prev => ({ ...prev, ...newStatus }));
      });
    }

    // Listen for install progress
    if (true) { // Always run in Tauri mode
      api.onOllamaInstallProgress((percent: number) => {
        setInstallProgress(percent);
        if (percent >= 100) {
          setInstalling(false);
          refreshStatus();
        }
      });
    }

    const interval = setInterval(refreshStatus, 15000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const handleInstall = async () => {
    
    setInstalling(true);
    setInstallProgress(0);
    try {
      await api.installOllama();
    } catch (err) {
      console.error('Failed to install Ollama:', err);
      setInstalling(false);
    }
  };

  const handleStart = async () => {
    
    setStarting(true);
    try {
      await api.startOllama();
      await refreshStatus();
    } catch (err) {
      console.error('Failed to start Ollama:', err);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    
    setStopping(true);
    try {
      await api.stopOllama();
      await refreshStatus();
    } catch (err) {
      console.error('Failed to stop Ollama:', err);
    } finally {
      setStopping(false);
    }
  };

  const handlePullModel = async (modelName: string) => {
    
    setPullingModel(modelName);
    setPullProgress(0);
    try {
      await api.pullOllamaModel(modelName);
    } catch (err) {
      console.error('Failed to pull model:', err);
      setPullingModel(null);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    
    if (!confirm(`Delete model ${modelName}?`)) return;
    try {
      await api.deleteOllamaModel(modelName);
      await refreshStatus();
      // Remove from shared if it was shared
      const newShared = localSharedModels.filter(m => m !== modelName);
      setLocalSharedModels(newShared);
      onShareChange?.(newShared);
    } catch (err) {
      console.error('Failed to delete model:', err);
    }
  };

  const handleBrowseOllama = async () => {
    
    try {
      const path = await api.browseForFile({
        title: 'Select Ollama Executable',
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      });
      if (path) {
        await api.setOllamaPath(path);
        await refreshStatus();
      }
    } catch (err) {
      console.error('Failed to set Ollama path:', err);
    }
  };

  const toggleModelShare = (modelName: string) => {
    let newShared: string[];
    if (localSharedModels.includes(modelName)) {
      newShared = localSharedModels.filter(m => m !== modelName);
    } else {
      newShared = [...localSharedModels, modelName];
    }
    setLocalSharedModels(newShared);
    onShareChange?.(newShared);
  };

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  return (
    <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
      <div className="cyber-card-header">
        <span className="cyber-card-title">
          <Cpu size={14} style={{ marginRight: '0.5rem' }} />
          OLLAMA LLM ENGINE
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '0.7rem',
            fontFamily: 'var(--font-mono)',
            background: status.running ? 'rgba(0, 212, 255, 0.1)' : status.installed ? 'rgba(155, 89, 182, 0.1)' : 'rgba(255, 0, 128, 0.1)',
            color: status.running ? 'var(--primary)' : status.installed ? 'var(--secondary)' : 'var(--accent)',
            border: `1px solid ${status.running ? 'var(--primary)' : status.installed ? 'var(--secondary)' : 'var(--accent)'}`,
          }}>
            {status.running ? 'RUNNING' : status.installed ? 'STOPPED' : 'NOT INSTALLED'}
          </span>
          <CyberButton icon={RefreshCw} onClick={refreshStatus} style={{ padding: '4px 8px' }}>

          </CyberButton>
        </div>
      </div>
      <div className="cyber-card-body">
        {/* Not Installed */}
        {!status.installed ? (
          <div style={{ textAlign: 'center', padding: 'var(--gap-lg)' }}>
            <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: 'var(--gap-md)' }} />
            <div style={{ color: 'var(--text-primary)', marginBottom: 'var(--gap-md)' }}>
              Ollama not detected
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }}>
              Install Ollama to run local AI models
            </div>
            {installing ? (
              <div>
                <div style={{
                  width: '100%',
                  height: 8,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  marginBottom: 'var(--gap-sm)',
                }}>
                  <div style={{
                    width: `${installProgress}%`,
                    height: '100%',
                    background: 'var(--gradient-brand)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Installing... {installProgress.toFixed(0)}%
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--gap-md)', justifyContent: 'center' }}>
                <CyberButton icon={Download} onClick={handleInstall}>
                  Install Ollama
                </CyberButton>
                <CyberButton icon={FolderOpen} onClick={handleBrowseOllama} variant="secondary">
                  Browse...
                </CyberButton>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Controls */}
            <div style={{ display: 'flex', gap: 'var(--gap-md)', marginBottom: 'var(--gap-lg)' }}>
              {status.running ? (
                <CyberButton icon={Square} onClick={handleStop} loading={stopping} variant="secondary">
                  Stop Ollama
                </CyberButton>
              ) : (
                <CyberButton icon={Play} onClick={handleStart} loading={starting} variant="primary">
                  Start Ollama
                </CyberButton>
              )}
              <CyberButton icon={Plus} onClick={() => setShowModelPicker(!showModelPicker)} variant="secondary">
                Add Model
              </CyberButton>
            </div>

            {/* Model Picker */}
            {showModelPicker && (
              <div style={{
                marginBottom: 'var(--gap-lg)',
                padding: 'var(--gap-md)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--gap-sm)', textTransform: 'uppercase' }}>
                  Popular Models
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gap-sm)', marginBottom: 'var(--gap-md)' }}>
                  {POPULAR_MODELS.map((model) => {
                    const isInstalled = status.models.some(m => m.name.startsWith(model.name.split(':')[0]));
                    const isPulling = pullingModel === model.name;
                    return (
                      <button
                        key={model.name}
                        onClick={() => !isInstalled && !isPulling && handlePullModel(model.name)}
                        disabled={isInstalled || isPulling}
                        style={{
                          padding: 'var(--gap-sm) var(--gap-md)',
                          background: isInstalled ? 'rgba(0, 212, 255, 0.1)' : 'var(--bg-elevated)',
                          border: `1px solid ${isInstalled ? 'var(--primary)' : 'var(--border-subtle)'}`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: isInstalled ? 'default' : 'pointer',
                          opacity: isPulling ? 0.5 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-xs)' }}>
                          {isInstalled && <Check size={12} style={{ color: 'var(--primary)' }} />}
                          <span style={{ color: isInstalled ? 'var(--primary)' : 'var(--text-primary)', fontSize: '0.85rem' }}>
                            {model.name}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {model.size}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
                  <input
                    type="text"
                    placeholder="Or enter model name (e.g. llama3:8b)"
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    style={{
                      flex: 1,
                      padding: 'var(--gap-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <CyberButton
                    icon={Download}
                    onClick={() => {
                      if (customModelName) {
                        handlePullModel(customModelName);
                        setCustomModelName('');
                      }
                    }}
                    disabled={!customModelName || !!pullingModel}
                  >
                    Pull
                  </CyberButton>
                </div>
              </div>
            )}

            {/* Pull Progress */}
            {pullingModel && (
              <div style={{
                marginBottom: 'var(--gap-lg)',
                padding: 'var(--gap-md)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <div style={{ fontSize: '0.85rem', marginBottom: 'var(--gap-sm)' }}>
                  Pulling <span style={{ color: 'var(--primary)' }}>{pullingModel}</span>...
                </div>
                <div style={{
                  width: '100%',
                  height: 8,
                  background: 'var(--bg-elevated)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pullProgress}%`,
                    height: '100%',
                    background: 'var(--gradient-brand)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {pullProgress.toFixed(0)}%
                </div>
              </div>
            )}

            {/* Installed Models */}
            <div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: 'var(--gap-sm)',
                textTransform: 'uppercase',
              }}>
                Installed Models ({status.models.length})
              </div>
              {status.models.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
                  {status.models.map((model) => (
                    <div
                      key={model.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--gap-sm) var(--gap-md)',
                        background: localSharedModels.includes(model.name) ? 'rgba(0, 212, 255, 0.05)' : 'var(--bg-tertiary)',
                        border: `1px solid ${localSharedModels.includes(model.name) ? 'var(--primary)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-md)' }}>
                        <button
                          onClick={() => toggleModelShare(model.name)}
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            border: `1px solid ${localSharedModels.includes(model.name) ? 'var(--primary)' : 'var(--border-default)'}`,
                            background: localSharedModels.includes(model.name) ? 'var(--primary)' : 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {localSharedModels.includes(model.name) && <Check size={12} style={{ color: 'white' }} />}
                        </button>
                        <div>
                          <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                            {model.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {formatSize(model.size)}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteModel(model.name)}
                        style={{
                          padding: '4px',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  textAlign: 'center',
                  padding: 'var(--gap-lg)',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}>
                  No models installed. Click "Add Model" to get started.
                </div>
              )}
              {status.models.length > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--gap-sm)' }}>
                  Check models to share them on the network
                </div>
              )}
            </div>

            {/* Endpoint Info */}
            {status.running && status.endpoint && (
              <div style={{
                marginTop: 'var(--gap-md)',
                padding: 'var(--gap-sm)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
              }}>
                <span style={{ color: 'var(--text-muted)' }}>Endpoint: </span>
                <span style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{status.endpoint}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
