import { useCallback, useEffect, useState } from 'react';
import { expectedPosition } from '../lib/format';
import { lyricsService, type TrackLyrics } from '../services/lyricsService';
import type { Room, Track } from '../types';

export type LyricsPhase = 'idle' | 'loading' | 'ready' | 'error';

interface Loaded {
  key: string;
  lyrics: TrackLyrics | null;
  failed: boolean;
}

/**
 * Lyrics for one track, loaded only while `enabled` (the panel is open).
 * A track that was looked at before, or prefetched, resolves from memory.
 */
export function useLyrics(track: Track | null, enabled: boolean): { phase: LyricsPhase; lyrics: TrackLyrics | null; retry(): void } {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  const id = track?.id ?? null;
  const duration = track?.duration_seconds ?? null;
  const key = id ? `${id}:${duration ?? ''}:${attempt}` : null;

  useEffect(() => {
    if (!enabled || !id || !key) return;
    let alive = true;
    lyricsService
      .load({ id, duration_seconds: duration })
      .then((lyrics) => alive && setLoaded({ key, lyrics, failed: false }))
      .catch(() => alive && setLoaded({ key, lyrics: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [enabled, id, duration, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (!enabled || !key) return { phase: 'idle', lyrics: null, retry };
  // Anything loaded for another track (or an earlier attempt) is not shown.
  if (!loaded || loaded.key !== key) return { phase: 'loading', lyrics: null, retry };
  return { phase: loaded.failed ? 'error' : 'ready', lyrics: loaded.lyrics, retry };
}

/** Start fetching the next record's lyrics when this much of the current one is left. */
const PREFETCH_BEFORE_END_S = 20;

/**
 * Fetches the lyrics of the record that plays next, shortly before the
 * current one ends, so they are in memory when the room moves on.
 *
 * `duration` is null when the room does not know where the current record
 * ends (nothing playing, an embed-only provider, a track with no length yet);
 * the next one is then fetched straight away.
 */
export function usePrefetchLyrics(room: Room, next: Track | null, duration: number | null, clockOffset: number, enabled: boolean): void {
  const nextId = next?.id ?? null;
  const nextDuration = next?.duration_seconds ?? null;
  const { playback_status: status, playback_position: position, playback_started_at: startedAt } = room;

  useEffect(() => {
    if (!enabled || !nextId) return;
    const fetchNext = () => void lyricsService.load({ id: nextId, duration_seconds: nextDuration }).catch(() => {});
    if (duration === null) {
      fetchNext();
      return;
    }
    const untilWindow = duration - PREFETCH_BEFORE_END_S - expectedPosition({ playback_status: status, playback_position: position, playback_started_at: startedAt }, clockOffset);
    if (untilWindow <= 0) {
      fetchNext();
      return;
    }
    if (status !== 'playing') return; // a paused record gets no closer to its end
    const timer = window.setTimeout(fetchNext, untilWindow * 1000);
    return () => window.clearTimeout(timer);
  }, [enabled, nextId, nextDuration, duration, status, position, startedAt, clockOffset]);
}
