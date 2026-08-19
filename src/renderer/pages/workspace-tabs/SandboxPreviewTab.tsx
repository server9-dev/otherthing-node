import { useState, useEffect, useRef } from 'react';
import { Play, Square, ExternalLink, Loader, Monitor } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface Props {
  workspaceId: string;
}

export function SandboxPreviewTab({ workspaceId }: Props) {
  const [status, setStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [port, setPort] = useState<number | null>(null);
  const [command, setCommand] = useState('pnpm dev');
  const [cwd, setCwd] = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' };

  const checkStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/sandbox/preview/status`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      const data = await res.json();
      setStatus(data.status);
      setPort(data.port);
      return data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    checkStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [workspaceId]);

  const startPreview = async () => {
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/sandbox/preview/start`, {
        method: 'POST', headers,
        body: JSON.stringify({ command, cwd: cwd || undefined }),
      });
      setStatus('starting');

      // Poll for port detection
      pollRef.current = setInterval(async () => {
        const data = await checkStatus();
        if (data?.status === 'running' || data?.status === 'stopped' || data?.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 2000);
    } catch {}
  };

  const stopPreview = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/sandbox/preview/stop`, {
        method: 'POST', headers: { Authorization: 'Bearer local-token' },
      });
      setStatus('stopped');
      setPort(null);
    } catch {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Controls */}
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '0.75rem',
        flexShrink: 0,
      }}>
        <Monitor size={16} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Preview</span>

        {status === 'stopped' && (
          <>
            <input
              type="text" value={command} onChange={e => setCommand(e.target.value)}
              placeholder="Command (e.g., pnpm dev)"
              style={{
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                padding: '0.3rem 0.5rem', fontSize: '0.8rem', outline: 'none', width: 150,
              }}
            />
            <input
              type="text" value={cwd} onChange={e => setCwd(e.target.value)}
              placeholder="Working directory (optional)"
              style={{
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                padding: '0.3rem 0.5rem', fontSize: '0.8rem', outline: 'none', flex: 1,
              }}
            />
            <CyberButton variant="primary" icon={Play} onClick={startPreview}>
              Start Preview
            </CyberButton>
          </>
        )}

        {status === 'starting' && (
          <>
            <Loader size={14} className="spin" style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Detecting port...</span>
            <CyberButton variant="danger" icon={Square} onClick={stopPreview} style={{ marginLeft: 'auto' }}>
              Stop
            </CyberButton>
          </>
        )}

        {status === 'running' && port && (
          <>
            <span style={{ fontSize: '0.8rem', color: '#00FF88' }}>Running on port {port}</span>
            <button
              onClick={() => window.open(`http://localhost:${port}`, '_blank')}
              style={{
                background: 'none', border: 'none', color: 'var(--primary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem',
                fontSize: '0.75rem',
              }}
            >
              <ExternalLink size={12} /> Pop out
            </button>
            <CyberButton variant="danger" icon={Square} onClick={stopPreview} style={{ marginLeft: 'auto' }}>
              Stop
            </CyberButton>
          </>
        )}

        {status === 'error' && (
          <>
            <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>Preview failed</span>
            <CyberButton variant="primary" icon={Play} onClick={startPreview} style={{ marginLeft: 'auto' }}>
              Retry
            </CyberButton>
          </>
        )}
      </div>

      {/* Preview iframe */}
      {status === 'running' && port ? (
        <iframe
          src={`http://localhost:${port}`}
          style={{ flex: 1, border: 'none', background: '#fff' }}
          title="Sandbox Preview"
        />
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '1rem',
        }}>
          <Monitor size={48} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', maxWidth: 400 }}>
            {status === 'starting'
              ? 'Starting dev server... The preview will appear once a port is detected.'
              : 'Start a preview to see your app running. The dev server output will be embedded here.'}
          </p>
        </div>
      )}
    </div>
  );
}
