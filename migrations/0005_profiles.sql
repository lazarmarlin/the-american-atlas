create table if not exists profiles (
  user_id text primary key,
  name text not null default '',
  photo text not null default '',
  updated_at timestamptz not null default now()
);
