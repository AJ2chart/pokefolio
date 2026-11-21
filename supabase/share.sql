-- Gleamvault: public wishlist links.
-- Paste into Supabase → SQL Editor → Run (once). Safe to run again.
-- One row per user who shares their wishlist. The owner reads/writes their own row;
-- visitors can only read ONE row, by its secret token, through the function below (no listing possible).

create table if not exists public.shared_wishlists (
  token       text primary key default replace(gen_random_uuid()::text, '-', ''),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  data        jsonb not null default '[]'::jsonb,
  show_prices boolean not null default false,
  updated_at  timestamptz not null default now(),
  constraint shared_wishlists_size check (pg_column_size(data) < 500000)
);

alter table public.shared_wishlists enable row level security;

drop policy if exists "share_select_own" on public.shared_wishlists;
drop policy if exists "share_insert_own" on public.shared_wishlists;
drop policy if exists "share_update_own" on public.shared_wishlists;
drop policy if exists "share_delete_own" on public.shared_wishlists;

create policy "share_select_own" on public.shared_wishlists
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "share_insert_own" on public.shared_wishlists
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "share_update_own" on public.shared_wishlists
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "share_delete_own" on public.shared_wishlists
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.shared_wishlists from anon;
grant select, insert, update, delete on public.shared_wishlists to authenticated;

-- read one shared wishlist by its token (prices removed when the owner hides them)
create or replace function public.get_shared_wishlist(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cards', case when s.show_prices then s.data
                  else (select coalesce(jsonb_agg(c - 'v'), '[]'::jsonb) from jsonb_array_elements(s.data) c) end,
    'prices', s.show_prices,
    'updated', s.updated_at)
  from public.shared_wishlists s
  where s.token = p_token and length(p_token) >= 24;
$$;

revoke all on function public.get_shared_wishlist(text) from public;
grant execute on function public.get_shared_wishlist(text) to anon, authenticated;
