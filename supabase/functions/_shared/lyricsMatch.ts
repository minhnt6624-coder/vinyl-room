// Turning a YouTube video title into something a lyrics database can find,
// and choosing the right record among what it returns.
//
// Pure TypeScript with no Deno or Node APIs: the `lyrics` Edge Function uses
// it, and so do the unit tests (src/lib/lyricsMatch.test.ts).
//
// The idea of matching on name plus running time comes from SimpMusic's
// lyrics service (selectLrclibLyricsRecord). The rules here are this
// project's own: a 2 s window first, synced lyrics preferred, and a name
// check, because a video title is far noisier than a music-app track name.

export interface LrclibRecord {
  id: number;
  trackName: string | null;
  artistName: string | null;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface NameQuery {
  title: string;
  artist: string | null;
}

/** Durations within this many seconds count as the same recording. */
export const CLOSE_SECONDS = 2;
/** Beyond this it is a different version (live, extended, sped up): never used. */
export const MAX_SECONDS = 10;

// Words that describe the video, not the song.
const NOISE_WORDS =
  'official|video|videoclip|clip|mv|m/v|lyrics?|lyric|audio|visuali[sz]er|hd|hq|4k|8k|remaster(?:ed)?|performance|ver(?:sion)?|color coded|vietsub|engsub|karaoke|teaser|trailer|music|full|explicit|clean|prod(?:uced)?(?: by)?';
const NOISE_IN_BRACKETS = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${NOISE_WORDS})(?:$|[^\\p{L}\\p{N}])`, 'iu');
const FEAT = /(?:^|[\s([])(?:ft|feat|featuring)\b\.?\s/iu;
const BRACKETS = /\(([^()]*)\)|\[([^[\]]*)\]|【([^【】]*)】|（([^（）]*)）/gu;
const SEPARATORS = /\s+[-–—|｜/]{1,2}\s+|\s*[|｜]\s*/u;
const TRAILING_NOISE = /[\s,:-]+(?:official\s+)?(?:music\s+video|lyrics?\s+video|video|mv|m\/v|audio|lyrics?|visuali[sz]er)\s*$/iu;
// A quoted song name after an artist. Western quotes must stand free of the
// words around them, or the apostrophe in "Don't Stop Believin'" would count.
const QUOTED_CJK = /^(.+?)[「『]([^「」『』]{1,80})[」』]/u;
const QUOTED_WESTERN = /^(.+?\s)[‘'"“]([^‘’'"“”]{1,80})[’'"”](?=\s|$)/u;

const squeeze = (s: string) => s.replace(/\s+/gu, ' ').trim();

/** True when a title segment says nothing about the song, e.g. "OFFICIAL MUSIC VIDEO". */
function isNoiseSegment(segment: string): boolean {
  const rest = segment.replace(new RegExp(`(?:${NOISE_WORDS})`, 'giu'), ' ').replace(/[^\p{L}\p{N}]+/gu, '');
  return rest.length === 0;
}

/**
 * Splits a raw title into its meaningful parts: bracketed video labels,
 * "feat." credits and trailing "Official MV" are dropped, then the rest is
 * split on " - ", " | " and similar.
 */
export function titleSegments(raw: string): string[] {
  let text = raw.normalize('NFC');
  // Drop brackets that only describe the video or credit a guest.
  text = text.replace(BRACKETS, (whole, a, b, c, d) => {
    const inner = String(a ?? b ?? c ?? d ?? '');
    return NOISE_IN_BRACKETS.test(inner) || FEAT.test(` ${inner}`) || inner.trim() === '' ? ' ' : whole;
  });
  // "Song ft. Guest - Something" -> "Song - Something": the credit runs to the next separator.
  text = text.replace(/\s+(?:ft|feat|featuring)\b\.?\s+[^-–—|｜()[\]]*/giu, ' ');

  return text
    .split(SEPARATORS)
    .map((part) => {
      let s = squeeze(part);
      while (TRAILING_NOISE.test(s)) s = squeeze(s.replace(TRAILING_NOISE, ''));
      return s;
    })
    .filter((part) => part.length > 0 && !isNoiseSegment(part));
}

/** A channel name as an artist: "Queen Official" -> "Queen", "Adele - Topic" -> "Adele". */
export function cleanArtist(channel: string | null | undefined): string | null {
  if (!channel) return null;
  const s = squeeze(
    channel
      .normalize('NFC')
      .replace(/\s+-\s+Topic$/iu, '')
      .replace(/\s*VEVO$/u, '')
      .replace(/\s+Official(?:\s+(?:Channel|Music|YouTube(?:\s+Channel)?))?$/iu, ''),
  );
  return s.length ? s : null;
}

const stripBrackets = (s: string) => squeeze(s.replace(BRACKETS, ' '));

/**
 * The (title, artist) pairs worth asking a lyrics database about, best guess
 * first. A video title may be "Artist - Song", "Song", "Artist 'Song' MV" or
 * "ARTIST | SONG | OFFICIAL MUSIC VIDEO", and the channel may be the artist
 * or a label, so several readings are tried.
 *
 * With `structured` the pair comes from a music service (Spotify) rather than
 * from a video: see the branch below.
 */
export function buildQueries(rawTitle: string, channel: string | null | undefined, opts: { structured?: boolean } = {}): NameQuery[] {
  const out: NameQuery[] = [];
  const seen = new Set<string>();
  const add = (title: string | undefined, artist: string | null | undefined) => {
    const t = squeeze(title ?? '');
    const a = artist ? squeeze(artist) : null;
    if (!t) return;
    const key = `${fold(t)}|${a ? fold(a) : ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: t, artist: a && a.length ? a : null });
  };

  if (opts.structured) {
    // A music service's own metadata: the title is the song and the artist is
    // the artist. Nothing is guessed from the title's shape; only the version
    // suffix Spotify appends ("Song - Remastered 2011", "Song - Radio Edit")
    // and guest credits are peeled off.
    const whole = squeeze(rawTitle.normalize('NFC'));
    const song = titleSegments(rawTitle)[0] ?? whole;
    const full = channel ? squeeze(channel.normalize('NFC')) : null;
    // "Artist, Guest": the first name alone is what most databases file it under.
    const lead = full && full.includes(',') ? squeeze(full.split(',')[0]) : null;
    const artists = [full, lead].filter((a): a is string => Boolean(a));
    for (const artist of artists) add(song, artist);
    for (const artist of artists) add(whole, artist);
    for (const artist of artists) add(stripBrackets(song), artist);
    if (artists.length === 0) {
      add(song, null);
      add(whole, null);
    }
    return out;
  }

  const segments = titleSegments(rawTitle);
  const channelArtist = cleanArtist(channel);

  const first = segments[0] ?? squeeze(rawTitle);
  // K-pop style: NewJeans (뉴진스) 'Hype Boy' Official MV
  const quoted = first.match(QUOTED_CJK) ?? first.match(QUOTED_WESTERN);
  if (quoted && quoted[1].trim()) {
    const artist = stripBrackets(quoted[1]);
    add(quoted[2], artist);
    add(quoted[2], channelArtist);
  }
  if (segments.length >= 2) {
    add(segments[1], stripBrackets(segments[0])); // Artist - Song
    add(segments[1], channelArtist);
    add(segments[0], stripBrackets(segments[1])); // Song - Artist
  }
  add(first, channelArtist);
  add(stripBrackets(first), channelArtist);
  if (!channelArtist) add(first, null);
  return out;
}

/**
 * Lower-cased, accent-free, punctuation-free form used only for comparing.
 * Works on letters of any script: an ASCII-only class would erase Vietnamese,
 * Korean and Japanese titles.
 */
export function fold(s: string): string {
  return squeeze(
    s
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/[đĐ]/gu, 'd')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' '),
  );
}

/** 0..1: how alike two names are once folded. */
export function similarity(a: string, b: string): number {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (long.includes(short)) return 0.6 + 0.35 * (short.length / long.length);
  const xs = new Set(x.split(' '));
  const ys = new Set(y.split(' '));
  let shared = 0;
  for (const t of xs) if (ys.has(t)) shared++;
  return (0.9 * shared) / (xs.size + ys.size - shared);
}

/** A record's track name without "(Remastered 2011)", "- Live", "feat. X". */
const recordTitle = (r: LrclibRecord) => titleSegments(r.trackName ?? '')[0] ?? r.trackName ?? '';

function artistScore(recordArtist: string | null, wanted: string): number {
  if (!recordArtist) return 0;
  const parts = recordArtist.split(/\s*(?:,|&|;|\/|\bx\b|\bfeat\.?|\bft\.?|\bwith\b|\band\b)\s*/iu).filter(Boolean);
  return Math.max(similarity(recordArtist, wanted), ...parts.map((p) => similarity(p, wanted)));
}

export interface Scored {
  record: LrclibRecord;
  /** 0..1, best over the query variants. */
  nameScore: number;
  titleScore: number;
  artistMatched: boolean;
  /** Seconds between the record and the track, or null when the track's duration is unknown. */
  durationDiff: number | null;
  synced: boolean;
}

const hasText = (s: string | null) => typeof s === 'string' && s.trim().length > 0;

function score(record: LrclibRecord, queries: NameQuery[], duration: number | null): Scored {
  let best = { name: 0, title: 0, artist: false };
  for (const q of queries) {
    const title = similarity(recordTitle(record), q.title);
    const artist = q.artist ? artistScore(record.artistName, q.artist) : 0;
    const artistOk = q.artist ? artist >= 0.5 : false;
    const name = q.artist ? 0.65 * title + 0.35 * artist : title * 0.8;
    if (name > best.name) best = { name, title, artist: artistOk };
  }
  return {
    record,
    nameScore: best.name,
    titleScore: best.title,
    artistMatched: best.artist,
    durationDiff: duration === null ? null : Math.abs(record.duration - duration),
    synced: hasText(record.syncedLyrics),
  };
}

/**
 * Is this record about the same song at all?
 * The title has to match. The artist has to match too, unless the title is
 * exact and the running time agrees, which covers videos uploaded by a label
 * whose channel name is not the artist's.
 */
function acceptable(s: Scored): boolean {
  if (!s.record.instrumental && !hasText(s.record.syncedLyrics) && !hasText(s.record.plainLyrics)) return false;
  if (s.durationDiff !== null && s.durationDiff > MAX_SECONDS) return false;
  if (s.titleScore < 0.6) return false;
  if (s.artistMatched) return true;
  return s.titleScore >= 0.95 && s.durationDiff !== null && s.durationDiff <= CLOSE_SECONDS;
}

/** Lower is better: synced within 2 s, synced within 10 s, plain within 2 s, plain within 10 s. */
function tier(s: Scored): number {
  const close = s.durationDiff === null || s.durationDiff <= CLOSE_SECONDS;
  if (s.synced) return close ? 0 : 1;
  return close ? 2 : 3;
}

/**
 * The record to use, or null when none of them is this song.
 * Order of preference: tier, then how well the name matches, then how close
 * the running time is, then the database's own ranking.
 */
export function selectRecord(records: LrclibRecord[], queries: NameQuery[], duration: number | null): Scored | null {
  const candidates = records.map((r) => score(r, queries, duration)).filter(acceptable);
  let best: Scored | null = null;
  for (const c of candidates) {
    if (!best) {
      best = c;
      continue;
    }
    const byTier = tier(c) - tier(best);
    const byName = Math.round(best.nameScore * 20) - Math.round(c.nameScore * 20);
    const byDuration = (c.durationDiff ?? 0) - (best.durationDiff ?? 0);
    if (byTier < 0 || (byTier === 0 && (byName < 0 || (byName === 0 && byDuration < 0)))) best = c;
  }
  return best;
}

/**
 * True when nothing better can turn up: synced lyrics for the right recording,
 * or the right recording marked as having no words at all.
 */
export function isBestPossible(s: Scored | null): boolean {
  if (s === null || s.nameScore < 0.9) return false;
  if (tier(s) === 0) return true;
  return s.record.instrumental && s.durationDiff !== null && s.durationDiff <= CLOSE_SECONDS;
}
