-- One-time codes for the native app's system-browser sign-in
-- (src/lib/auth/native.server.ts). Each row lives for about two minutes and is
-- deleted when the app redeems it.
create table if not exists native_auth_codes (
  code text primary key,
  challenge text not null,
  token text not null,
  expires_at timestamptz not null
);

create index if not exists native_auth_codes_expires_idx on native_auth_codes (expires_at);
