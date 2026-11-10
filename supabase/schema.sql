-- Upcoming TV Shows — account sync schema.
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query). Idempotent.

create table if not exists public.preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security: a signed-in user can only see and change their own row.
alter table public.preferences enable row level security;

drop policy if exists "own row select" on public.preferences;
drop policy if exists "own row insert" on public.preferences;
drop policy if exists "own row update" on public.preferences;
drop policy if exists "own row delete" on public.preferences;
create policy "own row select" on public.preferences for select using (auth.uid() = user_id);
create policy "own row insert" on public.preferences for insert with check (auth.uid() = user_id);
create policy "own row update" on public.preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own row delete" on public.preferences for delete using (auth.uid() = user_id);

-- "Delete my account": removes the auth user (preferences cascade). Callable only by the
-- signed-in user, on their own account.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
