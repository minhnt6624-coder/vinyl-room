import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion';
import { Check, GripVertical, Play, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNow } from '../../hooks/useNow';
import { byPosition, formatTime, spineColor, timeAgo } from '../../lib/format';
import type { QueueItem, RoomActions } from '../../types';
import { Avatar } from '../participants/Avatar';
import { ReactionBar } from '../reactions/ReactionBar';
import { Artwork } from '../vinyl/Artwork';
import { Equalizer } from '../vinyl/Disc';

interface Props {
  queue: QueueItem[];
  meId: string;
  isHost: boolean;
  isPlaying: boolean;
  actions: RoomActions;
  onAdd(): void;
}

interface RowProps {
  item: QueueItem;
  meId: string;
  isHost: boolean;
  isPlaying?: boolean;
  now: number;
  actions: RoomActions;
  handle?: ReactNode;
}

function RowBody({ item, meId, isHost, isPlaying, now, actions, handle }: RowProps) {
  const mine = item.requested_by === meId;
  return (
    <div className="flex gap-3 py-3">
      {handle}
      <div className="relative h-14 w-14 flex-none overflow-hidden rounded-sm shadow-soft" style={{ '--c': spineColor(item.track.id) } as CSSProperties}>
        <Artwork track={item.track} showText={false} />
        {item.status === 'playing' && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink/45 text-cream">
            <Equalizer on={Boolean(isPlaying)} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-snug">{item.track.title}</div>
            <div className="truncate text-xs text-ink-soft">
              {item.track.artist ?? 'Unknown artist'}
              {item.track.duration_seconds ? ` · ${formatTime(item.track.duration_seconds)}` : ''}
            </div>
          </div>
          <div className="-my-1 flex flex-none items-center">
            {isHost && item.status === 'pending' && (
              <>
                <button className="icon-btn text-moss" onClick={() => actions.approve(item.id)} aria-label={`Approve ${item.track.title}`} title="Approve">
                  <Check size={18} />
                </button>
                <button className="icon-btn text-vermilion" onClick={() => actions.reject(item.id)} aria-label={`Reject ${item.track.title}`} title="Reject">
                  <X size={18} />
                </button>
              </>
            )}
            {isHost && (item.status === 'approved' || item.status === 'played') && (
              <button className="icon-btn" onClick={() => actions.playItem(item.id)} aria-label={`Play ${item.track.title} now`} title="Play now">
                <Play size={16} />
              </button>
            )}
            {isHost && item.status === 'approved' && (
              <button className="icon-btn text-vermilion" onClick={() => actions.remove(item.id)} aria-label={`Remove ${item.track.title}`} title="Remove">
                <Trash2 size={16} />
              </button>
            )}
            {!isHost && mine && (item.status === 'pending' || item.status === 'approved') && (
              <button className="icon-btn text-vermilion" onClick={() => actions.cancel(item.id)} aria-label={`Withdraw ${item.track.title}`} title="Withdraw my request">
                <Undo2 size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-soft">
          <Avatar avatar={item.requester_avatar} name={item.requester_name} size={16} className="!ring-0" />
          <span className="truncate">
            {mine ? 'You' : (item.requester_name ?? 'Someone')} · {timeAgo(item.requested_at, now)}
          </span>
        </div>
        <div className="mt-1.5">
          <ReactionBar item={item} onReact={(t) => actions.react(item.id, t)} compact />
        </div>
      </div>
    </div>
  );
}

function DraggableRow(props: RowProps & { onDrop(): void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={props.item.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={props.onDrop}
      className="relative border-b border-line bg-paper"
      whileDrag={{ scale: 1.02, boxShadow: '0 10px 30px -8px rgba(70,40,15,.35)', zIndex: 2 }}
    >
      <RowBody
        {...props}
        handle={
          <button
            className="-ml-2 flex w-7 flex-none cursor-grab touch-none items-center justify-center text-ink-soft active:cursor-grabbing"
            onPointerDown={(e) => controls.start(e)}
            aria-label={`Drag to reorder ${props.item.track.title}`}
          >
            <GripVertical size={16} />
          </button>
        }
      />
    </Reorder.Item>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="eyebrow flex items-center gap-2 border-b-[1.5px] border-ink pb-2">
        {title}
        {count !== undefined && <span className="text-ink-soft">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

export function QueuePanel({ queue, meId, isHost, isPlaying, actions, onAdd }: Props) {
  const now = useNow(30000);
  const current = queue.find((q) => q.status === 'playing') ?? null;
  const pending = useMemo(() => queue.filter((q) => q.status === 'pending').sort(byPosition), [queue]);
  const upNext = useMemo(() => queue.filter((q) => q.status === 'approved').sort(byPosition), [queue]);
  const played = useMemo(
    () => queue.filter((q) => q.status === 'played').sort((a, b) => (b.played_at ?? '').localeCompare(a.played_at ?? '')).slice(0, 12),
    [queue],
  );
  const byId = useMemo(() => new Map(queue.map((q) => [q.id, q])), [queue]);

  // Host drag order: local while dragging, committed on drop, replaced when the server order changes.
  const serverOrder = upNext.map((q) => q.id);
  const serverKey = serverOrder.join(',');
  const [order, setOrder] = useState(serverOrder);
  const orderRef = useRef(order);
  orderRef.current = order;
  useEffect(() => setOrder(serverKey ? serverKey.split(',') : []), [serverKey]);
  const commitOrder = () => {
    if (orderRef.current.join(',') !== serverKey) actions.reorder(orderRef.current);
  };

  const common = { meId, isHost, now, actions };
  const rowMotion = {
    layout: true,
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, x: 24 },
    transition: { duration: 0.22 },
  } as const;

  if (!current && !pending.length && !upNext.length && !played.length) {
    return (
      <div className="flex flex-col items-center py-14 text-center">
        <p className="font-display text-3xl">The queue is empty</p>
        <p className="mt-2 max-w-xs text-sm text-ink-soft">Search for a song or paste a link, and it lands here for everyone in the room.</p>
        <button className="btn btn-primary mt-6" onClick={onAdd}>
          Add a record
        </button>
      </div>
    );
  }

  return (
    <div>
      {current && (
        <Section title="Now playing">
          <RowBody item={current} isPlaying={isPlaying} {...common} />
        </Section>
      )}

      {pending.length > 0 && (
        <Section title={isHost ? 'Waiting for your approval' : 'Waiting for the host'} count={pending.length}>
          <ul>
            <AnimatePresence initial={false}>
              {pending.map((item) => (
                <motion.li key={item.id} {...rowMotion} className="border-b border-line">
                  <RowBody item={item} {...common} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Section>
      )}

      <Section title="Up next" count={upNext.length}>
        {upNext.length === 0 ? (
          <p className="py-5 text-sm text-ink-soft">
            Nothing lined up.{' '}
            <button className="text-indigo underline underline-offset-2" onClick={onAdd}>
              Add a record
            </button>
          </p>
        ) : isHost ? (
          <Reorder.Group as="ul" axis="y" values={order} onReorder={setOrder}>
            {order.map((id) => {
              const item = byId.get(id);
              return item ? <DraggableRow key={id} item={item} onDrop={commitOrder} {...common} /> : null;
            })}
          </Reorder.Group>
        ) : (
          <ul>
            <AnimatePresence initial={false}>
              {upNext.map((item) => (
                <motion.li key={item.id} {...rowMotion} className="border-b border-line">
                  <RowBody item={item} {...common} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Section>

      {played.length > 0 && (
        <Section title="Played earlier" count={played.length}>
          <ul className="opacity-75">
            {played.map((item) => (
              <li key={item.id} className="border-b border-line">
                <RowBody item={item} {...common} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
