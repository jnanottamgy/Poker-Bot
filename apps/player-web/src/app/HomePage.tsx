import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Button, Spinner, TextField } from '@jpb/ui';
import { BrandMark } from '../components/BrandMark';
import { useAsync } from '../hooks/useAsync';
import { lastJoinCode } from '../settings/settings';
import { useBackend } from './backend';

const DEMO_LINKS: Array<{ label: string; href: string; detail: string }> = [
  { label: 'Join page', href: '/join/SPRING26', detail: 'Landing, registration, one-time rejoin code' },
  { label: 'Registration closed', href: '/join/SPRING26?join=closed', detail: 'Rejoin only' },
  { label: 'Full tournament', href: '/play?at=lobby', detail: 'Lobby → hands → move → break → elimination → spectating' },
  { label: 'Your turn now', href: '/play?at=table', detail: 'Straight to the table' },
  { label: 'Table move', href: '/play?at=move', detail: 'Balancing move notice' },
  { label: 'Break', href: '/play?at=break', detail: 'Break screen with countdown' },
  { label: 'Paused', href: '/play?at=paused', detail: 'Director pause' },
  { label: 'Elimination hand', href: '/play?at=elim', detail: 'Short stack facing a shove' },
  { label: 'Spectating', href: '/play?at=spectate', detail: 'Eliminated, watching the featured table' },
  { label: 'Champion', href: '/play?scenario=champion', detail: 'Final table you win' },
  { label: 'Reconnect', href: '/play?scenario=reconnect&down=8', detail: 'Network drop and recovery' },
  { label: 'Another device', href: '/play?scenario=another-device', detail: 'Take over the seat' },
  { label: 'Session replaced', href: '/play?scenario=replaced', detail: 'This tab loses control' },
  { label: 'Session expired', href: '/play?scenario=expired', detail: 'Rejoin with your code' },
  { label: 'Pending approval', href: '/play?scenario=pending', detail: 'Approved after a few seconds' },
];

/** "/" — players normally arrive by QR (/join/:code). A known session goes straight to its seat. */
export function HomePage() {
  const backend = useBackend();
  const navigate = useNavigate();
  const [code, setCode] = useState(lastJoinCode() ?? '');
  const me = useAsync((signal) => (backend.mode === 'live' ? backend.api.me(signal) : Promise.reject(new Error('demo'))), []);

  if (backend.mode === 'live' && me.loading) {
    return (
      <div className="pw-center">
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }
  if (backend.mode === 'live' && me.data) return <Navigate to="/play" replace />;

  const go = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) navigate(`/join/${encodeURIComponent(c)}`);
  };

  return (
    <div className="pw-join">
      <header className="pw-join__top">
        <BrandMark />
      </header>
      <main className="pw-join__main">
        <section className="pw-hero" aria-labelledby="home-title">
          <p className="pw-eyebrow">Tournament poker, run by the house</p>
          <h1 id="home-title" className="pw-hero__title">
            Scan the QR code at the venue to join
          </h1>
          <p className="pw-muted">Or enter the tournament code printed on the poster.</p>
          <form className="pw-form" onSubmit={go}>
            <TextField label="Tournament code" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="SPRING26" />
            <Button type="submit" variant="primary" size="xl" block disabled={!code.trim()}>
              Continue
            </Button>
          </form>
        </section>
        {backend.mode === 'mock' && backend.demo && (
          <section className="pw-demo" aria-labelledby="demo-title">
            <p className="pw-eyebrow">Mock backend · scenario “{backend.demo.scenario}”</p>
            <h2 id="demo-title" className="pw-demo__title">
              Demo scenarios
            </h2>
            <ul className="pw-demo__list">
              {DEMO_LINKS.map((d) => (
                <li key={d.href}>
                  {/* Full page loads: the mock backend reads the scenario at boot. */}
                  <a href={d.href} className="pw-demo__link">
                    <span className="pw-demo__label">{d.label}</span>
                    <span className="pw-demo__detail">{d.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="pw-hint">
              Try the access-code variant with <Link to="/join/SPRING26">?join=access</Link> (code SPADES).
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
