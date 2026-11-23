-- Map and tracking choices (county color, overlays, ghost hours, and so on).
alter table profiles add column if not exists settings jsonb not null default '{}'::jsonb;

-- The fading ghost trail, kept for 24 hours when the account asks for it.
-- Saved trails stay in ghost_trails. This row is only the one still growing.
create table if not exists ghost_cache (
  user_id text primary key,
  points jsonb not null,
  updated_at timestamptz not null default now()
);

-- One trip can be the one currently recording places as you travel.
alter table trips add column if not exists recording boolean not null default false;
