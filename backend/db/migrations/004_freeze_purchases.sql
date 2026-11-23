-- Buying a streak freeze. The phone makes the id and saves it before anything starts, so a retry is the same
-- purchase. A row with no freeze was begun and never paid, which costs nothing.

create table freeze_purchases (
  id       uuid primary key,
  user_id  uuid not null references users on delete cascade,
  began_at timestamptz not null                        -- in the user's time. The freeze counts from here
);

alter table freezes
  add column purchase_id    uuid references freeze_purchases on delete cascade,   -- null for seeds
  add column transaction_id text unique,                                          -- the store's. One grant each
  add constraint freezes_bought check ((purchase_id is null) = (transaction_id is null));
