-- Run this in Supabase SQL Editor

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text not null,
  avatar_url text,
  bio text,
  preferred_player text not null default 'spotify',
  spotify_access_token text,
  spotify_refresh_token text,
  spotify_expires_at bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists preferred_player text not null default 'spotify';
alter table public.profiles add column if not exists spotify_access_token text;
alter table public.profiles add column if not exists spotify_refresh_token text;
alter table public.profiles add column if not exists spotify_expires_at bigint;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

alter table public.profiles
  alter column username set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_length_chk'
  ) then
    alter table public.profiles
      add constraint profiles_username_length_chk
      check (char_length(trim(username)) between 3 and 40);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_bio_length_chk'
  ) then
    alter table public.profiles
      add constraint profiles_bio_length_chk
      check (bio is null or char_length(bio) <= 180);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_preferred_player_chk'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_player_chk
      check (preferred_player in ('spotify', 'deezer', 'youtube_music'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_spotify_expires_at_chk'
  ) then
    alter table public.profiles
      add constraint profiles_spotify_expires_at_chk
      check (spotify_expires_at is null or spotify_expires_at > 0);
  end if;
end $$;

-- Daily login/play streaks
create table if not exists public.user_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  last_played_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_streaks_current_streak
on public.user_streaks(current_streak desc, updated_at desc);

alter table public.user_streaks enable row level security;

drop policy if exists "user_streaks_select_own" on public.user_streaks;
create policy "user_streaks_select_own"
on public.user_streaks
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_streaks_insert_own" on public.user_streaks;
create policy "user_streaks_insert_own"
on public.user_streaks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_streaks_update_own" on public.user_streaks;
-- No direct client update; streak is controlled via RPC.

create or replace function public.set_user_streaks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_streaks_updated_at on public.user_streaks;
create trigger trg_user_streaks_updated_at
before update on public.user_streaks
for each row
execute function public.set_user_streaks_updated_at();

create or replace function public.get_my_streak()
returns table (
  current_streak integer,
  best_streak integer,
  last_played_date date
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(s.current_streak, 0)::int as current_streak,
    coalesce(s.best_streak, 0)::int as best_streak,
    s.last_played_date
  from public.user_streaks s
  where s.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.update_my_streak_after_game(
  p_game_date date default current_date
)
returns table (
  current_streak integer,
  best_streak integer,
  last_played_date date,
  streak_updated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := coalesce(p_game_date, current_date);
  v_row public.user_streaks%rowtype;
  v_updated boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_streaks (user_id, current_streak, best_streak, last_played_date)
  values (v_uid, 0, 0, null)
  on conflict (user_id) do nothing;

  select *
    into v_row
  from public.user_streaks s
  where s.user_id = v_uid
  for update;

  if v_row.last_played_date is null then
    v_row.current_streak := 1;
    v_row.best_streak := greatest(coalesce(v_row.best_streak, 0), 1);
    v_row.last_played_date := v_today;
    v_updated := true;
  elsif v_row.last_played_date = v_today then
    v_updated := false;
  elsif v_row.last_played_date = (v_today - 1) then
    v_row.current_streak := greatest(0, coalesce(v_row.current_streak, 0)) + 1;
    v_row.best_streak := greatest(coalesce(v_row.best_streak, 0), v_row.current_streak);
    v_row.last_played_date := v_today;
    v_updated := true;
  elsif v_row.last_played_date < v_today then
    v_row.current_streak := 1;
    v_row.best_streak := greatest(coalesce(v_row.best_streak, 0), 1);
    v_row.last_played_date := v_today;
    v_updated := true;
  else
    v_updated := false;
  end if;

  if v_updated then
    update public.user_streaks
      set current_streak = greatest(0, coalesce(v_row.current_streak, 0)),
          best_streak = greatest(coalesce(v_row.best_streak, 0), greatest(0, coalesce(v_row.current_streak, 0))),
          last_played_date = v_row.last_played_date
    where user_id = v_uid;
  end if;

  select s.current_streak, s.best_streak, s.last_played_date
    into current_streak, best_streak, last_played_date
  from public.user_streaks s
  where s.user_id = v_uid
  limit 1;
  streak_updated := v_updated;
  return next;
end;
$$;

revoke all on function public.get_my_streak() from public;
grant execute on function public.get_my_streak() to authenticated;
revoke all on function public.update_my_streak_after_game(date) from public;
grant execute on function public.update_my_streak_after_game(date) to authenticated;

-- Public profile, leaderboard and daily challenge layer
alter table public.profiles add column if not exists is_public boolean not null default true;
alter table public.profiles add column if not exists public_slug text;

create unique index if not exists idx_profiles_public_slug_unique
on public.profiles (lower(public_slug))
where public_slug is not null;

create or replace function public.set_profile_public_slug()
returns trigger
language plpgsql
as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 0;
begin
  if new.is_public is null then
    new.is_public := true;
  end if;

  if tg_op = 'INSERT'
     or new.public_slug is null
     or trim(coalesce(new.public_slug, '')) = '' then
    v_base := lower(trim(coalesce(new.public_slug, new.username, 'player')));
    v_base := regexp_replace(v_base, '[^a-z0-9_-]+', '-', 'g');
    v_base := trim(both '-' from v_base);
    if v_base = '' then
      v_base := 'player';
    end if;
    v_candidate := v_base;
    while exists (
      select 1
      from public.profiles p
      where lower(p.public_slug) = lower(v_candidate)
        and (new.id is null or p.id <> new.id)
    ) loop
      v_n := v_n + 1;
      v_candidate := format('%s-%s', v_base, substr(md5(coalesce(new.id::text, '') || clock_timestamp()::text || v_n::text), 1, 4));
    end loop;
    new.public_slug := v_candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_public_slug on public.profiles;
create trigger trg_profiles_public_slug
before insert or update of username, public_slug on public.profiles
for each row
execute function public.set_profile_public_slug();

update public.profiles
set public_slug = null
where public_slug is null or trim(coalesce(public_slug, '')) = '';

create table if not exists public.daily_challenges (
  challenge_date date primary key,
  challenge_title text not null,
  challenge_desc text not null,
  metric text not null check (metric in ('games', 'avg_accuracy', 'best_wpm', 'xp_earned')),
  target_value integer not null check (target_value > 0),
  reward_xp integer not null check (reward_xp >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.user_daily_challenge_claims (
  challenge_date date not null references public.daily_challenges(challenge_date) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bonus_xp integer not null default 0 check (bonus_xp >= 0),
  claimed_at timestamptz not null default now(),
  primary key (challenge_date, user_id)
);

alter table public.user_daily_challenge_claims enable row level security;

drop policy if exists "daily_claims_select_own" on public.user_daily_challenge_claims;
create policy "daily_claims_select_own"
on public.user_daily_challenge_claims
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "daily_claims_insert_own" on public.user_daily_challenge_claims;
create policy "daily_claims_insert_own"
on public.user_daily_challenge_claims
for insert
to authenticated
with check (auth.uid() = user_id);

create or replace function public.ensure_today_daily_challenge()
returns public.daily_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_mod integer := extract(doy from current_date)::integer % 3;
  v_row public.daily_challenges%rowtype;
begin
  select *
    into v_row
  from public.daily_challenges dc
  where dc.challenge_date = v_today
  limit 1;

  if found then
    return v_row;
  end if;

  if v_mod = 0 then
    insert into public.daily_challenges (challenge_date, challenge_title, challenge_desc, metric, target_value, reward_xp)
    values (v_today, 'Focused Session', 'Complete 3 runs today.', 'games', 3, 120)
    on conflict (challenge_date) do nothing;
  elsif v_mod = 1 then
    insert into public.daily_challenges (challenge_date, challenge_title, challenge_desc, metric, target_value, reward_xp)
    values (v_today, 'Precision Day', 'Reach average accuracy of 92% today.', 'avg_accuracy', 92, 140)
    on conflict (challenge_date) do nothing;
  else
    insert into public.daily_challenges (challenge_date, challenge_title, challenge_desc, metric, target_value, reward_xp)
    values (v_today, 'Speed Burst', 'Hit at least 70 WPM in a run today.', 'best_wpm', 70, 150)
    on conflict (challenge_date) do nothing;
  end if;

  select *
    into v_row
  from public.daily_challenges dc
  where dc.challenge_date = v_today
  limit 1;
  return v_row;
end;
$$;

create or replace function public.get_daily_challenge_status()
returns table (
  challenge_date date,
  challenge_title text,
  challenge_desc text,
  metric text,
  target_value integer,
  reward_xp integer,
  progress_value integer,
  progress_pct integer,
  can_claim boolean,
  claimed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ch public.daily_challenges%rowtype;
  v_progress integer := 0;
  v_claimed boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_ch := public.ensure_today_daily_challenge();

  if v_ch.metric = 'games' then
    select count(*)::int into v_progress
    from public.game_results gr
    where gr.user_id = v_uid
      and gr.created_at::date = v_ch.challenge_date;
  elsif v_ch.metric = 'avg_accuracy' then
    select coalesce(round(avg(gr.accuracy)), 0)::int into v_progress
    from public.game_results gr
    where gr.user_id = v_uid
      and gr.created_at::date = v_ch.challenge_date;
  elsif v_ch.metric = 'best_wpm' then
    select coalesce(max(gr.wpm), 0)::int into v_progress
    from public.game_results gr
    where gr.user_id = v_uid
      and gr.created_at::date = v_ch.challenge_date;
  else
    select coalesce(sum(gr.xp_awarded), 0)::int into v_progress
    from public.game_results gr
    where gr.user_id = v_uid
      and gr.created_at::date = v_ch.challenge_date;
  end if;

  select exists(
    select 1
    from public.user_daily_challenge_claims c
    where c.user_id = v_uid
      and c.challenge_date = v_ch.challenge_date
  ) into v_claimed;

  challenge_date := v_ch.challenge_date;
  challenge_title := v_ch.challenge_title;
  challenge_desc := v_ch.challenge_desc;
  metric := v_ch.metric;
  target_value := v_ch.target_value;
  reward_xp := v_ch.reward_xp;
  progress_value := greatest(0, v_progress);
  progress_pct := least(100, floor((greatest(0, v_progress)::numeric / greatest(1, v_ch.target_value)::numeric) * 100))::int;
  can_claim := (v_progress >= v_ch.target_value) and not v_claimed;
  claimed := v_claimed;
  return next;
end;
$$;

create or replace function public.claim_daily_challenge_reward()
returns table (
  bonus_xp_awarded integer,
  level integer,
  prestige integer,
  xp_in_level integer,
  total_xp bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status record;
  v_reward integer := 0;
  v_level integer;
  v_prestige integer;
  v_xp_in_level integer;
  v_total_xp bigint;
  v_need integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_status
  from public.get_daily_challenge_status()
  limit 1;

  if v_status.claimed or not v_status.can_claim then
    bonus_xp_awarded := 0;
    select up.level, up.prestige_level, up.xp_in_level, up.total_xp
      into level, prestige, xp_in_level, total_xp
    from public.user_progress up
    where up.user_id = v_uid;
    return next;
    return;
  end if;

  v_reward := greatest(0, coalesce(v_status.reward_xp, 0));

  insert into public.user_daily_challenge_claims (challenge_date, user_id, bonus_xp)
  values (v_status.challenge_date, v_uid, v_reward)
  on conflict (challenge_date, user_id) do nothing;

  if not found then
    bonus_xp_awarded := 0;
    select up.level, up.prestige_level, up.xp_in_level, up.total_xp
      into level, prestige, xp_in_level, total_xp
    from public.user_progress up
    where up.user_id = v_uid;
    return next;
    return;
  end if;

  insert into public.user_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select up.level, up.prestige_level, up.xp_in_level, up.total_xp
    into v_level, v_prestige, v_xp_in_level, v_total_xp
  from public.user_progress up
  where up.user_id = v_uid
  for update;

  v_total_xp := coalesce(v_total_xp, 0) + v_reward;
  v_xp_in_level := coalesce(v_xp_in_level, 0) + v_reward;

  loop
    v_need := public.xp_required_for_level(v_level);
    exit when v_xp_in_level < v_need;
    v_xp_in_level := v_xp_in_level - v_need;
    if v_level >= 50 then
      if v_prestige < 10 then
        v_prestige := v_prestige + 1;
        v_level := 1;
        v_xp_in_level := 0;
        exit;
      else
        v_level := 50;
        v_xp_in_level := least(v_xp_in_level, v_need);
        exit;
      end if;
    else
      v_level := v_level + 1;
    end if;
  end loop;

  update public.user_progress
    set level = v_level,
        prestige_level = v_prestige,
        xp_in_level = v_xp_in_level,
        total_xp = v_total_xp
  where user_id = v_uid;

  bonus_xp_awarded := v_reward;
  level := v_level;
  prestige := v_prestige;
  xp_in_level := v_xp_in_level;
  total_xp := v_total_xp;
  return next;
end;
$$;

create or replace function public.get_leaderboard(
  p_period text default 'weekly',
  p_limit integer default 50
)
returns table (
  user_id uuid,
  username text,
  avatar_url text,
  games integer,
  best_wpm integer,
  avg_wpm integer,
  avg_acc integer,
  xp_earned integer
)
language sql
security definer
set search_path = public
as $$
  with cfg as (
    select case
      when lower(coalesce(p_period, 'weekly')) = 'monthly' then now() - interval '30 days'
      else now() - interval '7 days'
    end as from_ts
  )
  select
    gr.user_id,
    coalesce(p.username, 'unknown') as username,
    p.avatar_url,
    count(*)::int as games,
    coalesce(max(gr.wpm), 0)::int as best_wpm,
    coalesce(round(avg(gr.wpm)), 0)::int as avg_wpm,
    coalesce(round(avg(gr.accuracy)), 0)::int as avg_acc,
    coalesce(sum(gr.xp_awarded), 0)::int as xp_earned
  from public.game_results gr
  join cfg on gr.created_at >= cfg.from_ts
  left join public.profiles p on p.id = gr.user_id
  group by gr.user_id, p.username, p.avatar_url
  order by xp_earned desc, avg_wpm desc, best_wpm desc, games desc, username asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.get_public_profile_by_slug(p_slug text)
returns table (
  user_id uuid,
  username text,
  avatar_url text,
  bio text,
  public_slug text,
  games integer,
  best_wpm integer,
  avg_wpm integer,
  avg_acc integer,
  top_songs jsonb
)
language sql
security definer
set search_path = public
as $$
  with prof as (
    select p.id, p.username, p.avatar_url, p.bio, p.public_slug
    from public.profiles p
    where p.is_public = true
      and lower(coalesce(p.public_slug, '')) = lower(trim(coalesce(p_slug, '')))
    limit 1
  ),
  stat as (
    select
      gr.user_id,
      count(gr.id)::int as games,
      coalesce(max(gr.wpm), 0)::int as best_wpm,
      coalesce(round(avg(gr.wpm)), 0)::int as avg_wpm,
      coalesce(round(avg(gr.accuracy)), 0)::int as avg_acc
    from public.game_results gr
    join prof p on p.id = gr.user_id
    group by gr.user_id
  ),
  songs as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'song', s.song_title,
            'artist', s.artist,
            'count', s.runs,
            'avgWpm', s.avg_wpm
          )
          order by s.runs desc, s.song_title asc
        ),
        '[]'::jsonb
      ) as rows
    from (
      select
        nullif(trim(coalesce(gr.song_title, '')), '') as song_title,
        nullif(trim(coalesce(gr.artist, '')), '') as artist,
        count(*)::int as runs,
        coalesce(round(avg(gr.wpm)), 0)::int as avg_wpm
      from public.game_results gr
      join prof p on p.id = gr.user_id
      where nullif(trim(coalesce(gr.song_title, '')), '') is not null
      group by song_title, artist
      order by runs desc, song_title asc
      limit 10
    ) s
  )
  select
    p.id as user_id,
    coalesce(p.username, 'unknown') as username,
    p.avatar_url,
    p.bio,
    p.public_slug,
    coalesce(s.games, 0)::int as games,
    coalesce(s.best_wpm, 0)::int as best_wpm,
    coalesce(s.avg_wpm, 0)::int as avg_wpm,
    coalesce(s.avg_acc, 0)::int as avg_acc,
    coalesce(so.rows, '[]'::jsonb) as top_songs
  from prof p
  left join stat s on s.user_id = p.id
  left join songs so on true
  limit 1;
$$;

create or replace function public.get_my_public_profile_link()
returns table (
  public_slug text,
  profile_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles
  set public_slug = null
  where id = v_uid
    and (public_slug is null or trim(coalesce(public_slug, '')) = '');

  select p.public_slug into v_slug
  from public.profiles p
  where p.id = v_uid
  limit 1;

  public_slug := v_slug;
  profile_url := case when v_slug is null then null else ('?profile=' || v_slug) end;
  return next;
end;
$$;

revoke all on function public.ensure_today_daily_challenge() from public;
grant execute on function public.ensure_today_daily_challenge() to authenticated;
revoke all on function public.get_daily_challenge_status() from public;
grant execute on function public.get_daily_challenge_status() to authenticated;
revoke all on function public.claim_daily_challenge_reward() from public;
grant execute on function public.claim_daily_challenge_reward() to authenticated;
revoke all on function public.get_leaderboard(text, integer) from public;
grant execute on function public.get_leaderboard(text, integer) to anon, authenticated;
revoke all on function public.get_public_profile_by_slug(text) from public;
grant execute on function public.get_public_profile_by_slug(text) to anon, authenticated;
revoke all on function public.get_my_public_profile_link() from public;
grant execute on function public.get_my_public_profile_link() to authenticated;

-- OAuth tokens should not live in public profile rows.
create table if not exists public.user_oauth_tokens (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'spotify' check (provider in ('spotify')),
  access_token text,
  refresh_token text,
  expires_at bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

create index if not exists idx_user_oauth_tokens_user_provider
on public.user_oauth_tokens(user_id, provider);

alter table public.user_oauth_tokens enable row level security;

create or replace function public.set_user_oauth_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_oauth_tokens_updated_at on public.user_oauth_tokens;
create trigger trg_user_oauth_tokens_updated_at
before update on public.user_oauth_tokens
for each row
execute function public.set_user_oauth_tokens_updated_at();

-- Backfill existing profile token data (legacy) into private token store.
insert into public.user_oauth_tokens (user_id, provider, access_token, refresh_token, expires_at)
select p.id, 'spotify', p.spotify_access_token, p.spotify_refresh_token, p.spotify_expires_at
from public.profiles p
where p.spotify_access_token is not null
   or p.spotify_refresh_token is not null
   or p.spotify_expires_at is not null
on conflict (user_id, provider) do update
  set access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = now();

revoke all on table public.user_oauth_tokens from anon, authenticated;

create or replace function public.upsert_my_spotify_tokens(
  p_access_token text,
  p_refresh_token text,
  p_expires_at bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_oauth_tokens (user_id, provider, access_token, refresh_token, expires_at)
  values (
    auth.uid(),
    'spotify',
    nullif(trim(coalesce(p_access_token, '')), ''),
    nullif(trim(coalesce(p_refresh_token, '')), ''),
    p_expires_at
  )
  on conflict (user_id, provider) do update
    set access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        updated_at = now();
end;
$$;

create or replace function public.clear_my_spotify_tokens()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.user_oauth_tokens
  where user_id = auth.uid() and provider = 'spotify';
end;
$$;

create or replace function public.get_my_spotify_token_status()
returns table (
  is_linked boolean,
  expires_at bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (t.refresh_token is not null) as is_linked,
    t.expires_at
  from public.user_oauth_tokens t
  where t.user_id = auth.uid()
    and t.provider = 'spotify'
  limit 1;
$$;

revoke all on function public.upsert_my_spotify_tokens(text, text, bigint) from public;
grant execute on function public.upsert_my_spotify_tokens(text, text, bigint) to authenticated;
revoke all on function public.clear_my_spotify_tokens() from public;
grant execute on function public.clear_my_spotify_tokens() to authenticated;
revoke all on function public.get_my_spotify_token_status() from public;
grant execute on function public.get_my_spotify_token_status() to authenticated;

create table if not exists public.game_results (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  song_title text,
  artist text,
  mode text not null default 'normal' check (mode in ('normal', 'cloze', 'rhythm')),
  wpm integer not null default 0,
  accuracy integer not null default 0,
  words_correct integer not null default 0,
  words_wrong integer not null default 0,
  total_chars integer not null default 0,
  incorrect_chars integer not null default 0,
  extra_chars integer not null default 0,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.game_results add column if not exists xp_base integer not null default 0;
alter table public.game_results add column if not exists xp_penalty integer not null default 0;
alter table public.game_results add column if not exists xp_awarded integer not null default 0;
alter table public.game_results add column if not exists xp_recoverable_words integer not null default 0;
alter table public.game_results add column if not exists xp_recovered_words integer not null default 0;
alter table public.game_results add column if not exists length_mode text not null default 'full';
alter table public.game_results add column if not exists progress_level integer;
alter table public.game_results add column if not exists progress_prestige integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'game_results_xp_non_negative_chk'
  ) then
    alter table public.game_results
      add constraint game_results_xp_non_negative_chk
      check (
        xp_base >= 0 and
        xp_penalty >= 0 and
        xp_awarded >= 0 and
        xp_recoverable_words >= 0 and
        xp_recovered_words >= 0
      );
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'game_results_length_mode_chk'
  ) then
    alter table public.game_results
      drop constraint game_results_length_mode_chk;
  end if;

  alter table public.game_results
    add constraint game_results_length_mode_chk
    check (length_mode in ('quick', 'rapid', 'macro', 'short', 'full'));
end $$;

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level integer not null default 1 check (level between 1 and 50),
  prestige_level integer not null default 0 check (prestige_level between 0 and 10),
  xp_in_level integer not null default 0 check (xp_in_level >= 0),
  total_xp bigint not null default 0 check (total_xp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_progress enable row level security;

drop policy if exists "user_progress_select_own" on public.user_progress;
create policy "user_progress_select_own"
on public.user_progress
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_progress_insert_own" on public.user_progress;
create policy "user_progress_insert_own"
on public.user_progress
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_progress_update_own" on public.user_progress;
-- No direct user update; progress must be changed only via RPC.

create table if not exists public.user_badges (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_key text not null,
  badge_name text not null,
  awarded_at timestamptz not null default now(),
  unique(user_id, badge_key)
);

create index if not exists idx_user_badges_user_id on public.user_badges(user_id, awarded_at desc);

alter table public.user_badges enable row level security;

drop policy if exists "user_badges_select_own" on public.user_badges;
create policy "user_badges_select_own"
on public.user_badges
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_user_progress_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_progress_updated_at on public.user_progress;
create trigger trg_user_progress_updated_at
before update on public.user_progress
for each row
execute function public.set_user_progress_updated_at();

create or replace function public.xp_required_for_level(p_level integer)
returns integer
language plpgsql
immutable
as $$
declare
  lvl integer := greatest(1, least(50, coalesce(p_level, 1)));
begin
  if lvl <= 30 then
    return 220 + ((lvl - 1) * 30);
  end if;
  return 1090;
end;
$$;

drop function if exists public.apply_game_progress(text, text, text, integer, integer, integer, integer, integer, integer, integer, integer);
create or replace function public.apply_game_progress(
  p_song_title text,
  p_artist text,
  p_mode text,
  p_wpm integer,
  p_accuracy integer,
  p_words_correct integer,
  p_words_wrong integer,
  p_total_chars integer,
  p_incorrect_chars integer,
  p_extra_chars integer,
  p_duration_seconds integer,
  p_length_mode text default 'full'
)
returns table (
  game_result_id bigint,
  xp_base integer,
  xp_penalty integer,
  xp_awarded integer,
  xp_recoverable_words integer,
  xp_recovered_words integer,
  level integer,
  prestige integer,
  xp_in_level integer,
  xp_to_next integer,
  total_xp bigint,
  did_prestige boolean,
  badge_keys text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := case when lower(coalesce(p_mode, 'normal')) in ('normal', 'cloze', 'rhythm') then lower(coalesce(p_mode, 'normal')) else 'normal' end;
  v_mode_mult numeric := case when v_mode = 'rhythm' then 1.35 when v_mode = 'cloze' then 1.15 else 1.0 end;
  v_words_total integer := greatest(0, coalesce(p_words_correct, 0)) + greatest(0, coalesce(p_words_wrong, 0));
  v_length_mode text := case
    when lower(trim(coalesce(p_length_mode, ''))) in ('quick') then 'quick'
    when lower(trim(coalesce(p_length_mode, ''))) in ('full') then 'full'
    when lower(trim(coalesce(p_length_mode, ''))) in ('short') then 'short'
    when lower(trim(coalesce(p_length_mode, ''))) in ('macro') then 'macro'
    when lower(trim(coalesce(p_length_mode, ''))) in ('micro', 'rapid', 'rapido', 'fast') then 'rapid'
    else case
      when v_words_total >= 130 then 'full'
      when v_words_total >= 95 then 'short'
      when v_words_total >= 65 then 'macro'
      else 'rapid'
    end
  end;
  v_length_mult numeric := case
    when v_length_mode = 'quick' then 0.46
    when v_length_mode = 'rapid' then 0.58
    when v_length_mode = 'macro' then 0.74
    when v_length_mode = 'short' then 0.88
    else 1.0
  end;
  v_length_word_cap integer := case
    when v_length_mode = 'quick' then 30
    when v_length_mode = 'rapid' then 45
    when v_length_mode = 'macro' then 70
    when v_length_mode = 'short' then 100
    else 130
  end;
  v_length_words_ratio numeric := least(
    1.0,
    v_words_total::numeric / greatest(1, v_length_word_cap)::numeric
  );
  v_wpm integer := least(320, greatest(0, coalesce(p_wpm, 0)));
  v_accuracy integer := greatest(0, least(100, coalesce(p_accuracy, 0)));
  v_words_correct integer := greatest(0, coalesce(p_words_correct, 0));
  v_words_wrong integer := greatest(0, coalesce(p_words_wrong, 0));
  v_total_chars integer := greatest(0, coalesce(p_total_chars, 0));
  v_incorrect_chars integer := greatest(0, coalesce(p_incorrect_chars, 0));
  v_extra_chars integer := greatest(0, coalesce(p_extra_chars, 0));
  v_duration_seconds integer := least(7200, greatest(0, coalesce(p_duration_seconds, 0)));
  v_level integer;
  v_prestige integer;
  v_xp_in_level integer;
  v_total_xp bigint;
  v_need integer;
  v_badges text[] := '{}';
  v_did_prestige boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  xp_base := greatest(
    10,
    round((35 + (least(v_wpm, 130) * 0.55) + (v_accuracy * 0.45)) * v_mode_mult * v_length_mult * v_length_words_ratio)
  );
  xp_penalty := least(greatest(0, xp_base - 5), v_words_wrong * 4);
  xp_awarded := greatest(5, xp_base - xp_penalty);
  xp_recoverable_words := v_words_wrong;
  xp_recovered_words := 0;

  insert into public.user_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select up.level, up.prestige_level, up.xp_in_level, up.total_xp
    into v_level, v_prestige, v_xp_in_level, v_total_xp
  from public.user_progress up
  where up.user_id = v_uid
  for update;

  v_total_xp := coalesce(v_total_xp, 0) + xp_awarded;
  v_xp_in_level := coalesce(v_xp_in_level, 0) + xp_awarded;

  loop
    v_need := public.xp_required_for_level(v_level);
    exit when v_xp_in_level < v_need;
    v_xp_in_level := v_xp_in_level - v_need;
    if v_level >= 50 then
      if v_prestige < 10 then
        v_prestige := v_prestige + 1;
        v_level := 1;
        v_xp_in_level := 0;
        v_did_prestige := true;
        v_badges := array_append(v_badges, format('prestige_%s', v_prestige));
        insert into public.user_badges (user_id, badge_key, badge_name)
        values (v_uid, format('prestige_%s', v_prestige), format('Prestige %s', v_prestige))
        on conflict (user_id, badge_key) do nothing;
        exit;
      else
        v_level := 50;
        v_xp_in_level := least(v_xp_in_level, v_need);
        exit;
      end if;
    else
      v_level := v_level + 1;
    end if;
  end loop;

  update public.user_progress
    set level = v_level,
        prestige_level = v_prestige,
        xp_in_level = v_xp_in_level,
        total_xp = v_total_xp
  where user_id = v_uid;

  insert into public.game_results (
    user_id, song_title, artist, mode, length_mode, wpm, accuracy,
    words_correct, words_wrong, total_chars, incorrect_chars, extra_chars, duration_seconds,
    xp_base, xp_penalty, xp_awarded, xp_recoverable_words, xp_recovered_words,
    progress_level, progress_prestige
  )
  values (
    v_uid, nullif(trim(coalesce(p_song_title, '')), ''), nullif(trim(coalesce(p_artist, '')), ''), v_mode, v_length_mode,
    v_wpm, v_accuracy, v_words_correct, v_words_wrong, v_total_chars, v_incorrect_chars, v_extra_chars, v_duration_seconds,
    xp_base, xp_penalty, xp_awarded, xp_recoverable_words, 0,
    v_level, v_prestige
  )
  returning id into game_result_id;

  level := v_level;
  prestige := v_prestige;
  xp_in_level := v_xp_in_level;
  xp_to_next := greatest(0, public.xp_required_for_level(v_level) - v_xp_in_level);
  total_xp := v_total_xp;
  did_prestige := v_did_prestige;
  badge_keys := coalesce(v_badges, '{}');
  return next;
end;
$$;

revoke all on function public.apply_game_progress(text, text, text, integer, integer, integer, integer, integer, integer, integer, integer, text) from public;
grant execute on function public.apply_game_progress(text, text, text, integer, integer, integer, integer, integer, integer, integer, integer, text) to authenticated;

create or replace function public.apply_game_xp_recovery(
  p_game_result_id bigint,
  p_words_recovered integer default 1
)
returns table (
  applied_words integer,
  applied_xp integer,
  remaining_words integer,
  round_xp_awarded integer,
  level integer,
  prestige integer,
  xp_in_level integer,
  xp_to_next integer,
  total_xp bigint,
  did_prestige boolean,
  badge_keys text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_words integer := greatest(0, coalesce(p_words_recovered, 0));
  v_row public.game_results%rowtype;
  v_total_recoverable integer := 0;
  v_total_recovered integer := 0;
  v_level integer;
  v_prestige integer;
  v_xp_in_level integer;
  v_total_xp bigint;
  v_need integer;
  v_did_prestige boolean := false;
  v_badges text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if v_words <= 0 then
    return;
  end if;

  select *
    into v_row
  from public.game_results
  where id = p_game_result_id
    and user_id = v_uid
  for update;

  if not found then
    raise exception 'game result not found';
  end if;

  applied_words := least(
    v_words,
    greatest(0, coalesce(v_row.xp_recoverable_words, 0) - coalesce(v_row.xp_recovered_words, 0))
  );

  if applied_words <= 0 then
    applied_xp := 0;
    remaining_words := greatest(0, coalesce(v_row.xp_recoverable_words, 0) - coalesce(v_row.xp_recovered_words, 0));
    round_xp_awarded := coalesce(v_row.xp_awarded, 0);
    select up.level, up.prestige_level, up.xp_in_level, up.total_xp
      into level, prestige, xp_in_level, total_xp
    from public.user_progress up
    where up.user_id = v_uid;
    xp_to_next := greatest(0, public.xp_required_for_level(level) - xp_in_level);
    did_prestige := false;
    badge_keys := '{}';
    return next;
    return;
  end if;

  applied_xp := applied_words * 2;

  update public.game_results
    set xp_recovered_words = coalesce(xp_recovered_words, 0) + applied_words,
        xp_awarded = coalesce(xp_awarded, 0) + applied_xp
  where id = v_row.id;

  insert into public.user_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select up.level, up.prestige_level, up.xp_in_level, up.total_xp
    into v_level, v_prestige, v_xp_in_level, v_total_xp
  from public.user_progress up
  where up.user_id = v_uid
  for update;

  v_total_xp := coalesce(v_total_xp, 0) + applied_xp;
  v_xp_in_level := coalesce(v_xp_in_level, 0) + applied_xp;

  loop
    v_need := public.xp_required_for_level(v_level);
    exit when v_xp_in_level < v_need;
    v_xp_in_level := v_xp_in_level - v_need;
    if v_level >= 50 then
      if v_prestige < 10 then
        v_prestige := v_prestige + 1;
        v_level := 1;
        v_xp_in_level := 0;
        v_did_prestige := true;
        v_badges := array_append(v_badges, format('prestige_%s', v_prestige));
        insert into public.user_badges (user_id, badge_key, badge_name)
        values (v_uid, format('prestige_%s', v_prestige), format('Prestige %s', v_prestige))
        on conflict (user_id, badge_key) do nothing;
        exit;
      else
        v_level := 50;
        v_xp_in_level := least(v_xp_in_level, v_need);
        exit;
      end if;
    else
      v_level := v_level + 1;
    end if;
  end loop;

  update public.user_progress
    set level = v_level,
        prestige_level = v_prestige,
        xp_in_level = v_xp_in_level,
        total_xp = v_total_xp
  where user_id = v_uid;

  select xp_awarded, xp_recoverable_words, xp_recovered_words
    into round_xp_awarded, v_total_recoverable, v_total_recovered
  from public.game_results
  where id = v_row.id;

  remaining_words := greatest(0, coalesce(v_total_recoverable, 0) - coalesce(v_total_recovered, 0));
  level := v_level;
  prestige := v_prestige;
  xp_in_level := v_xp_in_level;
  xp_to_next := greatest(0, public.xp_required_for_level(v_level) - v_xp_in_level);
  total_xp := v_total_xp;
  did_prestige := v_did_prestige;
  badge_keys := coalesce(v_badges, '{}');
  return next;
end;
$$;

revoke all on function public.apply_game_xp_recovery(bigint, integer) from public;
grant execute on function public.apply_game_xp_recovery(bigint, integer) to authenticated;

-- Backend game sessions (start/finish flow)
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_session_key text,
  song_title text,
  artist text,
  mode text not null default 'normal' check (mode in ('normal', 'cloze', 'rhythm')),
  length_mode text not null default 'full' check (length_mode in ('quick', 'rapid', 'macro', 'short', 'full')),
  status text not null default 'started' check (status in ('started', 'finished', 'abandoned')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  wpm integer not null default 0 check (wpm >= 0),
  accuracy integer not null default 0 check (accuracy between 0 and 100),
  words_total integer not null default 0 check (words_total >= 0),
  words_correct integer not null default 0 check (words_correct >= 0),
  words_wrong integer not null default 0 check (words_wrong >= 0),
  game_result_id bigint references public.game_results(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, client_session_key)
);

create index if not exists idx_game_sessions_user_created_at
on public.game_sessions(user_id, created_at desc);

create index if not exists idx_game_sessions_user_status
on public.game_sessions(user_id, status, started_at desc);

alter table public.game_sessions enable row level security;

drop policy if exists "game_sessions_select_own" on public.game_sessions;
create policy "game_sessions_select_own"
on public.game_sessions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "game_sessions_insert_own" on public.game_sessions;
-- No direct insert; sessions are created by RPC.

drop policy if exists "game_sessions_update_own" on public.game_sessions;
-- No direct update; sessions are finalized by RPC.

create or replace function public.set_game_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_game_sessions_updated_at on public.game_sessions;
create trigger trg_game_sessions_updated_at
before update on public.game_sessions
for each row
execute function public.set_game_sessions_updated_at();

drop function if exists public.start_game_session(text, text, text, text, text);
create or replace function public.start_game_session(
  p_song_title text,
  p_artist text,
  p_mode text default 'normal',
  p_length_mode text default 'full',
  p_client_session_key text default null
)
returns table (
  session_id uuid,
  status text,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := case when lower(coalesce(p_mode, 'normal')) in ('normal', 'cloze', 'rhythm') then lower(coalesce(p_mode, 'normal')) else 'normal' end;
  v_length_mode text := case
    when lower(trim(coalesce(p_length_mode, ''))) in ('quick') then 'quick'
    when lower(trim(coalesce(p_length_mode, ''))) in ('full') then 'full'
    when lower(trim(coalesce(p_length_mode, ''))) in ('short') then 'short'
    when lower(trim(coalesce(p_length_mode, ''))) in ('macro') then 'macro'
    when lower(trim(coalesce(p_length_mode, ''))) in ('micro', 'rapid', 'rapido', 'fast') then 'rapid'
    else 'full'
  end;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.game_sessions (
    user_id,
    client_session_key,
    song_title,
    artist,
    mode,
    length_mode,
    status,
    started_at
  )
  values (
    v_uid,
    nullif(trim(coalesce(p_client_session_key, '')), ''),
    nullif(trim(coalesce(p_song_title, '')), ''),
    nullif(trim(coalesce(p_artist, '')), ''),
    v_mode,
    v_length_mode,
    'started',
    now()
  )
  on conflict (user_id, client_session_key) do update
    set song_title = coalesce(excluded.song_title, public.game_sessions.song_title),
        artist = coalesce(excluded.artist, public.game_sessions.artist),
        mode = excluded.mode,
        length_mode = excluded.length_mode,
        status = case when public.game_sessions.status = 'finished' then public.game_sessions.status else 'started' end
  returning id, public.game_sessions.status, public.game_sessions.started_at
  into session_id, status, started_at;

  return next;
end;
$$;

revoke all on function public.start_game_session(text, text, text, text, text) from public;
grant execute on function public.start_game_session(text, text, text, text, text) to authenticated;

drop function if exists public.finish_game_session(uuid, text, text, text, text, text, integer, integer, integer, integer, integer, integer, integer, integer);
create or replace function public.finish_game_session(
  p_session_id uuid default null,
  p_client_session_key text default null,
  p_song_title text default null,
  p_artist text default null,
  p_mode text default 'normal',
  p_length_mode text default 'full',
  p_wpm integer default 0,
  p_accuracy integer default 0,
  p_words_correct integer default 0,
  p_words_wrong integer default 0,
  p_total_chars integer default 0,
  p_incorrect_chars integer default 0,
  p_extra_chars integer default 0,
  p_duration_seconds integer default 0
)
returns table (
  session_id uuid,
  game_result_id bigint,
  xp_base integer,
  xp_penalty integer,
  xp_awarded integer,
  xp_recoverable_words integer,
  xp_recovered_words integer,
  level integer,
  prestige integer,
  xp_in_level integer,
  xp_to_next integer,
  total_xp bigint,
  did_prestige boolean,
  badge_keys text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := case when lower(coalesce(p_mode, 'normal')) in ('normal', 'cloze', 'rhythm') then lower(coalesce(p_mode, 'normal')) else 'normal' end;
  v_length_mode text := case
    when lower(trim(coalesce(p_length_mode, ''))) in ('quick') then 'quick'
    when lower(trim(coalesce(p_length_mode, ''))) in ('full') then 'full'
    when lower(trim(coalesce(p_length_mode, ''))) in ('short') then 'short'
    when lower(trim(coalesce(p_length_mode, ''))) in ('macro') then 'macro'
    when lower(trim(coalesce(p_length_mode, ''))) in ('micro', 'rapid', 'rapido', 'fast') then 'rapid'
    else 'full'
  end;
  v_session_id uuid := null;
  v_words_correct integer := greatest(0, coalesce(p_words_correct, 0));
  v_words_wrong integer := greatest(0, coalesce(p_words_wrong, 0));
  v_progress record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_session_id is not null then
    select gs.id
      into v_session_id
    from public.game_sessions gs
    where gs.id = p_session_id
      and gs.user_id = v_uid
    for update;
  end if;

  if v_session_id is null and nullif(trim(coalesce(p_client_session_key, '')), '') is not null then
    select gs.id
      into v_session_id
    from public.game_sessions gs
    where gs.user_id = v_uid
      and gs.client_session_key = nullif(trim(coalesce(p_client_session_key, '')), '')
    order by gs.created_at desc
    limit 1
    for update;
  end if;

  if v_session_id is null then
    insert into public.game_sessions (
      user_id,
      client_session_key,
      song_title,
      artist,
      mode,
      length_mode,
      status,
      started_at
    )
    values (
      v_uid,
      nullif(trim(coalesce(p_client_session_key, '')), ''),
      nullif(trim(coalesce(p_song_title, '')), ''),
      nullif(trim(coalesce(p_artist, '')), ''),
      v_mode,
      v_length_mode,
      'started',
      now()
    )
    returning id into v_session_id;
  end if;

  select *
    into v_progress
  from public.apply_game_progress(
    p_song_title,
    p_artist,
    v_mode,
    p_wpm,
    p_accuracy,
    v_words_correct,
    v_words_wrong,
    p_total_chars,
    p_incorrect_chars,
    p_extra_chars,
    p_duration_seconds,
    v_length_mode
  );

  update public.game_sessions gs
     set song_title = coalesce(nullif(trim(coalesce(p_song_title, '')), ''), gs.song_title),
         artist = coalesce(nullif(trim(coalesce(p_artist, '')), ''), gs.artist),
         mode = v_mode,
         length_mode = v_length_mode,
         status = 'finished',
         finished_at = coalesce(gs.finished_at, now()),
         duration_seconds = greatest(0, coalesce(p_duration_seconds, gs.duration_seconds, 0)),
         wpm = greatest(0, coalesce(p_wpm, gs.wpm, 0)),
         accuracy = greatest(0, least(100, coalesce(p_accuracy, gs.accuracy, 0))),
         words_total = greatest(0, v_words_correct + v_words_wrong),
         words_correct = v_words_correct,
         words_wrong = v_words_wrong,
         game_result_id = coalesce(v_progress.game_result_id, gs.game_result_id)
   where gs.id = v_session_id
     and gs.user_id = v_uid;

  session_id := v_session_id;
  game_result_id := v_progress.game_result_id;
  xp_base := v_progress.xp_base;
  xp_penalty := v_progress.xp_penalty;
  xp_awarded := v_progress.xp_awarded;
  xp_recoverable_words := v_progress.xp_recoverable_words;
  xp_recovered_words := v_progress.xp_recovered_words;
  level := v_progress.level;
  prestige := v_progress.prestige;
  xp_in_level := v_progress.xp_in_level;
  xp_to_next := v_progress.xp_to_next;
  total_xp := v_progress.total_xp;
  did_prestige := v_progress.did_prestige;
  badge_keys := v_progress.badge_keys;
  return next;
end;
$$;

revoke all on function public.finish_game_session(uuid, text, text, text, text, text, integer, integer, integer, integer, integer, integer, integer, integer) from public;
grant execute on function public.finish_game_session(uuid, text, text, text, text, text, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;

-- Harden direct table writes: gameplay state must be mutated by RPC only.
revoke insert, update, delete on table public.user_progress from anon, authenticated;
revoke insert, update, delete on table public.game_results from anon, authenticated;
revoke insert, update, delete on table public.game_sessions from anon, authenticated;
grant select on table public.user_progress to authenticated;
grant select on table public.game_results to authenticated;
grant select on table public.game_sessions to authenticated;

-- Friend requests and social comparison
create table if not exists public.friend_requests (
  id bigint generated by default as identity primary key,
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists idx_friend_requests_pair_unique
on public.friend_requests(requester_id, recipient_id);

create index if not exists idx_friend_requests_recipient_status
on public.friend_requests(recipient_id, status);

alter table public.friend_requests enable row level security;

drop policy if exists "friend_requests_select_related" on public.friend_requests;
create policy "friend_requests_select_related"
on public.friend_requests
for select
to authenticated
using (auth.uid() = requester_id or auth.uid() = recipient_id);

drop policy if exists "friend_requests_insert_self" on public.friend_requests;
create policy "friend_requests_insert_self"
on public.friend_requests
for insert
to authenticated
with check (auth.uid() = requester_id and requester_id <> recipient_id);

drop policy if exists "friend_requests_update_recipient" on public.friend_requests;
create policy "friend_requests_update_recipient"
on public.friend_requests
for update
to authenticated
using (auth.uid() = recipient_id and status = 'pending')
with check (auth.uid() = recipient_id and status in ('accepted', 'rejected'));

create or replace function public.create_friend_request_by_username(target_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target uuid;
  existing_status text;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select id into target
  from public.profiles
  where lower(username) = lower(trim(target_username))
     or lower(email) = lower(trim(target_username))
  limit 1;

  if target is null then
    raise exception 'user not found';
  end if;

  if target = me then
    raise exception 'cannot add yourself';
  end if;

  select status into existing_status
  from public.friend_requests
  where (requester_id = me and recipient_id = target)
     or (requester_id = target and recipient_id = me)
  order by id desc
  limit 1;

  if existing_status = 'accepted' then
    return 'already friends';
  end if;

  if existing_status = 'pending' then
    update public.friend_requests
      set status = 'accepted',
          responded_at = now()
    where requester_id = target
      and recipient_id = me
      and status = 'pending';
    return 'request accepted';
  end if;

  insert into public.friend_requests (requester_id, recipient_id, status)
  values (me, target, 'pending')
  on conflict (requester_id, recipient_id) do update
    set status = 'pending',
        responded_at = null;

  return 'request sent';
end;
$$;

revoke all on function public.create_friend_request_by_username(text) from public;
grant execute on function public.create_friend_request_by_username(text) to authenticated;

-- Resolve login identifier (email or username) to email for auth flow
create or replace function public.get_login_email(login_identifier text)
returns text
language sql
security definer
set search_path = public
as $$
  select p.email
  from public.profiles p
  where lower(p.email) = lower(trim(login_identifier))
     or lower(p.username) = lower(trim(login_identifier))
  order by case when lower(p.email) = lower(trim(login_identifier)) then 0 else 1 end
  limit 1;
$$;

revoke all on function public.get_login_email(text) from public;
grant execute on function public.get_login_email(text) to anon, authenticated;

create or replace function public.respond_friend_request(req_id bigint, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.friend_requests
  set status = case when accept_request then 'accepted' else 'rejected' end,
      responded_at = now()
  where id = req_id
    and recipient_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'request not found';
  end if;
end;
$$;

revoke all on function public.respond_friend_request(bigint, boolean) from public;
grant execute on function public.respond_friend_request(bigint, boolean) to authenticated;

drop function if exists public.get_my_friend_requests();
create or replace function public.get_my_friend_requests()
returns table (
  request_id bigint,
  direction text,
  username text,
  avatar_url text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    fr.id as request_id,
    case when fr.recipient_id = auth.uid() then 'incoming' else 'outgoing' end as direction,
    coalesce(p.username, 'unknown') as username,
    p.avatar_url,
    fr.status,
    fr.created_at
  from public.friend_requests fr
  left join public.profiles p
    on p.id = case when fr.recipient_id = auth.uid() then fr.requester_id else fr.recipient_id end
  where fr.requester_id = auth.uid() or fr.recipient_id = auth.uid()
  order by fr.created_at desc;
$$;

revoke all on function public.get_my_friend_requests() from public;
grant execute on function public.get_my_friend_requests() to authenticated;

drop function if exists public.get_my_friends_with_stats();
create or replace function public.get_my_friends_with_stats()
returns table (
  friend_id uuid,
  username text,
  avatar_url text,
  games integer,
  best_wpm integer,
  avg_wpm integer,
  avg_acc integer
)
language sql
security definer
set search_path = public
as $$
  with friends as (
    select case when fr.requester_id = auth.uid() then fr.recipient_id else fr.requester_id end as friend_id
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (fr.requester_id = auth.uid() or fr.recipient_id = auth.uid())
  )
  select
    f.friend_id,
    coalesce(p.username, 'unknown') as username,
    p.avatar_url,
    count(gr.id)::int as games,
    coalesce(max(gr.wpm), 0)::int as best_wpm,
    coalesce(round(avg(gr.wpm)), 0)::int as avg_wpm,
    coalesce(round(avg(gr.accuracy)), 0)::int as avg_acc
  from friends f
  left join public.profiles p on p.id = f.friend_id
  left join public.game_results gr on gr.user_id = f.friend_id
  group by f.friend_id, p.username, p.avatar_url
  order by avg_wpm desc, games desc, username asc;
$$;

revoke all on function public.get_my_friends_with_stats() from public;
grant execute on function public.get_my_friends_with_stats() to authenticated;

drop function if exists public.get_friend_profile_snapshot(uuid);
create or replace function public.get_friend_profile_snapshot(p_friend_id uuid)
returns table (
  friend_id uuid,
  username text,
  avatar_url text,
  bio text,
  level integer,
  prestige integer,
  xp_in_level integer,
  xp_to_next integer,
  games integer,
  best_wpm integer,
  avg_wpm integer,
  avg_acc integer,
  total_typing_seconds bigint,
  primary_song_title text,
  primary_song_artist text,
  primary_song_runs integer,
  top_artists jsonb,
  top_songs jsonb
)
language sql
security definer
set search_path = public
as $$
  with friends as (
    select case when fr.requester_id = auth.uid() then fr.recipient_id else fr.requester_id end as friend_id
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (fr.requester_id = auth.uid() or fr.recipient_id = auth.uid())
  ),
  target as (
    select f.friend_id
    from friends f
    where f.friend_id = p_friend_id
    limit 1
  ),
  prof as (
    select p.id, p.username, p.avatar_url, p.bio
    from public.profiles p
    join target t on t.friend_id = p.id
  ),
  prog as (
    select up.user_id, up.level, up.prestige_level, up.xp_in_level
    from public.user_progress up
    join target t on t.friend_id = up.user_id
  ),
  stat as (
    select
      gr.user_id,
      count(gr.id)::int as games,
      coalesce(max(gr.wpm), 0)::int as best_wpm,
      coalesce(round(avg(gr.wpm)), 0)::int as avg_wpm,
      coalesce(round(avg(gr.accuracy)), 0)::int as avg_acc,
      coalesce(sum(gr.duration_seconds), 0)::bigint as total_typing_seconds
    from public.game_results gr
    join target t on t.friend_id = gr.user_id
    group by gr.user_id
  ),
  song_rows as (
    select
      gr.user_id,
      nullif(trim(coalesce(gr.song_title, '')), '') as song_title,
      nullif(trim(coalesce(gr.artist, '')), '') as artist,
      count(*)::int as runs,
      coalesce(round(avg(gr.wpm)), 0)::int as avg_wpm,
      coalesce(round(avg(gr.accuracy)), 0)::int as avg_acc
    from public.game_results gr
    join target t on t.friend_id = gr.user_id
    where nullif(trim(coalesce(gr.song_title, '')), '') is not null
      and nullif(trim(coalesce(gr.artist, '')), '') is not null
    group by gr.user_id, song_title, artist
  ),
  primary_song as (
    select sr.user_id, sr.song_title, sr.artist, sr.runs
    from song_rows sr
    order by sr.runs desc, sr.song_title asc
    limit 1
  ),
  artists_json as (
    select
      a.user_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'artist', a.artist,
            'count', a.runs,
            'avgWpm', a.avg_wpm
          )
          order by a.runs desc, a.artist asc
        ),
        '[]'::jsonb
      ) as rows
    from (
      select
        gr.user_id,
        nullif(trim(coalesce(gr.artist, '')), '') as artist,
        count(*)::int as runs,
        coalesce(round(avg(gr.wpm)), 0)::int as avg_wpm
      from public.game_results gr
      join target t on t.friend_id = gr.user_id
      where nullif(trim(coalesce(gr.artist, '')), '') is not null
      group by gr.user_id, artist
      order by runs desc, artist asc
      limit 24
    ) a
    group by a.user_id
  ),
  songs_json as (
    select
      sr.user_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'song', sr.song_title,
            'artist', sr.artist,
            'count', sr.runs,
            'avgWpm', sr.avg_wpm,
            'avgAcc', sr.avg_acc
          )
          order by sr.runs desc, sr.song_title asc
        ),
        '[]'::jsonb
      ) as rows
    from (
      select *
      from song_rows
      order by runs desc, song_title asc
      limit 24
    ) sr
    group by sr.user_id
  )
  select
    p.id as friend_id,
    coalesce(p.username, 'unknown') as username,
    p.avatar_url,
    p.bio,
    coalesce(pg.level, 1)::int as level,
    coalesce(pg.prestige_level, 0)::int as prestige,
    coalesce(pg.xp_in_level, 0)::int as xp_in_level,
    greatest(0, public.xp_required_for_level(coalesce(pg.level, 1)) - coalesce(pg.xp_in_level, 0))::int as xp_to_next,
    coalesce(s.games, 0)::int as games,
    coalesce(s.best_wpm, 0)::int as best_wpm,
    coalesce(s.avg_wpm, 0)::int as avg_wpm,
    coalesce(s.avg_acc, 0)::int as avg_acc,
    coalesce(s.total_typing_seconds, 0)::bigint as total_typing_seconds,
    ps.song_title as primary_song_title,
    ps.artist as primary_song_artist,
    coalesce(ps.runs, 0)::int as primary_song_runs,
    coalesce(aj.rows, '[]'::jsonb) as top_artists,
    coalesce(sj.rows, '[]'::jsonb) as top_songs
  from prof p
  left join prog pg on pg.user_id = p.id
  left join stat s on s.user_id = p.id
  left join primary_song ps on ps.user_id = p.id
  left join artists_json aj on aj.user_id = p.id
  left join songs_json sj on sj.user_id = p.id
  limit 1;
$$;

revoke all on function public.get_friend_profile_snapshot(uuid) from public;
grant execute on function public.get_friend_profile_snapshot(uuid) to authenticated;

drop function if exists public.get_my_total_typing_seconds();
create or replace function public.get_my_total_typing_seconds()
returns table (
  total_typing_seconds bigint,
  total_typing_minutes integer
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(gr.duration_seconds), 0)::bigint as total_typing_seconds,
    floor(coalesce(sum(gr.duration_seconds), 0) / 60.0)::int as total_typing_minutes
  from public.game_results gr
  where gr.user_id = auth.uid();
$$;

revoke all on function public.get_my_total_typing_seconds() from public;
grant execute on function public.get_my_total_typing_seconds() to authenticated;

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

-- Optional helper: create profile automatically on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Account deletion for logged users
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- Game results
create table if not exists public.game_results (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  song_title text,
  artist text,
  mode text not null default 'normal' check (mode in ('normal', 'cloze', 'rhythm')),
  wpm integer not null default 0,
  accuracy integer not null default 0,
  words_correct integer not null default 0,
  words_wrong integer not null default 0,
  total_chars integer not null default 0,
  incorrect_chars integer not null default 0,
  extra_chars integer not null default 0,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_results_user_created_at
on public.game_results(user_id, created_at desc);

alter table public.game_results enable row level security;

drop policy if exists "game_results_select_own" on public.game_results;
create policy "game_results_select_own"
on public.game_results
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "game_results_insert_own" on public.game_results;
-- No direct insert; results are written only via RPC.

drop policy if exists "game_results_delete_own" on public.game_results;
-- No direct delete from client.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'game_results_accuracy_chk'
  ) then
    alter table public.game_results
      add constraint game_results_accuracy_chk
      check (accuracy between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'game_results_non_negative_chk'
  ) then
    alter table public.game_results
      add constraint game_results_non_negative_chk
      check (
        wpm >= 0 and
        words_correct >= 0 and
        words_wrong >= 0 and
        total_chars >= 0 and
        incorrect_chars >= 0 and
        extra_chars >= 0 and
        duration_seconds >= 0
      );
  end if;
end $$;

-- Favorites playlist
create table if not exists public.user_favorites (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  song_title text not null,
  artist text not null,
  source_type text not null default 'catalog' check (source_type in ('catalog', 'custom')),
  custom_lyrics text,
  custom_translation text,
  custom_cover_url text,
  created_at timestamptz not null default now(),
  unique(user_id, song_title, artist)
);

alter table public.user_favorites add column if not exists source_type text not null default 'catalog';
alter table public.user_favorites add column if not exists custom_lyrics text;
alter table public.user_favorites add column if not exists custom_translation text;
alter table public.user_favorites add column if not exists custom_cover_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_favorites_source_type_chk'
  ) then
    alter table public.user_favorites
      add constraint user_favorites_source_type_chk
      check (source_type in ('catalog', 'custom'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_favorites_custom_lengths_chk'
  ) then
    alter table public.user_favorites
      add constraint user_favorites_custom_lengths_chk
      check (
        (custom_lyrics is null or char_length(custom_lyrics) <= 4000)
        and (custom_translation is null or char_length(custom_translation) <= 4000)
        and (coalesce(char_length(custom_lyrics), 0) + coalesce(char_length(custom_translation), 0) <= 6500)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_favorites_custom_cover_len_chk'
  ) then
    alter table public.user_favorites
      add constraint user_favorites_custom_cover_len_chk
      check (
        custom_cover_url is null or char_length(custom_cover_url) <= 1024
      );
  end if;
end $$;

create index if not exists idx_user_favorites_user_created
on public.user_favorites(user_id, created_at desc);

alter table public.user_favorites enable row level security;

drop policy if exists "user_favorites_select_own" on public.user_favorites;
create policy "user_favorites_select_own"
on public.user_favorites
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_favorites_insert_own" on public.user_favorites;
create policy "user_favorites_insert_own"
on public.user_favorites
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_favorites_delete_own" on public.user_favorites;
create policy "user_favorites_delete_own"
on public.user_favorites
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, delete on table public.user_favorites to authenticated;
grant usage, select on sequence public.user_favorites_id_seq to authenticated;

-- Avatar storage bucket (public read, owner write/delete)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- Shared result cards (score links)
create table if not exists public.shared_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  song_title text,
  artist text,
  mode text not null default 'normal' check (mode in ('normal', 'cloze', 'rhythm')),
  wpm integer not null default 0,
  accuracy integer not null default 0 check (accuracy between 0 and 100),
  raw integer not null default 0,
  consistency integer not null default 0 check (consistency between 0 and 100),
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_shared_results_created_at
on public.shared_results(created_at desc);

create index if not exists idx_shared_results_user_created_at
on public.shared_results(user_id, created_at desc);

alter table public.shared_results enable row level security;

drop policy if exists "shared_results_select_auth" on public.shared_results;
create policy "shared_results_select_auth"
on public.shared_results
for select
to authenticated
using (true);

drop policy if exists "shared_results_insert_own" on public.shared_results;
create policy "shared_results_insert_own"
on public.shared_results
for insert
to authenticated
with check (auth.uid() = user_id);

drop function if exists public.create_shared_result(text, text, text, integer, integer, integer, integer, integer);
create or replace function public.create_shared_result(
  p_song_title text,
  p_artist text,
  p_mode text,
  p_wpm integer,
  p_accuracy integer,
  p_raw integer,
  p_consistency integer,
  p_duration_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.shared_results (
    user_id,
    song_title,
    artist,
    mode,
    wpm,
    accuracy,
    raw,
    consistency,
    duration_seconds
  ) values (
    auth.uid(),
    p_song_title,
    p_artist,
    coalesce(p_mode, 'normal'),
    coalesce(p_wpm, 0),
    coalesce(p_accuracy, 0),
    coalesce(p_raw, 0),
    coalesce(p_consistency, 0),
    coalesce(p_duration_seconds, 0)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_shared_result(text, text, text, integer, integer, integer, integer, integer) from public;
grant execute on function public.create_shared_result(text, text, text, integer, integer, integer, integer, integer) to authenticated;

drop function if exists public.get_shared_result(uuid);
create or replace function public.get_shared_result(p_share_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  owner_username text,
  owner_avatar_url text,
  song_title text,
  artist text,
  mode text,
  wpm integer,
  accuracy integer,
  raw integer,
  consistency integer,
  duration_seconds integer,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    sr.id,
    sr.user_id as owner_id,
    coalesce(p.username, 'unknown') as owner_username,
    p.avatar_url as owner_avatar_url,
    sr.song_title,
    sr.artist,
    sr.mode,
    sr.wpm,
    sr.accuracy,
    sr.raw,
    sr.consistency,
    sr.duration_seconds,
    sr.created_at
  from public.shared_results sr
  left join public.profiles p on p.id = sr.user_id
  where sr.id = p_share_id
  limit 1;
$$;

revoke all on function public.get_shared_result(uuid) from public;
grant execute on function public.get_shared_result(uuid) to anon, authenticated;

-- Duel mode (room + invite + race)
create table if not exists public.duel_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  song_title text not null,
  artist text,
  lyrics text not null,
  translation text,
  status text not null default 'waiting' check (status in ('waiting', 'countdown', 'active', 'finished', 'canceled')),
  countdown_seconds integer not null default 5 check (countdown_seconds between 3 and 15),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.duel_room_members (
  room_id uuid not null references public.duel_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.duel_room_invites (
  id bigint generated by default as identity primary key,
  room_id uuid not null references public.duel_rooms(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'canceled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists idx_duel_invites_room_invitee
on public.duel_room_invites(room_id, invitee_id);

create index if not exists idx_duel_invites_invitee_status
on public.duel_room_invites(invitee_id, status, created_at desc);

create table if not exists public.duel_progress (
  room_id uuid not null references public.duel_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  typed_words integer not null default 0 check (typed_words >= 0),
  typed_chars integer not null default 0 check (typed_chars >= 0),
  wpm integer not null default 0 check (wpm >= 0),
  accuracy integer not null default 0 check (accuracy between 0 and 100),
  is_finished boolean not null default false,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.duel_rooms enable row level security;
alter table public.duel_room_members enable row level security;
alter table public.duel_room_invites enable row level security;
alter table public.duel_progress enable row level security;

drop policy if exists "duel_rooms_select_members" on public.duel_rooms;
create policy "duel_rooms_select_members"
on public.duel_rooms
for select
to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.duel_room_members m
    where m.room_id = id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "duel_rooms_insert_owner" on public.duel_rooms;
create policy "duel_rooms_insert_owner"
on public.duel_rooms
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "duel_rooms_update_owner" on public.duel_rooms;
create policy "duel_rooms_update_owner"
on public.duel_rooms
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "duel_members_select_related" on public.duel_room_members;
create policy "duel_members_select_related"
on public.duel_room_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.duel_rooms dr
    where dr.id = duel_room_members.room_id
      and dr.owner_id = auth.uid()
  )
);

drop policy if exists "duel_members_insert_self" on public.duel_room_members;
create policy "duel_members_insert_self"
on public.duel_room_members
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "duel_members_delete_self" on public.duel_room_members;
create policy "duel_members_delete_self"
on public.duel_room_members
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "duel_invites_select_related" on public.duel_room_invites;
create policy "duel_invites_select_related"
on public.duel_room_invites
for select
to authenticated
using (inviter_id = auth.uid() or invitee_id = auth.uid());

drop policy if exists "duel_invites_insert_inviter" on public.duel_room_invites;
create policy "duel_invites_insert_inviter"
on public.duel_room_invites
for insert
to authenticated
with check (inviter_id = auth.uid());

drop policy if exists "duel_invites_update_related" on public.duel_room_invites;
create policy "duel_invites_update_related"
on public.duel_room_invites
for update
to authenticated
using (inviter_id = auth.uid() or invitee_id = auth.uid())
with check (inviter_id = auth.uid() or invitee_id = auth.uid());

drop policy if exists "duel_progress_select_related" on public.duel_progress;
create policy "duel_progress_select_related"
on public.duel_progress
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.duel_room_members me
    where me.room_id = room_id
      and me.user_id = auth.uid()
  )
);

drop policy if exists "duel_progress_insert_self_member" on public.duel_progress;
create policy "duel_progress_insert_self_member"
on public.duel_progress
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.duel_room_members me
    where me.room_id = room_id
      and me.user_id = auth.uid()
  )
);

drop policy if exists "duel_progress_update_self_member" on public.duel_progress;
create policy "duel_progress_update_self_member"
on public.duel_progress
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.duel_room_members me
    where me.room_id = room_id
      and me.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.duel_room_members me
    where me.room_id = room_id
      and me.user_id = auth.uid()
  )
);

create or replace function public.create_duel_room(
  p_song_title text,
  p_artist text,
  p_lyrics text,
  p_translation text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_title text := trim(coalesce(p_song_title, ''));
  v_artist text := trim(coalesce(p_artist, ''));
  v_lyrics text := trim(coalesce(p_lyrics, ''));
  v_translation text := trim(coalesce(p_translation, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_title = '' then
    raise exception 'song title required';
  end if;

  if v_lyrics = '' then
    raise exception 'lyrics required';
  end if;

  if char_length(v_lyrics) > 4000 then
    raise exception 'lyrics too long';
  end if;

  if char_length(v_translation) > 4000 then
    raise exception 'translation too long';
  end if;

  if char_length(v_lyrics) + char_length(v_translation) > 6500 then
    raise exception 'lyrics + translation too long';
  end if;

  insert into public.duel_rooms (owner_id, song_title, artist, lyrics, translation)
  values (auth.uid(), v_title, nullif(v_artist, ''), v_lyrics, nullif(v_translation, ''))
  returning id into v_room_id;

  insert into public.duel_room_members (room_id, user_id)
  values (v_room_id, auth.uid())
  on conflict (room_id, user_id) do nothing;

  return v_room_id;
end;
$$;

revoke all on function public.create_duel_room(text, text, text, text) from public;
grant execute on function public.create_duel_room(text, text, text, text) to authenticated;

create or replace function public.join_duel_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room record;
  v_member_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select id, status into v_room
  from public.duel_rooms
  where id = p_room_id
  limit 1;

  if v_room.id is null then
    raise exception 'room not found';
  end if;

  if v_room.status not in ('waiting', 'countdown', 'active') then
    raise exception 'room unavailable';
  end if;

  select count(*)::int into v_member_count
  from public.duel_room_members
  where room_id = p_room_id;

  if v_member_count >= 2 then
    raise exception 'room full';
  end if;

  insert into public.duel_room_members (room_id, user_id)
  values (p_room_id, auth.uid())
  on conflict (room_id, user_id) do nothing;
end;
$$;

revoke all on function public.join_duel_room(uuid) from public;
grant execute on function public.join_duel_room(uuid) to authenticated;

create or replace function public.invite_duel_player(
  p_room_id uuid,
  p_target_identifier text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_owner uuid;
  v_target uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select owner_id into v_room_owner
  from public.duel_rooms
  where id = p_room_id
  limit 1;

  if v_room_owner is null then
    raise exception 'room not found';
  end if;

  if v_room_owner <> auth.uid() then
    raise exception 'only owner can invite';
  end if;

  select p.id into v_target
  from public.profiles p
  where lower(p.username) = lower(trim(p_target_identifier))
     or lower(p.email) = lower(trim(p_target_identifier))
  limit 1;

  if v_target is null then
    raise exception 'user not found';
  end if;

  if v_target = auth.uid() then
    raise exception 'cannot invite yourself';
  end if;

  insert into public.duel_room_invites (room_id, inviter_id, invitee_id, status)
  values (p_room_id, auth.uid(), v_target, 'pending')
  on conflict (room_id, invitee_id) do update
    set status = 'pending',
        responded_at = null,
        inviter_id = excluded.inviter_id,
        created_at = now();

  return 'invite sent';
end;
$$;

revoke all on function public.invite_duel_player(uuid, text) from public;
grant execute on function public.invite_duel_player(uuid, text) to authenticated;

create or replace function public.respond_duel_invite(
  p_invite_id bigint,
  p_accept boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_member_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.duel_room_invites dri
  set status = case when p_accept then 'accepted' else 'rejected' end,
      responded_at = now()
  where dri.id = p_invite_id
    and dri.invitee_id = auth.uid()
    and dri.status = 'pending'
  returning dri.room_id into v_room_id;

  if v_room_id is null then
    raise exception 'invite not found';
  end if;

  if p_accept then
    select count(*)::int into v_member_count
    from public.duel_room_members
    where room_id = v_room_id;

    if v_member_count >= 2 then
      raise exception 'room full';
    end if;

    insert into public.duel_room_members (room_id, user_id)
    values (v_room_id, auth.uid())
    on conflict (room_id, user_id) do nothing;
  end if;

  return v_room_id;
end;
$$;

revoke all on function public.respond_duel_invite(bigint, boolean) from public;
grant execute on function public.respond_duel_invite(bigint, boolean) to authenticated;

create or replace function public.start_duel_room(
  p_room_id uuid,
  p_countdown_seconds integer default 5
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_member_count integer;
  v_cd integer := greatest(3, least(coalesce(p_countdown_seconds, 5), 15));
  v_start timestamptz := now() + make_interval(secs => v_cd);
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select owner_id into v_owner
  from public.duel_rooms
  where id = p_room_id
  limit 1;

  if v_owner is null then
    raise exception 'room not found';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'only owner can start';
  end if;

  select count(*)::int into v_member_count
  from public.duel_room_members
  where room_id = p_room_id;

  if v_member_count < 2 then
    raise exception 'at least 2 players required';
  end if;

  delete from public.duel_progress where room_id = p_room_id;

  update public.duel_rooms
  set status = 'countdown',
      countdown_seconds = v_cd,
      started_at = v_start,
      finished_at = null
  where id = p_room_id;

  return v_start;
end;
$$;

revoke all on function public.start_duel_room(uuid, integer) from public;
grant execute on function public.start_duel_room(uuid, integer) to authenticated;

create or replace function public.leave_duel_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.duel_room_members
  where room_id = p_room_id
    and user_id = auth.uid();

  delete from public.duel_progress
  where room_id = p_room_id
    and user_id = auth.uid();

  select owner_id into v_owner
  from public.duel_rooms
  where id = p_room_id
  limit 1;

  if v_owner = auth.uid() then
    update public.duel_rooms
    set status = 'canceled',
        finished_at = now()
    where id = p_room_id;
  end if;
end;
$$;

revoke all on function public.leave_duel_room(uuid) from public;
grant execute on function public.leave_duel_room(uuid) to authenticated;

create or replace function public.upsert_duel_progress(
  p_room_id uuid,
  p_typed_words integer,
  p_typed_chars integer,
  p_wpm integer,
  p_accuracy integer,
  p_is_finished boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.duel_room_members m
    where m.room_id = p_room_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'not in room';
  end if;

  insert into public.duel_progress (
    room_id,
    user_id,
    typed_words,
    typed_chars,
    wpm,
    accuracy,
    is_finished,
    finished_at,
    updated_at
  )
  values (
    p_room_id,
    auth.uid(),
    greatest(coalesce(p_typed_words, 0), 0),
    greatest(coalesce(p_typed_chars, 0), 0),
    greatest(coalesce(p_wpm, 0), 0),
    greatest(0, least(coalesce(p_accuracy, 0), 100)),
    coalesce(p_is_finished, false),
    case when coalesce(p_is_finished, false) then now() else null end,
    now()
  )
  on conflict (room_id, user_id) do update
    set typed_words = excluded.typed_words,
        typed_chars = excluded.typed_chars,
        wpm = excluded.wpm,
        accuracy = excluded.accuracy,
        is_finished = excluded.is_finished,
        finished_at = case
          when public.duel_progress.finished_at is not null then public.duel_progress.finished_at
          when excluded.is_finished then now()
          else null
        end,
        updated_at = now();
end;
$$;

revoke all on function public.upsert_duel_progress(uuid, integer, integer, integer, integer, boolean) from public;
grant execute on function public.upsert_duel_progress(uuid, integer, integer, integer, integer, boolean) to authenticated;

-- Realtime publication for duel mode tables
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'duel_rooms'
  ) then
    alter publication supabase_realtime add table public.duel_rooms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'duel_room_members'
  ) then
    alter publication supabase_realtime add table public.duel_room_members;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'duel_room_invites'
  ) then
    alter publication supabase_realtime add table public.duel_room_invites;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'duel_progress'
  ) then
    alter publication supabase_realtime add table public.duel_progress;
  end if;
exception
  when undefined_object then
    null;
end $$;
