-- ============================================================================
-- VINYL ROOM - schema, row level security, realtime and RPCs
--
-- Security model
--   * Every visitor (host or guest) signs in with Supabase anonymous auth, so
--     each browser has a real auth.uid() without any registration.
--   * Tables are SELECT-only for clients, scoped to rooms the caller is an
--     active member of. There are no INSERT / UPDATE / DELETE policies.
--   * Every write goes through a SECURITY DEFINER function below, which
--     re-derives the caller's identity and role from auth.uid(). The host is
--     whoever rooms.host_id says it is - a client can never claim that role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.rooms (
  id                  uuid primary key default gen_random_uuid(),
  room_code           text not null unique check (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  name                text not null check (char_length(name) between 1 and 60),
  host_id             uuid not null references auth.users (id) on delete cascade,
  visibility          text not null default 'private' check (visibility in ('public', 'private')),
  request_mode        text not null default 'auto' check (request_mode in ('auto', 'approval')),
  allow_requests      boolean not null default true,
  allow_duplicates    boolean not null default false,
  status              text not null default 'open' check (status in ('open', 'closed')),
  -- Playback: one authoritative timeline per room, written only by the host.
  -- While playing, the live position is
  --   playback_position + (now() - playback_started_at).
  current_item_id     uuid,
  playback_status     text not null default 'idle' check (playback_status in ('idle', 'playing', 'paused')),
  playback_position   double precision not null default 0 check (playback_position >= 0),
  playback_started_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  closed_at           timestamptz
);

create index rooms_host_idx on public.rooms (host_id);
create index rooms_public_idx on public.rooms (updated_at desc) where visibility = 'public' and status = 'open';

create table public.room_members (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 24),
  avatar        text not null default '🎧' check (char_length(avatar) between 1 and 16),
  role          text not null default 'guest' check (role in ('host', 'guest')),
  status        text not null default 'active' check (status in ('active', 'left', 'removed')),
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (room_id, user_id)
);

create index room_members_user_idx on public.room_members (user_id);

create table public.tracks (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null check (provider in ('youtube', 'spotify', 'soundcloud')),
  provider_track_id  text not null check (char_length(provider_track_id) between 1 and 200),
  title              text not null check (char_length(title) between 1 and 200),
  artist             text check (char_length(artist) <= 200),
  album              text check (char_length(album) <= 200),
  artwork_url        text check (char_length(artwork_url) <= 500),
  duration_seconds   integer check (duration_seconds is null or duration_seconds between 1 and 86400),
  external_url       text not null,
  created_at         timestamptz not null default now(),
  unique (provider, provider_track_id)
);

create table public.queue_items (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms (id) on delete cascade,
  track_id         uuid not null references public.tracks (id) on delete restrict,
  requested_by     uuid references public.room_members (id) on delete set null,
  status           text not null default 'approved'
                     check (status in ('pending', 'approved', 'playing', 'played', 'rejected', 'removed')),
  position         double precision not null,
  -- Denormalised {reaction_type: count}. Kept in step by toggle_reaction so a
  -- reaction reaches every client as an ordinary queue_items UPDATE.
  reaction_counts  jsonb not null default '{}'::jsonb,
  requested_at     timestamptz not null default now(),
  played_at        timestamptz
);

create index queue_items_room_idx on public.queue_items (room_id, status, position);
create index queue_items_track_idx on public.queue_items (track_id);
create index queue_items_requester_idx on public.queue_items (requested_by);
-- At most one record on the turntable per room.
create unique index queue_items_one_playing_idx on public.queue_items (room_id) where status = 'playing';

alter table public.rooms
  add constraint rooms_current_item_fk
  foreign key (current_item_id) references public.queue_items (id) on delete set null;

create table public.reactions (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  queue_item_id  uuid not null references public.queue_items (id) on delete cascade,
  member_id      uuid not null references public.room_members (id) on delete cascade,
  reaction_type  text not null check (reaction_type in ('love', 'fire', 'vibe', 'funny', 'clap')),
  created_at     timestamptz not null default now(),
  unique (queue_item_id, member_id, reaction_type)
);

create index reactions_member_idx on public.reactions (member_id);
create index reactions_room_idx on public.reactions (room_id);

-- Fixed-window counters used by the RPCs. Never readable by clients.
create table public.rate_limits (
  subject       uuid not null,
  action        text not null,
  window_start  timestamptz not null default now(),
  count         integer not null default 1,
  primary key (subject, action)
);

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

create function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid() and status = 'active'
  );
$$;

create function public._uid()
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'VR_NOT_AUTHENTICATED'; end if;
  return v;
end $$;

create function public._require_member(p_room_id uuid)
returns public.room_members
language plpgsql stable security definer set search_path = public
as $$
declare v public.room_members;
begin
  select * into v from public.room_members
  where room_id = p_room_id and user_id = public._uid() and status = 'active';
  if not found then raise exception 'VR_NOT_MEMBER'; end if;
  return v;
end $$;

-- Returns the room only if the caller is its host and it is still open.
create function public._require_host(p_room_id uuid)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare v public.rooms;
begin
  select * into v from public.rooms where id = p_room_id for update;
  if not found then raise exception 'VR_ROOM_NOT_FOUND'; end if;
  if v.host_id <> public._uid() then raise exception 'VR_NOT_HOST'; end if;
  if v.status <> 'open' then raise exception 'VR_ROOM_CLOSED'; end if;
  return v;
end $$;

create function public._rate_limit(p_subject uuid, p_action text, p_max integer, p_window interval)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  insert into public.rate_limits as rl (subject, action, window_start, count)
  values (p_subject, p_action, clock_timestamp(), 1)
  on conflict (subject, action) do update set
    count        = case when rl.window_start < clock_timestamp() - p_window then 1 else rl.count + 1 end,
    window_start = case when rl.window_start < clock_timestamp() - p_window then clock_timestamp() else rl.window_start end
  returning rl.count into v_count;
  if v_count > p_max then raise exception 'VR_RATE_LIMITED'; end if;
end $$;

create function public._clean_name(p_name text, p_max integer)
returns text
language plpgsql immutable
as $$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) = 0 then raise exception 'VR_INVALID_NAME'; end if;
  return left(v, p_max);
end $$;

create function public._clean_avatar(p_avatar text)
returns text
language sql immutable
as $$
  select case
    when p_avatar is null or char_length(btrim(p_avatar)) = 0 or char_length(p_avatar) > 16 then '🎧'
    else btrim(p_avatar)
  end;
$$;

-- Puts p_item on the turntable (or clears it when null) and restarts the timeline.
create function public._set_current(p_room_id uuid, p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.queue_items
     set status = 'played', played_at = clock_timestamp()
   where room_id = p_room_id and status = 'playing' and id is distinct from p_item_id;

  if p_item_id is null then
    update public.rooms
       set current_item_id = null, playback_status = 'idle', playback_position = 0,
           playback_started_at = null, updated_at = clock_timestamp()
     where id = p_room_id;
  else
    update public.queue_items set status = 'playing', played_at = null where id = p_item_id;
    update public.rooms
       set current_item_id = p_item_id, playback_status = 'playing', playback_position = 0,
           playback_started_at = clock_timestamp(), updated_at = clock_timestamp()
     where id = p_room_id;
  end if;
end $$;

create function public._next_item(p_room_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.queue_items
  where room_id = p_room_id and status = 'approved'
  order by position, requested_at
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Rooms and membership
-- ---------------------------------------------------------------------------

create function public.create_room(
  p_name text,
  p_visibility text,
  p_request_mode text,
  p_display_name text,
  p_avatar text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := public._uid();
  v_room public.rooms;
  v_code text;
begin
  if p_visibility not in ('public', 'private') or p_request_mode not in ('auto', 'approval') then
    raise exception 'VR_INVALID_INPUT';
  end if;
  perform public._rate_limit(v_uid, 'create_room', 5, interval '10 minutes');
  if (select count(*) from public.rooms where host_id = v_uid and status = 'open') >= 5 then
    raise exception 'VR_TOO_MANY_ROOMS';
  end if;

  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
      into v_code
      from generate_series(1, 6);
    exit when not exists (select 1 from public.rooms where room_code = v_code);
  end loop;

  insert into public.rooms (room_code, name, host_id, visibility, request_mode)
  values (v_code, public._clean_name(p_name, 60), v_uid, p_visibility, p_request_mode)
  returning * into v_room;

  insert into public.room_members (room_id, user_id, display_name, avatar, role)
  values (v_room.id, v_uid, public._clean_name(p_display_name, 24), public._clean_avatar(p_avatar), 'host');

  return jsonb_build_object('room_id', v_room.id, 'room_code', v_room.room_code);
end $$;

-- What a visitor sees on the join screen. Knowing the code is the invitation.
create function public.get_room_preview(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid  uuid := public._uid();
  v_room public.rooms;
  v_me   public.room_members;
  v_host public.room_members;
begin
  select * into v_room from public.rooms where room_code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select * into v_me from public.room_members where room_id = v_room.id and user_id = v_uid;
  select * into v_host from public.room_members where room_id = v_room.id and user_id = v_room.host_id;
  return jsonb_build_object(
    'id', v_room.id,
    'room_code', v_room.room_code,
    'name', v_room.name,
    'status', v_room.status,
    'request_mode', v_room.request_mode,
    'host_name', v_host.display_name,
    'host_avatar', v_host.avatar,
    'member_count', (select count(*) from public.room_members where room_id = v_room.id and status = 'active'),
    'my_status', v_me.status,
    'is_host', v_room.host_id = v_uid
  );
end $$;

create function public.join_room(p_code text, p_display_name text, p_avatar text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := public._uid();
  v_room   public.rooms;
  v_member public.room_members;
begin
  perform public._rate_limit(v_uid, 'join_room', 20, interval '1 minute');
  select * into v_room from public.rooms
   where room_code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'VR_ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'open' then raise exception 'VR_ROOM_CLOSED'; end if;

  select * into v_member from public.room_members where room_id = v_room.id and user_id = v_uid;
  if found and v_member.status = 'removed' then raise exception 'VR_REMOVED'; end if;
  if (not found or v_member.status <> 'active')
     and (select count(*) from public.room_members where room_id = v_room.id and status = 'active') >= 50 then
    raise exception 'VR_ROOM_FULL';
  end if;

  insert into public.room_members as m (room_id, user_id, display_name, avatar, role)
  values (
    v_room.id, v_uid, public._clean_name(p_display_name, 24), public._clean_avatar(p_avatar),
    case when v_room.host_id = v_uid then 'host' else 'guest' end
  )
  on conflict (room_id, user_id) do update
    set display_name = excluded.display_name,
        avatar       = excluded.avatar,
        status       = 'active',
        last_seen_at = clock_timestamp()
  returning * into v_member;

  return jsonb_build_object('room_id', v_room.id, 'member_id', v_member.id, 'role', v_member.role);
end $$;

create function public.leave_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_member public.room_members := public._require_member(p_room_id);
begin
  if v_member.role = 'host' then raise exception 'VR_HOST_CANNOT_LEAVE'; end if;
  update public.room_members set status = 'left', last_seen_at = clock_timestamp() where id = v_member.id;
end $$;

create function public.remove_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_target public.room_members;
  v_room   public.rooms;
begin
  select * into v_target from public.room_members where id = p_member_id;
  if not found then raise exception 'VR_NOT_FOUND'; end if;
  v_room := public._require_host(v_target.room_id);
  if v_target.user_id = v_room.host_id then raise exception 'VR_INVALID_INPUT'; end if;
  update public.room_members set status = 'removed' where id = p_member_id;
  -- Their not-yet-played requests leave with them.
  update public.queue_items set status = 'removed'
   where room_id = v_room.id and requested_by = p_member_id and status in ('pending', 'approved');
end $$;

create function public.update_room_settings(
  p_room_id uuid,
  p_name text default null,
  p_visibility text default null,
  p_request_mode text default null,
  p_allow_requests boolean default null,
  p_allow_duplicates boolean default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms := public._require_host(p_room_id);
begin
  if (p_visibility is not null and p_visibility not in ('public', 'private'))
     or (p_request_mode is not null and p_request_mode not in ('auto', 'approval')) then
    raise exception 'VR_INVALID_INPUT';
  end if;
  update public.rooms set
    name             = case when p_name is null then name else public._clean_name(p_name, 60) end,
    visibility       = coalesce(p_visibility, visibility),
    request_mode     = coalesce(p_request_mode, request_mode),
    allow_requests   = coalesce(p_allow_requests, allow_requests),
    allow_duplicates = coalesce(p_allow_duplicates, allow_duplicates),
    updated_at       = clock_timestamp()
  where id = v_room.id;
end $$;

create function public.close_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms := public._require_host(p_room_id);
begin
  perform public._set_current(v_room.id, null);
  update public.rooms
     set status = 'closed', closed_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = v_room.id;
end $$;

create function public.list_public_rooms()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select r.room_code, r.name,
           (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'active') as member_count,
           (select t.title from public.queue_items q join public.tracks t on t.id = q.track_id
             where q.id = r.current_item_id) as now_playing
    from public.rooms r
    where r.visibility = 'public' and r.status = 'open' and auth.uid() is not null
    order by r.updated_at desc
    limit 24
  ) x;
$$;

-- The whole room in one round trip. Clients call this on load, after every
-- realtime event (debounced) and on reconnect, so state can never drift.
create function public.get_room_state(p_room_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me   public.room_members := public._require_member(p_room_id);
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'room', to_jsonb(v_room),
    'me', jsonb_build_object('id', v_me.id, 'role', v_me.role, 'display_name', v_me.display_name, 'avatar', v_me.avatar),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'display_name', m.display_name, 'avatar', m.avatar, 'role', m.role, 'joined_at', m.joined_at
      ) order by (m.role = 'host') desc, m.joined_at), '[]'::jsonb)
      from public.room_members m
      where m.room_id = p_room_id and m.status = 'active'
    ),
    'queue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id,
        'status', q.status,
        'position', q.position,
        'requested_at', q.requested_at,
        'played_at', q.played_at,
        'reaction_counts', q.reaction_counts,
        'my_reactions', (
          select coalesce(jsonb_agg(r.reaction_type), '[]'::jsonb)
          from public.reactions r where r.queue_item_id = q.id and r.member_id = v_me.id
        ),
        'requested_by', q.requested_by,
        'requester_name', rm.display_name,
        'requester_avatar', rm.avatar,
        'track', jsonb_build_object(
          'id', t.id, 'provider', t.provider, 'provider_track_id', t.provider_track_id,
          'title', t.title, 'artist', t.artist, 'album', t.album, 'artwork_url', t.artwork_url,
          'duration_seconds', t.duration_seconds, 'external_url', t.external_url
        )
      ) order by q.position, q.requested_at), '[]'::jsonb)
      from public.queue_items q
      join public.tracks t on t.id = q.track_id
      left join public.room_members rm on rm.id = q.requested_by
      where q.room_id = p_room_id
        and (
          q.status in ('pending', 'approved', 'playing')
          or (q.status = 'played' and q.id in (
            select p.id from public.queue_items p
            where p.room_id = p_room_id and p.status = 'played'
            order by p.played_at desc limit 40
          ))
        )
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Queue
-- ---------------------------------------------------------------------------

create function public.request_track(
  p_room_id uuid,
  p_provider text,
  p_provider_track_id text,
  p_title text,
  p_artist text default null,
  p_album text default null,
  p_artwork_url text default null,
  p_duration_seconds integer default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_member   public.room_members := public._require_member(p_room_id);
  v_room     public.rooms;
  v_is_host  boolean;
  v_track_id uuid;
  v_external text;
  v_artwork  text;
  v_status   text;
  v_item_id  uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.status <> 'open' then raise exception 'VR_ROOM_CLOSED'; end if;
  v_is_host := v_room.host_id = v_member.user_id;
  if not v_is_host and not v_room.allow_requests then raise exception 'VR_REQUESTS_DISABLED'; end if;

  -- Links and (for YouTube) artwork are derived here rather than taken from
  -- the client, so a request can only ever point at the provider itself.
  if p_provider = 'youtube' and p_provider_track_id ~ '^[A-Za-z0-9_-]{11}$' then
    v_external := 'https://www.youtube.com/watch?v=' || p_provider_track_id;
    v_artwork  := 'https://i.ytimg.com/vi/' || p_provider_track_id || '/hqdefault.jpg';
  elsif p_provider = 'spotify' and p_provider_track_id ~ '^[A-Za-z0-9]{22}$' then
    v_external := 'https://open.spotify.com/track/' || p_provider_track_id;
  elsif p_provider = 'soundcloud' and p_provider_track_id ~ '^[A-Za-z0-9_-]{1,80}/[A-Za-z0-9_-]{1,100}$' then
    v_external := 'https://soundcloud.com/' || p_provider_track_id;
  else
    raise exception 'VR_INVALID_TRACK';
  end if;
  if v_artwork is null
     and p_artwork_url ~ '^https://([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com|sndcdn\.com)/[^\s"''<>]+$'
     and char_length(p_artwork_url) <= 500 then
    v_artwork := p_artwork_url;
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'VR_INVALID_TRACK'; end if;

  perform public._rate_limit(v_member.id, 'request_track', case when v_is_host then 40 else 8 end, interval '1 minute');
  if not v_is_host and (
       select count(*) from public.queue_items
       where room_id = p_room_id and requested_by = v_member.id and status in ('pending', 'approved')
     ) >= 10 then
    raise exception 'VR_TOO_MANY_REQUESTS';
  end if;
  if (select count(*) from public.queue_items
      where room_id = p_room_id and status in ('pending', 'approved')) >= 200 then
    raise exception 'VR_QUEUE_FULL';
  end if;

  -- First writer wins on metadata; later requests only fill in a missing duration.
  insert into public.tracks as t (provider, provider_track_id, title, artist, album, artwork_url, duration_seconds, external_url)
  values (
    p_provider, p_provider_track_id, left(btrim(p_title), 200),
    nullif(left(btrim(coalesce(p_artist, '')), 200), ''),
    nullif(left(btrim(coalesce(p_album, '')), 200), ''),
    v_artwork,
    case when p_duration_seconds between 1 and 86400 then p_duration_seconds end,
    v_external
  )
  on conflict (provider, provider_track_id) do update
    set duration_seconds = coalesce(t.duration_seconds, excluded.duration_seconds)
  returning t.id into v_track_id;

  if not v_room.allow_duplicates and exists (
       select 1 from public.queue_items
       where room_id = p_room_id and track_id = v_track_id and status in ('pending', 'approved', 'playing')
     ) then
    raise exception 'VR_DUPLICATE';
  end if;

  v_status := case when v_is_host or v_room.request_mode = 'auto' then 'approved' else 'pending' end;

  insert into public.queue_items (room_id, track_id, requested_by, status, position)
  values (
    p_room_id, v_track_id, v_member.id, v_status,
    (select coalesce(max(position), 0) + 1 from public.queue_items where room_id = p_room_id)
  )
  returning id into v_item_id;

  return jsonb_build_object('item_id', v_item_id, 'status', v_status);
end $$;

create function public.review_request(p_item_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_item public.queue_items;
begin
  select * into v_item from public.queue_items where id = p_item_id;
  if not found then raise exception 'VR_NOT_FOUND'; end if;
  perform public._require_host(v_item.room_id);
  update public.queue_items
     set status = case when p_approve then 'approved' else 'rejected' end
   where id = p_item_id and status = 'pending';
end $$;

-- A guest withdrawing their own request.
create function public.cancel_request(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item   public.queue_items;
  v_member public.room_members;
begin
  select * into v_item from public.queue_items where id = p_item_id;
  if not found then raise exception 'VR_NOT_FOUND'; end if;
  v_member := public._require_member(v_item.room_id);
  if v_item.requested_by is distinct from v_member.id then raise exception 'VR_NOT_ALLOWED'; end if;
  update public.queue_items set status = 'removed'
   where id = p_item_id and status in ('pending', 'approved');
end $$;

create function public.remove_queue_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.queue_items;
  v_room public.rooms;
begin
  select * into v_item from public.queue_items where id = p_item_id;
  if not found then raise exception 'VR_NOT_FOUND'; end if;
  v_room := public._require_host(v_item.room_id);
  if v_item.status = 'playing' then
    perform public._set_current(v_room.id, public._next_item(v_room.id));
  end if;
  update public.queue_items set status = 'removed'
   where id = p_item_id and status in ('pending', 'approved', 'played');
end $$;

-- p_item_ids is the complete upcoming order as the host sees it.
create function public.reorder_queue(p_room_id uuid, p_item_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare v_base double precision;
begin
  perform public._require_host(p_room_id);
  if coalesce(array_length(p_item_ids, 1), 0) > 400 then raise exception 'VR_INVALID_INPUT'; end if;
  -- Renumber after everything already played so history keeps its order.
  select coalesce(max(position), 0) into v_base
    from public.queue_items where room_id = p_room_id and status in ('played', 'playing');
  update public.queue_items q
     set position = v_base + o.ord
    from unnest(p_item_ids) with ordinality as o(id, ord)
   where q.id = o.id and q.room_id = p_room_id and q.status in ('pending', 'approved');
  -- Anything that arrived while the host was dragging goes to the back.
  update public.queue_items q
     set position = v_base + coalesce(array_length(p_item_ids, 1), 0) + s.rn
    from (
      select id, row_number() over (order by position, requested_at) as rn
      from public.queue_items
      where room_id = p_room_id and status in ('pending', 'approved') and id <> all (p_item_ids)
    ) s
   where q.id = s.id;
end $$;

-- ---------------------------------------------------------------------------
-- Playback (host only)
-- ---------------------------------------------------------------------------

-- p_expected_current makes "advance" idempotent: if the track already changed
-- (double 'ended' event, second host tab) the call is a no-op.
create function public.play_next(p_room_id uuid, p_expected_current uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms := public._require_host(p_room_id);
begin
  if p_expected_current is not null and v_room.current_item_id is distinct from p_expected_current then
    return;
  end if;
  perform public._set_current(v_room.id, public._next_item(v_room.id));
end $$;

create function public.play_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.queue_items;
  v_room public.rooms;
begin
  select * into v_item from public.queue_items where id = p_item_id;
  if not found then raise exception 'VR_NOT_FOUND'; end if;
  v_room := public._require_host(v_item.room_id);
  if v_item.status not in ('pending', 'approved', 'played', 'playing') then
    raise exception 'VR_NOT_ALLOWED';
  end if;
  perform public._set_current(v_room.id, v_item.id);
end $$;

-- Steps back to the most recently played record; the current one returns to
-- the front of the queue.
create function public.play_previous(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_room public.rooms := public._require_host(p_room_id);
  v_prev uuid;
begin
  select id into v_prev from public.queue_items
   where room_id = p_room_id and status = 'played'
   order by played_at desc limit 1;

  if v_prev is null then
    if v_room.current_item_id is not null then
      update public.rooms
         set playback_position = 0,
             playback_started_at = case when playback_status = 'playing' then clock_timestamp() end,
             updated_at = clock_timestamp()
       where id = p_room_id;
    end if;
    return;
  end if;

  if v_room.current_item_id is not null then
    update public.queue_items
       set status = 'approved',
           position = (select coalesce(min(position), 1) - 1 from public.queue_items
                       where room_id = p_room_id and status in ('pending', 'approved'))
     where id = v_room.current_item_id;
  end if;
  perform public._set_current(p_room_id, v_prev);
end $$;

-- Play, pause, seek and drift re-anchoring. Called on state changes only -
-- never on a per-second timer.
create function public.set_playback(p_room_id uuid, p_status text, p_position double precision)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms := public._require_host(p_room_id);
begin
  if p_status not in ('playing', 'paused') then raise exception 'VR_INVALID_INPUT'; end if;
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

-- The host's player reports a duration the search could not (e.g. pasted links).
create function public.set_track_duration(p_item_id uuid, p_duration_seconds integer)
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
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

create function public.toggle_reaction(p_item_id uuid, p_reaction_type text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item   public.queue_items;
  v_member public.room_members;
  v_active boolean;
begin
  if p_reaction_type not in ('love', 'fire', 'vibe', 'funny', 'clap') then
    raise exception 'VR_INVALID_INPUT';
  end if;
  select * into v_item from public.queue_items where id = p_item_id for update;
  if not found or v_item.status in ('rejected', 'removed') then raise exception 'VR_NOT_FOUND'; end if;
  v_member := public._require_member(v_item.room_id);
  perform public._rate_limit(v_member.id, 'reaction', 30, interval '20 seconds');

  delete from public.reactions
   where queue_item_id = p_item_id and member_id = v_member.id and reaction_type = p_reaction_type;
  if found then
    v_active := false;
  else
    insert into public.reactions (room_id, queue_item_id, member_id, reaction_type)
    values (v_item.room_id, p_item_id, v_member.id, p_reaction_type);
    v_active := true;
  end if;

  update public.queue_items
     set reaction_counts = (
       select coalesce(jsonb_object_agg(s.reaction_type, s.c), '{}'::jsonb)
       from (select reaction_type, count(*) as c from public.reactions
             where queue_item_id = p_item_id group by reaction_type) s
     )
   where id = p_item_id;

  return jsonb_build_object('active', v_active);
end $$;

-- ---------------------------------------------------------------------------
-- Row level security: read-only, scoped to the caller's rooms
-- ---------------------------------------------------------------------------

alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;
alter table public.tracks       enable row level security;
alter table public.queue_items  enable row level security;
alter table public.reactions    enable row level security;
alter table public.rate_limits  enable row level security;

create policy rooms_select_members on public.rooms
  for select to authenticated using (public.is_room_member(id));

-- Own row stays readable after removal so the client can learn it was removed.
create policy room_members_select on public.room_members
  for select to authenticated using (user_id = auth.uid() or public.is_room_member(room_id));

create policy queue_items_select_members on public.queue_items
  for select to authenticated using (public.is_room_member(room_id));

create policy reactions_select_members on public.reactions
  for select to authenticated using (public.is_room_member(room_id));

create policy tracks_select_in_my_rooms on public.tracks
  for select to authenticated using (
    exists (select 1 from public.queue_items q where q.track_id = tracks.id and public.is_room_member(q.room_id))
  );

-- rate_limits: RLS on, no policies -> invisible to clients.

revoke all on all tables in schema public from anon, authenticated;
grant select on public.rooms, public.room_members, public.tracks, public.queue_items, public.reactions
  to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_room_member(uuid),
  public.create_room(text, text, text, text, text),
  public.get_room_preview(text),
  public.join_room(text, text, text),
  public.leave_room(uuid),
  public.remove_member(uuid),
  public.update_room_settings(uuid, text, text, text, boolean, boolean),
  public.close_room(uuid),
  public.list_public_rooms(),
  public.get_room_state(uuid),
  public.request_track(uuid, text, text, text, text, text, text, integer),
  public.review_request(uuid, boolean),
  public.cancel_request(uuid),
  public.remove_queue_item(uuid),
  public.reorder_queue(uuid, uuid[]),
  public.play_next(uuid, uuid),
  public.play_item(uuid),
  public.play_previous(uuid),
  public.set_playback(uuid, text, double precision),
  public.set_track_duration(uuid, integer),
  public.toggle_reaction(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: rooms, members and queue changes are pushed to room members.
-- (Reactions ride on queue_items.reaction_counts; RLS filters every event.)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rooms, public.room_members, public.queue_items;
  end if;
end $$;
