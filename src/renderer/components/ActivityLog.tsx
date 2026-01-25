import { Terminal } from 'lucide-react';

interface ActivityItem {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface ActivityLogProps {
  entries: ActivityItem[];
  maxEntries?: number;
}

export function ActivityLog({ entries, maxEntries = 50 }: ActivityLogProps) {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <Terminal size={32} style={{ marginBottom: '0.5rem', opacity: 0.3 }} />
        <div>AWAITING INPUT...</div>
      </div>
    );
  }

  return (
    <div className="terminal-log">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {entries.slice(0, maxEntries).map((entry, i) => (
          <div key={i} className="log-entry">
            <span className="log-time">[{entry.time}]</span>
            <span className={`log-message ${entry.type}`}>
              {entry.type === 'success' && '+ '}
              {entry.type === 'error' && '! '}
              {entry.type === 'info' && '> '}
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
