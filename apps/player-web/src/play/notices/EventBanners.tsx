import { useEffect, useRef, useState } from 'react';
import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import type { TournamentEventEnvelope } from '@jpb/shared-types';
import { Alert, IconButton, MilestoneBanner, formatChips, useToast } from '@jpb/ui';

interface Banner {
  seq: number;
  kind: 'milestone' | 'announcement' | 'info';
  title: string;
  detail?: string;
}

const VISIBLE_MS = 9_000;

/** Banner for tournament events worth interrupting for; null for the rest. */
export function bannerFor(e: TournamentEventEnvelope): Banner | null {
  const ev = e.event;
  switch (ev.kind) {
    case 'MILESTONE':
      return { seq: e.seq, kind: 'milestone', title: ev.text, detail: `${ev.playersRemaining.toLocaleString('en-US')} players remain` };
    case 'ANNOUNCEMENT':
      return { seq: e.seq, kind: 'announcement', title: ev.from === 'DIRECTOR' ? 'Tournament director' : 'Announcement', detail: ev.text };
    case 'HAND_FOR_HAND':
      return ev.enabled ? { seq: e.seq, kind: 'info', title: 'Hand-for-hand play', detail: 'Every table plays one hand at a time until the bubble bursts.' } : null;
    default:
      return null;
  }
}

/** Milestones (gold), announcements and blind changes — each shown once, then auto-hidden. */
export function EventBanners({ client }: { client: JpbClient }) {
  const events = useGameState(client, (s) => s.tournamentEvents);
  // Events already in the store when this mounts were shown before (or are stale): the
  // layer unmounts behind device screens, and remounting must not replay old banners.
  const seen = useRef<Set<number> | null>(null);
  seen.current ??= new Set(events.map((e) => e.seq));
  const [banner, setBanner] = useState<Banner | null>(null);
  const toast = useToast();

  useEffect(() => {
    for (const e of events) {
      if (seen.current?.has(e.seq)) continue;
      seen.current?.add(e.seq);
      const b = bannerFor(e);
      if (b) setBanner(b);
      // The first level (from null) is the start of play, not "blinds up".
      if (e.event.kind === 'BLIND_LEVEL_CHANGED' && e.event.from !== null) {
        const l = e.event.to;
        toast.push({ tone: 'info', title: `Blinds up · Level ${l.level}`, description: `${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}${l.ante ? ` · ante ${formatChips(l.ante)}` : ''} from your next hand` });
      }
    }
  }, [events, toast]);

  useEffect(() => {
    if (!banner) return undefined;
    const id = setTimeout(() => setBanner(null), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [banner]);

  if (!banner) return null;
  const close = <IconButton icon="x" label="Dismiss" size="sm" onClick={() => setBanner(null)} />;
  return (
    <div className="pw-banner" key={banner.seq}>
      {banner.kind === 'milestone' ? (
        <MilestoneBanner title={banner.title} detail={banner.detail} />
      ) : (
        <Alert severity="INFO" title={banner.title} onDismiss={() => setBanner(null)}>
          {banner.detail}
        </Alert>
      )}
      {banner.kind === 'milestone' && <span className="pw-banner__close">{close}</span>}
    </div>
  );
}
