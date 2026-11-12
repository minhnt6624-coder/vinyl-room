import { useEffect, useRef, useState } from 'react';
import { expectedPosition } from '../lib/format';
import type { LrcLine } from '../lib/lrc';
import { activeLineAt } from '../lib/lyricsSync';
import type { Room } from '../types';

/**
 * Index of the lyric line the room is on, or -1 before the first one.
 *
 * It is read from the room's shared timeline, never from this browser's
 * player, so every listener sees the same line. While the record plays the
 * position is checked on every animation frame, but React only hears about it
 * when the line changes.
 */
export function useActiveLine(lines: readonly LrcLine[], room: Room, clockOffset: number, offsetMs: number): number {
  const [index, setIndex] = useState(() => activeLineAt(lines, expectedPosition(room, clockOffset), offsetMs));
  const latest = useRef({ lines, room, clockOffset, offsetMs });
  latest.current = { lines, room, clockOffset, offsetMs };

  const playing = room.playback_status === 'playing';
  useEffect(() => {
    const read = () => {
      const now = latest.current;
      setIndex(activeLineAt(now.lines, expectedPosition(now.room, now.clockOffset), now.offsetMs)); // same value: no render
    };
    read();
    if (!playing) return;
    let frame = requestAnimationFrame(function loop() {
      read();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [lines, playing, room.playback_position, room.playback_started_at, clockOffset, offsetMs]);

  return index;
}
