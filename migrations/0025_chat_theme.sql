-- A shared bubble-color pair. `shared` means the other person sees it too.
create table if not exists chat_themes (
  owner_id text not null,
  thread text not null,
  mine text not null default '',
  theirs text not null default '',
  mine_fade int not null default 100,
  their_fade int not null default 100,
  shared boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, thread)
);
