import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Plus, UserPlus, Copy, CheckCircle, Server,
  Globe, Lock, LogOut, RefreshCw, Zap, Trash2, ChevronRight
} from 'lucide-react';
import { CyberButton } from '../components';

const API_BASE = 'http://localhost:8080';

interface WorkspaceMember {
  userId: string;
  username: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

interface Workspace {
  id: string;
  name: string;
  description: string;
  isPrivate: boolean;
  inviteCode?: string;
  members: WorkspaceMember[];
  nodeCount: number;
  createdAt: string;
}

export function WorkspacePage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // UI state
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showJoinWorkspace, setShowJoinWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Load workspaces from local API
  const loadWorkspaces = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/v1/workspaces`);
      if (!res.ok) {
        throw new Error('Failed to load workspaces');
      }
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const createWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;

    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newWorkspaceName,
          description: newWorkspaceDesc,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create workspace');
      }

      setNewWorkspaceName('');
      setNewWorkspaceDesc('');
      setShowCreateWorkspace(false);
      loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setActionLoading(false);
    }
  };

  const joinWorkspace = async () => {
    if (!joinCode.trim()) return;

    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: joinCode }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to join workspace');
      }

      setJoinCode('');
      setShowJoinWorkspace(false);
      loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join workspace');
    } finally {
      setActionLoading(false);
    }
  };

  const leaveWorkspace = async (workspaceId: string) => {
    if (!confirm('Are you sure you want to leave this workspace?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/leave`, {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to leave workspace');
      }

      loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave workspace');
    }
  };

  const deleteWorkspace = async (workspaceId: string) => {
    if (!confirm('Are you sure you want to delete this workspace? This cannot be undone.')) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete workspace');
      }

      loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace');
    }
  };

  const regenerateInviteCode = async (workspaceId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/regenerate-invite`, {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to regenerate invite code');
      }

      loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate invite code');
    }
  };

  const totalNodes = workspaces.reduce((sum, ws) => sum + ws.nodeCount, 0);
  const totalMembers = new Set(workspaces.flatMap(ws => ws.members.map(m => m.userId))).size;

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
          <h2 className="page-title">Workspace</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
            Connect with friends and share compute resources
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
          <CyberButton icon={RefreshCw} onClick={loadWorkspaces} disabled={loading}>
            REFRESH
          </CyberButton>
          <CyberButton icon={UserPlus} onClick={() => setShowJoinWorkspace(true)}>
            JOIN
          </CyberButton>
          <CyberButton variant="primary" icon={Plus} onClick={() => setShowCreateWorkspace(true)}>
            CREATE WORKSPACE
          </CyberButton>
        </div>
      </div>

      {/* Error display */}
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
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: '1rem', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Stats Card */}
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-xl)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">NETWORK OVERVIEW</span>
        </div>
        <div className="cyber-card-body">
          <div style={{ display: 'flex', gap: 'var(--gap-xl)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {workspaces.length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Workspaces
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {totalMembers}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Connections
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--primary-light)' }}>
                {totalNodes}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Active Nodes
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Workspaces */}
      <div style={{ marginBottom: 'var(--gap-lg)' }}>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.9rem',
          color: 'var(--text-primary)',
          marginBottom: 'var(--gap-md)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Your Workspaces
        </h3>

        {loading ? (
          <div className="cyber-card">
            <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <p style={{ color: 'var(--text-muted)' }}>Loading workspaces...</p>
            </div>
          </div>
        ) : workspaces.length === 0 ? (
          <div className="cyber-card">
            <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <Users size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 'var(--gap-md)' }} />
              <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }}>
                No workspaces yet. Create one to start collaborating!
              </p>
              <CyberButton variant="primary" icon={Plus} onClick={() => setShowCreateWorkspace(true)}>
                CREATE YOUR FIRST WORKSPACE
              </CyberButton>
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: 'var(--gap-md)',
          }}>
            {workspaces.map(ws => (
              <div
                key={ws.id}
                className="cyber-card hover-lift"
                style={{ cursor: 'pointer', position: 'relative' }}
                onClick={() => navigate(`/workspace/${ws.id}`)}
              >
                <div className="cyber-card-body" style={{ padding: 'var(--gap-lg)' }}>
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
                        {ws.isPrivate ? <Lock size={14} style={{ color: 'var(--text-muted)' }} /> : <Globe size={14} style={{ color: 'var(--primary)' }} />}
                        <span style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: '1.1rem',
                          color: 'var(--text-primary)',
                        }}>
                          {ws.name}
                        </span>
                        <ChevronRight size={16} style={{ color: 'var(--text-muted)', marginLeft: 'auto' }} />
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {ws.description || 'No description'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                      {ws.inviteCode && (
                        <button
                          onClick={() => deleteWorkspace(ws.id)}
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid rgba(255, 0, 0, 0.3)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '6px',
                            cursor: 'pointer',
                            color: 'var(--error)',
                          }}
                          title="Delete workspace"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      {!ws.inviteCode && (
                        <button
                          onClick={() => leaveWorkspace(ws.id)}
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid rgba(255, 0, 0, 0.3)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '6px',
                            cursor: 'pointer',
                            color: 'var(--error)',
                          }}
                          title="Leave workspace"
                        >
                          <LogOut size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Invite Code (only for owners) */}
                  {ws.inviteCode && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--gap-sm)',
                        marginBottom: 'var(--gap-md)',
                        padding: 'var(--gap-sm)',
                        background: 'var(--bg-void)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>INVITE:</span>
                      <code style={{
                        flex: 1,
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--primary)',
                        letterSpacing: '0.1em',
                      }}>
                        {ws.inviteCode}
                      </code>
                      <button
                        onClick={() => copyInviteCode(ws.inviteCode!)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: copied === ws.inviteCode ? 'var(--primary)' : 'var(--text-muted)',
                          padding: '4px',
                        }}
                        title="Copy invite code"
                      >
                        {copied === ws.inviteCode ? <CheckCircle size={14} /> : <Copy size={14} />}
                      </button>
                      <button
                        onClick={() => regenerateInviteCode(ws.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          padding: '4px',
                        }}
                        title="Regenerate invite code"
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>
                  )}

                  {/* Members */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--gap-sm)',
                    marginBottom: 'var(--gap-md)',
                  }}>
                    <div style={{ display: 'flex' }}>
                      {ws.members.slice(0, 5).map((member, i) => (
                        <div
                          key={member.userId}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: member.role === 'owner' ? 'var(--primary)' : 'var(--bg-elevated)',
                            border: '2px solid var(--bg-surface)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.7rem',
                            color: member.role === 'owner' ? 'white' : 'var(--text-muted)',
                            marginLeft: i > 0 ? '-8px' : 0,
                            zIndex: 5 - i,
                          }}
                          title={`${member.username} (${member.role})`}
                        >
                          {member.username.charAt(0).toUpperCase()}
                        </div>
                      ))}
                      {ws.members.length > 5 && (
                        <div style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          background: 'var(--bg-void)',
                          border: '2px solid var(--bg-surface)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.6rem',
                          color: 'var(--text-muted)',
                          marginLeft: '-8px',
                        }}>
                          +{ws.members.length - 5}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {ws.members.length} member{ws.members.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Stats */}
                  <div style={{
                    display: 'flex',
                    gap: 'var(--gap-lg)',
                    padding: 'var(--gap-sm)',
                    background: 'var(--bg-void)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Server size={14} style={{ color: 'var(--primary)' }} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {ws.nodeCount} node{ws.nodeCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Zap size={14} style={{ color: ws.nodeCount > 0 ? 'var(--primary)' : 'var(--text-muted)' }} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {ws.nodeCount > 0 ? 'Compute available' : 'No nodes'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Workspace Modal */}
      {showCreateWorkspace && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setShowCreateWorkspace(false)}>
          <div
            className="cyber-card"
            style={{ width: '100%', maxWidth: 450 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cyber-card-header">
              <span className="cyber-card-title">CREATE WORKSPACE</span>
            </div>
            <div className="cyber-card-body">
              <div style={{ marginBottom: 'var(--gap-md)' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                }}>
                  Workspace Name
                </label>
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder="My Workspace"
                  className="settings-input"
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: 'var(--gap-lg)' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                }}>
                  Description (optional)
                </label>
                <textarea
                  value={newWorkspaceDesc}
                  onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                  placeholder="What's this workspace for?"
                  className="settings-input"
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--gap-sm)', justifyContent: 'flex-end' }}>
                <CyberButton onClick={() => setShowCreateWorkspace(false)} disabled={actionLoading}>
                  CANCEL
                </CyberButton>
                <CyberButton variant="primary" icon={Plus} onClick={createWorkspace} disabled={actionLoading || !newWorkspaceName.trim()}>
                  {actionLoading ? 'CREATING...' : 'CREATE'}
                </CyberButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Join Workspace Modal */}
      {showJoinWorkspace && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setShowJoinWorkspace(false)}>
          <div
            className="cyber-card"
            style={{ width: '100%', maxWidth: 450 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cyber-card-header">
              <span className="cyber-card-title">JOIN WORKSPACE</span>
            </div>
            <div className="cyber-card-body">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--gap-md)' }}>
                Enter the invite code shared with you to join a workspace.
              </p>
              <div style={{ marginBottom: 'var(--gap-lg)' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                }}>
                  Invite Code
                </label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter invite code..."
                  className="settings-input"
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--gap-sm)', justifyContent: 'flex-end' }}>
                <CyberButton onClick={() => setShowJoinWorkspace(false)} disabled={actionLoading}>
                  CANCEL
                </CyberButton>
                <CyberButton variant="primary" icon={UserPlus} onClick={joinWorkspace} disabled={actionLoading || !joinCode.trim()}>
                  {actionLoading ? 'JOINING...' : 'JOIN'}
                </CyberButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
