import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useActiveLine } from '../../hooks/useActiveLine';
import type { LyricsPhase } from '../../hooks/useLyrics';
import type { LrcLine } from '../../lib/lrc';
import { lyricsView, OFFSET_STEP_MS, readOffset, writeOffset } from '../../lib/lyricsSync';
import type { TrackLyrics } from '../../services/lyricsService';
import type { Room } from '../../types';
import { LYRICS_TEXT as T } from './strings';

interface Props {
  phase: LyricsPhase;
  lyrics: TrackLyrics | null;
  onRetry(): void;
  trackId: string;
  /** The room drives this provider's player, so lyrics can follow the music. */
  providerSynced: boolean;
  room: Room;
  clockOffset: number;
  /** On the blurred-artwork background of the full screen view. */
  dark?: boolean;
  /** Larger type, for the full screen view on wide screens. */
  large?: boolean;
  className?: string;
}

/** How long a manual scroll keeps the panel from following the music. */
const HOLD_MS = 4000;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/**
 * The words of the record on the turntable. Read-only for everyone: a line is
 * not a button, because only the host moves the room's timeline.
 *
 * aria-live is off on purpose. The lines change every few seconds and the
 * section this sits in announces its changes.
 */
export function LyricsPanel({ phase, lyrics, onRetry, trackId, providerSynced, room, clockOffset, dark = false, large = false, className = '' }: Props) {
  const soft = dark ? 'text-cream/70' : 'text-ink-soft';
  const view = phase === 'ready' && lyrics ? lyricsView(lyrics, providerSynced) : null;

  return (
    <div className={`relative flex min-h-0 flex-col ${className}`} aria-live="off" data-lyrics={view?.kind ?? phase}>
      {phase === 'error' ? (
        <Note className={soft}>
          {T.loadFailed}{' '}
          <button className={`underline underline-offset-2 ${dark ? 'text-cream' : 'text-indigo'}`} onClick={onRetry}>
            {T.retry}
          </button>
        </Note>
      ) : !view ? (
        <div className="flex flex-1 flex-col justify-center gap-4 px-1" role="status" aria-label={T.loading}>
          {['w-4/5', 'w-3/5', 'w-2/3'].map((width) => (
            <div key={width} className={`h-7 animate-pulse rounded-md motion-reduce:animate-none ${width} ${dark ? 'bg-cream/15' : 'bg-ink/10'}`} />
          ))}
        </div>
      ) : view.kind === 'instrumental' ? (
        <Note className={`font-display text-3xl ${dark ? 'text-cream' : 'text-ink'}`}>{T.instrumental}</Note>
      ) : view.kind === 'none' ? (
        <Note className={soft}>{T.notFound}</Note>
      ) : view.kind === 'static' ? (
        <div className="lyrics-scroll scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain" role="region" aria-label={T.title} tabIndex={0}>
          {!providerSynced && <p className={`eyebrow mb-4 !text-[10px] ${soft}`}>{T.notSynced}</p>}
          <div className={`font-display leading-snug ${large ? 'text-3xl' : 'text-xl'}`}>
            {view.text.map((line, i) => (line ? <p key={i} className="mb-2">{line}</p> :<p key={i} className="h-5" aria-hidden="true" />))}
          </div>
        </div>
      ) : (
        <SyncedLines key={trackId} lines={view.lines} trackId={trackId} room={room} clockOffset={clockOffset} dark={dark} large={large} />
      )}
    </div>
  );
}

function Note({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-2 py-6 text-center">
      <p className={className}>{children}</p>
    </div>
  );
}

interface SyncedProps {
  lines: LrcLine[];
  trackId: string;
  room: Room;
  clockOffset: number;
  dark: boolean;
  large: boolean;
}

function SyncedLines({ lines, trackId, room, clockOffset, dark, large }: SyncedProps) {
  const reducedMotion = useReducedMotion();
  const [offset, setOffset] = useState(() => readOffset(trackId));
  const active = useActiveLine(lines, room, clockOffset, offset);

  const scroller = useRef<HTMLDivElement | null>(null);
  const placed = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const [held, setHeld] = useState(false);

  // Bring the current line to the middle. Before the first line, show the top.
  const follow = useRef({ active, held });
  follow.current = { active, held };
  const centre = useCallback((smooth: boolean) => {
    const box = scroller.current;
    if (!box || follow.current.held) return;
    const line = box.querySelector<HTMLElement>(`[data-line="${Math.max(0, follow.current.active)}"]`);
    if (!line) return;
    box.scrollTo({ top: line.offsetTop - (box.clientHeight - line.offsetHeight) / 2, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (held) return;
    centre(placed.current && !reducedMotion);
    placed.current = true;
  }, [active, held, reducedMotion, centre]);

  // The panel changes size when the window does, or when it moves between the
  // column, the sheet and full screen. Keep the line in the middle, at once.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const observer = new ResizeObserver(() => centre(false));
    observer.observe(box);
    return () => observer.disconnect();
  }, [centre]);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  // The listener is reading somewhere else: leave the scroll alone for a while.
  const hold = useCallback(() => {
    setHeld(true);
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setHeld(false), HOLD_MS);
  }, []);
  const resume = () => {
    window.clearTimeout(holdTimer.current);
    setHeld(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key)) hold();
  };
  // A press on the scroller itself (not on a line) is a grab of the scrollbar.
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.target === e.currentTarget) hold();
  };

  const nudge = (by: number) => setOffset(writeOffset(trackId, offset + by));
  const chip = `eyebrow inline-flex h-8 items-center rounded-full px-3 !text-[10px] transition-colors ${dark ? 'bg-cream/10 hover:bg-cream/20' : 'bg-ink/5 hover:bg-ink/10'}`;

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          className="lyrics-scroll lyrics-fade scroll-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
          role="region"
          aria-label={T.title}
          tabIndex={0}
          onWheel={hold}
          onTouchMove={hold}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        >
          <div className={`lyrics-lines font-display ${large ? 'text-5xl' : 'text-[1.7rem]'}`}>
            {lines.map((line, i) => (
              <p
                key={i}
                data-line={i}
                className={`lyric-line ${i === active ? 'is-current' : i < active ? 'is-past' : ''}`}
                aria-current={i === active ? 'true' : undefined}
              >
                {line.text || T.pause}
              </p>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {held && (
            <motion.button
              className="pill absolute bottom-3 left-1/2 !h-9 !px-4 text-ink"
              style={{ x: '-50%' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
              onClick={resume}
            >
              <ArrowDown size={14} /> <span className="eyebrow !text-[10px]">{T.backToCurrent}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Timing nudge: this listener only, remembered per track. */}
      <div className="flex flex-none items-center justify-center gap-2 pt-2" role="group" aria-label={T.offsetGroup}>
        <button className={chip} onClick={() => nudge(-OFFSET_STEP_MS)} aria-label={T.offsetLaterLabel}>
          {T.offsetLater}
        </button>
        {offset !== 0 && (
          <button className={`${chip} tabular-nums ${dark ? 'text-cream' : 'text-indigo'}`} onClick={() => setOffset(writeOffset(trackId, 0))} title={T.offsetReset} aria-label={T.offsetValueLabel(offset)} data-offset={offset}>
            {T.offsetValue(offset)}
          </button>
        )}
        <button className={chip} onClick={() => nudge(OFFSET_STEP_MS)} aria-label={T.offsetEarlierLabel}>
          {T.offsetEarlier}
        </button>
      </div>
    </>
  );
}
