alter table marks add column if not exists visits text not null default '[]';

alter table trip_stops add column if not exists stop_id text;
update trip_stops set stop_id = poi_id where stop_id is null or stop_id = '';
alter table trip_stops alter column stop_id set not null;
alter table trip_stops drop constraint if exists trip_stops_pkey;
alter table trip_stops add constraint trip_stops_pkey primary key (user_id, trip_id, stop_id);
