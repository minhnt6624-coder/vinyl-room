/*
 * Ported from SimpMusic's ServerClockTest.kt, itself ported from Metrolist's
 * ServerClockTest (GPL-3.0).
 *
 * The expected numbers in the first three tests are copied verbatim, not
 * recomputed: they encode the exact offset formula, so arithmetic that shifts
 * them by a few milliseconds is a desync, not a refactor.
 */
import { describe, expect, it } from 'vitest';
import { ServerClock } from './serverClock';

describe('ServerClock (upstream cases)', () => {
  it('maps server wall time onto local monotonic time', () => {
    let elapsed = 1_000;
    const clock = new ServerClock(() => elapsed);

    expect(clock.now()).toBeNull();
    elapsed = 1_120;
    expect(clock.recordPong(1_000, 10_000, 10_010)).toBe(true);

    expect(clock.now()).toBe(10_065);
    expect(clock.positionAt(500, 10_000, true)).toBe(565);

    elapsed += 100;
    expect(clock.now()).toBe(10_165);
    expect(clock.positionAt(500, 10_000, true)).toBe(665);
    expect(clock.positionAt(500, 10_000, false)).toBe(500);
  });

  it('rejects invalid and stale samples', () => {
    let elapsed = 100_000;
    const clock = new ServerClock(() => elapsed);

    expect(clock.recordPong(0, 1_000, 1_001)).toBe(false); // no client time
    expect(clock.recordPong(100_001, 1_000, 1_001)).toBe(false); // sent "in the future"
    expect(clock.recordPong(100_000, 1_001, 1_000)).toBe(false); // server sent before it received
    elapsed = 200_001;
    expect(clock.recordPong(100_000, 1_000, 1_001)).toBe(false); // older than a minute
    expect(clock.now()).toBeNull();
    expect(clock.goodSamples).toBe(0);
  });

  it('reset removes the server clock mapping', () => {
    let elapsed = 1_100;
    const clock = new ServerClock(() => elapsed);
    clock.recordPong(1_000, 10_000, 10_000);

    clock.reset();
    elapsed += 100;

    expect(clock.now()).toBeNull();
    expect(clock.positionAt(500, 10_000, true)).toBe(500);
    expect(clock.goodSamples).toBe(0);
  });
});

describe('ServerClock (weighting and convergence)', () => {
  // A fake link: the server clock runs `trueOffset` ahead of the local one.
  function link(trueOffset: number) {
    let elapsed = 50_000;
    const clock = new ServerClock(() => elapsed);
    const ping = (upMs: number, downMs: number, processingMs = 1) => {
      const sent = elapsed;
      const serverReceive = sent + upMs + trueOffset;
      const serverSend = serverReceive + processingMs;
      elapsed = sent + upMs + processingMs + downMs;
      const first = clock.recordPong(sent, serverReceive, serverSend);
      elapsed += 150;
      return first;
    };
    return { clock, ping };
  }

  it('only the first accepted sample reports true', () => {
    const { ping } = link(7_000);
    expect(ping(40, 40)).toBe(true);
    expect(ping(40, 40)).toBe(false);
  });

  it('a symmetric link recovers the true offset exactly', () => {
    const { clock, ping } = link(123_456);
    for (let i = 0; i < 5; i++) ping(40, 40);
    expect(clock.offset()).toBeCloseTo(123_456, 6);
    expect(clock.goodSamples).toBe(5);
  });

  it('takes server processing time out before halving the round trip', () => {
    const { clock, ping } = link(1_000);
    ping(30, 30, 400); // a slow server must not look like a slow network
    expect(clock.offset()).toBeCloseTo(1_000, 6);
  });

  it('a congested sample barely moves the estimate', () => {
    const { clock, ping } = link(10_000);
    for (let i = 0; i < 5; i++) ping(30, 30);
    const before = clock.offset()!;
    ping(30, 1_230); // 1.2 s stuck on the way back: its own estimate is 600 ms off
    const moved = Math.abs(clock.offset()! - before);
    expect(moved).toBeCloseTo(0.05 * 600, 6); // weighted 0.05, not 0.25
    expect(clock.goodSamples).toBe(5); // and it is not counted as a good sample
  });

  it('converges on an asymmetric, jittery link to within the asymmetry', () => {
    const { clock, ping } = link(-42_000);
    const jitter = [0, 12, 3, 30, 7, 1, 18, 5, 9, 2, 25, 4];
    for (const j of jitter) ping(35 + j, 45 + (j % 7));
    // Latency asymmetry cannot be observed, so the bound is half the worst gap.
    expect(Math.abs(clock.offset()! - -42_000)).toBeLessThan(15);
  });

  it('positionAt never moves a position backwards', () => {
    const { clock, ping } = link(0);
    ping(10, 10);
    expect(clock.positionAt(500, clock.now()! + 5_000, true)).toBe(500);
  });
});
