-- Atlas 2 — GØR ALT PRIVAT: kun ejeren (den ene bruger i auth.users) kan læse
-- eller skrive. Erstatter modellen "alle kan læse, en logget-ind kan skrive".
--
-- Hvorfor: anon-nøglen står i sidens kildekode og er bevidst ikke hemmelig.
-- Med "public read"-policies kunne enhver med nøglen læse ALT (rejser,
-- Google Photos-albumlinks, noter, events). Og med "authenticated write" ville
-- enhver, der selv oprettede en bruger (hvis signup er slået til), kunne
-- skrive. Nu er adgangen bundet til ejerens bruger-id, ikke bare til rollen.
--
-- Ejerens id står IKKE i denne fil: is_owner() bygges ud fra den ene række i
-- auth.users, og migrationen afviser at køre, hvis der ikke er præcis én
-- bruger (så et uventet ekstra login aldrig bliver ejer ved et uheld).
--
-- Kør igen (idempotent) hvis ejeren skifter bruger.

-- 1) is_owner(): true kun for ejerens egen indloggede session.
do $$
declare
  n int;
  owner_id uuid;
begin
  select count(*) into n from auth.users;
  if n <> 1 then
    raise exception 'Forventede præcis 1 bruger i auth.users, fandt %', n;
  end if;
  select id into owner_id from auth.users;
  execute format(
    'create or replace function public.is_owner() returns boolean '
    'language sql stable as $f$ select auth.uid() = %L::uuid $f$',
    owner_id
  );
end
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- 2) Policies: én "owner"-policy pr. tabel, ingen anon-adgang overhovedet.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'books', 'jumbo_books', 'comic_years', 'records', 'album_series',
    'trips', 'trip_stops', 'trip_candidates', 'events', 'event_candidates'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    -- fjern ALLE eksisterende policies (public_read, authenticated_write, …)
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using ((select public.is_owner())) with check ((select public.is_owner()))',
      t || '_owner_all', t
    );
  end loop;
end
$$;

-- 3) Belt and braces: anon har heller ingen rettigheder (RLS er den egentlige
-- port, men der er ingen grund til at lade rettighederne stå åbne).
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- reset_all_sequences() og set_updated_at() skal stadig kunne bruges af en
-- logget-ind bruger / trigger (trigger-funktioner kræver ikke execute-ret).
grant execute on function public.reset_all_sequences() to authenticated;
grant execute on function public.is_owner() to authenticated;
