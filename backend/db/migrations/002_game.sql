-- One challenge per user per day. The reward is reserved when it is issued.
create table challenges (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users on delete cascade,
  day            date not null,
  card_ids       text[] not null check (cardinality(card_ids) = 8),
  reward_card_id text references cards,                -- null when the user owns every card
  started_at     timestamptz,                          -- when the server heard the start
  completed_at   timestamptz,
  answers        text[] check (cardinality(answers) = 8),
  unique (user_id, day),
  check ((completed_at is null) = (answers is null))
);

-- When each phone first got a challenge.
create table bundle_issues (
  challenge_id uuid not null references challenges on delete cascade,
  device_id    uuid not null,
  issued_at    timestamptz not null,
  primary key (challenge_id, device_id)
);

create table collection (
  user_id        uuid not null references users on delete cascade,
  card_id        text not null references cards,
  acquired_at    timestamptz not null,
  challenge_id   uuid unique references challenges on delete cascade,   -- null for dev grants and seeds
  reveal_seen_at timestamptz,
  primary key (user_id, card_id)
);

create table freezes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users on delete cascade,
  purchased_at  timestamptz not null,
  used_on_day   date,
  refund_due_at timestamptz,                           -- given back while already holding 2
  unique (user_id, used_on_day),
  check (used_on_day is null or refund_due_at is null)
);

-- The streak is read from these rows. A missed day has no row.
create table day_records (
  user_id uuid not null references users on delete cascade,
  day     date not null,
  status  text not null check (status in ('done', 'frozen', 'won_back')),
  primary key (user_id, day)
);

create table streak_breaks (
  user_id     uuid not null references users on delete cascade,
  missed_day  date not null,
  broke_at    timestamptz not null,                    -- the end of the missed day
  won_back_at timestamptz,
  primary key (user_id, missed_day)
);

-- Seeded for collector@pullday.test. No endpoints yet.
create table binder_slots (
  user_id uuid not null,
  page    int not null check (page >= 1),
  slot    int not null check (slot between 1 and 9),
  card_id text not null,
  primary key (user_id, page, slot),
  unique (user_id, card_id),
  foreign key (user_id, card_id) references collection on delete cascade   -- only owned cards
);
