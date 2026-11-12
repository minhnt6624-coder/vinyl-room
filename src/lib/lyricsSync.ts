import { activeLineIndex, type LrcLine } from './lrc';

/** What the lyrics panel needs to know about a track's lyrics. */
export interface LyricsContent {
  status: 'found' | 'instrumental' | 'not_found';
  lines: LrcLine[];
  plain: string | null;
}

export type LyricsView =
  | { kind: 'synced'; lines: LrcLine[] }
  | { kind: 'static'; text: string[] }
  | { kind: 'instrumental' }
  | { kind: 'none' };

export const OFFSET_STEP_MS = 500;
export const OFFSET_LIMIT_MS = 10_000;

/**
 * Index of the line being sung when the room's timeline is at
 * `positionSeconds`. A positive `offsetMs` shows the lyrics sooner, the same
 * direction as LRC's own [offset:] tag. -1 before the first line.
 */
export function activeLineAt(lines: readonly LrcLine[], positionSeconds: number, offsetMs = 0): number {
  return activeLineIndex(lines, positionSeconds * 1000 + offsetMs);
}

/**
 * Timestamps only mean something when they differ. A sheet whose lines all
 * carry the same time (usually 0) is plain lyrics wearing LRC tags.
 */
export function isTimed(lines: readonly LrcLine[]): boolean {
  return lines.some((line) => line.timeMs !== lines[0].timeMs);
}

/**
 * How lyrics are shown: following the music, as still text, or as one of the
 * two "nothing to read" notes. `providerSynced` is false for embed-only
 * providers, whose position the room does not know.
 */
export function lyricsView(lyrics: LyricsContent, providerSynced: boolean): LyricsView {
  if (lyrics.status === 'instrumental') return { kind: 'instrumental' };
  if (lyrics.status === 'not_found') return { kind: 'none' };
  if (providerSynced && isTimed(lyrics.lines)) return { kind: 'synced', lines: lyrics.lines };

  const text = lyrics.plain?.trim()
    ? lyrics.plain.trim().split(/\r\n|\r|\n/).map((line) => line.trim())
    : lyrics.lines.map((line) => line.text);
  return text.some(Boolean) ? { kind: 'static', text } : { kind: 'none' };
}

export function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  const stepped = Math.round(ms / OFFSET_STEP_MS) * OFFSET_STEP_MS;
  return Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, stepped)) || 0;
}

/** "+0.5s", "−1.0s". */
export function formatOffset(ms: number): string {
  return `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

type OffsetStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const offsetKey = (trackId: string) => `vr.lyricsOffset.${trackId}`;
const browserStore = (): OffsetStore | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked for this origin
  }
};

/** This listener's own timing nudge for a track, in ms. 0 when none is stored or storage is unavailable. */
export function readOffset(trackId: string, store: OffsetStore | null = browserStore()): number {
  try {
    const raw = store?.getItem(offsetKey(trackId));
    return raw == null ? 0 : clampOffset(Number(raw));
  } catch {
    return 0;
  }
}

/** Stores the nudge and returns the value actually kept (stepped and clamped). */
export function writeOffset(trackId: string, ms: number, store: OffsetStore | null = browserStore()): number {
  const value = clampOffset(ms);
  try {
    if (value === 0) store?.removeItem(offsetKey(trackId));
    else store?.setItem(offsetKey(trackId), String(value));
  } catch {
    /* private mode or a full quota: the offset still applies until the page reloads */
  }
  return value;
}
