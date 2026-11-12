import { AnimatePresence, motion } from 'framer-motion';
import { Crown, UserMinus } from 'lucide-react';
import type { Member } from '../../types';
import { Avatar } from './Avatar';

/** Overlapping avatars for the header. Opens the people list. */
export function AvatarStack({ members, onlineIds, onClick }: { members: Member[]; onlineIds: Set<string>; onClick(): void }) {
  const shown = members.slice(0, 4);
  const online = members.filter((m) => onlineIds.has(m.id)).length;
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-ink/5" aria-label={`${members.length} people in the room. Show list.`}>
      <span className="flex -space-x-2">
        <AnimatePresence initial={false}>
          {shown.map((m) => (
            <motion.span key={m.id} layout initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} className="hidden sm:inline-flex">
              <Avatar avatar={m.avatar} name={m.display_name} size={30} />
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
      <span className="eyebrow whitespace-nowrap">
        {members.length > 4 && <span className="hidden sm:inline">+{members.length - 4} · </span>}
        {online || members.length} listening
      </span>
    </button>
  );
}

interface ListProps {
  members: Member[];
  onlineIds: Set<string>;
  meId: string;
  isHost: boolean;
  onRemove(memberId: string): void;
}

export function MemberList({ members, onlineIds, meId, isHost, onRemove }: ListProps) {
  return (
    <ul className="flex flex-col">
      <AnimatePresence initial={false}>
        {members.map((m) => {
          const online = onlineIds.has(m.id) || m.id === meId;
          return (
            <motion.li
              key={m.id}
              layout
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              className="flex items-center gap-3 border-b border-line py-3"
            >
              <Avatar avatar={m.avatar} name={m.display_name} size={40} online={online} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{m.display_name}</span>
                  {m.id === meId && <span className="text-xs text-ink-soft">(you)</span>}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-ink-soft">
                  {m.role === 'host' && (
                    <span className="inline-flex items-center gap-1 font-medium text-indigo">
                      <Crown size={12} /> Host ·
                    </span>
                  )}
                  {online ? 'Listening now' : 'Away'}
                </div>
              </div>
              {isHost && m.role !== 'host' && (
                <button className="icon-btn text-vermilion" onClick={() => onRemove(m.id)} aria-label={`Remove ${m.display_name} from the room`} title="Remove from room">
                  <UserMinus size={18} />
                </button>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
