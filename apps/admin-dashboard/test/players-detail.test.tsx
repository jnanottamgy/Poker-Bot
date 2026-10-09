import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MockBackend } from '../src/api/mock';
import type { MockPlayer } from '../src/api/mock/state';
import { parseChips } from '../src/sections/player-detail/AdjustDialog';
import { concernsPlayer } from '../src/sections/player-detail/usePlayerDetail';
import { renderControlRoom } from './support/renderControlRoom';

const TIMEOUT = { timeout: 5000 };

function seatedPlayer(mock: MockBackend, tid = 'trn_spring') {
  return mock.server.tournament(tid).players.find((p) => p.status === 'SEATED' && p.tableId !== null)!;
}

async function openDetail(as = 'director', pick: (m: MockBackend) => MockPlayer = (m) => seatedPlayer(m), tid = 'trn_spring') {
  // Render once to reach the mock world, then navigate to the chosen player.
  const r = renderControlRoom(`/t/${tid}/players`, { as });
  const p = pick(r.mock);
  await r.router.navigate(`/t/${tid}/players/${p.playerId}`);
  await screen.findByRole('heading', { name: new RegExp(p.displayName) }, TIMEOUT);
  await screen.findByRole('region', { name: 'Player at a glance' }, TIMEOUT);
  return { ...r, p };
}

/** Fills the level-2 double confirmation (reason + typed word) and confirms. */
async function confirmLevel2(word: string, button: RegExp) {
  const d = await screen.findByRole('dialog', undefined, TIMEOUT);
  const confirm = within(d).getByRole('button', { name: button }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(within(d).getByLabelText(/Reason/), { target: { value: 'Floor decision after review' } });
  fireEvent.change(within(d).getByLabelText(/to confirm/), { target: { value: word } });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
}

describe('Player detail (§2.8)', { timeout: 20_000 }, () => {
  it('shows identity, tournament facts, movements, actions and sessions', async () => {
    const { p } = await openDetail();
    const hero = screen.getByRole('region', { name: 'Player at a glance' });
    expect(within(hero).getByText('Seated')).toBeTruthy();
    expect(within(hero).getByText(/^T\d+ · S\d+$/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tournament' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Movement history' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent actions & timeouts' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Connection & sessions' })).toBeTruthy();
    expect(screen.getAllByText(p.publicId).length).toBeGreaterThan(0);
    // Personal data is masked until revealed.
    expect(screen.getByLabelText('Email hidden')).toBeTruthy();
    expect(screen.queryByText(p.pii.email)).toBeNull();
  });

  it('"Show personal data" calls the audited PII endpoint', async () => {
    const { p, mock } = await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Show personal data' }));
    expect(await screen.findByText(p.pii.email, undefined, TIMEOUT)).toBeTruthy();
    expect(mock.server.world.audit.some((e) => e.action === 'VIEW_PII' && e.target === `player:${p.publicId}`)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide personal data' }));
    expect(screen.queryByText(p.pii.email)).toBeNull();
  });

  it('a viewer sees the record but no controls and no personal data', async () => {
    await openDetail('viewer');
    expect(screen.getByText(/Your role can view this player but not change anything/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show personal data' })).toBeNull();
    expect(screen.getByText(/Requires PLAYER_VIEW_PII/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Disqualify/ })).toBeNull();
  });

  it('suspend (level 1) then restore (level 2, RESTORE)', async () => {
    const { p } = await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const d = await screen.findByRole('dialog', { name: `Suspend ${p.displayName}` }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Suspend player' }));
    await waitFor(() => expect(p.status).toBe('SUSPENDED'), TIMEOUT);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore…' }, TIMEOUT));
    await confirmLevel2('RESTORE', /Restore player/);
    await waitFor(() => expect(p.status).toBe('SEATED'), TIMEOUT);
  });

  it('disqualify is level 2 (DISQUALIFY) with strong consequences and a before/after preview', async () => {
    const { p } = await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Disqualify…' }));
    const d = await screen.findByRole('dialog', undefined, TIMEOUT);
    expect(within(d).getByText(/cannot be undone/)).toBeTruthy();
    expect(within(d).getByText(/chips leave play/)).toBeTruthy();
    expect(within(d).getByText('Disqualified')).toBeTruthy();
    await confirmLevel2('DISQUALIFY', /Disqualify permanently/);
    await waitFor(() => expect(p.status).toBe('DISQUALIFIED'), TIMEOUT);
  });

  it('move: destination table + seat picker, then a level-1 confirmation with a required reason', async () => {
    const { p } = await openDetail();
    const from = p.tableId;
    fireEvent.click(screen.getByRole('button', { name: 'Move to another table…' }));
    const picker = await screen.findByRole('dialog', { name: `Move ${p.displayName}` }, TIMEOUT);
    const group = await within(picker).findByRole('radiogroup', { name: 'Destination table' }, TIMEOUT);
    const option = within(group).getAllByRole('radio').find((r) => !(r as HTMLInputElement).disabled)!;
    fireEvent.click(option);
    fireEvent.click(within(picker).getByRole('button', { name: 'Review move…' }));
    const confirm = await screen.findByRole('dialog', { name: /to table \d+$/ }, TIMEOUT);
    const go = within(confirm).getByRole('button', { name: 'Move player' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(confirm).getByLabelText(/Reason/), { target: { value: 'Accessibility seat request' } });
    fireEvent.click(go);
    await waitFor(() => expect(p.tableId).not.toBe(from), TIMEOUT);
  });

  it('adjust stack (STACK_ADJUST, super admin): validated input, then level 2 ADJUST', async () => {
    const { p } = await openDetail('super');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stack…' }));
    const d = await screen.findByRole('dialog', undefined, TIMEOUT);
    const input = within(d).getByLabelText('Corrected stack (chips)');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(within(d).getByText(/whole number of chips/)).toBeTruthy();
    fireEvent.change(input, { target: { value: '12,345' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Review adjustment…' }));
    await confirmLevel2('ADJUST', /Adjust stack/);
    await waitFor(() => expect(p.stack).toBe(12_345), TIMEOUT);
  });

  it('director has no stack adjustment (permission STACK_ADJUST is super-admin only)', async () => {
    await openDetail('director');
    expect(screen.queryByRole('button', { name: 'Adjust stack…' })).toBeNull();
  });

  it('issues a new rejoin code (level 1) and shows the printable card once', async () => {
    const { p } = await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'New rejoin code' }));
    const d = await screen.findByRole('dialog', { name: `Issue a new rejoin code for ${p.displayName}` }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Issue new code' }));
    const card = await screen.findByRole('dialog', { name: 'New rejoin code' }, TIMEOUT);
    expect(within(card).getByLabelText(/^Rejoin code/).textContent).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(within(card).getByText(p.publicId)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Print card' })).toBeTruthy();
  });

  it('revokes every session (level 2, REVOKE) and sends a private notice (level 1)', async () => {
    const { p, mock } = await openDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke all sessions…' }));
    await confirmLevel2('REVOKE', /Revoke all sessions/);
    await waitFor(() => expect(p.sessions.every((s) => s.revokedAt !== null)).toBe(true), TIMEOUT);

    fireEvent.change(screen.getByLabelText(`Private notice to ${p.displayName}`), { target: { value: 'Please come to the desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send notice…' }));
    const d = await screen.findByRole('dialog', { name: `Send a private notice to ${p.displayName}` }, TIMEOUT);
    fireEvent.click(within(d).getByRole('button', { name: 'Send notice' }));
    await waitFor(() => expect(mock.server.world.audit.some((e) => e.action === 'PRIVATE_NOTICE' && e.target === `player:${p.publicId}`)).toBe(true), TIMEOUT);
  });

  it('a prize winner shows finish (+ ties), prize, payment status and the elimination hand', async () => {
    await openDetail('director', (m) => m.server.tournament('trn_winter').players.find((x) => x.finishPosition === 3)!, 'trn_winter');
    expect(screen.getByRole('heading', { name: 'Prize & payout' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Elimination' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Replay hand' }).getAttribute('href')).toMatch(/\/t\/trn_winter\/hands\//);
  });

  it('shows a friendly not-found state for an unknown player', async () => {
    const r = renderControlRoom('/t/trn_spring/players/ply_nope');
    expect(await screen.findByText('No such player', undefined, TIMEOUT)).toBeTruthy();
    expect(r.container.textContent).not.toMatch(/Error:|stack/i);
  });
});

describe('player detail helpers', () => {
  it('parses chip input', () => {
    expect(parseChips('12,500')).toBe(12_500);
    expect(parseChips(' 7 000 ')).toBe(7_000);
    expect(parseChips('1.5')).toBeNull();
    expect(parseChips('-3')).toBeNull();
  });

  it('refetches only for events about this player', () => {
    const move = { kind: 'TABLE_MOVE', movement: { playerId: 'p1' }, fromTableNumber: 1, toTableNumber: 2 } as never;
    expect(concernsPlayer(move, 'p1', null)).toBe(true);
    expect(concernsPlayer(move, 'p2', null)).toBe(false);
    expect(concernsPlayer({ kind: 'TABLE_BROKEN', tableId: 't9', tableNumber: 9, playersMoved: 3 }, 'p2', 't9')).toBe(true);
    expect(concernsPlayer({ kind: 'BREAK_ENDED' }, 'p1', 't9')).toBe(false);
  });
});
