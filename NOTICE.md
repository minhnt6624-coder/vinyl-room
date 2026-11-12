# Notices

Vinyl Room is licensed under the GNU General Public License, version 3 only (GPL-3.0-only). The full text is in [LICENSE](LICENSE).

## Work this project builds on

Parts of Vinyl Room are ports to TypeScript of ideas and algorithms from the projects below. Each ported file carries a header naming its origin.

### SimpMusic

- Source: https://github.com/maxrave-dev/SimpMusic and https://github.com/maxrave-dev/core
- Author: maxrave-dev and contributors
- License: GPL-3.0

### Metrolist

- Source: https://github.com/MetrolistGroup/Metrolist
- Author: the Metrolist Project and contributors
- License: GPL-3.0
- SimpMusic's Listen Together `ServerClock` is itself a port from Metrolist, so anything derived from it credits both.

## Ported files

Add a row here whenever a file is ported.

| File in this repo | Ported from | Original project |
| --- | --- | --- |
| `src/lib/serverClock.ts` | `core/service/listenTogether/.../ServerClock.kt` (SimpMusic) | Metrolist `ServerClock` |
| `src/lib/serverClock.test.ts` (first three cases) | `core/service/listenTogether/.../ServerClockTest.kt` (SimpMusic) | Metrolist `ServerClockTest` |

## Ideas taken without porting code

- **Lyrics lookup** (`supabase/functions/_shared/lyricsMatch.ts`, `lrclib.ts`, `src/lib/lrc.ts`): choosing an LRCLIB record by name and running time follows the approach of SimpMusic's lyrics service (`selectLrclibLyricsRecord`, `LrcTextParser.kt`). The code is written for this project and its rules differ (a 2 second window before a 10 second one, synced lyrics preferred, a name check, multiple timestamps and `[offset:]` in the parser), so these files carry no upstream header.

## Services

Lyrics come from [LRCLIB](https://lrclib.net), a free, open lyrics database, and are cached in this project's database.

Vinyl Room plays music only through each provider's official embedded player (YouTube IFrame Player API, Spotify Embed, SoundCloud Widget). It does not download, extract or proxy audio.
