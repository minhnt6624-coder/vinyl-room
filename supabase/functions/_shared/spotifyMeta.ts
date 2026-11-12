// Artist and running time of a Spotify track.
//
// Spotify's oEmbed endpoint, which the browser uses when a link is pasted,
// returns a title and a picture but neither the artist nor the duration, and
// without those a lyrics record cannot be told apart from another song of the
// same name. The official embed page (the same document the room shows in its
// player) carries both as JSON, so they are read from there.
//
// Only metadata is read. If the page changes shape this returns null and the
// track simply stays without lyrics; nothing else depends on it.
//
// Uses only fetch: runs in the Edge Function and in a plain Node script alike.

export interface SpotifyMeta {
  /** In the order Spotify credits them. */
  artists: string[];
  durationSeconds: number | null;
}

const TRACK_ID = /^[A-Za-z0-9]{22}$/;
const NEXT_DATA = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const REQUEST_TIMEOUT_MS = 6000;

interface Entity {
  artists?: unknown;
  duration?: unknown;
}

/** The first object, depth first, that looks like a track: it has an `artists` list. */
function findEntity(node: unknown, depth = 0): Entity | null {
  if (typeof node !== 'object' || node === null || depth > 12) return null;
  if (!Array.isArray(node) && Array.isArray((node as Entity).artists)) return node as Entity;
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findEntity(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Reads the embed page's HTML. Null when it holds no usable track data. */
export function parseSpotifyEmbed(html: string): SpotifyMeta | null {
  const json = html.match(NEXT_DATA)?.[1];
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const entity = findEntity(data);
  if (!entity) return null;
  const artists = (entity.artists as unknown[])
    .map((a) => (typeof a === 'object' && a !== null ? (a as { name?: unknown }).name : null))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim());
  const ms = typeof entity.duration === 'number' && Number.isFinite(entity.duration) ? entity.duration : null;
  const seconds = ms !== null ? Math.round(ms / 1000) : null;
  const durationSeconds = seconds !== null && seconds >= 1 && seconds <= 86400 ? seconds : null;
  if (artists.length === 0 && durationSeconds === null) return null;
  return { artists, durationSeconds };
}

/** Null for anything that is not a track id, and on any network or parsing problem. */
export async function spotifyTrackMeta(trackId: string, doFetch: typeof fetch = fetch): Promise<SpotifyMeta | null> {
  if (!TRACK_ID.test(trackId)) return null;
  try {
    const res = await doFetch(`https://open.spotify.com/embed/track/${trackId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VinylRoom/0.1)', Accept: 'text/html' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return parseSpotifyEmbed(await res.text());
  } catch {
    return null;
  }
}
