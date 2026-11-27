-- City squares modifier cards (src/lib/square-cards.ts): now and then a new
-- square deals a card, and until it's done that player collects no squares.
-- base: the count the card is measured against (visits to places of its
-- kinds, photos, or counties) when it was dealt.
alter table square_games add column if not exists cards boolean not null default false;
create table if not exists square_cards (
  board_id text not null,
  user_id text not null,
  card text not null,
  dealt_at timestamptz not null default now(),
  done_at timestamptz,
  base integer not null default 0,
  swapped boolean not null default false,
  primary key (board_id, user_id, dealt_at)
);
