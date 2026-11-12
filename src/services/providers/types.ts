import type { ProviderId, Track, TrackCandidate } from '../../types';

export interface ProviderCapabilities {
  /** Free-text search is available (may still need server configuration). */
  search: boolean;
  /** The room can drive this provider's player, so everyone hears the same moment. */
  syncedPlayback: boolean;
  /** An official embed exists that each listener can start themselves. */
  embed: boolean;
}

type TrackRef = Pick<Track, 'provider_track_id' | 'artwork_url' | 'duration_seconds'>;

/**
 * One adapter per music service. The room, queue and UI only ever talk to this
 * interface; anything provider-specific lives in the adapter.
 */
export interface MusicProvider {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapabilities;
  /** Short, honest description of what playback looks like for listeners. */
  playbackNote: string;
  /** Returns the provider's track id if this URL points at a single track. */
  validateUrl(url: string): string | null;
  search(query: string): Promise<TrackCandidate[]>;
  getTrackDetails(trackId: string): Promise<TrackCandidate>;
  getEmbedUrl(track: TrackRef): string | null;
  getArtwork(track: TrackRef): string | null;
  getDuration(track: TrackRef): number | null;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface OEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}
