import { useState } from 'react';
import {
  Link2, Shield, Coins, Clock, Zap,
  AlertTriangle, Loader2, Plus, Minus,
  Award, Activity, Key, Copy, Check, Wallet
} from 'lucide-react';
import { useWeb3, OnChainNode } from '../context/Web3Context';
import { CyberButton } from './CyberButton';

interface NodeCapabilities {
  cpuCores: number;
  memoryMb: number;
  gpuCount: number;
  gpuVramMb: number;
  hasOllama: boolean;
  hasSandbox: boolean;
}

interface GpuInfo {
  vendor: string;
  model: string;
  vram_mb: number;
}

interface Props {
  localCapabilities?: NodeCapabilities;
  nodeEndpoint?: string;
  gpus?: GpuInfo[];
}

export function NodeBlockchain({ localCapabilities, nodeEndpoint, gpus }: Props) {
  const {
    connected,
    address,
    chainId,
    ottBalance,
    contractsReady,
    minStake,
    myNodes,
    loadingNodes,
    connectWallet,
    connectWithPrivateKey,
    createNewWallet,
    refreshNodes,
    refreshBalances,
    registerNode,
    claimRewards,
    addStake,
    withdrawStake,
    formatOtt,
    error,
    clearError,
    newWalletPrivateKey,
    showNewWalletModal,
    setShowNewWalletModal,
    isConnecting,
  } = useWeb3();

  const [registering, setRegistering] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState('100');
  const [hourlyRate, setHourlyRate] = useState('1.00');
  const [addStakeAmount, setAddStakeAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showStakeModal, setShowStakeModal] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPrivateKeyInput, setShowPrivateKeyInput] = useState(false);
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [funding, setFunding] = useState(false);
  const [funded, setFunded] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);

  const isWrongNetwork = connected && chainId !== 11155111 && chainId !== 31337;
  const hasEnoughOtt = ottBalance ? parseFloat(ottBalance) >= parseFloat(stakeAmount) : false;

  const handleRegister = async () => {
    if (!localCapabilities) {
      setActionError('No hardware capabilities detected. Please detect hardware first.');
      return;
    }

    setRegistering(true);
    setActionError(null);

    try {
      const endpointData = JSON.stringify({
        nodeId: nodeEndpoint || `node-${address?.slice(0, 8)}`,
        hourlyRate: parseFloat(hourlyRate),
        registeredAt: new Date().toISOString(),
      });
      await registerNode(localCapabilities, endpointData, stakeAmount);
    } catch (err: any) {
      setActionError(err.message || 'Failed to register node');
    } finally {
      setRegistering(false);
    }
  };

  const handleClaimRewards = async (nodeId: string) => {
    setClaiming(nodeId);
    setActionError(null);

    try {
      await claimRewards(nodeId);
    } catch (err: any) {
      setActionError(err.message || 'Failed to claim rewards');
    } finally {
      setClaiming(null);
    }
  };

  const handleAddStake = async (nodeId: string) => {
    if (!addStakeAmount || parseFloat(addStakeAmount) <= 0) return;

    setActionError(null);
    try {
      await addStake(nodeId, addStakeAmount);
      setAddStakeAmount('');
      setShowStakeModal(null);
    } catch (err: any) {
      setActionError(err.message || 'Failed to add stake');
    }
  };

  const handleWithdrawStake = async (nodeId: string) => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;

    setActionError(null);
    try {
      await withdrawStake(nodeId, withdrawAmount);
      setWithdrawAmount('');
      setShowStakeModal(null);
    } catch (err: any) {
      setActionError(err.message || 'Failed to withdraw stake');
    }
  };

  const formatReputation = (rep: bigint): string => {
    return (Number(rep) / 100).toFixed(2) + '%';
  };

  const formatComputeTime = (seconds: bigint): string => {
    const hrs = Number(seconds) / 3600;
    if (hrs < 1) return `${Number(seconds)} sec`;
    if (hrs < 24) return `${hrs.toFixed(1)} hrs`;
    return `${(hrs / 24).toFixed(1)} days`;
  };

  const handleCopyPrivateKey = () => {
    if (newWalletPrivateKey) {
      navigator.clipboard.writeText(newWalletPrivateKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFundWallet = async () => {
    if (!address) return;
    setFunding(true);
    setFundError(null);
    try {
      const res = await fetch('http://localhost:8080/api/v1/web3/fund-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fund wallet');
      }
      setFunded(true);
      // Refresh balances after funding
      await refreshBalances();
    } catch (err: any) {
      setFundError(err.message || 'Failed to fund wallet');
    } finally {
      setFunding(false);
    }
  };

  const handleConnectWithPrivateKey = async () => {
    if (!privateKeyInput) return;
    try {
      await connectWithPrivateKey(privateKeyInput);
      setPrivateKeyInput('');
      setShowPrivateKeyInput(false);
    } catch (err) {
      setActionError('Invalid private key');
    }
  };

  if (!connected) {
    return (
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">
            <Link2 size={14} style={{ marginRight: '0.5rem' }} />
            ON-CHAIN NODE REGISTRATION
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Optional</span>
        </div>
        <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-lg)' }}>
          <Shield size={36} style={{ color: 'var(--primary)', marginBottom: 'var(--gap-md)', opacity: 0.4 }} />
          <div style={{ marginBottom: 'var(--gap-md)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Connect a wallet to register on-chain and earn OTT tokens (optional).
          </div>

          <div style={{ display: 'flex', gap: 'var(--gap-sm)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <CyberButton
              icon={Wallet}
              onClick={createNewWallet}
              disabled={isConnecting}
              variant="primary"
            >
              {isConnecting ? 'Creating...' : 'Create Wallet'}
            </CyberButton>
            <CyberButton onClick={connectWallet} disabled={isConnecting}>
              WalletConnect
            </CyberButton>
            <CyberButton
              icon={Key}
              onClick={() => setShowPrivateKeyInput(!showPrivateKeyInput)}
            >
              Import Key
            </CyberButton>
          </div>

          {showPrivateKeyInput && (
            <div style={{ marginTop: 'var(--gap-md)', maxWidth: '400px', margin: 'var(--gap-md) auto 0' }}>
              <input
                type="password"
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value)}
                placeholder="Enter private key (0x...)"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  fontFamily: 'var(--font-mono)',
                  marginBottom: 'var(--gap-sm)',
                }}
              />
              <CyberButton
                onClick={handleConnectWithPrivateKey}
                disabled={!privateKeyInput}
                style={{ width: '100%' }}
              >
                Connect
              </CyberButton>
            </div>
          )}

          {actionError && (
            <div style={{ marginTop: 'var(--gap-md)', color: 'var(--error)', fontSize: '0.85rem' }}>
              {actionError}
            </div>
          )}

          <p style={{ marginTop: 'var(--gap-md)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Your node works fine without blockchain registration.
          </p>
        </div>

        {/* New Wallet Modal */}
        {showNewWalletModal && newWalletPrivateKey && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--primary)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--gap-xl)',
              maxWidth: '500px',
              width: '90%',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--gap-sm)',
                marginBottom: 'var(--gap-lg)',
              }}>
                <Wallet size={24} style={{ color: 'var(--primary)' }} />
                <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
                  New Wallet Created!
                </h3>
              </div>

              <div style={{
                padding: 'var(--gap-md)',
                background: 'rgba(255, 200, 0, 0.1)',
                border: '1px solid var(--warning)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 'var(--gap-lg)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', marginBottom: 'var(--gap-sm)' }}>
                  <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
                  <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Important!</span>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                  Save your private key now! It won't be shown again. Anyone with this key has full control of your wallet.
                </p>
              </div>

              <div style={{ marginBottom: 'var(--gap-md)' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Your Address
                </label>
                <div style={{
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  color: 'var(--primary)',
                  wordBreak: 'break-all',
                }}>
                  {address}
                </div>
              </div>

              <div style={{ marginBottom: 'var(--gap-lg)' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Private Key (SAVE THIS!)
                </label>
                <div style={{
                  display: 'flex',
                  gap: 'var(--gap-sm)',
                }}>
                  <div style={{
                    flex: 1,
                    padding: '10px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--warning)',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    color: 'var(--warning)',
                    wordBreak: 'break-all',
                  }}>
                    {newWalletPrivateKey}
                  </div>
                  <CyberButton
                    icon={copied ? Check : Copy}
                    onClick={handleCopyPrivateKey}
                    variant={copied ? 'success' : undefined}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </CyberButton>
                </div>
              </div>

              <div style={{
                  padding: 'var(--gap-md)',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--gap-lg)',
                }}>
                  {funded ? (
                    <div style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)', fontSize: '0.9rem' }}>
                      <Check size={18} />
                      Wallet funded with 0.01 ETH + 500 OTT!
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: '0 0 var(--gap-sm) 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Your wallet needs ETH (gas) and OTT (staking) to register a node.
                      </p>
                      <CyberButton
                        icon={funding ? Activity : Coins}
                        onClick={handleFundWallet}
                        disabled={funding}
                        variant="success"
                        style={{ width: '100%', marginBottom: 'var(--gap-sm)' }}
                      >
                        {funding ? 'Funding...' : 'Fund Wallet (0.01 ETH + 500 OTT)'}
                      </CyberButton>
                      {fundError && (
                        <p style={{ margin: 'var(--gap-sm) 0 0 0', color: 'var(--error)', fontSize: '0.8rem' }}>
                          {fundError}
                        </p>
                      )}
                      <p style={{ margin: 'var(--gap-sm) 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Or get ETH manually from{' '}
                        <a
                          href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--primary)' }}
                        >
                          Sepolia Faucet
                        </a>
                      </p>
                    </>
                  )}
                </div>

              
              <CyberButton
                onClick={() => setShowNewWalletModal(false)}
                variant="primary"
                style={{ width: '100%' }}
              >
                I've Saved My Key - Continue
              </CyberButton>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isWrongNetwork) {
    return (
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)', borderColor: 'var(--warning)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">
            <AlertTriangle size={14} style={{ marginRight: '0.5rem', color: 'var(--warning)' }} />
            WRONG NETWORK
          </span>
        </div>
        <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
          <div style={{ marginBottom: 'var(--gap-md)', color: 'var(--warning)' }}>
            Please switch to Sepolia testnet to register your node.
          </div>
        </div>
      </div>
    );
  }

  if (!contractsReady) {
    return (
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">
            <Link2 size={14} style={{ marginRight: '0.5rem' }} />
            ON-CHAIN NODE REGISTRATION
          </span>
        </div>
        <div className="cyber-card-body" style={{ textAlign: 'center', padding: 'var(--gap-xl)' }}>
          <AlertTriangle size={48} style={{ color: 'var(--warning)', marginBottom: 'var(--gap-md)', opacity: 0.5 }} />
          <div style={{ marginBottom: 'var(--gap-sm)', color: 'var(--text-secondary)' }}>
            Smart contracts not deployed yet.
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Deploy contracts to Sepolia and update the addresses to enable on-chain registration.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
      <div className="cyber-card-header">
        <span className="cyber-card-title">
          <Link2 size={14} style={{ marginRight: '0.5rem' }} />
          ON-CHAIN NODE REGISTRATION
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Balance: <span style={{ color: 'var(--primary)' }}>{ottBalance || '0'} OTT</span>
          </span>
          <CyberButton icon={Activity} onClick={refreshNodes} disabled={loadingNodes}>
            {loadingNodes ? 'Loading...' : 'Refresh'}
          </CyberButton>
        </div>
      </div>
      <div className="cyber-card-body">
        {(error || actionError) && (
          <div style={{
            padding: 'var(--gap-md)',
            background: 'rgba(255, 100, 100, 0.1)',
            border: '1px solid var(--error)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--gap-md)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>
              {error || actionError}
            </span>
            <button
              onClick={() => { clearError(); setActionError(null); }}
              style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer' }}
            >
              &times;
            </button>
          </div>
        )}

        {myNodes.length > 0 && (
          <div style={{ marginBottom: 'var(--gap-lg)' }}>
            <div style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: 'var(--gap-md)',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-sans)',
            }}>
              Your Registered Nodes ({myNodes.length})
            </div>

            {myNodes.map((node) => (
              <div
                key={node.nodeId}
                style={{
                  padding: 'var(--gap-md)',
                  background: node.isActive
                    ? 'linear-gradient(135deg, rgba(0, 212, 255, 0.08), rgba(155, 89, 182, 0.03))'
                    : 'var(--bg-elevated)',
                  border: `1px solid ${node.isActive ? 'var(--primary)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--gap-md)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--gap-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: node.isActive ? 'var(--primary)' : 'var(--text-muted)',
                      boxShadow: node.isActive ? '0 0 8px var(--primary)' : 'none',
                    }} />
                    <code style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                      {node.nodeId.slice(0, 16)}...
                    </code>
                    {node.isSlashed && (
                      <span style={{
                        padding: '2px 6px',
                        background: 'rgba(255, 100, 100, 0.2)',
                        color: 'var(--error)',
                        fontSize: '0.65rem',
                        borderRadius: '4px',
                      }}>
                        SLASHED
                      </span>
                    )}
                  </div>
                  <span style={{
                    padding: '2px 8px',
                    background: node.isActive ? 'rgba(0, 212, 255, 0.2)' : 'rgba(100, 100, 100, 0.2)',
                    color: node.isActive ? 'var(--primary)' : 'var(--text-muted)',
                    fontSize: '0.7rem',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                  }}>
                    {node.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 'var(--gap-md)',
                  marginBottom: 'var(--gap-md)',
                }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      <Coins size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Staked
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>
                      {formatOtt(node.stakedAmount)} OTT
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      <Zap size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Pending Rewards
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>
                      {formatOtt(node.pendingRewards)} OTT
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      <Award size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Reputation
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary-light)' }}>
                      {formatReputation(node.reputation)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      <Clock size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      Compute Time
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {formatComputeTime(node.totalComputeSeconds)}
                    </div>
                  </div>
                </div>

                <div style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--gap-md)',
                }}>
                  Total Earned: <span style={{ color: 'var(--primary)' }}>{formatOtt(node.totalEarned)} OTT</span>
                </div>

                <div style={{ display: 'flex', gap: 'var(--gap-sm)', flexWrap: 'wrap' }}>
                  {node.pendingRewards > 0n && (
                    <CyberButton
                      variant="success"
                      icon={claiming === node.nodeId ? Loader2 : Coins}
                      onClick={() => handleClaimRewards(node.nodeId)}
                      disabled={claiming === node.nodeId}
                    >
                      {claiming === node.nodeId ? 'Claiming...' : 'Claim Rewards'}
                    </CyberButton>
                  )}
                  <CyberButton
                    icon={Plus}
                    onClick={() => setShowStakeModal(node.nodeId)}
                  >
                    Manage Stake
                  </CyberButton>
                </div>

                {showStakeModal === node.nodeId && (
                  <div style={{
                    marginTop: 'var(--gap-md)',
                    padding: 'var(--gap-md)',
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{ display: 'flex', gap: 'var(--gap-md)', marginBottom: 'var(--gap-md)' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                          Add Stake (OTT)
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="number"
                            value={addStakeAmount}
                            onChange={(e) => setAddStakeAmount(e.target.value)}
                            placeholder="0"
                            style={{
                              flex: 1,
                              padding: '8px',
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-primary)',
                              fontSize: '0.9rem',
                            }}
                          />
                          <CyberButton icon={Plus} onClick={() => handleAddStake(node.nodeId)} disabled={!addStakeAmount}>
                            Add
                          </CyberButton>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                          Withdraw Stake (OTT)
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="number"
                            value={withdrawAmount}
                            onChange={(e) => setWithdrawAmount(e.target.value)}
                            placeholder="0"
                            style={{
                              flex: 1,
                              padding: '8px',
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-primary)',
                              fontSize: '0.9rem',
                            }}
                          />
                          <CyberButton icon={Minus} onClick={() => handleWithdrawStake(node.nodeId)} disabled={!withdrawAmount}>
                            Withdraw
                          </CyberButton>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowStakeModal(null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                      }}
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{
          padding: 'var(--gap-lg)',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(129, 140, 248, 0.02))',
          border: '1px dashed var(--primary)',
          borderRadius: 'var(--radius-md)',
        }}>
          <div style={{
            fontSize: '1rem',
            fontFamily: 'var(--font-sans)',
            color: 'var(--text-primary)',
            marginBottom: 'var(--gap-sm)',
          }}>
            Register New Node On-Chain
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }}>
            Stake OTT tokens to register your node. You'll earn rewards for providing compute.
            Minimum stake: <span style={{ color: 'var(--primary)' }}>{minStake || '100'} OTT</span>
          </div>

          {localCapabilities && (
            <div style={{
              padding: 'var(--gap-md)',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 'var(--gap-md)',
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                Hardware to Register
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--gap-sm)', fontSize: '0.85rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>CPU: </span>
                  <span style={{ color: 'var(--primary)' }}>{localCapabilities.cpuCores} cores</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>RAM: </span>
                  <span style={{ color: 'var(--primary)' }}>{Math.round(localCapabilities.memoryMb / 1024)} GB</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Features: </span>
                  <span style={{ color: 'var(--primary)' }}>
                    {localCapabilities.hasOllama && 'Ollama '}
                    {localCapabilities.hasSandbox && 'Sandbox'}
                  </span>
                </div>
              </div>
              {gpus && gpus.length > 0 && (
                <div style={{ marginTop: 'var(--gap-sm)', paddingTop: 'var(--gap-sm)', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>GPUs:</div>
                  {gpus.map((gpu, i) => (
                    <div key={i} style={{ fontSize: '0.85rem', color: 'var(--primary)', marginLeft: '8px' }}>
                      {gpu.model} ({Math.round(gpu.vram_mb / 1024)} GB VRAM)
                    </div>
                  ))}
                </div>
              )}
              {(!gpus || gpus.length === 0) && localCapabilities.gpuCount > 0 && (
                <div style={{ marginTop: 'var(--gap-sm)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>GPU: </span>
                  <span style={{ color: 'var(--primary)' }}>
                    {localCapabilities.gpuCount} GPU ({Math.round(localCapabilities.gpuVramMb / 1024)} GB VRAM total)
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gap-md)', marginBottom: 'var(--gap-md)' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Stake Amount (OTT)
              </label>
              <input
                type="number"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                min={minStake || '100'}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Hourly Rate (OTT/hour)
              </label>
              <input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                min="0.01"
                step="0.1"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 'var(--gap-md)' }}>
            <CyberButton
              variant="primary"
              icon={registering ? Loader2 : Shield}
              onClick={handleRegister}
              disabled={registering || !localCapabilities || !hasEnoughOtt}
              style={{ width: '100%' }}
            >
              {registering ? 'Registering...' : `Register Node @ ${hourlyRate} OTT/hour`}
            </CyberButton>
          </div>

          {!hasEnoughOtt && (
            <div style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>
              <AlertTriangle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
              Insufficient OTT balance. You need at least {stakeAmount} OTT.
            </div>
          )}

          {!localCapabilities && (
            <div style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>
              <AlertTriangle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
              Please detect hardware first before registering.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
