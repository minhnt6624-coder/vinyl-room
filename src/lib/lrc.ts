/** One timed line of lyrics. An empty `text` marks a pause (an instrumental break). */
export interface LrcLine {
  timeMs: number;
  text: string;
}

// [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx], and the old [mm:ss:xx].
const TIME_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
// [ar:...], [ti:...], [offset:...], [length:...] and the like.
const META_TAG = /^\[([a-zA-Z#][a-zA-Z0-9_ ]*):(.*)\]\s*$/;
// Enhanced-LRC word timings inside a line: <00:12.34>
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function fractionToMs(digits: string | undefined): number {
  if (!digits) return 0;
  // ".5" is 500 ms, ".50" is 500 ms, ".500" is 500 ms.
  return Math.round(Number(digits) * 10 ** (3 - digits.length));
}

/**
 * Parses LRC text into timed lines, sorted by time.
 *
 * - A line may carry several timestamps ("[00:12.00][01:15.00]La la"): it is
 *   repeated once per timestamp.
 * - Metadata lines ([ar:], [ti:], [al:], [by:], [length:] ...) are dropped.
 * - [offset:+/-N] (milliseconds) shifts every line; a positive value makes the
 *   lyrics appear sooner, as the LRC format defines it.
 * - Word-level tags of enhanced LRC are removed, keeping the line's text.
 * - Lines with no timestamp are ignored: without a time they cannot be placed.
 */
export function parseLrc(input: string | null | undefined): LrcLine[] {
  if (!input) return [];
  const lines: LrcLine[] = [];
  let offsetMs = 0;

  for (const raw of input.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    let rest = raw.trim();
    if (!rest) continue;

    const times: number[] = [];
    for (let m = TIME_TAG.exec(rest); m; m = TIME_TAG.exec(rest)) {
      const seconds = Number(m[2]);
      if (seconds < 60) times.push(Number(m[1]) * 60_000 + seconds * 1000 + fractionToMs(m[3]));
      rest = rest.slice(m[0].length).trimStart();
    }

    if (times.length === 0) {
      const meta = META_TAG.exec(rest);
      if (meta && meta[1].trim().toLowerCase() === 'offset') {
        const value = Number(meta[2].trim());
        if (Number.isFinite(value)) offsetMs = value;
      }
      continue;
    }

    const text = rest.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    for (const timeMs of times) lines.push({ timeMs, text });
  }

  return lines
    .map((line, index) => ({ line: { timeMs: Math.max(0, line.timeMs - offsetMs), text: line.text }, index }))
    .sort((a, b) => a.line.timeMs - b.line.timeMs || a.index - b.index)
    .map((entry) => entry.line);
}

/**
 * Index of the line being sung at `timeMs`: the last line that has started.
 * -1 before the first line. `lines` must be sorted, as parseLrc returns them.
 */
export function activeLineIndex(lines: readonly LrcLine[], timeMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
