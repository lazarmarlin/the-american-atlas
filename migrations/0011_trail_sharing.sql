-- Sharing a saved ghost trail with friends is its own choice, separate from
-- hiding it on your own map. Every existing trail starts private.
alter table ghost_trails add column if not exists shared boolean not null default false;

-- Daily miles from tracking (src/lib/drive-log.ts). Each device reports its own
-- running total for a day, so a retried upload never double counts.
create table if not exists drive_days (
  user_id text not null,
  device_id text not null,
  day date not null,
  miles double precision not null,
  primary key (user_id, device_id, day)
);
