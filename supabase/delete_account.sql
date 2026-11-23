-- Gleamvault: lets a signed-in person delete their own account (and everything stored with it) from the app.
-- Paste into Supabase → SQL Editor → Run (once). Safe to run again.
-- The function only ever deletes the account of the person calling it (auth.uid()); nobody else can be targeted.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from public.shared_wishlists where user_id = me;
  delete from public.user_data where user_id = me;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
