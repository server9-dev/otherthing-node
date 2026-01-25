import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, HardDrive, Cpu, Save, FolderOpen, Check } from 'lucide-react';
import { CyberButton } from '../components';

export function Settings() {
  const [ollamaPath, setOllamaPath] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return;

      try {
        const path = await window.electronAPI.getStoragePath();
        if (path) setStoragePath(path);

        const ollama = await window.electronAPI.getOllamaPath();
        if (ollama) setOllamaPath(ollama);
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };

    loadSettings();
  }, []);

  const handleSave = async () => {
    if (!window.electronAPI) return;

    setSaving(true);
    setSaved(false);

    try {
      if (storagePath) {
        await window.electronAPI.setStoragePath(storagePath);
      }

      if (ollamaPath) {
        await window.electronAPI.setOllamaPath(ollamaPath);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleBrowseStorage = async () => {
    if (!window.electronAPI) return;

    try {
      const path = await window.electronAPI.browseForFile({
        title: 'Select Storage Directory',
      });
      if (path) {
        // Get directory from file path
        const dir = path.replace(/\\[^\\]+$/, '');
        setStoragePath(dir);
      }
    } catch (err) {
      console.error('Failed to browse:', err);
    }
  };

  const handleBrowseOllama = async () => {
    if (!window.electronAPI) return;

    try {
      const path = await window.electronAPI.browseForFile({
        title: 'Select Ollama Executable',
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      });
      if (path) setOllamaPath(path);
    } catch (err) {
      console.error('Failed to browse:', err);
    }
  };

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 'var(--gap-xl)' }}>
        <h1 className="page-title">Settings</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 'var(--gap-sm)' }}>
          Configure your node preferences
        </p>
      </div>

      {/* Storage Settings */}
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">
            <HardDrive size={14} style={{ marginRight: '0.5rem' }} />
            STORAGE
          </span>
        </div>
        <div className="cyber-card-body">
          <div className="settings-group">
            <label className="settings-label">Data Storage Path</label>
            <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
              <input
                type="text"
                className="settings-input"
                placeholder="Leave empty for default"
                value={storagePath}
                onChange={(e) => setStoragePath(e.target.value)}
                style={{ flex: 1 }}
              />
              <CyberButton icon={FolderOpen} onClick={handleBrowseStorage} variant="secondary">
                Browse
              </CyberButton>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--gap-xs)' }}>
              Where to store IPFS data and workspace files
            </div>
          </div>
        </div>
      </div>

      {/* Ollama Settings */}
      <div className="cyber-card" style={{ marginBottom: 'var(--gap-lg)' }}>
        <div className="cyber-card-header">
          <span className="cyber-card-title">
            <Cpu size={14} style={{ marginRight: '0.5rem' }} />
            OLLAMA
          </span>
        </div>
        <div className="cyber-card-body">
          <div className="settings-group">
            <label className="settings-label">Ollama Executable Path</label>
            <div style={{ display: 'flex', gap: 'var(--gap-sm)' }}>
              <input
                type="text"
                className="settings-input"
                placeholder="Leave empty for auto-detect"
                value={ollamaPath}
                onChange={(e) => setOllamaPath(e.target.value)}
                style={{ flex: 1 }}
              />
              <CyberButton icon={FolderOpen} onClick={handleBrowseOllama} variant="secondary">
                Browse
              </CyberButton>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'var(--gap-xs)' }}>
              Path to Ollama binary (auto-detected if installed normally)
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--gap-md)' }}>
        {saved && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--gap-xs)', color: 'var(--primary)' }}>
            <Check size={16} />
            Settings saved
          </span>
        )}
        <CyberButton variant="primary" icon={Save} onClick={handleSave} loading={saving}>
          Save Settings
        </CyberButton>
      </div>
    </div>
  );
}
