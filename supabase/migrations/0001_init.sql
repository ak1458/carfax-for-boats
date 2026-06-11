create type system_kind as enum ('engine','generator','other');
create type doc_type as enum ('receipt','engine_plate','hour_meter','other');
create type reminder_rule as enum ('calendar','hours');
create type reminder_status as enum ('active','done','dismissed');

create table boats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  make text, model text, year int, hin text,
  hero_photo_path text,
  created_at timestamptz not null default now()
);

create table systems (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind system_kind not null default 'engine',
  make text, model text, serial text,
  tracks_hours boolean not null default false,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  doc_type doc_type not null default 'other',
  extraction_json jsonb,
  extraction_model text,
  extraction_confidence float8 check (extraction_confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create table service_events (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  system_id uuid references systems(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  event_date date not null,
  vendor text, description text,
  cost_cents bigint, currency text not null default 'USD',
  engine_hours float8,
  parts jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table hour_readings (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references systems(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  hours float8 not null,
  reading_date date not null,
  document_id uuid references documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  system_id uuid references systems(id) on delete set null,
  title text not null,
  rule_type reminder_rule not null,
  interval_months int, interval_hours int,
  next_due_date date, next_due_hours float8,
  last_done_event_id uuid references service_events(id) on delete set null,
  status reminder_status not null default 'active',
  created_at timestamptz not null default now()
);

-- share_links are looked up ONLY via service role on the server (public share page).
-- There is intentionally no anon SELECT policy; never query this table with the anon key.
create table share_links (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references boats(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create index on systems(boat_id);
create index on documents(boat_id);
create index on service_events(boat_id, event_date desc);
create index on hour_readings(system_id, reading_date desc);
create index on reminders(boat_id, status);

-- RLS: owner-only on everything. Share page bypasses via service role.
alter table boats enable row level security;
alter table systems enable row level security;
alter table documents enable row level security;
alter table service_events enable row level security;
alter table hour_readings enable row level security;
alter table reminders enable row level security;
alter table share_links enable row level security;

create policy boats_owner on boats for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy systems_owner on systems for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy documents_owner on documents for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy service_events_owner on service_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy hour_readings_owner on hour_readings for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy reminders_owner on reminders for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy share_links_owner on share_links for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Private photo bucket; paths are {owner_id}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos','photos',false, 10485760, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

create policy photos_owner_rw on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
