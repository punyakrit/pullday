-- pullday card catalogue (postgres)
-- money is stored as integer cents (usd). never use floats for money.

create table cards (
  id             text primary key,          -- e.g. 'c_0001'
  game           text not null check (game in ('pokemon', 'onepiece')),
  set_name       text not null,
  card_name      text not null,
  card_number    text,
  year           int,
  variety        text,                      -- e.g. 'holo', 'reverse holo', 'alt art'; null when plain
  grader         text not null,             -- e.g. 'PSA'
  cert_number    text not null unique,      -- grading slab number (test data)
  grade          numeric(3,1) not null,     -- 1.0 to 10.0, half grades allowed
  rarity         text not null check (rarity in ('common', 'rare', 'holo')),
  price_cents    int not null check (price_cents > 0),
  population     int not null check (population >= 0),  -- how many copies exist at this grade
  story          text not null,
  image_url      text not null,             -- photo of the graded slab
  price_history  jsonb not null             -- [{"date":"2026-08-05","price_cents":12345}, ...] weekly, oldest first
);

create index cards_game_set_idx on cards (game, set_name);
create index cards_rarity_idx on cards (rarity);
