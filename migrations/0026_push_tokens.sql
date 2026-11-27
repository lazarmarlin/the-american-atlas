-- Firebase Cloud Messaging tokens, one per phone. When a friend messages you
-- (or gives a thumbs-up) the server sends each of your phones a silent "poke";
-- the phone then asks /api/notify itself and shows the notification. No
-- message text goes through Google. src/lib/push.server.ts.
create table if not exists push_tokens (
  token text primary key,
  user_id text not null,
  device_id text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on push_tokens (user_id);
