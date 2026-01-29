/**
 * Mermaid Diagram Component
 *
 * Renders Mermaid diagrams with a dark theme that matches the app.
 * Uses mermaid.js for rendering.
 */

import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Copy, Check, RefreshCw } from 'lucide-react';

interface MermaidDiagramProps {
  diagram: string;
  title?: string;
  description?: string;
  className?: string;
}

// Mermaid configuration for dark theme
const mermaidConfig = {
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#8b5cf6',
    primaryTextColor: '#fafafa',
    primaryBorderColor: '#3f3f46',
    lineColor: '#71717a',
    secondaryColor: '#22c55e',
    tertiaryColor: '#18181b',
    background: '#18181b',
    mainBkg: '#27272a',
    nodeBorder: '#3f3f46',
    clusterBkg: '#18181b',
    clusterBorder: '#3f3f46',
    titleColor: '#fafafa',
    edgeLabelBackground: '#27272a',
  },
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
  },
  securityLevel: 'loose',
};

let mermaidInitialized = false;
let mermaid: any = null;

async function initMermaid() {
  if (mermaidInitialized) return mermaid;

  try {
    // Dynamic import mermaid
    const m = await import('mermaid');
    mermaid = m.default;
    mermaid.initialize(mermaidConfig);
    mermaidInitialized = true;
    return mermaid;
  } catch (err) {
    console.error('Failed to load mermaid:', err);
    return null;
  }
}

export function MermaidDiagram({ diagram, title, description, className = '' }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    async function renderDiagram() {
      setLoading(true);
      setError(null);

      try {
        const m = await initMermaid();
        if (!m || !mounted) return;

        // Generate unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

        // Render the diagram
        const { svg } = await m.render(id, diagram);

        if (mounted) {
          setSvgContent(svg);
          setLoading(false);
        }
      } catch (err) {
        console.error('Mermaid render error:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setLoading(false);
        }
      }
    }

    renderDiagram();

    return () => {
      mounted = false;
    };
  }, [diagram]);

  const copyCode = () => {
    navigator.clipboard.writeText(diagram);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const m = await initMermaid();
      if (!m) return;

      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      const { svg } = await m.render(id, diagram);
      setSvgContent(svg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`mermaid-diagram ${expanded ? 'expanded' : ''} ${className}`}
      style={{
        background: '#18181b',
        border: '1px solid #3f3f46',
        borderRadius: '12px',
        overflow: 'hidden',
        ...(expanded && {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1000,
          borderRadius: 0,
        }),
      }}
    >
      {/* Header */}
      {(title || description) && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #3f3f46',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            {title && (
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#fafafa' }}>
                {title}
              </h3>
            )}
            {description && (
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#a1a1aa' }}>
                {description}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={refresh}
              disabled={loading}
              style={{
                padding: '6px',
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#a1a1aa',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Refresh diagram"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>

            <button
              onClick={copyCode}
              style={{
                padding: '6px',
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: '6px',
                cursor: 'pointer',
                color: copied ? '#22c55e' : '#a1a1aa',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Copy Mermaid code"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>

            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                padding: '6px',
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#a1a1aa',
                display: 'flex',
                alignItems: 'center',
              }}
              title={expanded ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* Diagram Container */}
      <div
        ref={containerRef}
        style={{
          padding: '24px',
          overflowX: 'auto',
          overflowY: expanded ? 'auto' : 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '200px',
          ...(expanded && {
            height: 'calc(100vh - 60px)',
          }),
        }}
      >
        {loading && (
          <div style={{ color: '#a1a1aa', fontSize: '14px' }}>
            Loading diagram...
          </div>
        )}

        {error && (
          <div style={{ color: '#ef4444', fontSize: '14px', textAlign: 'center' }}>
            <p>Failed to render diagram</p>
            <p style={{ fontSize: '12px', opacity: 0.7 }}>{error}</p>
          </div>
        )}

        {!loading && !error && svgContent && (
          <div
            dangerouslySetInnerHTML={{ __html: svgContent }}
            style={{
              maxWidth: '100%',
              '& svg': {
                maxWidth: '100%',
                height: 'auto',
              },
            } as any}
          />
        )}
      </div>
    </div>
  );
}

export default MermaidDiagram;
