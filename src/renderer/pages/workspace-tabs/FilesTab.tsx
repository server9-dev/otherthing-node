import { useState, useEffect, useCallback } from 'react';
import { Upload, Grid, List, Copy, Check, Trash2, Eye, File, FileText, Image, Download } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface StorageFile {
  id: string;
  cid: string;
  name: string;
  size: number;
  mimeType: string;
  addedBy: string;
  addedAt: string;
  pinned: boolean;
}

interface Props { workspaceId: string; }

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.startsWith('text/')) return FileText;
  return File;
}

export function FilesTab({ workspaceId }: Props) {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [uploading, setUploading] = useState(false);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ file: StorageFile; content: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/storage/files`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch {} finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const uploadFile = async (file: globalThis.File) => {
    setUploading(true);
    try {
      const content = await file.text();
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/storage/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ content, filename: file.name, mimeType: file.type || 'application/octet-stream' }),
      });
      if (res.ok) loadFiles();
    } catch {} finally { setUploading(false); }
  };

  const deleteFile = async (fileId: string) => {
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/storage/files/${fileId}`, {
        method: 'DELETE', headers: { Authorization: 'Bearer local-token' },
      });
      loadFiles();
    } catch {}
  };

  const previewContent = async (file: StorageFile) => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/storage/content/${file.cid}`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewFile({ file, content: data.content });
      }
    } catch {}
  };

  const copyCid = (cid: string) => {
    navigator.clipboard.writeText(cid);
    setCopiedCid(cid);
    setTimeout(() => setCopiedCid(null), 2000);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) uploadFile(droppedFiles[0]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) uploadFile(e.target.files[0]);
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1rem' }}>
          Files <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({files.length})</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')} style={{
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.35rem',
          }}>
            {viewMode === 'grid' ? <List size={14} /> : <Grid size={14} />}
          </button>
          <label style={{ cursor: 'pointer' }}>
            <CyberButton variant="primary" icon={Upload} loading={uploading}>Upload</CyberButton>
            <input type="file" onChange={handleFileInput} hidden />
          </label>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragActive ? 'var(--primary)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-lg)', padding: '2rem', textAlign: 'center',
          marginBottom: '1.5rem', transition: 'all 0.2s',
          background: dragActive ? 'rgba(0,212,255,0.05)' : 'transparent',
        }}
      >
        <Upload size={24} style={{ color: dragActive ? 'var(--primary)' : 'var(--text-muted)', marginBottom: '0.5rem' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
          Drop files here to upload to IPFS
        </p>
      </div>

      {/* File list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading files...</div>
      ) : files.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No files uploaded yet</div>
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          {files.map(file => {
            const Icon = getFileIcon(file.mimeType);
            return (
              <div key={file.id} style={{
                background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)', padding: '1rem',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
                onClick={() => previewContent(file)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; }}
              >
                <Icon size={28} style={{ color: 'var(--primary)', marginBottom: '0.5rem' }} />
                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  {formatSize(file.size)}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button onClick={e => { e.stopPropagation(); copyCid(file.cid); }} style={{ background: 'none', border: 'none', color: copiedCid === file.cid ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
                    {copiedCid === file.cid ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteFile(file.id); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {files.map((file, i) => (
            <div key={file.id} style={{
              display: 'flex', alignItems: 'center', padding: '0.6rem 1rem',
              borderBottom: i < files.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              cursor: 'pointer',
            }} onClick={() => previewContent(file)}>
              <FileText size={14} style={{ color: 'var(--primary)', marginRight: '0.75rem', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{file.name}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: '1rem' }}>{formatSize(file.size)}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: '0.75rem' }}>{file.cid.slice(0, 12)}...</span>
              <button onClick={e => { e.stopPropagation(); copyCid(file.cid); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                {copiedCid === file.cid ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button onClick={e => { e.stopPropagation(); deleteFile(file.id); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {previewFile && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setPreviewFile(null)}>
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border-default)', padding: '1.5rem',
            maxWidth: 700, width: '90%', maxHeight: '80vh', overflow: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: '1rem' }}>{previewFile.file.name}</h3>
              <button onClick={() => setPreviewFile(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              CID: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>{previewFile.file.cid}</span>
            </div>
            <pre style={{
              background: 'var(--bg-void)', padding: '1rem', borderRadius: 'var(--radius-md)',
              overflow: 'auto', maxHeight: '50vh', fontSize: '0.8rem',
              color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border-subtle)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {previewFile.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
