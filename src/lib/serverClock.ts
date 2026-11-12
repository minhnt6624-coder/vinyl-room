/*
 * Vinyl Room — GPL-3.0-only.
 *
 * Ported to TypeScript from SimpMusic's ServerClock.kt
 *   (maxrave-dev/core, service/listenTogether, GPL-3.0),
 * which is itself ported from Metrolist
 *   (Metrolist Project (C) 2026, GPL-3.0).
 *
 * The arithmetic is kept exactly as upstream: the expected numbers in
 * serverClock.test.ts are the upstream test's numbers, copied verbatim.
 * `goodSamples` and `offset()` are additions for this app and do not change
 * the estimate.
 */

const MAX_SAMPLE_AGE_MS = 60_000;
const GOOD_SAMPLE_MARGIN_MS = 50;

/**
 * Maps the server's wall clock onto this device's monotonic clock, from
 * ping/pong round trips.
 *
 * Each pong carries the client's send time and the server's receive/send
 * times, which is enough to estimate one-way latency and therefore the offset
 * between the two clocks.
 *
 * `elapsedRealtime` must be MONOTONIC: a wall clock that an NTP correction can
 * step backwards would make positions jump.
 */
export class ServerClock {
  private serverOffsetMs: number | null = null;
  private bestRoundTripMs = Number.POSITIVE_INFINITY;
  private goodSampleCount = 0;

  constructor(private readonly elapsedRealtime: () => number) {}

  reset(): void {
    this.serverOffsetMs = null;
    this.bestRoundTripMs = Number.POSITIVE_INFINITY;
    this.goodSampleCount = 0;
  }

  /**
   * Folds one pong into the estimate. Returns true only for the FIRST accepted
   * sample, which is the moment the clock becomes usable at all.
   *
   * Samples are weighted by quality rather than averaged flat: a round trip
   * close to the best one seen gets 0.25, a slow one only 0.05, so a single
   * congested request cannot drag the offset.
   */
  recordPong(clientTime: number, serverReceiveTime: number, serverSendTime: number): boolean {
    const receivedAt = this.elapsedRealtime();
    if (clientTime <= 0 || clientTime > receivedAt || receivedAt - clientTime > MAX_SAMPLE_AGE_MS) return false;
    if (serverReceiveTime <= 0 || serverSendTime < serverReceiveTime) return false;

    const roundTrip = receivedAt - clientTime;
    const serverProcessing = serverSendTime - serverReceiveTime;
    // Time the server spent thinking is not time on the wire, so it comes out
    // before the remainder is halved into a one-way estimate.
    const networkRoundTrip = Math.max(0, roundTrip - serverProcessing);
    const sampleOffset = serverSendTime + networkRoundTrip / 2 - receivedAt;
    const previousOffset = this.serverOffsetMs;

    if (networkRoundTrip < this.bestRoundTripMs) this.bestRoundTripMs = networkRoundTrip;
    const good = networkRoundTrip <= this.bestRoundTripMs + GOOD_SAMPLE_MARGIN_MS;
    const weight = good ? 0.25 : 0.05;
    if (good) this.goodSampleCount++;
    this.serverOffsetMs = previousOffset === null ? sampleOffset : previousOffset + weight * (sampleOffset - previousOffset);
    return previousOffset === null;
  }

  /** Server wall time now (whole ms), or null until a first pong has landed. */
  now(): number | null {
    return this.serverOffsetMs === null ? null : Math.trunc(this.elapsedRealtime() + this.serverOffsetMs);
  }

  /** serverTime - elapsedRealtime, in ms, or null until calibrated. */
  offset(): number | null {
    return this.serverOffsetMs;
  }

  /** How many accepted samples had a round trip close to the best one seen. */
  get goodSamples(): number {
    return this.goodSampleCount;
  }

  /**
   * Where a track actually is, given where it was at `effectiveAtServerTime`.
   *
   * Advances `position` by however long the command spent in flight, but only
   * while playing and only once the clock is calibrated. Every unknown falls
   * back to the raw position rather than to a guess, because a wrong seek is
   * worse than a slightly late one.
   */
  positionAt(position: number, effectiveAtServerTime: number | null, isPlaying: boolean): number {
    if (!isPlaying || effectiveAtServerTime === null || effectiveAtServerTime <= 0) return position;
    const serverNow = this.now();
    if (serverNow === null) return position;
    return position + Math.max(0, serverNow - effectiveAtServerTime);
  }
}
