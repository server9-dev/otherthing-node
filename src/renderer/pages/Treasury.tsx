import { useState, useEffect } from 'react';
import { Coins, ArrowDownToLine, ArrowUpFromLine, RefreshCw, TrendingUp, Landmark, CircleDollarSign, Percent } from 'lucide-react';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';

const PACKS = [
  { name: 'Starter', amount: 100, color: '#3B82F6' },
  { name: 'Builder', amount: 500, color: '#8B5CF6' },
  { name: 'Team', amount: 1000, color: '#F59E0B' },
  { name: 'Enterprise', amount: 5000, color: '#10B981' },
];

export function Treasury() {
  const {
    connected,
    ottBalance,
    usdcBalance,
    backingPerOTT,
    treasuryContract,
    buyOTT,
    redeemOTT,
    refreshTreasuryInfo,
    refreshBalances,
    formatOtt,
  } = useWeb3();

  const [activeTab, setActiveTab] = useState<'buy' | 'redeem'>('buy');
  const [customBuyAmount, setCustomBuyAmount] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemPreview, setRedeemPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Treasury stats
  const [stats, setStats] = useState<{
    treasuryBalance: string;
    circulatingSupply: string;
    feeBps: number;
  } | null>(null);

  // Fetch treasury stats
  useEffect(() => {
    if (!treasuryContract) return;

    const fetchStats = async () => {
      try {
        const [circulating, feeBps] = await Promise.all([
          treasuryContract.circulatingTreasuryOTT(),
          treasuryContract.redemptionFeeBps(),
        ]);

        // Fetch USDC balance from API for simplicity
        const res = await fetch('http://localhost:8080/api/v1/treasury/info');
        const data = await res.json();

        setStats({
          treasuryBalance: data.treasuryUsdcBalance || '0',
          circulatingSupply: ethers.formatEther(circulating),
          feeBps: Number(feeBps),
        });
      } catch (err) {
        console.error('Failed to fetch treasury stats:', err);
      }
    };

    fetchStats();
  }, [treasuryContract, success]);

  // Preview redeem amount
  useEffect(() => {
    if (!treasuryContract || !redeemAmount || parseFloat(redeemAmount) <= 0) {
      setRedeemPreview(null);
      return;
    }

    const preview = async () => {
      try {
        const ottWei = ethers.parseEther(redeemAmount);
        const result = await treasuryContract.getRedeemAmount(ottWei);
        setRedeemPreview(ethers.formatUnits(result, 6));
      } catch {
        setRedeemPreview(null);
      }
    };

    const timer = setTimeout(preview, 300);
    return () => clearTimeout(timer);
  }, [redeemAmount, treasuryContract]);

  const handleBuy = async (usdcAmount: number) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await buyOTT(usdcAmount.toString());
      setSuccess(`Bought ${usdcAmount} OTT for ${usdcAmount} USDC`);
      setCustomBuyAmount('');
    } catch (err: any) {
      setError(err.reason || err.message || 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async () => {
    if (!redeemAmount || parseFloat(redeemAmount) <= 0) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await redeemOTT(redeemAmount);
      setSuccess(`Redeemed ${redeemAmount} OTT for ~${redeemPreview} USDC`);
      setRedeemAmount('');
    } catch (err: any) {
      setError(err.reason || err.message || 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Coins size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
        <h2 style={{ marginBottom: '8px' }}>OTT Treasury</h2>
        <p style={{ color: 'var(--text-muted)' }}>Connect your wallet to buy or redeem OTT</p>
      </div>
    );
  }

  const backingDisplay = backingPerOTT ? parseFloat(backingPerOTT).toFixed(4) : '0.00';
  const feePercent = stats ? (stats.feeBps / 100).toFixed(1) : '5.0';

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Coins size={28} style={{ color: 'var(--primary)' }} />
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>OTT Treasury</h1>
        </div>
        <button
          onClick={() => { refreshTreasuryInfo(); refreshBalances(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem',
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { icon: <Landmark size={20} />, label: 'Treasury USDC', value: `$${stats?.treasuryBalance || '0'}` },
          { icon: <CircleDollarSign size={20} />, label: 'Backing / OTT', value: `$${backingDisplay}` },
          { icon: <TrendingUp size={20} />, label: 'Circulating Supply', value: `${parseFloat(stats?.circulatingSupply || '0').toLocaleString()} OTT` },
          { icon: <Percent size={20} />, label: 'Redemption Fee', value: `${feePercent}%` },
        ].map((card, i) => (
          <div key={i} style={{
            padding: '16px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-muted)' }}>
              {card.icon}
              <span style={{ fontSize: '0.8rem' }}>{card.label}</span>
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Balance bar */}
      <div style={{
        display: 'flex', gap: '24px', padding: '16px',
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)', marginBottom: '24px',
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>USDC Balance</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{usdcBalance ? parseFloat(usdcBalance).toLocaleString() : '0'} USDC</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>OTT Balance</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)' }}>{ottBalance ? parseFloat(ottBalance).toLocaleString() : '0'} OTT</div>
        </div>
      </div>

      {/* Tab selector */}
      <div style={{ display: 'flex', marginBottom: '24px', borderBottom: '1px solid var(--border-subtle)' }}>
        {(['buy', 'redeem'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setError(null); setSuccess(null); }}
            style={{
              padding: '12px 24px', border: 'none', cursor: 'pointer',
              fontSize: '0.95rem', fontWeight: 500,
              background: 'none',
              color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
            }}
          >
            {tab === 'buy' ? <><ArrowDownToLine size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />Buy OTT</> : <><ArrowUpFromLine size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />Redeem OTT</>}
          </button>
        ))}
      </div>

      {/* Feedback messages */}
      {success && (
        <div style={{
          padding: '12px 16px', background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid #10B981', borderRadius: 'var(--radius-sm)',
          color: '#10B981', marginBottom: '16px', fontSize: '0.9rem',
        }}>
          {success}
        </div>
      )}
      {error && (
        <div style={{
          padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--error)', borderRadius: 'var(--radius-sm)',
          color: 'var(--error)', marginBottom: '16px', fontSize: '0.9rem',
        }}>
          {error}
        </div>
      )}

      {/* Buy Tab */}
      {activeTab === 'buy' && (
        <div>
          <h3 style={{ marginBottom: '16px', fontSize: '1rem', color: 'var(--text-secondary)' }}>
            Buy OTT at $1.00 each with USDC
          </h3>

          {/* Pack cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            {PACKS.map(pack => (
              <button
                key={pack.name}
                onClick={() => handleBuy(pack.amount)}
                disabled={loading}
                style={{
                  padding: '20px 16px', background: 'var(--bg-elevated)',
                  border: `1px solid ${pack.color}33`, borderRadius: 'var(--radius-md)',
                  cursor: loading ? 'wait' : 'pointer', textAlign: 'center',
                  transition: 'all 0.2s',
                }}
                onMouseOver={e => { if (!loading) e.currentTarget.style.borderColor = pack.color; }}
                onMouseOut={e => e.currentTarget.style.borderColor = `${pack.color}33`}
              >
                <div style={{ fontSize: '0.8rem', color: pack.color, fontWeight: 600, marginBottom: '4px' }}>
                  {pack.name}
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {pack.amount.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {pack.amount.toLocaleString()} USDC
                </div>
              </button>
            ))}
          </div>

          {/* Custom amount */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="number"
              value={customBuyAmount}
              onChange={e => setCustomBuyAmount(e.target.value)}
              placeholder="Custom USDC amount"
              style={{
                flex: 1, padding: '12px', background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)', fontSize: '0.95rem',
              }}
            />
            <button
              onClick={() => customBuyAmount && handleBuy(parseFloat(customBuyAmount))}
              disabled={loading || !customBuyAmount || parseFloat(customBuyAmount) <= 0}
              style={{
                padding: '12px 24px',
                background: loading ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                color: 'white', cursor: loading ? 'wait' : 'pointer',
                fontSize: '0.95rem', fontWeight: 500,
                opacity: (!customBuyAmount || parseFloat(customBuyAmount) <= 0) ? 0.5 : 1,
              }}
            >
              {loading ? 'Processing...' : 'Buy OTT'}
            </button>
          </div>
        </div>
      )}

      {/* Redeem Tab */}
      {activeTab === 'redeem' && (
        <div>
          <h3 style={{ marginBottom: '16px', fontSize: '1rem', color: 'var(--text-secondary)' }}>
            Redeem OTT for USDC at floor price
          </h3>

          <div style={{ marginBottom: '16px' }}>
            <input
              type="number"
              value={redeemAmount}
              onChange={e => setRedeemAmount(e.target.value)}
              placeholder="OTT amount to redeem"
              style={{
                width: '100%', padding: '14px', background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)', fontSize: '1rem',
              }}
            />
          </div>

          {/* Preview */}
          {redeemAmount && parseFloat(redeemAmount) > 0 && (
            <div style={{
              padding: '16px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
              marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Floor Price</span>
                <span style={{ fontSize: '0.85rem' }}>${backingDisplay} / OTT</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Gross USDC</span>
                <span style={{ fontSize: '0.85rem' }}>
                  ${(parseFloat(redeemAmount) * parseFloat(backingDisplay)).toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Fee ({feePercent}%)</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--error)' }}>
                  -${(parseFloat(redeemAmount) * parseFloat(backingDisplay) * (stats?.feeBps || 500) / 10000).toFixed(2)}
                </span>
              </div>
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>You Receive</span>
                <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--primary)' }}>
                  {redeemPreview ? `$${parseFloat(redeemPreview).toFixed(2)}` : '...'} USDC
                </span>
              </div>
            </div>
          )}

          <button
            onClick={handleRedeem}
            disabled={loading || !redeemAmount || parseFloat(redeemAmount) <= 0}
            style={{
              width: '100%', padding: '14px',
              background: loading ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
              border: 'none', borderRadius: 'var(--radius-sm)',
              color: 'white', cursor: loading ? 'wait' : 'pointer',
              fontSize: '1rem', fontWeight: 500,
              opacity: (!redeemAmount || parseFloat(redeemAmount) <= 0) ? 0.5 : 1,
            }}
          >
            {loading ? 'Processing...' : 'Redeem OTT'}
          </button>
        </div>
      )}
    </div>
  );
}
