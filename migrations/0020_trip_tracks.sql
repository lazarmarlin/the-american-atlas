-- Trip recaps and shared trips (src/lib/trips.ts, src/lib/trip-track.ts).
-- When a trip started and stopped recording, and the trip chat it's shared in.
alter table trips add column if not exists started_at timestamptz;
alter table trips add column if not exists ended_at timestamptz;
alter table trips add column if not exists group_id text;
create index if not exists trips_group on trips (group_id) where group_id is not null;

-- The route driven while a trip records, uploaded in chunks of [lon, lat, t] points.
create table if not exists trip_tracks (
  user_id text not null,
  trip_id text not null,
  seq bigserial,
  points jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, trip_id, seq)
);

-- A trip recap sent in a chat.
alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check check (kind in ('text', 'link', 'photo', 'place', 'trip'));
alter table group_messages drop constraint if exists group_messages_kind_check;
alter table group_messages add constraint group_messages_kind_check check (kind in ('text', 'link', 'photo', 'place', 'trip'));
