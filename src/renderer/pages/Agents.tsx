import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Bot, Play, Square, RefreshCw, AlertTriangle, CheckCircle,
  Clock, Cpu, Zap, Terminal, ChevronDown, ChevronRight,
  Loader2, Send, Trash2
} from 'lucide-react';
import { CyberButton } from '../components';

const API_BASE = 'http://localhost:8080';

interface AgentExecution {
  id: string;
  workspaceId: string;
  goal: string;
  agentType: string;
  model: string;
  provider: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'pulling_model';
  progress: number;
  progressMessage: string;
  actions: Array<{
    thought: string;
    tool?: string;
    input?: string;
    output?: string;
  }>;
  result?: string;
  error?: string;
  securityAlerts?: string[];
  tokensUsed: number;
  iterations: number;
  createdAt: string;
  completedAt?: string;
  computeSource?: 'local' | 'cloud';
  taskCategory?: string;
  sandboxCid?: string;
}

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

// Default workspace for local standalone mode
const DEFAULT_WORKSPACE = 'default';

export function AgentsPage() {
  const { workspaceId: paramWorkspaceId } = useParams<{ workspaceId: string }>();
  const workspaceId = paramWorkspaceId || DEFAULT_WORKSPACE;
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [selectedModel, setSelectedModel] = useState('auto');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const goalInputRef = useRef<HTMLTextAreaElement>(null);

  // Load executions
  const loadExecutions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/agents`);
      if (res.ok) {
        const data = await res.json();
        setExecutions(data.executions || []);
      }
    } catch (err) {
      setError('Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Load models from local Ollama
  const loadModels = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
      }
    } catch {
      // Ollama not running
      setModels([]);
    }
  }, []);

  // Connect to WebSocket for real-time updates
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8080/ws/agents?workspace=${workspaceId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'agent_progress' || data.type === 'agent_complete') {
          setExecutions(prev => {
            const idx = prev.findIndex(e => e.id === data.execution.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = data.execution;
              return updated;
            } else {
              return [data.execution, ...prev];
            }
          });
        }
      } catch {
        // Ignore invalid messages
      }
    };

    return () => {
      ws.close();
    };
  }, [workspaceId]);

  useEffect(() => {
    loadExecutions();
    loadModels();
  }, [loadExecutions, loadModels]);

  // Submit new agent task
  const submitAgent = async () => {
    if (!goal.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goal.trim(),
          model: selectedModel === 'auto' ? undefined : selectedModel,
          agentType: 'react',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit agent');
      }

      const data = await res.json();
      setExecutions(prev => [data.execution, ...prev]);
      setGoal('');
      setExpandedExecution(data.execution.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel execution
  const cancelExecution = async (executionId: string) => {
    try {
      await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/agents/${executionId}`, {
        method: 'DELETE',
      });
      loadExecutions();
    } catch {
      setError('Failed to cancel agent');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'var(--primary)';
      case 'failed': return 'var(--error)';
      case 'blocked': return 'var(--warning)';
      case 'running': return 'var(--primary)';
      case 'pulling_model': return 'var(--secondary)';
      default: return 'var(--text-muted)';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle size={16} />;
      case 'failed': return <AlertTriangle size={16} />;
      case 'blocked': return <AlertTriangle size={16} />;
      case 'running': return <Loader2 size={16} className="animate-spin" />;
      case 'pulling_model': return <Loader2 size={16} className="animate-spin" />;
      default: return <Clock size={16} />;
    }
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 'var(--gap-xl)',
      }}>
        <div>
          <h2 className="page-title">AI Agents</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
            Run autonomous agents powered by local Ollama models
          </p>
        </div>
        <CyberButton icon={RefreshCw} onClick={loadExecutions} disabled={loading}>
          REFRESH
        </CyberButton>
      </div>

      {/* Error display */}
      {error && (
        <div style={{
          padding: 'var(--gap-md)',
          background: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid rgba(255, 0, 0, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--error)',
          marginBottom: 'var(--gap-lg)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      )}

      {/* New Agent Form */}
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-xl)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">NEW AGENT TASK</span>
        </div>
        <div className="cyber-card-body">
          <div style={{ marginBottom: 'var(--gap-md)' }}>
            <label style={{
              display: 'block',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginBottom: '4px',
              textTransform: 'uppercase',
            }}>
              Goal
            </label>
            <textarea
              ref={goalInputRef}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitAgent();
                }
              }}
              placeholder="Describe what you want the agent to accomplish..."
              className="settings-input"
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--gap-md)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: '4px',
                textTransform: 'uppercase',
              }}>
                Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="settings-input"
                style={{ padding: '8px 12px' }}
              >
                <option value="auto">Auto-select best model</option>
                {models.map(m => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({(m.size / 1e9).toFixed(1)}GB)
                  </option>
                ))}
              </select>
            </div>

            <CyberButton
              variant="primary"
              icon={Send}
              onClick={submitAgent}
              disabled={isSubmitting || !goal.trim()}
            >
              {isSubmitting ? 'SUBMITTING...' : 'RUN AGENT'}
            </CyberButton>
          </div>

          {models.length === 0 && (
            <p style={{
              marginTop: 'var(--gap-md)',
              fontSize: '0.8rem',
              color: 'var(--warning)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <AlertTriangle size={14} />
              No Ollama models detected. Make sure Ollama is running.
            </p>
          )}
        </div>
      </div>

      {/* Executions List */}
      <div>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.9rem',
          color: 'var(--text-primary)',
          marginBottom: 'var(--gap-md)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Execution History
        </h3>

        {loading ? (
          <div className="cyber-card">
            <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
            </div>
          </div>
        ) : executions.length === 0 ? (
          <div className="cyber-card">
            <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
              <Bot size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 'var(--gap-md)' }} />
              <p style={{ color: 'var(--text-muted)' }}>
                No agent executions yet. Submit a goal above to get started.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-md)' }}>
            {executions.map(exec => (
              <div key={exec.id} className="cyber-card">
                <div
                  className="cyber-card-body"
                  style={{ padding: 'var(--gap-md)', cursor: 'pointer' }}
                  onClick={() => setExpandedExecution(expandedExecution === exec.id ? null : exec.id)}
                >
                  {/* Header row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--gap-sm)',
                        marginBottom: '4px',
                      }}>
                        {expandedExecution === exec.id ? (
                          <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                        ) : (
                          <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                        )}
                        <span style={{ color: getStatusColor(exec.status) }}>
                          {getStatusIcon(exec.status)}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          textTransform: 'uppercase',
                          color: getStatusColor(exec.status),
                          fontWeight: 600,
                        }}>
                          {exec.status}
                        </span>
                        {exec.taskCategory && (
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            background: 'var(--bg-void)',
                            borderRadius: '4px',
                            color: 'var(--text-muted)',
                          }}>
                            {exec.taskCategory}
                          </span>
                        )}
                      </div>
                      <p style={{
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)',
                        marginBottom: '4px',
                      }}>
                        {exec.goal.length > 100 ? exec.goal.slice(0, 100) + '...' : exec.goal}
                      </p>
                      <div style={{
                        display: 'flex',
                        gap: 'var(--gap-md)',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                      }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Cpu size={12} />
                          {exec.model}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Zap size={12} />
                          {exec.tokensUsed} tokens
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} />
                          {new Date(exec.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    {(exec.status === 'running' || exec.status === 'pending') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelExecution(exec.id);
                        }}
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid rgba(255, 0, 0, 0.3)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '6px',
                          cursor: 'pointer',
                          color: 'var(--error)',
                        }}
                        title="Cancel"
                      >
                        <Square size={14} />
                      </button>
                    )}
                  </div>

                  {/* Progress bar for running agents */}
                  {(exec.status === 'running' || exec.status === 'pulling_model') && (
                    <div style={{ marginTop: 'var(--gap-md)' }}>
                      <div style={{
                        height: 4,
                        background: 'var(--bg-void)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${exec.progress}%`,
                          height: '100%',
                          background: 'var(--gradient-brand)',
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                      <p style={{
                        marginTop: '4px',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                      }}>
                        {exec.progressMessage}
                      </p>
                    </div>
                  )}

                  {/* Expanded details */}
                  {expandedExecution === exec.id && (
                    <div style={{ marginTop: 'var(--gap-lg)' }}>
                      {/* Security alerts */}
                      {exec.securityAlerts && exec.securityAlerts.length > 0 && (
                        <div style={{
                          padding: 'var(--gap-sm)',
                          background: 'rgba(255, 200, 0, 0.1)',
                          border: '1px solid rgba(255, 200, 0, 0.3)',
                          borderRadius: 'var(--radius-sm)',
                          marginBottom: 'var(--gap-md)',
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: 'var(--warning)',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            marginBottom: '4px',
                          }}>
                            <AlertTriangle size={14} />
                            Security Alerts
                          </div>
                          {exec.securityAlerts.map((alert, i) => (
                            <p key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                              • {alert}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Result */}
                      {exec.result && (
                        <div style={{ marginBottom: 'var(--gap-md)' }}>
                          <h4 style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            marginBottom: '4px',
                          }}>
                            Result
                          </h4>
                          <div style={{
                            padding: 'var(--gap-md)',
                            background: 'var(--bg-void)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.85rem',
                            color: 'var(--text-primary)',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {exec.result}
                          </div>
                        </div>
                      )}

                      {/* Error */}
                      {exec.error && (
                        <div style={{ marginBottom: 'var(--gap-md)' }}>
                          <h4 style={{
                            fontSize: '0.75rem',
                            color: 'var(--error)',
                            textTransform: 'uppercase',
                            marginBottom: '4px',
                          }}>
                            Error
                          </h4>
                          <div style={{
                            padding: 'var(--gap-md)',
                            background: 'rgba(255, 0, 0, 0.1)',
                            border: '1px solid rgba(255, 0, 0, 0.3)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.85rem',
                            color: 'var(--error)',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {exec.error}
                          </div>
                        </div>
                      )}

                      {/* Actions/Thoughts */}
                      {exec.actions && exec.actions.length > 0 && (
                        <div>
                          <h4 style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            marginBottom: '8px',
                          }}>
                            Agent Trace ({exec.iterations} iterations)
                          </h4>
                          <div style={{
                            maxHeight: 300,
                            overflow: 'auto',
                            background: 'var(--bg-void)',
                            borderRadius: 'var(--radius-sm)',
                            padding: 'var(--gap-sm)',
                          }}>
                            {exec.actions.map((action, i) => (
                              <div
                                key={i}
                                style={{
                                  padding: 'var(--gap-sm)',
                                  borderBottom: i < exec.actions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                                }}
                              >
                                {action.thought && (
                                  <p style={{
                                    fontSize: '0.8rem',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '4px',
                                  }}>
                                    <strong style={{ color: 'var(--primary)' }}>Thought:</strong> {action.thought}
                                  </p>
                                )}
                                {action.tool && (
                                  <p style={{
                                    fontSize: '0.8rem',
                                    color: 'var(--text-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}>
                                    <Terminal size={12} />
                                    <strong>{action.tool}</strong>: {action.input}
                                  </p>
                                )}
                                {action.output && (
                                  <pre style={{
                                    fontSize: '0.75rem',
                                    color: 'var(--text-muted)',
                                    background: 'var(--bg-primary)',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    marginTop: '4px',
                                    overflow: 'auto',
                                    maxHeight: 100,
                                  }}>
                                    {action.output}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
