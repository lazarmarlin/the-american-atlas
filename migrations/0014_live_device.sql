-- Which device sent the live trail, so stopping tracking on one device only
-- clears the trail if that device sent it (src/lib/live-share.ts).
alter table live_trails add column if not exists device_id text not null default '';
