import { rpc } from '../lib/supabase';

// Host-only. The database rejects these calls from anyone else.
export const playbackService = {
  /**
   * expectedCurrent: the record the position was measured on. The database
   * ignores the call if the room has moved on. Left out (undefined) on a
   * database that does not know the argument yet.
   */
  set: (roomId: string, status: 'playing' | 'paused', position: number, expectedCurrent?: string | null) =>
    rpc<void>('set_playback', {
      p_room_id: roomId,
      p_status: status,
      p_position: position,
      ...(expectedCurrent === undefined ? {} : { p_expected_current: expectedCurrent }),
    }),
  /** expectedCurrent makes the advance idempotent (see play_next in the migration). */
  next: (roomId: string, expectedCurrent: string | null = null) =>
    rpc<void>('play_next', { p_room_id: roomId, p_expected_current: expectedCurrent }),
  previous: (roomId: string) => rpc<void>('play_previous', { p_room_id: roomId }),
  playItem: (itemId: string) => rpc<void>('play_item', { p_item_id: itemId }),
  reportDuration: (itemId: string, seconds: number) =>
    rpc<void>('set_track_duration', { p_item_id: itemId, p_duration_seconds: Math.round(seconds) }),
};
