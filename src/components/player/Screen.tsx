import { ExternalLink } from 'lucide-react';
import { getProvider } from '../../services/providers';
import type { PlayerHandle, QueueItem } from '../../types';

/**
 * Where the provider's own player lives. YouTube's terms require its player
 * to stay visible (and at least 200x200) while it plays, so this is a real
 * part of the room rather than something hidden off-screen. Where it sits is
 * decided by LyricsDock, which wraps it.
 */
export function Screen({ item, player }: { item: QueueItem | null; player: PlayerHandle }) {
  const provider = item ? getProvider(item.track.provider) : null;
  const isYouTube = provider?.id === 'youtube';
  const embedUrl = item && provider && !isYouTube ? provider.getEmbedUrl(item.track) : null;

  return (
    <aside className={`mx-auto w-full max-w-[340px] ${item ? '' : 'hidden'}`} aria-label="Player">
      <div className="card overflow-hidden rounded-2xl p-1.5">
        <div className="relative h-[200px] overflow-hidden rounded-xl bg-ink">
          {/* The YouTube IFrame API mounts here. Kept in the DOM so the player survives track changes. */}
          <div ref={player.mountRef} className={`yt-mount absolute inset-0 ${isYouTube ? '' : 'hidden'}`} />
          {embedUrl && (
            <iframe
              key={embedUrl}
              src={embedUrl}
              title={`${provider!.label} player`}
              className="absolute inset-0 h-full w-full border-0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
          )}
        </div>
        {item && provider && (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="eyebrow !text-[10px] text-ink-soft">
              {provider.label} · {provider.capabilities.syncedPlayback ? 'in sync' : 'not synced'}
            </span>
            <a href={item.track.external_url} target="_blank" rel="noreferrer" className="eyebrow inline-flex items-center gap-1 !text-[10px] text-indigo hover:underline">
              Open <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
