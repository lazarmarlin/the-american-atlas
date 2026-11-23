-- Who may watch your live ghost trail (at most three; enforced in src/lib/live-share.ts).
-- The trail itself is replaced while tracking and removed when tracking stops.
create table if not exists live_viewers (
  user_id text not null,
  friend_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

create index if not exists live_viewers_friend_idx on live_viewers (friend_id);

create table if not exists live_trails (
  user_id text primary key,
  points jsonb not null,
  updated_at timestamptz not null default now()
);
