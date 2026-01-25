import { useState, useEffect, useCallback } from 'react';
import {
  Store, Server, Cpu, HardDrive, Zap, Clock, DollarSign,
  RefreshCw, Search, Filter, ChevronDown, ExternalLink
} from 'lucide-react';
import { CyberButton } from '../components';
import { useWeb3 } from '../context/Web3Context';

interface RegisteredNode {
  nodeId: string;
  owner: string;
  gpuType: string;
  vramMB: number;
  cpuCores: number;
  ramMB: number;
  storageMB: number;
  hourlyRate: string;
  isActive: boolean;
  totalComputeSeconds: number;
  registeredAt: string;
}

const API_BASE = 'http://localhost:8080';

export function Marketplace() {
  const { account, isConnected } = useWeb3();
  const [nodes, setNodes] = useState<RegisteredNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'rate' | 'vram' | 'compute'>('rate');
  const [filterActive, setFilterActive] = useState(true);

  // Load nodes from blockchain registry
  const loadNodes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch from API which reads from blockchain
      const res = await fetch(`${API_BASE}/api/v1/blockchain/nodes`);
      if (!res.ok) {
        throw new Error('Failed to load nodes from registry');
      }

      const data = await res.json();
      setNodes(data.nodes || []);
    } catch (err) {
      console.error('Failed to load nodes:', err);
      setNodes([]);
      setError('Unable to connect to blockchain registry. Make sure the network is available.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  // Filter and sort nodes
  const filteredNodes = nodes
    .filter(node => {
      if (filterActive && !node.isActive) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          node.gpuType.toLowerCase().includes(query) ||
          node.owner.toLowerCase().includes(query) ||
          node.nodeId.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'rate':
          return parseFloat(a.hourlyRate) - parseFloat(b.hourlyRate);
        case 'vram':
          return b.vramMB - a.vramMB;
        case 'compute':
          return b.totalComputeSeconds - a.totalComputeSeconds;
        default:
          return 0;
      }
    });

  const formatBytes = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
    return `${mb} MB`;
  };

  const formatComputeTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    return `${hours}h`;
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 'var(--gap-xl)',
      }}>
        <div>
          <h2 className="page-title">Node Marketplace</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
            Browse and rent compute nodes from the decentralized network
          </p>
        </div>
        <CyberButton icon={RefreshCw} onClick={loadNodes} disabled={loading}>
          REFRESH
        </CyberButton>
      </div>

      {/* Stats */}
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-xl)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">NETWORK STATS</span>
        </div>
        <div className="cyber-card-body">
          <div style={{ display: 'flex', gap: 'var(--gap-xl)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {nodes.length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Registered Nodes
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {nodes.filter(n => n.isActive).length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Online Now
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--secondary)' }}>
                {formatBytes(nodes.reduce((sum, n) => sum + n.vramMB, 0))}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total VRAM
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
                {formatComputeTime(nodes.reduce((sum, n) => sum + n.totalComputeSeconds, 0))}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total Compute
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div style={{
        display: 'flex',
        gap: 'var(--gap-md)',
        marginBottom: 'var(--gap-lg)',
      }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by GPU, owner, or node ID..."
            className="settings-input"
            style={{ paddingLeft: 36 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 'var(--gap-sm)', alignItems: 'center' }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={filterActive}
              onChange={(e) => setFilterActive(e.target.checked)}
              style={{ accentColor: 'var(--primary)' }}
            />
            Active only
          </label>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="settings-input"
            style={{ width: 150, padding: '8px 12px' }}
          >
            <option value="rate">Sort: Lowest Rate</option>
            <option value="vram">Sort: Most VRAM</option>
            <option value="compute">Sort: Most Compute</option>
          </select>
        </div>
      </div>

      {/* Error/Info display */}
      {error && (
        <div style={{
          padding: 'var(--gap-md)',
          background: 'rgba(255, 200, 0, 0.1)',
          border: '1px solid rgba(255, 200, 0, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--warning)',
          marginBottom: 'var(--gap-lg)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}

      {/* Nodes Grid */}
      {loading ? (
        <div className="cyber-card">
          <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
            <p style={{ color: 'var(--text-muted)' }}>Loading nodes...</p>
          </div>
        </div>
      ) : filteredNodes.length === 0 ? (
        <div className="cyber-card">
          <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
            <Store size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 'var(--gap-md)' }} />
            <p style={{ color: 'var(--text-muted)' }}>
              No nodes found. Try adjusting your filters.
            </p>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
          gap: 'var(--gap-md)',
        }}>
          {filteredNodes.map(node => (
            <div key={node.nodeId} className="cyber-card hover-lift">
              <div className="cyber-card-body" style={{ padding: 'var(--gap-lg)' }}>
                {/* Header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 'var(--gap-md)',
                }}>
                  <div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--gap-sm)',
                      marginBottom: '4px',
                    }}>
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: node.isActive ? 'var(--primary)' : 'var(--text-muted)',
                      }} />
                      <span style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '1.1rem',
                        color: 'var(--text-primary)',
                      }}>
                        {node.gpuType}
                      </span>
                    </div>
                    <p style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {node.nodeId.slice(0, 10)}...{node.nodeId.slice(-8)}
                    </p>
                  </div>
                  <div style={{
                    background: 'var(--gradient-brand)',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-display)',
                    fontSize: '1rem',
                    color: 'white',
                  }}>
                    {node.hourlyRate} OTT/hr
                  </div>
                </div>

                {/* Specs */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 'var(--gap-sm)',
                  marginBottom: 'var(--gap-md)',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: 'var(--gap-sm)',
                    background: 'var(--bg-void)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <Zap size={14} style={{ color: 'var(--primary)' }} />
                    <div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {formatBytes(node.vramMB)}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        VRAM
                      </div>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: 'var(--gap-sm)',
                    background: 'var(--bg-void)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <Cpu size={14} style={{ color: 'var(--secondary)' }} />
                    <div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {node.cpuCores} cores
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        CPU
                      </div>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: 'var(--gap-sm)',
                    background: 'var(--bg-void)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <Server size={14} style={{ color: 'var(--accent)' }} />
                    <div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {formatBytes(node.ramMB)}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        RAM
                      </div>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: 'var(--gap-sm)',
                    background: 'var(--bg-void)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <HardDrive size={14} style={{ color: 'var(--primary-light)' }} />
                    <div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {formatBytes(node.storageMB)}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Storage
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: 'var(--gap-sm)',
                  background: 'var(--bg-void)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--gap-md)',
                  fontSize: '0.8rem',
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    <Clock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    {formatComputeTime(node.totalComputeSeconds)} compute
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    Registered {new Date(node.registeredAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
                  <CyberButton
                    variant="primary"
                    style={{ flex: 1 }}
                    disabled={!node.isActive || !isConnected}
                  >
                    {!isConnected ? 'CONNECT WALLET' : node.isActive ? 'RENT NODE' : 'OFFLINE'}
                  </CyberButton>
                  <CyberButton icon={ExternalLink} title="View on explorer">
                    VIEW
                  </CyberButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
