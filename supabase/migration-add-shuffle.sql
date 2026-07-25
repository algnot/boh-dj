-- Shuffle loop mode: play freshly-added songs first, then randomise replays

alter table public.room_queue
  add column if not exists is_recycled boolean not null default false;

alter table public.room_sessions
  drop constraint if exists room_sessions_loop_mode_check;

alter table public.room_sessions
  add constraint room_sessions_loop_mode_check
  check (loop_mode in ('off', 'one', 'all', 'shuffle'));
