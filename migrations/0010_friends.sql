-- A personal link code, and the people who opened it.
-- Friendships are stored in both directions so "my friends" is one query.
-- Only saved, unhidden ghost trails are shown to a friend (see src/lib/friends.ts).
create table if not exists friend_links (
  user_id text primary key,
  code text not null unique
);

create table if not exists friendships (
  user_id text not null,
  friend_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create index if not exists friendships_friend_idx on friendships (friend_id);
