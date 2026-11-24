-- More chat (src/lib/messages.ts, src/lib/chat-groups.ts, src/lib/reactions.ts):
-- place cards, where a chat photo was taken, read state, deleting, trip group
-- chats, and thumbs-up on a friend's badges and check-ins.

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check check (kind in ('text', 'link', 'photo', 'place'));
alter table messages add column if not exists lat double precision;
alter table messages add column if not exists lon double precision;
alter table messages add column if not exists taken_at bigint;

-- When someone last read a conversation: a friend's id, 'g:<group id>', or 'likes'.
create table if not exists message_reads (
  user_id text not null,
  thread text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, thread)
);

-- "Delete for me" on a message someone else sent.
create table if not exists message_hidden (
  user_id text not null,
  message_id text not null,
  primary key (user_id, message_id)
);

create table if not exists chat_groups (
  id text primary key,
  name text not null,
  owner_id text not null,
  created_at timestamptz not null default now()
);
create table if not exists chat_group_members (
  group_id text not null,
  user_id text not null,
  primary key (group_id, user_id)
);
create index if not exists chat_group_members_user on chat_group_members (user_id);

create table if not exists group_messages (
  id text primary key,
  group_id text not null,
  from_id text not null,
  kind text not null,
  body text not null default '',
  thumb text,
  image text,
  lat double precision,
  lon double precision,
  taken_at bigint,
  created_at timestamptz not null default now(),
  check (kind in ('text', 'link', 'photo', 'place'))
);
create index if not exists group_messages_group on group_messages (group_id, created_at desc);

-- A thumbs-up from user_id on something of owner_id's: 'badge:<id>' or 'visit:<place id>|<visit id>'.
create table if not exists reactions (
  user_id text not null,
  owner_id text not null,
  target text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, owner_id, target)
);
create index if not exists reactions_owner on reactions (owner_id, created_at desc);
