import { describe, expect, it } from 'vitest';
import { activeLineIndex, parseLrc } from './lrc';

describe('parseLrc', () => {
  it('parses plain timed lines, with or without a space after the tag', () => {
    expect(parseLrc('[00:00.15] Is this the real life?\n[00:07.13]Caught in a landslide')).toEqual([
      { timeMs: 150, text: 'Is this the real life?' },
      { timeMs: 7130, text: 'Caught in a landslide' },
    ]);
  });

  it('reads every fraction length as a fraction of a second', () => {
    expect(parseLrc('[01:02]a\n[01:02.5]b\n[01:02.50]c\n[01:02.500]d\n[01:02.05]e\n[01:02:50]f').map((l) => l.timeMs)).toEqual([
      62000, 62050, 62500, 62500, 62500, 62500,
    ]);
  });

  it('repeats a line that carries several timestamps', () => {
    expect(parseLrc('[00:12.00][01:15.00][02:30.00]La la la\n[00:20.00]Verse')).toEqual([
      { timeMs: 12000, text: 'La la la' },
      { timeMs: 20000, text: 'Verse' },
      { timeMs: 75000, text: 'La la la' },
      { timeMs: 150000, text: 'La la la' },
    ]);
  });

  it('drops metadata lines', () => {
    const lrc = '[ar:Queen]\n[ti:Bohemian Rhapsody]\n[al:A Night at the Opera]\n[by:someone]\n[length:05:55]\n[re:tool]\n[ve:1.0]\n[#:comment]\n[00:01.00]Mama';
    expect(parseLrc(lrc)).toEqual([{ timeMs: 1000, text: 'Mama' }]);
  });

  it('applies [offset:]: positive shows lyrics sooner, negative later', () => {
    expect(parseLrc('[offset:500]\n[00:10.00]a').map((l) => l.timeMs)).toEqual([9500]);
    expect(parseLrc('[offset:-250]\n[00:10.00]a').map((l) => l.timeMs)).toEqual([10250]);
    expect(parseLrc('[offset: +1000]\n[00:10.00]a').map((l) => l.timeMs)).toEqual([9000]);
  });

  it('applies the offset wherever the tag is, and never goes below zero', () => {
    expect(parseLrc('[00:00.20]a\n[00:05.00]b\n[offset:1000]')).toEqual([
      { timeMs: 0, text: 'a' },
      { timeMs: 4000, text: 'b' },
    ]);
  });

  it('ignores a malformed offset', () => {
    expect(parseLrc('[offset:soon]\n[00:10.00]a').map((l) => l.timeMs)).toEqual([10000]);
  });

  it('keeps empty timed lines as pauses', () => {
    expect(parseLrc('[00:10.00]Line\n[00:15.00]\n[00:30.00]Next')).toEqual([
      { timeMs: 10000, text: 'Line' },
      { timeMs: 15000, text: '' },
      { timeMs: 30000, text: 'Next' },
    ]);
  });

  it('strips enhanced-LRC word timings', () => {
    expect(parseLrc('[00:10.00] <00:10.00>Hello <00:10.50>big <00:11.00>world')).toEqual([{ timeMs: 10000, text: 'Hello big world' }]);
  });

  it('sorts by time and keeps file order for equal times', () => {
    expect(parseLrc('[00:20.00]second\n[00:10.00]first\n[00:20.00]third').map((l) => l.text)).toEqual(['first', 'second', 'third']);
  });

  it('skips untimed lines, blank lines, a BOM and Windows line endings', () => {
    expect(parseLrc('﻿[00:01.00]a\r\n\r\nno timestamp here\r\n[00:02.00]b\r\n')).toEqual([
      { timeMs: 1000, text: 'a' },
      { timeMs: 2000, text: 'b' },
    ]);
  });

  it('keeps bracketed words that are part of the lyric', () => {
    expect(parseLrc('[00:10.00][Chorus]\n[00:12.00](Galileo) Galileo')).toEqual([
      { timeMs: 10000, text: '[Chorus]' },
      { timeMs: 12000, text: '(Galileo) Galileo' },
    ]);
  });

  it('rejects impossible seconds and handles songs over an hour', () => {
    expect(parseLrc('[00:75.00]bad\n[75:30.00]long')).toEqual([{ timeMs: 75 * 60000 + 30000, text: 'long' }]);
  });

  it('returns nothing for empty or missing input', () => {
    expect(parseLrc('')).toEqual([]);
    expect(parseLrc(null)).toEqual([]);
    expect(parseLrc(undefined)).toEqual([]);
    expect(parseLrc('just some plain lyrics\nwith no timing')).toEqual([]);
  });

  it('Vietnamese: keeps every diacritic', () => {
    const lrc = ['[ti:Chúng Ta Của Hiện Tại]', '[ar:Sơn Tùng M-TP]', '[00:21.48] Mùa thu mang giấc mơ quay về', '[00:26.02] Vẫn nguyên vẹn như hôm nào', '[00:31.10] Lá bay theo gió xôn xao'].join('\n');
    expect(parseLrc(lrc)).toEqual([
      { timeMs: 21480, text: 'Mùa thu mang giấc mơ quay về' },
      { timeMs: 26020, text: 'Vẫn nguyên vẹn như hôm nào' },
      { timeMs: 31100, text: 'Lá bay theo gió xôn xao' },
    ]);
  });

  it('Korean: Hangul and mixed English lines', () => {
    const lrc = ['[00:08.35] 1, 2, 3, 4', '[00:10.11] Baby, got me looking so crazy', '[00:13.52] 빠져버리는 daydream', '[00:16.98] Got me feeling you, 너도 말해줄래?'].join('\n');
    expect(parseLrc(lrc)).toEqual([
      { timeMs: 8350, text: '1, 2, 3, 4' },
      { timeMs: 10110, text: 'Baby, got me looking so crazy' },
      { timeMs: 13520, text: '빠져버리는 daydream' },
      { timeMs: 16980, text: 'Got me feeling you, 너도 말해줄래?' },
    ]);
  });

  it('Japanese: kanji, kana and full-width punctuation', () => {
    const lrc = ['[00:01.20] 無敵の笑顔で荒らすメディア', '[00:04.85][01:40.30] 知りたいその秘密ミステリアス', '[00:08.40] 抜けてるとこさえ彼女のエリア、完璧で嘘つきな君は'].join('\n');
    expect(parseLrc(lrc)).toEqual([
      { timeMs: 1200, text: '無敵の笑顔で荒らすメディア' },
      { timeMs: 4850, text: '知りたいその秘密ミステリアス' },
      { timeMs: 8400, text: '抜けてるとこさえ彼女のエリア、完璧で嘘つきな君は' },
      { timeMs: 100300, text: '知りたいその秘密ミステリアス' },
    ]);
  });
});

describe('activeLineIndex', () => {
  const lines = parseLrc('[00:10.00]a\n[00:20.00]b\n[00:20.00]c\n[00:30.00]d');
  it('is -1 before the first line', () => {
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 9999)).toBe(-1);
  });
  it('is the last line that has started', () => {
    expect(activeLineIndex(lines, 10000)).toBe(0);
    expect(activeLineIndex(lines, 19999)).toBe(0);
    expect(activeLineIndex(lines, 20000)).toBe(2); // of two lines at the same time, the later one
    expect(activeLineIndex(lines, 999999)).toBe(3);
  });
  it('handles an empty sheet', () => {
    expect(activeLineIndex([], 5000)).toBe(-1);
  });
});
