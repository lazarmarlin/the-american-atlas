create table if not exists marks (
  user_id text not null,
  poi_id text not null,
  name text not null,
  category text not null,
  state text not null default '',
  lat double precision,
  lon double precision,
  points integer not null default 0,
  sys text not null default '',
  geom text,
  created_at timestamptz not null default now(),
  primary key (user_id, poi_id)
);

create index if not exists marks_user_idx on marks (user_id);
