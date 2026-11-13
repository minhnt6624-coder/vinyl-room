# Vinyl Room

A shared listening room. One person hosts, everyone else joins from a link or QR code, adds songs to one queue, and hears the same moment the host does. No accounts.

The name is temporary. To rename it, change `APP_NAME` in [src/config.ts](src/config.ts) and the `<title>` in [index.html](index.html).

## What works

- Create a room (public or private; requests auto-added or host-approved) and share it by link, 6-character code or QR code.
- Join as a guest with a display name and an emoji avatar. No sign-up.
- Search YouTube or paste a YouTube, Spotify or SoundCloud track link, and add it to the shared queue.
- Host controls: play, pause, seek, next, previous, play any record now, drag to reorder, remove, approve or reject, pause requests, allow duplicates, remove a member, close the room.
- Guests see playback state and progress but cannot control it. They can react, and withdraw their own requests.
- Queue, participants, reactions and playback update live for everyone.
- YouTube plays in sync for the whole room. Spotify and SoundCloud are embed only (see [Music providers](#music-providers)).

Not included: uploaded avatar images (avatars are picked from a fixed emoji set), handing the host role to someone else, and chat.

## Architecture

```
Browser (React 19 + TypeScript + Vite + Tailwind 4 + Framer Motion)
  pages/         Home, CreateRoom, RoomGate -> JoinRoom | ListeningRoom
  components/    vinyl shelf, player, queue, search, reactions, participants, room
  hooks/         useRoom (live room state), usePlaybackSync (YouTube player <-> room timeline)
  services/      roomService, queueService, playbackService, reactionService
  services/providers/   one adapter per music service behind a common interface
        |
        |  supabase-js: anonymous auth, RPC calls, Realtime
        v
Supabase
  Postgres       tables + read-only RLS + SECURITY DEFINER functions for every write
  Realtime       postgres_changes on rooms / room_members / queue_items, presence for "online"
  Edge Functions youtube-search (holds the YouTube Data API key)
                 lyrics (LRCLIB lookup, cached in lyrics_cache)
```

### Who is allowed to do what

Every visitor, host or guest, gets a Supabase **anonymous session**, so each browser has a real `auth.uid()`.

- Tables are **read-only** for clients, and only for rooms the caller is an active member of. There are no insert, update or delete policies.
- Every write is a Postgres function ([supabase/migrations](supabase/migrations)) that works out who the caller is from `auth.uid()`. The host is whoever `rooms.host_id` says. The client never sends a role.
- Rate limits (room creation, joins, requests, reactions) are enforced in those functions.
- The only keys in the browser are the project URL and the anon key. The YouTube key lives only in the Edge Function.

### Realtime and playback sync

The database is the source of truth. Realtime events are treated as "something changed": each one triggers a debounced reload of the whole room through `get_room_state`, so a missed event cannot leave a client with a wrong queue. The same reload runs on reconnect, when the tab becomes visible and when the network returns, which is how a disconnected guest recovers.

Playback is one timeline per room, stored on the `rooms` row and written only by the host:

```
position now = playback_position + (server now - playback_started_at)   while playing
```

The row is written on play, pause, seek, track change and when the host's player has drifted. It is never written on a timer. Each client estimates the server's clock by pinging `server_time()`: five times on entering the room, then every 30 seconds and whenever the tab becomes visible again ([src/lib/serverClock.ts](src/lib/serverClock.ts), a port of the Listen Together clock in SimpMusic and Metrolist). Positions are computed against that clock, on a monotonic local clock, so a wrong or changing device clock does not matter.

How far a player may drift before it is corrected is decided in [src/lib/driftPolicy.ts](src/lib/driftPolicy.ts):

| Who | Corrected when off by more than | How |
| --- | --- | --- |
| Guest, clock calibrated (3 good samples) | 0.5 s | Seeks its own player |
| Guest, not calibrated yet | 1.2 s | Seeks its own player |
| Host | 0.8 s | Moves the room's timeline to its player |

At most one correction every 8 seconds. If three in a row do not hold (a slow connection), the tolerance widens to 1.5 seconds until the next track instead of seeking in a loop. Each seek aims slightly ahead by the rebuffering time measured on earlier seeks.

If `server_time()` is missing (the migration has not been applied), clients fall back to the offset measured when the room state was loaded and stay on the 1.2 second tolerance.

To measure sync yourself: open the room in two browser profiles and on a phone on the same network, play a track with a clear beat, and compare. For numbers, run this in each browser's console inside the YouTube frame (pick the `youtube.com` frame in DevTools) at the same moment: `document.querySelector('video').currentTime`.

If the browser blocks autoplay, the listener sees a **Join listening** button. Known limit: the queue advances from the host's browser. If the host closes their tab, the current record finishes for everyone, but the next one does not start until the host is back.

### Smooth transitions

The host chooses a fade length of 0 to 8 seconds in **About room** (`rooms.transition_seconds`, default 3). 0 keeps records changing with no fade.

There is one YouTube player on the page, always visible, and two tracks never play at once: YouTube's terms rule out a real crossfade. Instead the current record fades out, the room moves on, and the next record fades in.

- **Fade-out** is a function of the room's shared timeline (`expectedPosition`) and the track's stored length, not of any event in one browser, so every listener's volume goes down at the same moment. It ends one second before the stored end, because a stored length is a whole number and can be longer than the video.
- **The change:** when the fade-out reaches silence the host's browser calls `play_next` with the record it expects to be current, so a second call does nothing.
- **Fade-in** starts when this browser's player is actually playing the new record. The drift policy makes no corrections until it is over.
- The curve is equal-power (cos out, sin in) and ends at the listener's own volume, never at 100.

No fade-out happens for a track shorter than two fades plus five seconds, for the last record in the queue, for Spotify and SoundCloud embeds, or when the host presses next, previous or picks a record. A manual next still fades in for one second. A browser that cannot set the volume (iOS and iPadOS) changes records without fading.

The gain is recomputed from the clock many times a second and never stored, so a listener cannot be left at zero: if the host's tab closes during a fade, the volume returns 2.5 seconds after the fade ends.

About 20 seconds before a record ends, every browser downloads the next record's cover, and the host makes sure the next record has a stored length.

`set_playback` takes the record a position was measured on (`p_expected_current`) and ignores the call if the room has moved on. Without it a host re-anchor sent just before a change could land on the next record.

If the migration has not been applied, the room row has no `transition_seconds`: records change with no fade, and the slider is not shown.

### Music providers

Adapters implement `search`, `getTrackDetails`, `getEmbedUrl`, `getArtwork`, `getDuration` and `validateUrl` ([src/services/providers/types.ts](src/services/providers/types.ts)).

| Provider | Search | Paste a link | Playback |
| --- | --- | --- | --- |
| YouTube (and YouTube Music links) | Yes, with an API key | Yes | Synced for the room through the official IFrame Player API |
| Spotify | No | Track links | Official embed. Each listener presses play. Not synced |
| SoundCloud | No | Track links | Official widget. Each listener presses play. Not synced |

Spotify and SoundCloud are not synced because their embeds do not let a third-party page drive playback for other people. The UI says so rather than showing controls that do nothing. Nothing is downloaded or proxied.

To add a provider: write an adapter, register it in [src/services/providers/index.ts](src/services/providers/index.ts), and allow its id in the `tracks.provider` check and in `request_track` in a new migration.

## Environment variables

Copy `.env.example` to `.env.local`.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local` / host env | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` / host env | Anon (publishable) key. Safe in the browser |
| `YOUTUBE_API_KEY` | Supabase secret only | YouTube Data API v3 key for search |

Never put the Supabase service role key or the YouTube key in a `VITE_` variable.

## Supabase setup

1. Create a project at supabase.com.
2. **Authentication > Sign In / Providers**: turn on **Allow anonymous sign-ins**. The app cannot work without it. Turning on CAPTCHA for anonymous sign-ins is recommended for a public deployment.
3. Apply the migration (next section).
4. Deploy the search function (section after that).
5. **Project Settings > API**: copy the URL and anon key into `.env.local`.

### Database migration

With the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or paste [supabase/migrations/20261112000000_vinyl_room.sql](supabase/migrations/20261112000000_vinyl_room.sql) into the SQL editor and run it once.

The migration creates the tables, indexes, RLS policies and functions, and adds `rooms`, `room_members` and `queue_items` to the `supabase_realtime` publication.

To check the migration and the permission rules without a Supabase project:

```bash
npm run test:db
```

This runs the migration in an in-process Postgres and walks the whole room scenario, including what guests and outsiders must not be able to do.

### YouTube API configuration

Search needs a YouTube Data API v3 key. Without one the app still works: people paste YouTube links, and the title and artwork come from YouTube's oEmbed endpoint.

1. In Google Cloud Console, create a project and enable **YouTube Data API v3**.
2. Create an API key and restrict it to that API.
3. Store it as a secret and deploy the function:

```bash
npx supabase secrets set YOUTUBE_API_KEY=<your-key>
npx supabase functions deploy youtube-search
```

Quota: each search costs 100 units of the default 10,000 per day, so about 100 searches a day. The function caches repeat queries for 10 minutes and search runs on submit, not per keystroke. Request a quota increase from Google before a real launch.

### Lyrics

Synced lyrics come from [LRCLIB](https://lrclib.net) through the `lyrics` Edge Function. The Lyrics button in the player bar opens them: a column beside the room on wide screens, a sheet on phones, and a full screen view over the record's artwork. The line shown is read from the room's shared timeline, not from the local player, so every listener sees the same one. `±0.5s` nudges the timing for this browser only, per track.

The client (`src/services/lyricsService.ts`) reads `lyrics_cache` directly and calls the function only when there is no usable row. It does so only while the lyrics are open, and fetches the next record's lyrics 20 seconds before the current one ends.

The provider's player is never covered by the lyrics. `LyricsDock` lays the lyrics out around `Screen` instead of putting a layer over it.

Deploy it after the `lyrics_cache` migration has been applied (the function needs the table and `consume_lyrics_quota`):

```bash
npx supabase db push
npx supabase functions deploy lyrics
```

It needs no secret of its own. It reuses `YOUTUBE_API_KEY` when a track has no duration, and writes with the service role key that Supabase gives every Edge Function (`SUPABASE_SERVICE_ROLE_KEY`). If your project does not provide that variable, set it yourself as `SERVICE_ROLE_KEY`; without either, lyrics are still returned but not cached (`"stored": false` in the response).

How a lookup works:

1. The caller must be a member of a room that has the track. The function reads the track with the caller's token, so row level security decides. 30 lookups a minute per person.
2. If `lyrics_cache` has a row, that is the answer. A "nothing found" row is trusted for 7 days, unless it was recorded for a Spotify track whose artist was still unknown.
3. What the track row lacks is filled in and stored on the track, depending on the provider:
   - **YouTube:** a missing duration (a pasted link) is asked from `videos.list` (1 quota unit). No other provider triggers this call.
   - **Spotify:** a pasted link is stored with a title only, because Spotify's oEmbed returns neither artist nor duration. Both are read from the official embed page (`_shared/spotifyMeta.ts`). If that fails the track cannot be matched, and the miss is not cached.
   - **SoundCloud:** title and uploader are used as stored. No duration is available, so the match is by name alone.
4. The names are turned into queries. A YouTube or SoundCloud title is cleaned ("(Official Video)", "[MV]", "ft. ...", a channel's "- Topic") and read as artist and song in several ways. A Spotify title is taken as the song and its artist as the artist; only a version suffix ("- Remastered 2011") and guest credits are removed.
5. LRCLIB is asked with `/api/get`, then `/api/search`, at most 6 requests. The best record wins: synced lyrics within 2 seconds of the track's length, then synced within 10, then plain. A record more than 10 seconds off, or whose name does not match, is never used.
6. The result is stored. When the duration was unknown, `matched_duration` is left null, and the row is deleted as soon as the host's player reports the duration (`set_track_duration`), so the next lookup can match on length too.

`lyrics_cache` (one row per track, shared by every room that queues it):

| Column | Meaning |
| --- | --- |
| `track_id` | Primary key, references `tracks` |
| `source` | `lrclib`, or `none` when nothing was found |
| `synced_lrc` | LRC text with timestamps, or null |
| `plain_lyrics` | Untimed lyrics, or null |
| `instrumental` | The source marks the track as having no words |
| `matched_duration` | Length in seconds of the matched record; null if the match was by name alone |
| `provider_record_id` | LRCLIB's record id |
| `fetched_at` | When it was looked up |

Clients can only read it, and only for tracks in their rooms. There is no write policy; the function writes with the service role.

`src/lib/lrc.ts` turns `synced_lrc` into `{ timeMs, text }[]`.

## Local development

Requires Node 20.19 or newer.

```bash
npm install
cp .env.example .env.local    # then fill in the two values
npm run dev                   # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, also reachable on your LAN |
| `npm run typecheck` | TypeScript only |
| `npm run build` | Typecheck and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (vitest): server clock, drift policy, LRC parser, lyrics matching, current lyric line and offset, transition fade curve |
| `npm run test:db` | Migration and permission tests, no Supabase needed |

To try it with several people on one machine, use separate browser profiles or a private window per person. Tabs in the same profile share one anonymous session, so they are the same person.

To test from a phone on the same Wi-Fi, open the network URL that `npm run dev` prints. The copy-link button needs HTTPS, so on a plain LAN address the link is selectable instead.

## Deployment

The app is a static site plus Supabase.

1. Run `npm run build` and host `dist/` anywhere static (Vercel, Netlify, Cloudflare Pages).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's build environment.
3. Every path must serve `index.html` so that `/r/<code>` links work. [vercel.json](vercel.json) and [public/_redirects](public/_redirects) already do this for Vercel and Netlify / Cloudflare Pages.
4. Serve over HTTPS. Clipboard, the share sheet and the YouTube player expect it.

## Project structure

```
src/
  pages/                 HomePage, CreateRoomPage, RoomGate, JoinRoomPage, ListeningRoomPage
  components/
    layout/              Backdrop, Logo, Sheet (side panel / bottom sheet), Notice
    vinyl/               VinylShelf (CSS 3D), Disc, Artwork
    player/              PlayerBar, Screen (the provider's own player)
    queue/ search/ reactions/ participants/ room/
  hooks/                 useRoom, usePlaybackSync, useToast, useNow
  services/              room, queue, playback, reaction services + providers/
  lib/                   supabase client, errors, formatting, remembered guest identity
  types/
supabase/
  migrations/            schema, RLS, RPCs, realtime
  functions/youtube-search/
scripts/test-db.mjs      database tests
```

## License

GPL-3.0-only. See [LICENSE](LICENSE). Credits for the projects this one builds on are in [NOTICE.md](NOTICE.md).
