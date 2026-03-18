import { useState, useEffect } from 'react';
import { Box, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { CyberButton } from './CyberButton';

const API_BASE = 'http://localhost:8080';

interface ContainersPanelProps {
  onContainerSelect?: (containerId: string) => void;
}

export function ContainersPanel({ onContainerSelect }: ContainersPanelProps) {
  const [runtime, setRuntime] = useState<any>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/containers/runtime`)
      .then(r => r.json()).then(setRuntime).catch(() => {});
  }, []);

  return (
    <div style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Box size={16} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>Containers (Docker)</span>
      </div>
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)', padding: '0.75rem',
        fontSize: '0.8rem', color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        {runtime?.installed
          ? <><CheckCircle size={14} style={{ color: '#00FF88' }} /> Docker available</>
          : <><XCircle size={14} style={{ opacity: 0.4 }} /> Docker not detected — install from docker.com</>
        }
      </div>
    </div>
  );
}
