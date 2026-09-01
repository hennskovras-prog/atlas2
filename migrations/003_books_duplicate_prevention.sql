-- Atlas 2 — dublet-forebyggelse for bøger.
--
-- Baggrund: Christian spurgte, hvordan streaming-tracker-appen ("Serier &
-- film") forhindrer, at samme serie/film bliver tilføjet to gange, og bad om
-- samme beskyttelse i Atlas 2 for bøger. Streaming-appens mønster er en
-- UNIQUE-constraint på den eksterne id-kolonne (samme princip som
-- records.discogs_release_id her i Atlas 2, se 001_init.sql) — databasen er
-- den sidste, ufejlbarlige spærre, uanset hvilken klient der skriver.
--
-- Bøger har to "eksterne id'er" fra søgningen (Open Library-nøgle og ISBN),
-- så begge sikres, men KUN når de faktisk er udfyldt — mange ældre/manuelt
-- indtastede bøger i biblioteket har hverken, og skal fortsat kunne det
-- (en unique-constraint uden "where" ville ellers kun tillade ÉN bog uden
-- ISBN i hele biblioteket, hvilket giver ingen mening).
--
-- ISBN normaliseres (mellemrum/bindestreger fjernet) i indekset, så
-- "978-87-11-...", "978 87 11 ..." og "9788711..." regnes som samme bog —
-- ellers ville en manuelt indtastet ISBN med bindestreger snige sig forbi en
-- allerede gemt bog med den samme ISBN uden bindestreger (præcis den slags
-- små formatforskelle Open Library/Google Books-svar ikke altid er ens om).
-- Samme normalisering bruges klient-side i public/index.html (findDuplicateBook)
-- til at advare FØR man overhovedet forsøger at gemme.

create unique index if not exists books_isbn_unique_idx
  on books (regexp_replace(isbn, '[^0-9Xx]', '', 'g'))
  where isbn is not null and trim(isbn) <> '';

create unique index if not exists books_openlibrary_key_unique_idx
  on books (openlibrary_key)
  where openlibrary_key is not null and trim(openlibrary_key) <> '';
