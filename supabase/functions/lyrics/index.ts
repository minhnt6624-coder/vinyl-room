// Supabase Edge Function: lyrics for a track, from LRCLIB, cached in Postgres.
//
// POST { "track_id": "<uuid>" }
//   200 { status: "found" | "instrumental" | "not_found", source, synced_lrc,
//         plain_lyrics, matched_duration, duration_diff, cached, stored, fetched_at }
//   200 { error: "rate_limited" | "upstream_error" }
//   401 not signed in · 404 the caller is not in a room that has this track
//
// Who may call it: the track row is read WITH THE CALLER'S TOKEN, so row level
// security decides. Only a member of a room that has the track gets a row back.
// The gateway's verify_jwt lets the public key through, so nothing here trusts it.
//
// Writes (the cache row, a missing duration) use the service role key, which
// exists only in this function's environment. If it is not available the
// lyrics are still returned, just not stored.

import { findLyrics } from '../_shared/lrclib.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Track {
  id: string;
  provider: string;
  provider_track_id: string;
  title: string;
  artist: string | null;
  duration_seconds: number | null;
}
interface CacheRow {
  track_id: string;
  source: 'lrclib' | 'none';
  synced_lrc: string | null;
  plain_lyrics: string | null;
  instrumental: boolean;
  matched_duration: number | null;
  provider_record_id: number | null;
  fetched_at: string;
}

function isoDurationToSeconds(iso: string | undefined): number | null {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const total = (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  return total > 0 && total <= 86400 ? total : null;
}

/** videos.list part=contentDetails: 1 quota unit. */
async function youtubeDuration(videoId: string, key: string): Promise<number | null> {
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(videoId)}&key=${key}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.error('videos.list failed', res.status);
      return null;
    }
    const data = (await res.json()) as { items?: { contentDetails?: { duration?: string } }[] };
    return isoDurationToSeconds(data.items?.[0]?.contentDetails?.duration);
  } catch (e) {
    console.error('videos.list error', e);
    return null;
  }
}

function respond(row: CacheRow, track: Track, cached: boolean, stored: boolean) {
  const status = row.source === 'none' ? 'not_found' : row.instrumental && !row.synced_lrc && !row.plain_lyrics ? 'instrumental' : 'found';
  return json({
    status,
    source: row.source,
    synced_lrc: row.synced_lrc,
    plain_lyrics: row.plain_lyrics,
    matched_duration: row.matched_duration,
    duration_diff: row.matched_duration !== null && track.duration_seconds !== null ? Math.abs(row.matched_duration - track.duration_seconds) : null,
    cached,
    stored,
    fetched_at: row.fetched_at,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const base = Deno.env.get('SUPABASE_URL');
  const authorization = req.headers.get('Authorization');
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY');
  if (!base || !authorization || !apikey) return json({ error: 'unauthorized' }, 401);

  let body: { track_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const trackId = typeof body.track_id === 'string' && UUID.test(body.track_id) ? body.track_id.toLowerCase() : null;
  if (!trackId) return json({ error: 'bad_request' }, 400);

  const asCaller = { apikey, Authorization: authorization, 'Content-Type': 'application/json' };
  const rest = `${base}/rest/v1`;

  try {
    // Signed-in check and rate limit in one call; the anon role cannot run it.
    const quota = await fetch(`${rest}/rpc/consume_lyrics_quota`, { method: 'POST', headers: asCaller, body: '{}' });
    if (!quota.ok) {
      const text = await quota.text();
      if (text.includes('VR_RATE_LIMITED')) return json({ error: 'rate_limited' });
      if (quota.status === 401 || quota.status === 403 || text.includes('VR_NOT_AUTHENTICATED')) return json({ error: 'unauthorized' }, 401);
      console.error('quota guard failed', quota.status, text);
      return json({ error: 'upstream_error' });
    }

    // Row level security answers "may this person see this track?".
    const trackRes = await fetch(`${rest}/tracks?id=eq.${trackId}&select=id,provider,provider_track_id,title,artist,duration_seconds`, { headers: asCaller });
    if (!trackRes.ok) {
      console.error('track read failed', trackRes.status, await trackRes.text());
      return json({ error: 'upstream_error' });
    }
    const track = ((await trackRes.json()) as Track[])[0];
    if (!track) return json({ error: 'not_found' }, 404);

    const cacheRes = await fetch(`${rest}/lyrics_cache?track_id=eq.${trackId}&select=*`, { headers: asCaller });
    const hit = cacheRes.ok ? ((await cacheRes.json()) as CacheRow[])[0] : undefined;
    if (hit && (hit.source !== 'none' || Date.now() - Date.parse(hit.fetched_at) < NOT_FOUND_TTL_MS)) {
      return respond(hit, track, true, true);
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
    const asService = serviceKey ? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' } : null;

    // A pasted link has no duration until the host plays it. Ask YouTube (1 unit) and keep the answer.
    const youtubeKey = Deno.env.get('YOUTUBE_API_KEY');
    if (track.duration_seconds === null && track.provider === 'youtube' && youtubeKey) {
      const seconds = await youtubeDuration(track.provider_track_id, youtubeKey);
      if (seconds !== null) {
        track.duration_seconds = seconds;
        if (asService) {
          const upd = await fetch(`${rest}/tracks?id=eq.${trackId}&duration_seconds=is.null`, {
            method: 'PATCH',
            headers: { ...asService, Prefer: 'return=minimal' },
            body: JSON.stringify({ duration_seconds: seconds }),
          });
          if (!upd.ok) console.error('duration write failed', upd.status, await upd.text());
        }
      }
    }

    const found = await findLyrics(track.title, track.artist, track.duration_seconds);
    console.log(`lyrics ${trackId} "${track.title}" -> ${found.status}${found.matchedName ? ` (${found.matchedName})` : ''}; ${found.attempts.join('; ')}`);

    const row: CacheRow = {
      track_id: trackId,
      source: found.status === 'not_found' ? 'none' : 'lrclib',
      synced_lrc: found.syncedLyrics,
      plain_lyrics: found.plainLyrics,
      instrumental: found.status === 'instrumental',
      // Only a duration that was actually checked is recorded. Null means
      // "matched by name alone", and set_track_duration clears such rows.
      matched_duration: found.durationDiff !== null && found.recordDuration !== null ? Math.round(found.recordDuration) : null,
      provider_record_id: found.recordId,
      fetched_at: new Date().toISOString(),
    };

    let stored = false;
    if (asService) {
      const put = await fetch(`${rest}/lyrics_cache?on_conflict=track_id`, {
        method: 'POST',
        headers: { ...asService, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });
      stored = put.ok;
      if (!put.ok) console.error('cache write failed', put.status, await put.text());
    } else {
      console.error('no service role key in the environment: lyrics are not cached');
    }
    return respond(row, track, false, stored);
  } catch (e) {
    // Includes "LRCLIB unreachable": nothing is cached, so the next call tries again.
    console.error(e);
    return json({ error: 'upstream_error' });
  }
});
