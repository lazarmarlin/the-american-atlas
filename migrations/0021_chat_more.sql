-- Reply, reactions, one pinned message per chat, and trail cards (src/lib/messages.ts).

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail'));
alter table messages add column if not exists reply_to text;

alter table group_messages drop constraint if exists group_messages_kind_check;
alter table group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail'));
alter table group_messages add column if not exists reply_to text;

create table if not exists message_reactions (
  message_id text not null,
  user_id text not null,
  mark text not null,
  primary key (message_id, user_id, mark),
  check (mark in ('up', 'heart', 'pin'))
);

-- One message stuck to the top of a chat. `thread` is a friend id or 'g:<group>'.
create table if not exists thread_pins (
  thread text primary key,
  message_id text not null,
  by_id text not null
);
