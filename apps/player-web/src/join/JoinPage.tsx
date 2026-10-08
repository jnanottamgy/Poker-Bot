import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { RegisterResponse } from '@jpb/shared-types';
import { Button, ErrorState, Skeleton } from '@jpb/ui';
import { useBackend } from '../app/backend';
import { BrandMark } from '../components/BrandMark';
import { useAsync } from '../hooks/useAsync';
import { rememberJoinCode } from '../settings/settings';
import { JoinLanding } from './JoinLanding';
import { RegistrationForm } from './RegistrationForm';
import { RejoinCodeCard } from './RejoinCodeCard';
import { RejoinForm } from './RejoinForm';
import { parseRejoinFragment } from './rejoinFragment';
import type { RejoinCredentials } from './rejoinFragment';

type Step = 'landing' | 'register' | 'rejoin' | 'code';

/** Reads `#rejoin=…` once and immediately removes it from the address bar and history. */
function useRejoinFragment(): RejoinCredentials | null {
  const [creds] = useState(() => (typeof window === 'undefined' ? null : parseRejoinFragment(window.location.hash)));
  useEffect(() => {
    if (window.location.hash.includes('rejoin=')) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }, []);
  return creds;
}

export function JoinPage() {
  const { joinCode: raw = '' } = useParams();
  const joinCode = raw.toUpperCase();
  const navigate = useNavigate();
  const { api } = useBackend();
  const fragment = useRejoinFragment();
  const [step, setStep] = useState<Step>(fragment ? 'rejoin' : 'landing');
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const info = useAsync((signal) => api.joinInfo(joinCode, signal), [joinCode]);

  useEffect(() => {
    if (info.data) rememberJoinCode(info.data.joinCode);
  }, [info.data]);

  const goPlay = () => navigate('/play', { replace: true });

  let body;
  if (info.loading && !info.data) {
    body = (
      <div className="pw-hero" aria-busy="true">
        <Skeleton width="60%" />
        <Skeleton height={44} />
        <Skeleton height={140} shape="block" />
        <Skeleton height={64} shape="block" />
      </div>
    );
  } else if (info.error || !info.data) {
    body = <ErrorState title={info.error?.title ?? 'Something went wrong'} description={info.error?.message} onRetry={info.reload} />;
  } else if (step === 'register') {
    body = (
      <RegistrationForm
        info={info.data}
        onCancel={() => setStep('landing')}
        onRegistered={(res) => {
          setResult(res);
          setStep('code');
        }}
      />
    );
  } else if (step === 'code' && result) {
    body = <RejoinCodeCard result={result} onContinue={goPlay} />;
  } else if (step === 'rejoin') {
    body = (
      <section className="pw-rejoin" aria-labelledby="rejoin-title">
        <p className="pw-eyebrow">{info.data.name}</p>
        <h1 id="rejoin-title" className="pw-form__title">
          Rejoin tournament
        </h1>
        <p className="pw-muted">Use the player ID and rejoin code you saved when you registered. Your seat and chips are kept on the server.</p>
        <RejoinForm joinCode={joinCode} initial={fragment} onRejoined={goPlay} />
        <Button variant="ghost" size="lg" block onClick={() => setStep('landing')}>
          Back
        </Button>
      </section>
    );
  } else {
    body = <JoinLanding info={info.data} onJoin={() => setStep('register')} onRejoin={() => setStep('rejoin')} />;
  }

  return (
    <div className="pw-join">
      <header className="pw-join__top">
        <BrandMark />
      </header>
      <main className="pw-join__main">{body}</main>
      <footer className="pw-join__foot">Server-authoritative and auditable. No AI in game logic.</footer>
    </div>
  );
}
