create or replace function public.arclayer_check_public_routines(names text[])
returns table (routine_name text)
language sql
security definer
set search_path = public, information_schema
as $$
  select r.routine_name::text
  from information_schema.routines r
  where r.routine_schema = 'public'
    and r.routine_name = any(names);
$$;

revoke all on function public.arclayer_check_public_routines(text[]) from public;
grant execute on function public.arclayer_check_public_routines(text[]) to service_role;
