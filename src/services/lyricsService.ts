import { AppError } from '../lib/errors';
import { parseLrc, type LrcLine } from '../lib/lrc';
import { ensureSession, supabase } from '../lib/supabase';
import type { Track } from '../types';

interface LyricsResponse {
  error?: string;
  status?: 'found' | 'instrumental' | 'not_found';
  source?: 'lrclib' | 'none';
  synced_lrc?: string | null;
  plain_lyrics?: string | null;
  matched_duration?: number | null;
  duration_diff?: number | null;
  cached?: boolean;
}

interface CacheRow {
  source: 'lrclib' | 'none';
  synced_lrc: string | null;
  plain_lyrics: string | null;
  instrumental: boolean;
  matched_duration: number | null;
  fetched_at: string;
}

export interface TrackLyrics {
  status: 'found' | 'instrumental' | 'not_found';
  source: 'lrclib' | 'none';
  /** Timed lines, sorted. Empty when only plain lyrics (or none) exist. */
  lines: LrcLine[];
  /** Untimed lyrics, when the source has them. */
  plain: string | null;
  /** Seconds between the matched record and the track; null if not compared. */
  durationDiff: number | null;
  /** Served from the database, not looked up just now. */
  cached: boolean;
}

type TrackRef = Pick<Track, 'id' | 'duration_seconds'>;

// The Edge Function looks a miss up again after this long; so does the client.
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// One entry per track for the life of the page. The duration is part of the
// key because the database drops a name-only match once the track's duration
// is known, and the lookup is then worth repeating.
const memory = new Map<string, Promise<TrackLyrics>>();
const memoryKey = (track: TrackRef) => `${track.id}:${track.duration_seconds ?? ''}`;

export const lyricsService = {
  /**
   * Lyrics for a track in one of the caller's rooms. The first request for a
   * track looks it up on LRCLIB; later ones, by anyone, come from the cache.
   */
  async get(trackId: string): Promise<TrackLyrics> {
    await ensureSession();
    const { data, error } = await supabase.functions.invoke<LyricsResponse>('lyrics', { body: { track_id: trackId } });
    if (error || !data) throw new AppError('VR_LYRICS_FAILED');
    if (data.error === 'rate_limited') throw new AppError('VR_RATE_LIMITED');
    if (data.error || !data.status) throw new AppError('VR_LYRICS_FAILED');
    return {
      status: data.status,
      source: data.source ?? 'none',
      lines: parseLrc(data.synced_lrc),
      plain: data.plain_lyrics?.trim() ? data.plain_lyrics : null,
      durationDiff: data.duration_diff ?? null,
      cached: Boolean(data.cached),
    };
  },

  /**
   * The cached row, read straight from the table (members of a room that has
   * the track may read it). Null when there is no row, or only a miss old
   * enough to be looked up again.
   */
  async read(track: TrackRef): Promise<TrackLyrics | null> {
    await ensureSession();
    const { data, error } = await supabase
      .from('lyrics_cache')
      .select('source,synced_lrc,plain_lyrics,instrumental,matched_duration,fetched_at')
      .eq('track_id', track.id)
      .maybeSingle<CacheRow>();
    if (error) throw AppError.from(error);
    if (!data) return null;
    if (data.source === 'none' && Date.now() - Date.parse(data.fetched_at) >= NOT_FOUND_TTL_MS) return null;
    // Same reading of the row as the Edge Function's.
    const status = data.source === 'none' ? 'not_found' : data.instrumental && !data.synced_lrc && !data.plain_lyrics ? 'instrumental' : 'found';
    return {
      status,
      source: data.source,
      lines: parseLrc(data.synced_lrc),
      plain: data.plain_lyrics?.trim() ? data.plain_lyrics : null,
      durationDiff: data.matched_duration !== null && track.duration_seconds !== null ? Math.abs(data.matched_duration - track.duration_seconds) : null,
      cached: true,
    };
  },

  /**
   * Lyrics for display: from memory, else from the cache table, and only when
   * that has nothing usable from the Edge Function. Concurrent callers (the
   * panel and the prefetch of the next record) share one request.
   */
  load(track: TrackRef): Promise<TrackLyrics> {
    const key = memoryKey(track);
    let pending = memory.get(key);
    if (!pending) {
      pending = lyricsService
        .read(track)
        .catch(() => null) // an unreadable cache is not fatal: the function can still answer
        .then((cached) => cached ?? lyricsService.get(track.id));
      memory.set(key, pending);
      pending.catch(() => {
        if (memory.get(key) === pending) memory.delete(key); // let the next attempt try again
      });
    }
    return pending;
  },
};
