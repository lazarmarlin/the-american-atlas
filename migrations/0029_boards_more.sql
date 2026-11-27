-- More boards: a wish list of places (ticks itself off when you or anyone on
-- it gets there), car care (service reminders from the miles you drive), and
-- split costs. And quick polls in a chat. src/lib/boards.ts, src/lib/polls.ts.

alter table boards drop constraint if exists boards_kind_check;
alter table boards add constraint boards_kind_check check (kind in ('todo', 'pack', 'trip', 'wish', 'car', 'split'));

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board', 'poll'));

alter table group_messages drop constraint if exists group_messages_kind_check;
alter table group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board', 'poll'));

create table if not exists poll_votes (
  message_id text not null,
  user_id text not null,
  choice smallint not null,
  voted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
