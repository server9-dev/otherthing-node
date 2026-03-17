import { useState, useEffect } from 'react';
import { Check, X, Cpu, Cloud, Zap, ArrowLeft, Shield, Bot, FileText, Activity, Scale, MessageSquare } from 'lucide-react';
import { CyberButton } from '../components';
import { useWeb3 } from '../context/Web3Context';

const API_BASE = 'http://localhost:8080/api/v1';

interface PlanFeature {
  name: string;
  icon: React.ElementType;
  free: boolean;
  selfHosted: boolean;
  premium: boolean;
  description: string;
}

const FEATURES: PlanFeature[] = [
  { name: 'Workspaces & Members', icon: MessageSquare, free: true, selfHosted: true, premium: true, description: 'Create workspaces, invite members, manage roles' },
  { name: 'Team Chat', icon: MessageSquare, free: true, selfHosted: true, premium: true, description: 'Real-time team messaging with history' },
  { name: 'Task Board', icon: Check, free: true, selfHosted: true, premium: true, description: 'Kanban board with drag-and-drop, priorities, assignments' },
  { name: 'Escrow & Milestones', icon: Shield, free: true, selfHosted: true, premium: true, description: 'On-chain milestone payments with OTT token' },
  { name: 'IPFS File Storage', icon: Check, free: true, selfHosted: true, premium: true, description: 'Decentralized file storage and sharing' },
  { name: 'Whiteboard', icon: Check, free: true, selfHosted: true, premium: true, description: 'Collaborative drawing and diagramming' },
  { name: 'Voice & Video Calls', icon: Check, free: true, selfHosted: true, premium: true, description: 'WebRTC peer-to-peer calls with screen share' },
  { name: 'Visual Workflows', icon: Check, free: true, selfHosted: true, premium: true, description: 'Drag-and-drop automation pipeline editor' },
  { name: 'Code Editor', icon: Check, free: true, selfHosted: true, premium: true, description: 'code-server IDE embedded in workspace' },
  { name: 'Content Safety', icon: Shield, free: true, selfHosted: true, premium: true, description: 'Keyword-based content moderation (always on)' },
  { name: 'AI Chat', icon: Bot, free: false, selfHosted: true, premium: true, description: 'Chat with AI about your workspace and code' },
  { name: 'AI Digest', icon: FileText, free: false, selfHosted: true, premium: true, description: 'Automated sprint summaries with decisions and suggested tasks' },
  { name: 'Health Reports', icon: Activity, free: false, selfHosted: true, premium: true, description: 'Team participation metrics and per-individual recommendations' },
  { name: 'Handoff Documents', icon: FileText, free: false, selfHosted: true, premium: true, description: 'Living project context document, auto-updated' },
  { name: 'Dispute Analysis', icon: Scale, free: false, selfHosted: true, premium: true, description: 'AI-powered milestone dispute recommendations' },
  { name: 'AI Safety Scanning', icon: Shield, free: false, selfHosted: true, premium: true, description: 'LLM-powered content moderation for images and files' },
  { name: 'Voice Transcription', icon: Bot, free: false, selfHosted: true, premium: true, description: 'Live transcription with speaker attribution' },
];

export function PlansPage() {
  const { address } = useWeb3();
  const [premiumStatus, setPremiumStatus] = useState<any>(null);
  const [ollamaStatus, setOllamaStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (address) {
      fetch(`${API_BASE}/premium/status?wallet=${address}`, { headers: { Authorization: 'Bearer local-token' } })
        .then(r => r.json()).then(setPremiumStatus).catch(() => {});
    }
    fetch(`${API_BASE}/ollama/status`)
      .then(r => r.json()).then(setOllamaStatus).catch(() => {});
  }, [address]);

  const hasLocalAI = ollamaStatus?.running && ollamaStatus?.models?.length > 0;
  const isPremium = premiumStatus?.active;

  const currentPlan = isPremium ? 'premium' : hasLocalAI ? 'self-hosted' : 'free';

  const activatePremium = async () => {
    if (!address) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/premium/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ wallet: address, days: 30 }),
      });
      const res = await fetch(`${API_BASE}/premium/status?wallet=${address}`, { headers: { Authorization: 'Bearer local-token' } });
      setPremiumStatus(await res.json());
    } catch {} finally { setLoading(false); }
  };

  const planStyle = (plan: string, isCurrent: boolean): React.CSSProperties => ({
    flex: 1, minWidth: 220, maxWidth: 320,
    background: isCurrent ? 'rgba(0,212,255,0.05)' : 'var(--bg-secondary)',
    border: isCurrent ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg, 12px)',
    padding: '1.5rem',
    display: 'flex', flexDirection: 'column',
    position: 'relative',
  });

  return (
    <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      <button
        onClick={() => window.history.back()}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '1.5rem', fontSize: '0.85rem' }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Plans</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        Everything works without AI. Add your own GPU or let us handle it.
      </p>

      {/* Plan cards */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {/* Free */}
        <div style={planStyle('free', currentPlan === 'free')}>
          {currentPlan === 'free' && <CurrentBadge />}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Zap size={20} color="var(--text-muted)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Free</h2>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>$0</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>No AI features</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem', flex: 1 }}>
            Full workspace platform — chat, tasks, escrow, files, whiteboard, voice/video, workflows, code editor. Everything except AI.
          </p>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm, 4px)' }}>
            No hardware requirements
          </div>
        </div>

        {/* Self-hosted */}
        <div style={planStyle('self-hosted', currentPlan === 'self-hosted')}>
          {currentPlan === 'self-hosted' && <CurrentBadge />}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Cpu size={20} color="var(--primary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Self-Hosted</h2>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>$0</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Run AI on your hardware</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem', flex: 1 }}>
            Everything in Free plus all AI features — digest, health reports, AI chat, dispute analysis, transcription. You provide the GPU.
          </p>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm, 4px)' }}>
            Requires: Ollama + 4GB+ VRAM GPU
          </div>
          {currentPlan === 'free' && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--primary)' }}>
              Install Ollama and pull a model to unlock
            </div>
          )}
        </div>

        {/* Premium */}
        <div style={planStyle('premium', currentPlan === 'premium')}>
          {currentPlan === 'premium' && <CurrentBadge />}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Cloud size={20} color="#00FF88" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Premium</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>20</span>
            <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>OTT/mo</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>No hardware or setup needed</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem', flex: 1 }}>
            Everything in Self-Hosted but we run the AI for you. No GPU required, no Ollama setup. Just works.
          </p>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm, 4px)', marginBottom: '0.75rem' }}>
            No hardware requirements
          </div>
          {!isPremium ? (
            <CyberButton variant="primary" onClick={activatePremium} loading={loading} style={{ width: '100%' }}>
              {address ? 'Upgrade to Premium' : 'Connect Wallet First'}
            </CyberButton>
          ) : (
            <div style={{ fontSize: '0.8rem', color: '#00FF88', textAlign: 'center' }}>
              Active until {new Date(premiumStatus.expiresAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      {/* Feature comparison table */}
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg, 12px)',
        border: '1px solid var(--border-subtle)', overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 80px 100px 80px',
          padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-tertiary)',
        }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Feature</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>Free</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary)', textAlign: 'center' }}>Self-Hosted</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#00FF88', textAlign: 'center' }}>Premium</span>
        </div>
        {FEATURES.map((f, i) => {
          const Icon = f.icon;
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 100px 80px',
              padding: '0.6rem 1rem', alignItems: 'center',
              borderBottom: i < FEATURES.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{f.name}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{f.description}</div>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {f.free ? <Check size={16} color="var(--primary)" /> : <X size={16} color="var(--text-muted)" style={{ opacity: 0.3 }} />}
              </div>
              <div style={{ textAlign: 'center' }}>
                {f.selfHosted ? <Check size={16} color="var(--primary)" /> : <X size={16} color="var(--text-muted)" style={{ opacity: 0.3 }} />}
              </div>
              <div style={{ textAlign: 'center' }}>
                {f.premium ? <Check size={16} color="#00FF88" /> : <X size={16} color="var(--text-muted)" style={{ opacity: 0.3 }} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CurrentBadge() {
  return (
    <div style={{
      position: 'absolute', top: -1, right: 16,
      background: 'var(--primary)', color: 'var(--bg-primary)',
      fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px',
      borderRadius: '0 0 6px 6px', textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      Current
    </div>
  );
}
