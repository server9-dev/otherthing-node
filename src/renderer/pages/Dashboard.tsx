import { useState, useEffect, useCallback } from 'react';
import { Cpu, HardDrive, Zap, Activity, Server, Clock, ArrowUp, ArrowDown, CheckCircle, XCircle } from 'lucide-react';

interface Stats {
  activeJobs: number;
  completedJobs: number;
  totalCompute: number;
  earnings: number;
}

interface ServiceStatus {
  ipfs: { running: boolean; peerId: string | null };
  ollama: { running: boolean; models: number };
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    activeJobs: 0,
    completedJobs: 0,
    totalCompute: 0,
    earnings: 0,
  });
  const [nodeStatus, setNodeStatus] = useState<'offline' | 'idle' | 'working'>('offline');
  const [services, setServices] = useState<ServiceStatus>({
    ipfs: { running: false, peerId: null },
    ollama: { running: false, models: 0 },
  });

  const checkServices = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const ipfsStatus = await window.electronAPI.getIPFSStatus();
      const ollamaStatus = await window.electronAPI.getOllamaStatus();

      setServices({
        ipfs: { running: ipfsStatus.running, peerId: ipfsStatus.peerId },
        ollama: { running: ollamaStatus.running, models: ollamaStatus.models?.length || 0 },
      });
    } catch (err) {
      console.error('Failed to check services:', err);
    }
  }, []);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('http://localhost:8080/health');
        if (res.ok) {
          setNodeStatus('idle');
        } else {
          setNodeStatus('offline');
        }
      } catch {
        setNodeStatus('offline');
      }
    };

    checkStatus();
    checkServices();
    const interval = setInterval(() => {
      checkStatus();
      checkServices();
    }, 5000);
    return () => clearInterval(interval);
  }, [checkServices]);

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 'var(--gap-xl)' }}>
        <h1 className="page-title">Dashboard</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)' }}>
          Monitor your node's performance and earnings
        </p>
      </div>

      {/* Status Banner */}
      <div
        className="cyber-card"
        style={{
          marginBottom: 'var(--gap-xl)',
          background: nodeStatus === 'offline'
            ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.05))'
            : nodeStatus === 'working'
            ? 'linear-gradient(135deg, rgba(0, 212, 255, 0.1), rgba(155, 89, 182, 0.05))'
            : 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(99, 102, 241, 0.05))',
        }}
      >
        <div className="cyber-card-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-lg)' }}>
          <div
            className={nodeStatus === 'working' ? 'pulse-scale' : ''}
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              border: `2px solid ${
                nodeStatus === 'offline' ? 'var(--error)' :
                nodeStatus === 'working' ? 'var(--primary)' : 'var(--primary)'
              }`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Server size={28} style={{
              color: nodeStatus === 'offline' ? 'var(--error)' :
                     nodeStatus === 'working' ? 'var(--primary)' : 'var(--primary)'
            }} />
          </div>
          <div>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.25rem',
              color: nodeStatus === 'offline' ? 'var(--error)' :
                     nodeStatus === 'working' ? 'var(--primary)' : 'var(--primary)',
              textTransform: 'uppercase',
            }}>
              {nodeStatus === 'offline' ? 'Node Offline' :
               nodeStatus === 'working' ? 'Processing Job' : 'Node Ready'}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {nodeStatus === 'offline'
                ? 'Waiting for backend services to start...'
                : 'Your node is contributing compute to the network'}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card hover-lift">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', marginBottom: 'var(--gap-sm)' }}>
            <Activity size={20} style={{ color: 'var(--primary)' }} />
            <span className="stat-label">Active Jobs</span>
          </div>
          <div className="stat-value">{stats.activeJobs}</div>
        </div>

        <div className="stat-card hover-lift">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', marginBottom: 'var(--gap-sm)' }}>
            <Zap size={20} style={{ color: 'var(--primary)' }} />
            <span className="stat-label">Completed Jobs</span>
          </div>
          <div className="stat-value">{stats.completedJobs}</div>
        </div>

        <div className="stat-card hover-lift">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', marginBottom: 'var(--gap-sm)' }}>
            <Clock size={20} style={{ color: 'var(--warning)' }} />
            <span className="stat-label">Compute Hours</span>
          </div>
          <div className="stat-value">{stats.totalCompute.toFixed(1)}</div>
        </div>

        <div className="stat-card hover-lift">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', marginBottom: 'var(--gap-sm)' }}>
            <ArrowUp size={20} style={{ color: 'var(--info)' }} />
            <span className="stat-label">Earnings (OTT)</span>
          </div>
          <div className="stat-value">{stats.earnings.toFixed(2)}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="cyber-grid-layout">
        <div className="cyber-card">
          <div className="cyber-card-header">
            <span className="cyber-card-title">
              <Cpu size={14} style={{ marginRight: '0.5rem' }} />
              Quick Stats
            </span>
          </div>
          <div className="cyber-card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Uptime</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>--:--:--</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Network Status</span>
                <span style={{ color: 'var(--text-secondary)' }}>Local Only</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>API Port</span>
                <span style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>8080</span>
              </div>
            </div>
          </div>
        </div>

        <div className="cyber-card">
          <div className="cyber-card-header">
            <span className="cyber-card-title">
              <HardDrive size={14} style={{ marginRight: '0.5rem' }} />
              Services
            </span>
          </div>
          <div className="cyber-card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>IPFS</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-xs)' }}>
                  {services.ipfs.running ? (
                    <CheckCircle size={14} style={{ color: 'var(--primary)' }} />
                  ) : (
                    <XCircle size={14} style={{ color: 'var(--accent)' }} />
                  )}
                  <span style={{ color: services.ipfs.running ? 'var(--primary)' : 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                    {services.ipfs.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Ollama</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-xs)' }}>
                  {services.ollama.running ? (
                    <CheckCircle size={14} style={{ color: 'var(--primary)' }} />
                  ) : (
                    <XCircle size={14} style={{ color: 'var(--accent)' }} />
                  )}
                  <span style={{ color: services.ollama.running ? 'var(--primary)' : 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                    {services.ollama.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>LLM Models</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {services.ollama.models}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
