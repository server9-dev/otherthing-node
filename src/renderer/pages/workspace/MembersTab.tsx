import { useState } from 'react';
import { Copy, Check, Shield, Crown, User, RefreshCw } from 'lucide-react';
import { CyberButton } from '../../components';
import type { OnChainWorkspace } from '../../context/Web3Context';

interface Props {
  workspace: OnChainWorkspace;
  workspaceId: string;
  members: string[];
  isOwner: boolean;
  address: string | null;
}

export function MembersTab({ workspace, workspaceId, members, isOwner, address }: Props) {
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Get invite code from localStorage
  const stored = localStorage.getItem('workspace-invite-codes');
  let inviteCode: string | null = null;
  if (stored && workspaceId) {
    try { inviteCode = JSON.parse(stored)[workspaceId] || null; } catch {}
  }

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 2000);
  };

  const copyInviteCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(`${workspaceId}:${inviteCode}`);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 700, margin: '0 auto' }}>
      {/* Invite Section */}
      {isOwner && (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)', padding: '1.25rem', marginBottom: '1.5rem',
        }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={16} style={{ color: 'var(--primary)' }} /> Invite Members
          </h3>

          {workspace.isPublic ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              This is a public workspace. Anyone can join by browsing public workspaces.
            </p>
          ) : inviteCode ? (
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                Share this invite code with people you want to join:
              </p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
                padding: '0.6rem 0.75rem', border: '1px solid var(--border-subtle)',
              }}>
                <code style={{
                  flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                  color: 'var(--primary)', overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {workspaceId.slice(0, 10)}...:{inviteCode}
                </code>
                <button onClick={copyInviteCode} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: copiedInvite ? 'var(--primary)' : 'var(--text-muted)',
                  padding: '4px', flexShrink: 0,
                }}>
                  {copiedInvite ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              No invite code stored locally. You can set one from the workspace settings.
            </p>
          )}
        </div>
      )}

      {/* Members List */}
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Members ({members.length})
          </h3>
        </div>

        {members.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No members loaded
          </div>
        ) : (
          members.map((addr, i) => {
            const isOwnerAddr = addr.toLowerCase() === workspace.owner.toLowerCase();
            const isYou = address && addr.toLowerCase() === address.toLowerCase();

            return (
              <div key={addr} style={{
                display: 'flex', alignItems: 'center', padding: '0.75rem 1rem',
                borderBottom: i < members.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                background: isYou ? 'rgba(0,212,255,0.03)' : 'transparent',
              }}>
                {/* Avatar placeholder */}
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', marginRight: '0.75rem',
                  background: isOwnerAddr ? 'rgba(0,212,255,0.15)' : 'var(--bg-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${isOwnerAddr ? 'rgba(0,212,255,0.3)' : 'var(--border-subtle)'}`,
                  flexShrink: 0,
                }}>
                  {isOwnerAddr ? <Crown size={14} style={{ color: 'var(--primary)' }} /> : <User size={14} style={{ color: 'var(--text-muted)' }} />}
                </div>

                {/* Address */}
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                  }}>
                    {addr.slice(0, 6)}...{addr.slice(-4)}
                    {isYou && <span style={{ color: 'var(--primary)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>(you)</span>}
                  </div>
                </div>

                {/* Role */}
                <span style={{
                  fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10,
                  background: isOwnerAddr ? 'rgba(0,212,255,0.1)' : 'var(--bg-tertiary)',
                  color: isOwnerAddr ? 'var(--primary)' : 'var(--text-muted)',
                  fontWeight: 600, textTransform: 'uppercase', marginRight: '0.5rem',
                }}>
                  {isOwnerAddr ? 'Owner' : 'Member'}
                </span>

                {/* Copy button */}
                <button onClick={() => copyAddress(addr)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: copiedAddr === addr ? 'var(--primary)' : 'var(--text-muted)',
                  padding: '4px',
                }}>
                  {copiedAddr === addr ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
