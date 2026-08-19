import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, addEdge,
  Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeTypes, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CheckSquare, Shield, Bot, Bell, HardDrive, Plus, Save, Trash2,
  Play, Loader, Coins, FileText, Zap, GitBranch,
} from 'lucide-react';

const API_BASE = 'http://localhost:8080/api/v1';

// ── Custom Node Components ──

function TaskNode({ data }: NodeProps) {
  return (
    <div style={{
      background: 'var(--bg-secondary, #1a1a2e)', border: '2px solid #00D4FF',
      borderRadius: 8, padding: '10px 14px', minWidth: 160, color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', fontSize: 13,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#00D4FF' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <CheckSquare size={14} color="#00D4FF" />
        <strong style={{ color: '#00D4FF', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Task</strong>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{data.label as string}</div>
      {data.assignee && <div style={{ fontSize: 11, color: '#888' }}>Assignee: {data.assignee as string}</div>}
      {data.priority && (
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 8, marginTop: 4, display: 'inline-block',
          background: data.priority === 'high' ? '#FF008020' : data.priority === 'medium' ? '#B87FD620' : '#71717a20',
          color: data.priority === 'high' ? '#FF0080' : data.priority === 'medium' ? '#B87FD6' : '#71717a',
        }}>
          {data.priority as string}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#00D4FF' }} />
    </div>
  );
}

function EscrowGateNode({ data }: NodeProps) {
  return (
    <div style={{
      background: 'var(--bg-secondary, #1a1a2e)', border: '2px solid #00FF88',
      borderRadius: 8, padding: '10px 14px', minWidth: 160, color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', fontSize: 13,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#00FF88' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Coins size={14} color="#00FF88" />
        <strong style={{ color: '#00FF88', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Escrow Gate</strong>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{data.label as string}</div>
      {data.amount && <div style={{ fontSize: 12, color: '#00FF88', fontWeight: 700 }}>{data.amount as string} OTT</div>}
      {data.condition && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Condition: {data.condition as string}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: '#00FF88' }} />
    </div>
  );
}

function AICheckpointNode({ data }: NodeProps) {
  return (
    <div style={{
      background: 'var(--bg-secondary, #1a1a2e)', border: '2px solid #B87FD6',
      borderRadius: 8, padding: '10px 14px', minWidth: 160, color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', fontSize: 13,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#B87FD6' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Bot size={14} color="#B87FD6" />
        <strong style={{ color: '#B87FD6', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>AI Checkpoint</strong>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{data.label as string}</div>
      {data.model && <div style={{ fontSize: 11, color: '#888' }}>Model: {data.model as string}</div>}
      {data.action && <div style={{ fontSize: 11, color: '#B87FD6' }}>{data.action as string}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: '#B87FD6' }} />
    </div>
  );
}

function NotificationNode({ data }: NodeProps) {
  return (
    <div style={{
      background: 'var(--bg-secondary, #1a1a2e)', border: '2px solid #FF9800',
      borderRadius: 8, padding: '10px 14px', minWidth: 140, color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', fontSize: 13,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#FF9800' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Bell size={14} color="#FF9800" />
        <strong style={{ color: '#FF9800', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notify</strong>
      </div>
      <div style={{ fontWeight: 600 }}>{data.label as string}</div>
      {data.channel && <div style={{ fontSize: 11, color: '#888' }}>Via: {data.channel as string}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: '#FF9800' }} />
    </div>
  );
}

function IPFSExportNode({ data }: NodeProps) {
  return (
    <div style={{
      background: 'var(--bg-secondary, #1a1a2e)', border: '2px solid #2196F3',
      borderRadius: 8, padding: '10px 14px', minWidth: 140, color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', fontSize: 13,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#2196F3' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <HardDrive size={14} color="#2196F3" />
        <strong style={{ color: '#2196F3', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>IPFS Export</strong>
      </div>
      <div style={{ fontWeight: 600 }}>{data.label as string}</div>
      {data.artifactType && <div style={{ fontSize: 11, color: '#888' }}>Type: {data.artifactType as string}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: '#2196F3' }} />
    </div>
  );
}

function ConditionNode({ data }: NodeProps) {
  return (
    <div style={{
      background: 'var(--bg-secondary, #1a1a2e)', border: '2px solid #FF0080',
      borderRadius: 8, padding: '10px 14px', minWidth: 140, color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', fontSize: 13,
      transform: 'rotate(0deg)',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#FF0080' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <GitBranch size={14} color="#FF0080" />
        <strong style={{ color: '#FF0080', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Condition</strong>
      </div>
      <div style={{ fontWeight: 600 }}>{data.label as string}</div>
      {data.expression && <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{data.expression as string}</div>}
      <Handle type="source" position={Position.Bottom} id="yes" style={{ background: '#00FF88', left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="no" style={{ background: '#FF0080', left: '70%' }} />
    </div>
  );
}

// ── Node type palette ──

const NODE_PALETTE = [
  { type: 'task', label: 'Task', icon: CheckSquare, color: '#00D4FF', defaults: { priority: 'medium' } },
  { type: 'escrowGate', label: 'Escrow Gate', icon: Coins, color: '#00FF88', defaults: { amount: '100' } },
  { type: 'aiCheckpoint', label: 'AI Checkpoint', icon: Bot, color: '#B87FD6', defaults: { action: 'Review code quality' } },
  { type: 'notification', label: 'Notification', icon: Bell, color: '#FF9800', defaults: { channel: 'workspace chat' } },
  { type: 'ipfsExport', label: 'IPFS Export', icon: HardDrive, color: '#2196F3', defaults: { artifactType: 'milestone' } },
  { type: 'condition', label: 'Condition', icon: GitBranch, color: '#FF0080', defaults: { expression: 'status == approved' } },
];

// ── Main Component ──

interface Props {
  workspaceId: string;
}

export function WorkflowTab({ workspaceId }: Props) {
  const nodeTypes: NodeTypes = useMemo(() => ({
    task: TaskNode,
    escrowGate: EscrowGateNode,
    aiCheckpoint: AICheckpointNode,
    notification: NotificationNode,
    ipfsExport: IPFSExportNode,
    condition: ConditionNode,
  }), []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [flowName, setFlowName] = useState('New Workflow');
  const [saved, setSaved] = useState(false);
  const [flows, setFlows] = useState<any[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' };

  // Load existing flows
  useEffect(() => {
    fetch(`${API_BASE}/workspaces/${workspaceId}/flows`, { headers: { Authorization: 'Bearer local-token' } })
      .then(r => r.json())
      .then(d => {
        const list = d.flows || [];
        setFlows(list);
        if (list.length > 0) {
          loadFlow(list[0]);
        }
      })
      .catch(() => {});
  }, [workspaceId]);

  const loadFlow = (flow: any) => {
    setActiveFlowId(flow.id);
    setFlowName(flow.name || 'Untitled');
    if (flow.definition?.nodes) setNodes(flow.definition.nodes);
    if (flow.definition?.edges) setEdges(flow.definition.edges);
    setSaved(true);
  };

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({
      ...connection,
      animated: true,
      style: { stroke: '#555' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#555' },
    }, eds));
    setSaved(false);
  }, [setEdges]);

  const addNode = (type: string, defaults: Record<string, any>) => {
    const id = `${type}-${Date.now()}`;
    const newNode: Node = {
      id,
      type,
      position: { x: 250 + Math.random() * 200, y: 100 + nodes.length * 120 },
      data: { label: `New ${type}`, ...defaults },
    };
    setNodes(nds => [...nds, newNode]);
    setSaved(false);
  };

  const saveFlow = async () => {
    const definition = { nodes, edges };
    try {
      if (activeFlowId) {
        // Update by deleting and recreating (simple CRUD)
        await fetch(`${API_BASE}/workspaces/${workspaceId}/flows/${activeFlowId}`, {
          method: 'DELETE', headers,
        });
      }
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/flows`, {
        method: 'POST', headers,
        body: JSON.stringify({ name: flowName, definition, type: 'visual-workflow' }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveFlowId(data.flow.id);
        setSaved(true);
        // Refresh list
        const listRes = await fetch(`${API_BASE}/workspaces/${workspaceId}/flows`, { headers: { Authorization: 'Bearer local-token' } });
        const listData = await listRes.json();
        setFlows(listData.flows || []);
      }
    } catch {}
  };

  const deleteFlow = async () => {
    if (!activeFlowId) return;
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/flows/${activeFlowId}`, {
        method: 'DELETE', headers,
      });
      setNodes([]);
      setEdges([]);
      setActiveFlowId(null);
      setFlowName('New Workflow');
      setFlows(prev => prev.filter(f => f.id !== activeFlowId));
    } catch {}
  };

  const newFlow = () => {
    setNodes([]);
    setEdges([]);
    setActiveFlowId(null);
    setFlowName('New Workflow');
    setSaved(false);
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Sidebar — node palette + flow list */}
      <div style={{
        width: 200, borderRight: '1px solid var(--border-subtle, #333)',
        background: 'var(--bg-secondary, #12122a)', padding: '0.75rem',
        display: 'flex', flexDirection: 'column', gap: '0.75rem', flexShrink: 0, overflow: 'auto',
      }}>
        {/* Flow name */}
        <input
          value={flowName} onChange={e => { setFlowName(e.target.value); setSaved(false); }}
          style={{
            background: 'var(--bg-tertiary, #1a1a3e)', border: '1px solid var(--border-subtle, #333)',
            borderRadius: 4, color: 'var(--text-primary, #e0e0e0)', padding: '0.4rem 0.5rem',
            fontSize: 13, outline: 'none', width: '100%',
          }}
        />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={saveFlow} title="Save" style={btnStyle('#00D4FF')}>
            <Save size={13} />
          </button>
          <button onClick={newFlow} title="New" style={btnStyle('#00FF88')}>
            <Plus size={13} />
          </button>
          <button onClick={deleteFlow} title="Delete" style={btnStyle('#FF0080')}>
            <Trash2 size={13} />
          </button>
          {!saved && <span style={{ fontSize: 10, color: '#FF9800', alignSelf: 'center' }}>unsaved</span>}
        </div>

        {/* Node palette */}
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Add Nodes
        </div>
        {NODE_PALETTE.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              onClick={() => addNode(item.type, { label: item.label, ...item.defaults })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg-tertiary, #1a1a3e)', border: `1px solid ${item.color}30`,
                borderRadius: 6, padding: '8px 10px', cursor: 'pointer',
                color: 'var(--text-primary, #e0e0e0)', fontSize: 12, width: '100%',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = item.color)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = `${item.color}30`)}
            >
              <Icon size={14} color={item.color} />
              {item.label}
            </button>
          );
        })}

        {/* Saved flows */}
        {flows.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 }}>
              Saved Flows
            </div>
            {flows.map(f => (
              <button
                key={f.id}
                onClick={() => loadFlow(f)}
                style={{
                  background: f.id === activeFlowId ? 'rgba(0,212,255,0.1)' : 'var(--bg-tertiary, #1a1a3e)',
                  border: f.id === activeFlowId ? '1px solid rgba(0,212,255,0.3)' : '1px solid var(--border-subtle, #333)',
                  borderRadius: 4, padding: '6px 8px', cursor: 'pointer',
                  color: 'var(--text-primary, #e0e0e0)', fontSize: 12, width: '100%', textAlign: 'left',
                }}
              >
                {f.name || 'Untitled'}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Canvas */}
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes) => { onNodesChange(changes); setSaved(false); }}
          onEdgesChange={(changes) => { onEdgesChange(changes); setSaved(false); }}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          style={{ background: 'var(--bg-primary, #0a0a1a)' }}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: '#555' },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#555' },
          }}
        >
          <Background color="#222" gap={16} />
          <Controls style={{ button: { background: '#1a1a3e', color: '#e0e0e0', border: '1px solid #333' } } as any} />
          <MiniMap
            nodeColor={(node) => {
              switch (node.type) {
                case 'task': return '#00D4FF';
                case 'escrowGate': return '#00FF88';
                case 'aiCheckpoint': return '#B87FD6';
                case 'notification': return '#FF9800';
                case 'ipfsExport': return '#2196F3';
                case 'condition': return '#FF0080';
                default: return '#555';
              }
            }}
            style={{ background: '#0a0a1a', border: '1px solid #333' }}
            maskColor="rgba(0,0,0,0.7)"
          />
          {nodes.length === 0 && (
            <Panel position="top-center">
              <div style={{
                background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '1.5rem 2rem',
                color: '#888', fontSize: 14, textAlign: 'center', marginTop: '20vh',
              }}>
                <Zap size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                <div style={{ fontWeight: 600, color: '#e0e0e0', marginBottom: 4 }}>Visual Workflow Editor</div>
                <div>Add nodes from the sidebar and connect them to build automation pipelines.</div>
                <div style={{ fontSize: 12, marginTop: 8, color: '#666' }}>
                  Tasks, escrow gates, AI checkpoints, notifications, IPFS exports, conditions
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}

const btnStyle = (color: string): React.CSSProperties => ({
  background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 4,
  color, cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center',
});
