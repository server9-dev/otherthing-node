import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, CheckSquare, Code, FolderOpen,
  Users, ArrowLeft, Globe, Lock, Wallet, PenTool, FileText,
  Activity, Monitor, Brain
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
import { OpenWebUITab } from './OpenWebUITab';

const API_BASE = 'http://localhost:8080';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'whiteboard', label: 'Whiteboard', icon: PenTool },
  { id: 'digest', label: 'Digest', icon: FileText },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'preview', label: 'Preview', icon: Monitor },
  { id: 'openwebui', label: 'AI Studio', icon: Brain },
  { id: 'members', label: 'Members', icon: Users },
];

export function WorkspaceTabs() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';

  const {
    connected, address, myWorkspaces, refreshWorkspaces,
    getWorkspaceMembers, setShowQRModal,
  } = useWeb3();

  const [workspace, setWorkspace] = useState<OnChainWorkspace | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Load workspace
  useEffect(() => {
    if (!connected || !workspaceId) { setLoading(false); return; }

    const found = myWorkspaces.find(ws => ws.id === workspaceId);
    if (found) {
      setWorkspace(found);
      setLoading(false);
      getWorkspaceMembers(workspaceId).then(setMembers).catch(() => {});
    } else if (myWorkspaces.length === 0) {
      refreshWorkspaces();
    } else {
      setLoading(false);
    }
  }, [connected, workspaceId, myWorkspaces.length]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Workspace Header */}
      <div style={{
        padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <button
            onClick={() => window.history.back()}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {workspace.isPublic ? <Globe size={16} style={{ color: 'var(--primary)' }} /> : <Lock size={16} style={{ color: 'var(--accent)' }} />}
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {workspace.name}
            </h1>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {Number(workspace.memberCount)} members
          </span>
        </div>

        {/* Tab Bar */}
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.5rem 0.85rem', background: 'transparent', border: 'none',
                  borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                  color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '0.8rem', fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div style={{
        flex: 1, minHeight: 0,
        overflow: (['whiteboard', 'code', 'preview', 'openwebui'].includes(activeTab)) ? 'hidden' : 'auto',
        display: (['whiteboard', 'code', 'preview', 'openwebui'].includes(activeTab)) ? 'flex' : undefined,
        flexDirection: (['whiteboard', 'code', 'preview', 'openwebui'].includes(activeTab)) ? 'column' : undefined,
      }}>
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
        {activeTab === 'code' && (
          <CodeTab workspaceId={workspaceId!} />
        )}
        {activeTab === 'files' && (
          <FilesTab workspaceId={workspaceId!} />
        )}
        {activeTab === 'whiteboard' && (
          <WhiteboardTab workspaceId={workspaceId!} />
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
        {activeTab === 'openwebui' && (
          <OpenWebUITab />
        )}
        {activeTab === 'members' && (
          <MembersTab
            workspace={workspace} workspaceId={workspaceId!}
            members={members} isOwner={!!isOwner} address={address}
          />
        )}
      </div>
    </div>
  );
}
