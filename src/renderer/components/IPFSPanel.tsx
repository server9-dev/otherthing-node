import { useState, useEffect, useCallback } from 'react';
import { HardDrive, Play, Square, Download, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { CyberButton } from './CyberButton';

interface DriveInfo {
  mount: string;
  label: string;
  type: string;
  size_gb: number;
  available_gb: number;
  used_percent: number;
}

interface IPFSStatus {
  running: boolean;
  hasBinary: boolean;
  peerId: string | null;
  stats: {
    repoSize?: number;
    numObjects?: number;
    storageMax?: number;
  } | null;
}

export function IPFSPanel() {
  const [status, setStatus] = useState<IPFSStatus>({
    running: false,
    hasBinary: false,
    peerId: null,
    stats: null,
  });
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [storageLimit, setStorageLimit] = useState<number>(50);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const ipfsStatus = await window.electronAPI.getIPFSStatus();
      setStatus(ipfsStatus);

      const storagePath = await window.electronAPI.getStoragePath();
      if (storagePath) {
        // Extract drive letter from path
        const drive = storagePath.match(/^([A-Z]:)/i)?.[1] || storagePath;
        setSelectedDrive(drive);
      }

      const limit = await window.electronAPI.getIPFSStorageLimit();
      if (limit) setStorageLimit(limit);
    } catch (err) {
      console.error('Failed to get IPFS status:', err);
    }
  }, []);

  const loadDrives = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const driveList = await window.electronAPI.getDrives();
      setDrives(driveList);
    } catch (err) {
      console.error('Failed to get drives:', err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    loadDrives();

    // Listen for status changes
    if (window.electronAPI?.onIPFSStatus) {
      window.electronAPI.onIPFSStatus((newStatus: any) => {
        setStatus(prev => ({ ...prev, ...newStatus }));
      });
    }

    // Listen for download progress
    if (window.electronAPI?.onIPFSDownloadProgress) {
      window.electronAPI.onIPFSDownloadProgress((percent: number) => {
        setDownloadProgress(percent);
        if (percent >= 100) {
          setDownloading(false);
          refreshStatus();
        }
      });
    }

    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, [refreshStatus, loadDrives]);

  const handleDownloadBinary = async () => {
    if (!window.electronAPI) return;
    setDownloading(true);
    setDownloadProgress(0);
    try {
      await window.electronAPI.downloadIPFSBinary();
    } catch (err) {
      console.error('Failed to download IPFS:', err);
      setDownloading(false);
    }
  };

  const handleStart = async () => {
    if (!window.electronAPI) return;
    setStarting(true);
    try {
      await window.electronAPI.startIPFS();
      await refreshStatus();
    } catch (err) {
      console.error('Failed to start IPFS:', err);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!window.electronAPI) return;
    setStopping(true);
    try {
      await window.electronAPI.stopIPFS();
      await refreshStatus();
    } catch (err) {
      console.error('Failed to stop IPFS:', err);
    } finally {
      setStopping(false);
    }
  };

  const handleDriveChange = async (drive: string) => {
    if (!window.electronAPI) return;
    setSelectedDrive(drive);
    try {
      // Set storage path to the drive root + otherthing folder
      const path = `${drive}\\OtherThing\\ipfs`;
      await window.electronAPI.setStoragePath(path);
    } catch (err) {
      console.error('Failed to set storage path:', err);
    }
  };

  const handleStorageLimitChange = async (limit: number) => {
    if (!window.electronAPI) return;
    setStorageLimit(limit);
    try {
      await window.electronAPI.setIPFSStorageLimit(limit);
    } catch (err) {
      console.error('Failed to set storage limit:', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(2)} KB`;
  };

  return (
    <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
      <div className="cyber-card-header">
        <span className="cyber-card-title">
          <HardDrive size={14} style={{ marginRight: '0.5rem' }} />
          IPFS STORAGE NODE
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '0.7rem',
            fontFamily: 'var(--font-mono)',
            background: status.running ? 'rgba(0, 212, 255, 0.1)' : 'rgba(255, 0, 128, 0.1)',
            color: status.running ? 'var(--primary)' : 'var(--accent)',
            border: `1px solid ${status.running ? 'var(--primary)' : 'var(--accent)'}`,
          }}>
            {status.running ? 'RUNNING' : 'STOPPED'}
          </span>
          <CyberButton icon={RefreshCw} onClick={refreshStatus} style={{ padding: '4px 8px' }}>

          </CyberButton>
        </div>
      </div>
      <div className="cyber-card-body">
        {/* Binary Status */}
        {!status.hasBinary ? (
          <div style={{ textAlign: 'center', padding: 'var(--gap-lg)' }}>
            <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: 'var(--gap-md)' }} />
            <div style={{ color: 'var(--text-primary)', marginBottom: 'var(--gap-md)' }}>
              IPFS binary not installed
            </div>
            {downloading ? (
              <div>
                <div style={{
                  width: '100%',
                  height: 8,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  marginBottom: 'var(--gap-sm)',
                }}>
                  <div style={{
                    width: `${downloadProgress}%`,
                    height: '100%',
                    background: 'var(--gradient-brand)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Downloading... {downloadProgress.toFixed(0)}%
                </span>
              </div>
            ) : (
              <CyberButton icon={Download} onClick={handleDownloadBinary}>
                Download IPFS
              </CyberButton>
            )}
          </div>
        ) : (
          <>
            {/* Controls */}
            <div style={{ display: 'flex', gap: 'var(--gap-md)', marginBottom: 'var(--gap-lg)' }}>
              {status.running ? (
                <CyberButton icon={Square} onClick={handleStop} loading={stopping} variant="secondary">
                  Stop IPFS
                </CyberButton>
              ) : (
                <CyberButton icon={Play} onClick={handleStart} loading={starting} variant="primary">
                  Start IPFS
                </CyberButton>
              )}
            </div>

            {/* Drive Selection */}
            <div style={{ marginBottom: 'var(--gap-lg)' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: 'var(--gap-sm)',
                textTransform: 'uppercase',
              }}>
                Storage Drive
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gap-sm)' }}>
                {drives.length > 0 ? drives.map((drive) => (
                  <button
                    key={drive.mount}
                    onClick={() => handleDriveChange(drive.mount)}
                    style={{
                      padding: 'var(--gap-sm) var(--gap-md)',
                      background: selectedDrive === drive.mount
                        ? 'rgba(0, 212, 255, 0.1)'
                        : 'var(--bg-tertiary)',
                      border: `1px solid ${selectedDrive === drive.mount ? 'var(--primary)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      minWidth: 120,
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--gap-xs)',
                      marginBottom: '4px',
                    }}>
                      {selectedDrive === drive.mount && <Check size={12} style={{ color: 'var(--primary)' }} />}
                      <span style={{
                        color: selectedDrive === drive.mount ? 'var(--primary)' : 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.9rem',
                      }}>
                        {drive.mount}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {drive.available_gb.toFixed(0)} GB free
                    </span>
                  </button>
                )) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No drives detected
                  </span>
                )}
              </div>
            </div>

            {/* Storage Limit */}
            <div style={{ marginBottom: 'var(--gap-lg)' }}>
              <label style={{
                display: 'block',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: 'var(--gap-sm)',
                textTransform: 'uppercase',
              }}>
                Storage Limit: {storageLimit} GB
              </label>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={storageLimit}
                onChange={(e) => handleStorageLimitChange(parseInt(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
              }}>
                <span>10 GB</span>
                <span>500 GB</span>
              </div>
            </div>

            {/* Stats */}
            {status.running && status.stats && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--gap-md)',
                padding: 'var(--gap-md)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    REPO SIZE
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                    {formatBytes(status.stats.repoSize || 0)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    OBJECTS
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                    {status.stats.numObjects || 0}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    PEER ID
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.75rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {status.peerId ? status.peerId.slice(0, 12) + '...' : '--'}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
