import { describe, expect, it } from 'vitest';
import {
  canTransition,
  changeKind,
  clampTransition,
  fadeInGain,
  fadeInGainAt,
  fadeInSeconds,
  fadeOutGain,
  fadeOutGainAt,
  fadeOutWindow,
  scaledVolume,
  TRANSITION,
} from './transition';

describe('equal-power curve', () => {
  it('starts and ends exactly', () => {
    expect(fadeOutGain(0)).toBe(1);
    expect(fadeOutGain(1)).toBeCloseTo(0, 12);
    expect(fadeInGain(0)).toBe(0);
    expect(fadeInGain(1)).toBe(1);
  });

  it('keeps the total power constant: out² + in² = 1', () => {
    for (let p = 0; p <= 1; p += 0.05) expect(fadeOutGain(p) ** 2 + fadeInGain(p) ** 2).toBeCloseTo(1, 12);
  });

  it('is at 0.707, not 0.5, half way', () => {
    expect(fadeOutGain(0.5)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(fadeInGain(0.5)).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('is monotonic', () => {
    for (let p = 0.05; p <= 1; p += 0.05) {
      expect(fadeOutGain(p)).toBeLessThan(fadeOutGain(p - 0.05));
      expect(fadeInGain(p)).toBeGreaterThan(fadeInGain(p - 0.05));
    }
  });

  it('clamps progress outside 0..1 and survives NaN', () => {
    expect(fadeOutGain(-3)).toBe(1);
    expect(fadeOutGain(7)).toBeCloseTo(0, 12);
    expect(fadeInGain(-3)).toBe(0);
    expect(fadeInGain(7)).toBe(1);
    expect(fadeOutGain(Number.NaN)).toBe(1);
    expect(fadeInGain(Number.NaN)).toBe(0);
  });
});

describe('clampTransition', () => {
  it('accepts whole seconds from 0 to 8', () => {
    expect([0, 3, 8].map(clampTransition)).toEqual([0, 3, 8]);
    expect(clampTransition(2.6)).toBe(3);
    expect(clampTransition(99)).toBe(8);
    expect(clampTransition(-1)).toBe(0);
  });

  it('reads a missing column (migration not applied) as off', () => {
    expect(clampTransition(undefined)).toBe(0);
    expect(clampTransition(null)).toBe(0);
    expect(clampTransition('3')).toBe(0);
    expect(clampTransition(Number.NaN)).toBe(0);
  });
});

describe('which tracks fade', () => {
  it('needs two fades plus five seconds', () => {
    expect(canTransition(11, 3)).toBe(true);
    expect(canTransition(10.9, 3)).toBe(false);
    expect(canTransition(21, 8)).toBe(true);
    expect(canTransition(20, 8)).toBe(false);
  });

  it('never fades with transitions off or an unknown length', () => {
    expect(canTransition(300, 0)).toBe(false);
    expect(canTransition(null, 3)).toBe(false);
    expect(canTransition(Number.NaN, 3)).toBe(false);
    expect(fadeOutWindow(300, 0)).toBeNull();
    expect(fadeOutWindow(null, 3)).toBeNull();
    expect(fadeOutWindow(8, 3)).toBeNull();
  });

  it('ends the fade a margin before the stored end', () => {
    expect(fadeOutWindow(214, 3)).toEqual({ start: 210, end: 213 });
    expect(fadeOutWindow(200, 8)).toEqual({ start: 191, end: 199 });
    expect(TRANSITION.endMarginSeconds).toBe(1);
  });
});

describe('fadeOutGainAt', () => {
  const window = fadeOutWindow(214, 3)!;

  it('is full volume before the window', () => {
    expect(fadeOutGainAt(0, window)).toBe(1);
    expect(fadeOutGainAt(209.999, window)).toBe(1);
  });

  it('follows the curve inside it', () => {
    expect(fadeOutGainAt(210, window)).toBe(1);
    expect(fadeOutGainAt(211.5, window)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(fadeOutGainAt(212.999, window)).toBeLessThan(0.001);
  });

  it('is silent once the fade ends, while the room changes records', () => {
    expect(fadeOutGainAt(213, window)).toBe(0);
    expect(fadeOutGainAt(215, window)).toBe(0);
  });

  it('comes back if no new record ever arrives', () => {
    expect(fadeOutGainAt(213 + TRANSITION.restoreAfterSeconds, window)).toBe(1);
    expect(fadeOutGainAt(9999, window)).toBe(1);
  });

  it('is always full volume without a window', () => {
    for (const position of [0, 100, 213, 500]) expect(fadeOutGainAt(position, null)).toBe(1);
  });

  it('gives two clients 300 ms apart nearly the same gain', () => {
    for (let p = 210; p < 213; p += 0.1) expect(Math.abs(fadeOutGainAt(p, window) - fadeOutGainAt(p + 0.3, window))).toBeLessThan(0.16);
  });
});

describe('changeKind and fadeInSeconds', () => {
  const window = fadeOutWindow(214, 3)!;
  const previous = (position: number, over: Partial<Parameters<typeof changeKind>[0]> = {}) => ({ position, duration: 214, window, nextItemId: 'b', ...over });

  it('is automatic when the previous record had reached its fade', () => {
    expect(changeKind(previous(210), 'b')).toBe('auto');
    expect(changeKind(previous(213.2), 'b')).toBe('auto');
    expect(changeKind(previous(213.2), 'somewhere-else')).toBe('auto');
  });

  it('is automatic when a record without a fade ran to its end', () => {
    expect(changeKind(previous(9.5, { duration: 10, window: null }), 'b')).toBe('auto');
    expect(changeKind(previous(4, { duration: 10, window: null }), 'x')).toBe('jump');
  });

  it('is a manual next when the host skipped to the record next in line', () => {
    expect(changeKind(previous(60), 'b')).toBe('next');
  });

  it('is a jump for previous or a record picked from the queue', () => {
    expect(changeKind(previous(60), 'played-earlier')).toBe('jump');
    expect(changeKind(previous(60, { nextItemId: null }), 'b')).toBe('jump');
    expect(changeKind(previous(60, { duration: null, window: null }), 'x')).toBe('jump');
  });

  it('fades in fully after an automatic change, one second after a manual next, not at all after a jump', () => {
    expect(fadeInSeconds('auto', 3)).toBe(3);
    expect(fadeInSeconds('auto', 8)).toBe(8);
    expect(fadeInSeconds('next', 3)).toBe(1);
    expect(fadeInSeconds('next', 0.5)).toBe(0.5);
    expect(fadeInSeconds('jump', 3)).toBe(0);
  });

  it('never fades in with transitions off', () => {
    expect(fadeInSeconds('auto', 0)).toBe(0);
    expect(fadeInSeconds('next', 0)).toBe(0);
  });
});

describe('fadeInGainAt', () => {
  it('rises over the fade from the moment the player is audible', () => {
    expect(fadeInGainAt(0, 3, 0.4)).toBe(0);
    expect(fadeInGainAt(1.5, 3, 2)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(fadeInGainAt(3, 3, 3.5)).toBe(1);
    expect(fadeInGainAt(60, 3, 60)).toBe(1);
  });

  it('waits at zero while the player is still loading', () => {
    expect(fadeInGainAt(null, 3, 0)).toBe(0);
    expect(fadeInGainAt(null, 3, 7.9)).toBe(0);
  });

  it('gives up waiting, so nobody is left at zero', () => {
    expect(fadeInGainAt(null, 3, 3 + TRANSITION.fadeInGiveUpSeconds + 0.01)).toBe(1);
  });

  it('is full volume when there is no fade-in', () => {
    expect(fadeInGainAt(null, 0, 0)).toBe(1);
    expect(fadeInGainAt(0, 0, 0)).toBe(1);
  });
});

describe('scaledVolume', () => {
  it("aims at the listener's volume, not at 100", () => {
    expect(scaledVolume(70, 1)).toBe(70);
    expect(scaledVolume(70, Math.SQRT1_2)).toBe(49);
    expect(scaledVolume(70, 0)).toBe(0);
    expect(scaledVolume(15, 0.5)).toBe(8);
  });

  it('stays within 0..100', () => {
    expect(scaledVolume(250, 1)).toBe(100);
    expect(scaledVolume(70, 3)).toBe(70);
    expect(scaledVolume(70, -1)).toBe(0);
    expect(scaledVolume(-5, 1)).toBe(0);
  });
});
