export type ProviderId = 'youtube' | 'spotify' | 'soundcloud';
export type QueueStatus = 'pending' | 'approved' | 'playing' | 'played' | 'rejected' | 'removed';
export type ReactionType = 'love' | 'fire' | 'vibe' | 'funny' | 'clap';
export type PlaybackStatus = 'idle' | 'playing' | 'paused';
export type Visibility = 'public' | 'private';
export type RequestMode = 'auto' | 'approval';

export interface Track {
  id: string;
  provider: ProviderId;
  provider_track_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  artwork_url: string | null;
  duration_seconds: number | null;
  external_url: string;
}

export interface QueueItem {
  id: string;
  status: QueueStatus;
  position: number;
  requested_at: string;
  played_at: string | null;
  reaction_counts: Partial<Record<ReactionType, number>>;
  my_reactions: ReactionType[];
  requested_by: string | null;
  requester_name: string | null;
  requester_avatar: string | null;
  track: Track;
}

export interface Member {
  id: string;
  display_name: string;
  avatar: string;
  role: 'host' | 'guest';
  joined_at: string;
}

export interface Room {
  id: string;
  room_code: string;
  name: string;
  host_id: string;
  visibility: Visibility;
  request_mode: RequestMode;
  allow_requests: boolean;
  allow_duplicates: boolean;
  status: 'open' | 'closed';
  current_item_id: string | null;
  playback_status: PlaybackStatus;
  playback_position: number;
  playback_started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomState {
  room: Room;
  me: { id: string; role: 'host' | 'guest'; display_name: string; avatar: string };
  members: Member[];
  queue: QueueItem[];
}

export interface RoomPreview {
  id: string;
  room_code: string;
  name: string;
  status: 'open' | 'closed';
  request_mode: RequestMode;
  host_name: string | null;
  host_avatar: string | null;
  member_count: number;
  my_status: 'active' | 'left' | 'removed' | null;
  is_host: boolean;
}

export interface PublicRoom {
  room_code: string;
  name: string;
  member_count: number;
  now_playing: string | null;
}

/** A track as a provider describes it, before it is stored in a room. */
export interface TrackCandidate {
  provider: ProviderId;
  providerTrackId: string;
  title: string;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  durationSeconds: number | null;
  externalUrl: string;
}

export interface RoomSettingsPatch {
  name?: string;
  visibility?: Visibility;
  request_mode?: RequestMode;
  allow_requests?: boolean;
  allow_duplicates?: boolean;
}

/** Everything the room UI can ask for. Implemented against Supabase RPCs. */
export interface RoomActions {
  requestTrack(candidate: TrackCandidate): Promise<boolean>;
  approve(itemId: string): void;
  reject(itemId: string): void;
  cancel(itemId: string): void;
  remove(itemId: string): void;
  reorder(itemIds: string[]): void;
  playItem(itemId: string): void;
  next(): void;
  previous(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  react(itemId: string, type: ReactionType): void;
  updateSettings(patch: RoomSettingsPatch): void;
  removeMember(memberId: string): void;
  closeRoom(): void;
  leaveRoom(): void;
}

/** The local audio output of this browser (never shared state). */
export interface PlayerHandle {
  mountRef: React.RefObject<HTMLDivElement | null>;
  /** True when the browser blocked autoplay or the listener paused locally. */
  needsGesture: boolean;
  startAudio(): void;
  volume: number;
  setVolume(v: number): void;
  muted: boolean;
  toggleMute(): void;
  /** Duration reported by the player, when the track has none stored. */
  duration: number | null;
}
