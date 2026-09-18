import { useState, FormEvent } from 'react';
import { LogIn, UserPlus, AlertTriangle, RefreshCw } from 'lucide-react';
import { CyberButton } from '../components';
import { useAuth } from '../context/AuthContext';
import logoUrl from '/logo.png?url';

type Mode = 'signIn' | 'signUp';

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach the OtherThing server. Check your connection and try again.';
  if (/invalid login credentials/i.test(msg)) return 'Email or password is incorrect.';
  if (/already registered|already exists/i.test(msg)) return 'An account with this email already exists. Sign in instead.';
  return msg;
}

export function SignIn() {
  const { status, error: bootError, retry, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (isSignUp) {
      if (!displayName.trim()) {
        setError('Choose a display name.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
    }

    setBusy(true);
    try {
      if (isSignUp) {
        const signedIn = await signUp(trimmedEmail, password, displayName.trim());
        if (!signedIn) {
          setNotice('Account created. Check your email to confirm it, then sign in.');
          setMode('signIn');
        }
      } else {
        await signIn(trimmedEmail, password);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-container">
      <div className="auth-screen">
        <div className="cyber-card auth-card fade-in">
          <div className="auth-brand">
            <img src={logoUrl} alt="" width={48} height={48} style={{ borderRadius: 10 }} />
            <h1 className="logo-text">OtherThing</h1>
          </div>

          {status === 'loading' && (
            <p className="auth-subtitle">Connecting to your node…</p>
          )}

          {status === 'error' && (
            <>
              <div className="auth-message error" role="alert">
                <AlertTriangle size={16} />
                <span>{bootError || 'Could not start sign-in.'}</span>
              </div>
              <CyberButton icon={RefreshCw} onClick={retry} style={{ width: '100%', justifyContent: 'center' }}>
                Try again
              </CyberButton>
            </>
          )}

          {status === 'signedOut' && (
            <>
              <div className="auth-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isSignUp}
                  className={`auth-tab ${!isSignUp ? 'active' : ''}`}
                  onClick={() => switchMode('signIn')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isSignUp}
                  className={`auth-tab ${isSignUp ? 'active' : ''}`}
                  onClick={() => switchMode('signUp')}
                >
                  Create account
                </button>
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="settings-group">
                  <label className="settings-label" htmlFor="auth-email">Email</label>
                  <input
                    id="auth-email"
                    type="email"
                    className="settings-input"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </div>

                {isSignUp && (
                  <div className="settings-group">
                    <label className="settings-label" htmlFor="auth-name">Display name</label>
                    <input
                      id="auth-name"
                      type="text"
                      className="settings-input"
                      autoComplete="nickname"
                      maxLength={32}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                )}

                <div className="settings-group">
                  <label className="settings-label" htmlFor="auth-password">Password</label>
                  <input
                    id="auth-password"
                    type="password"
                    className="settings-input"
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  {isSignUp && <div className="auth-hint">At least 8 characters.</div>}
                </div>

                {error && (
                  <div className="auth-message error" role="alert">
                    <AlertTriangle size={16} />
                    <span>{error}</span>
                  </div>
                )}
                {notice && (
                  <div className="auth-message info" role="status">
                    <span>{notice}</span>
                  </div>
                )}

                <CyberButton
                  type="submit"
                  variant="primary"
                  icon={isSignUp ? UserPlus : LogIn}
                  loading={busy}
                  style={{ width: '100%', justifyContent: 'center', padding: '10px var(--gap-md)' }}
                >
                  {isSignUp ? 'Create account' : 'Sign in'}
                </CyberButton>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
