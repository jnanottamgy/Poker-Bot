import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPTIC_PATTERNS, SOUND_RECIPES, prefersReducedMotion, useAnimatedNumber, useHaptics, useReducedMotion, useSound } from '../src';
import type { Haptics, SoundControls } from '../src';

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
  vi.unstubAllGlobals();
});

describe('useReducedMotion', () => {
  it('follows <html data-motion="reduced">', async () => {
    function P() {
      return <span data-testid="r">{String(useReducedMotion())}</span>;
    }
    render(<P />);
    expect(screen.getByTestId('r').textContent).toBe('false');
    await act(async () => {
      document.documentElement.dataset.motion = 'reduced';
      await Promise.resolve();
    });
    expect(prefersReducedMotion()).toBe(true);
    expect(screen.getByTestId('r').textContent).toBe('true');
  });
});

describe('useAnimatedNumber', () => {
  it('jumps instantly under reduced motion', () => {
    document.documentElement.dataset.motion = 'reduced';
    function P({ v }: { v: number }) {
      return <span data-testid="n">{useAnimatedNumber(v)}</span>;
    }
    const { rerender } = render(<P v={100} />);
    rerender(<P v={5000} />);
    expect(screen.getByTestId('n').textContent).toBe('5000');
  });
});

describe('useHaptics', () => {
  function capture(enabled: boolean): Haptics {
    let out: Haptics | null = null;
    function P() {
      out = useHaptics(enabled);
      return null;
    }
    render(<P />);
    if (!out) throw new Error('no hook');
    return out;
  }
  it('does nothing when unsupported', () => {
    const h = capture(true);
    expect(h.supported).toBe(false);
    expect(h.vibrate('your-turn')).toBe(false);
  });
  it('vibrates only when supported AND enabled', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    expect(capture(false).vibrate('tap')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    cleanup();
    expect(capture(true).vibrate('your-turn')).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS['your-turn']);
    Reflect.deleteProperty(navigator, 'vibrate');
  });
});

describe('useSound', () => {
  it('is muted by default and never creates audio while muted', () => {
    const ctor = vi.fn();
    vi.stubGlobal('AudioContext', ctor);
    let s: SoundControls | null = null;
    function P() {
      s = useSound();
      return null;
    }
    render(<P />);
    const sound = s as unknown as SoundControls;
    expect(sound.muted).toBe(true);
    sound.play('your-turn');
    expect(ctor).not.toHaveBeenCalled();
  });
  it('has a short recipe for every cue', () => {
    for (const tones of Object.values(SOUND_RECIPES)) {
      expect(tones.length).toBeGreaterThan(0);
      const end = Math.max(...tones.map((t) => t.at + t.d));
      expect(end).toBeLessThan(1.2);
      for (const t of tones) expect(t.g).toBeLessThanOrEqual(0.15);
    }
  });
});
