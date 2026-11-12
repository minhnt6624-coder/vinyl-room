import { rpc } from '../lib/supabase';
import type { PublicRoom, RequestMode, RoomPreview, RoomSettingsPatch, RoomState, Visibility } from '../types';

export const roomService = {
  create: (input: { name: string; visibility: Visibility; requestMode: RequestMode; displayName: string; avatar: string }) =>
    rpc<{ room_id: string; room_code: string }>('create_room', {
      p_name: input.name,
      p_visibility: input.visibility,
      p_request_mode: input.requestMode,
      p_display_name: input.displayName,
      p_avatar: input.avatar,
    }),

  preview: (code: string) => rpc<RoomPreview | null>('get_room_preview', { p_code: code }),

  join: (code: string, displayName: string, avatar: string) =>
    rpc<{ room_id: string; member_id: string; role: 'host' | 'guest' }>('join_room', {
      p_code: code,
      p_display_name: displayName,
      p_avatar: avatar,
    }),

  /** Returns the state plus serverTime - localTime, for the shared playback clock. */
  async state(roomId: string): Promise<{ state: RoomState; clockOffsetMs: number }> {
    const t0 = Date.now();
    const data = await rpc<RoomState & { server_now: string }>('get_room_state', { p_room_id: roomId });
    const t1 = Date.now();
    const { server_now, ...state } = data;
    return { state, clockOffsetMs: Date.parse(server_now) - (t0 + t1) / 2 };
  },

  listPublic: () => rpc<PublicRoom[]>('list_public_rooms'),

  updateSettings: (roomId: string, patch: RoomSettingsPatch) =>
    rpc<void>('update_room_settings', {
      p_room_id: roomId,
      p_name: patch.name ?? null,
      p_visibility: patch.visibility ?? null,
      p_request_mode: patch.request_mode ?? null,
      p_allow_requests: patch.allow_requests ?? null,
      p_allow_duplicates: patch.allow_duplicates ?? null,
    }),

  removeMember: (memberId: string) => rpc<void>('remove_member', { p_member_id: memberId }),
  leave: (roomId: string) => rpc<void>('leave_room', { p_room_id: roomId }),
  close: (roomId: string) => rpc<void>('close_room', { p_room_id: roomId }),
};
