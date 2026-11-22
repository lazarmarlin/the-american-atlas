-- Saved ghost trails (src/lib/ghost-sync.ts). The live, still-growing trail
-- stays on the device; only trails the user saves are stored here.
-- points is a JSON array of [lat, lon, t] or [lat, lon, t, 1] (1 = starts a new line).
create table if not exists ghost_trails (
  user_id text not null,
  id text not null,
  name text not null,
  started_at timestamptz not null,
  saved_at timestamptz not null,
  hidden boolean not null default false,
  points jsonb not null,
  primary key (user_id, id)
);
