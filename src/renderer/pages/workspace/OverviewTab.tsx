import { useState, useEffect } from 'react';
import {
  MessageSquare, CheckSquare, Code, FolderOpen, Server,
  Users, Cpu, Shield, Zap, Bot
} from 'lucide-react';
import type { OnChainWorkspace } from '../../context/Web3Context';

const API_BASE = 'http://localhost:8080';

interface Props {
  workspace: OnChainWorkspace;
  workspaceId: string;
  members: string[];
  isOwner: boolean;
  onSwitchTab: (tab: string) => void;
}

export function OverviewTab({ workspace, workspaceId, members, isOwner, onSwitchTab }: Props) {
  const [taskCount, setTaskCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [nodeCount, setNodeCount] = useState(0);

  useEffect(() => {
    // Load stats
    fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/tasks`, { headers: { Authorization: 'Bearer local-token' } })
      .then(r => r.json()).then(d => setTaskCount(d.tasks?.length || 0)).catch(() => {});
    fetch(`${API_BASE}/api/v1/ollama/models`)
      .then(r => r.json()).then(d => setModelCount(Array.isArray(d) ? d.length : 0)).catch(() => {});
    fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/nodes`, { headers: { Authorization: 'Bearer local-token' } })
      .then(r => r.json()).then(d => setNodeCount(d.nodes?.length || 0)).catch(() => {});
  }, [workspaceId]);

  const quickActions = [
    { id: 'chat', label: 'AI Chat', desc: 'Chat with LLM models', icon: MessageSquare, color: 'var(--primary)' },
    { id: 'tasks', label: 'Tasks', desc: 'Manage project tasks', icon: CheckSquare, color: 'var(--secondary)' },
    { id: 'code', label: 'Code Editor', desc: 'Edit workspace files', icon: Code, color: '#00FF88' },
    { id: 'files', label: 'Files', desc: 'IPFS file storage', icon: FolderOpen, color: 'var(--accent)' },
  ];

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
      {/* Description */}
      {workspace.description && (
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
          {workspace.description}
        </p>
      )}

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Members', value: members.length, icon: Users, color: 'var(--primary)' },
          { label: 'Tasks', value: taskCount, icon: CheckSquare, color: 'var(--secondary)' },
          { label: 'Nodes', value: nodeCount, icon: Server, color: '#00FF88' },
          { label: 'Models', value: modelCount, icon: Cpu, color: 'var(--accent)' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)', padding: '1rem', textAlign: 'center',
          }}>
            <stat.icon size={20} style={{ color: stat.color, marginBottom: '0.5rem' }} />
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{stat.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <h3 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
        Quick Actions
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {quickActions.map(action => (
          <button
            key={action.id}
            onClick={() => onSwitchTab(action.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              padding: '1.25rem', background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = action.color; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 'var(--radius-md)',
              background: `${action.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <action.icon size={20} style={{ color: action.color }} />
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{action.label}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{action.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Members preview */}
      <h3 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
        Members
      </h3>
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)', padding: '1rem',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {members.slice(0, 10).map(addr => (
            <span key={addr} style={{
              padding: '0.3rem 0.6rem', background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-sm)', fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
              border: addr.toLowerCase() === workspace.owner.toLowerCase() ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
            }}>
              {addr.slice(0, 6)}...{addr.slice(-4)}
              {addr.toLowerCase() === workspace.owner.toLowerCase() && (
                <span style={{ color: 'var(--primary)', marginLeft: '0.3rem', fontSize: '0.65rem' }}>OWNER</span>
              )}
            </span>
          ))}
          {members.length > 10 && (
            <span style={{ padding: '0.3rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              +{members.length - 10} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
