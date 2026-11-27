-- Wake-on-view for live locations (src/lib/live-share.ts pingLive).
-- watched_until: someone is looking at this person's location until then, so
-- their phone posts every fix (and /api/track answers "X-Atlas-Live: 1").
-- pinged_at: when their phone was last woken for a fresh fix (at most once a minute).
create table if not exists live_watch (
  user_id text primary key,
  watched_until timestamptz not null default now(),
  pinged_at timestamptz
);
