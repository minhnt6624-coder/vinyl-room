import { rpc } from '../lib/supabase';
import type { TrackCandidate } from '../types';

export const queueService = {
  request: (roomId: string, c: TrackCandidate) =>
    rpc<{ item_id: string; status: 'approved' | 'pending' }>('request_track', {
      p_room_id: roomId,
      p_provider: c.provider,
      p_provider_track_id: c.providerTrackId,
      p_title: c.title,
      p_artist: c.artist,
      p_album: c.album,
      p_artwork_url: c.artworkUrl,
      p_duration_seconds: c.durationSeconds ? Math.round(c.durationSeconds) : null,
    }),
  review: (itemId: string, approve: boolean) => rpc<void>('review_request', { p_item_id: itemId, p_approve: approve }),
  cancel: (itemId: string) => rpc<void>('cancel_request', { p_item_id: itemId }),
  remove: (itemId: string) => rpc<void>('remove_queue_item', { p_item_id: itemId }),
  reorder: (roomId: string, itemIds: string[]) => rpc<void>('reorder_queue', { p_room_id: roomId, p_item_ids: itemIds }),
};
