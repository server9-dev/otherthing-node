import { useState, useEffect, useCallback } from 'react';
import { Plus, GripVertical, Edit3, Trash2, X, Check, Coins } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = [
  { id: 'todo', label: 'Backlog', color: 'var(--text-muted)' },
  { id: 'in_progress', label: 'In Progress', color: 'var(--primary)' },
  { id: 'review', label: 'Review', color: 'var(--secondary)' },
  { id: 'done', label: 'Done', color: '#00FF88' },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: '#FF0080', medium: '#B87FD6', low: '#00D4FF',
};

interface Props { workspaceId: string; }

export function TasksTab({ workspaceId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // Create form
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newStatus, setNewStatus] = useState('todo');

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/tasks`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {} finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const createTask = async () => {
    if (!newTitle.trim()) return;
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ title: newTitle, description: newDesc, priority: newPriority, status: newStatus }),
      });
      setNewTitle(''); setNewDesc(''); setNewPriority('medium'); setNewStatus('todo');
      setShowCreate(false);
      loadTasks();
    } catch {}
  };

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify(updates),
      });
      loadTasks();
    } catch {}
  };

  const deleteTask = async (taskId: string) => {
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/tasks/${taskId}`, {
        method: 'DELETE', headers: { Authorization: 'Bearer local-token' },
      });
      loadTasks();
    } catch {}
  };

  const handleDrop = (columnId: string) => {
    if (draggedTask && draggedTask.status !== columnId) {
      updateTask(draggedTask.id, { status: columnId });
    }
    setDraggedTask(null);
    setDragOverCol(null);
  };

  return (
    <div style={{ padding: '1rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
        <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1rem' }}>
          Tasks <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({tasks.length})</span>
        </h3>
        <CyberButton variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>
          New Task
        </CyberButton>
      </div>

      {/* Kanban Board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', flex: 1, overflow: 'auto' }}>
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.id);
          return (
            <div
              key={col.id}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={() => handleDrop(col.id)}
              style={{
                background: dragOverCol === col.id ? 'rgba(0,212,255,0.05)' : 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${dragOverCol === col.id ? 'var(--primary)' : 'var(--border-subtle)'}`,
                display: 'flex', flexDirection: 'column',
                transition: 'all 0.15s',
              }}
            >
              {/* Column header */}
              <div style={{
                padding: '0.75rem', borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{col.label}</span>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: 10 }}>
                  {colTasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div style={{ padding: '0.5rem', flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {colTasks.map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggedTask(task)}
                    onDragEnd={() => { setDraggedTask(null); setDragOverCol(null); }}
                    style={{
                      padding: '0.6rem 0.75rem', background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
                      cursor: 'grab', opacity: draggedTask?.id === task.id ? 0.4 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {editingId === task.id ? (
                      <EditTaskInline
                        task={task}
                        onSave={(updates) => { updateTask(task.id, updates); setEditingId(null); }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                            {task.title}
                          </span>
                          <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0, marginLeft: '0.5rem' }}>
                            <button onClick={() => setEditingId(task.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
                              <Edit3 size={11} />
                            </button>
                            <button onClick={() => deleteTask(task.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                        {task.description && (
                          <div style={{
                            fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
                          }}>
                            {task.description}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: '0.6rem', padding: '1px 5px', borderRadius: 8,
                            background: `${PRIORITY_COLORS[task.priority] || 'var(--text-muted)'}20`,
                            color: PRIORITY_COLORS[task.priority] || 'var(--text-muted)',
                            textTransform: 'uppercase', fontWeight: 600,
                          }}>
                            {task.priority}
                          </span>
                          {(task as any).bounty && parseFloat((task as any).bounty) > 0 && (
                            <span style={{
                              fontSize: '0.6rem', padding: '1px 5px', borderRadius: 8,
                              background: 'rgba(0,212,255,0.1)', color: 'var(--primary)',
                              fontWeight: 600,
                            }}>
                              {parseFloat((task as any).bounty).toFixed(0)} OTT
                            </span>
                          )}
                          {(task as any).milestones?.length > 0 && (
                            <span style={{
                              fontSize: '0.6rem', padding: '1px 5px', borderRadius: 8,
                              background: 'rgba(155,89,182,0.1)', color: 'var(--secondary)',
                              fontWeight: 600,
                            }}>
                              {(task as any).milestones.length} milestones
                            </span>
                          )}
                        </div>
                        {/* Milestone breakdown when expanded */}
                        {editingId === task.id && (task as any).milestones?.length > 0 && (
                          <div style={{ marginTop: '0.5rem', padding: '0.4rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Escrow Breakdown</div>
                            {(task as any).milestones.map((m: any, i: number) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)', padding: '0.15rem 0' }}>
                                <span>{m.description}</span>
                                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{parseFloat(m.amount).toFixed(0)} OTT</span>
                              </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginTop: '0.25rem', paddingTop: '0.25rem', borderTop: '1px solid var(--border-subtle)' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Platform fee (5%)</span>
                              <span style={{ color: 'var(--text-muted)' }}>{(parseFloat((task as any).bounty) * 0.05).toFixed(1)} OTT</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, marginTop: '0.2rem' }}>
                              <span style={{ color: 'var(--text-primary)' }}>Total Escrow</span>
                              <span style={{ color: 'var(--primary)' }}>{(parseFloat((task as any).bounty) * 1.05).toFixed(0)} OTT</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}

                {colTasks.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    Drop tasks here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Task Modal */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border-default)', padding: '1.5rem', width: 450,
          }}>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '1rem', fontSize: '1.1rem' }}>New Task</h3>

            <input
              type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Task title" autoFocus
              style={{
                width: '100%', marginBottom: '0.75rem', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', padding: '0.6rem', fontSize: '0.85rem', outline: 'none',
              }}
            />
            <textarea
              value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Description (optional)" rows={3}
              style={{
                width: '100%', marginBottom: '0.75rem', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)', padding: '0.6rem', fontSize: '0.85rem', outline: 'none',
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={{
                flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', padding: '0.5rem', fontSize: '0.85rem', outline: 'none',
              }}>
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </select>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{
                flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', padding: '0.5rem', fontSize: '0.85rem', outline: 'none',
              }}>
                {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <CyberButton onClick={() => setShowCreate(false)}>Cancel</CyberButton>
              <CyberButton variant="primary" icon={Plus} onClick={createTask} disabled={!newTitle.trim()}>Create</CyberButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline edit component
function EditTaskInline({ task, onSave, onCancel }: { task: Task; onSave: (u: Partial<Task>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description);
  const [priority, setPriority] = useState(task.priority);

  return (
    <div onClick={e => e.stopPropagation()}>
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus
        style={{ width: '100%', marginBottom: '0.4rem', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', padding: '0.3rem 0.5rem', fontSize: '0.8rem', outline: 'none' }}
      />
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
        style={{ width: '100%', marginBottom: '0.4rem', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', padding: '0.3rem 0.5rem', fontSize: '0.75rem', outline: 'none', resize: 'none', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
        <select value={priority} onChange={e => setPriority(e.target.value)}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-primary)', padding: '0.2rem', fontSize: '0.7rem', outline: 'none' }}
        >
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}><X size={12} /></button>
          <button onClick={() => onSave({ title, description: desc, priority })} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '2px' }}><Check size={12} /></button>
        </div>
      </div>
    </div>
  );
}
