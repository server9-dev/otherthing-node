import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Play, Square, Loader, Code, FolderGit2, Upload, Download } from 'lucide-react';
import { CyberButton } from '../../components';
import { RepoConnectionPanel } from '../../components/RepoConnectionPanel';

const API_BASE = 'http://localhost:8080/api/v1';

interface WorkspaceRepo {
  id: string;
  name: string;
  url: string;
  status: string;
  localPath?: string;
  ipfsCid?: string;
  lastSyncedAt?: string;
}

interface Props { workspaceId: string; }

export function CodeTab({ workspaceId }: Props) {
  const [port, setPort] = useState<number | null>(null);
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<WorkspaceRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<WorkspaceRepo | null>(null);
  const [showRepoPanel, setShowRepoPanel] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);

  const syncToIpfs = useCallback(async (repoId: string) => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/repos/${repoId}/sync`, {
        method: 'POST',
        headers: { Authorization: 'Bearer local-token' },
      });
      const data = await res.json();
      if (data.cid) {
        loadRepos();
      }
    } catch {}
    setSyncing(false);
  }, [workspaceId]);

  const pullFromIpfs = useCallback(async (repoId: string) => {
    setPulling(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/repos/${repoId}/pull`, {
        method: 'POST',
        headers: { Authorization: 'Bearer local-token' },
      });
      const data = await res.json();
      if (data.localPath) {
        loadRepos();
      }
    } catch {}
    setPulling(false);
  }, [workspaceId]);

  // Load connected repos
  const loadRepos = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/repos`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos || []);
      }
    } catch {}
  }, [workspaceId]);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  // Check if code-server is already running for this workspace
  useEffect(() => {
    fetch(`${API_BASE}/workspaces/${workspaceId}/code-server`, {
      headers: { Authorization: 'Bearer local-token' },
    })
      .then(r => r.json())
      .then(data => {
        if (data.port) {
          setPort(data.port);
          setStatus('running');
        }
      })
      .catch(() => {});
  }, [workspaceId]);

  const startServer = useCallback(async (folder?: string) => {
    setStatus('starting');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/code-server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ folder: folder || selectedRepo?.localPath }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setStatus('stopped');
        return;
      }
      setPort(data.port);
      setTimeout(() => setStatus('running'), 3000);
    } catch (err) {
      setError('Failed to start code server');
      setStatus('stopped');
    }
  }, [workspaceId, selectedRepo]);

  const stopServer = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/code-server`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer local-token' },
      });
    } catch {}
    setPort(null);
    setStatus('stopped');
  }, [workspaceId]);

  const popOut = () => {
    if (!port) return;
    const url = `http://127.0.0.1:${port}`;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, `code-${workspaceId}`, 'width=1400,height=900');
    }
  };

  const handleRepoConnected = () => {
    setShowRepoPanel(false);
    // Poll until clone finishes
    const pollInterval = setInterval(async () => {
      await loadRepos();
    }, 3000);
    // Stop polling after 2 minutes
    setTimeout(() => clearInterval(pollInterval), 120000);
    loadRepos();
  };

  // When a repo with a localPath is selected, auto-start code-server
  useEffect(() => {
    if (selectedRepo?.localPath && status === 'stopped') {
      startServer(selectedRepo.localPath);
    }
  }, [selectedRepo?.id]);

  const editorUrl = port ? `http://127.0.0.1:${port}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        background: 'var(--bg-secondary)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Repo selector */}
        {status !== 'running' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <FolderGit2 size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={selectedRepo?.id || ''}
              onChange={e => {
                const repo = repos.find(r => r.id === e.target.value);
                setSelectedRepo(repo || null);
              }}
              style={{
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                padding: '0.25rem 0.4rem', fontSize: '0.75rem', outline: 'none',
                maxWidth: 200,
              }}
            >
              <option value="">Home directory</option>
              {repos.map(r => (
                <option key={r.id} value={r.id} disabled={r.status !== 'ready' && r.status !== 'analyzed'}>
                  {r.name} {r.status === 'cloning' ? '(cloning...)' : r.status === 'error' ? '(error)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowRepoPanel(!showRepoPanel)}
              title="Connect a repository"
              style={{
                background: 'none', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
                cursor: 'pointer', padding: '0.2rem 0.4rem', fontSize: '0.7rem',
                display: 'flex', alignItems: 'center', gap: '0.2rem',
              }}
            >
              + Repo
            </button>
            {selectedRepo && (
              <>
                <button
                  onClick={() => syncToIpfs(selectedRepo.id)}
                  disabled={syncing || !selectedRepo.localPath}
                  title={selectedRepo.ipfsCid ? `Sync to IPFS (last: ${selectedRepo.lastSyncedAt ? new Date(selectedRepo.lastSyncedAt).toLocaleTimeString() : 'never'})` : 'Push to IPFS for workspace sharing'}
                  style={{
                    background: 'none', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)', cursor: syncing ? 'wait' : 'pointer',
                    padding: '0.2rem 0.4rem', fontSize: '0.7rem',
                    display: 'flex', alignItems: 'center', gap: '0.2rem',
                    color: selectedRepo.ipfsCid ? 'var(--primary)' : 'var(--text-muted)',
                  }}
                >
                  <Upload size={11} /> {syncing ? 'Syncing...' : 'Sync'}
                </button>
                {selectedRepo.ipfsCid && !selectedRepo.localPath && (
                  <button
                    onClick={() => pullFromIpfs(selectedRepo.id)}
                    disabled={pulling}
                    title="Pull from IPFS"
                    style={{
                      background: 'none', border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)', cursor: pulling ? 'wait' : 'pointer',
                      padding: '0.2rem 0.4rem', fontSize: '0.7rem',
                      display: 'flex', alignItems: 'center', gap: '0.2rem',
                      color: 'var(--secondary)',
                    }}
                  >
                    <Download size={11} /> {pulling ? 'Pulling...' : 'Pull'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {status === 'stopped' && (
          <CyberButton
            variant="primary"
            icon={Play}
            onClick={() => startServer()}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
          >
            Launch Editor
          </CyberButton>
        )}
        {status === 'starting' && (
          <CyberButton
            disabled
            icon={Loader}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
          >
            Starting...
          </CyberButton>
        )}
        {status === 'running' && (
          <>
            <CyberButton
              variant="danger"
              icon={Square}
              onClick={stopServer}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
            >
              Stop
            </CyberButton>
            <CyberButton
              icon={ExternalLink}
              onClick={popOut}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
            >
              Pop Out
            </CyberButton>
          </>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {status === 'running' && port && `code-server on port ${port}`}
          {status === 'stopped' && (
            <>
              {repos.length} repo{repos.length !== 1 ? 's' : ''} connected
              {selectedRepo?.ipfsCid && (
                <span style={{ marginLeft: '0.5rem', color: 'var(--primary)' }} title={selectedRepo.ipfsCid}>
                  IPFS: {selectedRepo.ipfsCid.slice(0, 8)}...
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Repo Connection Panel (expandable) */}
      {showRepoPanel && status !== 'running' && (
        <div style={{
          borderBottom: '1px solid var(--border-subtle)',
          maxHeight: 400, overflow: 'auto',
          flexShrink: 0,
        }}>
          <RepoConnectionPanel
            workspaceId={workspaceId}
            onRepoConnected={handleRepoConnected}
          />
        </div>
      )}

      {/* Editor area */}
      {status === 'running' && editorUrl ? (
        <iframe
          src={editorUrl}
          style={{
            flex: 1,
            width: '100%',
            border: 'none',
            minHeight: 0,
            background: '#1e1e1e',
          }}
          allow="clipboard-read; clipboard-write"
          title="Code Editor"
        />
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-void)',
        }}>
          <div style={{ textAlign: 'center' }}>
            {status === 'starting' ? (
              <>
                <Loader size={48} style={{ color: 'var(--primary)', opacity: 0.5, marginBottom: '1rem', animation: 'spin 2s linear infinite' }} />
                <p style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Starting code-server...</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>This may take a few seconds on first launch</p>
              </>
            ) : error ? (
              <>
                <Code size={48} style={{ color: 'var(--accent)', opacity: 0.5, marginBottom: '1rem' }} />
                <p style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Failed to start editor</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: 400, margin: '0 auto' }}>{error}</p>
              </>
            ) : (
              <>
                <Code size={48} style={{ color: 'var(--text-muted)', opacity: 0.2, marginBottom: '1rem' }} />
                <p style={{ color: 'var(--text-primary)', marginBottom: '0.5rem', fontWeight: 600 }}>Code Editor</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: 400, margin: '0 auto 1rem' }}>
                  {repos.length > 0
                    ? 'Select a repo from the dropdown and click Launch, or connect a new one.'
                    : 'Connect a GitHub repo with "+ Repo" or launch the editor to start coding.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
