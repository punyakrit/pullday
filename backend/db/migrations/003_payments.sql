-- Paying to win a streak back. One row, and one PaymentIntent, for each break.
-- started_at and closes_at are in the user's time. created_at is real time, for the sweep.

create table win_back_payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users on delete cascade,
  missed_day    date not null,                         -- the break. Its row can go if a late day fixes it
  amount_cents  int not null check (amount_cents > 0),
  started_at    timestamptz not null,                  -- inside the 48 hours, or there is no row
  closes_at     timestamptz not null,                  -- when the 48 hours end
  created_at    timestamptz not null default now(),
  intent_id     text unique,
  state         text not null default 'open' check (state in ('open', 'paid', 'canceled')),
  honoured_days date[],                                -- the days it filled in. Null until then
  refund_due_at timestamptz,
  refund_reason text check (refund_reason in ('not_needed', 'fixed_late')),
  refund_id     text,
  refunded_at   timestamptz,
  unique (user_id, missed_day),
  check (state = 'paid' or (honoured_days is null and refund_due_at is null))
);
create index win_back_payments_open on win_back_payments (created_at) where state = 'open' or (refund_due_at is not null and refunded_at is null);
