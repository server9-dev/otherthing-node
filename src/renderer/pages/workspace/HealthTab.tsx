import { useState, useEffect } from 'react';
import { Activity, RefreshCw, Users, ListTodo, TrendingUp, AlertTriangle, Loader } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface HealthReport {
  workspaceId: string;
  participationMetrics: { activeSpeakers: number; messageCount: number; artifactCount: number };
  taskVelocity: { created: number; completed: number; inProgress: number; blocked: number };
  predictions: string[];
  recommendations: string[];
  generatedAt: string;
  cid: string | null;
}

interface Props {
  workspaceId: string;
}

export function HealthTab({ workspaceId }: Props) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: 'Bearer local-token' };

  useEffect(() => {
    fetch(`${API_BASE}/workspaces/${workspaceId}/health-report/latest`, { headers })
      .then(r => r.json())
      .then(d => setReport(d.report))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/health-report/generate`, {
        method: 'POST', headers,
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
      }
    } catch {} finally { setGenerating(false); }
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <div style={{ padding: '1.5rem', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={18} /> Team Health
        </h2>
        <CyberButton variant="primary" icon={generating ? Loader : RefreshCw} onClick={generate} disabled={generating}>
          {generating ? 'Generating...' : 'Generate Report'}
        </CyberButton>
      </div>

      {report ? (
        <>
          {/* Metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            {[
              { label: 'Active Speakers', value: report.participationMetrics.activeSpeakers, icon: Users, color: 'var(--primary)' },
              { label: 'Messages (48h)', value: report.participationMetrics.messageCount, icon: Activity, color: 'var(--secondary)' },
              { label: 'Tasks Created', value: report.taskVelocity.created, icon: ListTodo, color: '#00FF88' },
              { label: 'Completed', value: report.taskVelocity.completed, icon: TrendingUp, color: '#00FF88' },
              { label: 'In Progress', value: report.taskVelocity.inProgress, icon: Activity, color: 'var(--primary)' },
              { label: 'Blocked', value: report.taskVelocity.blocked, icon: AlertTriangle, color: 'var(--accent)' },
            ].map((m, i) => (
              <div key={i} style={{
                background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)', padding: '0.75rem', textAlign: 'center',
              }}>
                <m.icon size={16} style={{ color: m.color, marginBottom: '0.3rem' }} />
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: m.color }}>{m.value}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.label}</div>
              </div>
            ))}
          </div>

          {/* Predictions */}
          {report.predictions.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)', padding: '1rem', marginBottom: '0.75rem',
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <AlertTriangle size={14} /> Predictions
              </div>
              {report.predictions.map((p, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.25rem 0 0.25rem 1rem', borderLeft: '2px solid var(--accent)' }}>
                  {p}
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)', padding: '1rem',
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <TrendingUp size={14} /> Recommendations
              </div>
              {report.recommendations.map((r, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.25rem 0 0.25rem 1rem', borderLeft: '2px solid var(--primary)' }}>
                  {r}
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            Generated: {new Date(report.generatedAt).toLocaleString()}
            {report.cid && <span style={{ marginLeft: '0.5rem', fontFamily: 'var(--font-mono)' }}>IPFS: {report.cid}</span>}
          </div>
        </>
      ) : (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)', padding: '2rem', textAlign: 'center',
        }}>
          <Activity size={36} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: '0.75rem' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No health report yet. Click "Generate Report" to analyze team activity.
          </p>
        </div>
      )}
    </div>
  );
}
