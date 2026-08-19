import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, CheckSquare, Code, FolderOpen,
  Users, ArrowLeft, Globe, Lock, Wallet, PenTool, FileText,
  Activity, Monitor, Workflow, ChevronLeft, ChevronRight
} from 'lucide-react';
import { CyberButton } from '../../components';
import { useWeb3, OnChainWorkspace } from '../../context/Web3Context';
import { OverviewTab } from './OverviewTab';
import { ChatTab } from './ChatTab';
import { TasksTab } from './TasksTab';
import { CodeTab } from './CodeTab';
import { FilesTab } from './FilesTab';
import { MembersTab } from './MembersTab';
import { WhiteboardTab } from './WhiteboardTab';
import { DigestTab } from './DigestTab';
import { HealthTab } from './HealthTab';
import { SandboxPreviewTab } from './SandboxPreviewTab';
import { WorkflowTab } from './WorkflowTab';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'whiteboard', label: 'Whiteboard', icon: PenTool },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'digest', label: 'Digest', icon: FileText },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'preview', label: 'Preview', icon: Monitor },
  { id: 'members', label: 'Members', icon: Users },
];

const FULL_BLEED_TABS = ['whiteboard', 'code', 'preview', 'workflows'];

export function WorkspaceTabs() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const [collapsed, setCollapsed] = useState(false);

  const {
    connected, address, myWorkspaces, refreshWorkspaces,
    getWorkspaceMembers, setShowQRModal,
  } = useWeb3();

  const [workspace, setWorkspace] = useState<OnChainWorkspace | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  // Load workspace — only runs once per workspaceId, not on every context refresh
  useEffect(() => {
    if (!connected || !workspaceId) { setLoading(false); return; }
    if (initializedRef.current) return;

    const found = myWorkspaces.find(ws => ws.id === workspaceId);
    if (found) {
      initializedRef.current = true;
      setWorkspace(found);
      setLoading(false);
      getWorkspaceMembers(workspaceId).then(setMembers).catch(() => {});
      // Auto-sync — register this node with wallet address as unique ID
      const savedName = localStorage.getItem('ott-display-name') || '';
      fetch(`http://localhost:8080/api/v1/workspaces/${workspaceId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ wallet: address, displayName: savedName || address?.slice(0, 10) || 'Unknown' }),
      }).catch(() => {});
    } else if (myWorkspaces.length === 0) {
      refreshWorkspaces();
    } else {
      setLoading(false);
    }
  }, [connected, workspaceId, myWorkspaces.length]);

  // Reset when navigating to a different workspace
  useEffect(() => {
    initializedRef.current = false;
  }, [workspaceId]);

  const setTab = (tab: string) => setSearchParams({ tab }, { replace: true });
  const isOwner = workspace && address && workspace.owner.toLowerCase() === address.toLowerCase();

  if (!connected) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <Wallet size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Connect Wallet</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Connect your wallet to access this workspace</p>
        <CyberButton variant="primary" icon={Wallet} onClick={() => setShowQRModal(true)}>Connect Wallet</CyberButton>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading workspace...</div>;
  }

  if (!workspace) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Workspace not found or you're not a member.</p>
        <CyberButton onClick={() => window.history.back()} style={{ marginTop: '1rem' }}>Go Back</CyberButton>
      </div>
    );
  }

  const sidebarWidth = collapsed ? 48 : 180;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Sidebar */}
      <div style={{
        width: sidebarWidth, flexShrink: 0, transition: 'width 0.2s ease',
        background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Workspace header */}
        <div style={{
          padding: collapsed ? '0.75rem 0.5rem' : '0.75rem 0.85rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}>
          <button
            onClick={() => window.history.back()}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          {!collapsed && (
            <div style={{ overflow: 'hidden', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                {workspace.isPublic
                  ? <Globe size={12} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  : <Lock size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                <span style={{
                  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {workspace.name}
                </span>
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {Number(workspace.memberCount)} members
              </span>
            </div>
          )}
        </div>

        {/* Navigation items */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '0.35rem' }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                title={collapsed ? tab.label : undefined}
                style={{
                  display: 'flex', alignItems: 'center',
                  gap: '0.55rem',
                  width: '100%',
                  padding: collapsed ? '0.5rem 0' : '0.45rem 0.65rem',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: isActive ? 'rgba(0,212,255,0.08)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm, 4px)',
                  borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                  color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.12s',
                  marginBottom: '1px',
                }}
              >
                <Icon size={16} style={{ flexShrink: 0 }} />
                {!collapsed && tab.label}
              </button>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: 'none', border: 'none', borderTop: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)', cursor: 'pointer', padding: '0.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.7rem', gap: '0.3rem',
          }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> Collapse</>}
        </button>
      </div>

      {/* Content area */}
      <div style={{
        flex: 1, minWidth: 0, minHeight: 0, position: 'relative',
        overflow: FULL_BLEED_TABS.includes(activeTab) ? 'hidden' : 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Normal tabs — mount/unmount on switch */}
        {activeTab === 'overview' && (
          <OverviewTab
            workspace={workspace} workspaceId={workspaceId!}
            members={members} isOwner={!!isOwner} onSwitchTab={setTab}
          />
        )}
        {activeTab === 'chat' && (
          <ChatTab workspace={workspace} workspaceId={workspaceId!} />
        )}
        {activeTab === 'tasks' && (
          <TasksTab workspaceId={workspaceId!} />
        )}
        {activeTab === 'files' && (
          <FilesTab workspaceId={workspaceId!} />
        )}
        {activeTab === 'digest' && (
          <DigestTab workspaceId={workspaceId!} />
        )}
        {activeTab === 'health' && (
          <HealthTab workspaceId={workspaceId!} />
        )}
        {activeTab === 'preview' && (
          <SandboxPreviewTab workspaceId={workspaceId!} />
        )}
        {activeTab === 'members' && (
          <MembersTab
            workspace={workspace} workspaceId={workspaceId!}
            members={members} isOwner={!!isOwner} address={address}
          />
        )}

        {/*
          Persistent tabs — always mounted, shown/hidden via CSS.
          This keeps code-server, whiteboard, and workflows alive
          so they don't reload when you switch to chat and back.
        */}
        <div style={{
          display: activeTab === 'code' ? 'flex' : 'none',
          flexDirection: 'column', flex: 1, minHeight: 0,
        }}>
          <CodeTab workspaceId={workspaceId!} />
        </div>
        <div style={{
          display: activeTab === 'whiteboard' ? 'flex' : 'none',
          flexDirection: 'column', flex: 1, minHeight: 0,
        }}>
          <WhiteboardTab workspaceId={workspaceId!} />
        </div>
        <div style={{
          display: activeTab === 'workflows' ? 'flex' : 'none',
          flexDirection: 'column', flex: 1, minHeight: 0,
        }}>
          <WorkflowTab workspaceId={workspaceId!} />
        </div>
      </div>
    </div>
  );
}
