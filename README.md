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
  Edge Function  youtube-search (holds the YouTube Data API key)
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
| `npm test` | Unit tests (vitest): server clock, drift policy |
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
