import { useState, useEffect } from 'react';
import { Activity, RefreshCw, Users, ListTodo, TrendingUp, AlertTriangle, Loader, User, MessageSquare, CheckCircle } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface IndividualMetrics {
  userId: string;
  displayName: string;
  messageCount: number;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksBlocked: number;
  lastActive: string | null;
  warnings: string[];
  recommendations: string[];
}

interface HealthReport {
  workspaceId: string;
  participationMetrics: { activeSpeakers: number; messageCount: number; artifactCount: number };
  taskVelocity: { created: number; completed: number; inProgress: number; blocked: number };
  individuals: IndividualMetrics[];
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
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            {[
              { label: 'Active Speakers', value: report.participationMetrics.activeSpeakers, icon: Users, color: 'var(--primary)' },
              { label: 'Messages', value: report.participationMetrics.messageCount, icon: MessageSquare, color: 'var(--secondary)' },
              { label: 'Total Tasks', value: report.taskVelocity.created, icon: ListTodo, color: 'var(--text-primary)' },
              { label: 'Completed', value: report.taskVelocity.completed, icon: CheckCircle, color: '#00FF88' },
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

          {/* Individual member breakdown */}
          {report.individuals && report.individuals.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)', padding: '1rem', marginBottom: '0.75rem',
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Users size={14} /> Individual Breakdown
              </div>
              {report.individuals.map((ind, i) => {
                const hasWarnings = ind.warnings.length > 0;
                return (
                  <div key={i} style={{
                    padding: '0.65rem 0.75rem', marginBottom: '0.5rem',
                    background: hasWarnings ? 'rgba(255,0,128,0.03)' : 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${hasWarnings ? 'rgba(255,0,128,0.15)' : 'var(--border-subtle)'}`,
                  }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: hasWarnings ? 'rgba(255,0,128,0.15)' : 'rgba(0,212,255,0.15)',
                          border: `1px solid ${hasWarnings ? 'rgba(255,0,128,0.3)' : 'rgba(0,212,255,0.3)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <User size={14} style={{ color: hasWarnings ? 'var(--accent)' : 'var(--primary)' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{ind.displayName}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {ind.userId.startsWith('0x') ? `${ind.userId.slice(0, 8)}...${ind.userId.slice(-4)}` : ind.userId}
                          </div>
                        </div>
                      </div>
                      {/* Stats badges */}
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 8, background: 'rgba(0,212,255,0.1)', color: 'var(--primary)' }}>
                          {ind.messageCount} msgs
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 8, background: 'rgba(0,255,136,0.1)', color: '#00FF88' }}>
                          {ind.tasksCompleted}/{ind.tasksAssigned} tasks
                        </span>
                        {ind.tasksBlocked > 0 && (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 8, background: 'rgba(255,0,128,0.1)', color: 'var(--accent)' }}>
                            {ind.tasksBlocked} blocked
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Warnings */}
                    {ind.warnings.length > 0 && (
                      <div style={{ marginTop: '0.3rem' }}>
                        {ind.warnings.map((w, j) => (
                          <div key={j} style={{
                            fontSize: '0.75rem', color: 'var(--accent)', padding: '0.15rem 0 0.15rem 0.75rem',
                            borderLeft: '2px solid var(--accent)', marginBottom: '0.15rem',
                            display: 'flex', alignItems: 'center', gap: '0.3rem',
                          }}>
                            <AlertTriangle size={10} /> {w}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recommendations */}
                    {ind.recommendations.length > 0 && (
                      <div style={{ marginTop: '0.3rem' }}>
                        {ind.recommendations.map((r, j) => (
                          <div key={j} style={{
                            fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.15rem 0 0.15rem 0.75rem',
                            borderLeft: '2px solid var(--primary)', marginBottom: '0.15rem',
                          }}>
                            {r}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Last active */}
                    {ind.lastActive && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Last active: {new Date(ind.lastActive).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Team Predictions */}
          {report.predictions.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)', padding: '1rem', marginBottom: '0.75rem',
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <AlertTriangle size={14} /> Team Predictions
              </div>
              {report.predictions.map((p, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.25rem 0 0.25rem 1rem', borderLeft: '2px solid var(--accent)' }}>
                  {p}
                </div>
              ))}
            </div>
          )}

          {/* Team Recommendations */}
          {report.recommendations.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)', padding: '1rem', marginBottom: '0.75rem',
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <TrendingUp size={14} /> Team Recommendations
              </div>
              {report.recommendations.map((r, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.25rem 0 0.25rem 1rem', borderLeft: '2px solid var(--primary)' }}>
                  {r}
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
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
