import { Check, Link2, LoaderCircle, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { errorMessage } from '../../lib/errors';
import { formatTime, spineColor } from '../../lib/format';
import { getProvider, providerList, resolveQuery } from '../../services/providers';
import type { QueueItem, RoomActions, TrackCandidate } from '../../types';
import { Artwork } from '../vinyl/Artwork';

interface Props {
  queue: QueueItem[];
  canRequest: boolean;
  needsApproval: boolean;
  allowDuplicates: boolean;
  onRequest: RoomActions['requestTrack'];
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'results'; items: TrackCandidate[]; from: 'link' | 'search' | 'unsupported' };

const keyOf = (c: TrackCandidate) => `${c.provider}:${c.providerTrackId}`;

export function SearchPanel({ queue, canRequest, needsApproval, allowDuplicates, onRequest }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [adding, setAdding] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(t);
  }, []);

  const inQueue = new Set(
    queue.filter((q) => ['pending', 'approved', 'playing'].includes(q.status)).map((q) => `${q.track.provider}:${q.track.provider_track_id}`),
  );

  // Search runs on submit, not per keystroke: each YouTube search spends API quota.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = text.trim();
    if (!query) return;
    const mine = ++requestSeq.current;
    setStatus({ kind: 'loading' });
    try {
      const res = await resolveQuery(query);
      if (mine === requestSeq.current) setStatus({ kind: 'results', items: res.items, from: res.kind });
    } catch (err) {
      if (mine === requestSeq.current) setStatus({ kind: 'error', message: errorMessage(err) });
    }
  };

  const add = async (c: TrackCandidate) => {
    setAdding(keyOf(c));
    await onRequest(c);
    setAdding(null);
  };

  return (
    <div>
      <form onSubmit={submit} className="sticky top-0 z-10 -mx-1 bg-paper px-1 pb-3" role="search">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            ref={inputRef}
            className="field !pl-11 !pr-24"
            type="search"
            enterKeyHint="search"
            placeholder="Song, artist, album or link"
            aria-label="Search for a song, artist or album, or paste a link"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
          />
          <button type="submit" className="eyebrow absolute right-1.5 top-1/2 h-9 -translate-y-1/2 bg-indigo px-3.5 text-white disabled:opacity-40" disabled={!text.trim() || status.kind === 'loading'}>
            Search
          </button>
        </div>
        {!canRequest && <p className="mt-2 text-sm text-vermilion">The host has paused song requests for now.</p>}
        {canRequest && needsApproval && <p className="mt-2 text-xs text-ink-soft">The host approves requests before they join the queue.</p>}
      </form>

      {status.kind === 'idle' && (
        <div className="py-6 text-sm text-ink-soft">
          <p className="mb-4 flex items-start gap-2.5">
            <Link2 size={16} className="mt-0.5 flex-none" />
            <span>Type a song title, artist or album and press Search, or paste a link to a single track.</span>
          </p>
          <ul className="flex flex-col gap-2.5 border-t border-line pt-4">
            {providerList.map((p) => (
              <li key={p.id} className="flex gap-3">
                <span className="eyebrow w-24 flex-none pt-0.5 text-ink">{p.label}</span>
                <span className="text-xs leading-relaxed">{p.playbackNote}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.kind === 'loading' && (
        <ul aria-busy="true" aria-label="Searching">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex animate-pulse items-center gap-3 border-b border-line py-3">
              <div className="h-14 w-14 flex-none bg-ink/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 bg-ink/10" />
                <div className="h-3 w-1/3 bg-ink/10" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {status.kind === 'error' && (
        <p className="border-l-2 border-vermilion py-1 pl-3 text-sm" role="alert">
          {status.message}
        </p>
      )}

      {status.kind === 'results' && status.items.length === 0 && (
        <p className="py-6 text-sm text-ink-soft">
          {status.from === 'unsupported'
            ? "That link isn't a single track from YouTube, Spotify or SoundCloud. Playlists, albums and other sites can't be queued."
            : 'No songs found. Try the artist name too, or paste a link.'}
        </p>
      )}

      {status.kind === 'results' && status.items.length > 0 && (
        <ul>
          {status.items.map((c) => {
            const key = keyOf(c);
            const queued = inQueue.has(key) && !allowDuplicates;
            const provider = getProvider(c.provider);
            return (
              <li key={key} className="flex items-center gap-3 border-b border-line py-3">
                <div className="relative h-14 w-14 flex-none overflow-hidden rounded-sm shadow-soft" style={{ '--c': spineColor(key) } as CSSProperties}>
                  <Artwork
                    track={{ provider: c.provider, provider_track_id: c.providerTrackId, artwork_url: c.artworkUrl, duration_seconds: c.durationSeconds, title: c.title, artist: c.artist }}
                    showText={false}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium leading-snug">{c.title}</div>
                  <div className="mt-0.5 truncate text-xs text-ink-soft">
                    {[c.artist, c.durationSeconds ? formatTime(c.durationSeconds) : null, provider.label].filter(Boolean).join(' · ')}
                    {!provider.capabilities.syncedPlayback && ' · embed only'}
                  </div>
                </div>
                {queued ? (
                  <span className="eyebrow flex flex-none items-center gap-1 !text-[10px] text-moss">
                    <Check size={14} /> In queue
                  </span>
                ) : (
                  <button
                    className="pill !h-10 flex-none !bg-ink !px-3.5 !text-cream disabled:opacity-40"
                    onClick={() => add(c)}
                    disabled={!canRequest || adding !== null}
                    aria-label={`Add ${c.title} to the queue`}
                  >
                    {adding === key ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
                    <span className="eyebrow !text-[10px]">{needsApproval ? 'Request' : 'Add'}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
