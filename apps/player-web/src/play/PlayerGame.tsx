import { useEffect, useRef, useState } from 'react';
import { useGameState } from '@jpb/client-sdk/react';
import type { PlayerMeDto, PlayerTableView } from '@jpb/shared-types';
import { Modal, Tabs } from '@jpb/ui';
import { useBackend } from '../app/backend';
import { useAsync } from '../hooks/useAsync';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { useSettings } from '../settings/SettingsContext';
import { SettingsSheet } from '../settings/SettingsSheet';
import { ConnectionLayer } from './connection/ConnectionLayer';
import { isLive } from './connection/connectionState';
import { deriveScreen } from './deriveScreen';
import type { ScreenKind } from './deriveScreen';
import { GameFrame } from './GameFrame';
import { GameHeader } from './GameHeader';
import { TournamentInfo } from './info/TournamentInfo';
import { EventBanners } from './notices/EventBanners';
import { FinalTableCinematic } from './notices/FinalTableCinematic';
import { NoticeLayer } from './notices/NoticeLayer';
import { StaffMessages } from './notices/StaffMessages';
import { reentryOffer } from './reentry';
import { BreakScreen } from './screens/BreakScreen';
import { AnotherDeviceScreen, SessionReplacedScreen } from './screens/DeviceScreens';
import { LobbyScreen } from './screens/LobbyScreen';
import { CompletedScreen, EliminatedScreen } from './screens/OutcomeScreens';
import { PausedScreen } from './screens/PausedScreen';
import { ReentryDialog } from './screens/ReentryDialog';
import { SessionExpiredScreen } from './screens/SessionExpiredScreen';
import { ConnectingScreen, MovingScreen, PendingScreen, RemovedScreen, SuspendedScreen } from './screens/StateScreens';
import { SpectatorView } from './spectator/SpectatorView';
import { DesktopConsole } from './table/DesktopConsole';
import { HandLog } from './table/HandLog';
import { LiveTable } from './table/LiveTable';
import { TableActions } from './table/TableActions';
import { heroTurn } from './table/tableModel';
import { useJpbClient } from './usePlayerClient';

type Sheet = 'log' | 'info' | null;

const CENTERED: ReadonlySet<ScreenKind> = new Set(['session-expired', 'replaced', 'another-device', 'connecting', 'pending', 'suspended', 'removed', 'eliminated', 'completed', 'break', 'paused', 'lobby', 'moving']);

/** The signed-in player's live experience: one PLAYER connection, every screen derived from server state. */
export function PlayerGame({ me, onRejoined }: { me: PlayerMeDto; onRejoined: () => void }) {
  const { api } = useBackend();
  const client = useJpbClient(me.tournamentId, 'PLAYER');
  const state = useGameState(client, (s) => s);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const { setSettingsOpen } = useSettings();
  const [spectate, setSpectate] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sideTab, setSideTab] = useState<'log' | 'info'>('log');
  const [infoKey, setInfoKey] = useState(0);
  const [reentering, setReentering] = useState(false);
  const wantTakeover = useRef(false);
  const joinInfo = useAsync((signal) => api.joinInfo(me.joinCode, signal), [me.joinCode]);

  const screen = deriveScreen(state, { spectate });
  const live = isLive(state.connection, state.synced);
  const self = state.self;
  const tournament = state.tournament;
  const currency = joinInfo.data?.prizes.currency ?? 'INR';
  const view = state.table && state.table.audience === 'PLAYER' ? (state.table as PlayerTableView) : null;
  // Full-screen notices wait while the hero has a decision on the clock.
  const deciding = screen === 'table' && live && heroTurn(view) !== null;
  const offer = reentryOffer(self, tournament, joinInfo.data);
  const onReenter = offer ? () => setReentering(true) : undefined;

  // A rejected session stops the reconnect loop; the screen offers rejoin.
  useEffect(() => {
    if (screen === 'session-expired') client.close();
  }, [screen, client]);

  // "Use this device" after session_replaced: reconnect, then take over when the server asks.
  useEffect(() => {
    if (state.anotherDevice && wantTakeover.current) {
      wantTakeover.current = false;
      client.takeover();
    }
  }, [state.anotherDevice, client]);

  const openInfo = () => {
    setInfoKey((k) => k + 1);
    if (desktop) setSideTab('info');
    else setSheet('info');
  };

  const breakMessage = (() => {
    for (let i = state.tournamentEvents.length - 1; i >= 0; i--) {
      const e = state.tournamentEvents[i]?.event;
      if (e?.kind === 'BREAK_STARTED') return e.message;
    }
    return null;
  })();

  const content = (() => {
    switch (screen) {
      case 'session-expired':
        return <SessionExpiredScreen joinCode={me.joinCode} onRejoined={onRejoined} />;
      case 'replaced':
        return (
          <SessionReplacedScreen
            onUseThisDevice={() => {
              wantTakeover.current = true;
              client.connect();
            }}
          />
        );
      case 'another-device':
        return <AnotherDeviceScreen onTakeover={() => client.takeover()} />;
      case 'connecting':
        return <ConnectingScreen />;
      case 'pending':
        return <PendingScreen publicId={self?.publicId ?? me.publicId} />;
      case 'suspended':
        return <SuspendedScreen />;
      case 'removed':
        return <RemovedScreen />;
      case 'moving':
        return <MovingScreen />;
      case 'lobby':
        return self && tournament ? (
          <LobbyScreen
            self={self}
            tournament={tournament}
            serverOffsetMs={state.serverOffsetMs}
            startTime={joinInfo.data?.startTime ?? null}
            startingStack={joinInfo.data?.startingStack ?? null}
            onSettings={() => setSettingsOpen(true)}
          />
        ) : null;
      case 'break':
        return self && tournament ? <BreakScreen self={self} tournament={tournament} serverOffsetMs={state.serverOffsetMs} message={breakMessage} /> : null;
      case 'paused':
        return self && tournament ? <PausedScreen self={self} tournament={tournament} frozen={!!view?.frozen} /> : null;
      case 'eliminated':
        return self && tournament ? <EliminatedScreen self={self} tournament={tournament} currency={currency} onWatch={() => setSpectate(true)} onInfo={openInfo} onReenter={onReenter} /> : null;
      case 'spectating':
        return <SpectatorView tournamentId={me.tournamentId} wide={desktop} onBack={() => setSpectate(false)} />;
      case 'completed':
        return self ? <CompletedScreen self={self} events={state.tournamentEvents} currency={currency} onInfo={openInfo} /> : null;
      case 'table':
        return view ? <LiveTable view={view} events={state.tableEvents} serverOffsetMs={state.serverOffsetMs} wide={desktop} finalTable={tournament?.status === 'FINAL_TABLE'} stale={!live} /> : null;
    }
  })();

  const actions =
    screen === 'table' && view ? (
      desktop ? (
        <DesktopConsole client={client} view={view} live={live} />
      ) : (
        <TableActions client={client} view={view} live={live} />
      )
    ) : null;

  const deviceScreen = screen === 'replaced' || screen === 'another-device' || screen === 'session-expired';
  const banner = deviceScreen ? null : (
    <>
      <ConnectionLayer client={client} />
      <StaffMessages client={client} />
      <EventBanners client={client} />
    </>
  );

  const info = (
    <TournamentInfo joinCode={me.joinCode} tournament={tournament} self={self} joinInfo={joinInfo.data} serverOffsetMs={state.serverOffsetMs} refreshKey={infoKey} />
  );
  const log = <HandLog events={state.tableEvents} view={view} />;

  const aside = desktop ? (
    <Tabs
      label="Side panel"
      value={sideTab}
      onChange={(id) => {
        if (id === 'info') setInfoKey((k) => k + 1);
        setSideTab(id as 'log' | 'info');
      }}
      tabs={[
        { id: 'log', label: 'Hand log' },
        { id: 'info', label: 'Tournament' },
      ]}
    >
      {sideTab === 'log' ? log : info}
    </Tabs>
  ) : null;

  return (
    <>
      <GameFrame
        desktop={desktop}
        centered={CENTERED.has(screen)}
        header={
          <GameHeader
            name={me.tournamentName}
            tournament={tournament}
            serverOffsetMs={state.serverOffsetMs}
            onLog={!desktop && screen === 'table' ? () => setSheet('log') : undefined}
            onInfo={!desktop ? openInfo : undefined}
            onSettings={() => setSettingsOpen(true)}
          />
        }
        banner={banner}
        actions={actions}
        aside={aside}
      >
        {content}
      </GameFrame>
      {!deviceScreen && <NoticeLayer client={client} currency={currency} onWatch={() => setSpectate(true)} onInfo={openInfo} onReenter={onReenter} deferred={deciding} />}
      {!deviceScreen && <FinalTableCinematic client={client} deferred={deciding} />}
      <ReentryDialog
        open={reentering && offer !== null}
        offer={offer}
        startingStack={joinInfo.data?.startingStack ?? null}
        onClose={() => setReentering(false)}
        onReentered={() => {
          setReentering(false);
          setSpectate(false);
          // The new entry arrives as self_update; ask for a snapshot so the screen follows at once.
          client.requestSnapshot();
        }}
      />
      {!desktop && (
        <Modal open={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'log' ? 'Hand log' : 'Tournament'} placement="right" size="md" className="pw-sheet">
          {sheet === 'log' ? log : sheet === 'info' ? info : null}
        </Modal>
      )}
      <SettingsSheet />
    </>
  );
}
