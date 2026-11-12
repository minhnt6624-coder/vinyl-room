import { useEffect, useState } from 'react';
import { getProvider } from '../../services/providers';
import type { Track } from '../../types';

type ArtTrack = Pick<Track, 'provider' | 'provider_track_id' | 'artwork_url' | 'duration_seconds' | 'title' | 'artist'>;

/**
 * Cover art for a track: the provider's real artwork when it loads, otherwise
 * one consistent typographic sleeve tinted with the track's colour (--c,
 * inherited from the parent). Fills its positioned parent.
 */
export function Artwork({ track, showText = true }: { track: ArtTrack; showText?: boolean }) {
  const url = getProvider(track.provider).getArtwork(track);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <div className="art-fallback">
        {showText && (
          <>
            <div className="art-fallback-title">{track.title}</div>
            {track.artist && <div className="art-fallback-artist">{track.artist}</div>}
          </>
        )}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      className={`art-img ${track.provider === 'youtube' ? 'is-letterboxed' : ''}`}
      onError={() => setFailed(true)}
    />
  );
}
