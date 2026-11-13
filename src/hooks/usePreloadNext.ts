import { useEffect, useState } from 'react';
import { expectedPosition } from '../lib/format';
import { lyricsService } from '../services/lyricsService';
import { getProvider } from '../services/providers';
import type { QueueItem, Room } from '../types';

/** Get the next record ready when this much of the current one is left. */
const PRELOAD_BEFORE_END_S = 20;

interface Options {
  room: Room | null;
  item: QueueItem | null;
  next: QueueItem | null;
  clockOffset: number;
  /** Duration reported by the player, when the track has none stored. */
  playerDuration: number | null;
  isHost: boolean;
  refetch(): unknown;
}

/**
 * Shortens the wait between two records. About 20 seconds before the current
 * one ends:
 *  - every browser downloads the next record's cover, so it is on screen the
 *    moment the record changes;
 *  - the host makes sure the next record has a stored length. A pasted
 *    YouTube link has none until it plays, and the fade-out needs it to be the
 *    same number in every browser from the first second. The `lyrics` Edge
 *    Function already asks YouTube for a missing length and stores it, so the
 *    host looks the lyrics up early (which the room is likely to want anyway).
 *
 * There is still exactly one player on the page; nothing is buffered ahead.
 */
export function usePreloadNext({ room, item, next, clockOffset, playerDuration, isHost, refetch }: Options): void {
  const provider = item ? getProvider(item.track.provider) : null;
  const duration = item && provider?.capabilities.syncedPlayback ? (provider.getDuration(item.track) ?? playerDuration) : null;
  const status = room?.playback_status ?? 'idle';
  const position = room?.playback_position ?? 0;
  const startedAt = room?.playback_started_at ?? null;

  // The id of the record whose last stretch has begun.
  const [nearEndOf, setNearEndOf] = useState<string | null>(null);
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!itemId || duration === null) return;
    const left = duration - PRELOAD_BEFORE_END_S - expectedPosition({ playback_status: status, playback_position: position, playback_started_at: startedAt }, clockOffset);
    if (left <= 0) {
      setNearEndOf(itemId);
      return;
    }
    if (status !== 'playing') return;
    const timer = window.setTimeout(() => setNearEndOf(itemId), left * 1000);
    return () => window.clearTimeout(timer);
  }, [itemId, duration, status, position, startedAt, clockOffset]);

  const near = itemId !== null && nearEndOf === itemId;
  const nextTrack = next?.track ?? null;
  const artwork = nextTrack ? getProvider(nextTrack.provider).getArtwork(nextTrack) : null;

  useEffect(() => {
    if (!near || !artwork) return;
    const image = new Image();
    image.referrerPolicy = 'no-referrer'; // as Artwork requests it, so the cached copy is reused
    image.src = artwork;
  }, [near, artwork]);

  const needsDuration = isHost && nextTrack !== null && nextTrack.provider === 'youtube' && nextTrack.duration_seconds === null;
  const nextId = nextTrack?.id ?? null;
  const nextArtist = nextTrack?.artist ?? null;
  useEffect(() => {
    if (!near || !needsDuration || !nextId) return;
    let alive = true;
    lyricsService
      .load({ id: nextId, provider: 'youtube', artist: nextArtist, duration_seconds: null })
      .catch(() => {}) // no lyrics, or no duration: the host's player reports it once the record plays
      .then(() => alive && refetch());
    return () => {
      alive = false;
    };
  }, [near, needsDuration, nextId, nextArtist, refetch]);
}
