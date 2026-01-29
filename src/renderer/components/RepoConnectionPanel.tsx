/**
 * Repository Connection Panel
 *
 * Allows users to connect to repositories via GitHub OAuth or SSH keys.
 * Part of the on-bored integration for codebase analysis.
 */

import { useState, useEffect } from 'react';
import {
  Github, Key, Plus, Trash2, Copy, Check, ExternalLink,
  RefreshCw, Eye, EyeOff, FolderGit2, AlertCircle
} from 'lucide-react';
import { CyberButton } from './CyberButton';

const API_BASE = 'http://localhost:8080';

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

interface SSHKey {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  addedAt: string;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
  clone_url: string;
  ssh_url: string;
}

interface RepoConnectionPanelProps {
  workspaceId: string;
  onRepoConnected?: (repoUrl: string, repoName: string) => void;
}

export function RepoConnectionPanel({ workspaceId, onRepoConnected }: RepoConnectionPanelProps) {
  const [activeTab, setActiveTab] = useState<'github' | 'ssh' | 'manual'>('github');
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SSH key form
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyContent, setNewKeyContent] = useState('');
  const [showKeyContent, setShowKeyContent] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Manual repo form
  const [manualRepoUrl, setManualRepoUrl] = useState('');

  useEffect(() => {
    loadGitHubStatus();
    loadSSHKeys();
  }, []);

  const loadGitHubStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/git/github/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setGithubUser(data.user);
          loadGitHubRepos();
        }
      }
    } catch (err) {
      console.error('Failed to load GitHub status:', err);
    }
  };

  const loadGitHubRepos = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/git/github/repos`);
      if (res.ok) {
        const data = await res.json();
        setGithubRepos(data.repos || []);
      }
    } catch (err) {
      console.error('Failed to load GitHub repos:', err);
    }
  };

  const loadSSHKeys = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/git/ssh-keys`);
      if (res.ok) {
        const data = await res.json();
        setSSHKeys(data.keys || []);
      }
    } catch (err) {
      console.error('Failed to load SSH keys:', err);
    }
  };

  const connectGitHub = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/git/github/auth-url`);
      const data = await res.json();
      if (data.url) {
        // Open GitHub OAuth in a new window
        window.open(data.url, '_blank', 'width=600,height=700');
        // Poll for completion
        const pollInterval = setInterval(async () => {
          const statusRes = await fetch(`${API_BASE}/api/v1/git/github/status`);
          const statusData = await statusRes.json();
          if (statusData.connected) {
            clearInterval(pollInterval);
            setGithubUser(statusData.user);
            loadGitHubRepos();
            setLoading(false);
          }
        }, 2000);
        // Stop polling after 2 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          setLoading(false);
        }, 120000);
      }
    } catch (err) {
      setError('Failed to start GitHub OAuth');
      setLoading(false);
    }
  };

  const disconnectGitHub = async () => {
    try {
      await fetch(`${API_BASE}/api/v1/git/github/disconnect`, { method: 'POST' });
      setGithubUser(null);
      setGithubRepos([]);
    } catch (err) {
      setError('Failed to disconnect GitHub');
    }
  };

  const generateSSHKey = async () => {
    if (!newKeyName.trim()) {
      setError('Key name is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/git/ssh-keys/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setSSHKeys(prev => [...prev, data.key]);
        setNewKeyName('');
      } else {
        setError(data.error || 'Failed to generate SSH key');
      }
    } catch (err) {
      setError('Failed to generate SSH key');
    } finally {
      setLoading(false);
    }
  };

  const importSSHKey = async () => {
    if (!newKeyName.trim() || !newKeyContent.trim()) {
      setError('Key name and content are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/git/ssh-keys/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim(), privateKey: newKeyContent.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setSSHKeys(prev => [...prev, data.key]);
        setNewKeyName('');
        setNewKeyContent('');
      } else {
        setError(data.error || 'Failed to import SSH key');
      }
    } catch (err) {
      setError('Failed to import SSH key');
    } finally {
      setLoading(false);
    }
  };

  const deleteSSHKey = async (keyId: string) => {
    if (!confirm('Delete this SSH key?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/git/ssh-keys/${keyId}`, { method: 'DELETE' });
      if (res.ok) {
        setSSHKeys(prev => prev.filter(k => k.id !== keyId));
      }
    } catch (err) {
      setError('Failed to delete SSH key');
    }
  };

  const copyPublicKey = (key: SSHKey) => {
    navigator.clipboard.writeText(key.publicKey);
    setCopiedKey(key.id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const connectRepo = async (url: string, name: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name }),
      });
      if (res.ok) {
        onRepoConnected?.(url, name);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to connect repository');
      }
    } catch (err) {
      setError('Failed to connect repository');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-lg)' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 'var(--gap-sm)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 'var(--gap-sm)' }}>
        <button
          onClick={() => setActiveTab('github')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'github' ? 'var(--primary)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: activeTab === 'github' ? 'var(--bg-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 500,
          }}
        >
          <Github size={16} />
          GitHub
        </button>
        <button
          onClick={() => setActiveTab('ssh')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'ssh' ? 'var(--primary)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: activeTab === 'ssh' ? 'var(--bg-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 500,
          }}
        >
          <Key size={16} />
          SSH Keys
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          style={{
            padding: '8px 16px',
            background: activeTab === 'manual' ? 'var(--primary)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: activeTab === 'manual' ? 'var(--bg-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 500,
          }}
        >
          <FolderGit2 size={16} />
          Manual
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{
          padding: 'var(--gap-md)',
          background: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid rgba(255, 0, 0, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--error)',
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

      {/* GitHub Tab */}
      {activeTab === 'github' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-lg)' }}>
          {githubUser ? (
            <>
              {/* Connected User */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--gap-md)',
                padding: 'var(--gap-md)',
                background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}>
                <img
                  src={githubUser.avatar_url}
                  alt={githubUser.login}
                  style={{ width: 48, height: 48, borderRadius: '50%' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {githubUser.name || githubUser.login}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    @{githubUser.login}
                  </div>
                </div>
                <CyberButton onClick={disconnectGitHub}>
                  Disconnect
                </CyberButton>
              </div>

              {/* Repos List */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--gap-md)' }}>
                  <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>Your Repositories</h4>
                  <CyberButton icon={RefreshCw} onClick={loadGitHubRepos}>
                    Refresh
                  </CyberButton>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)', maxHeight: '300px', overflowY: 'auto' }}>
                  {githubRepos.map(repo => (
                    <div
                      key={repo.full_name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--gap-md)',
                        background: 'var(--bg-void)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
                        <FolderGit2 size={16} style={{ color: repo.private ? 'var(--accent)' : 'var(--primary)' }} />
                        <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                          {repo.full_name}
                        </span>
                        {repo.private && (
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            background: 'rgba(255, 165, 0, 0.2)',
                            borderRadius: '4px',
                            color: 'var(--accent)',
                          }}>
                            private
                          </span>
                        )}
                      </div>
                      <CyberButton
                        variant="primary"
                        icon={Plus}
                        onClick={() => connectRepo(repo.clone_url, repo.name)}
                        disabled={loading}
                      >
                        Connect
                      </CyberButton>
                    </div>
                  ))}
                  {githubRepos.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 'var(--gap-xl)', color: 'var(--text-muted)' }}>
                      No repositories found
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <Github size={48} style={{ color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }} />
              <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--gap-lg)' }}>
                Connect your GitHub account to easily access your repositories
              </p>
              <CyberButton
                variant="primary"
                icon={Github}
                onClick={connectGitHub}
                disabled={loading}
              >
                {loading ? 'Connecting...' : 'Connect GitHub'}
              </CyberButton>
            </div>
          )}
        </div>
      )}

      {/* SSH Keys Tab */}
      {activeTab === 'ssh' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-lg)' }}>
          {/* Existing Keys */}
          {sshKeys.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 var(--gap-md)', color: 'var(--text-primary)' }}>Your SSH Keys</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
                {sshKeys.map(key => (
                  <div
                    key={key.id}
                    style={{
                      padding: 'var(--gap-md)',
                      background: 'var(--bg-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                          {key.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {key.fingerprint}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Added {new Date(key.addedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
                        <button
                          onClick={() => copyPublicKey(key)}
                          style={{
                            padding: '6px',
                            background: 'var(--bg-void)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            color: copiedKey === key.id ? 'var(--primary)' : 'var(--text-muted)',
                          }}
                          title="Copy public key"
                        >
                          {copiedKey === key.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button
                          onClick={() => deleteSSHKey(key.id)}
                          style={{
                            padding: '6px',
                            background: 'var(--bg-void)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            color: 'var(--error)',
                          }}
                          title="Delete key"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Generate/Import Key Form */}
          <div style={{
            padding: 'var(--gap-lg)',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}>
            <h4 style={{ margin: '0 0 var(--gap-md)', color: 'var(--text-primary)' }}>Add SSH Key</h4>

            <div style={{ marginBottom: 'var(--gap-md)' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Key Name
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                placeholder="e.g., work-laptop"
                style={{
                  width: '100%',
                  padding: 'var(--gap-md)',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div style={{ marginBottom: 'var(--gap-md)' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Private Key (optional - for importing existing key)
              </label>
              <div style={{ position: 'relative' }}>
                <textarea
                  value={newKeyContent}
                  onChange={e => setNewKeyContent(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={4}
                  style={{
                    width: '100%',
                    padding: 'var(--gap-md)',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    resize: 'vertical',
                    ...(showKeyContent ? {} : { WebkitTextSecurity: 'disc' } as any),
                  }}
                />
                <button
                  onClick={() => setShowKeyContent(!showKeyContent)}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '8px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                  }}
                >
                  {showKeyContent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
              <CyberButton
                variant="primary"
                icon={Plus}
                onClick={generateSSHKey}
                disabled={loading || !newKeyName.trim()}
              >
                Generate New Key
              </CyberButton>
              {newKeyContent.trim() && (
                <CyberButton
                  icon={Key}
                  onClick={importSSHKey}
                  disabled={loading}
                >
                  Import Key
                </CyberButton>
              )}
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 'var(--gap-md)' }}>
              After generating a key, copy the public key and add it to your Git provider's SSH settings.
            </p>
          </div>
        </div>
      )}

      {/* Manual Tab */}
      {activeTab === 'manual' && (
        <div style={{
          padding: 'var(--gap-lg)',
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}>
          <h4 style={{ margin: '0 0 var(--gap-md)', color: 'var(--text-primary)' }}>Connect Repository Manually</h4>

          <div style={{ marginBottom: 'var(--gap-md)' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Repository URL
            </label>
            <input
              type="text"
              value={manualRepoUrl}
              onChange={e => setManualRepoUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git"
              style={{
                width: '100%',
                padding: 'var(--gap-md)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
              }}
            />
          </div>

          <CyberButton
            variant="primary"
            icon={Plus}
            onClick={() => {
              const url = manualRepoUrl.trim();
              if (!url) return;
              // Extract repo name from URL
              const match = url.match(/([^/]+?)(?:\.git)?$/);
              const name = match?.[1] || 'repository';
              connectRepo(url, name);
              setManualRepoUrl('');
            }}
            disabled={loading || !manualRepoUrl.trim()}
          >
            Connect Repository
          </CyberButton>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 'var(--gap-md)' }}>
            For private repositories, make sure you've set up GitHub OAuth or added an SSH key first.
          </p>
        </div>
      )}
    </div>
  );
}

export default RepoConnectionPanel;
