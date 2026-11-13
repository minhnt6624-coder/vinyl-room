import { useCallback, useEffect, useRef, useState } from 'react';
import { baseTolerance, evaluateDrift, initialDriftState, nextTrackState, noteCorrection, toleranceFor, updateAnchorLead } from '../lib/driftPolicy';
import { expectedPosition } from '../lib/format';
import { monotonicNow } from '../lib/monotonic';
import { changeKind, fadeInGainAt, fadeInSeconds, fadeOutGainAt, fadeOutWindow, scaledVolume, type FadeWindow } from '../lib/transition';
import { loadYouTubeApi, YT_STATE, type YTPlayer } from '../services/providers/youtubeIframe';
import type { PlayerHandle, QueueItem, Room } from '../types';

interface Options {
  room: Room | null;
  item: QueueItem | null;
  isHost: boolean;
  clockOffset: number;
  /** The server clock has enough good samples for the tight tolerance. */
  clockCalibrated: boolean;
  /** Length of the fade between records, in seconds. 0: records change as they always did. */
  transitionSeconds: number;
  /** The record that plays after this one, if any. */
  nextItemId: string | null;
  /** Host only: the local player changed state on its own (controls, buffering, drift). `itemId` is the record the position was read from. */
  onHostPlayback(status: 'playing' | 'paused', position: number, itemId: string): void;
  /** Host only: the current record finished or cannot be played. */
  onEnded(itemId: string): void;
  /** Host only: the player knows a duration the track row lacks. */
  onDuration(itemId: string, seconds: number): void;
  onPlayerError?(message: string): void;
}

// How often the local player is compared with the shared timeline. Whether a
// difference is acted on is decided by lib/driftPolicy.
const DRIFT_CHECK_MS = 2000;
// A slow first load looks like blocked autoplay for a few seconds; wait this
// long before asking the listener to tap.
const AUTOPLAY_GRACE_MS = 4500;
// How often the volume is recomputed while transitions are on.
const FADE_TICK_MS = 50;
// A seek this large during a fade-in is a command from the host, not drift.
const FADE_IN_SEEK_SECONDS = 3;
// The host ends a record by the clock only while its own player is this close to the timeline.
const HOST_AGREEMENT_SECONDS = 1.5;
// How long the player gets to report a volume that was just set.
const VOLUME_PROBE_MS = 600;

// iOS and iPadOS leave volume to the hardware buttons: setVolume does nothing.
const isAppleTouch = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

interface FadeIn {
  itemId: string;
  seconds: number;
  /** performance.now() when this browser's player started playing the record; null while it loads. */
  audibleAt: number | null;
}

interface Timeline {
  itemId: string;
  room: Room;
  clockOffset: number;
  duration: number | null;
  nextItemId: string | null;
}

/**
 * Dev builds only: with localStorage['vr.dev.fadelog'] set, volume changes and
 * player states are kept on window.__vrFadeLog, stamped with server time, so
 * a test can compare browsers. Compiled out of production builds.
 */
function devLog(clockOffset: number, entry: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  try {
    if (!localStorage.getItem('vr.dev.fadelog')) return;
    const w = window as unknown as { __vrFadeLog?: unknown[] };
    (w.__vrFadeLog ??= []).push({ t: Math.round(monotonicNow() + clockOffset), local: Date.now(), offset: Math.round(clockOffset), ...entry });
  } catch {
    /* storage blocked */
  }
}

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
 *
 * How far apart is too far, how often a correction may happen and how far
 * ahead to seek are decided by lib/driftPolicy, not here.
 *
 * Smooth transitions (lib/transition): the volume sent to the player is the
 * listener's volume times a gain. The fade-out gain is a function of the
 * shared timeline, so the whole room fades together; when it reaches silence
 * the host advances the room, and the new record fades in. There is only ever
 * one player: two tracks never overlap.
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
  const drift = useRef(initialDriftState());
  const anchorLead = useRef(0);
  const anchorPending = useRef(false);

  // Transitions. canFade is null until the player has shown it obeys setVolume.
  const canFade = useRef<boolean | null>(null);
  const probing = useRef(false);
  /** The record the track-change effect has set the fade-in up for. */
  const preparedFor = useRef<string | null>(null);
  const fadeIn = useRef<FadeIn | null>(null);
  const appliedVolume = useRef<number | null>(null);
  const lastGain = useRef(1);
  const advancedFor = useRef<string | null>(null);
  const timeline = useRef<Timeline | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const { room, item } = opts;
  const videoId = item?.track.provider === 'youtube' ? item.track.provider_track_id : null;

  /** The track's length as every client knows it: the stored one, else the player's, rounded the way the host stores it. */
  const sharedDuration = useCallback((): number | null => {
    const stored = latest.current.item?.track.duration_seconds;
    if (stored) return stored;
    // Until the new record has played, the player still reports the last one's length.
    if (!hasPlayed.current) return null;
    const reported = playerRef.current?.getDuration() ?? 0;
    return reported > 0 ? Math.round(reported) : null;
  }, []);

  /** Where the current record fades out, or null if it does not. */
  const currentWindow = useCallback((): FadeWindow | null => {
    const cur = latest.current;
    if (cur.transitionSeconds <= 0 || !cur.nextItemId || cur.item?.track.provider !== 'youtube') return null;
    return fadeOutWindow(sharedDuration(), cur.transitionSeconds);
  }, [sharedDuration]);

  /** True while the new record is still fading in on this browser. */
  const fadingIn = useCallback((): boolean => {
    const f = fadeIn.current;
    if (!f || f.itemId !== latest.current.item?.id) return false;
    if (f.audibleAt === null) return lastGain.current < 1;
    return performance.now() - f.audibleAt < f.seconds * 1000;
  }, []);

  const gainNow = useCallback((): number => {
    const cur = latest.current;
    if (canFade.current !== true || cur.transitionSeconds <= 0) return 1;
    if (!cur.room || !cur.item || cur.item.track.provider !== 'youtube') return 1;
    // The room row can arrive a moment before the queue does. Until both
    // describe the same record the timeline is not this track's: hold still.
    if (cur.room.current_item_id !== cur.item.id) return lastGain.current;
    // Likewise between the render that brings a new record and the effect
    // that decides whether it fades in: a tick in that gap must not open the
    // volume on a record that is about to start silent.
    if (preparedFor.current !== cur.item.id) return lastGain.current;
    const position = expectedPosition(cur.room, cur.clockOffset);
    let gain = fadeOutGainAt(position, currentWindow());
    const f = fadeIn.current;
    if (f && f.itemId === cur.item.id) {
      const fade = fadeInGainAt(f.audibleAt === null ? null : (performance.now() - f.audibleAt) / 1000, f.seconds, position);
      // Given up on (the player took too long to start): the volume is back,
      // and it stays back rather than dipping when the player finally plays.
      if (f.audibleAt === null && fade === 1) fadeIn.current = null;
      gain *= fade;
    }
    return gain;
  }, [currentWindow]);

  /** Sends `listener volume x gain` to the player, only when the number changes. */
  const applyVolume = useCallback(() => {
    const p = playerRef.current;
    if (!p || probing.current) return;
    const gain = gainNow();
    lastGain.current = gain;
    const value = scaledVolume(volumeRef.current, gain);
    if (value === appliedVolume.current) return;
    appliedVolume.current = value;
    p.setVolume(value);
    devLog(latest.current.clockOffset, { volume: value, gain: Math.round(gain * 1000) / 1000, item: latest.current.item?.id });
  }, [gainNow]);

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
      // The room already points at another record but the queue has not
      // caught up: this timeline belongs to a track that is not loaded yet.
      if (cur.room.current_item_id && cur.room.current_item_id !== cur.item.id) return;
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
        // A command from the room (play, seek, re-anchor). Not subject to the
        // cooldown, but it starts one, so the drift check does not seek again
        // while this one is still buffering.
        // While the record fades in, a seek would be heard as a stutter: only a
        // real jump (the host scrubbing) goes through.
        const tolerance = fadingIn() ? FADE_IN_SEEK_SECONDS : toleranceFor(drift.current, baseTolerance(cur.isHost, cur.clockCalibrated));
        if (Math.abs(p.getCurrentTime() - target) > tolerance) {
          p.seekTo(target + (cur.isHost ? 0 : drift.current.lead), true);
          drift.current = noteCorrection(drift.current, performance.now());
        }
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
    [armGestureCheck, fadingIn],
  );

  const onStateChange = useCallback(
    (state: number) => {
      const p = playerRef.current;
      const cur = latest.current;
      if (!p || !cur.item) return;
      window.clearTimeout(pauseTimer.current);

      devLog(cur.clockOffset, { state, item: cur.item.id });
      if (state === YT_STATE.PLAYING) {
        hasPlayed.current = true;
        localPause.current = false;
        // The fade-in runs from the moment this browser can actually be heard.
        const f = fadeIn.current;
        if (f && f.itemId === cur.item.id && f.audibleAt === null) {
          f.audibleAt = performance.now();
          applyVolume();
        }
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
          if (cur.isHost) cur.onHostPlayback('playing', p.getCurrentTime(), cur.item.id);
          else p.pauseVideo();
        }
      } else if (state === YT_STATE.PAUSED) {
        if (cur.room?.playback_status === 'playing' && hasPlayed.current) {
          // Seeking fires a brief PAUSED; wait to see whether it sticks.
          pauseTimer.current = window.setTimeout(() => {
            const now = latest.current;
            if (p.getPlayerState() !== YT_STATE.PAUSED || now.room?.playback_status !== 'playing') return;
            if (now.isHost && now.item) now.onHostPlayback('paused', p.getCurrentTime(), now.item.id);
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
    [applyVolume],
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
              // Can this browser fade at all? Set a volume and see whether the
              // player reports it back. iOS ignores setVolume altogether.
              if (isAppleTouch() || typeof player.getVolume !== 'function') canFade.current = false;
              else {
                // A value a little off the listener's own, held just long
                // enough for the player to report it.
                const probe = volumeRef.current > 50 ? volumeRef.current - 9 : volumeRef.current + 9;
                probing.current = true;
                player.setVolume(probe);
                window.setTimeout(() => {
                  probing.current = false;
                  if (playerRef.current !== player) return;
                  canFade.current = Math.abs(player.getVolume() - probe) <= 1;
                  devLog(latest.current.clockOffset, { canFade: canFade.current });
                  appliedVolume.current = null;
                  applyVolume();
                }, VOLUME_PROBE_MS);
              }
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
  }, [videoId, onStateChange, applyVolume]);

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
    drift.current = nextTrackState(drift.current);
    setDuration(null);

    // Does this record fade in? That depends on how the last one ended, read
    // from the timeline as it stood just before the change.
    const before = timeline.current;
    let fadeSeconds = 0;
    if (itemId && before && before.itemId !== itemId && canFade.current === true && cur.transitionSeconds > 0) {
      const kind = changeKind(
        {
          position: expectedPosition(before.room, before.clockOffset),
          duration: before.duration,
          window: before.nextItemId ? fadeOutWindow(before.duration, cur.transitionSeconds) : null,
          nextItemId: before.nextItemId,
        },
        itemId,
      );
      fadeSeconds = fadeInSeconds(kind, cur.transitionSeconds);
      devLog(cur.clockOffset, { change: kind, fadeIn: fadeSeconds, item: itemId });
    }
    preparedFor.current = itemId;
    fadeIn.current = itemId && videoId && fadeSeconds > 0 && cur.room?.playback_status === 'playing' ? { itemId, seconds: fadeSeconds, audibleAt: null } : null;
    appliedVolume.current = null;
    applyVolume(); // 0 when a fade-in is coming, so the record loads silently

    if (!videoId || !cur.room) {
      p.stopVideo();
      setNeedsGesture(false);
      return;
    }
    const startSeconds = expectedPosition(cur.room, cur.clockOffset);
    if (cur.room.playback_status === 'playing') {
      // A guest aims ahead by what loading usually costs it; the host's start
      // defines the timeline, so it does not.
      p.loadVideoById({ videoId, startSeconds: startSeconds + (cur.isHost ? 0 : drift.current.lead) });
      // The first measurement after loading shows how long loading took, which
      // is what the lead should learn. No cooldown: a slow start is fixed at once.
      if (!cur.isHost) drift.current = { ...drift.current, awaitingResult: true };
      armGestureCheck();
    } else {
      p.cueVideoById({ videoId, startSeconds });
      setNeedsGesture(false);
    }
  }, [ready, itemId, videoId, armGestureCheck, applyVolume]);

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
      if (cur.room.current_item_id !== cur.item.id) return;
      if (p.getPlayerState() !== YT_STATE.PLAYING) return;
      // No corrections while the record fades in: the drift policy picks up
      // where it left off (its first measurement still teaches the lead).
      if (fadingIn()) return;
      const expected = expectedPosition(cur.room, cur.clockOffset);
      const measured = p.getCurrentTime() - expected;
      // The first look after a host re-anchor shows how long that request took.
      if (anchorPending.current) {
        anchorPending.current = false;
        anchorLead.current = updateAnchorLead(anchorLead.current, measured);
      }
      const decision = evaluateDrift(drift.current, measured, performance.now(), baseTolerance(cur.isHost, cur.clockCalibrated));
      drift.current = decision.state;
      if (!decision.correct) return;
      // The host's player is the truth: move the room's timeline to it.
      // A guest moves its own player, aiming ahead to land on time.
      if (cur.isHost) {
        anchorPending.current = true;
        cur.onHostPlayback('playing', p.getCurrentTime() + anchorLead.current, cur.item.id);
      } else p.seekTo(expected + decision.state.lead, true);
    }, DRIFT_CHECK_MS);
    return () => window.clearInterval(id);
  }, [ready, fadingIn]);

  // Remember the timeline of the record that is on, for the next change to
  // look back at. Declared after the track-change effect on purpose: that one
  // must still see the previous record here.
  useEffect(() => {
    if (!room || !item || room.current_item_id !== item.id) return;
    // A pasted link has no stored length until the host's player reports one.
    const known = timeline.current?.itemId === item.id ? timeline.current.duration : null;
    const duration = item.track.duration_seconds ?? known ?? (item.track.provider === 'youtube' && hasPlayed.current ? sharedDuration() : null);
    timeline.current = { itemId: item.id, room, clockOffset: opts.clockOffset, duration, nextItemId: opts.nextItemId };
  });

  // Transitions: recompute the volume many times a second, and let the host
  // move the room on when the fade-out reaches silence.
  const transitionSeconds = opts.transitionSeconds;
  const playing = room?.playback_status === 'playing';
  useEffect(() => {
    if (!ready) return;
    appliedVolume.current = null;
    applyVolume();
    if (transitionSeconds <= 0 || !playing) return;
    const id = window.setInterval(() => {
      applyVolume();
      const cur = latest.current;
      if (!cur.isHost || !cur.room || !cur.item || cur.room.current_item_id !== cur.item.id) return;
      if (!hasPlayed.current || advancedFor.current === cur.item.id) return;
      const window_ = currentWindow();
      const position = expectedPosition(cur.room, cur.clockOffset);
      // The host's player is the truth. If it is well behind the timeline (a
      // slow start), the drift policy will pull the timeline back to it; the
      // record must not be ended on the timeline's word alone.
      const player = playerRef.current;
      if (!player || Math.abs(player.getCurrentTime() - position) > HOST_AGREEMENT_SECONDS) return;
      if (window_ && position >= window_.end) {
        // Idempotent on the server (expected current item), and the player's
        // own 'ended' event is still there if this request is lost.
        advancedFor.current = cur.item.id;
        devLog(cur.clockOffset, { advance: cur.item.id });
        cur.onEnded(cur.item.id);
      }
    }, FADE_TICK_MS);
    return () => window.clearInterval(id);
  }, [ready, transitionSeconds, playing, applyVolume, currentWindow]);

  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    appliedVolume.current = null;
    applyVolume();
    if (muted) p.mute();
    else p.unMute();
  }, [ready, volume, muted, applyVolume]);

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
