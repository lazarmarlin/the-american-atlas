alter table profiles add column if not exists marker_icon text not null default 'dot';
alter table profiles add column if not exists marker_color text not null default '#3d8fd4';
