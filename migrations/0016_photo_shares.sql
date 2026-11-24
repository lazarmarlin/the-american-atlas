-- A photo shared with chosen friends instead of all of them (src/lib/photos.ts).
-- photos.shared = true still means every friend can see it.
create table if not exists photo_shares (
  user_id text not null,
  photo_id text not null,
  friend_id text not null,
  primary key (user_id, photo_id, friend_id)
);
create index if not exists photo_shares_friend on photo_shares (friend_id);
