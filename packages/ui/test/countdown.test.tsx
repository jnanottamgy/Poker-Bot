import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { remainingMs, useServerCountdown } from '../src/hooks/useServerCountdown';
import { ActionTimer } from '../src/components/ActionTimer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('remainingMs', () => {
  it('is 0 without a deadline', () => {
    expect(remainingMs(null, 1000, 0)).toBe(0);
    expect(remainingMs(Number.NaN, 1000, 0)).toBe(0);
  });
  it('measures against server time = client time + offset', () => {
    // Client clock is 2s behind the server (offset +2000).
    expect(remainingMs(20_000, 10_000, 2000)).toBe(8000);
    // Client clock 1.5s ahead (offset -1500).
    expect(remainingMs(20_000, 10_000, -1500)).toBe(11_500);
    expect(remainingMs(20_000, 10_000, 0)).toBe(10_000);
  });
  it('never goes negative', () => {
    expect(remainingMs(1000, 5000, 0)).toBe(0);
    expect(remainingMs(1000, 1000, 0)).toBe(0);
  });
  it('treats a non-finite offset as 0', () => {
    expect(remainingMs(5000, 1000, Number.NaN)).toBe(4000);
  });
});

function Probe({ deadline, offset, now }: { deadline: number | null; offset: number; now: () => number }) {
  const ms = useServerCountdown(deadline, offset, { intervalMs: 100, now });
  return <span data-testid="ms">{ms}</span>;
}

describe('useServerCountdown', () => {
  it('ticks down and stops at 0', () => {
    vi.useFakeTimers();
    let t = 1000;
    render(<Probe deadline={1500} offset={0} now={() => t} />);
    expect(screen.getByTestId('ms').textContent).toBe('500');
    t = 1300;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('ms').textContent).toBe('200');
    t = 2000;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('ms').textContent).toBe('0');
  });
});

describe('ActionTimer', () => {
  // `announce` defaults to false now (only the hero timer may speak); opt in explicitly.
  it('shows a text warning cue at <= 5s and announces 10s / 5s once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { container } = render(<ActionTimer deadline={100_000 + 11_000} serverOffsetMs={0} totalMs={20_000} announce />);
    expect(container.querySelector('.is-warning')).toBeNull();
    expect(screen.getByText('TIME')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText('10 seconds left')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('5 seconds left')).toBeTruthy();
    expect(screen.getByText('HURRY')).toBeTruthy();
    expect(container.querySelector('.jpb-timer.is-warning')).not.toBeNull();
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/seconds to act/);
  });
});
