import type { QueueItem, Room } from '../types';

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '–:––';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const diff = Math.max(0, (nowMs - Date.parse(iso)) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

/**
 * Where the room's shared timeline is right now, in seconds.
 * clockOffsetMs = serverTime - localTime, measured when room state was fetched.
 */
export function expectedPosition(room: Pick<Room, 'playback_status' | 'playback_position' | 'playback_started_at'>, clockOffsetMs: number): number {
  if (room.playback_status === 'playing' && room.playback_started_at) {
    const elapsed = (Date.now() + clockOffsetMs - Date.parse(room.playback_started_at)) / 1000;
    return room.playback_position + Math.max(0, elapsed);
  }
  return room.playback_position;
}

const SPINE_COLORS = [
  '#3f7d6e', '#b5553c', '#8a8273', '#7b6a9a', '#7f8a4f', '#c08a2e', '#5f7f93',
  '#a23b4a', '#6a4c7d', '#c9a23f', '#4f6b8f', '#9b5f3a', '#56795a', '#b8734f',
];

/** Stable colour per track, so a record looks the same on every screen and render. */
export function spineColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SPINE_COLORS[h % SPINE_COLORS.length];
}

export const byPosition = (a: QueueItem, b: QueueItem) =>
  a.position - b.position || a.requested_at.localeCompare(b.requested_at);

/** Shelf order: what has played (oldest first), what is playing, then what is coming. */
export function shelfOrder(queue: QueueItem[]): QueueItem[] {
  const played = queue
    .filter((q) => q.status === 'played')
    .sort((a, b) => (a.played_at ?? '').localeCompare(b.played_at ?? ''));
  const playing = queue.filter((q) => q.status === 'playing');
  const approved = queue.filter((q) => q.status === 'approved').sort(byPosition);
  const pending = queue.filter((q) => q.status === 'pending').sort(byPosition);
  return [...played, ...playing, ...approved, ...pending];
}
