-- Stops detected from GPS while tracking: somewhere you stayed 10+ minutes
-- (src/lib/stop-detect.ts, src/lib/stops.ts).
create table if not exists stops (
  user_id text not null,
  id text not null,
  lat double precision not null,
  lon double precision not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  label text not null default '',
  state text not null default '',
  poi_id text,
  primary key (user_id, id)
);

create index if not exists stops_user_time_idx on stops (user_id, started_at desc);
