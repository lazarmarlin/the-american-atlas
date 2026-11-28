-- More fun in chats (src/lib/messages.ts, src/lib/chat-pulse.ts): stickers,
-- and who has a chat open right now (their map avatar peeks in the corner for
-- the others, with dots while they type).

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board', 'poll', 'where', 'sticker'));

alter table group_messages drop constraint if exists group_messages_kind_check;
alter table group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board', 'poll', 'where', 'sticker'));

-- thread: the friend's id, or 'g:<group id>' (the same keys as message_reads).
create table if not exists chat_presence (
  user_id text not null,
  thread text not null,
  seen_at timestamptz not null default now(),
  typing_at timestamptz,
  primary key (user_id, thread)
);
create index if not exists chat_presence_thread on chat_presence (thread, seen_at desc);
