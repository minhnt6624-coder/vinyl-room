-- ============================================================================
-- YouTube search quota guard.
--
-- The youtube-search Edge Function calls this as the visitor before it spends
-- any YouTube Data API quota. It does two jobs:
--   * proves the caller is a signed-in user (the anon role cannot execute it,
--     so a request carrying only the public key is turned away), and
--   * rate limits each user, because one search costs 100 of the project's
--     10,000 daily quota units.
-- It grants no access to any data.
-- ============================================================================

create function public.consume_search_quota(p_kind text default 'search')
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public._uid();
begin
  if p_kind = 'search' then
    perform public._rate_limit(v_uid, 'yt_search_minute', 6, interval '1 minute');
    perform public._rate_limit(v_uid, 'yt_search_day', 40, interval '1 day');
  elsif p_kind = 'lookup' then
    -- videos.list costs 1 unit, so pasted links get a looser limit.
    perform public._rate_limit(v_uid, 'yt_lookup_minute', 30, interval '1 minute');
  else
    raise exception 'VR_INVALID_INPUT';
  end if;
end $$;

revoke execute on function public.consume_search_quota(text) from public, anon;
grant execute on function public.consume_search_quota(text) to authenticated;
