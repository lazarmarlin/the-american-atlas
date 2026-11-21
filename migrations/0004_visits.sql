alter table marks add column if not exists visited_on date;
alter table marks add column if not exists note text not null default '';
alter table marks add column if not exists photo text not null default '';

create table if not exists trips (
  user_id text not null,
  id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists trip_stops (
  user_id text not null,
  trip_id text not null,
  poi_id text not null,
  pos integer not null,
  primary key (user_id, trip_id, poi_id)
);

create index if not exists trip_stops_user_idx on trip_stops (user_id, trip_id);
