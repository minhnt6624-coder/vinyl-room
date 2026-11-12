import { describe, expect, it } from 'vitest';
import { parseLrc } from './lrc';
import { activeLineAt, clampOffset, formatOffset, isTimed, lyricsView, readOffset, writeOffset } from './lyricsSync';

const lines = parseLrc('[00:10.00]a\n[00:20.00]b\n[00:20.00]c\n[00:30.00]d');

describe('activeLineAt', () => {
  it('is -1 before the first line', () => {
    expect(activeLineAt(lines, 0)).toBe(-1);
    expect(activeLineAt(lines, 9.999)).toBe(-1);
  });

  it('switches exactly on a line start and holds between lines', () => {
    expect(activeLineAt(lines, 10)).toBe(0);
    expect(activeLineAt(lines, 15)).toBe(0);
    expect(activeLineAt(lines, 19.999)).toBe(0);
    expect(activeLineAt(lines, 30)).toBe(3);
  });

  it('picks the later of two lines that start together', () => {
    expect(activeLineAt(lines, 20)).toBe(2);
  });

  it('stays on the last line after it starts', () => {
    expect(activeLineAt(lines, 3600)).toBe(3);
  });

  it('a positive offset shows a line sooner', () => {
    expect(activeLineAt(lines, 9.6, 0)).toBe(-1);
    expect(activeLineAt(lines, 9.6, 500)).toBe(0);
    expect(activeLineAt(lines, 29.5, 500)).toBe(3);
  });

  it('a negative offset shows a line later', () => {
    expect(activeLineAt(lines, 10.2, 0)).toBe(0);
    expect(activeLineAt(lines, 10.2, -500)).toBe(-1);
    expect(activeLineAt(lines, 10.5, -500)).toBe(0);
  });

  it('finds the right line in a long sheet', () => {
    const long = Array.from({ length: 1001 }, (_, i) => ({ timeMs: i * 1000, text: String(i) }));
    for (const second of [0, 1, 499.5, 500, 777.2, 1000, 5000]) {
      expect(activeLineAt(long, second)).toBe(Math.min(1000, Math.floor(second)));
    }
    expect(activeLineAt(long, 499.5, 500)).toBe(500);
  });

  it('handles an empty sheet', () => {
    expect(activeLineAt([], 12, 500)).toBe(-1);
  });
});

describe('lyricsView', () => {
  const plain = 'First line\nSecond line\n\nThird line';

  it('follows the music when the lines are timed and the provider is synced', () => {
    expect(lyricsView({ status: 'found', lines, plain }, true)).toEqual({ kind: 'synced', lines });
  });

  it('shows plain lyrics as still text when there are no timed lines', () => {
    expect(lyricsView({ status: 'found', lines: [], plain }, true)).toEqual({
      kind: 'static',
      text: ['First line', 'Second line', '', 'Third line'],
    });
  });

  it('never follows the music on an embed-only provider', () => {
    expect(lyricsView({ status: 'found', lines, plain }, false)).toEqual({
      kind: 'static',
      text: ['First line', 'Second line', '', 'Third line'],
    });
    // No plain text stored: fall back to the words of the timed lines.
    expect(lyricsView({ status: 'found', lines, plain: null }, false)).toEqual({ kind: 'static', text: ['a', 'b', 'c', 'd'] });
  });

  it('treats lines that all share one timestamp as untimed', () => {
    const fake = parseLrc('[00:00.00]one\n[00:00.00]two\n[00:00.00]three');
    expect(isTimed(fake)).toBe(false);
    expect(isTimed(lines)).toBe(true);
    expect(isTimed([])).toBe(false);
    expect(lyricsView({ status: 'found', lines: fake, plain: null }, true)).toEqual({ kind: 'static', text: ['one', 'two', 'three'] });
  });

  it('reports an instrumental and a miss', () => {
    expect(lyricsView({ status: 'instrumental', lines: [], plain: null }, true)).toEqual({ kind: 'instrumental' });
    expect(lyricsView({ status: 'not_found', lines: [], plain: null }, true)).toEqual({ kind: 'none' });
  });

  it('is a miss when "found" has no words at all', () => {
    expect(lyricsView({ status: 'found', lines: [], plain: '  \n ' }, true)).toEqual({ kind: 'none' });
    expect(lyricsView({ status: 'found', lines: [], plain: null }, false)).toEqual({ kind: 'none' });
  });
});

describe('offset', () => {
  function memoryStore() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  }
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };

  it('steps by half a second and stays within ten seconds', () => {
    expect(clampOffset(500)).toBe(500);
    expect(clampOffset(740)).toBe(500);
    expect(clampOffset(-760)).toBe(-1000);
    expect(clampOffset(99999)).toBe(10000);
    expect(clampOffset(-99999)).toBe(-10000);
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(Object.is(clampOffset(-100), 0)).toBe(true);
  });

  it('formats with a sign', () => {
    expect(formatOffset(500)).toBe('+0.5s');
    expect(formatOffset(-1000)).toBe('−1.0s');
  });

  it('keeps one value per track', () => {
    const store = memoryStore();
    expect(readOffset('t1', store)).toBe(0);
    expect(writeOffset('t1', 1500, store)).toBe(1500);
    expect(writeOffset('t2', -500, store)).toBe(-500);
    expect(readOffset('t1', store)).toBe(1500);
    expect(readOffset('t2', store)).toBe(-500);
    expect(store.data.get('vr.lyricsOffset.t1')).toBe('1500');
  });

  it('removes the key when the offset returns to zero', () => {
    const store = memoryStore();
    writeOffset('t1', 500, store);
    expect(writeOffset('t1', 0, store)).toBe(0);
    expect(store.data.size).toBe(0);
  });

  it('ignores a stored value that is not a number', () => {
    const store = memoryStore();
    store.setItem('vr.lyricsOffset.t1', 'soon');
    expect(readOffset('t1', store)).toBe(0);
  });

  it('survives storage that throws or is missing', () => {
    expect(readOffset('t1', broken)).toBe(0);
    expect(writeOffset('t1', 1000, broken)).toBe(1000);
    expect(writeOffset('t1', 0, broken)).toBe(0);
    expect(readOffset('t1', null)).toBe(0);
    expect(writeOffset('t1', 500, null)).toBe(500);
  });
});
