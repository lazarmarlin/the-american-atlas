-- City squares cards point inside the game's area: deck holds, for each "go
-- to" card, the places of its kinds inside the area ([id, name, lat, lon]),
-- worked out when the game starts. Only cards with somewhere to go are
-- dealt. A card is done when tracking takes you to one of its places (one
-- you've been to before counts; in one game each place does one card):
-- square_cards.place is the place that did it.
alter table square_games add column if not exists deck jsonb;
alter table square_cards add column if not exists place text;
