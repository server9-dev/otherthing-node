/**
 * Workspace Codebase Page
 *
 * Displays repository connection, analysis, and health metrics for a workspace.
 * Integrates with on-bored for comprehensive codebase insights.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FolderGit2, RefreshCw, Plus, Trash2,
  Code, GitBranch, Activity, FileCode, Folder
} from 'lucide-react';
import { CyberButton, CodebaseHealth, RepoConnectionPanel } from '../components';
import type { RepoAnalysis } from '../../services/repo-analyzer';

const API_BASE = 'http://localhost:8080';

interface WorkspaceRepo {
  id: string;
  url: string;
  name: string;
  status: 'pending' | 'cloning' | 'analyzing' | 'ready' | 'error';
  localPath?: string;
  analysis?: RepoAnalysis;
  analyzedAt?: string;
  error?: string;
  addedBy: string;
  addedAt: string;
}

export function WorkspaceCodebasePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

  const [repos, setRepos] = useState<WorkspaceRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<WorkspaceRepo | null>(null);
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local path for direct analysis
  const [localPath, setLocalPath] = useState('');

  const loadRepos = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/repos`);
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos || []);
        // Auto-select first repo with analysis
        const repoWithAnalysis = (data.repos || []).find((r: WorkspaceRepo) => r.analysis);
        if (repoWithAnalysis) {
          setSelectedRepo(repoWithAnalysis);
          setAnalysis(repoWithAnalysis.analysis!);
        }
      }
    } catch (err) {
      console.error('Failed to load repos:', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const analyzeRepo = async (repo: WorkspaceRepo) => {
    if (!repo.localPath) {
      setError('Repository must be cloned first');
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/repos/${repo.id}/analyze`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysis(data.analysis);
        setSelectedRepo({ ...repo, analysis: data.analysis, status: 'ready' });
        loadRepos(); // Refresh list
      } else {
        setError(data.error || 'Analysis failed');
      }
    } catch (err) {
      setError('Failed to analyze repository');
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeLocalPath = async () => {
    if (!localPath.trim()) {
      setError('Please enter a path to analyze');
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/repos/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: localPath.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnalysis(data.analysis);
        setSelectedRepo(null); // Clear workspace repo selection
      } else {
        setError(data.error || 'Analysis failed');
      }
    } catch (err) {
      setError('Failed to analyze path');
    } finally {
      setAnalyzing(false);
    }
  };

  const deleteRepo = async (repoId: string) => {
    if (!confirm('Remove this repository from the workspace?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/repos/${repoId}`, {
        method: 'DELETE',
      });
      if (selectedRepo?.id === repoId) {
        setSelectedRepo(null);
        setAnalysis(null);
      }
      loadRepos();
    } catch (err) {
      setError('Failed to remove repository');
    }
  };

  const handleRepoConnected = (repoUrl: string, repoName: string) => {
    setShowAddRepo(false);
    loadRepos();
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
          <button
            onClick={() => navigate(`/workspace/${workspaceId}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              marginBottom: 'var(--gap-sm)',
              fontSize: '0.85rem',
            }}
          >
            <ArrowLeft size={16} />
            Back to Workspace
          </button>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
            <Code size={28} style={{ color: 'var(--primary)' }} />
            Codebase Analysis
          </h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
            Connect repositories and analyze codebase health
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
          <CyberButton icon={RefreshCw} onClick={loadRepos}>
            REFRESH
          </CyberButton>
          <CyberButton variant="primary" icon={Plus} onClick={() => setShowAddRepo(true)}>
            ADD REPO
          </CyberButton>
        </div>
      </div>

      {/* Error */}
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
          {error}
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 'var(--gap-xl)' }}>
        {/* Left Sidebar - Repos & Quick Analyze */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-lg)' }}>
          {/* Quick Analyze Local Path */}
          <div className="cyber-card">
            <div className="cyber-card-header">
              <span className="cyber-card-title">QUICK ANALYZE</span>
            </div>
            <div className="cyber-card-body">
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }}>
                Analyze any local repository by path
              </p>
              <input
                type="text"
                value={localPath}
                onChange={e => setLocalPath(e.target.value)}
                placeholder="/path/to/repository"
                style={{
                  width: '100%',
                  padding: 'var(--gap-sm)',
                  background: 'var(--bg-void)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  marginBottom: 'var(--gap-sm)',
                }}
              />
              <CyberButton
                variant="primary"
                icon={Activity}
                onClick={analyzeLocalPath}
                disabled={analyzing || !localPath.trim()}
                style={{ width: '100%' }}
              >
                {analyzing ? 'ANALYZING...' : 'ANALYZE'}
              </CyberButton>
            </div>
          </div>

          {/* Connected Repos */}
          <div className="cyber-card">
            <div className="cyber-card-header">
              <span className="cyber-card-title">REPOSITORIES</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{repos.length} total</span>
            </div>
            <div className="cyber-card-body">
              {loading ? (
                <div style={{ textAlign: 'center', padding: 'var(--gap-lg)', color: 'var(--text-muted)' }}>
                  Loading...
                </div>
              ) : repos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--gap-lg)' }}>
                  <FolderGit2 size={32} style={{ color: 'var(--text-muted)', opacity: 0.5, marginBottom: 'var(--gap-sm)' }} />
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No repositories connected</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
                  {repos.map(repo => (
                    <div
                      key={repo.id}
                      onClick={() => {
                        setSelectedRepo(repo);
                        if (repo.analysis) setAnalysis(repo.analysis);
                      }}
                      style={{
                        padding: 'var(--gap-md)',
                        background: selectedRepo?.id === repo.id ? 'rgba(0, 255, 136, 0.1)' : 'var(--bg-void)',
                        border: selectedRepo?.id === repo.id ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{
                            fontWeight: 500,
                            color: 'var(--text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}>
                            <GitBranch size={14} style={{ color: 'var(--primary)' }} />
                            {repo.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {repo.status === 'ready' && repo.analyzedAt
                              ? `Analyzed ${new Date(repo.analyzedAt).toLocaleDateString()}`
                              : repo.status
                            }
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); deleteRepo(repo.id); }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--error)',
                            cursor: 'pointer',
                            padding: '4px',
                            opacity: 0.6,
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content - Analysis */}
        <div>
          {analyzing ? (
            <div className="cyber-card" style={{ padding: 'var(--gap-xl)', textAlign: 'center' }}>
              <RefreshCw size={48} className="animate-spin" style={{ color: 'var(--primary)', marginBottom: 'var(--gap-md)' }} />
              <p style={{ color: 'var(--text-muted)' }}>Analyzing repository...</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                This may take a moment for large codebases
              </p>
            </div>
          ) : analysis ? (
            <CodebaseHealth
              analysis={analysis}
              loading={false}
              onRefresh={() => {
                if (selectedRepo) {
                  analyzeRepo(selectedRepo);
                } else if (localPath.trim()) {
                  analyzeLocalPath();
                }
              }}
            />
          ) : (
            <div className="cyber-card" style={{ padding: 'var(--gap-xl)', textAlign: 'center' }}>
              <FileCode size={64} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 'var(--gap-md)' }} />
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 'var(--gap-md)' }}>
                No Analysis Yet
              </h3>
              <p style={{ color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto var(--gap-lg)' }}>
                Select a repository from the sidebar or enter a local path to analyze its health, contributors, tech stack, and architecture.
              </p>
              <CyberButton variant="primary" icon={Plus} onClick={() => setShowAddRepo(true)}>
                CONNECT REPOSITORY
              </CyberButton>
            </div>
          )}
        </div>
      </div>

      {/* Add Repo Modal */}
      {showAddRepo && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setShowAddRepo(false)}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--gap-xl)',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--gap-lg)' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>
                Connect Repository
              </h3>
              <button
                onClick={() => setShowAddRepo(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '1.5rem',
                }}
              >
                ×
              </button>
            </div>

            <RepoConnectionPanel
              workspaceId={workspaceId!}
              onRepoConnected={handleRepoConnected}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkspaceCodebasePage;
