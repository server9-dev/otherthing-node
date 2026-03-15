import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Plus, Search, Filter, Clock, Coins, Users,
  ChevronRight, Wallet, AlertCircle, CheckCircle, FileText,
  Globe, ArrowUpDown
} from 'lucide-react';
import { CyberButton } from '../components';
import { useWeb3 } from '../context/Web3Context';

const API_BASE = 'http://localhost:8080/api/v1';

interface MilestoneTask {
  id?: string;
  taskId?: string;
  workspaceId: string;
  title: string;
  description: string;
  milestones: { description: string; amount: string }[];
  assigneeAddress: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  totalAmount?: string;
  workspaceName?: string;
}

export function TasksPage() {
  const navigate = useNavigate();
  const { connected, address, myWorkspaces, ottBalance, setShowQRModal } = useWeb3();

  const [tasks, setTasks] = useState<MilestoneTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'payout'>('newest');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create task form
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskDeadline, setTaskDeadline] = useState('');
  const [milestones, setMilestones] = useState([{ description: '', amount: '' }]);
  const [creating, setCreating] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const allTasks: MilestoneTask[] = [];

      // Load tasks from all workspaces the user is in
      for (const ws of myWorkspaces) {
        try {
          const res = await fetch(`${API_BASE}/workspaces/${ws.id}/tasks`, {
            headers: { 'Authorization': 'Bearer local-token' },
          });
          if (res.ok) {
            const data = await res.json();
            const wsTasks = (data.tasks || []).map((t: any) => ({
              ...t,
              workspaceId: ws.id,
              workspaceName: ws.name,
              totalAmount: t.milestones?.reduce((sum: number, m: any) =>
                sum + parseFloat(m.amount || '0'), 0).toString() || '0',
            }));
            allTasks.push(...wsTasks);
          }
        } catch {
          // Skip failed workspace
        }
      }

      setTasks(allTasks);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [myWorkspaces]);

  useEffect(() => {
    if (connected && myWorkspaces.length > 0) {
      loadTasks();
    } else {
      setLoading(false);
    }
  }, [connected, myWorkspaces, loadTasks]);

  const filteredTasks = tasks
    .filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.workspaceName?.toLowerCase().includes(q));
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'payout') return parseFloat(b.totalAmount || '0') - parseFloat(a.totalAmount || '0');
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const addMilestone = () => {
    setMilestones([...milestones, { description: '', amount: '' }]);
  };

  const removeMilestone = (index: number) => {
    if (milestones.length > 1) {
      setMilestones(milestones.filter((_, i) => i !== index));
    }
  };

  const updateMilestone = (index: number, field: 'description' | 'amount', value: string) => {
    const updated = [...milestones];
    updated[index][field] = value;
    setMilestones(updated);
  };

  const totalPayout = milestones.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);
  const platformFee = totalPayout * 0.05;

  const handleCreateTask = async () => {
    if (!selectedWorkspace || !taskTitle || milestones.some(m => !m.description || !m.amount)) {
      setError('Please fill in all fields');
      return;
    }

    setCreating(true);
    setError(null);
    setTxStatus('Creating task...');

    try {
      const res = await fetch(`${API_BASE}/workspaces/${selectedWorkspace}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer local-token' },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription,
          status: 'todo',
          priority: 'medium',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create task');
      }

      setTxStatus('Task created!');
      await new Promise(r => setTimeout(r, 1000));

      setShowCreateModal(false);
      setTaskTitle('');
      setTaskDescription('');
      setTaskDeadline('');
      setMilestones([{ description: '', amount: '' }]);
      setTxStatus(null);
      await loadTasks();
    } catch (err: any) {
      setError(err.message);
      setTxStatus(null);
    } finally {
      setCreating(false);
    }
  };

  const statusColors: Record<string, string> = {
    created: '#00D4FF',
    assigned: '#B87FD6',
    in_progress: '#9B59B6',
    completed: '#00FF88',
    disputed: '#FF0080',
    cancelled: '#71717a',
  };

  const statusLabels: Record<string, string> = {
    created: 'Open',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    completed: 'Completed',
    disputed: 'Disputed',
    cancelled: 'Cancelled',
  };

  // Not connected state
  if (!connected) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Briefcase size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Task Board</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          Connect your wallet to browse and create tasks
        </p>
        <CyberButton variant="primary" icon={Wallet} onClick={() => setShowQRModal(true)}>
          Connect Wallet
        </CyberButton>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Task Board
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
            Browse open tasks or post work for your workspace
          </p>
        </div>
        <CyberButton variant="primary" icon={Plus} onClick={() => setShowCreateModal(true)}>
          Post Task
        </CyberButton>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 200,
          background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)', padding: '0.5rem 0.75rem',
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: '0.85rem', flex: 1,
            }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
            padding: '0.5rem 0.75rem', fontSize: '0.85rem', outline: 'none',
          }}
        >
          <option value="all">All Status</option>
          <option value="created">Open</option>
          <option value="assigned">Assigned</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>

        <button
          onClick={() => setSortBy(sortBy === 'newest' ? 'payout' : 'newest')}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
            padding: '0.5rem 0.75rem', fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          <ArrowUpDown size={14} />
          {sortBy === 'newest' ? 'Newest' : 'Highest Payout'}
        </button>
      </div>

      {/* Task List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading tasks...
        </div>
      ) : filteredTasks.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem',
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
        }}>
          <Briefcase size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {tasks.length === 0 ? 'No tasks yet. Post the first one!' : 'No tasks match your filters.'}
          </p>
          {tasks.length === 0 && (
            <CyberButton variant="primary" icon={Plus} onClick={() => setShowCreateModal(true)}>
              Post a Task
            </CyberButton>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredTasks.map(task => (
            <div
              key={task.taskId || task.id}
              onClick={() => navigate(`/workspace/${task.workspaceId}?tab=tasks`)}
              style={{
                background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)', padding: '1.25rem',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)';
                (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
                (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      {task.title || 'Untitled Task'}
                    </h3>
                    <span style={{
                      fontSize: '0.7rem', padding: '2px 8px', borderRadius: 20,
                      background: `${statusColors[task.status] || '#71717a'}20`,
                      color: statusColors[task.status] || '#71717a',
                      fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {statusLabels[task.status] || task.status}
                    </span>
                  </div>

                  {task.description && (
                    <p style={{
                      color: 'var(--text-secondary)', fontSize: '0.85rem',
                      margin: '0 0 0.75rem', lineHeight: 1.5,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
                    }}>
                      {task.description}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {task.workspaceName && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Globe size={12} /> {task.workspaceName}
                      </span>
                    )}
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <FileText size={12} /> {task.milestones?.length || 0} milestones
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Clock size={12} /> {new Date(task.createdAt).toLocaleDateString()}
                    </span>
                    {task.assigneeAddress && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Users size={12} /> {task.assigneeAddress.slice(0, 6)}...{task.assigneeAddress.slice(-4)}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right', marginLeft: '1rem', flexShrink: 0 }}>
                  <div style={{
                    fontSize: '1.25rem', fontWeight: 700,
                    background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}>
                    {parseFloat(task.totalAmount || '0').toFixed(0)} OTT
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Bounty
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={e => { if (e.target === e.currentTarget) setShowCreateModal(false); }}>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border-default)', padding: '1.5rem',
            maxWidth: 600, width: '90%', maxHeight: '85vh', overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
              Post a Task
            </h2>

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: 'rgba(255,0,128,0.1)', border: '1px solid rgba(255,0,128,0.3)',
                borderRadius: 'var(--radius-md)', padding: '0.75rem', marginBottom: '1rem',
                color: 'var(--accent)', fontSize: '0.85rem',
              }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}

            {txStatus && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)',
                borderRadius: 'var(--radius-md)', padding: '0.75rem', marginBottom: '1rem',
                color: 'var(--primary)', fontSize: '0.85rem',
              }}>
                <span className="spin" style={{ display: 'inline-block' }}>&#x27F3;</span> {txStatus}
              </div>
            )}

            {/* Workspace selector */}
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                Workspace
              </span>
              <select
                value={selectedWorkspace}
                onChange={e => setSelectedWorkspace(e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                  padding: '0.6rem 0.75rem', fontSize: '0.85rem', outline: 'none',
                }}
              >
                <option value="">Select workspace...</option>
                {myWorkspaces.filter(ws => ws.owner.toLowerCase() === address?.toLowerCase()).map(ws => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            </label>

            {/* Title */}
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                Task Title
              </span>
              <input
                type="text"
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                placeholder="e.g. Build a React dashboard component"
                style={{
                  width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                  padding: '0.6rem 0.75rem', fontSize: '0.85rem', outline: 'none',
                }}
              />
            </label>

            {/* Description */}
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                Description
              </span>
              <textarea
                value={taskDescription}
                onChange={e => setTaskDescription(e.target.value)}
                placeholder="Describe the task requirements, expected deliverables, and any technical details..."
                rows={4}
                style={{
                  width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                  padding: '0.6rem 0.75rem', fontSize: '0.85rem', outline: 'none',
                  resize: 'vertical', fontFamily: 'inherit',
                }}
              />
            </label>

            {/* Deadline */}
            <label style={{ display: 'block', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                Deadline
              </span>
              <input
                type="date"
                value={taskDeadline}
                onChange={e => setTaskDeadline(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                style={{
                  width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                  padding: '0.6rem 0.75rem', fontSize: '0.85rem', outline: 'none',
                }}
              />
            </label>

            {/* Milestones */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Milestones</span>
                <button
                  onClick={addMilestone}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--primary)',
                    fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                  }}
                >
                  <Plus size={12} /> Add Milestone
                </button>
              </div>

              {milestones.map((m, i) => (
                <div key={i} style={{
                  display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center',
                }}>
                  <span style={{
                    color: 'var(--text-muted)', fontSize: '0.75rem', width: 20, textAlign: 'center', flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={m.description}
                    onChange={e => updateMilestone(i, 'description', e.target.value)}
                    placeholder="Milestone description"
                    style={{
                      flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                      padding: '0.5rem 0.6rem', fontSize: '0.85rem', outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                    <input
                      type="number"
                      value={m.amount}
                      onChange={e => updateMilestone(i, 'amount', e.target.value)}
                      placeholder="0"
                      min="1"
                      style={{
                        width: 80, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                        padding: '0.5rem 0.6rem', fontSize: '0.85rem', outline: 'none', textAlign: 'right',
                      }}
                    />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>OTT</span>
                  </div>
                  {milestones.length > 1 && (
                    <button
                      onClick={() => removeMilestone(i)}
                      style={{
                        background: 'transparent', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', padding: '0.25rem', flexShrink: 0,
                      }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Cost Summary */}
            <div style={{
              background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem', marginBottom: '1.25rem',
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                <span>Milestone Total</span>
                <span>{totalPayout.toFixed(1)} OTT</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                <span>Platform Fee (5%)</span>
                <span>{platformFee.toFixed(1)} OTT</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', fontSize: '1rem',
                fontWeight: 700, color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)',
                paddingTop: '0.5rem', marginTop: '0.25rem',
              }}>
                <span>Total Escrow</span>
                <span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {(totalPayout + platformFee).toFixed(1)} OTT
                </span>
              </div>
              {ottBalance && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'right' }}>
                  Your balance: {parseFloat(ottBalance).toFixed(1)} OTT
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <CyberButton onClick={() => { setShowCreateModal(false); setError(null); setTxStatus(null); }}>
                Cancel
              </CyberButton>
              <CyberButton
                variant="primary"
                icon={Coins}
                onClick={handleCreateTask}
                loading={creating}
                disabled={creating || !selectedWorkspace || !taskTitle || milestones.some(m => !m.description || !m.amount)}
              >
                Post Task & Escrow {(totalPayout + platformFee).toFixed(0)} OTT
              </CyberButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
