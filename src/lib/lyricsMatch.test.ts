// Tests for the matching logic the `lyrics` Edge Function runs.
import { describe, expect, it } from 'vitest';
import { buildQueries, cleanArtist, fold, selectRecord, similarity, titleSegments, type LrclibRecord, type NameQuery } from '../../supabase/functions/_shared/lyricsMatch';

let nextId = 1;
const rec = (trackName: string, artistName: string, duration: number, opts: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id: nextId++,
  trackName,
  artistName,
  albumName: null,
  duration,
  instrumental: false,
  plainLyrics: 'plain',
  syncedLyrics: '[00:01.00]synced',
  ...opts,
});
const plainOnly = { syncedLyrics: null };

describe('titleSegments', () => {
  it.each([
    ['Queen – Bohemian Rhapsody (Official Video Remastered)', ['Queen', 'Bohemian Rhapsody']],
    ['Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', ['Rick Astley', 'Never Gonna Give You Up']],
    ['SƠN TÙNG M-TP | CHÚNG TA CỦA HIỆN TẠI | OFFICIAL MUSIC VIDEO', ['SƠN TÙNG M-TP', 'CHÚNG TA CỦA HIỆN TẠI']],
    ['Luis Fonsi - Despacito ft. Daddy Yankee', ['Luis Fonsi', 'Despacito']],
    ['Ed Sheeran - Shape of You (Official Music Video)', ['Ed Sheeran', 'Shape of You']],
    ['Adele - Hello (Official Music Video) [Lyrics]', ['Adele', 'Hello']],
    ['HOÀNG THUỲ LINH - SEE TÌNH | Official Music Video', ['HOÀNG THUỲ LINH', 'SEE TÌNH']],
    ['Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars', ['Mark Ronson', 'Uptown Funk']],
    ['Đen - Mang Tiền Về Cho Mẹ ft. Nguyên Thảo (M/V)', ['Đen', 'Mang Tiền Về Cho Mẹ']],
    ['Bohemian Rhapsody', ['Bohemian Rhapsody']],
    ['Shake It Off (feat. Someone)', ['Shake It Off']],
    ['BTS (방탄소년단) - Dynamite [MV]', ['BTS (방탄소년단)', 'Dynamite']],
    ['Blinding Lights Official Audio', ['Blinding Lights']],
  ])('%s', (raw, expected) => {
    expect(titleSegments(raw)).toEqual(expected);
  });

  it('keeps brackets that are part of the name', () => {
    expect(titleSegments('AC/DC - Thunderstruck (Live at River Plate)')).toEqual(['AC/DC', 'Thunderstruck (Live at River Plate)']);
  });
});

describe('cleanArtist', () => {
  it.each([
    ['Queen Official', 'Queen'],
    ['Adele - Topic', 'Adele'],
    ['EdSheeranVEVO', 'EdSheeran'],
    ['Sơn Tùng M-TP Official', 'Sơn Tùng M-TP'],
    ['Taylor Swift', 'Taylor Swift'],
    ['HYBE LABELS', 'HYBE LABELS'],
  ])('%s -> %s', (raw, expected) => {
    expect(cleanArtist(raw)).toBe(expected);
  });
  it('is null for nothing', () => {
    expect(cleanArtist(null)).toBeNull();
    expect(cleanArtist('   ')).toBeNull();
  });
});

describe('buildQueries', () => {
  const first = (title: string, channel: string | null): NameQuery => buildQueries(title, channel)[0];

  it('reads "Artist - Song"', () => {
    expect(first('Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official')).toEqual({ title: 'Bohemian Rhapsody', artist: 'Queen' });
  });
  it('reads a quoted song name after the artist (K-pop style)', () => {
    expect(first("NewJeans (뉴진스) 'Hype Boy' Official MV (Performance ver.1)", 'HYBE LABELS')).toEqual({ title: 'Hype Boy', artist: 'NewJeans' });
  });
  it('reads Japanese corner brackets', () => {
    expect(first('YOASOBI「アイドル」 Official Music Video', 'Ayase / YOASOBI')).toEqual({ title: 'アイドル', artist: 'YOASOBI' });
  });
  it('does not mistake an apostrophe for a quote', () => {
    expect(first("Journey - Don't Stop Believin' (Official Audio)", 'journeyVEVO')).toEqual({ title: "Don't Stop Believin'", artist: 'Journey' });
  });
  it('uses the channel when the title is only the song', () => {
    expect(first('Bohemian Rhapsody', 'Queen - Topic')).toEqual({ title: 'Bohemian Rhapsody', artist: 'Queen' });
  });
  it('also tries the channel as the artist, and "Song - Artist"', () => {
    const qs = buildQueries('SƠN TÙNG M-TP | CHÚNG TA CỦA HIỆN TẠI | OFFICIAL MUSIC VIDEO', 'Sơn Tùng M-TP Official');
    expect(qs[0]).toEqual({ title: 'CHÚNG TA CỦA HIỆN TẠI', artist: 'SƠN TÙNG M-TP' });
    expect(qs).toContainEqual({ title: 'SƠN TÙNG M-TP', artist: 'CHÚNG TA CỦA HIỆN TẠI' });
    expect(new Set(qs.map((q) => `${fold(q.title)}|${fold(q.artist ?? '')}`)).size).toBe(qs.length); // no duplicates
  });
  it('still asks something when the whole title is a "noise" word', () => {
    expect(first('Clean', 'Taylor Swift')).toEqual({ title: 'Clean', artist: 'Taylor Swift' });
  });
});

describe('fold and similarity', () => {
  it('ignores case, accents and punctuation, in any script', () => {
    expect(fold('SƠN TÙNG M-TP')).toBe(fold('Sơn Tùng M-TP'));
    expect(fold('Đen Vâu')).toBe('den vau');
    expect(fold('  Don’t   Stop!! ')).toBe('don t stop');
    expect(fold('아이유 (IU)')).toBe(fold('아이유 IU'));
    expect(fold('アイドル').length).toBeGreaterThan(0);
  });
  it('scores equal, contained and unrelated names', () => {
    expect(similarity('Bohemian Rhapsody', 'bohemian rhapsody')).toBe(1);
    expect(similarity('Hello', 'Hello - Live')).toBeGreaterThan(0.6);
    expect(similarity('Hello', 'Goodbye')).toBe(0);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('selectRecord', () => {
  const q: NameQuery[] = [{ title: 'Bohemian Rhapsody', artist: 'Queen' }];

  it('prefers synced lyrics within 2 s', () => {
    const a = rec('Bohemian Rhapsody', 'Queen', 355, plainOnly);
    const b = rec('Bohemian Rhapsody', 'Queen', 356);
    expect(selectRecord([a, b], q, 355)?.record).toBe(b);
  });
  it('prefers synced lyrics a few seconds off over plain lyrics that match exactly', () => {
    const exactPlain = rec('Bohemian Rhapsody', 'Queen', 355, plainOnly);
    const nearSynced = rec('Bohemian Rhapsody', 'Queen', 360);
    const chosen = selectRecord([exactPlain, nearSynced], q, 355);
    expect(chosen?.record).toBe(nearSynced);
    expect(chosen?.durationDiff).toBe(5);
  });
  it('among synced records, takes the one inside the 2 s window', () => {
    const far = rec('Bohemian Rhapsody', 'Queen', 362);
    const close = rec('Bohemian Rhapsody', 'Queen', 354);
    expect(selectRecord([far, close], q, 355)?.record).toBe(close);
  });
  it('never uses a record more than 10 s off: that is another version', () => {
    expect(selectRecord([rec('Bohemian Rhapsody', 'Queen', 300)], q, 355)).toBeNull();
  });
  it('rejects a different song by the same artist', () => {
    expect(selectRecord([rec('We Will Rock You', 'Queen', 355)], q, 355)).toBeNull();
  });
  it('rejects the same title by someone else when the running time differs', () => {
    expect(selectRecord([rec('Hello', 'Lionel Richie', 250)], [{ title: 'Hello', artist: 'Adele' }], 295)).toBeNull();
  });
  it('accepts an exact title with matching running time even if the channel is a label', () => {
    const r = rec('Hype Boy', 'NewJeans', 179);
    expect(selectRecord([r], [{ title: 'Hype Boy', artist: 'HYBE LABELS' }], 179)?.record).toBe(r);
  });
  it('uses the better of several readings of the title', () => {
    const r = rec('Hype Boy', 'NewJeans', 300);
    const readings = [{ title: 'Hype Boy', artist: 'HYBE LABELS' }, { title: 'Hype Boy', artist: 'NewJeans' }];
    expect(selectRecord([r], readings, null)?.record).toBe(r);
  });
  it('matches a featured or joint artist credit', () => {
    const r = rec('Despacito', 'Luis Fonsi feat. Daddy Yankee', 229);
    expect(selectRecord([r], [{ title: 'Despacito', artist: 'Luis Fonsi' }], 229)?.record).toBe(r);
  });
  it('ignores "(Remastered 2011)" style suffixes on the record', () => {
    const r = rec('Bohemian Rhapsody (Remastered 2011)', 'Queen', 354);
    expect(selectRecord([r], q, 355)?.record).toBe(r);
  });
  it('matches across accents and case', () => {
    const r = rec('Chúng Ta Của Hiện Tại', 'Sơn Tùng M-TP', 301);
    expect(selectRecord([r], [{ title: 'CHÚNG TA CỦA HIỆN TẠI', artist: 'SƠN TÙNG M-TP' }], 302)?.record).toBe(r);
  });
  it('with no duration: best name wins, synced preferred, and no diff is reported', () => {
    const plain = rec('Bohemian Rhapsody', 'Queen', 355, plainOnly);
    const synced = rec('Bohemian Rhapsody', 'Queen', 420);
    const chosen = selectRecord([plain, synced], q, null);
    expect(chosen?.record).toBe(synced);
    expect(chosen?.durationDiff).toBeNull();
  });
  it('with no duration the artist must match', () => {
    expect(selectRecord([rec('Hello', 'Lionel Richie', 250)], [{ title: 'Hello', artist: 'Adele' }], null)).toBeNull();
  });
  it('skips records with no lyrics that are not marked instrumental', () => {
    expect(selectRecord([rec('Bohemian Rhapsody', 'Queen', 355, { syncedLyrics: null, plainLyrics: '' })], q, 355)).toBeNull();
  });
  it('returns an instrumental record when that is all there is', () => {
    const r = rec('Bohemian Rhapsody', 'Queen', 355, { syncedLyrics: null, plainLyrics: null, instrumental: true });
    expect(selectRecord([r], q, 355)?.record).toBe(r);
  });
  it('keeps the database order between equals', () => {
    const a = rec('Bohemian Rhapsody', 'Queen', 355);
    const b = rec('Bohemian Rhapsody', 'Queen', 355);
    expect(selectRecord([a, b], q, 355)?.record).toBe(a);
  });
  it('returns null for no records', () => {
    expect(selectRecord([], q, 355)).toBeNull();
  });
});
