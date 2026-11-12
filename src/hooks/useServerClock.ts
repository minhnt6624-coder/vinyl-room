import { useEffect, useMemo, useState } from 'react';
import { AppError } from '../lib/errors';
import { monotonicNow } from '../lib/monotonic';
import { ServerClock } from '../lib/serverClock';
import { roomService } from '../services/roomService';

const FIRST_BURST = 5;
const BURST_GAP_MS = 150;
const RESAMPLE_MS = 30_000;
/** Good samples needed before the tight sync tolerance is trusted. */
export const CALIBRATED_SAMPLES = 3;
/** A sample this far from the estimate means the local clock stopped (device sleep), not jitter. */
const CLOCK_JUMP_MS = 2_000;

export interface ServerClockReading {
  /** serverTime - monotonicNow(), in ms. Null until the first sample lands. */
  offset: number | null;
  goodSamples: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Keeps an estimate of the server's clock: five pings on entry, then one every
 * 30 s and a couple whenever the tab becomes visible again.
 *
 * If the database has no server_time() yet (migration not applied) the hook
 * stays uncalibrated and the room falls back to the offset measured when the
 * state was loaded.
 */
export function useServerClock(enabled: boolean): ServerClockReading {
  const clock = useMemo(() => new ServerClock(monotonicNow), []);
  const [reading, setReading] = useState<ServerClockReading>({ offset: null, goodSamples: 0 });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let running = false;
    let unavailable = false;

    const publish = () => {
      const offset = clock.offset();
      const goodSamples = clock.goodSamples;
      setReading((prev) => {
        const sameOffset = prev.offset !== null && offset !== null && Math.abs(prev.offset - offset) < 5;
        const sameTrust = prev.goodSamples >= CALIBRATED_SAMPLES === goodSamples >= CALIBRATED_SAMPLES;
        return (sameOffset || prev.offset === offset) && sameTrust ? prev : { offset, goodSamples };
      });
    };

    const sample = async () => {
      const sent = monotonicNow();
      const pong = await roomService.serverTime();
      if (!alive) return;
      // performance.now() can stand still while the device sleeps. A sample
      // far from the estimate means that happened: start again from it rather
      // than creep towards it a quarter at a time.
      const current = clock.offset();
      if (current !== null) {
        const received = monotonicNow();
        const network = Math.max(0, received - sent - (pong.send_ms - pong.receive_ms));
        const sampleOffset = pong.send_ms + network / 2 - received;
        if (Math.abs(sampleOffset - current) > CLOCK_JUMP_MS) clock.reset();
      }
      clock.recordPong(sent, pong.receive_ms, pong.send_ms);
    };

    const burst = async (count: number) => {
      if (running || unavailable) return;
      running = true;
      try {
        for (let i = 0; i < count && alive; i++) {
          await sample();
          if (i < count - 1) await wait(BURST_GAP_MS);
        }
      } catch (e) {
        // Offline is worth retrying on the next tick. Anything else (the
        // function is missing, the session is gone) will not fix itself.
        if (AppError.from(e).code !== 'VR_NETWORK') unavailable = true;
      } finally {
        running = false;
        if (alive) publish();
      }
    };

    void burst(FIRST_BURST);
    const timer = window.setInterval(() => void burst(1), RESAMPLE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void burst(2);
    };
    const onOnline = () => void burst(2);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, clock]);

  return reading;
}
