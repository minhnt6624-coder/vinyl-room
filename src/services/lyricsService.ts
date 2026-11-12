import { AppError } from '../lib/errors';
import { parseLrc, type LrcLine } from '../lib/lrc';
import { ensureSession, supabase } from '../lib/supabase';

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
};
