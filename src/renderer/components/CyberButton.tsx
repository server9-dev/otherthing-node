import { LucideIcon } from 'lucide-react';

interface CyberButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'success';
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function CyberButton({
  children,
  onClick,
  variant = 'default',
  icon: Icon,
  disabled,
  loading,
  className = '',
  style,
}: CyberButtonProps) {
  return (
    <button
      className={`cyber-btn ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
    >
      {loading ? (
        <span className="spin" style={{ display: 'inline-block', marginRight: '0.5rem' }}>⟳</span>
      ) : Icon ? (
        <Icon size={14} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
      ) : null}
      {children}
    </button>
  );
}
