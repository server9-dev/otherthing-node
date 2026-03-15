import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FileCode, FilePlus, Save, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { CyberButton } from '../../components';

const API_BASE = 'http://localhost:8080/api/v1';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt?: string;
}

interface Props { workspaceId: string; }

// Language detection from file extension
function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', sol: 'solidity',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', graphql: 'graphql', xml: 'xml',
    dockerfile: 'dockerfile', makefile: 'makefile',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    java: 'java', kt: 'kotlin', swift: 'swift',
    rb: 'ruby', php: 'php', lua: 'lua',
  };
  return map[ext] || 'plaintext';
}

export function CodeTab({ workspaceId }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['.']));
  const [dirContents, setDirContents] = useState<Map<string, FileEntry[]>>(new Map());
  const [openFile, setOpenFile] = useState<{ path: string; content: string; language: string } | null>(null);
  const [modified, setModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const loadDir = useCallback(async (dirPath: string) => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/sandbox/files?path=${encodeURIComponent(dirPath)}`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      if (res.ok) {
        const data = await res.json();
        const entries = (data.files || []).sort((a: FileEntry, b: FileEntry) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setDirContents(prev => new Map(prev).set(dirPath, entries));
        if (dirPath === '.') setFiles(entries);
      } else if (res.status === 503) {
        setError('Sandbox not configured. Add files from the Files tab first.');
      }
    } catch (err) {
      if (dirPath === '.') setError('Failed to load files');
    } finally {
      if (dirPath === '.') setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { loadDir('.'); }, [loadDir]);

  const toggleDir = (dirPath: string) => {
    const next = new Set(expandedDirs);
    if (next.has(dirPath)) {
      next.delete(dirPath);
    } else {
      next.add(dirPath);
      if (!dirContents.has(dirPath)) loadDir(dirPath);
    }
    setExpandedDirs(next);
  };

  const openFileHandler = async (filePath: string) => {
    try {
      const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/sandbox/file?path=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      if (res.ok) {
        const data = await res.json();
        const name = filePath.split('/').pop() || filePath;
        setOpenFile({ path: filePath, content: data.content || '', language: getLanguage(name) });
        setModified(false);
      }
    } catch {}
  };

  const saveFile = async () => {
    if (!openFile) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/sandbox/file?path=${encodeURIComponent(openFile.path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ content: openFile.content }),
      });
      setModified(false);
    } catch {} finally { setSaving(false); }
  };

  const createFile = async () => {
    if (!newFileName.trim()) return;
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/sandbox/file?path=${encodeURIComponent(newFileName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ content: '' }),
      });
      setShowNewFile(false);
      setNewFileName('');
      loadDir('.');
      openFileHandler(newFileName);
    } catch {}
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
    // Handle tab key
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = editorRef.current;
      if (el) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const newContent = openFile!.content.substring(0, start) + '  ' + openFile!.content.substring(end);
        setOpenFile({ ...openFile!, content: newContent });
        setModified(true);
        setTimeout(() => { el.selectionStart = el.selectionEnd = start + 2; }, 0);
      }
    }
  };

  // Recursive file tree renderer
  const renderTree = (entries: FileEntry[], depth = 0) => {
    return entries.map(entry => {
      const isExpanded = expandedDirs.has(entry.path);
      const children = dirContents.get(entry.path) || [];

      return (
        <div key={entry.path}>
          <div
            onClick={() => entry.isDirectory ? toggleDir(entry.path) : openFileHandler(entry.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              padding: '0.25rem 0.5rem', paddingLeft: `${depth * 16 + 8}px`,
              cursor: 'pointer', fontSize: '0.8rem',
              color: openFile?.path === entry.path ? 'var(--primary)' : 'var(--text-secondary)',
              background: openFile?.path === entry.path ? 'rgba(0,212,255,0.08)' : 'transparent',
              borderRight: openFile?.path === entry.path ? '2px solid var(--primary)' : '2px solid transparent',
            }}
            onMouseEnter={e => { if (openFile?.path !== entry.path) (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'; }}
            onMouseLeave={e => { if (openFile?.path !== entry.path) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            {entry.isDirectory ? (
              isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
            ) : <span style={{ width: 12 }} />}
            {entry.isDirectory ? <Folder size={13} style={{ color: 'var(--secondary)', flexShrink: 0 }} /> : <FileCode size={13} style={{ flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
          </div>
          {entry.isDirectory && isExpanded && children.length > 0 && renderTree(children, depth + 1)}
        </div>
      );
    });
  };

  if (error) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <FileCode size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: '1rem' }} />
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{error}</p>
        <CyberButton icon={RefreshCw} onClick={() => { setError(null); setLoading(true); loadDir('.'); }}>Retry</CyberButton>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* File tree sidebar */}
      <div style={{
        width: 250, borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{
          padding: '0.5rem', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Files
          </span>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button onClick={() => setShowNewFile(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
              <FilePlus size={14} />
            </button>
            <button onClick={() => loadDir('.')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {showNewFile && (
          <div style={{ padding: '0.4rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <input
              type="text" value={newFileName} onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createFile(); if (e.key === 'Escape') setShowNewFile(false); }}
              placeholder="filename.ts" autoFocus
              style={{
                width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--primary)',
                borderRadius: 4, color: 'var(--text-primary)', padding: '0.3rem 0.5rem', fontSize: '0.8rem', outline: 'none',
              }}
            />
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading...</div>
          ) : files.length === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>No files yet</div>
          ) : (
            renderTree(files)
          )}
        </div>
      </div>

      {/* Editor pane */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-void)' }}>
        {openFile ? (
          <>
            {/* Editor header */}
            <div style={{
              padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'var(--bg-secondary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileCode size={14} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {openFile.path}
                </span>
                {modified && <span style={{ fontSize: '0.7rem', color: 'var(--accent)' }}>modified</span>}
              </div>
              <CyberButton
                variant={modified ? 'primary' : 'default'}
                icon={Save} onClick={saveFile} loading={saving}
                disabled={!modified}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                Save
              </CyberButton>
            </div>

            {/* Code textarea (Monaco would replace this) */}
            <textarea
              ref={editorRef}
              value={openFile.content}
              onChange={e => { setOpenFile({ ...openFile, content: e.target.value }); setModified(true); }}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              style={{
                flex: 1, width: '100%', background: 'var(--bg-void)',
                color: 'var(--text-primary)', border: 'none', outline: 'none',
                padding: '1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                lineHeight: 1.6, resize: 'none', tabSize: 2,
              }}
            />
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <FileCode size={48} style={{ color: 'var(--text-muted)', opacity: 0.2, marginBottom: '0.75rem' }} />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Select a file to edit</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Ctrl+S to save</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
