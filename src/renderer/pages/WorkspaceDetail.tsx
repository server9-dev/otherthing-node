import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Server, Users, Bot, FolderOpen, Plus, Copy, Check,
  RefreshCw, Trash2, Settings, Zap, Globe, Lock, Wallet
} from 'lucide-react';
import { CyberButton } from '../components';
import { useWeb3, OnChainWorkspace } from '../context/Web3Context';

const API_BASE = 'http://localhost:8080';

interface WorkspaceNode {
  id: string;
  shareKey: string;
  name?: string;
  status: 'online' | 'offline';
  hardware?: {
    cpuCores: number;
    memoryMb: number;
    gpuCount: number;
  };
  addedAt: string;
}

export function WorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const {
    connected,
    address,
    myWorkspaces,
    loadingWorkspaces,
    refreshWorkspaces,
    getWorkspaceMembers,
    setShowQRModal,
    isConnecting,
  } = useWeb3();

  const [workspace, setWorkspace] = useState<OnChainWorkspace | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddNode, setShowAddNode] = useState(false);
  const [shareKey, setShareKey] = useState('');
  const [addingNode, setAddingNode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localNodeKey, setLocalNodeKey] = useState<string | null>(null);

  // Get invite code from localStorage (since it's hashed on-chain)
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('workspace-invite-codes');
    if (stored && workspaceId) {
      try {
        const codes = JSON.parse(stored);
        setInviteCode(codes[workspaceId] || null);
      } catch {
        // ignore
      }
    }
  }, [workspaceId]);

  // Load workspace from Web3 context (on-chain data)
  const loadWorkspace = useCallback(async () => {
    if (!workspaceId || !connected) return;

    setLoading(true);
    try {
      // Find workspace in myWorkspaces (already fetched from chain)
      const found = myWorkspaces.find(ws => ws.id === workspaceId);
      if (found) {
        setWorkspace(found);
        // Also fetch members
        try {
          const memberList = await getWorkspaceMembers(workspaceId);
          setMembers(memberList);
        } catch (err) {
          console.error('Failed to load members:', err);
        }
      } else {
        // Workspace not in user's list - refresh and try again
        await refreshWorkspaces();
        const retryFound = myWorkspaces.find(ws => ws.id === workspaceId);
        if (retryFound) {
          setWorkspace(retryFound);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, connected, myWorkspaces, refreshWorkspaces, getWorkspaceMembers]);

  // Load workspace nodes
  const loadNodes = useCallback(async () => {
    if (!workspaceId) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/nodes`);
      if (res.ok) {
        const data = await res.json();
        setNodes(data.nodes || []);
      }
    } catch (err) {
      console.error('Failed to load nodes:', err);
    }
  }, [workspaceId]);

  // Get local node's share key
  const loadLocalNodeKey = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/my-nodes`);
      if (res.ok) {
        const data = await res.json();
        if (data.nodes && data.nodes.length > 0) {
          setLocalNodeKey(data.nodes[0].shareKey);
        }
      }
    } catch (err) {
      console.error('Failed to get local node key:', err);
    }
  }, []);

  useEffect(() => {
    if (connected && workspaceId) {
      loadWorkspace();
      loadNodes();
      loadLocalNodeKey();
    }
  }, [connected, workspaceId, loadWorkspace, loadNodes, loadLocalNodeKey]);

  // Also refresh when myWorkspaces changes
  useEffect(() => {
    if (workspaceId && myWorkspaces.length > 0) {
      const found = myWorkspaces.find(ws => ws.id === workspaceId);
      if (found) {
        setWorkspace(found);
        setLoading(false);
      }
    }
  }, [workspaceId, myWorkspaces]);

  const addNodeByKey = async () => {
    if (!shareKey.trim() || !workspaceId) return;

    setAddingNode(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/nodes/add-by-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareKey: shareKey.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add node');
      }

      setShareKey('');
      setShowAddNode(false);
      loadNodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add node');
    } finally {
      setAddingNode(false);
    }
  };

  const addLocalNode = async () => {
    if (!localNodeKey || !workspaceId) return;

    setAddingNode(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/nodes/add-by-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareKey: localNodeKey }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add node');
      }

      loadNodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add node');
    } finally {
      setAddingNode(false);
    }
  };

  const removeNode = async (nodeId: string) => {
    if (!confirm('Remove this node from the workspace?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/nodes/${nodeId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove node');
      }

      loadNodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove node');
    }
  };

  const copyInviteCode = () => {
    if (inviteCode && workspaceId) {
      // Copy full format: workspaceId:inviteCode
      const fullCode = `${workspaceId}:${inviteCode}`;
      navigator.clipboard.writeText(fullCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatDate = (timestamp: bigint) => {
    return new Date(Number(timestamp) * 1000).toLocaleDateString();
  };

  // Not connected state
  if (!connected) {
    return (
      <div className="fade-in" style={{ textAlign: 'center', padding: '4rem' }}>
        <Wallet size={48} style={{ color: 'var(--primary)', opacity: 0.5, marginBottom: 'var(--gap-md)' }} />
        <h3 style={{ marginBottom: 'var(--gap-md)', color: 'var(--text-primary)' }}>
          Connect Wallet to View Workspace
        </h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--gap-lg)' }}>
          Workspaces are managed on-chain. Connect your wallet to view this workspace.
        </p>
        <div style={{ display: 'flex', gap: 'var(--gap-sm)', justifyContent: 'center' }}>
          <CyberButton icon={ArrowLeft} onClick={() => navigate('/workspace')}>
            Back
          </CyberButton>
          <CyberButton
            variant="primary"
            icon={Wallet}
            onClick={() => setShowQRModal(true)}
            disabled={isConnecting}
          >
            {isConnecting ? 'CONNECTING...' : 'CONNECT WALLET'}
          </CyberButton>
        </div>
      </div>
    );
  }

  if (loading || loadingWorkspaces) {
    return (
      <div className="fade-in" style={{ textAlign: 'center', padding: '4rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading workspace from blockchain...</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="fade-in" style={{ textAlign: 'center', padding: '4rem' }}>
        <p style={{ color: 'var(--error)', marginBottom: 'var(--gap-md)' }}>Workspace not found</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--gap-lg)' }}>
          This workspace may not exist on-chain or you may not be a member.
        </p>
        <CyberButton icon={ArrowLeft} onClick={() => navigate('/workspace')}>
          Back to Workspaces
        </CyberButton>
      </div>
    );
  }

  const isOwner = workspace.owner.toLowerCase() === address?.toLowerCase();

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
          <button
            onClick={() => navigate('/workspace')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              marginBottom: 'var(--gap-sm)',
              fontSize: '0.85rem',
            }}
          >
            <ArrowLeft size={16} />
            Back to Workspaces
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
            {workspace.isPublic ? (
              <Globe size={20} style={{ color: 'var(--primary)' }} />
            ) : (
              <Lock size={20} style={{ color: 'var(--text-muted)' }} />
            )}
            <h2 className="page-title">{workspace.name}</h2>
          </div>
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
            {workspace.description || 'No description'}
          </p>
          <p style={{ color: 'var(--text-muted)', marginTop: '4px', fontSize: '0.75rem' }}>
            Owner: {formatAddress(workspace.owner)} • {Number(workspace.memberCount)} member{Number(workspace.memberCount) !== 1 ? 's' : ''} • Created {formatDate(workspace.createdAt)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
          <CyberButton icon={RefreshCw} onClick={() => { refreshWorkspaces(); loadNodes(); }}>
            REFRESH
          </CyberButton>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: 'var(--gap-md)',
          background: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid rgba(255, 0, 0, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--error)',
          marginBottom: 'var(--gap-lg)',
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '1rem', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {/* Quick Actions */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 'var(--gap-md)',
        marginBottom: 'var(--gap-xl)',
      }}>
        <Link to={`/workspace/${workspaceId}/agents`} style={{ textDecoration: 'none' }}>
          <div className="cyber-card hover-lift" style={{ cursor: 'pointer' }}>
            <div className="cyber-card-body" style={{ padding: 'var(--gap-lg)', textAlign: 'center' }}>
              <Bot size={32} style={{ color: 'var(--primary)', marginBottom: 'var(--gap-sm)' }} />
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--text-primary)' }}>
                AI Agents
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Chat & run tasks
              </div>
            </div>
          </div>
        </Link>

        <div className="cyber-card hover-lift" style={{ cursor: 'pointer' }} onClick={() => navigate(`/workspace/${workspaceId}/files`)}>
          <div className="cyber-card-body" style={{ padding: 'var(--gap-lg)', textAlign: 'center' }}>
            <FolderOpen size={32} style={{ color: 'var(--secondary)', marginBottom: 'var(--gap-sm)' }} />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--text-primary)' }}>
              Files
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Browse & upload
            </div>
          </div>
        </div>

        <div className="cyber-card hover-lift" style={{ cursor: 'pointer' }} onClick={() => setShowAddNode(true)}>
          <div className="cyber-card-body" style={{ padding: 'var(--gap-lg)', textAlign: 'center' }}>
            <Server size={32} style={{ color: 'var(--accent)', marginBottom: 'var(--gap-sm)' }} />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--text-primary)' }}>
              Add Compute
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {nodes.length} node{nodes.length !== 1 ? 's' : ''} connected
            </div>
          </div>
        </div>
      </div>

      {/* Invite Code (only show for owners of private workspaces who have the code stored) */}
      {isOwner && inviteCode && !workspace.isPublic && (
        <div className="cyber-card" style={{ marginBottom: 'var(--gap-xl)' }}>
          <div className="cyber-card-header">
            <span className="cyber-card-title">INVITE CODE</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--primary)' }}>PRIVATE WORKSPACE</span>
          </div>
          <div className="cyber-card-body">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--gap-md)',
            }}>
              <code style={{
                flex: 1,
                fontSize: '0.9rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--primary)',
                letterSpacing: '0.1em',
                background: 'var(--bg-void)',
                padding: 'var(--gap-md)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {workspaceId?.slice(0, 10)}...:{inviteCode}
              </code>
              <CyberButton icon={copied ? Check : Copy} onClick={copyInviteCode}>
                {copied ? 'COPIED' : 'COPY'}
              </CyberButton>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 'var(--gap-sm)' }}>
              Share the full invite code with others to let them join your workspace
            </p>
          </div>
        </div>
      )}

      {/* Members Card */}
      {members.length > 0 && (
        <div className="cyber-card" style={{ marginBottom: 'var(--gap-xl)' }}>
          <div className="cyber-card-header">
            <span className="cyber-card-title">MEMBERS</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{members.length} total</span>
          </div>
          <div className="cyber-card-body">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gap-sm)' }}>
              {members.map((member, idx) => (
                <div
                  key={member}
                  style={{
                    padding: '6px 12px',
                    background: member.toLowerCase() === workspace.owner.toLowerCase() ? 'rgba(0, 255, 136, 0.15)' : 'var(--bg-void)',
                    borderRadius: 'var(--radius-sm)',
                    border: member.toLowerCase() === workspace.owner.toLowerCase() ? '1px solid rgba(0, 255, 136, 0.3)' : '1px solid var(--border-subtle)',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)',
                    color: member.toLowerCase() === workspace.owner.toLowerCase() ? 'var(--primary)' : 'var(--text-secondary)',
                  }}
                >
                  {formatAddress(member)}
                  {member.toLowerCase() === workspace.owner.toLowerCase() && ' (owner)'}
                  {member.toLowerCase() === address?.toLowerCase() && member.toLowerCase() !== workspace.owner.toLowerCase() && ' (you)'}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Connected Nodes */}
      <div className="cyber-card">
        <div className="cyber-card-header">
          <span className="cyber-card-title">CONNECTED COMPUTE NODES</span>
          <CyberButton variant="primary" icon={Plus} onClick={() => setShowAddNode(true)}>
            ADD NODE
          </CyberButton>
        </div>
        <div className="cyber-card-body">
          {nodes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <Server size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 'var(--gap-md)' }} />
              <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }}>
                No compute nodes connected yet
              </p>
              {localNodeKey && (
                <CyberButton variant="primary" icon={Zap} onClick={addLocalNode} disabled={addingNode}>
                  {addingNode ? 'ADDING...' : 'ADD MY NODE'}
                </CyberButton>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
              {nodes.map(node => (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--gap-md)',
                    background: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-md)' }}>
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: node.status === 'online' ? 'var(--primary)' : 'var(--text-muted)',
                    }} />
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                        {node.name || node.shareKey.slice(0, 8)}
                      </div>
                      {node.hardware && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {node.hardware.cpuCores} CPU • {Math.round(node.hardware.memoryMb / 1024)}GB RAM
                          {node.hardware.gpuCount > 0 && ` • ${node.hardware.gpuCount} GPU`}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeNode(node.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--error)',
                      cursor: 'pointer',
                      padding: '8px',
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              {localNodeKey && !nodes.some(n => n.shareKey === localNodeKey) && (
                <div style={{ marginTop: 'var(--gap-md)', textAlign: 'center' }}>
                  <CyberButton icon={Zap} onClick={addLocalNode} disabled={addingNode}>
                    {addingNode ? 'ADDING...' : 'ADD MY NODE'}
                  </CyberButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Node Modal */}
      {showAddNode && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setShowAddNode(false)}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--gap-xl)',
              maxWidth: '450px',
              width: '90%',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: 'var(--gap-lg)', fontFamily: 'var(--font-display)' }}>
              Add Compute Node
            </h3>

            {localNodeKey && (
              <div style={{ marginBottom: 'var(--gap-lg)' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 'var(--gap-sm)' }}>
                  Quick add your local node:
                </p>
                <CyberButton variant="primary" icon={Zap} onClick={addLocalNode} disabled={addingNode} style={{ width: '100%' }}>
                  {addingNode ? 'ADDING...' : 'ADD MY NODE'}
                </CyberButton>
                <div style={{
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.8rem',
                  margin: 'var(--gap-md) 0',
                }}>
                  — or add by share key —
                </div>
              </div>
            )}

            <div style={{ marginBottom: 'var(--gap-md)' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Node Share Key
              </label>
              <input
                type="text"
                value={shareKey}
                onChange={e => setShareKey(e.target.value)}
                placeholder="Enter 8-character share key"
                style={{
                  width: '100%',
                  padding: 'var(--gap-md)',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
              <CyberButton onClick={() => setShowAddNode(false)} style={{ flex: 1 }}>
                CANCEL
              </CyberButton>
              <CyberButton
                variant="primary"
                icon={Plus}
                onClick={addNodeByKey}
                disabled={!shareKey.trim() || addingNode}
                style={{ flex: 1 }}
              >
                {addingNode ? 'ADDING...' : 'ADD NODE'}
              </CyberButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
