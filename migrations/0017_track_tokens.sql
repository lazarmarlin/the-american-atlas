-- A per-device token for the phone's native location service, which posts
-- fixes to /api/track even when the app itself has been closed
-- (src/routes/api/track.ts, src/lib/track-token.ts). Only a hash is stored.
create table if not exists track_tokens (
  token_hash text primary key,
  user_id text not null,
  device_id text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists track_tokens_user on track_tokens (user_id);
