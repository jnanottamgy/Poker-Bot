import { useMemo } from 'react';
import type { PlayerDetailDto, TournamentCounters } from '@jpb/shared-types';
import { formatChips, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { RejoinCodeResponse } from '../../api/types';
import { useDangerousAction } from '../../danger/DangerProvider';
import { PLAYER_STATUS_META, formatBB, seatText, signedChips } from '../players/model';

export interface MoveTarget {
  toTableId: string;
  toTableNumber: number;
  /** 0-based seat, or null = the seat-fairness formula picks. */
  toSeat: number | null;
}

/** Longest private notice the server accepts (z.string().max(280)). */
export const NOTICE_MAX = 280;

/**
 * Every per-player control of §2.8 with its danger level (API.md), copy,
 * consequences and before → after preview. Each resolves to the API result,
 * or undefined when cancelled / failed (failures are shown in the dialog).
 */
export function usePlayerControls(p: PlayerDetailDto | undefined, tournamentId: string, ctx: { bigBlind: number | null; counters: TournamentCounters | null; liveStack: number | null }) {
  const api = useApi();
  const danger = useDangerousAction();
  return useMemo(() => {
    if (!p) return null;
    const id = p.playerId;
    const name = p.displayName;
    const stack = ctx.liveStack ?? p.stack;
    const invalidate = [qk.player(id), qk.tournament(tournamentId)];
    const where = seatText(p.tableNumber, p.seat);
    const activeSessions = p.sessions.filter((s) => s.revokedAt === null && s.expiresAt > Date.now()).length;
    const statusLabel = PLAYER_STATUS_META[p.status].label;
    const chipTotal = ctx.counters?.totalChips ?? null;

    return {
      move: (t: MoveTarget) =>
        danger({
          level: 1,
          endpoint: 'playerMove',
          title: `Move ${name} to table ${t.toTableNumber}`,
          summary: 'The move is applied when the player’s current hand ends — never in the middle of a hand.',
          consequences: [
            `${where} → table ${t.toTableNumber}, ${t.toSeat === null ? 'best seat by the seat-fairness formula' : `seat ${t.toSeat + 1}`}`,
            `The stack moves with the player: ${formatChips(stack)} chips`,
            'The player sees a table-move card with the new table and seat',
            'The move is audit-logged with your reason and appears in the live feed',
          ],
          reason: 'required',
          confirmLabel: 'Move player',
          run: ({ reason }) => api.players.move(id, { toTableId: t.toTableId, ...(t.toSeat !== null ? { toSeat: t.toSeat } : {}), reason }),
          success: `Move requested — ${name} moves to table ${t.toTableNumber} after the current hand`,
          invalidate,
        }),

      suspend: () =>
        danger({
          level: 1,
          endpoint: 'playerSuspend',
          title: `Suspend ${name}`,
          summary: 'The player sits out: they stay seated and keep their chips, but cannot act.',
          consequences: [
            'Blinds and antes are still posted from their stack',
            'Every decision is checked or folded automatically, immediately',
            'The player sees that the tournament director suspended them',
            'Restoring them later needs a double confirmation (RESTORE)',
          ],
          reason: 'optional',
          confirmLabel: 'Suspend player',
          tone: 'danger',
          run: ({ reason }) => api.players.suspend(id, reason ? { reason } : {}),
          success: `${name} is suspended (sitting out)`,
          invalidate,
        }),

      restore: () =>
        danger({
          level: 2,
          endpoint: 'playerRestore',
          word: 'RESTORE',
          title: `Restore ${name}`,
          summary: 'The player is back in play from their next decision.',
          consequences: ['Their own actions are accepted again, with the normal action timer', 'Automatic check/fold stops', 'A RESTORE_PLAYER audit entry records your name and reason'],
          preview: [
            { label: 'Status', before: statusLabel, after: p.tableId ? 'Seated' : 'In transit' },
            { label: 'Decisions', before: 'Auto check / fold', after: 'Player acts' },
            { label: 'Stack', before: `${formatChips(stack)} chips`, after: `${formatChips(stack)} chips (unchanged)` },
          ],
          confirmLabel: 'Restore player',
          run: (d) => api.players.restore(id, d),
          success: `${name} is restored`,
          invalidate,
        }),

      disqualify: () => {
        const seated = p.tableId !== null;
        return danger({
          level: 2,
          endpoint: 'playerDisqualify',
          word: 'DISQUALIFY',
          title: `Disqualify ${name}`,
          summary: 'Removes the player from the tournament permanently. This cannot be undone.',
          consequences: seated
            ? [
                `Removed from ${where} when the hand in progress ends`,
                `Their ${formatChips(stack)} chips leave play — the tournament chip total drops by that amount`,
                'No finishing position and no prize',
                'They cannot rejoin or re-enter; their devices are told they were disqualified',
                'A DISQUALIFY_PLAYER audit entry records your name, the reason and the stack',
              ]
            : ['The registration is withdrawn and marked disqualified', 'They are not seated when the tournament starts', 'A DISQUALIFY_PLAYER audit entry records your name and reason'],
          preview: [
            { label: 'Status', before: statusLabel, after: 'Disqualified' },
            ...(seated
              ? [
                  { label: 'Seat', before: where, after: 'none' },
                  { label: 'Stack', before: `${formatChips(stack)} chips`, after: '0 (removed from play)' },
                  ...(chipTotal !== null ? [{ label: 'Chips in play', before: formatChips(chipTotal), after: formatChips(chipTotal - stack) }] : []),
                ]
              : []),
          ],
          confirmLabel: 'Disqualify permanently',
          run: (d) => api.players.disqualify(id, d),
          success: `${name} is disqualified`,
          invalidate,
        });
      },

      adjustStack: (newStack: number) => {
        const delta = newStack - stack;
        return danger({
          level: 2,
          endpoint: 'playerAdjustStack',
          word: 'ADJUST',
          title: `Adjust ${name}’s stack`,
          summary: 'Only to correct a verified error (dealer miscount, a disputed pot reviewed on camera).',
          consequences: [
            'Applied between hands — the table refuses a change in the middle of a hand',
            `The tournament chip total changes by ${signedChips(delta)} (recorded as an admin adjustment in chip conservation)`,
            'An ADJUST_STACK audit entry keeps the before and after stacks, your name and reason',
          ],
          preview: [
            { label: 'Stack', before: `${formatChips(stack)} chips`, after: `${formatChips(newStack)} chips` },
            { label: 'Big blinds', before: formatBB(stack, ctx.bigBlind), after: formatBB(newStack, ctx.bigBlind) },
            { label: 'Change', before: '—', after: `${signedChips(delta)} chips` },
            ...(chipTotal !== null ? [{ label: 'Chips in play', before: formatChips(chipTotal), after: formatChips(chipTotal + delta) }] : []),
          ],
          confirmLabel: 'Adjust stack',
          run: (d) => api.players.adjustStack(id, { ...d, newStack }),
          success: `Stack set to ${formatChips(newStack)} chips`,
          invalidate,
        });
      },

      revokeSessions: () =>
        danger({
          level: 2,
          endpoint: 'playerRevokeSessions',
          word: 'REVOKE',
          title: `Sign ${name} out everywhere`,
          summary: 'Revokes every session of the player — use when a device was lost, shared or stolen.',
          consequences: [
            'Every device of the player is signed out immediately',
            'To come back they need their rejoin code — issue a new one if it may be compromised',
            'While nobody is connected, their decisions time out (check / fold)',
            'A REVOKE_SESSIONS audit entry records your name and reason',
          ],
          preview: [
            { label: 'Active sessions', before: formatCount(activeSessions), after: '0' },
            { label: 'Connection', before: p.connected ? 'Online' : 'Offline', after: 'Offline until they rejoin' },
          ],
          confirmLabel: 'Revoke all sessions',
          run: (d) => api.players.revokeSessions(id, d),
          success: `All sessions of ${name} were revoked`,
          invalidate,
        }),

      newRejoinCode: (onIssued: (r: RejoinCodeResponse) => void) =>
        danger<RejoinCodeResponse>({
          level: 1,
          endpoint: 'playerRejoinCode',
          title: `Issue a new rejoin code for ${name}`,
          summary: 'For a player who lost their code or changes device. The code is shown once.',
          consequences: [
            'The previous rejoin code stops working immediately',
            'Devices already signed in stay signed in (revoke sessions separately if a device was lost)',
            'Print the card or show it to the player — the server only keeps a hash of the code',
          ],
          reason: 'optional',
          confirmLabel: 'Issue new code',
          run: ({ reason }) => api.players.newRejoinCode(id, reason ? { reason } : {}),
          success: 'New rejoin code issued',
          invalidate: [qk.player(id)],
          onSuccess: onIssued,
        }),

      notice: (text: string) =>
        danger({
          level: 1,
          endpoint: 'playerNotice',
          title: `Send a private notice to ${name}`,
          summary: `“${text}”`,
          consequences: [`Only ${name} sees this message, on every device they are signed in on`, 'The text is recorded in the audit log'],
          confirmLabel: 'Send notice',
          run: () => api.players.notice(id, { text }),
          success: `Notice sent to ${name}`,
        }),
    };
  }, [api, danger, p, tournamentId, ctx.bigBlind, ctx.counters, ctx.liveStack]);
}

export type PlayerControls = NonNullable<ReturnType<typeof usePlayerControls>>;
