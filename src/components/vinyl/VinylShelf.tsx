import { Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { spineColor } from '../../lib/format';
import type { QueueItem } from '../../types';
import { Artwork } from './Artwork';
import { Disc, Equalizer } from './Disc';

interface Props {
  items: QueueItem[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** The record on the turntable, and whether it is turning. */
  currentId: string | null;
  isPlaying: boolean;
  onEmptyAction(): void;
}

const SPACING = 0.37; // distance between side records, in sleeve widths
const RENDER_RADIUS = 9; // records further than this from the selection are not drawn

function placement(offset: number, s: number): string {
  if (offset === 0) {
    // Shifted left so sleeve + pulled-out disc sit centred as a pair.
    return `translate3d(${-0.2 * s}px, ${-0.015 * s}px, ${0.3 * s}px) rotateZ(-2deg)`;
  }
  const side = Math.sign(offset);
  const x = side * (1.05 + (Math.abs(offset) - 1) * SPACING) * s;
  return `translate3d(${x}px, 0, ${-0.2 * s}px) rotateY(${-side * 66}deg)`;
}

/**
 * The record collection: a row of sleeves standing on a shelf, built from CSS
 * 3D transforms only. Select by click, drag / swipe, wheel or arrow keys.
 */
export function VinylShelf({ items, selectedId, onSelect, currentId, isPlaying, onEmptyAction }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(280);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize(Math.round(Math.max(120, Math.min((height - 44) / 1.16, width * 0.56, 400))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const index = Math.max(0, items.findIndex((i) => i.id === selectedId));
  const live = useRef({ items, index, size, onSelect });
  live.current = { items, index, size, onSelect };

  const upNextNumber = useMemo(() => {
    const map = new Map<string, number>();
    items.filter((i) => i.status === 'approved').forEach((i, n) => map.set(i.id, n + 1));
    return map;
  }, [items]);

  const selectAt = (i: number) => {
    const { items: list, index: cur, onSelect: select } = live.current;
    const clamped = Math.max(0, Math.min(list.length - 1, i));
    if (list[clamped] && clamped !== cur) select(list[clamped].id);
  };

  // Drag / swipe: every SPACING-width of travel moves the selection one record.
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const startX = e.clientX;
    const startIndex = live.current.index;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 6) dragged.current = true;
      if (dragged.current) selectAt(startIndex - Math.round(dx / (SPACING * live.current.size)));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.setTimeout(() => (dragged.current = false), 0); // after the click that follows
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  // Wheel / trackpad. Vertical wheel only drives the shelf where the page itself does not scroll.
  const wheelAcc = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 4;
      if (!horizontal && pageScrolls) return;
      e.preventDefault();
      wheelAcc.current += horizontal ? e.deltaX : e.deltaY;
      if (Math.abs(wheelAcc.current) >= 60) {
        selectAt(live.current.index + Math.sign(wheelAcc.current));
        wheelAcc.current = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') selectAt(index - 1);
    else if (e.key === 'ArrowRight') selectAt(index + 1);
    else if (e.key === 'Home') selectAt(0);
    else if (e.key === 'End') selectAt(items.length - 1);
    else return;
    e.preventDefault();
  };

  const vars = { '--s': `${size}px`, '--t': `${Math.round(size * 0.13)}px` } as CSSProperties;

  if (items.length === 0) {
    return (
      <div ref={ref} className="shelf" style={vars}>
        <div className="shelf-stage">
          {[-2, -1, 0, 1, 2].map((offset) => (
            <div
              key={offset}
              className={`record is-ghost ${offset === 0 ? 'is-selected' : ''}`}
              style={{ transform: placement(offset, size), cursor: offset === 0 ? 'pointer' : 'default' }}
              onClick={offset === 0 ? onEmptyAction : undefined}
              role={offset === 0 ? 'button' : undefined}
              tabIndex={offset === 0 ? 0 : undefined}
              onKeyDown={offset === 0 ? (e) => (e.key === 'Enter' || e.key === ' ') && onEmptyAction() : undefined}
              aria-label={offset === 0 ? 'Add the first record' : undefined}
              aria-hidden={offset === 0 ? undefined : true}
            >
              <div className="record-lift">
                <div className="record-shadow" />
                <div className="record-back" />
                <div className="record-disc">
                  <Disc />
                </div>
                <div className="record-spine left" />
                <div className="record-spine right" />
                <div className="record-front">
                  {offset === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-dashed border-current">
                        <Plus size={24} />
                      </span>
                      <span className="eyebrow">Add the first record</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="shelf-plank" />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="shelf"
      style={vars}
      tabIndex={0}
      role="listbox"
      aria-label="Record collection. Use left and right arrow keys to browse."
      aria-activedescendant={items[index] ? `record-${items[index].id}` : undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div className="shelf-stage">
        {items.map((item, i) => {
          const offset = i - index;
          if (Math.abs(offset) > RENDER_RADIUS) return null;
          const selected = offset === 0;
          const current = item.id === currentId;
          const color = spineColor(item.track.id);
          const tag =
            item.status === 'playing' ? 'NOW'
            : item.status === 'approved' ? String(upNextNumber.get(item.id) ?? '').padStart(2, '0')
            : item.status === 'pending' ? '?'
            : '✓';
          const spine = (side: 'left' | 'right') => (
            <div className={`record-spine ${side}`}>
              <div className="spine-thumb">
                <Artwork track={item.track} showText={false} />
              </div>
              <div className="spine-title">{item.track.title}</div>
              <div className="spine-tag">{tag}</div>
            </div>
          );
          return (
            <div
              key={item.id}
              id={`record-${item.id}`}
              role="option"
              aria-selected={selected}
              aria-label={`${item.track.title}${item.track.artist ? ` by ${item.track.artist}` : ''}${current ? ', now playing' : ''}`}
              className={`record ${selected ? 'is-selected' : ''} ${current ? 'is-playing' : ''}`}
              style={{ transform: placement(offset, size), '--c': color } as CSSProperties}
              onClick={() => !dragged.current && onSelect(item.id)}
            >
              <div className="record-lift">
                <div className="record-shadow" />
                <div className="record-back" />
                <div className="record-disc">
                  <Disc spinning={current && isPlaying} label={<Artwork track={item.track} showText={false} />} />
                </div>
                {offset <= 0 && spine('left')}
                {offset >= 0 && spine('right')}
                <div className="record-front">
                  <Artwork track={item.track} />
                  {current && (
                    <div className="sleeve-sticker">
                      <Equalizer on={isPlaying} />
                      {isPlaying ? 'Now spinning' : 'On the turntable'}
                    </div>
                  )}
                  {item.status === 'pending' && <div className="sleeve-sticker">Awaiting host</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="shelf-plank" />
    </div>
  );
}
