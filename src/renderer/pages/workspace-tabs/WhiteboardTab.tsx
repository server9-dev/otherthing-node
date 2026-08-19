import { useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { CyberButton } from '../../components';

const EXCALIDRAW_URL = 'https://excalidraw.com';

interface Props { workspaceId: string; }

export function WhiteboardTab({ workspaceId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const popOut = () => {
    // In Electron, open a new BrowserWindow; in browser, open a new tab
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(EXCALIDRAW_URL);
    } else {
      window.open(EXCALIDRAW_URL, `whiteboard-${workspaceId}`, 'width=1200,height=800');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <CyberButton
          icon={ExternalLink}
          onClick={popOut}
          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
        >
          Pop Out
        </CyberButton>
        <div style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Workspace whiteboard — use Excalidraw's built-in save/export
        </div>
      </div>

      {/* Excalidraw iframe */}
      <iframe
        ref={iframeRef}
        src={EXCALIDRAW_URL}
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          minHeight: 0,
          background: '#0A0A12',
        }}
        allow="clipboard-read; clipboard-write"
        title="Whiteboard"
      />
    </div>
  );
}
