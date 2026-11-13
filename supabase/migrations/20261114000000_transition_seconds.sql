-- ============================================================================
-- Smooth transitions between records.
--
-- rooms.transition_seconds: how long one record fades out and the next fades
-- in, chosen by the host. 0 keeps the old behaviour (records change with no
-- fade). The fading itself happens in each browser; the database only stores
-- the setting.
--
-- get_room_state returns the room with to_jsonb(rooms), so the new column is
-- part of the state without redefining that function. Realtime carries it in
-- the rooms row for the same reason.
--
-- Also here: set_playback learns which record a position was measured on (see
-- the second half of this file).
-- ============================================================================

alter table public.rooms
  add column transition_seconds smallint not null default 3
  check (transition_seconds between 0 and 8);

-- A new argument changes the function's signature, so the old one is dropped
-- rather than replaced. Callers that pass the first six arguments (the
-- frontend before this change) keep working: the new one has a default.
drop function public.update_room_settings(uuid, text, text, text, boolean, boolean);

create function public.update_room_settings(
  p_room_id uuid,
  p_name text default null,
  p_visibility text default null,
  p_request_mode text default null,
  p_allow_requests boolean default null,
  p_allow_duplicates boolean default null,
  p_transition_seconds integer default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms := public._require_host(p_room_id);
begin
  if (p_visibility is not null and p_visibility not in ('public', 'private'))
     or (p_request_mode is not null and p_request_mode not in ('auto', 'approval'))
     or (p_transition_seconds is not null and p_transition_seconds not between 0 and 8) then
    raise exception 'VR_INVALID_INPUT';
  end if;
  update public.rooms set
    name               = case when p_name is null then name else public._clean_name(p_name, 60) end,
    visibility         = coalesce(p_visibility, visibility),
    request_mode       = coalesce(p_request_mode, request_mode),
    allow_requests     = coalesce(p_allow_requests, allow_requests),
    allow_duplicates   = coalesce(p_allow_duplicates, allow_duplicates),
    transition_seconds = coalesce(p_transition_seconds, transition_seconds),
    updated_at         = clock_timestamp()
  where id = v_room.id;
end $$;

revoke execute on function public.update_room_settings(uuid, text, text, text, boolean, boolean, integer) from public, anon;
grant execute on function public.update_room_settings(uuid, text, text, text, boolean, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- set_playback: p_expected_current, the same guard play_next already has.
--
-- The host's browser re-anchors the room to its own player ("I am at 3:12").
-- That position belongs to the record its player is on. If the room moved to
-- the next record while the request was travelling, the old position would be
-- written onto the new record's timeline and everyone would jump into the
-- middle of it. With transitions the host changes records by the clock, so
-- the two requests meet more often than they used to.
--
-- A call that names the record it was measured on is ignored when that is no
-- longer the current one. Callers that do not pass it behave as before.
-- ---------------------------------------------------------------------------

drop function public.set_playback(uuid, text, double precision);

create function public.set_playback(
  p_room_id uuid,
  p_status text,
  p_position double precision,
  p_expected_current uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms := public._require_host(p_room_id);
begin
  if p_status not in ('playing', 'paused') then raise exception 'VR_INVALID_INPUT'; end if;
  if p_expected_current is not null and v_room.current_item_id is distinct from p_expected_current then
    return;
  end if;
  if v_room.current_item_id is null then
    -- Nothing on the turntable: "play" drops the needle on the first record.
    if p_status = 'playing' then
      perform public._set_current(v_room.id, public._next_item(v_room.id));
    end if;
    return;
  end if;
  update public.rooms
     set playback_status = p_status,
         playback_position = greatest(0, least(coalesce(p_position, 0), 86400)),
         playback_started_at = case when p_status = 'playing' then clock_timestamp() end,
         updated_at = clock_timestamp()
   where id = p_room_id;
end $$;

revoke execute on function public.set_playback(uuid, text, double precision, uuid) from public, anon;
grant execute on function public.set_playback(uuid, text, double precision, uuid) to authenticated;
