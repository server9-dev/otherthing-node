import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Plus, UserPlus, Copy, CheckCircle, Server,
  Globe, Lock, LogOut, RefreshCw, Zap, ChevronRight, Wallet, AlertCircle, Trash2
} from 'lucide-react';
import { CyberButton } from '../components';
import { useWeb3, OnChainWorkspace } from '../context/Web3Context';

export function WorkspacePage() {
  const navigate = useNavigate();
  const {
    connected,
    address,
    myWorkspaces,
    loadingWorkspaces,
    publicWorkspaces,
    refreshWorkspaces,
    createWorkspace,
    joinWorkspaceWithCode,
    joinPublicWorkspace,
    leaveWorkspace,
    deleteWorkspace,
    fetchPublicWorkspaces,
    setWorkspaceInviteCode,
    setShowQRModal,
    isConnecting,
  } = useWeb3();

  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // UI state
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showJoinWorkspace, setShowJoinWorkspace] = useState(false);
  const [showBrowsePublic, setShowBrowsePublic] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState('');
  const [newWorkspacePublic, setNewWorkspacePublic] = useState(false);
  const [newInviteCode, setNewInviteCode] = useState('');
  const [joinWorkspaceId, setJoinWorkspaceId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<string | null>(null);

  // Invite codes stored locally (since they're hashed on-chain)
  const [inviteCodes, setInviteCodes] = useState<Record<string, string>>({});

  // Load invite codes from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('workspace-invite-codes');
    if (stored) {
      try {
        setInviteCodes(JSON.parse(stored));
      } catch {
        // ignore
      }
    }
  }, []);

  // Save invite code to localStorage
  const saveInviteCode = (workspaceId: string, code: string) => {
    const updated = { ...inviteCodes, [workspaceId]: code };
    setInviteCodes(updated);
    localStorage.setItem('workspace-invite-codes', JSON.stringify(updated));
  };

  // Load public workspaces
  useEffect(() => {
    if (connected) {
      fetchPublicWorkspaces();
    }
  }, [connected]);

  const copyInviteCode = (workspaceId: string, code: string) => {
    // Copy format: workspaceId:inviteCode
    const fullCode = `${workspaceId}:${code}`;
    navigator.clipboard.writeText(fullCode);
    setCopied(workspaceId);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;

    // Generate invite code if private
    const inviteCode = !newWorkspacePublic
      ? newInviteCode || Math.random().toString(36).substring(2, 10).toUpperCase()
      : '';

    setActionLoading(true);
    setTransactionStatus('Sending transaction to blockchain...');
    setError(null);

    try {
      setTransactionStatus('Waiting for transaction confirmation...');
      const workspaceId = await createWorkspace(
        newWorkspaceName,
        newWorkspaceDesc,
        newWorkspacePublic,
        inviteCode
      );

      setTransactionStatus('Workspace created! Refreshing...');

      // Store invite code locally
      if (inviteCode) {
        saveInviteCode(workspaceId, inviteCode);
      }

      // Small delay to let the user see the success message
      await new Promise(resolve => setTimeout(resolve, 1000));

      setNewWorkspaceName('');
      setNewWorkspaceDesc('');
      setNewWorkspacePublic(false);
      setNewInviteCode('');
      setShowCreateWorkspace(false);
      setTransactionStatus(null);

      // Navigate to the new workspace
      navigate(`/workspace/${workspaceId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create workspace');
      setTransactionStatus(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinWorkspace = async () => {
    if (!joinCode.trim()) return;

    setActionLoading(true);
    setTransactionStatus('Sending join request to blockchain...');
    setError(null);

    try {
      // Parse the join code format: workspaceId:inviteCode
      let workspaceId: string;
      let inviteCode: string;

      if (joinCode.includes(':')) {
        [workspaceId, inviteCode] = joinCode.split(':');
      } else {
        // Old format or just invite code - need workspace ID
        if (!joinWorkspaceId) {
          setError('Please enter the full invite code (workspaceId:inviteCode)');
          setActionLoading(false);
          setTransactionStatus(null);
          return;
        }
        workspaceId = joinWorkspaceId;
        inviteCode = joinCode;
      }

      setTransactionStatus('Waiting for transaction confirmation...');
      await joinWorkspaceWithCode(workspaceId, inviteCode);

      setTransactionStatus('Successfully joined! Refreshing...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      setJoinCode('');
      setJoinWorkspaceId('');
      setShowJoinWorkspace(false);
      setTransactionStatus(null);

      // Navigate to the workspace
      navigate(`/workspace/${workspaceId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to join workspace');
      setTransactionStatus(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinPublicWorkspace = async (workspaceId: string) => {
    setActionLoading(true);
    setTransactionStatus('Joining public workspace...');
    setError(null);

    try {
      setTransactionStatus('Waiting for transaction confirmation...');
      await joinPublicWorkspace(workspaceId);

      setTransactionStatus('Successfully joined! Refreshing...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      setShowBrowsePublic(false);
      setTransactionStatus(null);

      // Navigate to the workspace
      navigate(`/workspace/${workspaceId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to join workspace');
      setTransactionStatus(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeaveWorkspace = async (workspaceId: string) => {
    if (!confirm('Are you sure you want to leave this workspace?')) return;

    try {
      await leaveWorkspace(workspaceId);
    } catch (err: any) {
      setError(err.message || 'Failed to leave workspace');
    }
  };

  const handleDeleteWorkspace = async (workspaceId: string) => {
    if (!confirm('Are you sure you want to DELETE this workspace? This will remove it from the blockchain and cannot be undone.')) return;

    setActionLoading(true);
    try {
      await deleteWorkspace(workspaceId);
      // Remove invite code from localStorage
      const updated = { ...inviteCodes };
      delete updated[workspaceId];
      setInviteCodes(updated);
      localStorage.setItem('workspace-invite-codes', JSON.stringify(updated));
    } catch (err: any) {
      setError(err.message || 'Failed to delete workspace');
    } finally {
      setActionLoading(false);
    }
  };

  const regenerateInviteCode = async (workspaceId: string) => {
    const newCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    try {
      await setWorkspaceInviteCode(workspaceId, newCode);
      saveInviteCode(workspaceId, newCode);
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate invite code');
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
      <div className="fade-in">
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--gap-xl)',
        }}>
          <div>
            <h2 className="page-title">Workspaces</h2>
            <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
              On-chain workspace management
            </p>
          </div>
        </div>

        <div className="cyber-card">
          <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
            <Wallet size={48} style={{ color: 'var(--primary)', opacity: 0.5, marginBottom: 'var(--gap-md)' }} />
            <h3 style={{ marginBottom: 'var(--gap-md)', color: 'var(--text-primary)' }}>
              Connect Wallet to View Workspaces
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--gap-lg)' }}>
              Workspaces are managed on-chain. Connect your wallet to create or join workspaces.
            </p>
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
      </div>
    );
  }

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
          <h2 className="page-title">Workspaces</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
            On-chain workspace management • {formatAddress(address!)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
          <CyberButton icon={RefreshCw} onClick={refreshWorkspaces} disabled={loadingWorkspaces}>
            REFRESH
          </CyberButton>
          <CyberButton icon={Globe} onClick={() => setShowBrowsePublic(true)}>
            BROWSE
          </CyberButton>
          <CyberButton icon={UserPlus} onClick={() => setShowJoinWorkspace(true)}>
            JOIN
          </CyberButton>
          <CyberButton variant="primary" icon={Plus} onClick={() => setShowCreateWorkspace(true)}>
            CREATE
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
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--gap-sm)',
        }}>
          <AlertCircle size={16} />
          {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Stats Card */}
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-xl)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">NETWORK OVERVIEW</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
            ON-CHAIN
          </span>
        </div>
        <div className="cyber-card-body">
          <div style={{ display: 'flex', gap: 'var(--gap-xl)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {myWorkspaces.length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                My Workspaces
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {publicWorkspaces.length}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Public Available
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

        {loadingWorkspaces ? (
          <div className="cyber-card">
            <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <p style={{ color: 'var(--text-muted)' }}>Loading from blockchain...</p>
            </div>
          </div>
        ) : myWorkspaces.length === 0 ? (
          <div className="cyber-card">
            <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <Users size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 'var(--gap-md)' }} />
              <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }}>
                No workspaces yet. Create one on-chain to start collaborating!
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
            {myWorkspaces.map(ws => {
              const isOwner = ws.owner.toLowerCase() === address?.toLowerCase();
              const inviteCode = inviteCodes[ws.id];

              return (
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
                          {ws.isPublic ? (
                            <Globe size={14} style={{ color: 'var(--primary)' }} />
                          ) : (
                            <Lock size={14} style={{ color: 'var(--text-muted)' }} />
                          )}
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
                        {isOwner ? (
                          <button
                            onClick={() => handleDeleteWorkspace(ws.id)}
                            disabled={actionLoading}
                            style={{
                              background: 'var(--bg-elevated)',
                              border: '1px solid rgba(255, 0, 0, 0.3)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '6px',
                              cursor: actionLoading ? 'wait' : 'pointer',
                              color: 'var(--error)',
                              opacity: actionLoading ? 0.5 : 1,
                            }}
                            title="Delete workspace"
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleLeaveWorkspace(ws.id)}
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

                    {/* Invite Code (only for owners with stored code) */}
                    {isOwner && inviteCode && !ws.isPublic && (
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
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--primary)',
                          letterSpacing: '0.05em',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {ws.id.slice(0, 10)}...:{inviteCode}
                        </code>
                        <button
                          onClick={() => copyInviteCode(ws.id, inviteCode)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: copied === ws.id ? 'var(--primary)' : 'var(--text-muted)',
                            padding: '4px',
                          }}
                          title="Copy invite code"
                        >
                          {copied === ws.id ? <CheckCircle size={14} /> : <Copy size={14} />}
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

                    {/* Stats */}
                    <div style={{
                      display: 'flex',
                      gap: 'var(--gap-lg)',
                      padding: 'var(--gap-sm)',
                      background: 'var(--bg-void)',
                      borderRadius: 'var(--radius-sm)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Users size={14} style={{ color: 'var(--primary)' }} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {Number(ws.memberCount)} member{Number(ws.memberCount) !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Zap size={14} style={{ color: isOwner ? 'var(--primary)' : 'var(--text-muted)' }} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {isOwner ? 'Owner' : 'Member'}
                        </span>
                      </div>
                    </div>

                    {/* Created date */}
                    <div style={{ marginTop: 'var(--gap-sm)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Created {formatDate(ws.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
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
              <span style={{ fontSize: '0.7rem', color: 'var(--primary)' }}>ON-CHAIN</span>
            </div>
            <div className="cyber-card-body">
              {transactionStatus ? (
                <div style={{
                  padding: 'var(--gap-md)',
                  background: 'rgba(0, 255, 136, 0.15)',
                  border: '1px solid rgba(0, 255, 136, 0.4)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--gap-md)',
                  textAlign: 'center',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--gap-sm)',
                    marginBottom: 'var(--gap-sm)',
                  }}>
                    <div className="spinner" style={{
                      width: 16,
                      height: 16,
                      border: '2px solid var(--primary)',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--primary)' }}>
                      {transactionStatus}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                    Please wait while the transaction is being processed...
                  </p>
                </div>
              ) : (
                <div style={{
                  padding: 'var(--gap-sm)',
                  background: 'rgba(0, 255, 136, 0.1)',
                  border: '1px solid rgba(0, 255, 136, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--gap-md)',
                  fontSize: '0.8rem',
                  color: 'var(--primary)',
                }}>
                  This will create a workspace on the Sepolia blockchain. Gas fees apply.
                </div>
              )}

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

              <div style={{ marginBottom: 'var(--gap-md)' }}>
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
                  rows={2}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div style={{ marginBottom: 'var(--gap-md)' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--gap-sm)',
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={newWorkspacePublic}
                    onChange={(e) => setNewWorkspacePublic(e.target.checked)}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Public workspace (anyone can join)
                  </span>
                </label>
              </div>

              {!newWorkspacePublic && (
                <div style={{ marginBottom: 'var(--gap-lg)' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    marginBottom: '4px',
                    textTransform: 'uppercase',
                  }}>
                    Invite Code (optional - auto-generated if empty)
                  </label>
                  <input
                    type="text"
                    value={newInviteCode}
                    onChange={(e) => setNewInviteCode(e.target.value.toUpperCase())}
                    placeholder="AUTO-GENERATED"
                    className="settings-input"
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--gap-sm)', justifyContent: 'flex-end' }}>
                <CyberButton onClick={() => setShowCreateWorkspace(false)} disabled={actionLoading}>
                  CANCEL
                </CyberButton>
                <CyberButton
                  variant="primary"
                  icon={Plus}
                  onClick={handleCreateWorkspace}
                  disabled={actionLoading || !newWorkspaceName.trim()}
                >
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
              {transactionStatus ? (
                <div style={{
                  padding: 'var(--gap-md)',
                  background: 'rgba(0, 255, 136, 0.15)',
                  border: '1px solid rgba(0, 255, 136, 0.4)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--gap-md)',
                  textAlign: 'center',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--gap-sm)',
                    marginBottom: 'var(--gap-sm)',
                  }}>
                    <div style={{
                      width: 16,
                      height: 16,
                      border: '2px solid var(--primary)',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--primary)' }}>
                      {transactionStatus}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                    Please wait while the transaction is being processed...
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--gap-md)' }}>
                  Enter the full invite code shared with you (format: workspaceId:inviteCode)
                </p>
              )}
              <div style={{ marginBottom: 'var(--gap-lg)' }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '4px',
                  textTransform: 'uppercase',
                }}>
                  Full Invite Code
                </label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="0x....:ABCD1234"
                  className="settings-input"
                  autoFocus
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--gap-sm)', justifyContent: 'flex-end' }}>
                <CyberButton onClick={() => setShowJoinWorkspace(false)} disabled={actionLoading}>
                  CANCEL
                </CyberButton>
                <CyberButton
                  variant="primary"
                  icon={UserPlus}
                  onClick={handleJoinWorkspace}
                  disabled={actionLoading || !joinCode.trim()}
                >
                  {actionLoading ? 'JOINING...' : 'JOIN'}
                </CyberButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Browse Public Workspaces Modal */}
      {showBrowsePublic && (
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
        }} onClick={() => setShowBrowsePublic(false)}>
          <div
            className="cyber-card"
            style={{ width: '100%', maxWidth: 600, maxHeight: '80vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cyber-card-header">
              <span className="cyber-card-title">PUBLIC WORKSPACES</span>
              <button
                onClick={() => fetchPublicWorkspaces()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="cyber-card-body">
              {publicWorkspaces.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--gap-xl)' }}>
                  No public workspaces available
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-md)' }}>
                  {publicWorkspaces.map(ws => {
                    const isMember = myWorkspaces.some(m => m.id === ws.id);

                    return (
                      <div
                        key={ws.id}
                        style={{
                          padding: 'var(--gap-md)',
                          background: 'var(--bg-void)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{
                              fontFamily: 'var(--font-display)',
                              fontSize: '1rem',
                              color: 'var(--text-primary)',
                              marginBottom: '4px',
                            }}>
                              {ws.name}
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 'var(--gap-sm)' }}>
                              {ws.description || 'No description'}
                            </p>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {Number(ws.memberCount)} members • Owner: {formatAddress(ws.owner)}
                            </div>
                          </div>
                          {isMember ? (
                            <span style={{
                              padding: '4px 8px',
                              background: 'rgba(0, 255, 136, 0.2)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.7rem',
                              color: 'var(--primary)',
                            }}>
                              JOINED
                            </span>
                          ) : (
                            <CyberButton
                              size="sm"
                              onClick={() => handleJoinPublicWorkspace(ws.id)}
                              disabled={actionLoading}
                            >
                              JOIN
                            </CyberButton>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
