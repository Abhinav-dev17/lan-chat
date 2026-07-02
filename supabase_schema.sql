-- Run this once in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run

create table if not exists users (
  username text primary key,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public_messages (
  id bigserial primary key,
  username text not null,
  text text not null,
  time text not null,
  created_at timestamptz not null default now()
);

create table if not exists dms (
  id bigserial primary key,
  user_a text not null,
  user_b text not null,
  from_user text not null,
  text text not null,
  time text not null,
  created_at timestamptz not null default now()
);
create index if not exists dms_pair_idx on dms (user_a, user_b);

create table if not exists rooms (
  id text primary key,
  name text not null,
  members text[] not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists room_messages (
  id bigserial primary key,
  room_id text not null references rooms(id),
  from_user text not null,
  text text not null,
  time text not null,
  created_at timestamptz not null default now()
);
create index if not exists room_messages_room_idx on room_messages (room_id);

-- Row Level Security: the server uses the "service role" key, which bypasses
-- RLS entirely and does all access checks itself. Enabling RLS with no
-- policies just means the anon/public key (if ever leaked) can't read anything.
alter table users enable row level security;
alter table public_messages enable row level security;
alter table dms enable row level security;
alter table rooms enable row level security;
alter table room_messages enable row level security;
