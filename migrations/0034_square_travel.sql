-- How the game is played: on foot (walking or running, up to 12 mph), by bike
-- (up to 25 mph) or by car (any speed). Faster stretches don't count.
alter table square_games add column if not exists travel text not null default 'car';
