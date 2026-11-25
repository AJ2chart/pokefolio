-- Price notifications (to run once in Supabase → SQL Editor → Run; can be run again safely).
-- push_subs: one line per device that turned notifications on (its push address + keys, the « good deals » threshold, language).
-- push_state: cards already notified (once per crossing), and the last test sent. push_runs: last daily run + sending keys.
create table if not exists public.push_subs (
  endpoint   text primary key check (endpoint like 'https://%' and length(endpoint) < 1000),
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null check (length(p256dh) between 60 and 120),
  auth       text not null check (length(auth) between 16 and 40),
  deal_pct   int  not null default 5 check (deal_pct between 5 and 25),
  lang       text not null default 'fr' check (lang in ('fr', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);
create table if not exists public.push_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  notified   jsonb not null default '{}'::jsonb,
  test_at    timestamptz,
  updated_at timestamptz not null default now()
);
-- push_runs also holds the sending keys (VAPID), made by the function itself on its first run: server only, nobody handles them
create table if not exists public.push_runs (id int primary key check (id = 1), last_run timestamptz, vapid_pub text, vapid_priv text);
alter table public.push_runs add column if not exists vapid_pub text;
alter table public.push_runs add column if not exists vapid_priv text;

alter table public.push_subs  enable row level security;
alter table public.push_state enable row level security;
alter table public.push_runs  enable row level security;
-- each person sees and removes only their own devices; push_state and push_runs: server only (no policy = no access)
drop policy if exists "own devices: read" on public.push_subs;
create policy "own devices: read" on public.push_subs for select to authenticated using (user_id = auth.uid());
drop policy if exists "own devices: delete" on public.push_subs;
create policy "own devices: delete" on public.push_subs for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subs, public.push_state, public.push_runs from anon;
-- recent Supabase projects no longer give new tables to the server role by default: the daily function needs these
grant select, insert, update, delete on public.push_subs, public.push_state, public.push_runs to service_role;
grant select on public.user_data to service_role;
grant select, delete on public.push_subs to authenticated;

-- Saving a device goes through this function: it takes the device for the signed-in person (the push address is
-- a secret only that browser knows, so a phone that changes account simply moves to the new account).
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_deal_pct int, p_lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  insert into public.push_subs (endpoint, user_id, p256dh, auth, deal_pct, lang, updated_at)
  values (p_endpoint, me, p_p256dh, p_auth, greatest(5, least(25, coalesce(p_deal_pct, 5))), case when p_lang = 'en' then 'en' else 'fr' end, now())
  on conflict (endpoint) do update
    set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, deal_pct = excluded.deal_pct, lang = excluded.lang, updated_at = now();
  -- at most 10 devices per person: the oldest go
  delete from public.push_subs where user_id = me and endpoint in
    (select endpoint from public.push_subs where user_id = me order by updated_at desc offset 10);
end;
$$;
revoke all on function public.save_push_sub(text, text, text, int, text) from public, anon;
grant execute on function public.save_push_sub(text, text, text, int, text) to authenticated;
