-- Atlas 2 — de første fire planlagte events, som Christian gav dem (oktober
-- 2026). Køres EFTER migrations/008_events.sql. Idempotent: en event med
-- samme titel og dato indsættes ikke to gange.
--
-- Bemærkning: "It's Actually Christmas" er noteret med Jans e-mailadresse i
-- kalenderen; den er bevidst IKKE kopieret hertil, da Atlas er offentligt
-- læsbart (RLS: public read) — kun "Jan (sandsynligvis)".

insert into events (title, event_type, event_date, start_time, end_time, venue, companions, ticket_count, notes, status, source)
select v.* from (values
  ('Jessie Ware',             'koncert', date '2026-11-18', time '18:30', time '22:30', 'Amager Bio',      'Søren',               null::integer, null::text, 'planned', 'manuel'),
  ('It''s Actually Christmas','koncert', date '2026-11-25', time '19:30', time '20:30', 'DR Koncerthuset', 'Jan (sandsynligvis)', null::integer, 'Sandsynligvis julekoncerten.', 'planned', 'manuel'),
  ('Artigeardit',             'koncert', date '2027-03-13', null::time,   null::time,   'Royal Arena',     'Søren',               null::integer, null::text, 'planned', 'manuel'),
  ('Erasure',                 'koncert', date '2027-05-26', time '20:00', null::time,   'Royal Arena',     null::text,            4,             null::text, 'planned', 'manuel')
) as v(title, event_type, event_date, start_time, end_time, venue, companions, ticket_count, notes, status, source)
where not exists (select 1 from events e where e.title = v.title and e.event_date = v.event_date);
