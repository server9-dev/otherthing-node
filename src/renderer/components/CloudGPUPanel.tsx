import { useState, useEffect, useCallback } from 'react';
import { Cloud, Cpu, Play, Square, Link, Unlink, DollarSign, Zap, RefreshCw, Settings, AlertTriangle, Wallet } from 'lucide-react';
import { CyberButton } from './CyberButton';
import { useWeb3 } from '../context/Web3Context';

const API_BASE = 'http://localhost:8080/api/v1/gpu';

interface GPUOffer {
  id: number;
  gpuName: string;
  gpuCount: number;
  gpuMemoryMb: number;
  cpuCores: number;
  ramMb: number;
  pricePerHour: number;
  location: string;
  reliability: number;
  verified: boolean;
  dlperf: number;
}

interface GPUInstance {
  id: number;
  status: string;
  gpuName: string;
  gpuCount: number;
  pricePerHour: number;
  totalCost: number;
  startedAt: Date;
  sshHost?: string;
  sshPort?: number;
  publicIp?: string;
  ollamaPort?: number;
}

interface TunnelInfo {
  instanceId: number;
  localPort: number;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
}

interface CloudGPUPanelProps {
  onEndpointChange?: (endpoint: string | null) => void;
}

// Raw Vast API types
interface RawVastOffer {
  id: number;
  machine_id: number;
  gpu_name: string;
  num_gpus: number;
  gpu_ram: number;
  cpu_cores_effective: number;
  cpu_ram: number;
  dph_total: number;
  geolocation?: string;
  reliability?: number;
  verified?: boolean;
  dlperf?: number;
}

interface RawVastInstance {
  id: number;
  actual_status: string;
  gpu_name: string;
  num_gpus: number;
  dph_total: number;
  total_cost?: number;
  start_date: number;
  ssh_host?: string;
  ssh_port?: number;
  public_ipaddr?: string;
  direct_port_start?: number;
}

export function CloudGPUPanel({ onEndpointChange }: CloudGPUPanelProps) {
  const { connected, address, connectWallet, isConnecting } = useWeb3();

  const [apiKey, setApiKey] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [offers, setOffers] = useState<GPUOffer[]>([]);
  const [instances, setInstances] = useState<GPUInstance[]>([]);
  const [tunnels, setTunnels] = useState<Map<number, TunnelInfo>>(new Map());
  const [balance, setBalance] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [renting, setRenting] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    maxPrice: 50,  // Show all price ranges by default
    gpuType: 'any' as string,
  });

  // Load API key tied to wallet address
  useEffect(() => {
    if (address) {
      const saved = localStorage.getItem(`cloudgpu_api_key_${address}`);
      if (saved) {
        setApiKey(saved);
        setIsConfigured(true);
      } else {
        setApiKey('');
        setIsConfigured(false);
      }
    }
  }, [address]);

  // Backend proxy API call (bypasses CORS)
  const gpuApi = useCallback(async <T,>(endpoint: string, params: Record<string, string> = {}): Promise<T> => {
    const searchParams = new URLSearchParams({ api_key: apiKey, ...params });
    const response = await fetch(`${API_BASE}${endpoint}?${searchParams}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText}`);
    }
    return response.json() as Promise<T>;
  }, [apiKey]);

  const handleSaveApiKey = async () => {
    if (!address) return;
    try {
      localStorage.setItem(`cloudgpu_api_key_${address}`, apiKey);
      setIsConfigured(true);
      setShowSettings(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure');
    }
  };

  const refreshOffers = useCallback(async () => {
    if (!isConfigured || !apiKey) return;
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filters.maxPrice < 10) {
        params.max_price = filters.maxPrice.toString();
      }
      if (filters.gpuType !== 'any') {
        params.gpu_type = filters.gpuType;
      }

      const result = await gpuApi<{ offers: RawVastOffer[] }>('/offers', params);

      const allOffers: GPUOffer[] = (result.offers || []).map(o => ({
        id: o.id,
        gpuName: o.gpu_name,
        gpuCount: o.num_gpus,
        gpuMemoryMb: o.gpu_ram,
        cpuCores: o.cpu_cores_effective,
        ramMb: o.cpu_ram,
        pricePerHour: o.dph_total,
        location: o.geolocation || 'Unknown',
        reliability: o.reliability || 0,
        verified: o.verified || false,
        dlperf: o.dlperf || 0,
      }));

      // Group by GPU type and take best from each, then fill with top overall
      const gpuGroups = new Map<string, GPUOffer[]>();
      allOffers.forEach(o => {
        const group = gpuGroups.get(o.gpuName) || [];
        group.push(o);
        gpuGroups.set(o.gpuName, group);
      });

      // Get best (cheapest) from each GPU type
      const diverse: GPUOffer[] = [];
      gpuGroups.forEach(group => {
        group.sort((a, b) => a.pricePerHour - b.pricePerHour);
        if (group[0]) diverse.push(group[0]);
      });

      // Sort by dlperf descending to show most powerful first
      diverse.sort((a, b) => b.dlperf - a.dlperf);

      setOffers(diverse.slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [isConfigured, apiKey, filters, gpuApi]);

  const refreshInstances = useCallback(async () => {
    if (!isConfigured || !apiKey) return;
    try {
      const [instancesRes, userRes] = await Promise.all([
        gpuApi<{ instances: RawVastInstance[] }>('/instances'),
        gpuApi<{ credit: number }>('/user'),
      ]);

      const mappedInstances: GPUInstance[] = (instancesRes.instances || []).map(i => ({
        id: i.id,
        status: i.actual_status,
        gpuName: i.gpu_name,
        gpuCount: i.num_gpus,
        pricePerHour: i.dph_total,
        totalCost: i.total_cost || 0,
        startedAt: new Date(i.start_date * 1000),
        sshHost: i.ssh_host,
        sshPort: i.ssh_port,
        publicIp: i.public_ipaddr,
        ollamaPort: i.direct_port_start ? i.direct_port_start + 11434 - 1 : undefined,
      }));

      setInstances(mappedInstances);
      setBalance(userRes.credit);
    } catch (err) {
      console.error('Failed to fetch instances:', err);
    }
  }, [isConfigured, apiKey, gpuApi]);

  useEffect(() => {
    if (isConfigured && apiKey) {
      refreshOffers();
      refreshInstances();
      const interval = setInterval(refreshInstances, 30000);
      return () => clearInterval(interval);
    }
  }, [isConfigured, apiKey, refreshOffers, refreshInstances]);

  const handleRent = async (offerId: number) => {
    setRenting(offerId);
    setError(null);
    try {
      const response = await fetch(`http://localhost:8080/api/v1/gpu/rent/${offerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
      }
      const result = await response.json();
      console.log('Rented:', result);
      // Refresh instances to show the new one
      await refreshInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rent');
    } finally {
      setRenting(null);
    }
  };

  const handleConnect = async (instanceId: number) => {
    setConnecting(instanceId);
    try {
      // For now just show instructions - SSH tunnel needs backend support
      setError('SSH tunnel requires desktop app backend. Use SSH manually: ssh -L 11434:localhost:11434 root@<instance-ip>');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (instanceId: number) => {
    setTunnels(prev => { const n = new Map(prev); n.delete(instanceId); return n; });
    onEndpointChange?.(null);
  };

  const handleTerminate = async (instanceId: number) => {
    if (!confirm('Stop this GPU? You will be charged for time used.')) return;
    try {
      const response = await fetch(
        `http://localhost:8080/api/v1/gpu/destroy/${instanceId}?api_key=${apiKey}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setInstances(prev => prev.filter(i => i.id !== instanceId));
      handleDisconnect(instanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
    }
  };

  const formatVram = (mb: number) => `${Math.round(mb / 1024)}GB`;
  const formatPrice = (p: number) => `$${p.toFixed(2)}/hr`;
  const formatRuntime = (d: Date) => {
    const ms = Date.now() - new Date(d).getTime();
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  };

  // Require wallet connection first
  if (!connected) {
    return (
      <div className="cloud-gpu-panel">
        <div className="panel-header"><Cloud size={20} /><span>Cloud GPU</span></div>
        <div className="panel-content">
          <p className="setup-info">
            Rent powerful cloud GPUs to run larger AI models. Connect your wallet to access Cloud GPU rental.
          </p>
          <div className="button-row">
            <CyberButton onClick={connectWallet} disabled={isConnecting}>
              <Wallet size={16} /> {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </CyberButton>
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (!isConfigured || showSettings) {
    return (
      <div className="cloud-gpu-panel">
        <div className="panel-header"><Cloud size={20} /><span>Cloud GPU</span></div>
        <div className="panel-content">
          <p className="setup-info">
            Rent powerful cloud GPUs to run larger AI models. Connects seamlessly to your workspace.
          </p>
          <div className="wallet-info">
            <Wallet size={14} /> Connected: {address?.slice(0, 6)}...{address?.slice(-4)}
          </div>
          <div className="input-group">
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your cloud GPU API key"
            />
            <a href="https://cloud.vast.ai/cli/" target="_blank" rel="noopener" className="api-link">
              Get API Key →
            </a>
          </div>
          {error && <div className="error-msg"><AlertTriangle size={14} /> {error}</div>}
          <div className="button-row">
            <CyberButton onClick={handleSaveApiKey} disabled={!apiKey}>
              <Zap size={16} /> Connect
            </CyberButton>
            {isConfigured && (
              <CyberButton variant="secondary" onClick={() => setShowSettings(false)}>Cancel</CyberButton>
            )}
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="cloud-gpu-panel">
      <div className="panel-header">
        <Cloud size={20} /><span>Cloud GPU</span>
        <div className="header-right">
          {balance !== null && <span className="balance"><DollarSign size={14} />{balance.toFixed(2)}</span>}
          <button className="icon-btn" onClick={() => setShowSettings(true)}><Settings size={16} /></button>
          <button className="icon-btn" onClick={() => { refreshOffers(); refreshInstances(); }}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="error-banner"><AlertTriangle size={14} /> {error}</div>}

      {instances.length > 0 && (
        <div className="section">
          <h3>Active GPUs</h3>
          {instances.map(inst => {
            const tunnel = tunnels.get(inst.id);
            return (
              <div key={inst.id} className={`instance-card ${inst.status}`}>
                <div className="inst-row">
                  <span className="gpu-label"><Cpu size={16} /> {inst.gpuName}</span>
                  <span className={`status ${inst.status}`}>{inst.status}</span>
                  <span className="meta">{formatRuntime(inst.startedAt)} · ${inst.totalCost.toFixed(2)}</span>
                </div>
                <div className="inst-actions">
                  {inst.status === 'running' && (
                    tunnel?.status === 'connected' ? (
                      <CyberButton size="small" variant="secondary" onClick={() => handleDisconnect(inst.id)}>
                        <Unlink size={14} /> Disconnect
                      </CyberButton>
                    ) : (
                      <CyberButton size="small" onClick={() => handleConnect(inst.id)} disabled={connecting === inst.id}>
                        <Link size={14} /> {connecting === inst.id ? 'Connecting...' : 'Connect'}
                      </CyberButton>
                    )
                  )}
                  <CyberButton size="small" variant="danger" onClick={() => handleTerminate(inst.id)}>
                    <Square size={14} /> Stop
                  </CyberButton>
                </div>
                {inst.sshHost && inst.sshPort && (
                  <div className="ssh-info">
                    <div className="ssh-label">SSH Tunnel Command:</div>
                    <code className="ssh-cmd" onClick={() => {
                      navigator.clipboard.writeText(`ssh -L 11434:localhost:11434 root@${inst.sshHost} -p ${inst.sshPort}`);
                    }}>
                      ssh -L 11434:localhost:11434 root@{inst.sshHost} -p {inst.sshPort}
                    </code>
                    <div className="ssh-hint">Click to copy. Then use Ollama at localhost:11434</div>
                  </div>
                )}
                {tunnel?.status === 'connected' && (
                  <div className="tunnel-active">
                    <Link size={12} /> Ollama at <code>localhost:{tunnel.localPort}</code>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h3>Available GPUs</h3>
          <div className="filters">
            <select value={filters.gpuType} onChange={e => setFilters(f => ({ ...f, gpuType: e.target.value }))}>
              <option value="any">Any GPU</option>
              <option value="RTX 5090">RTX 5090 32GB</option>
              <option value="RTX 4090">RTX 4090 24GB</option>
              <option value="A6000">A6000 48GB</option>
              <option value="A100">A100 80GB</option>
            </select>
            <select value={filters.maxPrice} onChange={e => setFilters(f => ({ ...f, maxPrice: +e.target.value }))}>
              <option value="1.0">Under $1/hr</option>
              <option value="2.0">Under $2/hr</option>
              <option value="5.0">Under $5/hr</option>
              <option value="50">Any price</option>
            </select>
          </div>
        </div>

        {loading ? <div className="loading">Searching...</div> : offers.length === 0 ? (
          <div className="empty">No GPUs match filters</div>
        ) : (
          <div className="offer-list">
            {offers.map(o => (
              <div key={o.id} className="offer-row">
                <div className="offer-gpu">
                  <Cpu size={16} />
                  <span className="name">{o.gpuName}</span>
                  <span className="vram">{formatVram(o.gpuMemoryMb)}</span>
                  {o.verified && <span className="verified">✓</span>}
                </div>
                <span className="offer-dlperf" title="Deep Learning Performance">{o.dlperf.toFixed(1)}</span>
                <span className="offer-loc">{o.location}</span>
                <span className="offer-price">{formatPrice(o.pricePerHour)}</span>
                <CyberButton size="small" onClick={() => handleRent(o.id)} disabled={renting !== null}>
                  {renting === o.id ? '...' : 'Rent'}
                </CyberButton>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
.cloud-gpu-panel {
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(0,255,157,0.2);
  border-radius: 8px;
}
.panel-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  background: rgba(0,255,157,0.1);
  border-bottom: 1px solid rgba(0,255,157,0.2);
  font-weight: 600;
}
.header-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.balance { display: flex; align-items: center; gap: 4px; color: #00ff9d; font-size: 14px; }
.icon-btn { background: none; border: none; color: rgba(255,255,255,0.6); cursor: pointer; padding: 4px; }
.icon-btn:hover { color: #00ff9d; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.panel-content, .section { padding: 16px; }
.section { border-top: 1px solid rgba(255,255,255,0.1); }
.section h3 { margin: 0 0 12px; font-size: 14px; color: rgba(255,255,255,0.8); }
.section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.filters { display: flex; gap: 8px; }
.filters select {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; color: white; padding: 4px 8px; font-size: 12px;
}
.setup-info { color: rgba(255,255,255,0.7); font-size: 14px; line-height: 1.5; margin-bottom: 16px; }
.wallet-info {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; margin-bottom: 16px;
  background: rgba(0,255,157,0.1); border-radius: 6px;
  font-size: 12px; color: #00ff9d;
}
.input-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.input-group label { font-size: 12px; color: rgba(255,255,255,0.6); }
.input-group input {
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; color: white; padding: 10px 12px; font-size: 14px;
}
.api-link {
  font-size: 12px; color: #00ff9d; text-decoration: none;
}
.api-link:hover { text-decoration: underline; }
.button-row { display: flex; gap: 8px; }
.error-msg, .error-banner {
  display: flex; align-items: center; gap: 8px;
  color: #ff6b6b; font-size: 13px; padding: 8px 12px;
  background: rgba(255,107,107,0.1); border-radius: 4px; margin-bottom: 12px;
}
.error-banner { margin: 0; border-radius: 0; }
.instance-card {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; padding: 12px; margin-bottom: 8px;
}
.instance-card.running { border-color: rgba(0,255,157,0.3); }
.inst-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.gpu-label { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.status { padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); font-size: 12px; }
.status.running { background: rgba(0,255,157,0.2); color: #00ff9d; }
.meta { margin-left: auto; font-size: 12px; color: rgba(255,255,255,0.5); }
.inst-actions { display: flex; gap: 8px; }
.ssh-info {
  margin-top: 10px; padding: 10px;
  background: rgba(0,0,0,0.4); border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.1);
}
.ssh-label { font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 6px; }
.ssh-cmd {
  display: block; padding: 8px 10px;
  background: rgba(0,255,157,0.1); border-radius: 4px;
  font-size: 12px; color: #00ff9d; cursor: pointer;
  word-break: break-all;
}
.ssh-cmd:hover { background: rgba(0,255,157,0.2); }
.ssh-hint { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 6px; }
.tunnel-active {
  display: flex; align-items: center; gap: 6px; margin-top: 8px;
  padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);
  font-size: 12px; color: #00ff9d;
}
.tunnel-active code { background: rgba(0,255,157,0.1); padding: 2px 6px; border-radius: 4px; }
.offer-list { display: flex; flex-direction: column; gap: 6px; }
.offer-row {
  display: flex; align-items: center; gap: 12px;
  background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; padding: 10px 12px;
}
.offer-gpu { display: flex; align-items: center; gap: 6px; flex: 1; }
.offer-gpu .name { font-weight: 600; }
.offer-gpu .vram { color: rgba(255,255,255,0.5); font-size: 12px; }
.offer-gpu .verified { color: #00ff9d; }
.offer-dlperf { font-size: 11px; color: #ffd700; min-width: 35px; font-family: monospace; }
.offer-loc { font-size: 12px; color: rgba(255,255,255,0.5); min-width: 50px; }
.offer-price { font-weight: 600; color: #00ff9d; min-width: 70px; }
.loading, .empty { text-align: center; padding: 24px; color: rgba(255,255,255,0.5); }
`;
