/**
 * A clock that reads like Date.now() but never steps: the page's start time
 * plus performance.now(). Everything that places the room on the shared
 * timeline uses this, so an NTP correction or a manual clock change on the
 * device cannot make playback jump.
 *
 * It can fall behind real time while the device sleeps; useServerClock
 * re-measures when the tab becomes visible again, which absorbs that.
 */
export const monotonicNow = (): number => performance.timeOrigin + performance.now();
