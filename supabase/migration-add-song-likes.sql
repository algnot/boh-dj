-- Song likes: listeners cheer a song and the requester earns points

alter table public.room_sessions
  add column if not exists current_play_id text not null default '',
  add column if not exists current_owner_name text not null default '',
  add column if not exists current_owner_user_id text not null default '';

alter table public.room_queue
  add column if not exists added_by_user_id text not null default '';

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

drop policy if exists "Anyone can read room likes" on public.room_likes;
create policy "Anyone can read room likes"
  on public.room_likes for select using (true);

drop policy if exists "Anyone can insert room likes" on public.room_likes;
create policy "Anyone can insert room likes"
  on public.room_likes for insert with check (true);

drop policy if exists "Anyone can delete room likes" on public.room_likes;
create policy "Anyone can delete room likes"
  on public.room_likes for delete using (true);

create table if not exists public.room_score_announcements (
  play_id text primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.room_score_announcements enable row level security;

drop policy if exists "Anyone can read score announcements" on public.room_score_announcements;
create policy "Anyone can read score announcements"
  on public.room_score_announcements for select using (true);

drop policy if exists "Anyone can insert score announcements" on public.room_score_announcements;
create policy "Anyone can insert score announcements"
  on public.room_score_announcements for insert with check (true);

alter publication supabase_realtime add table public.room_likes;
