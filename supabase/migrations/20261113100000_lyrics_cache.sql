-- ============================================================================
-- Lyrics cache.
--
-- One row per track: what the `lyrics` Edge Function found on LRCLIB, or the
-- fact that it found nothing. Clients only read; the function writes with the
-- service role. There is no insert / update / delete policy.
-- ============================================================================

create table public.lyrics_cache (
  track_id           uuid primary key references public.tracks (id) on delete cascade,
  -- 'none' records a lookup that found nothing, so it is not repeated for 7 days.
  source             text not null check (source in ('lrclib', 'none')),
  synced_lrc         text check (char_length(synced_lrc) <= 200000),
  plain_lyrics       text check (char_length(plain_lyrics) <= 200000),
  instrumental       boolean not null default false,
  -- Running time (seconds) of the record that was matched, when the track's
  -- own duration was known and compared. NULL = matched by name alone (or
  -- nothing found): worth looking up again once the duration is known.
  matched_duration   integer check (matched_duration is null or matched_duration between 1 and 86400),
  provider_record_id bigint,
  fetched_at         timestamptz not null default now()
);

alter table public.lyrics_cache enable row level security;

-- Same rule as tracks: visible to members of a room that has the track.
create policy lyrics_cache_select_in_my_rooms on public.lyrics_cache
  for select to authenticated using (
    exists (select 1 from public.queue_items q where q.track_id = lyrics_cache.track_id and public.is_room_member(q.room_id))
  );

revoke all on public.lyrics_cache from anon, authenticated;
grant select on public.lyrics_cache to authenticated;
grant select, insert, update, delete on public.lyrics_cache to service_role;

-- ---------------------------------------------------------------------------
-- Called by the Edge Function as the visitor, before it does any work: proves
-- the caller is signed in (the anon role cannot execute it) and rate limits them.
-- ---------------------------------------------------------------------------

create function public.consume_lyrics_quota()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public._rate_limit(public._uid(), 'lyrics_minute', 30, interval '1 minute');
end $$;

revoke execute on function public.consume_lyrics_quota() from public, anon;
grant execute on function public.consume_lyrics_quota() to authenticated;

-- ---------------------------------------------------------------------------
-- When the host's player reports a duration the track did not have, lyrics
-- that were matched without one are dropped, so the next lookup can match on
-- running time as well. Same signature and grants as before.
-- ---------------------------------------------------------------------------

create or replace function public.set_track_duration(p_item_id uuid, p_duration_seconds integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_item public.queue_items;
begin
  select * into v_item from public.queue_items where id = p_item_id;
  if not found then raise exception 'VR_NOT_FOUND'; end if;
  perform public._require_host(v_item.room_id);
  if p_duration_seconds between 1 and 86400 then
    update public.tracks set duration_seconds = p_duration_seconds
     where id = v_item.track_id and duration_seconds is null;
    if found then
      delete from public.lyrics_cache
       where track_id = v_item.track_id and matched_duration is null;
    end if;
  end if;
end $$;
