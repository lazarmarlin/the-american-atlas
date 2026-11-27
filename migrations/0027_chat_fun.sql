-- Wave, been-here, and car reactions, plus a voice note (src/lib/messages.ts).

alter table message_reactions drop constraint if exists message_reactions_check;
alter table message_reactions drop constraint if exists message_reactions_mark_check;
alter table message_reactions add constraint message_reactions_mark_check
  check (mark in ('up', 'heart', 'pin', 'wave', 'been', 'car'));

alter table message_reactions add column if not exists created_at timestamptz;
update message_reactions set created_at = to_timestamp(0) where created_at is null;
alter table message_reactions alter column created_at set default now();
alter table message_reactions alter column created_at set not null;

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice'));

alter table group_messages drop constraint if exists group_messages_kind_check;
alter table group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice'));
