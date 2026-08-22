-- ── AcademAI · push notifications ────────────────────────────────────────
-- Safe to run on a fresh project or on one that already has the base schema.
-- Re-running it does nothing.

create extension if not exists pgcrypto;

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

-- One row per notification actually sent. The primary key IS the guarantee
-- that nothing is ever sent twice, even if the worker runs twice at once.
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

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'push_subscriptions' and policyname = 'own subs select') then
    create policy "own subs select" on public.push_subscriptions for select using (auth.uid() = user_id);
    create policy "own subs insert" on public.push_subscriptions for insert with check (auth.uid() = user_id);
    create policy "own subs update" on public.push_subscriptions for update using (auth.uid() = user_id);
    create policy "own subs delete" on public.push_subscriptions for delete using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'push_log' and policyname = 'own log select') then
    create policy "own log select" on public.push_log for select using (auth.uid() = user_id);
  end if;
end $$;

-- Housekeeping: the log only needs to remember far enough back to dedupe.
-- Run this whenever you feel like it; nothing breaks if you never do.
-- delete from public.push_log where sent_at < now() - interval '60 days';
