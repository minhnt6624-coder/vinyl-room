/**
 * When to pull a player back onto the room's shared timeline.
 *
 * Pure functions, so the rules can be tested without a YouTube player. The
 * hook (usePlaybackSync) measures `drift = playerPosition - timelinePosition`
 * in seconds and asks evaluateDrift what to do.
 *
 * A correction is a seek for a guest and a re-anchor of the room for the
 * host. Both are disruptive (a seek rebuffers; a re-anchor makes every guest
 * seek), so the policy corrects rarely and gives up gracefully on a slow
 * connection instead of seeking in a loop.
 */

export const SYNC = {
  /** Guest, once the server clock has enough good samples. */
  calibratedTolerance: 0.5,
  /** Guest, before that: the clock itself may be this far off. */
  uncalibratedTolerance: 1.2,
  /** Host: beyond this the host's player, not the timeline, is the truth. */
  hostTolerance: 0.8,
  /** Used for the rest of the track after repeated corrections did not hold. */
  relaxedTolerance: 1.5,
  /** At most one correction in this window. */
  cooldownMs: 8_000,
  /** Corrections in a row that may fail before the tolerance is relaxed. */
  maxConsecutive: 3,
  /** A player counts as settled only inside this fraction of the tolerance. */
  settleRatio: 0.6,
  /** Seek this far ahead at most, to land on time after rebuffering. */
  maxLeadSeconds: 2,
  /** How much of each observed shortfall is folded into the lead. */
  leadGain: 0.5,
  /** A result further off than this says nothing about buffering. */
  leadSanitySeconds: 3,
  /** Most a host adds to a re-anchor position to cover the request's travel time. */
  maxAnchorLeadSeconds: 1,
} as const;

export interface DriftState {
  /** performance.now() of the last correction, or null. */
  lastCorrectionAt: number | null;
  /** Corrections made since the player was last settled. */
  consecutive: number;
  /** The tolerance was widened for this track. */
  relaxed: boolean;
  /** Seconds to seek ahead of the timeline, learnt from past seeks. */
  lead: number;
  /** The next measurement is the outcome of a correction. */
  awaitingResult: boolean;
}

export const initialDriftState = (lead = 0): DriftState => ({
  lastCorrectionAt: null,
  consecutive: 0,
  relaxed: false,
  lead,
  awaitingResult: false,
});

/** A new track starts with a clean slate but keeps what it learnt about buffering. */
export const nextTrackState = (state: DriftState): DriftState => initialDriftState(state.lead);

export function baseTolerance(isHost: boolean, clockCalibrated: boolean): number {
  if (isHost) return SYNC.hostTolerance;
  return clockCalibrated ? SYNC.calibratedTolerance : SYNC.uncalibratedTolerance;
}

export const toleranceFor = (state: DriftState, base: number): number =>
  state.relaxed ? Math.max(base, SYNC.relaxedTolerance) : base;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The lead after seeing where the player ended up following a seek.
 * drift < 0 means it landed behind the timeline (it spent time rebuffering),
 * so the next seek should aim further ahead; drift > 0 means it overshot.
 */
export function updateLead(lead: number, drift: number): number {
  if (!Number.isFinite(drift) || Math.abs(drift) > SYNC.leadSanitySeconds) return lead;
  return clamp(lead - SYNC.leadGain * drift, 0, SYNC.maxLeadSeconds);
}

/**
 * The host's counterpart of the lead. When the host re-anchors the room, the
 * position it reports is stamped with the server's time on ARRIVAL, so the
 * timeline ends up behind the host by the request's travel time and the host
 * then measures itself ahead (drift > 0). Reporting a position that much
 * further on cancels it.
 */
export function updateAnchorLead(lead: number, drift: number): number {
  if (!Number.isFinite(drift) || Math.abs(drift) > SYNC.maxAnchorLeadSeconds) return lead;
  return clamp(lead + SYNC.leadGain * drift, 0, SYNC.maxAnchorLeadSeconds);
}

/** Records a correction that something else decided on (a play / seek command from the room). */
export function noteCorrection(state: DriftState, nowMs: number): DriftState {
  return { ...state, lastCorrectionAt: nowMs, awaitingResult: true };
}

export interface DriftDecision {
  correct: boolean;
  state: DriftState;
}

/**
 * One drift measurement, taken while the player is actually playing.
 * Returns whether to correct now, and the state to keep for the next call.
 */
export function evaluateDrift(state: DriftState, drift: number, nowMs: number, base: number): DriftDecision {
  let s: DriftState = state;
  if (s.awaitingResult) s = { ...s, awaitingResult: false, lead: updateLead(s.lead, drift) };

  const size = Math.abs(drift);
  let tolerance = toleranceFor(s, base);

  // Settled: well inside the tolerance. Forget past failures.
  if (size <= tolerance * SYNC.settleRatio) {
    return { correct: false, state: s.consecutive === 0 ? s : { ...s, consecutive: 0 } };
  }
  // Inside the tolerance but not settled: leave it alone, and do not count it as a success.
  if (size <= tolerance) return { correct: false, state: s };

  if (s.lastCorrectionAt !== null && nowMs - s.lastCorrectionAt < SYNC.cooldownMs) return { correct: false, state: s };

  // Several corrections in a row did not hold: this connection cannot keep the
  // tight tolerance. Widen it until the next track rather than seek forever.
  if (!s.relaxed && s.consecutive >= SYNC.maxConsecutive) {
    s = { ...s, relaxed: true, consecutive: 0 };
    tolerance = toleranceFor(s, base);
    if (size <= tolerance) return { correct: false, state: s };
  }

  return { correct: true, state: { ...s, consecutive: s.consecutive + 1, lastCorrectionAt: nowMs, awaitingResult: true } };
}
