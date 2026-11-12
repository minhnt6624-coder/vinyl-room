-- ============================================================================
-- server_time(): the "pong" for client clock synchronisation.
--
-- Each client pings this a few times, and from its own send / receive times
-- plus the two server times below works out how far its clock is from the
-- server's (see src/lib/serverClock.ts). Playback positions are then computed
-- against server time, so every browser in a room agrees on "now".
--
--   receive_ms  when the request's transaction began on the database
--   send_ms     when this function ran
-- Both are milliseconds since the Unix epoch, with a fractional part.
--
-- It reads no table and takes no argument, so it runs as the caller (not
-- SECURITY DEFINER) and is not rate limited: a counter would turn a read into
-- a write on every ping.
-- ============================================================================

create function public.server_time()
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'receive_ms', (extract(epoch from now()) * 1000)::double precision,
    'send_ms',    (extract(epoch from clock_timestamp()) * 1000)::double precision
  );
$$;

revoke execute on function public.server_time() from public, anon;
grant execute on function public.server_time() to authenticated;
