import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { TournamentEvent } from '@jpb/shared-types';
import { announcedText } from '../src/sections/broadcast/Activity';
import { ANNOUNCE_MAX, EMPTY_CONTEXT, TEMPLATES, blindsText, commentaryFor, displayUrl, fillTemplate, sceneBlocked } from '../src/sections/broadcast/templates';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

async function openBroadcast(tid = 'trn_spring', as = 'director') {
  const r = renderControlRoom(`/t/${tid}/broadcast`, { as });
  await screen.findByRole('heading', { name: /^Broadcast & announcements$/, level: 2 }, TIMEOUT);
  await screen.findByRole('textbox', { name: 'Message' }, TIMEOUT);
  return r;
}

describe('broadcast templates (deterministic, no AI)', () => {
  const level = { level: 9, smallBlind: 750, bigBlind: 1_500, ante: 1_500, durationSeconds: 900 };

  it('fills named placeholders from server data and reports what is missing', () => {
    const ctx = { ...EMPTY_CONTEXT, tournament: 'Spring Showdown', level, remaining: 1_204, paidPlaces: 240 };
    expect(fillTemplate('Level {level} is under way: blinds {blinds}.', ctx)).toEqual({ text: 'Level 9 is under way: blinds 750/1,500 + 1,500 ante.', missing: [] });
    expect(fillTemplate('Chip leader: {leader} with {leaderStack} chips.', ctx)).toEqual({ text: 'Chip leader: {leader} with {leaderStack} chips.', missing: ['leader', 'leaderStack'] });
    expect(fillTemplate('{remaining} players, {bubbleToGo} to the money', ctx).text).toBe('1,204 players, 964 to the money');
    expect(fillTemplate('{unknown}', ctx).missing).toEqual(['unknown']);
    expect(blindsText({ ...level, ante: 0 })).toBe('750/1,500');
    // Every template fits the server limit once filled with long realistic values.
    const long = { ...ctx, leader: { name: 'A'.repeat(40), stack: 123_456_789 }, winner: 'B'.repeat(40), player: 'C'.repeat(40), table: 125_000, averageStack: 1, averageBB: '1 BB', breakMinutes: 15, nextLevel: level, registered: 1_000_000, tables: 125_000 };
    for (const t of TEMPLATES) expect(fillTemplate(t.text, long).text.length).toBeLessThanOrEqual(ANNOUNCE_MAX);
  });

  it('turns one live event into one fixed sentence (same event → same text)', () => {
    const elim: TournamentEvent = {
      kind: 'PLAYER_ELIMINATED',
      displayName: 'Ana Costa',
      playersRemaining: 41,
      record: { playerId: 'p', entryId: 'e', finishPosition: 42, tiedCount: 1, eliminatedAt: 1, handId: 'h', handNumber: 3, tableId: 't', startingStackOfHand: 100, batchId: 'b' },
    };
    expect(commentaryFor(elim, null)?.text).toBe('Ana Costa has been eliminated in 42nd. 41 players remain.');
    expect(commentaryFor(elim, null)).toEqual(commentaryFor(elim, null));
    expect(commentaryFor({ kind: 'FINAL_TABLE_FORMED', tableId: 't', players: Array.from({ length: 9 }, (_, i) => ({ playerId: `p${i}`, displayName: 'x', seat: i, stack: 1 })) }, null)?.text).toBe('Final table reached: 9 players remain.');
    expect(commentaryFor({ kind: 'TOURNAMENT_COMPLETED', winnerId: 'p', winnerName: 'Lena', completedAt: 1 }, 'Spring')?.text).toBe('Lena wins Spring!');
    expect(commentaryFor({ kind: 'COUNTERS', counters: { registered: 1, active: 1, eliminated: 0, inTransit: 0, tables: 1, handsCompleted: 0, totalChips: 1, largestPot: 0 } }, null)).toBeNull();
  });

  it('reads the announced text from both audit shapes (notice vs director input)', () => {
    expect(announcedText({ text: 'To table 12', scope: 'TABLE', recipients: 8 })).toBe('To table 12');
    expect(announcedText({ input: { type: 'ANNOUNCE', text: 'To everyone' } })).toBe('To everyone');
    expect(announcedText(null)).toBeNull();
  });

  it('builds the display URL and blocks the champion scene until there is one', () => {
    expect(displayUrl('https://poker.example/', 'trn spring')).toBe('https://poker.example/display/?t=trn%20spring');
    expect(sceneBlocked('CHAMPION', 'RUNNING')).toBe('No champion yet');
    expect(sceneBlocked('CHAMPION', 'COMPLETED')).toBeNull();
    expect(sceneBlocked('LEADERBOARD', 'RUNNING')).toBeNull();
  });
});

describe('Broadcast & announcements (§2.14)', { timeout: 20_000 }, () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a free-text announcement to everyone behind one confirmation, recorded in the audit log', async () => {
    const { mock } = await openBroadcast();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Final table starts at the main stage in 10 minutes.' } });
    expect(screen.getByText('51 / 280')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send to everyone' }, TIMEOUT);
    expect(within(dialog).getByText(/Every player \(/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(mock.server.world.audit.some((e) => e.action === 'ANNOUNCE' && (e.afterState as { text?: string } | null)?.text === 'Final table starts at the main stage in 10 minutes.')).toBe(true), TIMEOUT);
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('');
    // The announcement log (audit) lists it with its sender.
    const log = screen.getByRole('heading', { name: /Announcement log/ }).closest('section')!;
    expect(await within(log).findByText('Final table starts at the main stage in 10 minutes.', undefined, TIMEOUT)).toBeTruthy();
  });

  it('validates: empty message, 280 characters, and a target for one player', async () => {
    const { mock } = await openBroadcast();
    const announce = vi.spyOn(mock.backend.api.broadcast, 'announce');
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    expect(await screen.findByText('Write the announcement or pick a template.', undefined, TIMEOUT)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).maxLength).toBe(ANNOUNCE_MAX);

    fireEvent.click(screen.getByRole('radio', { name: 'One player' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Please come to the desk.' } });
    expect(screen.getByText('Choose the player.')).toBeTruthy();

    const target = mock.server.tournament('trn_spring').players.find((p) => p.status === 'SEATED')!;
    const combo = screen.getByRole('combobox', { name: 'Player' });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: target.publicId } });
    const option = await screen.findByRole('option', { name: new RegExp(target.displayName) }, TIMEOUT);
    fireEvent.click(option);
    expect(screen.getAllByRole('group', { name: 'Player' }).some((g) => g.textContent?.includes(target.publicId))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    const dialog = await screen.findByRole('dialog', { name: `Send to ${target.displayName} (${target.publicId})` }, TIMEOUT);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('trn_spring', { text: 'Please come to the desk.', scope: 'PLAYER', targetId: target.playerId }), TIMEOUT);
  });

  it('fills a template with live data', async () => {
    const { mock } = await openBroadcast();
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: 'remain' } });
    const text = (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value;
    const t = mock.server.tournament('trn_spring');
    expect(text).toMatch(/^[\d,]+ players remain\. Average stack [\d,]+ \([\d.]+ BB\)\.$/);
    expect(text).not.toContain('{');
    expect(t.name).toBeTruthy();
  });

  it('controls the big screen: scene + featured table, applied immediately (level 0)', async () => {
    const { mock } = await openBroadcast();
    expect((screen.getByRole('radio', { name: /Champion/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/\/display\/\?t=trn_spring&code=[A-Z0-9]+$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Leaderboard/ }));
    const table = mock.server.tournament('trn_spring').tables.find((x) => x.status !== 'CLOSED' && x.seats.some((s) => s !== null))!;
    const combo = screen.getByRole('combobox', { name: 'Featured table' });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: String(table.tableNumber) } });
    await screen.findByRole('option', { name: new RegExp(`^Table ${table.tableNumber},`) }, TIMEOUT);
    // Enter picks the exact table number.
    fireEvent.keyDown(combo, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to big screen' }));
    await waitFor(() => expect(mock.server.tournament('trn_spring').display).toEqual({ scene: 'LEADERBOARD', featuredTableId: table.tableId }), TIMEOUT);
    expect(await screen.findByText(/On screen:/, undefined, TIMEOUT)).toBeTruthy();
  });

  it('shows a milestone splash: big-screen announcement + Announcement scene', async () => {
    const { mock } = await openBroadcast();
    fireEvent.click(screen.getByRole('button', { name: /^Players remain/ }));
    const dialog = await screen.findByRole('dialog', { name: /Splash “Players remain” on the big screen/ }, TIMEOUT);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show splash' }));
    await waitFor(() => expect(mock.server.tournament('trn_spring').display.scene).toBe('ANNOUNCEMENT'), TIMEOUT);
    expect(mock.server.world.audit.some((e) => e.action === 'ANNOUNCE' && e.target === 'scope:DISPLAY')).toBe(true);
  });

  it('never announces twice when only the splash scene change failed and is retried', async () => {
    const { mock } = await openBroadcast();
    const announce = vi.spyOn(mock.backend.api.broadcast, 'announce');
    const display = vi.spyOn(mock.backend.api.broadcast, 'display').mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: /^Players remain/ }));
    const dialog = await screen.findByRole('dialog', { name: /Splash “Players remain”/ }, TIMEOUT);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show splash' }));
    expect(await within(dialog).findByRole('alert', undefined, TIMEOUT)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show splash' }));
    await waitFor(() => expect(mock.server.tournament('trn_spring').display.scene).toBe('ANNOUNCEMENT'), TIMEOUT);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(display).toHaveBeenCalledTimes(2);
  });

  it('is read-only without ANNOUNCE (viewer)', async () => {
    await openBroadcast('trn_spring', 'viewer');
    expect(screen.getByText(/requires the ANNOUNCE permission/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Apply to big screen' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(true);
  });
});
