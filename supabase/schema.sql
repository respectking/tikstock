-- ===========================================================================
-- StockOrNot — accounts and saved carts
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste
-- -> Run. It is safe to run more than once.
--
-- The row-level security policies below are not optional. The anon key shipped
-- in the browser can reach this table, and without these policies it could
-- reach EVERY row in it. With them, Postgres itself compares auth.uid() to the
-- row's user_id on every single operation, so one person physically cannot
-- read or write another person's cart — not through a bug in the app, not by
-- crafting their own request with the key from the page source.
-- ===========================================================================

create table if not exists public.carts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  items      jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.carts is
  'One row per person. items holds the whole cart: [{t, n, sector, addedAt, priceAtAdd, note}]';

alter table public.carts enable row level security;

-- Postgres has no "create policy if not exists", so drop first to stay re-runnable.
drop policy if exists "read own cart"   on public.carts;
drop policy if exists "create own cart" on public.carts;
drop policy if exists "update own cart" on public.carts;
drop policy if exists "delete own cart" on public.carts;

create policy "read own cart"   on public.carts for select using (auth.uid() = user_id);
create policy "create own cart" on public.carts for insert with check (auth.uid() = user_id);
create policy "update own cart" on public.carts for update using (auth.uid() = user_id)
                                                       with check (auth.uid() = user_id);
create policy "delete own cart" on public.carts for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Check it worked. This should return rowsecurity = true and four policies.
-- ---------------------------------------------------------------------------
-- select relname, relrowsecurity from pg_class where relname = 'carts';
-- select policyname, cmd from pg_policies where tablename = 'carts';

-- ===========================================================================
-- Subscriptions
--
-- One row per person, written only by the payment provider's webhook using the
-- service_role key on the server. The browser can read its own row and nothing
-- else, and cannot write at all: if a visitor could set status='active' the
-- paywall would be decoration.
-- ===========================================================================

create table if not exists public.subscriptions (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  status              text        not null default 'none',
  plan                text,
  provider_customer   text,
  current_period_end  timestamptz,
  updated_at          timestamptz not null default now()
);

comment on column public.subscriptions.status is
  'none | trialing | active | past_due | canceled. Only trialing and active grant access.';

alter table public.subscriptions enable row level security;

drop policy if exists "read own subscription" on public.subscriptions;

-- Read only, and only your own. No insert, update or delete policy exists for
-- ordinary users, so those operations are refused for everyone except the
-- service_role key, which bypasses RLS and lives only on the server.
create policy "read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- ---------------------------------------------------------------------------
-- Check: rowsecurity true, exactly one policy, and it is a SELECT policy.
-- ---------------------------------------------------------------------------
-- select relname, relrowsecurity from pg_class where relname = 'subscriptions';
-- select policyname, cmd from pg_policies where tablename = 'subscriptions';
