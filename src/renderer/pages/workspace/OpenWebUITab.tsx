import { useState, useEffect } from 'react';
import { ExternalLink, AlertCircle, RefreshCw, Globe } from 'lucide-react';
import { CyberButton } from '../../components';

const OPENWEBUI_URL = 'http://localhost:3000';

export function OpenWebUITab() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  const checkAvailability = async () => {
    setChecking(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(OPENWEBUI_URL, { mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeout);
      setAvailable(true);
    } catch {
      setAvailable(false);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkAvailability();
  }, []);

  if (checking) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Checking OpenWebUI availability...
      </div>
    );
  }

  if (!available) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '1rem', padding: '2rem',
      }}>
        <AlertCircle size={48} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
        <h3 style={{ color: 'var(--text-primary)', fontWeight: 600, margin: 0 }}>OpenWebUI Not Detected</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', maxWidth: 450 }}>
          OpenWebUI is not running at {OPENWEBUI_URL}. Install and start it to use the advanced AI chat interface.
        </p>
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)', padding: '1rem', fontSize: '0.8rem',
          fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', maxWidth: 450, width: '100%',
        }}>
          <div style={{ marginBottom: '0.5rem', color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: '0.75rem' }}># Install with Docker:</div>
          docker run -d -p 3000:8080 --name open-webui ghcr.io/open-webui/open-webui:main
        </div>
        <CyberButton variant="secondary" icon={RefreshCw} onClick={checkAvailability}>
          Check Again
        </CyberButton>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '0.75rem',
        flexShrink: 0,
      }}>
        <Globe size={14} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>OpenWebUI</span>
        <button
          onClick={() => window.open(OPENWEBUI_URL, '_blank')}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.3rem',
            fontSize: '0.75rem',
          }}
        >
          <ExternalLink size={12} /> Pop out
        </button>
        <button
          onClick={checkAvailability}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <iframe
        src={OPENWEBUI_URL}
        style={{ flex: 1, border: 'none' }}
        title="OpenWebUI"
      />
    </div>
  );
}
