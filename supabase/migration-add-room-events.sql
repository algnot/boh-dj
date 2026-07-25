-- Activity feed: who added songs / controlled playback

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

alter publication supabase_realtime add table public.room_events;
