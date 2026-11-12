import { describe, expect, it } from 'vitest';
import { SYNC, baseTolerance, evaluateDrift, initialDriftState, nextTrackState, noteCorrection, toleranceFor, updateAnchorLead, updateLead, type DriftState } from './driftPolicy';

const GUEST: number = SYNC.calibratedTolerance; // 0.5

/** Feeds measurements `stepMs` apart and reports which ones triggered a correction. */
function run(drifts: number[], base = GUEST, stepMs = 2_000, start: DriftState = initialDriftState()) {
  let state = start;
  let now = 100_000;
  const corrected: number[] = [];
  drifts.forEach((d, i) => {
    const r = evaluateDrift(state, d, now, base);
    state = r.state;
    if (r.correct) corrected.push(i);
    now += stepMs;
  });
  return { state, corrected };
}

describe('tolerances', () => {
  it('guest: tight once the clock is calibrated, loose before', () => {
    expect(baseTolerance(false, true)).toBe(0.5);
    expect(baseTolerance(false, false)).toBe(1.2);
  });
  it('host: one threshold, independent of calibration', () => {
    expect(baseTolerance(true, true)).toBe(0.8);
    expect(baseTolerance(true, false)).toBe(0.8);
  });
  it('relaxing never tightens a tolerance that is already wider', () => {
    const relaxed = { ...initialDriftState(), relaxed: true };
    expect(toleranceFor(relaxed, 0.5)).toBe(1.5);
    expect(toleranceFor(relaxed, 2)).toBe(2);
  });
});

describe('evaluateDrift', () => {
  it('ignores drift inside the tolerance', () => {
    expect(run([0.1, -0.3, 0.45, -0.5]).corrected).toEqual([]);
  });

  it('corrects drift beyond the tolerance, in either direction', () => {
    expect(run([0.6]).corrected).toEqual([0]);
    expect(run([-0.6]).corrected).toEqual([0]);
  });

  it('corrects at most once per cooldown window', () => {
    // 2 s apart: 0 s, 2 s, 4 s, 6 s are inside the 8 s window; 8 s is not.
    expect(run([-1, -1, -1, -1, -1]).corrected).toEqual([0, 4]);
  });

  it('the cooldown boundary is exact', () => {
    const first = evaluateDrift(initialDriftState(), -1, 1_000, GUEST);
    expect(evaluateDrift(first.state, -1, 1_000 + SYNC.cooldownMs - 1, GUEST).correct).toBe(false);
    expect(evaluateDrift(first.state, -1, 1_000 + SYNC.cooldownMs, GUEST).correct).toBe(true);
  });

  it('hysteresis: just inside the tolerance does not count as settled', () => {
    // Correct, land at 0.4 (inside 0.5 but outside 0.3), drift out again.
    const { state } = run([-1, -0.4, -0.4, -0.4, -1], GUEST);
    expect(state.consecutive).toBe(2); // the first failure was not forgotten
  });

  it('settling well inside the tolerance clears the failure count', () => {
    const { state } = run([-1, -0.1, -0.1, -0.1, -1], GUEST);
    expect(state.consecutive).toBe(1);
  });

  it('after 3 corrections in a row that did not hold, relaxes instead of seeking again', () => {
    // Always 1 s behind: a connection that cannot hold 0.5 s. Sampled every 8 s.
    const { state, corrected } = run(Array(8).fill(-1), GUEST, SYNC.cooldownMs);
    expect(corrected).toEqual([0, 1, 2]); // three seeks, then it stops
    expect(state.relaxed).toBe(true);
  });

  it('still corrects a relaxed player that is beyond the relaxed tolerance', () => {
    const { state, corrected } = run(Array(6).fill(-2), GUEST, SYNC.cooldownMs);
    expect(state.relaxed).toBe(true);
    expect(corrected).toEqual([0, 1, 2, 3, 4, 5]); // 2 s off is audible: keep trying, once per window
  });

  it('a slow connection is never seeked more than once per cooldown, however long it lasts', () => {
    const drifts = Array(120).fill(-0.9); // four minutes, sampled every 2 s
    const { corrected } = run(drifts, GUEST);
    expect(corrected.length).toBe(3); // then relaxed to 1.5 s, and 0.9 s is inside it
  });

  it('the host re-anchors at 0.8 s, not before', () => {
    expect(run([0.7], SYNC.hostTolerance).corrected).toEqual([]);
    expect(run([0.9], SYNC.hostTolerance).corrected).toEqual([0]);
  });

  it('does not mutate the state it is given', () => {
    const state = Object.freeze(initialDriftState());
    expect(() => evaluateDrift(state, -5, 1_000, GUEST)).not.toThrow();
    expect(state.consecutive).toBe(0);
  });
});

describe('buffer compensation', () => {
  it('aims further ahead after landing behind', () => {
    expect(updateLead(0, -0.6)).toBeCloseTo(0.3);
    expect(updateLead(0.3, -0.6)).toBeCloseTo(0.6);
  });
  it('backs off after overshooting, and never goes negative', () => {
    expect(updateLead(0.6, 0.4)).toBeCloseTo(0.4);
    expect(updateLead(0.1, 1)).toBe(0);
  });
  it('is capped', () => {
    expect(updateLead(1.9, -2)).toBe(SYNC.maxLeadSeconds);
  });
  it('ignores results that are not about buffering', () => {
    expect(updateLead(0.4, -30)).toBe(0.4); // the host seeked meanwhile
    expect(updateLead(0.4, Number.NaN)).toBe(0.4);
  });
  it('converges on a constant rebuffer time', () => {
    // Every seek costs 0.8 s of buffering: landing drift = lead - 0.8.
    let lead = 0;
    for (let i = 0; i < 12; i++) lead = updateLead(lead, lead - 0.8);
    expect(lead).toBeCloseTo(0.8, 2);
  });
  it('learns from the measurement that follows a correction, and only that one', () => {
    const first = evaluateDrift(initialDriftState(), -1, 0, GUEST);
    expect(first.state.awaitingResult).toBe(true);
    const second = evaluateDrift(first.state, -0.4, 2_000, GUEST);
    expect(second.state.lead).toBeCloseTo(0.2);
    expect(second.state.awaitingResult).toBe(false);
    const third = evaluateDrift(second.state, -0.4, 4_000, GUEST);
    expect(third.state.lead).toBeCloseTo(0.2);
  });
  it('host: learns the travel time of its re-anchor requests', () => {
    // Every re-anchor leaves the host 0.4 s ahead until the lead covers it.
    let lead = 0;
    for (let i = 0; i < 12; i++) lead = updateAnchorLead(lead, 0.4 - lead);
    expect(lead).toBeCloseTo(0.4, 2);
    expect(updateAnchorLead(0.2, -1)).toBe(0); // never negative
    expect(updateAnchorLead(0.9, 0.9)).toBe(SYNC.maxAnchorLeadSeconds); // capped
    expect(updateAnchorLead(0.3, 5)).toBe(0.3); // not a latency measurement
  });
  it('a command from the room starts a cooldown and a measurement', () => {
    const state = noteCorrection(initialDriftState(), 5_000);
    expect(evaluateDrift(state, -1, 6_000, GUEST).correct).toBe(false);
    expect(evaluateDrift(state, -1, 6_000, GUEST).state.lead).toBeCloseTo(0.5);
  });
  it('a new track keeps the lead and drops everything else', () => {
    const used: DriftState = { lastCorrectionAt: 9, consecutive: 2, relaxed: true, lead: 0.7, awaitingResult: true };
    expect(nextTrackState(used)).toEqual({ ...initialDriftState(), lead: 0.7 });
  });
});
