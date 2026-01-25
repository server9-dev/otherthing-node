import { useState } from 'react';
import { Wallet, LogOut, ExternalLink, Copy, Check, AlertCircle, Loader, X, Smartphone, Key, QrCode } from 'lucide-react';
import { useWeb3 } from '../context/Web3Context';
import { QRCodeSVG } from 'qrcode.react';

const NETWORKS: Record<number, { name: string; explorer: string }> = {
  11155111: { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io' },
  31337: { name: 'Localhost', explorer: '' },
  1: { name: 'Ethereum', explorer: 'https://etherscan.io' },
};

type ConnectionMethod = 'choose' | 'walletconnect' | 'manual';

export function WalletButton() {
  const {
    connected,
    address,
    chainId,
    balance,
    ottBalance,
    disconnectWallet,
    isConnecting,
    connectWallet,
    connectWithPrivateKey,
    wcUri,
    showQRModal,
    setShowQRModal,
    error,
  } = useWeb3();
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>('choose');
  const [privateKey, setPrivateKey] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const handleConnect = () => {
    setConnectionMethod('choose');
    setShowQRModal(true);
  };

  const handleWalletConnect = () => {
    setConnectionMethod('walletconnect');
    connectWallet();
  };

  const handleManualConnect = async () => {
    if (!privateKey.trim()) {
      setManualError('Please enter a private key');
      return;
    }
    setManualError(null);
    try {
      await connectWithPrivateKey(privateKey.trim());
      setShowQRModal(false);
      setPrivateKey('');
    } catch (err) {
      setManualError(String(err));
    }
  };

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyWcUri = () => {
    if (wcUri) {
      navigator.clipboard.writeText(wcUri);
    }
  };

  const formatAddress = (addr: string): string => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const closeModal = () => {
    setShowQRModal(false);
    setConnectionMethod('choose');
    setPrivateKey('');
    setManualError(null);
  };

  const network = chainId ? NETWORKS[chainId] : null;
  const isWrongNetwork = connected && chainId !== 11155111 && chainId !== 31337;

  // Connection Modal
  if (showQRModal) {
    return (
      <>
        <button
          disabled={isConnecting}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            background: 'var(--bg-tertiary)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'white',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'wait',
            opacity: 0.7,
          }}
        >
          <Loader size={16} className="spin" />
          Connecting...
        </button>

        {/* Connection Modal Overlay - using portal-like fixed positioning */}
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
          onClick={closeModal}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px',
              maxWidth: '420px',
              width: '90%',
              maxHeight: '90vh',
              overflowY: 'auto',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
              margin: '20px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Wallet size={24} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>Connect Wallet</span>
              </div>
              <button
                onClick={closeModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {connectionMethod === 'choose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button
                  onClick={handleWalletConnect}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                >
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'linear-gradient(135deg, #3B99FC 0%, #3B82F6 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <QrCode size={24} color="white" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      WalletConnect
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Scan QR with mobile wallet
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setConnectionMethod('manual')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                >
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Key size={24} color="white" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      Private Key
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Enter your wallet private key
                    </div>
                  </div>
                </button>

                <p style={{
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  marginTop: '8px',
                }}>
                  Your keys are stored locally and never sent to any server
                </p>
              </div>
            )}

            {connectionMethod === 'walletconnect' && (
              <div>
                {wcUri ? (
                  <>
                    <div style={{
                      background: 'white',
                      padding: '24px',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      justifyContent: 'center',
                      marginBottom: '24px',
                    }}>
                      <QRCodeSVG
                        value={wcUri}
                        size={220}
                        level="M"
                        includeMargin={false}
                      />
                    </div>

                    <p style={{
                      textAlign: 'center',
                      color: 'var(--text-secondary)',
                      fontSize: '0.9rem',
                      marginBottom: '16px',
                    }}>
                      Scan with your mobile wallet app
                    </p>

                    <button
                      onClick={copyWcUri}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '12px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        marginBottom: '12px',
                      }}
                    >
                      <Copy size={16} />
                      Copy Connection Link
                    </button>
                  </>
                ) : (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '40px 20px',
                  }}>
                    <Loader size={32} className="spin" style={{ color: 'var(--primary)', marginBottom: '16px' }} />
                    <p style={{ color: 'var(--text-secondary)' }}>Initializing WalletConnect...</p>
                  </div>
                )}

                <button
                  onClick={() => setConnectionMethod('choose')}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Back
                </button>
              </div>
            )}

            {connectionMethod === 'manual' && (
              <div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '8px',
                  }}>
                    Private Key
                  </label>
                  <input
                    type="password"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="Enter your private key (0x...)"
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.85rem',
                    }}
                  />
                </div>

                {(manualError || error) && (
                  <div style={{
                    padding: '12px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid var(--error)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--error)',
                    fontSize: '0.85rem',
                    marginBottom: '16px',
                  }}>
                    {manualError || error}
                  </div>
                )}

                <button
                  onClick={handleManualConnect}
                  disabled={isConnecting}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                    cursor: isConnecting ? 'wait' : 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 500,
                    marginBottom: '12px',
                    opacity: isConnecting ? 0.7 : 1,
                  }}
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>

                <button
                  onClick={() => setConnectionMethod('choose')}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Back
                </button>

                <p style={{
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  marginTop: '16px',
                }}>
                  Your private key is used locally to sign transactions and is never transmitted
                </p>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  if (!connected) {
    return (
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: isConnecting
            ? 'var(--bg-tertiary)'
            : 'linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          color: 'white',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.85rem',
          fontWeight: 500,
          cursor: isConnecting ? 'wait' : 'pointer',
          transition: 'all 0.2s',
          opacity: isConnecting ? 0.7 : 1,
        }}
      >
        {isConnecting ? (
          <>
            <Loader size={16} className="spin" />
            Connecting...
          </>
        ) : (
          <>
            <Wallet size={16} />
            Connect Wallet
          </>
        )}
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {isWrongNetwork ? (
          <>
            <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
            <span style={{ color: 'var(--warning)' }}>Wrong Network</span>
          </>
        ) : (
          <>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--primary)',
            }} />
            <span>{formatAddress(address!)}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              {network?.name || `Chain ${chainId}`}
            </span>
          </>
        )}
      </button>

      {showDropdown && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '8px',
          minWidth: '280px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          zIndex: 100,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '16px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Wallet size={18} style={{ color: 'var(--primary)' }} />
              <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
                Connected Wallet
              </span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <code style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {address}
              </code>
              <button
                onClick={copyAddress}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '4px',
                }}
              >
                {copied ? <Check size={14} style={{ color: 'var(--primary)' }} /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', gap: '24px' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  ETH Balance
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {balance ? parseFloat(balance).toFixed(4) : '0'} ETH
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  OTT Balance
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)' }}>
                  {ottBalance ? parseFloat(ottBalance).toFixed(2) : '0'} OTT
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Network
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: isWrongNetwork ? 'var(--warning)' : 'var(--text-primary)' }}>
                {network?.name || `Chain ${chainId}`}
              </span>
              {isWrongNetwork && (
                <span style={{
                  padding: '4px 12px',
                  background: 'var(--warning)',
                  color: 'black',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                }}>
                  Switch to Sepolia
                </span>
              )}
            </div>
          </div>

          <div style={{ padding: '12px' }}>
            {network?.explorer && address && (
              <a
                href={`${network.explorer}/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'background 0.2s',
                }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >
                <ExternalLink size={16} />
                View on Explorer
              </a>
            )}
            <button
              onClick={() => {
                disconnectWallet();
                setShowDropdown(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 12px',
                background: 'none',
                border: 'none',
                color: 'var(--error)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.9rem',
                transition: 'background 0.2s',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(255,100,100,0.1)'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
            >
              <LogOut size={16} />
              Disconnect
            </button>
          </div>
        </div>
      )}

      {showDropdown && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 99,
          }}
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}
