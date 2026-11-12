import { AppError } from '../../lib/errors';
import { ensureSession, supabase } from '../../lib/supabase';
import type { TrackCandidate } from '../../types';
import { fetchJson, type MusicProvider, type OEmbed } from './types';

const ID = /^[A-Za-z0-9_-]{11}$/;

function parseId(input: string): string | null {
  const text = input.trim();
  if (ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/)?.[1] ?? null;
  }
  return id && ID.test(id) ? id : null;
}

interface SearchResponse {
  error?: string;
  items?: TrackCandidate[];
}

// Search and rich metadata go through the Edge Function, which is the only
// place the YouTube Data API key exists.
async function callFunction(body: Record<string, string>): Promise<TrackCandidate[]> {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke<SearchResponse>('youtube-search', { body });
  if (error || !data) throw new AppError('VR_SEARCH_FAILED');
  if (data.error === 'not_configured') throw new AppError('VR_SEARCH_NOT_CONFIGURED');
  if (data.error === 'rate_limited') throw new AppError('VR_RATE_LIMITED');
  if (data.error === 'quota_exceeded') throw new AppError('VR_SEARCH_QUOTA');
  if (data.error) throw new AppError('VR_SEARCH_FAILED');
  return data.items ?? [];
}

const cleanArtist = (name?: string) => name?.replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/i, '').trim() || null;

export const youtube: MusicProvider = {
  id: 'youtube',
  label: 'YouTube',
  capabilities: { search: true, syncedPlayback: true, embed: true },
  playbackNote: 'Plays in sync for everyone through the official YouTube player.',

  validateUrl: parseId,

  search: (query) => callFunction({ q: query }),

  async getTrackDetails(trackId) {
    try {
      const [item] = await callFunction({ id: trackId });
      if (item) return item;
    } catch {
      // No API key configured (or the function is not deployed): oEmbed still
      // gives us a title and channel, which is enough to queue a pasted link.
    }
    const watchUrl = `https://www.youtube.com/watch?v=${trackId}`;
    try {
      const meta = await fetchJson<OEmbed>(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`);
      if (!meta.title) throw new Error('no title');
      return {
        provider: 'youtube',
        providerTrackId: trackId,
        title: meta.title,
        artist: cleanArtist(meta.author_name),
        album: null,
        artworkUrl: `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
        durationSeconds: null,
        externalUrl: watchUrl,
      };
    } catch {
      throw new AppError('VR_TRACK_LOOKUP_FAILED');
    }
  },

  getEmbedUrl: (track) => `https://www.youtube.com/embed/${track.provider_track_id}`,
  getArtwork: (track) => track.artwork_url ?? `https://i.ytimg.com/vi/${track.provider_track_id}/hqdefault.jpg`,
  getDuration: (track) => track.duration_seconds,
};
