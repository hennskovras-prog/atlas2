-- Atlas 2 — Rejser: cachet forsidebillede til rejsekortene i Oversigt.
--
-- Christian bad om et lille billede på rejsekortene, hentet fra
-- google_photos_url (se google-photos-thumbnail Edge Function). Billed-
-- URL'en cachés her i stedet for at blive hentet ved hvert sidevisning —
-- billigere, hurtigere, og albummets forsidebillede skifter i praksis
-- aldrig for en allerede afsluttet/planlagt rejse. Frontend genforsøger
-- selv (uden ekstra kolonne til at spore forsøg) — se kommentaren ved
-- ensureTripThumbnail() i public/index.html.

alter table trips add column if not exists google_photos_thumbnail_url text;
