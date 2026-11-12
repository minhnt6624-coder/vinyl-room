import type { ProviderId, TrackCandidate } from '../../types';
import { soundcloud } from './soundcloud';
import { spotify } from './spotify';
import type { MusicProvider } from './types';
import { youtube } from './youtube';

// To add a provider: write an adapter, add it here, and allow its id in the
// `tracks.provider` check and `request_track` validation in the migration.
export const providers: Record<ProviderId, MusicProvider> = { youtube, spotify, soundcloud };
export const providerList: MusicProvider[] = [youtube, spotify, soundcloud];
export const getProvider = (id: ProviderId): MusicProvider => providers[id];

const looksLikeUrl = (text: string) => /^(https?:\/\/|www\.|spotify:)/i.test(text) || /^[\w-]+\.(com|be)\//i.test(text);

/**
 * Turns whatever was typed into the search box into tracks: a supported link
 * resolves to that one track, anything else is a text search on the default
 * (synced) provider.
 */
export async function resolveQuery(input: string): Promise<{ kind: 'link' | 'search' | 'unsupported'; items: TrackCandidate[] }> {
  const text = input.trim();
  if (!text) return { kind: 'search', items: [] };
  for (const provider of providerList) {
    const id = provider.validateUrl(text);
    if (id) return { kind: 'link', items: [await provider.getTrackDetails(id)] };
  }
  if (looksLikeUrl(text)) return { kind: 'unsupported', items: [] };
  return { kind: 'search', items: await youtube.search(text) };
}

export type { MusicProvider } from './types';
