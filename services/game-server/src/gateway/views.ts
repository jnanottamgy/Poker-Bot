import type { AdminTableView, PlayerId, PlayerTableView, SpectatorTableView, TableEvent } from '@jpb/shared-types';
import type { TableUpdateMessage } from '../runtime/contracts';

/**
 * PRIVACY RULES (the only place table data is projected per recipient):
 *
 * - A player receives PUBLIC events plus PRIVATE events whose `privateTo` is
 *   that player, and a view whose `you` comes from `privateByPlayer[self]`.
 * - Spectators and displays receive PUBLIC events and the public view only.
 * - Admins receive the admin view with `holeCards: null` and PUBLIC events,
 *   unless the socket performed an audited reveal for that table while
 *   holding VIEW_HOLE_CARDS; then private events and `holeCardsBySeat` too.
 *
 * Defence in depth: a HOLE_CARDS_DEALT event is treated as private to its own
 * player even if the runtime mislabelled it PUBLIC, and a PRIVATE event with
 * no `privateTo` reaches no player at all.
 */
export function isEventVisibleTo(e: TableEvent, playerId: PlayerId | null): boolean {
  if (e.event.kind === 'HOLE_CARDS_DEALT') return playerId !== null && e.privateTo === playerId && e.event.playerId === playerId;
  if (e.visibility === 'PUBLIC') return true;
  return playerId !== null && e.privateTo === playerId;
}

export function spectatorViewOf(msg: TableUpdateMessage): SpectatorTableView {
  return { ...msg.publicView, audience: 'SPECTATOR' };
}

/** A player not seated at this table (e.g. just moved away) sees the public projection. */
export function playerViewOf(msg: TableUpdateMessage, playerId: PlayerId): PlayerTableView | SpectatorTableView {
  const mine = Object.hasOwn(msg.privateByPlayer, playerId) ? msg.privateByPlayer[playerId] : undefined;
  if (!mine) return spectatorViewOf(msg);
  return {
    ...msg.publicView,
    audience: 'PLAYER',
    you: { playerId, seat: mine.seat, holeCards: mine.holeCards, legal: mine.legal },
  };
}

export function adminViewOf(msg: TableUpdateMessage, revealed: boolean): AdminTableView {
  return { ...msg.adminView, audience: 'ADMIN', holeCards: revealed ? { ...msg.holeCardsBySeat } : null };
}

/**
 * Builds `table_update` frames for one TableUpdateMessage. The shared parts
 * (header, each event's JSON, the public view, the two admin variants) are
 * serialized at most once and the resulting strings are reused for every
 * recipient of the same audience; per player only the event selection and
 * the small `you` object are serialized.
 */
export class TableUpdateFrames {
  private readonly head: string;
  private readonly eventJson: Array<string | undefined> = [];
  private publicViewInner: string | undefined;
  private spectator: string | undefined;
  private readonly admin: [string | undefined, string | undefined] = [undefined, undefined];

  constructor(
    readonly msg: TableUpdateMessage,
    st: number,
  ) {
    this.head =
      `{"t":"table_update","st":${JSON.stringify(st)},"tableId":${JSON.stringify(msg.tableId)}` +
      `,"fromSeq":${JSON.stringify(msg.fromSeq)},"toSeq":${JSON.stringify(msg.toSeq)},"version":${JSON.stringify(msg.version)},"events":`;
  }

  spectatorFrame(): string {
    if (this.spectator === undefined) {
      this.spectator = `${this.head}${this.events(null, false)},"view":${this.publicView('"SPECTATOR"')}}`;
    }
    return this.spectator;
  }

  adminFrame(revealed: boolean): string {
    const i = revealed ? 1 : 0;
    let f = this.admin[i];
    if (f === undefined) {
      f = `${this.head}${this.events(null, revealed)},"view":${JSON.stringify(adminViewOf(this.msg, revealed))}}`;
      this.admin[i] = f;
    }
    return f;
  }

  playerFrame(playerId: PlayerId): string {
    const mine = Object.hasOwn(this.msg.privateByPlayer, playerId) ? this.msg.privateByPlayer[playerId] : undefined;
    const view = mine
      ? this.publicView('"PLAYER"', `,"you":${JSON.stringify({ playerId, seat: mine.seat, holeCards: mine.holeCards, legal: mine.legal })}`)
      : this.publicView('"SPECTATOR"');
    return `${this.head}${this.events(playerId, false)},"view":${view}}`;
  }

  private events(playerId: PlayerId | null, all: boolean): string {
    const parts: string[] = [];
    this.msg.events.forEach((e, i) => {
      if (!all && !isEventVisibleTo(e, playerId)) return;
      let json = this.eventJson[i];
      if (json === undefined) {
        json = JSON.stringify(e);
        this.eventJson[i] = json;
      }
      parts.push(json);
    });
    return `[${parts.join(',')}]`;
  }

  /** The public view with a given audience (and optional extra members), from one cached serialization. */
  private publicView(audienceJson: string, extra = ''): string {
    if (this.publicViewInner === undefined) {
      const { audience: _ignored, ...rest } = this.msg.publicView;
      this.publicViewInner = JSON.stringify(rest).slice(0, -1);
    }
    const sep = this.publicViewInner.length > 1 ? ',' : '';
    return `${this.publicViewInner}${sep}"audience":${audienceJson}${extra}}`;
  }
}
