# Vinyl Room

A shared listening room: one host, guests join by link, one queue, everyone hears the same moment. See [README.md](README.md) for setup and deployment.

## Architecture

- **Frontend:** Vite + React 19 + TypeScript + Tailwind 4 + Framer Motion. A static SPA on Vercel. Not Next.js: there are no API routes.
- **Backend:** Supabase only.
  - Anonymous auth: every visitor has a real `auth.uid()`.
  - Postgres with read-only RLS. Every write is a `SECURITY DEFINER` function in `supabase/migrations/`.
  - Realtime: `postgres_changes` on `rooms`, `room_members`, `queue_items`; presence for "online".
  - Edge Functions in `supabase/functions/` (`youtube-search`).
- **Layout of `src/`:** `pages/` → `components/` → `hooks/` (`useRoom`, `usePlaybackSync`) → `services/` (one per domain, plus `providers/` adapters) → `lib/`.
- **Playback:** one timeline per room on the `rooms` row, written only by the host. Clients follow it with the official YouTube IFrame Player. Spotify and SoundCloud are embed only.
- **State:** the database is the source of truth. A Realtime event means "something changed" and triggers a reload through `get_room_state`.

## Rules

Database
- Never edit an existing migration. Always add a new one.
- Never add an insert, update or delete policy. Writes go through RPCs.
- The client never sends a role or a user id. Derive both from `auth.uid()` inside the function.
- Every new function: `security definer set search_path = public`, then `revoke execute ... from public, anon` and grant only to `authenticated`.
- Rate limit anything a guest can repeat, using `_rate_limit`.
- Add cases to `scripts/test-db.mjs` for every new RPC and policy.

Secrets
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` reach the browser.
- API keys (YouTube, AI) live only in Edge Function secrets.
- An Edge Function must check the caller itself. The gateway's `verify_jwt` lets the publishable key through.

Music providers
- Official embedded players only. Never extract, download or proxy audio.
- Do not show controls for something a provider's API cannot do.

UI
- Keep the design tokens in `src/index.css` and the `components/layout/` pieces (`Sheet`, `Notice`, `Backdrop`, `Logo`).
- Do not change existing screens unless asked.
- `.pill`, `.icon-btn` and `.btn` set `display`, so hide them with `!hidden` / `md:!hidden`, not `hidden`.
- Check 375px and 1440px, and `prefers-reduced-motion`.

## Before calling work done

```bash
npm run typecheck
npm run build
npm test
npm run test:db
```

For anything touching rooms or playback, also try it with two or three browser profiles. Tabs in one profile share a session and count as one person.

## Production

- The Supabase project is live. Do not reset it or delete data.
- `supabase db push` and `supabase functions deploy` change production. Ask first.
- Apply a migration before deploying a function that depends on it.

## SimpMusic reference code

- Kotlin source is in `SimpMusic-dev/` (git-ignored). The logic is in `SimpMusic-dev/core/`.
- It is GPL-3.0, and so is this repo. See [NOTICE.md](NOTICE.md).
- Port ideas and algorithms to TypeScript; do not copy Kotlin files in.
- Every ported file keeps a header crediting SimpMusic (and Metrolist where SimpMusic ported from it), and gets a row in NOTICE.md.
