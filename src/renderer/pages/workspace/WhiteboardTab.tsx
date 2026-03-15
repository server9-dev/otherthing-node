import { useState, useEffect, useCallback, useRef, Component, ReactNode } from 'react';
import { Save, Download, Trash2, Check, AlertCircle } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface Props { workspaceId: string; }

// Error boundary to catch Excalidraw crashes
class ExcalidrawErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <AlertCircle size={48} style={{ color: 'var(--accent)', marginBottom: '1rem' }} />
          <p style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Whiteboard failed to load</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lazy load Excalidraw to avoid SSR issues and reduce initial bundle
let ExcalidrawComponent: any = null;
let exportToBlobFn: any = null;

export function WhiteboardTab({ workspaceId }: Props) {
  const [elements, setElements] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [excalidrawLoaded, setExcalidrawLoaded] = useState(!!ExcalidrawComponent);
  const [loadError, setLoadError] = useState<string | null>(null);
  const excalidrawRef = useRef<any>(null);

  const storageKey = `whiteboard-${workspaceId}`;

  // Load Excalidraw dynamically
  useEffect(() => {
    if (ExcalidrawComponent) { setExcalidrawLoaded(true); return; }

    import('@excalidraw/excalidraw').then(mod => {
      ExcalidrawComponent = mod.Excalidraw;
      exportToBlobFn = mod.exportToBlob;
      setExcalidrawLoaded(true);
    }).catch(err => {
      console.error('Failed to load Excalidraw:', err);
      setLoadError(err.message);
    });
  }, []);

  // Load saved whiteboard
  useEffect(() => {
    try {
      const data = localStorage.getItem(storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.elements) setElements(parsed.elements);
        if (parsed.savedAt) setLastSaved(parsed.savedAt);
      }
    } catch {}
  }, [storageKey]);

  const handleChange = useCallback((newElements: any[]) => {
    setElements(newElements);
    setSaved(false);
  }, []);

  const saveWhiteboard = useCallback(async () => {
    setSaving(true);
    try {
      const data = { elements, savedAt: new Date().toISOString() };
      localStorage.setItem(storageKey, JSON.stringify(data));

      try {
        await fetch(`${API_BASE}/workspaces/${workspaceId}/storage/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
          body: JSON.stringify({
            content: JSON.stringify(data),
            filename: 'whiteboard.excalidraw',
            mimeType: 'application/json',
          }),
        });
      } catch {}

      setSaved(true);
      setLastSaved(data.savedAt);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }, [elements, storageKey, workspaceId]);

  const clearWhiteboard = () => {
    if (!confirm('Clear the whiteboard? This cannot be undone.')) return;
    setElements([]);
    localStorage.removeItem(storageKey);
  };

  const exportAsPng = async () => {
    if (!exportToBlobFn || elements.length === 0) return;
    try {
      const blob = await exportToBlobFn({
        elements,
        appState: { exportWithDarkMode: true, viewBackgroundColor: '#0A0A12' },
        files: null,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whiteboard-${workspaceId.slice(0, 8)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  // Auto-save every 30s
  useEffect(() => {
    if (elements.length === 0) return;
    const interval = setInterval(() => {
      localStorage.setItem(storageKey, JSON.stringify({ elements, savedAt: new Date().toISOString() }));
    }, 30000);
    return () => clearInterval(interval);
  }, [elements, storageKey]);

  if (loadError) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <AlertCircle size={48} style={{ color: 'var(--accent)', marginBottom: '1rem' }} />
        <p style={{ color: 'var(--text-primary)' }}>Failed to load whiteboard</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{loadError}</p>
      </div>
    );
  }

  if (!excalidrawLoaded) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading whiteboard...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <CyberButton
          variant={saved ? 'success' : 'primary'}
          icon={saved ? Check : Save}
          onClick={saveWhiteboard}
          loading={saving}
          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
        >
          {saved ? 'Saved' : 'Save'}
        </CyberButton>
        <CyberButton
          icon={Download}
          onClick={exportAsPng}
          disabled={elements.length === 0}
          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
        >
          Export PNG
        </CyberButton>
        <CyberButton
          variant="danger"
          icon={Trash2}
          onClick={clearWhiteboard}
          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
        >
          Clear
        </CyberButton>
        <div style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {lastSaved ? `Last saved ${new Date(lastSaved).toLocaleTimeString()}` : 'Not saved yet'}
          {elements.length > 0 && ` | ${elements.length} elements`}
        </div>
      </div>

      {/* Excalidraw Canvas — must have explicit height */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ExcalidrawErrorBoundary>
            <ExcalidrawComponent
              ref={excalidrawRef}
              initialData={{
                elements,
                appState: { viewBackgroundColor: '#0A0A12', theme: 'dark' },
              }}
              onChange={handleChange}
              theme="dark"
              UIOptions={{
                canvasActions: {
                  saveToActiveFile: false,
                  loadScene: false,
                  export: false,
                },
              }}
            />
          </ExcalidrawErrorBoundary>
        </div>
      </div>
    </div>
  );
}
