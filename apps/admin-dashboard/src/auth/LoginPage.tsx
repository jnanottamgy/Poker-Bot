import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Alert, Button, ErrorState, Icon, TextField } from '@jpb/ui';
import { useBackend } from '../api/ApiProvider';
import { loginErrorCopy } from './loginErrors';
import type { LoginErrorCopy } from './loginErrors';
import { useSession } from './SessionProvider';

/** Sign-in screen with friendly errors (wrong password, lockout, rate limit, offline). */
export function LoginPage() {
  const { login, notice, status, retry } = useSession();
  const backend = useBackend();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LoginErrorCopy | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!username.trim() || !password) {
      setError({ kind: 'invalid', title: 'Missing details', description: 'Enter your username and password.' });
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(loginErrorCopy(err));
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="acr-login">
      <div className="acr-login__glow" aria-hidden="true" />
      <main className="acr-login__card" aria-labelledby="acr-login-title">
        <div className="acr-login__brand">
          <span className="acr-login__logo" aria-hidden="true">
            ♠
          </span>
          <span>Johnny&apos;s Poker Bot</span>
        </div>
        <h1 id="acr-login-title" className="acr-login__title">
          Control Room
        </h1>
        <p className="acr-login__lede">Sign in to watch and direct live tournaments. Every action is permission-checked and audit-logged.</p>

        {status === 'unavailable' ? (
          <ErrorState title="Cannot reach the control room server" description="The server did not answer. Check the network, then try again." onRetry={retry} retryLabel="Try again" />
        ) : (
          <form className="acr-login__form" onSubmit={submit} noValidate>
            {notice && !error && (
              <Alert severity="INFO" title={notice} />
            )}
            {error && (
              <Alert severity={error.kind === 'locked' ? 'CRITICAL' : 'WARNING'} title={error.title}>
                {error.description}
              </Alert>
            )}
            <TextField label="Username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} disabled={pending} required autoFocus />
            <TextField
              ref={passwordRef}
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={onKey}
              disabled={pending}
              required
              hint={capsLock ? 'Caps Lock is on.' : undefined}
            />
            <Button type="submit" variant="primary" size="lg" block loading={pending} loadingLabel="Signing in…" icon="key">
              Sign in
            </Button>
          </form>
        )}

        <p className="acr-login__foot">
          <Icon name="shield" /> Sessions expire after inactivity. Never share your account — actions are recorded under your name.
        </p>

        {backend.demoAccounts && (
          <section className="acr-login__demo" aria-label="Mock mode accounts">
            <p className="acr-login__demo-title">
              <Icon name="zap" /> Mock mode — demo accounts
            </p>
            <ul>
              {backend.demoAccounts.map((a) => (
                <li key={a.username}>
                  <button
                    type="button"
                    className="acr-login__demo-btn"
                    onClick={() => {
                      setUsername(a.username);
                      setPassword(a.password);
                      setError(null);
                    }}
                  >
                    <span className="jpb-mono">{a.username}</span>
                    <span className="acr-login__demo-role">{a.role}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="acr-login__demo-hint">
              Password for all: <code className="jpb-mono">{backend.demoAccounts[0]?.password}</code>
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
