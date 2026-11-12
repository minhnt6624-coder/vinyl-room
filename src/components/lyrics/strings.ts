import { formatOffset } from '../../lib/lyricsSync';

/**
 * Every word the lyrics UI shows or announces, in one place, so a translation
 * layer can replace this object later without touching the components.
 */
export const LYRICS_TEXT = {
  title: 'Lyrics',
  /** The button in the player bar, and the tap target on phones. */
  open: 'Lyrics',
  close: 'Close lyrics',
  fullScreen: 'Full screen',
  exitFullScreen: 'Exit full screen',

  loading: 'Loading lyrics',
  instrumental: 'Instrumental ♪',
  notFound: 'No lyrics for this song yet',
  loadFailed: "Couldn't load lyrics.",
  retry: 'Retry',
  notSynced: 'Not synced',
  /** A timed line with no words: a break in the singing. */
  pause: '♪',

  backToCurrent: 'Back to current line',

  offsetGroup: 'Lyrics timing',
  offsetEarlier: '+0.5s',
  offsetLater: '−0.5s',
  offsetEarlierLabel: 'Show lyrics 0.5 seconds sooner',
  offsetLaterLabel: 'Show lyrics 0.5 seconds later',
  offsetReset: 'Reset timing',
  offsetValue: (ms: number) => formatOffset(ms),
  offsetValueLabel: (ms: number) => `Timing ${formatOffset(ms)}. Reset`,
} as const;
