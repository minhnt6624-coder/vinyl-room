// Tests for the matching logic the `lyrics` Edge Function runs.
import { describe, expect, it } from 'vitest';
import { parseSpotifyEmbed } from '../../supabase/functions/_shared/spotifyMeta';
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

describe('buildQueries, structured (Spotify metadata)', () => {
  const q = (title: string, artist: string | null) => buildQueries(title, artist, { structured: true });

  it('takes the title as the song and the artist as the artist', () => {
    expect(q('Shape of You', 'Ed Sheeran')).toEqual([{ title: 'Shape of You', artist: 'Ed Sheeran' }]);
  });

  it('never reads "Song - Version" as "Artist - Song"', () => {
    const qs = q('Bohemian Rhapsody - Remastered 2011', 'Queen');
    expect(qs[0]).toEqual({ title: 'Bohemian Rhapsody', artist: 'Queen' });
    expect(qs[1]).toEqual({ title: 'Bohemian Rhapsody - Remastered 2011', artist: 'Queen' });
    expect(qs.every((x) => x.artist === 'Queen')).toBe(true);
    // The YouTube reading of the same pair would put the version first.
    expect(buildQueries('Bohemian Rhapsody - Remastered 2011', 'Queen')[0].title).toBe('Remastered 2011');
  });

  it('drops a guest credit from the title and tries the lead artist alone', () => {
    const qs = q('Señorita (feat. Camila Cabello)', 'Shawn Mendes, Camila Cabello');
    expect(qs.slice(0, 2)).toEqual([
      { title: 'Señorita', artist: 'Shawn Mendes, Camila Cabello' },
      { title: 'Señorita', artist: 'Shawn Mendes' },
    ]);
  });

  it('keeps a band name that contains a comma as its first reading', () => {
    expect(q('September', 'Earth, Wind & Fire')[0]).toEqual({ title: 'September', artist: 'Earth, Wind & Fire' });
  });

  it('keeps brackets that are part of the name, then tries without them', () => {
    const qs = q('Thinking out Loud (Acoustic)', 'Ed Sheeran').map((x) => x.title);
    expect(qs).toEqual(['Thinking out Loud (Acoustic)', 'Thinking out Loud']);
  });

  it('falls back to the title alone when there is no artist', () => {
    expect(q('Mr. Brightside', null)).toEqual([{ title: 'Mr. Brightside', artist: null }]);
  });

  it('a title-only track is never matched without a duration, but is with artist and duration', () => {
    const records = [rec('Mr. Brightside', 'The Killers', 222, { syncedLyrics: '[00:01.00]Coming out of my cage' })];
    expect(selectRecord(records, q('Mr. Brightside', null), null)).toBeNull();
    expect(selectRecord(records, q('Mr. Brightside', 'The Killers'), 222)?.record.id).toBe(records[0].id);
    // A live cut 40 seconds longer is a different recording.
    expect(selectRecord([rec('Mr. Brightside', 'The Killers', 262, { syncedLyrics: '[00:01.00]x' })], q('Mr. Brightside', 'The Killers'), 222)).toBeNull();
  });
});

describe('parseSpotifyEmbed', () => {
  const page = (entity: unknown) =>
    `<!DOCTYPE html><html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity } } } },
    })}</script></body></html>`;

  it('reads the artists in order and the duration in seconds', () => {
    expect(parseSpotifyEmbed(page({ type: 'track', name: 'Never Gonna Give You Up', artists: [{ name: 'Rick Astley', uri: 'spotify:artist:x' }], duration: 213573 }))).toEqual({
      artists: ['Rick Astley'],
      durationSeconds: 214,
    });
    expect(parseSpotifyEmbed(page({ name: 'Señorita', artists: [{ name: 'Shawn Mendes' }, { name: ' Camila Cabello ' }], duration: 190960 }))?.artists).toEqual(['Shawn Mendes', 'Camila Cabello']);
  });

  it('accepts a page with only one of the two', () => {
    expect(parseSpotifyEmbed(page({ artists: [{ name: 'Queen' }] }))).toEqual({ artists: ['Queen'], durationSeconds: null });
    expect(parseSpotifyEmbed(page({ artists: [], duration: 60000 }))).toEqual({ artists: [], durationSeconds: 60 });
  });

  it('is null for anything it cannot read', () => {
    expect(parseSpotifyEmbed('')).toBeNull();
    expect(parseSpotifyEmbed('<html><body>Page not found</body></html>')).toBeNull();
    expect(parseSpotifyEmbed('<script id="__NEXT_DATA__" type="application/json">{not json</script>')).toBeNull();
    expect(parseSpotifyEmbed(page({ name: 'An episode', duration: 'long' }))).toBeNull();
    expect(parseSpotifyEmbed(page({ artists: [{ name: '' }, {}], duration: 0 }))).toBeNull();
  });
});
