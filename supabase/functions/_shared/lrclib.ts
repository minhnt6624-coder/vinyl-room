// Looking a track up on LRCLIB (https://lrclib.net/docs).
//
// Uses only fetch, so it runs in the Edge Function and in a plain Node script
// alike. Everything about which record to trust lives in lyricsMatch.ts.

import { buildQueries, isBestPossible, selectRecord, type LrclibRecord, type NameQuery, type Scored } from './lyricsMatch.ts';

const API = 'https://lrclib.net/api';
export const USER_AGENT = 'VinylRoom/0.1 (+https://github.com/minhnt6624-coder/vinyl-room)';
const REQUEST_TIMEOUT_MS = 8000;
/** Hard cap on LRCLIB calls for one track, whatever the title looks like. */
const MAX_REQUESTS = 6;

export interface LyricsLookup {
  status: 'found' | 'instrumental' | 'not_found';
  syncedLyrics: string | null;
  plainLyrics: string | null;
  /** LRCLIB's record id, when something was found. */
  recordId: number | null;
  /** The record's running time in seconds. */
  recordDuration: number | null;
  /** |record - track| in seconds; null when the track's duration was unknown. */
  durationDiff: number | null;
  matchedName: string | null;
  /** What was asked, in order, for logs and for the test report. */
  attempts: string[];
}

interface Options {
  fetch?: typeof fetch;
  /** Title and artist come from a music service's metadata, not from a video title and channel. */
  structured?: boolean;
}

function isRecord(x: unknown): x is LrclibRecord {
  return typeof x === 'object' && x !== null && typeof (x as LrclibRecord).id === 'number' && typeof (x as LrclibRecord).duration === 'number';
}

/**
 * Finds lyrics for a track described the way YouTube describes it (a video
 * title and a channel), or, with `structured`, by a music service's own title
 * and artist.
 *
 * 1. /get with the best (title, artist) readings and the duration: one exact record.
 * 2. /search by title and artist.
 * 3. /search with free text, then by title alone.
 * It stops as soon as synced lyrics for the right recording turn up, and
 * otherwise picks the best of everything seen.
 *
 * Network or server errors on a step are skipped, not fatal. If every request
 * fails the function throws, so the caller does not cache "not found" for a
 * track that was never really looked up.
 */
export async function findLyrics(rawTitle: string, channel: string | null, duration: number | null, opts: Options = {}): Promise<LyricsLookup> {
  const doFetch = opts.fetch ?? fetch;
  const queries = buildQueries(rawTitle, channel, { structured: opts.structured });
  const attempts: string[] = [];
  const pool = new Map<number, LrclibRecord>();
  let requests = 0;
  let failures = 0;
  let best: Scored | null = null;

  const call = async (path: string, params: Record<string, string>, label: string): Promise<void> => {
    if (requests >= MAX_REQUESTS || isBestPossible(best)) return;
    requests++;
    const url = `${API}/${path}?${new URLSearchParams(params)}`;
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status === 404) {
        attempts.push(`${label}: none`);
        await res.body?.cancel();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      const records = (Array.isArray(data) ? data : [data]).filter(isRecord);
      for (const r of records) if (!pool.has(r.id)) pool.set(r.id, r);
      best = selectRecord([...pool.values()], queries, duration);
      attempts.push(`${label}: ${records.length}`);
    } catch (e) {
      failures++;
      attempts.push(`${label}: failed (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const withArtist = queries.filter((q): q is NameQuery & { artist: string } => q.artist !== null);
  const durationParam: Record<string, string> = duration !== null ? { duration: String(Math.round(duration)) } : {};

  for (const q of withArtist.slice(0, 2)) {
    await call('get', { track_name: q.title, artist_name: q.artist, ...durationParam }, `get "${q.title}" / "${q.artist}"`);
  }
  for (const q of withArtist.slice(0, 2)) {
    await call('search', { track_name: q.title, artist_name: q.artist }, `search "${q.title}" / "${q.artist}"`);
  }
  const first = queries[0];
  if (first) {
    await call('search', { q: [first.artist, first.title].filter(Boolean).join(' ') }, `search q "${[first.artist, first.title].filter(Boolean).join(' ')}"`);
    await call('search', { track_name: first.title }, `search "${first.title}"`);
  }

  if (requests > 0 && failures === requests) throw new Error(`LRCLIB unreachable: ${attempts.join('; ')}`);

  const chosen = best as Scored | null;
  if (!chosen) {
    return { status: 'not_found', syncedLyrics: null, plainLyrics: null, recordId: null, recordDuration: null, durationDiff: null, matchedName: null, attempts };
  }
  const r = chosen.record;
  const synced = r.syncedLyrics && r.syncedLyrics.trim() ? r.syncedLyrics : null;
  const plain = r.plainLyrics && r.plainLyrics.trim() ? r.plainLyrics : null;
  return {
    status: synced || plain ? 'found' : 'instrumental',
    syncedLyrics: synced,
    plainLyrics: plain,
    recordId: r.id,
    recordDuration: r.duration,
    durationDiff: chosen.durationDiff,
    matchedName: `${r.artistName ?? '?'} - ${r.trackName ?? '?'}`,
    attempts,
  };
}
