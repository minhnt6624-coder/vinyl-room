import { AppError } from '../../lib/errors';
import { fetchJson, type MusicProvider, type OEmbed } from './types';

function parseId(input: string): string | null {
  const text = input.trim();
  const uri = text.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  try {
    const url = new URL(text);
    if (url.hostname !== 'open.spotify.com') return null;
    return url.pathname.match(/^\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Spotify only lets an app control playback for signed-in Premium users who
// authorise it. This adapter therefore offers the official embed and nothing
// more: each listener presses play themselves, and the room does not pretend
// to sync it.
export const spotify: MusicProvider = {
  id: 'spotify',
  label: 'Spotify',
  capabilities: { search: false, syncedPlayback: false, embed: true },
  playbackNote: 'Embed only. Each listener presses play; Spotify playback cannot be synced by the room.',

  validateUrl: parseId,

  async search() {
    return [];
  },

  async getTrackDetails(trackId) {
    const externalUrl = `https://open.spotify.com/track/${trackId}`;
    try {
      const meta = await fetchJson<OEmbed>(`https://open.spotify.com/oembed?url=${encodeURIComponent(externalUrl)}`);
      if (!meta.title) throw new Error('no title');
      return {
        provider: 'spotify',
        providerTrackId: trackId,
        title: meta.title,
        artist: meta.author_name ?? null,
        album: null,
        artworkUrl: meta.thumbnail_url ?? null,
        durationSeconds: null,
        externalUrl,
      };
    } catch {
      throw new AppError('VR_TRACK_LOOKUP_FAILED');
    }
  },

  getEmbedUrl: (track) => `https://open.spotify.com/embed/track/${track.provider_track_id}`,
  getArtwork: (track) => track.artwork_url,
  getDuration: (track) => track.duration_seconds,
};
