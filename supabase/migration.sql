-- AcademAI schema · run once on a fresh Supabase project
create extension if not exists pgcrypto;

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  start_date text not null,
  end_date text not null
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null references public.semesters(id) on delete cascade,
  date text not null,
  name text not null default ''
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid not null references public.semesters(id) on delete cascade,
  code text not null,
  name text not null default '',
  color text not null default '#7DF9FF',
  grading jsonb not null default '[]',
  target_pct numeric not null default 93,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  kind text not null default 'LEC',
  title text not null default '',
  location text not null default '',
  is_async boolean not null default false,
  days jsonb not null default '[]',
  start_time text not null default '',
  end_time text not null default '',
  interval int not null default 1,
  anchor_date text not null default '',
  start_date text not null default '',
  end_date text not null default '',
  skip_dates jsonb not null default '[]',
  extra_dates jsonb not null default '[]',
  leave_by_min int not null default 10
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  kind text not null default 'text',
  raw_text text not null default '',
  image_count int not null default 0,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  type text not null default 'task',
  title text not null,
  details text not null default '',
  due_at timestamptz,
  all_day boolean not null default true,
  at_home boolean not null default true,
  bucket text,
  weight_pct numeric,
  effort_min int not null default 0,
  status text not null default 'pending',
  ghost boolean not null default false,
  parent_id uuid references public.items(id) on delete cascade,
  start_suggested_at timestamptz,
  completed_at timestamptz,
  source_id uuid references public.sources(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  bucket text not null,
  earned numeric not null,
  possible numeric not null,
  note text not null default '',
  graded_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gemini_key text not null default '',
  gemini_model text not null default 'gemini-3.7-flash',
  ics_token text not null default '',
  sound_on boolean not null default true,
  free_min_weekday int not null default 240,
  free_min_weekend int not null default 420
);

-- Row-level security: every row belongs to its user
alter table public.semesters enable row level security;
alter table public.holidays enable row level security;
alter table public.classes enable row level security;
alter table public.components enable row level security;
alter table public.sources enable row level security;
alter table public.items enable row level security;
alter table public.scores enable row level security;
alter table public.user_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['semesters','holidays','classes','components','sources','items','scores'] loop
    execute format('create policy "own rows select" on public.%I for select using (auth.uid() = user_id)', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "own rows update" on public.%I for update using (auth.uid() = user_id)', t);
    execute format('create policy "own rows delete" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

create policy "own settings select" on public.user_settings for select using (auth.uid() = user_id);
create policy "own settings insert" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "own settings update" on public.user_settings for update using (auth.uid() = user_id);

create index items_user_due on public.items (user_id, due_at);
create index items_class on public.items (class_id);
create index components_class on public.components (class_id);
create index scores_class on public.scores (class_id);

-- ── Push notifications (also available standalone as migration-push.sql) ──
create table if not exists public.push_subscriptions (
  endpoint        text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  p256dh          text not null,
  auth            text not null,
  label           text not null default '',
  fail_count      int  not null default 0,
  last_success_at timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions(user_id);

create table if not exists public.push_log (
  user_id    uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, dedupe_key)
);
create index if not exists push_log_sent_at on public.push_log(sent_at);

alter table public.user_settings add column if not exists push_enabled boolean not null default true;
alter table public.user_settings add column if not exists push_last_run_at timestamptz;

alter table public.push_subscriptions enable row level security;
alter table public.push_log           enable row level security;

create policy "own subs select" on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "own subs insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "own subs update" on public.push_subscriptions for update using (auth.uid() = user_id);
create policy "own subs delete" on public.push_subscriptions for delete using (auth.uid() = user_id);
create policy "own log select"  on public.push_log           for select using (auth.uid() = user_id);
