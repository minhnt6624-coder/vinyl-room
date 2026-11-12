import { useAnimate, useReducedMotion } from 'framer-motion';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLyrics, usePrefetchLyrics } from '../../hooks/useLyrics';
import { spineColor } from '../../lib/format';
import { getProvider } from '../../services/providers';
import type { QueueItem, Room } from '../../types';
import { Artwork } from '../vinyl/Artwork';
import { LyricsPanel } from './LyricsPanel';

export type LyricsMode = 'closed' | 'open' | 'full';

interface Props {
  mode: LyricsMode;
  onMode(mode: LyricsMode): void;
  room: Room;
  item: QueueItem | null;
  /** The record that plays after this one, whose lyrics are fetched ahead. */
  next: QueueItem | null;
  clockOffset: number;
  /** Duration reported by the player, when the track has none stored. */
  playerDuration: number | null;
  /** The provider's player (Screen). */
  children: ReactNode;
}

const WIDE = '(min-width: 1280px)'; // Tailwind's xl
const TABLET = '(min-width: 768px)'; // Tailwind's md
// The same movement as Sheet.
const SLIDE = { type: 'tween', duration: 0.32, ease: [0.2, 0.8, 0.2, 1] } as const;

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/**
 * Holds the provider's player and, when asked, the lyrics around it.
 *
 * YouTube's player must stay visible, at least 200x200, with nothing drawn
 * over it. A sheet or a full screen layer on top of the page would cover it,
 * and moving the player into such a layer would reload its iframe and drop
 * the sound. So the player never moves in the tree: this element is always
 * its parent, and only the classes around it change.
 *
 *  - closed: the player where it has always been (in the page, or pinned to
 *    the corner on wide screens).
 *  - open, wide screens: a column on the right, lyrics above the player.
 *  - open, phones and tablets: laid out like Sheet, with the player inside.
 *  - full: the whole window, over the record's artwork, blurred.
 */
export function LyricsDock({ mode, onMode, room, item, next, clockOffset, playerDuration, children }: Props) {
  const shown: LyricsMode = item ? mode : 'closed';
  const wide = useMedia(WIDE);
  const tablet = useMedia(TABLET);
  const reducedMotion = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();

  const provider = item ? getProvider(item.track.provider) : null;
  const providerSynced = provider?.capabilities.syncedPlayback ?? false;
  const duration = item && providerSynced ? (provider!.getDuration(item.track) ?? playerDuration) : null;

  const { phase, lyrics, retry } = useLyrics(item?.track ?? null, shown !== 'closed');
  usePrefetchLyrics(room, next?.track ?? null, duration, clockOffset, shown !== 'closed');

  const full = shown === 'full';
  const sheet = shown === 'open' && !wide; // modal, like Sheet
  const column = shown === 'open' && wide;

  // Slide in the way Sheet does. The element is not new (the player lives in
  // it), so the movement is played on it rather than left to AnimatePresence.
  const previous = useRef<LyricsMode>('closed');
  useEffect(() => {
    const from = previous.current;
    previous.current = shown;
    if (reducedMotion || !scope.current || shown === from) return;
    if (shown === 'full' || from === 'full') void animate(scope.current, { opacity: [0, 1] }, { duration: 0.25 });
    else if (shown === 'open' && !wide) void animate(scope.current, tablet ? { x: ['100%', '0%'] } : { y: ['100%', '0%'] }, SLIDE);
    else if (shown === 'open') void animate('[data-lyrics-box]', { opacity: [0, 1], y: [10, 0] }, { duration: 0.25 });
  }, [shown, wide, tablet, reducedMotion, animate, scope]);

  const close = useCallback(async () => {
    if (sheet && !reducedMotion && scope.current) {
      await animate(scope.current, tablet ? { x: '100%' } : { y: '100%' }, SLIDE);
      onMode('closed');
      // Back in the page, the player must not keep the sheet's shift.
      void animate(scope.current, { x: 0, y: 0 }, { duration: 0 });
    } else onMode('closed');
  }, [sheet, tablet, reducedMotion, animate, scope, onMode]);

  useEffect(() => {
    if (!full && !sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (full) onMode('open');
      else void close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, sheet, close, onMode]);

  const frame = !item
    ? 'hidden'
    : full
      ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink text-cream md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:grid-rows-[auto_minmax(0,1fr)]'
      : shown === 'open'
        ? // Sheet's own classes below xl; a column beside the room from xl up.
          'fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col rounded-t-3xl bg-paper shadow-float md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[440px] md:rounded-none ' +
          'xl:bottom-5 xl:right-5 xl:top-[5.5rem] xl:z-30 xl:w-[300px] xl:gap-3 xl:bg-transparent xl:shadow-none'
        : 'mt-5 xl:fixed xl:bottom-5 xl:right-5 xl:z-30 xl:mt-0 xl:w-[300px]';

  return (
    <>
      {sheet && <div className="fixed inset-0 z-50 bg-ink/30" onClick={() => void close()} />}

      <div
        ref={scope}
        className={frame}
        role={full || sheet ? 'dialog' : undefined}
        aria-modal={full || sheet ? true : undefined}
        aria-label={shown === 'closed' ? undefined : 'Lyrics'}
        data-lyrics-mode={shown}
      >
        {full && item && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" style={{ '--c': spineColor(item.track.id) } as CSSProperties}>
            <div className="absolute -inset-16 scale-110 blur-3xl">
              <Artwork track={item.track} showText={false} />
            </div>
            <div className="absolute inset-0 bg-ink/60" />
          </div>
        )}

        {/* The player. Always this element's second child, so it is never remounted. */}
        <div
          className={
            full
              ? 'relative order-2 flex flex-none items-center justify-center px-5 pb-3 md:col-start-1 md:row-start-2 md:px-10 md:pb-10'
              : shown === 'open'
                ? 'order-2 flex-none px-5 pb-3 md:px-7 xl:order-3 xl:p-0'
                : ''
          }
        >
          {children}
        </div>

        {shown !== 'closed' && item && (
          <div
            data-lyrics-box
            className={full ? 'contents' : 'contents xl:order-2 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden xl:rounded-2xl xl:bg-paper xl:shadow-float'}
          >
            {sheet && !tablet && <div className="order-1 mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-ink/20" aria-hidden="true" />}
            <header
              className={`relative order-1 flex flex-none items-start justify-between gap-4 px-5 pb-3 pt-4 ${
                full ? 'md:col-span-2 md:px-10 md:pt-8' : 'md:px-7 md:pt-7 xl:px-4 xl:pb-2 xl:pt-3'
              }`}
            >
              <div className="min-w-0">
                <div className={`eyebrow mb-1 truncate ${full ? 'text-cream/70' : 'text-indigo'}`}>{item.track.artist ?? provider!.label}</div>
                <h2 className={`truncate font-display font-semibold leading-tight ${column ? 'text-2xl' : 'text-3xl'}`}>{full ? item.track.title : 'Lyrics'}</h2>
              </div>
              <div className="-mr-2 flex flex-none items-center">
                <button className="icon-btn" onClick={() => onMode(full ? 'open' : 'full')} aria-label={full ? 'Thoát toàn màn hình' : 'Toàn màn hình'}>
                  {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button className="icon-btn" onClick={() => (full ? onMode('closed') : void close())} aria-label="Đóng lyrics">
                  <X size={20} />
                </button>
              </div>
            </header>

            <LyricsPanel
              phase={phase}
              lyrics={lyrics}
              onRetry={retry}
              trackId={item.track.id}
              providerSynced={providerSynced}
              room={room}
              clockOffset={clockOffset}
              dark={full}
              large={full && tablet}
              className={
                full
                  ? 'relative order-3 flex-1 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:col-start-2 md:row-start-2 md:px-10 md:pb-10'
                  : 'order-3 flex-1 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-7 xl:px-4 xl:pb-3'
              }
            />
          </div>
        )}
      </div>
    </>
  );
}
