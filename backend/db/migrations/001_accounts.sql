-- Accounts, the phones they use, and sessions.
-- Times that the rules depend on are always written by the API from now(user).
-- sessions.created_at is the only default now(), and no rule reads it.

create table users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique check (email = lower(email)),
  password_hash   text not null,
  is_test         boolean not null default false,      -- only the seeder sets this
  dev_offset_ms   bigint not null default 0 check (dev_offset_ms >= 0),
  settled_through date not null,                       -- every day up to here is final
  created_at      timestamptz not null
);

-- The home time zone, as a list. The zone for a day is the last row with from_day <= day.
create table user_timezones (
  user_id      uuid not null references users on delete cascade,
  from_day     date not null,
  tz           text not null,
  requested_at timestamptz,                            -- null for the zone set at sign up
  primary key (user_id, from_day)
);

-- A phone. The id is made once by the app at install. Contact is per phone, per account.
create table devices (
  user_id         uuid not null references users on delete cascade,
  device_id       uuid not null,
  last_contact_at timestamptz,
  primary key (user_id, device_id)
);

-- Only a hash of the token is stored. Log out deletes the row.
create table sessions (
  token_hash bytea primary key,
  user_id    uuid not null,
  device_id  uuid not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, device_id) references devices on delete cascade
);
create index sessions_user_idx on sessions (user_id);
