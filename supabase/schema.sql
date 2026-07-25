-- Boh DJ: multi-room YouTube listen-together

create extension if not exists "pgcrypto";

create table if not exists public.rooms (
  id text primary key,
  line_source_type text not null check (line_source_type in ('user', 'group', 'room')),
  line_source_id text not null unique,
  control_token text not null,
  created_at timestamptz not null default now()
);

create index if not exists rooms_line_source_id_idx on public.rooms (line_source_id);

alter table public.rooms enable row level security;

create policy "Anyone can read rooms"
  on public.rooms for select using (true);

create policy "Anyone can insert rooms"
  on public.rooms for insert with check (true);

create policy "Anyone can update rooms"
  on public.rooms for update using (true) with check (true);

create table if not exists public.room_sessions (
  room_id text primary key references public.rooms (id) on delete cascade,
  current_video_id text,
  current_title text not null default '',
  current_thumbnail_url text not null default '',
  -- identifies one *play* of a track, so likes reset when the song replays
  current_play_id text not null default '',
  current_owner_name text not null default '',
  current_owner_user_id text not null default '',
  playback_state text not null default 'paused' check (playback_state in ('playing', 'paused')),
  playback_position_ms int not null default 0,
  playback_updated_at timestamptz not null default now(),
  duration_ms int not null default 0,
  loop_mode text not null default 'all' check (loop_mode in ('off', 'one', 'all', 'shuffle')),
  host_client_id text,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.room_sessions enable row level security;

create policy "Anyone can read room sessions"
  on public.room_sessions for select using (true);

create policy "Anyone can insert room sessions"
  on public.room_sessions for insert with check (true);

create policy "Anyone can update room sessions"
  on public.room_sessions for update using (true) with check (true);

create table if not exists public.room_queue (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms (id) on delete cascade,
  youtube_video_id text not null,
  title text not null default '',
  thumbnail_url text not null default '',
  added_by_name text not null default '',
  added_by_user_id text not null default '',
  -- true when re-queued by loop mode (already played), false for fresh adds.
  -- Shuffle mode plays fresh songs first, then randomises the recycled pool.
  is_recycled boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists room_queue_room_sort_idx
  on public.room_queue (room_id, sort_order, created_at);

alter table public.room_queue enable row level security;

create policy "Anyone can read room queue"
  on public.room_queue for select using (true);

create policy "Anyone can insert room queue"
  on public.room_queue for insert with check (true);

create policy "Anyone can update room queue"
  on public.room_queue for update using (true) with check (true);

create policy "Anyone can delete room queue"
  on public.room_queue for delete using (true);

create table if not exists public.room_events (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms (id) on delete cascade,
  event_type text not null,
  message text not null default '',
  actor_name text not null default '',
  actor_user_id text not null default '',
  actor_picture_url text not null default '',
  track_title text not null default '',
  track_video_id text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists room_events_room_created_idx
  on public.room_events (room_id, created_at desc);

alter table public.room_events enable row level security;

create policy "Anyone can read room events"
  on public.room_events for select using (true);

create policy "Anyone can insert room events"
  on public.room_events for insert with check (true);

-- One like per listener per play. The requester cannot like their own song.
create table if not exists public.room_likes (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms (id) on delete cascade,
  play_id text not null,
  video_id text not null,
  track_title text not null default '',
  owner_name text not null default '',
  owner_user_id text not null default '',
  liker_key text not null,
  liker_name text not null default '',
  liker_picture_url text not null default '',
  created_at timestamptz not null default now(),
  unique (play_id, liker_key)
);

create index if not exists room_likes_room_created_idx
  on public.room_likes (room_id, created_at desc);

create index if not exists room_likes_play_idx
  on public.room_likes (play_id);

alter table public.room_likes enable row level security;

create policy "Anyone can read room likes"
  on public.room_likes for select using (true);

create policy "Anyone can insert room likes"
  on public.room_likes for insert with check (true);

create policy "Anyone can delete room likes"
  on public.room_likes for delete using (true);

-- Keeps the end-of-song score message from being sent twice for one play.
create table if not exists public.room_score_announcements (
  play_id text primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.room_score_announcements enable row level security;

create policy "Anyone can read score announcements"
  on public.room_score_announcements for select using (true);

create policy "Anyone can insert score announcements"
  on public.room_score_announcements for insert with check (true);

alter publication supabase_realtime add table public.room_sessions;
alter publication supabase_realtime add table public.room_queue;
alter publication supabase_realtime add table public.room_events;
alter publication supabase_realtime add table public.room_likes;
