import { useRef } from 'react';
import { Bot, RotateCw, ExternalLink } from 'lucide-react';
import { AI_CHAT_URL } from '../../config/api';

/**
 * Open WebUI running on the shared GPU node, embedded in the workspace.
 * Open WebUI has its own accounts; new sign-ups wait for admin approval.
 */
export function AIChatTab() {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const reload = () => {
    if (frameRef.current) frameRef.current.src = AI_CHAT_URL;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color, rgba(0,255,255,0.15))',
      }}>
        <Bot size={16} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Open WebUI</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {new URL(AI_CHAT_URL).host}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={reload} title="Reload" style={iconButton}>
          <RotateCw size={14} />
        </button>
        {/* target=_blank is routed to the system browser by main.ts */}
        <a href={AI_CHAT_URL} target="_blank" rel="noreferrer" title="Open in browser" style={iconButton}>
          <ExternalLink size={14} />
        </a>
      </div>
      <iframe
        ref={frameRef}
        src={AI_CHAT_URL}
        title="Open WebUI"
        allow="clipboard-read; clipboard-write; microphone"
        style={{ flex: 1, border: 'none', background: '#171717' }}
      />
    </div>
  );
}

const iconButton: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 4, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border-color, rgba(0,255,255,0.2))',
  color: 'var(--text-secondary, #aaa)',
};
