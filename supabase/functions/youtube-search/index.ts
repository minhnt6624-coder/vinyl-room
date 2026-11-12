// Supabase Edge Function: YouTube search and metadata lookup.
//
// The YouTube Data API key lives only here (supabase secrets set YOUTUBE_API_KEY=...).
// The gateway's verify_jwt also lets the public (publishable) key through, so
// the function checks the caller itself: consume_search_quota() only runs for
// a signed-in user, and rate limits them, before any YouTube quota is spent.
//
// POST { "q": "search text" }  -> up to 12 embeddable videos
// POST { "id": "<videoId>" }   -> that single video
// Answers 200 with { items } or { error } so the client can tell "not
// configured", "rate_limited" and "quota_exceeded" apart from a transport
// failure. Callers who are not signed in get 401.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const API = 'https://www.googleapis.com/youtube/v3';

// search.list costs 100 quota units (10,000/day by default), so repeat queries
// are served from memory while this instance stays warm.
const cache = new Map<string, { at: number; items: unknown[] }>();
const CACHE_MS = 10 * 60 * 1000;

function isoDurationToSeconds(iso: string | undefined): number | null {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const total = (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  return total > 0 ? total : null;
}

interface Video {
  id: string;
  snippet?: { title?: string; channelTitle?: string; liveBroadcastContent?: string };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean };
}

async function videosByIds(ids: string[], key: string) {
  const url = `${API}/videos?part=snippet,contentDetails,status&id=${ids.join(',')}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`videos.list ${res.status}`);
  const data = (await res.json()) as { items?: Video[] };
  const byId = new Map((data.items ?? []).map((v) => [v.id, v]));
  return ids
    .map((id) => byId.get(id))
    .filter((v): v is Video => Boolean(v && v.status?.embeddable !== false && v.snippet?.liveBroadcastContent !== 'live'))
    .map((v) => ({
      provider: 'youtube',
      providerTrackId: v.id,
      title: v.snippet?.title ?? 'Untitled',
      artist: v.snippet?.channelTitle?.replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/i, '').trim() || null,
      album: null,
      artworkUrl: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      durationSeconds: isoDurationToSeconds(v.contentDetails?.duration),
      externalUrl: `https://www.youtube.com/watch?v=${v.id}`,
    }));
}

// Runs the quota guard as the caller. Returns null when the request may go on.
async function guard(req: Request, kind: 'search' | 'lookup'): Promise<Response | null> {
  const authorization = req.headers.get('Authorization');
  const base = Deno.env.get('SUPABASE_URL');
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization || !base || !apikey) return json({ error: 'unauthorized' }, 401);
  const res = await fetch(`${base}/rest/v1/rpc/consume_search_quota`, {
    method: 'POST',
    headers: { apikey, Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_kind: kind }),
  });
  if (res.ok) return null;
  const text = await res.text();
  if (text.includes('VR_RATE_LIMITED')) return json({ error: 'rate_limited', items: [] });
  if (res.status === 401 || res.status === 403 || text.includes('VR_NOT_AUTHENTICATED')) return json({ error: 'unauthorized' }, 401);
  console.error('quota guard failed', res.status, text);
  return json({ error: 'upstream_error', items: [] });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = Deno.env.get('YOUTUBE_API_KEY');
  if (!key) return json({ error: 'not_configured', items: [] });

  let body: { q?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  try {
    if (typeof body.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(body.id)) {
      const denied = await guard(req, 'lookup');
      if (denied) return denied;
      return json({ items: await videosByIds([body.id], key) });
    }

    const q = typeof body.q === 'string' ? body.q.trim().slice(0, 120) : '';
    if (q.length < 2) return json({ items: [] });

    const denied = await guard(req, 'search');
    if (denied) return denied;

    const cacheKey = q.toLowerCase();
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return json({ items: hit.items });

    const searchUrl =
      `${API}/search?part=id&type=video&videoEmbeddable=true&videoCategoryId=10&maxResults=12` +
      `&q=${encodeURIComponent(q)}&key=${key}`;
    const res = await fetch(searchUrl);
    if (!res.ok) {
      console.error('search.list failed', res.status, await res.text());
      return json({ error: res.status === 403 ? 'quota_exceeded' : 'upstream_error', items: [] });
    }
    const data = (await res.json()) as { items?: { id?: { videoId?: string } }[] };
    const ids = (data.items ?? []).map((i) => i.id?.videoId).filter((id): id is string => Boolean(id));
    const items = ids.length ? await videosByIds(ids, key) : [];

    if (cache.size > 500) cache.clear();
    cache.set(cacheKey, { at: Date.now(), items });
    return json({ items });
  } catch (e) {
    console.error(e);
    return json({ error: 'upstream_error', items: [] });
  }
});
