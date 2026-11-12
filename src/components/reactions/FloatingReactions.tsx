import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { REACTIONS } from '../../config';
import type { QueueItem, ReactionType } from '../../types';

interface Float {
  id: number;
  emoji: string;
  left: number;
  dx: number;
}

const EMOJI = Object.fromEntries(REACTIONS.map((r) => [r.type, r.emoji])) as Record<ReactionType, string>;

/**
 * Lets reactions drift up the screen. It watches the shared reaction counts,
 * so a float appears on every client whenever anyone's reaction lands.
 */
export function FloatingReactions({ queue }: { queue: QueueItem[] }) {
  const [floats, setFloats] = useState<Float[]>([]);
  const previous = useRef<Map<string, Partial<Record<ReactionType, number>>> | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(queue.map((q) => [q.id, q.reaction_counts]));
    if (!before) return; // first load: nothing is new

    const added: string[] = [];
    for (const item of queue) {
      const old = before.get(item.id) ?? {};
      for (const r of REACTIONS) {
        const gain = (item.reaction_counts[r.type] ?? 0) - (old[r.type] ?? 0);
        for (let i = 0; i < Math.min(gain, 3); i++) added.push(EMOJI[r.type]);
      }
    }
    if (!added.length) return;

    const fresh = added.slice(0, 6).map((emoji) => ({
      id: nextId.current++,
      emoji,
      left: 30 + Math.random() * 40,
      dx: Math.round(Math.random() * 80 - 40),
    }));
    setFloats((f) => [...f, ...fresh]);
    const ids = new Set(fresh.map((f) => f.id));
    // Not cancelled on re-render: each batch must still be cleared when new reactions keep arriving.
    window.setTimeout(() => setFloats((f) => f.filter((x) => !ids.has(x.id))), 2500);
  }, [queue]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-40 z-40 h-0" aria-hidden="true">
      {floats.map((f) => (
        <span key={f.id} className="float-reaction" style={{ left: `${f.left}%`, '--dx': `${f.dx}px` } as CSSProperties}>
          {f.emoji}
        </span>
      ))}
    </div>
  );
}
