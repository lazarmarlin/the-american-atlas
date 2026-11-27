-- City squares: a city cut into squares (map tiles at one zoom), filled in by
-- visiting them. src/lib/city-squares.ts, src/lib/city-grid.ts.

alter table boards drop constraint if exists boards_kind_check;
alter table boards add constraint boards_kind_check check (kind in (
  'todo', 'pack', 'trip', 'wish', 'car', 'split',
  'meals', 'check', 'postcards', 'budget', 'fuel', 'journal', 'bestof',
  'plates', 'bingo', 'alpha', 'cows', 'chains', 'guess', 'county', 'trivia',
  'squares'
));

-- One game per board: the city, the square size (zoom), together or a race,
-- and the grid (box of tiles + a bit mask of the city's squares, base64).
create table if not exists square_games (
  board_id text primary key,
  geoid text not null,
  city text not null,
  state text not null,
  zoom smallint not null,
  mode text not null check (mode in ('together', 'race')),
  x0 integer not null,
  y0 integer not null,
  w integer not null,
  h integer not null,
  mask text not null,
  total integer not null,
  started_at timestamptz not null default now()
);

-- Squares each player visited (how = 'visit') or skipped ('skip': nobody can
-- get in). In a race a square is whoever's got there first (earliest at).
create table if not exists square_visits (
  board_id text not null,
  user_id text not null,
  square integer not null,
  at timestamptz not null,
  how text not null default 'visit' check (how in ('visit', 'skip')),
  primary key (board_id, user_id, square)
);
create index if not exists square_visits_board on square_visits (board_id, square);
