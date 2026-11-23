-- Pictures attached to a place. Private until shared. The thumbnail is what the
-- map and the gallery list use; the larger image is only loaded when opened.
create table if not exists photos (
  user_id text not null,
  id text not null,
  poi_id text not null,
  trip_id text,
  caption text not null default '',
  taken_at bigint,
  lat double precision,
  lon double precision,
  shared boolean not null default false,
  thumb text not null,
  image text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists photos_user_idx on photos (user_id, created_at desc);
