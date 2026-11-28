-- City squares (src/lib/city-squares.ts): Hard mode, the game's everyday places
-- from OpenStreetMap (looked up once when it starts), and grid cards' squares.

alter table square_games add column if not exists hard boolean not null default false;
-- [[osm id, kind, name, lat, lon], ...]; null until looked up. spots_at: when it was last tried.
alter table square_games add column if not exists spots jsonb;
alter table square_games add column if not exists spots_at timestamptz;
-- A grid card's squares when dealt (the corner, the middle, the far side…): [square, ...].
alter table square_cards add column if not exists squares jsonb;
