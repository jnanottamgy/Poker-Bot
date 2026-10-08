import { useEffect, useState } from 'react';
import { Button, ErrorState } from '@jpb/ui';
import { useBackend } from '../app/backend';
import { useAsync } from '../hooks/useAsync';
import { lastJoinCode, rememberJoinCode } from '../settings/settings';
import { SettingsSheet } from '../settings/SettingsSheet';
import { PlayerGame } from './PlayerGame';
import { ConnectingScreen } from './screens/StateScreens';
import { SessionExpiredScreen } from './screens/SessionExpiredScreen';

/** /play — who am I (GET /api/player/me), then the live game. */
export function PlayPage() {
  const { api } = useBackend();
  const [session, setSession] = useState(0);
  const me = useAsync((signal) => api.me(signal), [session]);
  const renew = () => setSession((s) => s + 1);

  useEffect(() => {
    if (me.data) rememberJoinCode(me.data.joinCode);
  }, [me.data]);

  let body;
  if (me.data && !me.loading) {
    return <PlayerGame key={session} me={me.data} onRejoined={renew} />;
  } else if (me.error?.code === 'UNAUTHORIZED') {
    body = <SessionExpiredScreen joinCode={lastJoinCode()} onRejoined={renew} />;
  } else if (me.error) {
    body = (
      <div className="pw-center">
        <ErrorState title={me.error.title} description={me.error.message} onRetry={me.reload} />
        <Button variant="ghost" onClick={() => (window.location.href = '/')}>
          Home
        </Button>
      </div>
    );
  } else {
    body = <ConnectingScreen />;
  }
  return (
    <div className="pw-standalone">
      {body}
      <SettingsSheet />
    </div>
  );
}
