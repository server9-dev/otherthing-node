import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Play,
  Square,
  Trash2,
  Plus,
  RefreshCw,
  AlertTriangle,
  Download,
  Terminal,
  X,
  ChevronDown,
  ChevronRight,
  Layers,
  Image as ImageIcon,
} from 'lucide-react';
import { CyberButton } from './CyberButton';
import {
  containerService,
  ContainerInfo,
  ImageInfo,
  RuntimeInfo,
  ContainerStatus,
  CreateContainerRequest,
} from '../../services/container-service';

interface ContainersPanelProps {
  onContainerSelect?: (containerId: string) => void;
}

const STATUS_COLORS: Record<ContainerStatus, { bg: string; border: string; text: string }> = {
  running: { bg: 'rgba(0, 212, 255, 0.1)', border: 'var(--primary)', text: 'var(--primary)' },
  created: { bg: 'rgba(155, 89, 182, 0.1)', border: 'var(--secondary)', text: 'var(--secondary)' },
  paused: { bg: 'rgba(255, 193, 7, 0.1)', border: 'var(--warning)', text: 'var(--warning)' },
  exited: { bg: 'rgba(108, 117, 125, 0.1)', border: 'var(--text-muted)', text: 'var(--text-muted)' },
  dead: { bg: 'rgba(255, 0, 128, 0.1)', border: 'var(--accent)', text: 'var(--accent)' },
  restarting: { bg: 'rgba(0, 212, 255, 0.1)', border: 'var(--primary)', text: 'var(--primary)' },
  removing: { bg: 'rgba(255, 0, 128, 0.1)', border: 'var(--accent)', text: 'var(--accent)' },
  unknown: { bg: 'rgba(108, 117, 125, 0.1)', border: 'var(--text-muted)', text: 'var(--text-muted)' },
};

export function ContainersPanel({ onContainerSelect }: ContainersPanelProps) {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllContainers, setShowAllContainers] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState(false);

  // Operation states
  const [pullingImage, setPullingImage] = useState<string | null>(null);
  const [startingContainer, setStartingContainer] = useState<string | null>(null);
  const [stoppingContainer, setStoppingContainer] = useState<string | null>(null);
  const [removingContainer, setRemovingContainer] = useState<string | null>(null);

  // Create form state
  const [createForm, setCreateForm] = useState<CreateContainerRequest>({
    name: '',
    image: '',
    cmd: [],
    env: [],
    ports: [],
  });
  const [customImageName, setCustomImageName] = useState('');

  const refreshStatus = useCallback(async () => {
    try {
      const info = await containerService.getRuntimeInfo();
      setRuntimeInfo(info);

      if (info?.available) {
        const containerList = await containerService.listContainers(showAllContainers);
        setContainers(containerList);

        const imageList = await containerService.listImages();
        setImages(imageList);
      }
    } catch (err) {
      console.error('Failed to get container status:', err);
    } finally {
      setLoading(false);
    }
  }, [showAllContainers]);

  useEffect(() => {
    refreshStatus();

    // Subscribe to container events
    const unsubscribe = containerService.subscribe((event) => {
      if (event.type === 'status_change' || event.type === 'started' || event.type === 'stopped') {
        refreshStatus();
      }
    });

    const interval = setInterval(refreshStatus, 10000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refreshStatus]);

  const handleDetectRuntime = async () => {
    setLoading(true);
    await containerService.detectRuntime();
    await refreshStatus();
  };

  const handlePullImage = async (imageName: string) => {
    setPullingImage(imageName);
    try {
      await containerService.pullImage(imageName);
      await refreshStatus();
    } finally {
      setPullingImage(null);
    }
  };

  const handleStartContainer = async (containerId: string) => {
    setStartingContainer(containerId);
    try {
      await containerService.startContainer(containerId);
      await refreshStatus();
    } finally {
      setStartingContainer(null);
    }
  };

  const handleStopContainer = async (containerId: string) => {
    setStoppingContainer(containerId);
    try {
      await containerService.stopContainer(containerId);
      await refreshStatus();
    } finally {
      setStoppingContainer(null);
    }
  };

  const handleRemoveContainer = async (containerId: string) => {
    if (!confirm('Remove this container?')) return;
    setRemovingContainer(containerId);
    try {
      await containerService.removeContainer(containerId, true);
      await refreshStatus();
    } finally {
      setRemovingContainer(null);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Delete this image?')) return;
    try {
      // Use API directly for image deletion
      const response = await fetch(`http://localhost:8080/api/v1/containers/images/${encodeURIComponent(imageId)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        await refreshStatus();
      }
    } catch (err) {
      console.error('Failed to delete image:', err);
    }
  };

  const handleViewLogs = async (containerId: string) => {
    setShowLogs(containerId);
    setLogsLoading(true);
    try {
      const containerLogs = await containerService.getLogs(containerId, 200);
      setLogs(containerLogs);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleCreateContainer = async () => {
    if (!createForm.name || !createForm.image) return;

    try {
      const containerId = await containerService.run(createForm);
      if (containerId) {
        setShowCreateForm(false);
        setCreateForm({ name: '', image: '', cmd: [], env: [], ports: [] });
        await refreshStatus();
      }
    } catch (err) {
      console.error('Failed to create container:', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const formatImageName = (tags: string[]) => {
    if (!tags || tags.length === 0) return '<none>';
    return tags[0].replace('<none>:<none>', '<none>');
  };

  const getStatusColors = (status: ContainerStatus) => {
    return STATUS_COLORS[status] || STATUS_COLORS.unknown;
  };

  return (
    <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
      <div className="cyber-card-header">
        <span className="cyber-card-title">
          <Box size={14} style={{ marginRight: '0.5rem' }} />
          CONTAINER RUNTIME
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontFamily: 'var(--font-mono)',
              background: runtimeInfo?.available
                ? 'rgba(0, 212, 255, 0.1)'
                : 'rgba(255, 0, 128, 0.1)',
              color: runtimeInfo?.available ? 'var(--primary)' : 'var(--accent)',
              border: `1px solid ${runtimeInfo?.available ? 'var(--primary)' : 'var(--accent)'}`,
            }}
          >
            {runtimeInfo?.available
              ? `${runtimeInfo.runtime_type?.toUpperCase() || 'DOCKER'} ${runtimeInfo.version || ''}`
              : 'NOT AVAILABLE'}
          </span>
          <CyberButton
            icon={RefreshCw}
            onClick={refreshStatus}
            loading={loading}
            style={{ padding: '4px 8px' }}
          >
            {''}
          </CyberButton>
        </div>
      </div>
      <div className="cyber-card-body">
        {/* Runtime Not Available */}
        {!runtimeInfo?.available ? (
          <div style={{ textAlign: 'center', padding: 'var(--gap-lg)' }}>
            <AlertTriangle
              size={32}
              style={{ color: 'var(--warning)', marginBottom: 'var(--gap-md)' }}
            />
            <div style={{ color: 'var(--text-primary)', marginBottom: 'var(--gap-md)' }}>
              Container runtime not detected
            </div>
            <div
              style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 'var(--gap-md)' }}
            >
              Install Docker or Podman to manage containers
            </div>
            <CyberButton icon={RefreshCw} onClick={handleDetectRuntime} loading={loading}>
              Detect Runtime
            </CyberButton>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div style={{ display: 'flex', gap: 'var(--gap-md)', marginBottom: 'var(--gap-lg)' }}>
              <CyberButton
                icon={Plus}
                onClick={() => setShowCreateForm(!showCreateForm)}
                variant="primary"
              >
                Create Container
              </CyberButton>
              <CyberButton
                icon={showImages ? ChevronDown : ChevronRight}
                onClick={() => setShowImages(!showImages)}
                variant="secondary"
              >
                Images ({images.length})
              </CyberButton>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--gap-xs)',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  marginLeft: 'auto',
                }}
              >
                <input
                  type="checkbox"
                  checked={showAllContainers}
                  onChange={(e) => setShowAllContainers(e.target.checked)}
                  style={{ accentColor: 'var(--primary)' }}
                />
                Show All
              </label>
            </div>

            {/* Create Container Form */}
            {showCreateForm && (
              <div
                style={{
                  marginBottom: 'var(--gap-lg)',
                  padding: 'var(--gap-md)',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    marginBottom: 'var(--gap-sm)',
                    textTransform: 'uppercase',
                  }}
                >
                  Create New Container
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
                  <input
                    type="text"
                    placeholder="Container name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    style={{
                      padding: 'var(--gap-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
                    <select
                      value={createForm.image}
                      onChange={(e) => setCreateForm({ ...createForm, image: e.target.value })}
                      style={{
                        flex: 1,
                        padding: 'var(--gap-sm)',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <option value="">Select image...</option>
                      {images.map((img) => (
                        <option key={img.id} value={formatImageName(img.repo_tags)}>
                          {formatImageName(img.repo_tags)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Or enter image name"
                      value={customImageName}
                      onChange={(e) => {
                        setCustomImageName(e.target.value);
                        setCreateForm({ ...createForm, image: e.target.value });
                      }}
                      style={{
                        flex: 1,
                        padding: 'var(--gap-sm)',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Command (e.g., /bin/bash -c 'echo hello')"
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        cmd: e.target.value ? e.target.value.split(' ') : [],
                      })
                    }
                    style={{
                      padding: 'var(--gap-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 'var(--gap-sm)', justifyContent: 'flex-end' }}>
                    <CyberButton onClick={() => setShowCreateForm(false)} variant="secondary">
                      Cancel
                    </CyberButton>
                    <CyberButton
                      icon={Play}
                      onClick={handleCreateContainer}
                      disabled={!createForm.name || !createForm.image}
                      variant="primary"
                    >
                      Create & Run
                    </CyberButton>
                  </div>
                </div>
              </div>
            )}

            {/* Images Section */}
            {showImages && (
              <div
                style={{
                  marginBottom: 'var(--gap-lg)',
                  padding: 'var(--gap-md)',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    marginBottom: 'var(--gap-sm)',
                    textTransform: 'uppercase',
                  }}
                >
                  <ImageIcon
                    size={12}
                    style={{ marginRight: '0.5rem', verticalAlign: 'middle' }}
                  />
                  Images ({images.length})
                </div>

                {/* Pull Image */}
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--gap-sm)',
                    marginBottom: 'var(--gap-md)',
                  }}
                >
                  <input
                    type="text"
                    placeholder="Pull image (e.g., nginx:latest)"
                    id="pull-image-input"
                    style={{
                      flex: 1,
                      padding: 'var(--gap-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <CyberButton
                    icon={Download}
                    onClick={() => {
                      const input = document.getElementById('pull-image-input') as HTMLInputElement;
                      if (input?.value) {
                        handlePullImage(input.value);
                        input.value = '';
                      }
                    }}
                    loading={!!pullingImage}
                  >
                    Pull
                  </CyberButton>
                </div>

                {/* Pull Progress */}
                {pullingImage && (
                  <div
                    style={{
                      marginBottom: 'var(--gap-md)',
                      fontSize: '0.85rem',
                      color: 'var(--primary)',
                    }}
                  >
                    Pulling {pullingImage}...
                  </div>
                )}

                {/* Image List */}
                {images.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
                    {images.map((image) => (
                      <div
                        key={image.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--gap-sm) var(--gap-md)',
                          background: 'var(--bg-elevated)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              color: 'var(--text-primary)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.85rem',
                            }}
                          >
                            {formatImageName(image.repo_tags)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {formatBytes(image.size)} • {image.id.slice(7, 19)}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteImage(image.id)}
                          style={{
                            padding: '4px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 'var(--gap-md)',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                    }}
                  >
                    No images found. Pull an image to get started.
                  </div>
                )}
              </div>
            )}

            {/* Container List */}
            <div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--gap-sm)',
                  textTransform: 'uppercase',
                }}
              >
                <Layers size={12} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Containers ({containers.length})
              </div>
              {containers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
                  {containers.map((container) => {
                    const statusColors = getStatusColors(container.status);
                    return (
                      <div
                        key={container.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--gap-sm) var(--gap-md)',
                          background: statusColors.bg,
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${statusColors.border}`,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-sm)' }}>
                            <span
                              style={{
                                color: 'var(--text-primary)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.9rem',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {container.name}
                            </span>
                            <span
                              style={{
                                padding: '1px 6px',
                                borderRadius: '3px',
                                fontSize: '0.65rem',
                                fontFamily: 'var(--font-mono)',
                                textTransform: 'uppercase',
                                background: statusColors.bg,
                                color: statusColors.text,
                                border: `1px solid ${statusColors.border}`,
                              }}
                            >
                              {container.status}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '0.7rem',
                              color: 'var(--text-muted)',
                              marginTop: '2px',
                            }}
                          >
                            {container.image}
                            {container.ports.length > 0 && (
                              <span style={{ marginLeft: '0.5rem' }}>
                                •{' '}
                                {container.ports
                                  .filter((p) => p.host_port)
                                  .map((p) => `${p.host_port}:${p.container_port}`)
                                  .join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--gap-xs)' }}>
                          {container.status === 'running' ? (
                            <CyberButton
                              icon={Square}
                              onClick={() => handleStopContainer(container.id)}
                              loading={stoppingContainer === container.id}
                              style={{ padding: '4px 8px' }}
                              variant="secondary"
                            >
                              {''}
                            </CyberButton>
                          ) : container.status === 'exited' || container.status === 'created' ? (
                            <CyberButton
                              icon={Play}
                              onClick={() => handleStartContainer(container.id)}
                              loading={startingContainer === container.id}
                              style={{ padding: '4px 8px' }}
                              variant="primary"
                            >
                              {''}
                            </CyberButton>
                          ) : null}
                          <CyberButton
                            icon={Terminal}
                            onClick={() => handleViewLogs(container.id)}
                            style={{ padding: '4px 8px' }}
                          >
                            {''}
                          </CyberButton>
                          <button
                            onClick={() => handleRemoveContainer(container.id)}
                            disabled={removingContainer === container.id}
                            style={{
                              padding: '4px 8px',
                              background: 'transparent',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer',
                              color: 'var(--text-muted)',
                              opacity: removingContainer === container.id ? 0.5 : 1,
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 'var(--gap-lg)',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                  }}
                >
                  No containers{showAllContainers ? '' : ' running'}. Click "Create Container" to get
                  started.
                </div>
              )}
            </div>

            {/* Runtime Info */}
            {runtimeInfo && (
              <div
                style={{
                  marginTop: 'var(--gap-md)',
                  padding: 'var(--gap-sm)',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'var(--gap-md)',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Runtime: </span>
                  <span style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
                    {runtimeInfo.runtime_type || 'docker'}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>OS: </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {runtimeInfo.os}/{runtimeInfo.arch}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>API: </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    v{runtimeInfo.api_version}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Logs Modal */}
      {showLogs && (
        <div
          style={{
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
          }}
          onClick={() => setShowLogs(null)}
        >
          <div
            style={{
              width: '80%',
              maxWidth: 900,
              maxHeight: '80vh',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-default)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--gap-md)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                <Terminal
                  size={14}
                  style={{ marginRight: '0.5rem', verticalAlign: 'middle' }}
                />
                Container Logs
              </span>
              <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
                <CyberButton
                  icon={RefreshCw}
                  onClick={() => handleViewLogs(showLogs)}
                  loading={logsLoading}
                  style={{ padding: '4px 8px' }}
                >
                  Refresh
                </CyberButton>
                <button
                  onClick={() => setShowLogs(null)}
                  style={{
                    padding: '4px 8px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div
              style={{
                padding: 'var(--gap-md)',
                maxHeight: 'calc(80vh - 60px)',
                overflow: 'auto',
              }}
            >
              {logsLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
              ) : logs ? (
                <pre
                  style={{
                    margin: 0,
                    padding: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {logs}
                </pre>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  No logs available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
