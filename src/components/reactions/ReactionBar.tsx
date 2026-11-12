import { REACTIONS } from '../../config';
import type { QueueItem, ReactionType } from '../../types';

interface Props {
  item: Pick<QueueItem, 'reaction_counts' | 'my_reactions'>;
  onReact(type: ReactionType): void;
  compact?: boolean;
}

export function ReactionBar({ item, onReact, compact = false }: Props) {
  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'justify-center gap-2'}`} role="group" aria-label="Reactions">
      {REACTIONS.map((r) => {
        const count = item.reaction_counts[r.type] ?? 0;
        const mine = item.my_reactions.includes(r.type);
        return (
          <button
            key={r.type}
            onClick={() => onReact(r.type)}
            aria-pressed={mine}
            aria-label={`${r.label}${count ? `, ${count}` : ''}`}
            title={r.label}
            className={`inline-flex items-center gap-1 rounded-full border transition-all active:scale-90 ${
              compact ? 'h-7 px-2 text-sm' : 'h-10 px-3.5 text-lg'
            } ${mine ? 'border-indigo bg-indigo/10' : 'border-transparent bg-cream/70 hover:bg-cream'} ${
              compact && !count && !mine ? 'opacity-45 hover:opacity-100' : ''
            }`}
          >
            <span aria-hidden="true">{r.emoji}</span>
            {count > 0 && <span className={`font-medium tabular-nums ${compact ? 'text-[11px]' : 'text-xs'}`}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
