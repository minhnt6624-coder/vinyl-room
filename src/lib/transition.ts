/*
 * Vinyl Room — GPL-3.0-only.
 *
 * The fade curve is the equal-power pair (cos for the outgoing track, sin for
 * the incoming one) used by SimpMusic's CrossfadeExoPlayerAdapter.kt
 *   (maxrave-dev/core, media3/exoplayer, GPL-3.0).
 * Only the curve is taken. SimpMusic overlaps two players; YouTube's terms
 * allow one player per page, so here one track fades out, the room moves on,
 * and the next fades in. Everything else in this file is this project's own.
 */

/**
 * Smooth transitions between records, as pure functions of time.
 *
 * The volume a listener hears is `their volume x gain`, and the gain is
 * computed, never stored: the fade-out depends only on where the room's
 * shared timeline is, so every browser lowers the sound at the same moment
 * and nobody can be left at zero by a missed event.
 */

export const TRANSITION = {
  /** Longest fade a host can choose, in seconds. 0 turns transitions off. */
  maxSeconds: 8,
  /**
   * The fade-out ends, and the room moves on, this long before the track's
   * stored end. A stored duration is a whole number and can be up to a second
   * longer than the video, so without the margin the player would reach its
   * end first and cut the fade short.
   */
  endMarginSeconds: 1,
  /** A track shorter than two fades plus this is played as it is. */
  minBodySeconds: 5,
  /** Fade-in after the host presses Next by hand. */
  manualNextFadeInSeconds: 1,
  /**
   * After the fade-out ends and nothing has replaced the track (the host's
   * tab is gone, the request failed), the volume comes back after this long.
   */
  restoreAfterSeconds: 2.5,
  /** A fade-in that never started (blocked autoplay, slow load) is abandoned this long after it was due to end. */
  fadeInGiveUpSeconds: 5,
} as const;

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

/** A room's setting as a whole number of seconds, 0 to 8. Anything unreadable is 0: no transition. */
export function clampTransition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(TRANSITION.maxSeconds, Math.round(value)));
}

/** Equal-power fade-out: 1 at progress 0, 0 at progress 1, slow at first. */
export const fadeOutGain = (progress: number): number => Math.cos((clamp01(progress) * Math.PI) / 2);

/** Equal-power fade-in: 0 at progress 0, 1 at progress 1, quick at first. */
export const fadeInGain = (progress: number): number => Math.sin((clamp01(progress) * Math.PI) / 2);

/** Is the track long enough to fade in and out and still have a middle? */
export function canTransition(duration: number | null, seconds: number): duration is number {
  return seconds > 0 && duration !== null && Number.isFinite(duration) && duration >= 2 * seconds + TRANSITION.minBodySeconds;
}

export interface FadeWindow {
  /** Timeline position (seconds) where the fade-out begins. */
  start: number;
  /** Where it reaches silence, and where the host moves the room on. */
  end: number;
}

/** When a track fades out, or null when it does not (too short, unknown length, transitions off). */
export function fadeOutWindow(duration: number | null, seconds: number): FadeWindow | null {
  if (!canTransition(duration, seconds)) return null;
  const end = duration - TRANSITION.endMarginSeconds;
  return { start: end - seconds, end };
}

/** Gain of the outgoing track at a timeline position. */
export function fadeOutGainAt(position: number, window: FadeWindow | null): number {
  if (!window || position < window.start) return 1;
  if (position < window.end) return fadeOutGain((position - window.start) / (window.end - window.start));
  // Silent while the room changes records; back to normal if it never does.
  return position < window.end + TRANSITION.restoreAfterSeconds ? 0 : 1;
}

/** How a new record came on. */
export type ChangeKind = 'auto' | 'next' | 'jump';

/**
 * Works out, from what every client can see, why the record changed:
 *  - 'auto': the previous one had reached its fade-out or its end;
 *  - 'next': the host skipped to the record that was next in line;
 *  - 'jump': anything else (previous, a record picked from the queue).
 */
export function changeKind(previous: { position: number; duration: number | null; window: FadeWindow | null; nextItemId: string | null }, newItemId: string): ChangeKind {
  if (previous.window && previous.position >= previous.window.start) return 'auto';
  if (previous.duration !== null && previous.position >= previous.duration - 2) return 'auto';
  return previous.nextItemId === newItemId ? 'next' : 'jump';
}

/** Length of the fade-in for a record that came on this way. */
export function fadeInSeconds(kind: ChangeKind, seconds: number): number {
  if (seconds <= 0 || kind === 'jump') return 0;
  return kind === 'auto' ? seconds : Math.min(seconds, TRANSITION.manualNextFadeInSeconds);
}

/**
 * Gain of the incoming track.
 * `audibleFor` is how long this browser's player has actually been playing it
 * (null while it is still loading), so a slow connection still gets its whole
 * fade instead of joining it half way. `position` is the room's timeline, used
 * only to give up on a player that never starts.
 */
export function fadeInGainAt(audibleFor: number | null, seconds: number, position: number): number {
  if (seconds <= 0) return 1;
  if (audibleFor === null) return position > seconds + TRANSITION.fadeInGiveUpSeconds ? 1 : 0;
  return fadeInGain(audibleFor / seconds);
}

/** The value handed to the player: the listener's own volume (0-100) scaled by the gain. */
export const scaledVolume = (userVolume: number, gain: number): number => Math.round(Math.max(0, Math.min(100, userVolume)) * clamp01(gain));

/**
 * The fade length for a room. A room row without the column (the migration
 * has not been applied) reads as 0, which is the behaviour before transitions.
 *
 * Dev builds only: localStorage['vr.dev.transition'] overrides it, so the
 * fades can be tried against a database that does not have the column yet.
 */
export function roomTransitionSeconds(room: { transition_seconds?: number } | null | undefined): number {
  if (import.meta.env?.DEV) {
    try {
      const forced = globalThis.localStorage?.getItem('vr.dev.transition');
      if (forced != null && forced !== '') return clampTransition(Number(forced));
    } catch {
      /* storage blocked */
    }
  }
  return clampTransition(room?.transition_seconds);
}
