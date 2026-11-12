import { useCallback, useEffect, useRef, useState } from 'react';
import { expectedPosition } from '../lib/format';
import { loadYouTubeApi, YT_STATE, type YTPlayer } from '../services/providers/youtubeIframe';
import type { PlayerHandle, QueueItem, Room } from '../types';

interface Options {
  room: Room | null;
  item: QueueItem | null;
  isHost: boolean;
  clockOffset: number;
  /** Host only: the local player changed state on its own (controls, buffering, drift). */
  onHostPlayback(status: 'playing' | 'paused', position: number): void;
  /** Host only: the current record finished or cannot be played. */
  onEnded(itemId: string): void;
  /** Host only: the player knows a duration the track row lacks. */
  onDuration(itemId: string, seconds: number): void;
  onPlayerError?(message: string): void;
}

// How far a player may sit from the shared timeline before it is corrected.
// The host re-anchors the room (a database write), so it gets more slack than
// a guest, who only seeks locally.
const HOST_TOLERANCE = 2;
const GUEST_TOLERANCE = 1.2;
const DRIFT_CHECK_MS = 4000;
// A slow first load looks like blocked autoplay for a few seconds; wait this
// long before asking the listener to tap.
const AUTOPLAY_GRACE_MS = 4500;

const storedVolume = () => {
  const v = Number(localStorage.getItem('vr.volume'));
  return Number.isFinite(v) && v > 0 ? Math.min(100, v) : 70;
};

/**
 * Keeps this browser's YouTube player on the room's shared timeline.
 *
 * The room row (status, position, started_at) is the single authority.
 *  - Guests only ever follow it.
 *  - The host follows it too, and additionally reports back when their real
 *    player disagrees (paused in the iframe, ended, drifted after buffering).
 * Nothing here writes on a timer: the periodic check is local and only leads
 * to a write when the host's player has actually drifted.
 */
export function usePlaybackSync(opts: Options): PlayerHandle {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const creating = useRef(false);
  const latest = useRef(opts);
  latest.current = opts;

  const [ready, setReady] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(storedVolume);
  const [muted, setMuted] = useState(false);

  const hasPlayed = useRef(false);
  const localPause = useRef(false);
  const durationReportedFor = useRef<string | null>(null);
  const pauseTimer = useRef<number | undefined>(undefined);
  const gestureTimer = useRef<number | undefined>(undefined);

  const { room, item } = opts;
  const videoId = item?.track.provider === 'youtube' ? item.track.provider_track_id : null;

  // If we asked for sound and the player still is not running shortly after,
  // the browser blocked autoplay: ask the listener for a tap.
  const armGestureCheck = useCallback(() => {
    window.clearTimeout(gestureTimer.current);
    gestureTimer.current = window.setTimeout(() => {
      const p = playerRef.current;
      if (!p || latest.current.room?.playback_status !== 'playing') return;
      const st = p.getPlayerState();
      if (st !== YT_STATE.PLAYING && st !== YT_STATE.BUFFERING) setNeedsGesture(true);
    }, AUTOPLAY_GRACE_MS);
  }, []);

  const sync = useCallback(
    (force = false) => {
      const p = playerRef.current;
      const cur = latest.current;
      if (!p || !cur.room || !cur.item || cur.item.track.provider !== 'youtube') return;
      const target = expectedPosition(cur.room, cur.clockOffset);
      const st = p.getPlayerState();

      if (cur.room.playback_status === 'playing') {
        const total = p.getDuration() || cur.item.track.duration_seconds || 0;
        if (hasPlayed.current && total > 0 && target > total + 1) {
          // The record ran out while nobody advanced it (e.g. host was away).
          if (cur.isHost) cur.onEnded(cur.item.id);
          return;
        }
        if (localPause.current && !force) return;
        if (Math.abs(p.getCurrentTime() - target) > GUEST_TOLERANCE) p.seekTo(target, true);
        if (st !== YT_STATE.PLAYING && st !== YT_STATE.BUFFERING) {
          p.playVideo();
          armGestureCheck();
        }
      } else {
        if (st === YT_STATE.PLAYING || st === YT_STATE.BUFFERING) p.pauseVideo();
        if (Math.abs(p.getCurrentTime() - target) > 1) {
          // seekTo would start a merely-cued video, so re-cue instead.
          if (st === YT_STATE.PAUSED || st === YT_STATE.PLAYING || st === YT_STATE.BUFFERING) p.seekTo(target, true);
          else p.cueVideoById({ videoId: cur.item.track.provider_track_id, startSeconds: target });
        }
      }
    },
    [armGestureCheck],
  );

  const onStateChange = useCallback(
    (state: number) => {
      const p = playerRef.current;
      const cur = latest.current;
      if (!p || !cur.item) return;
      window.clearTimeout(pauseTimer.current);

      if (state === YT_STATE.PLAYING) {
        hasPlayed.current = true;
        localPause.current = false;
        window.clearTimeout(gestureTimer.current);
        setNeedsGesture(false);
        const d = p.getDuration();
        if (d > 0) {
          setDuration(d);
          if (cur.isHost && !cur.item.track.duration_seconds && durationReportedFor.current !== cur.item.id) {
            durationReportedFor.current = cur.item.id;
            cur.onDuration(cur.item.id, d);
          }
        }
        if (cur.room?.playback_status !== 'playing') {
          // Host pressed play inside the YouTube frame: that is a real play.
          // A guest's player must not run ahead of a paused room.
          if (cur.isHost) cur.onHostPlayback('playing', p.getCurrentTime());
          else p.pauseVideo();
        }
      } else if (state === YT_STATE.PAUSED) {
        if (cur.room?.playback_status === 'playing' && hasPlayed.current) {
          // Seeking fires a brief PAUSED; wait to see whether it sticks.
          pauseTimer.current = window.setTimeout(() => {
            const now = latest.current;
            if (p.getPlayerState() !== YT_STATE.PAUSED || now.room?.playback_status !== 'playing') return;
            if (now.isHost) now.onHostPlayback('paused', p.getCurrentTime());
            else {
              localPause.current = true;
              setNeedsGesture(true);
            }
          }, 700);
        }
      } else if (state === YT_STATE.ENDED) {
        if (cur.isHost) cur.onEnded(cur.item.id);
      }
    },
    [],
  );

  // Create the player the first time a YouTube record is on the turntable.
  useEffect(() => {
    if (!videoId || playerRef.current || creating.current || !mountRef.current) return;
    creating.current = true;
    let cancelled = false;
    const isHost = latest.current.isHost;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        const el = document.createElement('div');
        mountRef.current.appendChild(el);
        const player = new YT.Player(el, {
          width: '100%',
          height: '100%',
          playerVars: {
            // Guests follow the room, so their frame has no transport controls.
            controls: isHost ? 1 : 0,
            disablekb: isHost ? 0 : 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              playerRef.current = player;
              setReady(true);
            },
            onStateChange: (e) => onStateChange(e.data),
            onError: () => {
              const cur = latest.current;
              cur.onPlayerError?.("This video can't be played here.");
              if (cur.isHost && cur.item) cur.onEnded(cur.item.id);
            },
          },
        });
      })
      .catch(() => {
        creating.current = false;
        latest.current.onPlayerError?.('The YouTube player could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, onStateChange]);

  useEffect(
    () => () => {
      window.clearTimeout(pauseTimer.current);
      window.clearTimeout(gestureTimer.current);
      try {
        playerRef.current?.destroy();
      } catch {
        /* frame already gone */
      }
      playerRef.current = null;
    },
    [],
  );

  // A different record: load it at the point the room's timeline is at.
  const itemId = item?.id ?? null;
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    const cur = latest.current;
    hasPlayed.current = false;
    localPause.current = false;
    setDuration(null);
    if (!videoId || !cur.room) {
      p.stopVideo();
      setNeedsGesture(false);
      return;
    }
    const startSeconds = expectedPosition(cur.room, cur.clockOffset);
    if (cur.room.playback_status === 'playing') {
      p.loadVideoById({ videoId, startSeconds });
      armGestureCheck();
    } else {
      p.cueVideoById({ videoId, startSeconds });
      setNeedsGesture(false);
    }
  }, [ready, itemId, videoId, armGestureCheck]);

  // Play / pause / seek from the room.
  useEffect(() => {
    if (ready) sync();
  }, [ready, sync, room?.playback_status, room?.playback_position, room?.playback_started_at]);

  // Local drift check. Guests correct themselves; the host re-anchors the room.
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const p = playerRef.current;
      const cur = latest.current;
      if (!p || !cur.room || cur.room.playback_status !== 'playing' || cur.item?.track.provider !== 'youtube') return;
      if (p.getPlayerState() !== YT_STATE.PLAYING) return;
      const drift = p.getCurrentTime() - expectedPosition(cur.room, cur.clockOffset);
      if (Math.abs(drift) < (cur.isHost ? HOST_TOLERANCE : GUEST_TOLERANCE)) return;
      if (cur.isHost) cur.onHostPlayback('playing', p.getCurrentTime());
      else sync();
    }, DRIFT_CHECK_MS);
    return () => window.clearInterval(id);
  }, [ready, sync]);

  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    p.setVolume(volume);
    if (muted) p.mute();
    else p.unMute();
  }, [ready, volume, muted]);

  const startAudio = useCallback(() => {
    localPause.current = false;
    setNeedsGesture(false);
    playerRef.current?.playVideo();
    sync(true);
    armGestureCheck();
  }, [sync, armGestureCheck]);

  const setVolume = useCallback((v: number) => {
    const next = Math.max(0, Math.min(100, Math.round(v)));
    setVolumeState(next);
    setMuted(next === 0);
    if (next > 0) localStorage.setItem('vr.volume', String(next));
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  return {
    mountRef,
    needsGesture: needsGesture && videoId !== null && room?.playback_status === 'playing',
    startAudio,
    volume,
    setVolume,
    muted,
    toggleMute,
    duration,
  };
}
