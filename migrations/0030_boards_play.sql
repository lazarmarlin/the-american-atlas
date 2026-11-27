-- Board categories bring more kinds: camp meals, pre-trip checklist,
-- postcards, trip budget, fuel log, trip journal, best of the trip, and the
-- travel games (license plates, bingo, alphabet race, cow count, chain
-- spotting, state line guess, name that county, state trivia). And "Where am
-- I?" in a chat: a hidden spot friends guess. src/lib/boards.ts.

alter table boards drop constraint if exists boards_kind_check;
alter table boards add constraint boards_kind_check check (kind in (
  'todo', 'pack', 'trip', 'wish', 'car', 'split',
  'meals', 'check', 'postcards', 'budget', 'fuel', 'journal', 'bestof',
  'plates', 'bingo', 'alpha', 'cows', 'chains', 'guess', 'county', 'trivia'
));

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board', 'poll', 'where'));

alter table group_messages drop constraint if exists group_messages_kind_check;
alter table group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'link', 'photo', 'place', 'trip', 'trail', 'here', 'day', 'voice', 'board', 'poll', 'where'));

create table if not exists where_guesses (
  message_id text not null,
  user_id text not null,
  state text not null,
  miles integer not null,
  guessed_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
