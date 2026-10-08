import { useEffect, useRef, useState } from 'react';
import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import { Button, Icon, formatCount } from '@jpb/ui';
import { Overlay } from '../../components/Overlay';
import { useSettings } from '../../settings/SettingsContext';

const SHOW_MS = 5_000;

/** Gold "THE FINAL TABLE" moment when the server forms the final table. Static under reduced motion. */
export function FinalTableCinematic({ client }: { client: JpbClient }) {
  const playing = useGameState(client, (s) => s.self?.status === 'SEATED' || s.self?.status === 'IN_TRANSIT');
  const events = useGameState(client, (s) => s.tournamentEvents);
  const seen = useRef(new Set<number>());
  const [players, setPlayers] = useState<number | null>(null);
  const { play } = useSettings();

  useEffect(() => {
    for (const e of events) {
      if (seen.current.has(e.seq)) continue;
      seen.current.add(e.seq);
      if (e.event.kind === 'FINAL_TABLE_FORMED') {
        setPlayers(e.event.players.length);
        play('final-table');
      }
    }
  }, [events, play]);

  useEffect(() => {
    if (players === null) return undefined;
    const id = setTimeout(() => setPlayers(null), SHOW_MS);
    return () => clearTimeout(id);
  }, [players]);

  if (players === null) return null;
  return (
    <Overlay label="The final table" tone="gold" className="pw-finale">
      <div className="pw-finale__card">
        <span className="pw-finale__icon" aria-hidden="true">
          <Icon name="crown" />
        </span>
        <p className="pw-finale__eyebrow">{playing ? 'You made it' : 'Tournament update'}</p>
        <h2 className="pw-finale__title">The Final Table</h2>
        <p className="pw-finale__detail">{formatCount(players)} players remain · every hand is on the big screen</p>
        <Button variant="gold" size="lg" onClick={() => setPlayers(null)}>
          {playing ? 'Take my seat' : 'Continue'}
        </Button>
      </div>
    </Overlay>
  );
}
