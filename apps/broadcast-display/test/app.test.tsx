import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { App } from '../src/App';
import type { DisplayAction } from '../src/model/types';
import type { DisplaySource } from '../src/net/source';
import { snapshotFrame, view } from './fixtures';

function fakeSource() {
  let dispatch: ((a: DisplayAction) => void) | null = null;
  const source: DisplaySource = {
    kind: 'demo',
    start: (d) => {
      dispatch = d;
    },
    nudge: () => undefined,
    stop: () => {
      dispatch = null;
    },
  };
  return { source, send: (a: DisplayAction) => act(() => dispatch?.(a)) };
}

const sceneOf = (c: HTMLElement) => c.querySelector('.bd-frame')?.getAttribute('data-scene');

afterEach(cleanup);

describe('App', () => {
  it('waits for the server, then shows the live overview; S cycles scenes; a drop greys the stage', () => {
    const { source, send } = fakeSource();
    const { container, getByText } = render(<App source={source} data={null} pinnedScene={null} />);
    expect(getByText('Connecting to the tournament')).toBeTruthy();

    send({ type: 'connection', status: 'open' });
    send(snapshotFrame(view()));
    expect(sceneOf(container)).toBe('OVERVIEW');
    expect(container.querySelector('.bd-live')).not.toBeNull();
    expect(container.querySelector('.bd-stage')?.hasAttribute('data-stale')).toBe(false);

    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(sceneOf(container)).toBe('FEATURED_TABLE');
    expect(container.querySelectorAll('.bd-seat:not(.bd-seat--empty)')).toHaveLength(3);
    expect(container.querySelector('.bd-seat.is-acting')?.textContent).toContain('Player 1');

    send({ type: 'connection', status: 'reconnecting' });
    expect(container.querySelector('.bd-live')).toBeNull();
    expect(getByText('Reconnecting')).toBeTruthy();
    expect(container.querySelector('.bd-stage')?.getAttribute('data-stale')).toBe('true');
  });

  it('a pinned scene (?scene=) holds', () => {
    const { source, send } = fakeSource();
    const { container } = render(<App source={source} data={null} pinnedScene="FEATURED_TABLE" />);
    send({ type: 'connection', status: 'open' });
    send(snapshotFrame(view()));
    expect(sceneOf(container)).toBe('FEATURED_TABLE');
  });
});
