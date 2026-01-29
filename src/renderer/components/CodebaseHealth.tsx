/**
 * Codebase Health Panel Component
 *
 * Displays repository analysis including contributors, tech stack,
 * activity metrics, and health indicators.
 */

import { useState } from 'react';
import {
  Users, GitBranch, Code, Package, Activity, AlertTriangle,
  FileCode, Folder, Clock, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronRight, ExternalLink, RefreshCw
} from 'lucide-react';
import type { RepoAnalysis, Contributor, TechStackItem, MermaidFlow } from '../../services/repo-analyzer';
import { MermaidDiagram } from './MermaidDiagram';

interface CodebaseHealthProps {
  analysis: RepoAnalysis | null;
  loading?: boolean;
  onRefresh?: () => void;
}

// ============ Sub-components ============

function StatCard({ icon: Icon, label, value, trend, color = '#8b5cf6' }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}) {
  return (
    <div style={{
      background: '#27272a',
      border: '1px solid #3f3f46',
      borderRadius: '8px',
      padding: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    }}>
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: '8px',
        background: `${color}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: '12px', color: '#a1a1aa' }}>{label}</div>
        <div style={{ fontSize: '20px', fontWeight: 600, color: '#fafafa', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {value}
          {trend === 'up' && <TrendingUp size={14} style={{ color: '#22c55e' }} />}
          {trend === 'down' && <TrendingDown size={14} style={{ color: '#ef4444' }} />}
          {trend === 'neutral' && <Minus size={14} style={{ color: '#71717a' }} />}
        </div>
      </div>
    </div>
  );
}

function ContributorCard({ contributor, rank }: { contributor: Contributor; rank: number }) {
  const colors = ['#fbbf24', '#a1a1aa', '#b45309'];
  const medalColor = colors[rank] || '#71717a';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px',
      background: '#27272a',
      borderRadius: '8px',
      border: '1px solid #3f3f46',
    }}>
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: medalColor + '30',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: 600,
        color: medalColor,
      }}>
        #{rank + 1}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: '#fafafa' }}>
          {contributor.name}
        </div>
        <div style={{ fontSize: '12px', color: '#a1a1aa' }}>
          {contributor.commits} commits • {contributor.focus}
        </div>
      </div>
    </div>
  );
}

function TechStackBadge({ item }: { item: TechStackItem }) {
  const typeColors: Record<string, string> = {
    framework: '#8b5cf6',
    language: '#3b82f6',
    database: '#22c55e',
    tool: '#f97316',
    library: '#ec4899',
    infrastructure: '#06b6d4',
  };

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 10px',
      background: `${typeColors[item.type] || '#71717a'}20`,
      border: `1px solid ${typeColors[item.type] || '#71717a'}40`,
      borderRadius: '6px',
      fontSize: '12px',
      color: '#fafafa',
    }}>
      {item.name}
      {item.version && (
        <span style={{ fontSize: '10px', color: '#a1a1aa' }}>{item.version}</span>
      )}
    </span>
  );
}

function ActivityChart({ data }: { data: Array<{ label: string; total: number; fixes: number }> }) {
  const maxValue = Math.max(...data.map(d => d.total), 1);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
      height: '120px',
      padding: '16px 0',
    }}>
      {data.map((month, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}>
            <div
              style={{
                width: '100%',
                maxWidth: '40px',
                height: `${(month.total / maxValue) * 80}px`,
                background: '#8b5cf6',
                borderRadius: '4px 4px 0 0',
                minHeight: '4px',
              }}
              title={`${month.total} commits`}
            />
            <div
              style={{
                width: '100%',
                maxWidth: '40px',
                height: `${(month.fixes / maxValue) * 80}px`,
                background: '#ef4444',
                borderRadius: '0 0 4px 4px',
                minHeight: month.fixes > 0 ? '4px' : '0',
              }}
              title={`${month.fixes} fixes`}
            />
          </div>
          <span style={{ fontSize: '10px', color: '#a1a1aa' }}>{month.label}</span>
        </div>
      ))}
    </div>
  );
}

function CollapsibleSection({ title, icon: Icon, children, defaultOpen = true }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background: '#18181b',
      border: '1px solid #3f3f46',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#fafafa',
        }}
      >
        <Icon size={18} style={{ color: '#8b5cf6' }} />
        <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{title}</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #3f3f46' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============ Main Component ============

export function CodebaseHealth({ analysis, loading, onRefresh }: CodebaseHealthProps) {
  const [activeFlowIndex, setActiveFlowIndex] = useState(0);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px',
        color: '#a1a1aa',
      }}>
        <RefreshCw size={32} className="animate-spin" style={{ marginBottom: '16px' }} />
        <p>Analyzing repository...</p>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px',
        color: '#a1a1aa',
      }}>
        <Code size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <p style={{ marginBottom: '8px' }}>No repository analyzed</p>
        <p style={{ fontSize: '12px' }}>Connect a repository to see health metrics</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#fafafa' }}>
            {analysis.repoName}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#a1a1aa' }}>
            {analysis.primaryLanguage} • {analysis.currentBranch}
          </p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            style={{
              padding: '8px 16px',
              background: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              color: '#fafafa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        )}
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
      }}>
        <StatCard
          icon={GitBranch}
          label="Total Commits"
          value={analysis.totalCommits}
          color="#8b5cf6"
        />
        <StatCard
          icon={Users}
          label="Contributors"
          value={analysis.contributors.length}
          color="#3b82f6"
        />
        <StatCard
          icon={AlertTriangle}
          label="Fix Ratio"
          value={`${analysis.fixRatio}%`}
          trend={analysis.fixRatio > 40 ? 'down' : analysis.fixRatio < 20 ? 'up' : 'neutral'}
          color={analysis.fixRatio > 40 ? '#ef4444' : '#22c55e'}
        />
        <StatCard
          icon={FileCode}
          label="API Endpoints"
          value={analysis.apiEndpoints.length}
          color="#f97316"
        />
      </div>

      {/* Tech Stack */}
      <CollapsibleSection title="Tech Stack" icon={Package}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '12px' }}>
          {analysis.techStack.map((item, i) => (
            <TechStackBadge key={i} item={item} />
          ))}
          {analysis.techStack.length === 0 && (
            <span style={{ color: '#71717a', fontSize: '14px' }}>No tech stack detected</span>
          )}
        </div>
      </CollapsibleSection>

      {/* Activity Chart */}
      <CollapsibleSection title="Monthly Activity" icon={Activity}>
        <ActivityChart data={analysis.monthlyActivity} />
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', fontSize: '12px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', background: '#8b5cf6', borderRadius: '2px' }} />
            Commits
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', background: '#ef4444', borderRadius: '2px' }} />
            Fixes
          </span>
        </div>
      </CollapsibleSection>

      {/* Top Contributors */}
      <CollapsibleSection title="Top Contributors" icon={Users}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px' }}>
          {analysis.contributors.slice(0, 5).map((contributor, i) => (
            <ContributorCard key={i} contributor={contributor} rank={i} />
          ))}
        </div>
      </CollapsibleSection>

      {/* Architecture Flows */}
      {analysis.flows && analysis.flows.length > 0 && (
        <CollapsibleSection title="Architecture Diagrams" icon={Folder}>
          <div style={{ paddingTop: '12px' }}>
            {/* Flow tabs */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {analysis.flows.map((flow, i) => (
                <button
                  key={i}
                  onClick={() => setActiveFlowIndex(i)}
                  style={{
                    padding: '8px 16px',
                    background: activeFlowIndex === i ? '#8b5cf6' : '#27272a',
                    border: '1px solid ' + (activeFlowIndex === i ? '#8b5cf6' : '#3f3f46'),
                    borderRadius: '6px',
                    color: '#fafafa',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  {flow.name}
                </button>
              ))}
            </div>

            {/* Active flow diagram */}
            <MermaidDiagram
              diagram={analysis.flows[activeFlowIndex].diagram}
              title={analysis.flows[activeFlowIndex].name}
              description={analysis.flows[activeFlowIndex].description}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Hot Files */}
      <CollapsibleSection title="Most Changed Files" icon={TrendingUp} defaultOpen={false}>
        <div style={{ paddingTop: '12px' }}>
          {analysis.topFiles.slice(0, 10).map((file, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: i < 9 ? '1px solid #3f3f46' : 'none',
              }}
            >
              <span style={{ fontSize: '13px', color: '#fafafa', fontFamily: 'monospace' }}>
                {file.file}
              </span>
              <span style={{
                fontSize: '12px',
                color: file.changes > 50 ? '#ef4444' : file.changes > 20 ? '#f97316' : '#a1a1aa',
              }}>
                {file.changes} changes
              </span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Footer */}
      <div style={{
        fontSize: '12px',
        color: '#71717a',
        textAlign: 'center',
        paddingTop: '16px',
      }}>
        Analyzed {new Date(analysis.analyzedAt).toLocaleString()} • {analysis.analysisDuration}ms
      </div>
    </div>
  );
}

export default CodebaseHealth;
