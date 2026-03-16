import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Play, Square, Loader, Code } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface Props { workspaceId: string; }

export function CodeTab({ workspaceId }: Props) {
  const [port, setPort] = useState<number | null>(null);
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running'>('stopped');
  const [error, setError] = useState<string | null>(null);

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

  const startServer = useCallback(async () => {
    setStatus('starting');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/code-server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setStatus('stopped');
        return;
      }
      setPort(data.port);
      // Give code-server a moment to initialize before loading iframe
      setTimeout(() => setStatus('running'), 3000);
    } catch (err) {
      setError('Failed to start code server');
      setStatus('stopped');
    }
  }, [workspaceId]);

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

  const editorUrl = port ? `http://127.0.0.1:${port}` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        {status === 'stopped' && (
          <CyberButton
            variant="primary"
            icon={Play}
            onClick={startServer}
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
          {status === 'stopped' && 'VS Code editor (code-server, MIT licensed)'}
        </div>
      </div>

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
                  Full VS Code editor powered by code-server. Click Launch to start.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
