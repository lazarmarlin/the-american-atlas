-- City squares: pausing a game (any player can pause it, any player can carry
-- on). While it's paused tracking adds no squares, for anyone. ended_at null:
-- paused now. src/lib/city-squares.ts.
create table if not exists square_pauses (
  board_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  by_user text not null,
  primary key (board_id, started_at)
);

-- A game can be a city, a state park or a national park (outlines from
-- public/atlas/overlays/parks.geojson; geoid is then the park's id).
alter table square_games add column if not exists place_kind text not null default 'city';
alter table square_games alter column geoid type text;
