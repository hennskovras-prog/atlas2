-- Atlas 2 — testdata/startbeholdning for albumserier (Tintin + Far Side).
-- Køres i Supabase SQL Editor EFTER 004_album_series.sql.
--
-- Tintin-covers: rigtige DANSKE forsider (Carlsen Comics' "Tintins
-- Oplevelser"-genudgivelse), fundet af Christian selv på Faraos.dk
-- (antikvarisk boghandel) og hentet herfra:
-- https://www.faraos.dk/antikvarisk/albums/tintin-herge/tintinsoplevelser
-- Faraos' egen "Nr."-mærkning på den side er IKKE Christians 0-22
-- (Hergés kronologiske udgivelsesorden) — det er butikkens egen,
-- ikke-kronologiske genudgivelsesnummerering (fx ligger "Den mystiske
-- stjerne" som deres nr. 1, selvom den er nr. 9 i kronologisk orden), og den
-- inkluderer også to album uden for de 23 herunder: en ikke-kanonisk
-- filmatisering ("Tintin og Hajsøen") og det ufuldendte 24. album ("Tintin
-- og Alfabet-kunsten"/"Tintin og Alfa-kunsten"). Covers herunder er derfor
-- matchet på HISTORIE (hvilken fortælling det rent faktisk er), ikke på
-- Faraos' butiksnummer — Christians egen nummerering (0-22) er uændret.
--
-- Far Side-covers: uændret fra Open Library (Christian har ikke bedt om
-- danske covers her — "Far Side Gallery"-bøgerne er ikke udgivet på dansk).
--
-- Som altid: 'cover_data' (eget upload) vises FØR 'cover_url' i appen, så
-- Christian til enhver tid kan erstatte et forslag med et foto af sin egen
-- fysiske bog.

insert into album_series (series, number, title, author, year, cover_url) values
  ('tintin', 0, 'Tintin i Sovjetunionen', 'Hergé', 1930, 'https://images.faraos.dk/ItemImages/9876543177438G/medium/9876543177438G.jpg'),
  ('tintin', 1, 'Tintin i Congo', 'Hergé', 1931, 'https://images.faraos.dk/ItemImages/9876543180667G/medium/9876543180667G.jpg'),
  ('tintin', 2, 'Tintin i Amerika', 'Hergé', 1932, 'https://images.faraos.dk/ItemImages/9876543180315G/medium/9876543180315G.jpg'),
  ('tintin', 3, 'Faraos cigarer', 'Hergé', 1934, 'https://images.faraos.dk/ItemImages/9876543178084G/medium/9876543178084G.jpg'),
  ('tintin', 4, 'Den Blå Lotus', 'Hergé', 1936, 'https://images.faraos.dk/ItemImages/9876543180544G/medium/9876543180544G.jpg'),
  ('tintin', 5, 'Det knuste øre', 'Hergé', 1937, 'https://images.faraos.dk/ItemImages/9876543180162G/medium/9876543180162G.jpg'),
  ('tintin', 6, 'Den sorte ø', 'Hergé', 1938, 'https://images.faraos.dk/ItemImages/9876543179692G/medium/9876543179692G.jpg'),
  ('tintin', 7, 'Kong Ottokars scepter', 'Hergé', 1939, 'https://images.faraos.dk/ItemImages/9876543177629G/medium/9876543177629G.jpg'),
  ('tintin', 8, 'Krabben med de gyldne klosakse', 'Hergé', 1941, 'https://images.faraos.dk/ItemImages/9876543180018G/medium/9876543180018G.jpg'),
  ('tintin', 9, 'Den mystiske stjerne', 'Hergé', 1942, 'https://images.faraos.dk/ItemImages/9876543177445G/medium/9876543177445G.jpg'),
  ('tintin', 10, 'Enhjørningens hemmelighed', 'Hergé', 1943, 'https://images.faraos.dk/ItemImages/9876543179050G/medium/9876543179050G.jpg'),
  ('tintin', 11, 'Rackham den Rødes skat', 'Hergé', 1944, 'https://images.faraos.dk/ItemImages/9876543179227G/medium/9876543179227G.jpg'),
  ('tintin', 12, 'De syv krystalkugler', 'Hergé', 1948, 'https://images.faraos.dk/ItemImages/9876543177780G/medium/9876543177780G.jpg'),
  ('tintin', 13, 'Soltemplet', 'Hergé', 1949, 'https://images.faraos.dk/ItemImages/9876543177933G/medium/9876543177933G.jpg'),
  ('tintin', 14, 'Landet med det sorte guld', 'Hergé', 1950, 'https://images.faraos.dk/ItemImages/9876543178244G/medium/9876543178244G.jpg'),
  ('tintin', 15, 'Mission til Månen', 'Hergé', 1953, 'https://images.faraos.dk/ItemImages/9876543178404G/medium/9876543178404G.jpg'),
  ('tintin', 16, 'De første skridt på Månen', 'Hergé', 1954, 'https://images.faraos.dk/ItemImages/9876543178565G/medium/9876543178565G.jpg'),
  ('tintin', 17, 'Tournesolmysteriet', 'Hergé', 1956, 'https://images.faraos.dk/ItemImages/9876543178909G/medium/9876543178909G.jpg'),
  ('tintin', 18, 'Koks i lasten', 'Hergé', 1958, 'https://images.faraos.dk/ItemImages/9876543179388G/medium/9876543179388G.jpg'),
  ('tintin', 19, 'Tintin i Tibet', 'Hergé', 1960, 'https://images.faraos.dk/ItemImages/9876543178732G/medium/9876543178732G.jpg'),
  ('tintin', 20, 'Castafiores juveler', 'Hergé', 1963, 'https://images.faraos.dk/ItemImages/9876543179531G/medium/9876543179531G.jpg'),
  ('tintin', 21, 'Rute 714 til Sydney', 'Hergé', 1968, 'https://images.faraos.dk/ItemImages/9876543179869G/medium/9876543179869G.jpg'),
  ('tintin', 22, 'Tintin og Picaroerne', 'Hergé', 1976, 'https://images.faraos.dk/ItemImages/9876543180766G/medium/9876543180766G.jpg'),
  ('farside', 0, 'The Prehistory of The Far Side', 'Gary Larson', 1989, 'https://covers.openlibrary.org/b/id/10079431-M.jpg'),
  ('farside', 1, 'Far Side Gallery Nr. 1', 'Gary Larson', 1984, 'https://covers.openlibrary.org/b/id/10624906-M.jpg'),
  ('farside', 2, 'Far Side Gallery Nr. 2', 'Gary Larson', 1986, 'https://covers.openlibrary.org/b/id/13011110-M.jpg'),
  ('farside', 3, 'Far Side Gallery Nr. 3', 'Gary Larson', 1988, 'https://covers.openlibrary.org/b/id/13011112-M.jpg'),
  ('farside', 4, 'Far Side Gallery Nr. 4', 'Gary Larson', 1993, 'https://covers.openlibrary.org/b/id/12725786-M.jpg'),
  ('farside', 5, 'Far Side Gallery Nr. 5', 'Gary Larson', 1995, 'https://covers.openlibrary.org/b/id/636024-M.jpg');
