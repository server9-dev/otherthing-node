import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWeb3 } from '../context/Web3Context';
import { getSupabase } from '../lib/supabase';
import { CyberButton } from './CyberButton';

/** Must match linkMessage() in supabase/functions/chain-bridge and src/services/chain-bridge.ts. */
function linkMessage(userId: string, address: string, issuedAt: string): string {
  return `Link this wallet to your OtherThing account.\n\nAccount: ${userId}\nWallet: ${address.toLowerCase()}\nIssued: ${issuedAt}`;
}

/**
 * On-chain workspaces are bridged to the account through its linked wallet.
 * When the connected wallet isn't the linked one, ask for a one-time signature.
 */
export function WalletLinkBanner() {
  const { user } = useAuth();
  const { connected, address, signMessage } = useWeb3();
  const [linkedWallet, setLinkedWallet] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const sb = await getSupabase();
      const { data } = await sb.from('user_profiles').select('wallet_address').eq('user_id', user.id).maybeSingle();
      if (!cancelled) setLinkedWallet(data?.wallet_address ?? null);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  if (!user || !connected || !address || linkedWallet === undefined) return null;
  if (linkedWallet && linkedWallet.toLowerCase() === address.toLowerCase()) return null;

  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      const issuedAt = new Date().toISOString();
      const signature = await signMessage(linkMessage(user.id, address, issuedAt));
      const sb = await getSupabase();
      const { data, error: fnError } = await sb.functions.invoke('chain-bridge', {
        body: { action: 'link-wallet', address, issuedAt, signature },
      });
      if (fnError) {
        let message = fnError.message;
        try { message = (await (fnError as any).context.json()).error || message; } catch {}
        throw new Error(message);
      }
      setLinkedWallet(data.wallet);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cyber-card" style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      margin: '0.75rem 1rem 0', padding: '0.75rem 1rem',
    }}>
      <Link2 size={16} style={{ color: 'var(--primary)' }} />
      <span style={{ flex: 1, minWidth: 220, fontSize: '0.85rem' }}>
        {linkedWallet
          ? <>Your account is linked to a different wallet. Link <code>{address.slice(0, 6)}…{address.slice(-4)}</code> instead to use its workspaces.</>
          : <>Link wallet <code>{address.slice(0, 6)}…{address.slice(-4)}</code> to your account so its on-chain workspaces sync chat, tasks and shared models.</>}
        {error && <span style={{ display: 'block', color: 'var(--secondary, #ff00ff)', marginTop: 4 }}>{error}</span>}
      </span>
      <CyberButton variant="primary" onClick={link} disabled={busy}>
        {busy ? 'Waiting for signature…' : 'Link wallet'}
      </CyberButton>
    </div>
  );
}
