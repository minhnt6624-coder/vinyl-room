import { AppError } from '../../lib/errors';
import { fetchJson, type MusicProvider, type OEmbed } from './types';

const RESERVED = new Set(['discover', 'stream', 'upload', 'search', 'you', 'charts', 'pages', 'settings', 'tags']);

// The id is the "artist/track" path, which is all the official widget needs.
function parseId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (!/^(www\.|m\.)?soundcloud\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || RESERVED.has(parts[0]) || parts[1] === 'sets') return null;
    const id = `${parts[0]}/${parts[1]}`;
    return /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const soundcloud: MusicProvider = {
  id: 'soundcloud',
  label: 'SoundCloud',
  capabilities: { search: false, syncedPlayback: false, embed: true },
  playbackNote: 'Embed only. Each listener presses play in the SoundCloud widget; it is not synced by the room.',

  validateUrl: parseId,

  async search() {
    return [];
  },

  async getTrackDetails(trackId) {
    const externalUrl = `https://soundcloud.com/${trackId}`;
    try {
      const meta = await fetchJson<OEmbed>(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(externalUrl)}`);
      if (!meta.title) throw new Error('no title');
      // oEmbed titles read "Track by Artist".
      const artist = meta.author_name ?? null;
      const title = artist && meta.title.endsWith(` by ${artist}`) ? meta.title.slice(0, -` by ${artist}`.length) : meta.title;
      return {
        provider: 'soundcloud',
        providerTrackId: trackId,
        title,
        artist,
        album: null,
        artworkUrl: meta.thumbnail_url ?? null,
        durationSeconds: null,
        externalUrl,
      };
    } catch {
      throw new AppError('VR_TRACK_LOOKUP_FAILED');
    }
  },

  getEmbedUrl: (track) =>
    `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${track.provider_track_id}`)}&auto_play=false&visual=true&show_comments=false&hide_related=true`,
  getArtwork: (track) => track.artwork_url,
  getDuration: (track) => track.duration_seconds,
};
