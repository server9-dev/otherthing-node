import { useState, useEffect, useCallback } from 'react';
import { Power, Cpu, HardDrive, Zap, RefreshCw, Terminal, Activity, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { CyberButton, ActivityLog, NodeBlockchain, IPFSPanel, OllamaPanel } from '../components';

interface HardwareInfo {
  cpu: {
    model: string;
    cores: number;
    threads: number;
  };
  memory: {
    total_mb: number;
    available_mb: number;
  };
  gpus: Array<{
    vendor: string;
    model: string;
    vram_mb: number;
  }>;
  storage: {
    total_gb: number;
    available_gb: number;
  };
}

interface HealthStatus {
  api: 'checking' | 'online' | 'offline';
  node: 'stopped' | 'running' | 'error';
  hardware: 'not_detected' | 'detected' | 'detecting';
}

interface NodeState {
  running: boolean;
  nodeId: string | null;
}

export function NodeControl() {
  const [nodeState, setNodeState] = useState<NodeState>({
    running: false,
    nodeId: null,
  });
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    api: 'checking',
    node: 'stopped',
    hardware: 'not_detected',
  });
  const [detectingHardware, setDetectingHardware] = useState(false);
  const [logs, setLogs] = useState<Array<{ time: string; message: string; type: 'info' | 'success' | 'error' }>>([]);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [{ time, message, type }, ...prev].slice(0, 100));
  }, []);

  // Health check
  const runHealthCheck = useCallback(async () => {
    addLog('Running health check...', 'info');

    // Check API server
    setHealthStatus(prev => ({ ...prev, api: 'checking' }));
    try {
      const res = await fetch('http://localhost:8080/health');
      if (res.ok) {
        setHealthStatus(prev => ({ ...prev, api: 'online', node: 'running' }));
        setNodeState(prev => ({ ...prev, running: true }));
        addLog('API Server: Online', 'success');
      } else {
        setHealthStatus(prev => ({ ...prev, api: 'offline', node: 'stopped' }));
        addLog('API Server: Offline', 'error');
      }
    } catch {
      setHealthStatus(prev => ({ ...prev, api: 'offline', node: 'stopped' }));
      addLog('API Server: Cannot connect', 'error');
    }
  }, [addLog]);

  // Detect hardware via sidecar API
  const detectHardware = useCallback(async () => {
    setDetectingHardware(true);
    setHealthStatus(prev => ({ ...prev, hardware: 'detecting' }));
    addLog('Detecting hardware...', 'info');

    try {
      // Use sidecar API (works in both Electron and Tauri)
      const res = await fetch('http://localhost:8080/api/v1/hardware');
      if (res.ok) {
        const data = await res.json();

        const hwInfo: HardwareInfo = {
          cpu: {
            model: data.cpu?.model || 'Unknown CPU',
            cores: data.cpu?.cores || navigator.hardwareConcurrency || 1,
            threads: data.cpu?.threads || navigator.hardwareConcurrency || 1,
          },
          memory: {
            total_mb: data.memory?.total_mb || 0,
            available_mb: data.memory?.available_mb || 0,
          },
          gpus: (data.gpus || []).map((g: any) => ({
            vendor: g.vendor || 'unknown',
            model: g.model || 'Unknown GPU',
            vram_mb: g.vram_mb || 0,
          })),
          storage: {
            total_gb: data.storage?.total_gb || 0,
            available_gb: data.storage?.available_gb || 0,
          },
        };

        setHardware(hwInfo);
        setHealthStatus(prev => ({ ...prev, hardware: 'detected' }));
        addLog(`CPU: ${hwInfo.cpu.model} (${hwInfo.cpu.cores} cores)`, 'success');
        addLog(`RAM: ${(hwInfo.memory.total_mb / 1024).toFixed(1)} GB`, 'success');
        if (hwInfo.gpus.length > 0) {
          hwInfo.gpus.forEach((gpu, i) => {
            addLog(`GPU ${i}: ${gpu.model} (${(gpu.vram_mb / 1024).toFixed(0)} GB)`, 'success');
          });
        } else {
          addLog('No GPU detected', 'info');
        }
      } else {
        throw new Error('Hardware API not available');
      }
    } catch (err) {
      addLog(`Hardware detection failed: ${err}`, 'error');
      setHealthStatus(prev => ({ ...prev, hardware: 'not_detected' }));

      // Fallback to browser detection
      setHardware({
        cpu: {
          model: 'Browser Detection (limited)',
          cores: navigator.hardwareConcurrency || 1,
          threads: navigator.hardwareConcurrency || 1,
        },
        memory: { total_mb: 0, available_mb: 0 },
        gpus: [],
        storage: { total_gb: 0, available_gb: 0 },
      });
    } finally {
      setDetectingHardware(false);
    }
  }, [addLog]);

  // Check node status via sidecar API
  const checkNodeStatus = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8080/health');
      if (res.ok) {
        const data = await res.json();
        // Health returns { status: 'healthy' } when running
        setNodeState({
          running: data.status === 'healthy' || data.status === 'ok',
          nodeId: data.nodeId || 'local-node',
        });
      }
    } catch {
      // Node status API not available
    }
  }, []);

  useEffect(() => {
    runHealthCheck();
    detectHardware();
    checkNodeStatus();

    const interval = setInterval(() => {
      runHealthCheck();
    }, 30000);

    return () => clearInterval(interval);
  }, [runHealthCheck, detectHardware, checkNodeStatus]);

  const formatMemory = (mb: number) => mb > 0 ? `${(mb / 1024).toFixed(1)} GB` : '--';

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'online':
      case 'running':
      case 'detected':
        return <CheckCircle size={16} style={{ color: 'var(--primary)' }} />;
      case 'offline':
      case 'error':
        return <XCircle size={16} style={{ color: 'var(--error)' }} />;
      case 'stopped':
      case 'not_detected':
        return <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />;
      default:
        return <Activity size={16} className="spin" style={{ color: 'var(--primary)' }} />;
    }
  };

  return (
    <div className="fade-in">
      {/* Health Status Banner */}
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">
            <Activity size={14} style={{ marginRight: '0.5rem' }} />
            SYSTEM STATUS
          </span>
          <CyberButton icon={RefreshCw} onClick={runHealthCheck}>
            HEALTH CHECK
          </CyberButton>
        </div>
        <div className="cyber-card-body">
          <div style={{ display: 'flex', gap: 'var(--gap-xl)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
              <StatusIcon status={healthStatus.api} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>API Server:</span>
              <span style={{
                color: healthStatus.api === 'online' ? 'var(--primary)' : 'var(--error)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                textTransform: 'uppercase',
              }}>
                {healthStatus.api}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
              <StatusIcon status={healthStatus.node} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Node:</span>
              <span style={{
                color: healthStatus.node === 'running' ? 'var(--primary)' : 'var(--warning)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                textTransform: 'uppercase',
              }}>
                {healthStatus.node}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
              <StatusIcon status={healthStatus.hardware} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Hardware:</span>
              <span style={{
                color: healthStatus.hardware === 'detected' ? 'var(--primary)' : 'var(--warning)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                textTransform: 'uppercase',
              }}>
                {healthStatus.hardware.replace('_', ' ')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* On-Chain Node Registration */}
      <NodeBlockchain
        localCapabilities={hardware && hardware.cpu.cores > 0 ? {
          cpuCores: hardware.cpu.cores,
          memoryMb: hardware.memory.total_mb,
          gpuCount: hardware.gpus.length,
          gpuVramMb: hardware.gpus.reduce((sum, g) => sum + g.vram_mb, 0),
          hasOllama: true,
          hasSandbox: true,
        } : undefined}
        nodeEndpoint={nodeState.nodeId || undefined}
        gpus={hardware?.gpus}
      />

      {/* Node Control Banner */}
      <div
        className="cyber-card"
        style={{
          marginBottom: 'var(--gap-xl)',
          background: nodeState.running
            ? 'linear-gradient(135deg, rgba(0, 212, 255, 0.1), rgba(155, 89, 182, 0.05))'
            : 'linear-gradient(135deg, var(--bg-secondary), var(--bg-primary))'
        }}
      >
        <div className="cyber-card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-lg)' }}>
            <div
              className={nodeState.running ? 'pulse-scale' : ''}
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                border: `2px solid ${nodeState.running ? 'var(--primary)' : 'var(--text-muted)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Power size={28} style={{ color: nodeState.running ? 'var(--primary)' : 'var(--text-muted)' }} />
            </div>
            <div>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '1.25rem',
                color: nodeState.running ? 'var(--primary)' : 'var(--text-primary)',
              }}>
                {nodeState.running ? 'NODE ACTIVE' : 'NODE STARTING...'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {nodeState.running
                  ? `Node ID: ${nodeState.nodeId || 'local-node'}`
                  : 'Waiting for services to initialize'
                }
              </div>
            </div>
          </div>
          <CyberButton icon={Activity} onClick={detectHardware} loading={detectingHardware}>
            DETECT HARDWARE
          </CyberButton>
        </div>
      </div>

      {/* IPFS and Ollama Panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--gap-lg)', marginBottom: 'var(--gap-lg)' }}>
        <IPFSPanel />
        <OllamaPanel />
      </div>

      {/* Hardware Info */}
      <div className="cyber-grid-layout">
        <div className="cyber-card">
          <div className="cyber-card-header">
            <span className="cyber-card-title">
              <Cpu size={14} style={{ marginRight: '0.5rem' }} />
              PROCESSOR
            </span>
          </div>
          <div className="cyber-card-body">
            {hardware && hardware.cpu.cores > 0 ? (
              <>
                <div style={{ marginBottom: 'var(--gap-md)' }}>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: '1rem', color: 'var(--primary)' }}>
                    {hardware.cpu.model}
                  </div>
                </div>
                <div className="hardware-grid">
                  <div className="hardware-item">
                    <div className="hardware-label">CORES</div>
                    <div className="hardware-value">{hardware.cpu.cores}</div>
                  </div>
                  <div className="hardware-item">
                    <div className="hardware-label">THREADS</div>
                    <div className="hardware-value">{hardware.cpu.threads}</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 'var(--gap-md)', color: 'var(--text-muted)' }}>
                <Cpu size={32} style={{ opacity: 0.3, marginBottom: 'var(--gap-sm)' }} />
                <div>Click "Detect Hardware" to scan</div>
              </div>
            )}
          </div>
        </div>

        <div className="cyber-card">
          <div className="cyber-card-header">
            <span className="cyber-card-title">
              <HardDrive size={14} style={{ marginRight: '0.5rem' }} />
              MEMORY & STORAGE
            </span>
          </div>
          <div className="cyber-card-body">
            {hardware && hardware.memory.total_mb > 0 ? (
              <div className="hardware-grid">
                <div className="hardware-item">
                  <div className="hardware-label">TOTAL RAM</div>
                  <div className="hardware-value">{formatMemory(hardware.memory.total_mb)}</div>
                </div>
                <div className="hardware-item">
                  <div className="hardware-label">AVAILABLE</div>
                  <div className="hardware-value" style={{ color: 'var(--primary)' }}>
                    {formatMemory(hardware.memory.available_mb)}
                  </div>
                </div>
                <div className="hardware-item">
                  <div className="hardware-label">STORAGE</div>
                  <div className="hardware-value">{hardware.storage.total_gb} GB</div>
                </div>
                <div className="hardware-item">
                  <div className="hardware-label">FREE</div>
                  <div className="hardware-value" style={{ color: 'var(--primary)' }}>
                    {hardware.storage.available_gb} GB
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 'var(--gap-md)', color: 'var(--text-muted)' }}>
                <HardDrive size={32} style={{ opacity: 0.3, marginBottom: 'var(--gap-sm)' }} />
                <div>Click "Detect Hardware" to scan</div>
              </div>
            )}
          </div>
        </div>

        <div className="cyber-card" style={{ gridColumn: '1 / -1' }}>
          <div className="cyber-card-header">
            <span className="cyber-card-title">
              <Zap size={14} style={{ marginRight: '0.5rem' }} />
              GPU ACCELERATORS
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--primary-light)' }}>
              {hardware?.gpus.length ?? 0} DETECTED
            </span>
          </div>
          <div className="cyber-card-body">
            {hardware?.gpus && hardware.gpus.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-md)' }}>
                {hardware.gpus.map((gpu, i) => (
                  <div key={i} className="node-item" style={{ background: 'rgba(129, 140, 248, 0.05)' }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: '8px',
                      border: '1px solid var(--primary-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--primary-light)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: '0.875rem',
                    }}>
                      #{i}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-sans)', color: 'var(--primary-light)', marginBottom: '4px' }}>
                        {gpu.model}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--primary)' }}>{(gpu.vram_mb / 1024).toFixed(0)} GB</span> VRAM
                      </div>
                    </div>
                    <div style={{
                      padding: '4px 12px',
                      background: gpu.vendor === 'nvidia' ? 'rgba(0, 212, 255, 0.1)' : 'rgba(255, 0, 128, 0.1)',
                      border: `1px solid ${gpu.vendor === 'nvidia' ? 'rgba(0, 212, 255, 0.3)' : 'rgba(255, 0, 128, 0.3)'}`,
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      color: gpu.vendor === 'nvidia' ? 'var(--primary)' : 'var(--accent)',
                      fontFamily: 'var(--font-mono)',
                      textTransform: 'uppercase',
                    }}>
                      {gpu.vendor}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Zap size={32} style={{ marginBottom: '0.5rem', opacity: 0.3 }} />
                <div>{hardware ? 'NO GPU DETECTED' : 'Click "Detect Hardware" to scan'}</div>
              </div>
            )}
          </div>
        </div>

        {/* Node Logs */}
        <div className="cyber-card" style={{ gridColumn: '1 / -1' }}>
          <div className="cyber-card-header">
            <span className="cyber-card-title">
              <Terminal size={14} style={{ marginRight: '0.5rem' }} />
              NODE LOGS
            </span>
          </div>
          <div className="cyber-card-body">
            <ActivityLog entries={logs} />
          </div>
        </div>
      </div>
    </div>
  );
}
