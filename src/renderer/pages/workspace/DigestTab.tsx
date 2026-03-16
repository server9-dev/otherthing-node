import { useState, useEffect } from 'react';
import {
  FileText, RefreshCw, Clock, AlertTriangle, CheckCircle,
  ChevronDown, ChevronUp, Loader, BookOpen, ListTodo
} from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface DigestResult {
  workspaceId: string;
  summary: string;
  decisions: string[];
  issues: string[];
  suggestedTasks: Array<{ title: string; description: string; priority: string }>;
  generatedAt: string;
  cid: string | null;
}

interface HandoffDoc {
  workspaceId: string;
  content: string;
  generatedAt: string;
  cid: string | null;
}

interface Props {
  workspaceId: string;
}

export function DigestTab({ workspaceId }: Props) {
  const [digest, setDigest] = useState<DigestResult | null>(null);
  const [history, setHistory] = useState<DigestResult[]>([]);
  const [handoff, setHandoff] = useState<HandoffDoc | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: 'Bearer local-token' };

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/workspaces/${workspaceId}/digest/latest`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/workspaces/${workspaceId}/digest/history`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/workspaces/${workspaceId}/handoff`, { headers }).then(r => r.json()),
    ]).then(([d, h, ho]) => {
      setDigest(d.digest);
      setHistory(h.digests || []);
      setHandoff(ho.handoff);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [workspaceId]);

  const generateDigest = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/digest/generate`, {
        method: 'POST', headers,
      });
      if (res.ok) {
        const data = await res.json();
        setDigest(data.digest);
        setHistory(prev => [...prev, data.digest]);
      }
    } catch {} finally { setGenerating(false); }
  };

  const regenerateHandoff = async () => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/handoff/regenerate`, {
        method: 'POST', headers,
      });
      if (res.ok) {
        const data = await res.json();
        setHandoff(data.handoff);
      }
    } catch {}
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>;
  }

  const priorityColor = (p: string) => {
    if (p === 'high') return '#FF0080';
    if (p === 'medium') return '#B87FD6';
    return '#71717a';
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileText size={18} /> AI Digest
        </h2>
        <CyberButton
          variant="primary" icon={generating ? Loader : RefreshCw}
          onClick={generateDigest} disabled={generating}
        >
          {generating ? 'Generating...' : 'Generate Now'}
        </CyberButton>
      </div>

      {/* Latest Digest */}
      {digest ? (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)', padding: '1.25rem', marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Latest Digest</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Clock size={10} /> {new Date(digest.generatedAt).toLocaleString()}
            </span>
          </div>

          {/* Summary */}
          <div style={{
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
            padding: '0.75rem', marginBottom: '0.75rem', fontSize: '0.85rem',
            color: 'var(--text-primary)', lineHeight: 1.6,
          }}>
            {digest.summary}
          </div>

          {/* Decisions */}
          {digest.decisions.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <CheckCircle size={12} /> Decisions
              </div>
              {digest.decisions.map((d, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.2rem 0 0.2rem 1rem', borderLeft: '2px solid var(--primary)' }}>
                  {d}
                </div>
              ))}
            </div>
          )}

          {/* Issues */}
          {digest.issues.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <AlertTriangle size={12} /> Issues
              </div>
              {digest.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.2rem 0 0.2rem 1rem', borderLeft: '2px solid var(--accent)' }}>
                  {issue}
                </div>
              ))}
            </div>
          )}

          {/* Suggested Tasks */}
          {digest.suggestedTasks.length > 0 && (
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--secondary)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <ListTodo size={12} /> Suggested Tasks
              </div>
              {digest.suggestedTasks.map((task, i) => (
                <div key={i} style={{
                  display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
                  padding: '0.4rem 0', borderBottom: '1px solid var(--border-subtle)',
                }}>
                  <span style={{
                    fontSize: '0.65rem', padding: '1px 6px', borderRadius: 10,
                    background: `${priorityColor(task.priority)}20`, color: priorityColor(task.priority),
                    fontWeight: 600, flexShrink: 0, marginTop: '0.1rem',
                  }}>
                    {task.priority}
                  </span>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 500 }}>{task.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{task.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {digest.cid && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              IPFS: {digest.cid}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)', padding: '2rem', marginBottom: '1rem',
          textAlign: 'center',
        }}>
          <FileText size={36} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: '0.75rem' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No digest generated yet. Click "Generate Now" to create one.
          </p>
        </div>
      )}

      {/* History toggle */}
      {history.length > 1 && (
        <button
          onClick={() => setShowHistory(!showHistory)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'none',
            border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem',
            marginBottom: '1rem', padding: 0,
          }}
        >
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {history.length - 1} previous digest{history.length > 2 ? 's' : ''}
        </button>
      )}

      {showHistory && history.slice(0, -1).reverse().map((d, i) => (
        <div key={i} style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)', padding: '0.75rem', marginBottom: '0.5rem',
          fontSize: '0.8rem', color: 'var(--text-secondary)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Digest</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(d.generatedAt).toLocaleString()}</span>
          </div>
          {d.summary}
        </div>
      ))}

      {/* Handoff Document */}
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)', padding: '1.25rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <BookOpen size={14} /> Handoff Document
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setShowHandoff(!showHandoff)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              {showHandoff ? 'Collapse' : 'Expand'}
            </button>
            <CyberButton
              variant="secondary" icon={RefreshCw}
              onClick={regenerateHandoff}
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
            >
              Regenerate
            </CyberButton>
          </div>
        </div>

        {handoff ? (
          <>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Generated: {new Date(handoff.generatedAt).toLocaleString()}
              {handoff.cid && <span style={{ marginLeft: '0.5rem', fontFamily: 'var(--font-mono)' }}>IPFS: {handoff.cid}</span>}
            </div>
            {showHandoff && (
              <div style={{
                background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
                padding: '1rem', fontSize: '0.8rem', color: 'var(--text-primary)',
                lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 500, overflow: 'auto',
              }}>
                {handoff.content}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
            No handoff document yet. Generate a digest first, then the handoff will auto-generate.
          </p>
        )}
      </div>
    </div>
  );
}
