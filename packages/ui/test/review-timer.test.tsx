/**
 * Review: timer correctness. These tests FAIL against the current src.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useServerCountdown } from '../src/hooks/useServerCountdown';
import { ActionTimer } from '../src/components/ActionTimer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Frame = { deadline: number | null; ms: number };

function Recorder({ deadline, now, frames }: { deadline: number | null; now: () => number; frames: Frame[] }) {
  const ms = useServerCountdown(deadline, 0, { now });
  frames.push({ deadline, ms });
  return null;
}

const liveText = (c: HTMLElement): string => c.querySelector('[aria-live="assertive"]')?.textContent ?? '';

describe('review: useServerCountdown', () => {
  it('never renders a value computed for the PREVIOUS deadline after the deadline changes', () => {
    const t = 10_000;
    const frames: Frame[] = [];
    const { rerender } = render(<Recorder deadline={9_000} now={() => t} frames={frames} />); // expired -> 0
    rerender(<Recorder deadline={40_000} now={() => t} frames={frames} />); // new turn: 30s left
    const afterChange = frames.filter((f) => f.deadline === 40_000).map((f) => f.ms);
    // Currently the first frame for the new deadline still says 0 (stale), i.e. "00:00 / HURRY" flashes.
    expect(afterChange).not.toContain(0);
  });
});

describe('review: ActionTimer announcements', () => {
  // Test fix: `announce` now defaults to false (only the hero timer may speak), so these hero-timer cases opt in explicitly.
  it('a timer mounted with 3s left never announces "10 seconds left"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { container } = render(<ActionTimer deadline={100_000 + 3_000} serverOffsetMs={0} totalMs={20_000} announce />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(liveText(container)).not.toBe('10 seconds left');
  });

  it('extending a deadline (4s left -> 30s left) does not announce "10 seconds left" early and still announces it at 10s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { container, rerender } = render(<ActionTimer deadline={100_000 + 20_000} serverOffsetMs={0} totalMs={20_000} announce />);
    act(() => {
      vi.advanceTimersByTime(16_000); // 4s left; "10" and "5" were announced
    });
    const extended = Date.now() + 30_000;
    rerender(<ActionTimer deadline={extended} serverOffsetMs={0} totalMs={30_000} announce />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(liveText(container)).toBe(''); // 30s left: nothing to say yet
    act(() => {
      vi.advanceTimersByTime(20_000); // now 10s left
    });
    expect(liveText(container)).toBe('10 seconds left');
  });
});
