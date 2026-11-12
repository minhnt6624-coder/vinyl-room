import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { roomService } from '../services/roomService';
import type { Room, RoomState } from '../types';
import { CALIBRATED_SAMPLES, useServerClock } from './useServerClock';

export type RoomPhase = 'loading' | 'ready' | 'removed' | 'error';
export type Connection = 'connecting' | 'live' | 'reconnecting';

/**
 * Live view of one room.
 *
 * The database is the source of truth. Realtime events are treated as
 * "something changed" signals: each one triggers a (debounced) reload of the
 * whole room through get_room_state, so a missed or out-of-order event can
 * never leave this client with a wrong queue. Playback changes on the rooms
 * row are also applied straight from the event payload, so play / pause /
 * skip land without waiting for the reload.
 */
export function useRoom(roomId: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [phase, setPhase] = useState<RoomPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [clockOffset, setClockOffset] = useState(0);

  const seq = useRef(0);
  const hasState = useRef(false);
  const debounce = useRef<number | undefined>(undefined);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await roomService.state(roomId);
      if (mine !== seq.current) return; // a newer request is in flight
      hasState.current = true;
      setState(res.state);
      setClockOffset(res.clockOffsetMs);
      setPhase('ready');
    } catch (e) {
      if (mine !== seq.current) return;
      const err = AppError.from(e);
      if (err.code === 'VR_NOT_MEMBER') setPhase('removed');
      else if (!hasState.current) {
        setError(err.message);
        setPhase('error');
      }
      // Otherwise keep showing the last good state; reconnect will reload it.
    }
  }, [roomId]);

  const scheduleRefetch = useCallback(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(refetch, 120);
  }, [refetch]);

  useEffect(() => {
    hasState.current = false;
    setState(null);
    setPhase('loading');
    refetch();
    return () => window.clearTimeout(debounce.current);
  }, [refetch]);

  const meId = state?.me.id;
  useEffect(() => {
    if (!meId) return;

    const channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: meId } } });
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (payload) => {
        const next = payload.new as Room;
        setState((s) => (s ? { ...s, room: { ...s.room, ...next } } : s));
        scheduleRefetch();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_items', filter: `room_id=eq.${roomId}` }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, scheduleRefetch)
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          void channel.track({ at: Date.now() });
          // Also runs after every automatic re-join, which is what restores a
          // guest's room after a dropped connection.
          refetch();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('reconnecting');
        }
      });

    const onOnline = () => refetch();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [roomId, meId, refetch, scheduleRefetch]);

  // The pinged server clock replaces the one-off measurement as soon as it has
  // a sample; the tight sync tolerance waits for a few good ones.
  const serverClock = useServerClock(Boolean(meId));
  return {
    state,
    phase,
    error,
    connection,
    onlineIds,
    clockOffset: serverClock.offset ?? clockOffset,
    clockCalibrated: serverClock.goodSamples >= CALIBRATED_SAMPLES,
    refetch,
  };
}
