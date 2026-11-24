-- Texts between two friends. A photo here is not a place photo: it stays in the
-- chat until someone chooses Add to map (src/lib/messages.ts).
create table if not exists messages (
  id text primary key,
  from_id text not null,
  to_id text not null,
  kind text not null,
  body text not null default '',
  thumb text,
  image text,
  created_at timestamptz not null default now(),
  check (kind in ('text', 'link', 'photo')),
  check (from_id <> to_id)
);

create index if not exists messages_from_idx on messages (from_id, created_at desc);
create index if not exists messages_to_idx on messages (to_id, created_at desc);
