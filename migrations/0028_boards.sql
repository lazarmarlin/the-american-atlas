-- Shared boards (a to-do, a packing list, a trip plan). The owner sends one
-- in a chat; board_shares is who else may open it and whether they may only
-- check things off. src/lib/boards.ts.

create table if not exists boards (
  id text primary key,
  owner_id text not null,
  kind text not null check (kind in ('todo', 'pack', 'trip')),
  title text not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boards_owner_idx on boards (owner_id, updated_at desc);

create table if not exists board_shares (
  board_id text not null references boards (id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('check', 'edit')),
  primary key (board_id, user_id)
);

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board'));

alter table group_messages drop constraint if exists group_messages_kind_check;
alter table group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board'));
