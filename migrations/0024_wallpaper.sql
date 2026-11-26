-- A chat wallpaper. `shared` means the other person (or the group) sees it too.
create table if not exists chat_wallpapers (
  owner_id text not null,
  thread text not null,
  image text not null,
  filter text not null default 'none',
  shared boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, thread)
);
