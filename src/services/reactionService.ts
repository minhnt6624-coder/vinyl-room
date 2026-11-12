import { rpc } from '../lib/supabase';
import type { ReactionType } from '../types';

export const reactionService = {
  toggle: (itemId: string, type: ReactionType) =>
    rpc<{ active: boolean }>('toggle_reaction', { p_item_id: itemId, p_reaction_type: type }),
};
