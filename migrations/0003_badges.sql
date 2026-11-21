create table if not exists earned_badges (
  user_id text not null,
  badge_id text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create index if not exists earned_badges_user_idx on earned_badges (user_id);
