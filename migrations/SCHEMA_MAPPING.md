# Skema-mapping: Atlas 1 (Turso/libSQL) → Atlas 2 (Supabase/Postgres)

Princip: genbrug struktur direkte, ingen omdøbning, ingen datatab. Kun typer der er reelt forskellige mellem SQLite og Postgres er ændret. (Den tidligere "Atlas 2 lokal SQLite"-mellemstation, fra v1-MVP'en, er udgået — se `legacy-node-sqlite/` — og er ikke med i denne tabel længere.)

## `books`

| Atlas 1 (Turso/SQLite) | Atlas 2 (Postgres/Supabase) | Note |
|---|---|---|
| `id` INTEGER PK AUTOINCREMENT | `id` BIGINT GENERATED ALWAYS AS IDENTITY PK | Samme værdier bevares 1:1 ved import (eksplicit `id` i INSERT). |
| `title` TEXT NOT NULL | `title` TEXT NOT NULL | |
| `author` TEXT NOT NULL (kan være `''`) | `author` TEXT NOT NULL DEFAULT '' | Tom streng bevares som tom streng, ikke NULL — se Atlas 1-handover §14. |
| `year` INTEGER, nullable | `year` INTEGER | Ingen CHECK-constraint tilføjet endnu (bevidst, jf. "byg ikke mere end nødvendigt nu"). |
| `isbn` TEXT, nullable | `isbn` TEXT | |
| `cover_id` INTEGER | `cover_id` BIGINT | Open Library cover-id. |
| `openlibrary_key` TEXT | `openlibrary_key` TEXT | |
| `cover_data` TEXT (base64 data-URI) | `cover_data` TEXT | Se ARCHITECTURE.md §5 om Supabase Storage som fremtidigt alternativ. |
| `source` TEXT | `source` TEXT | Fri-tekst provenance, bevares ordret. |
| `needs_review` INTEGER 0/1 | `needs_review` BOOLEAN DEFAULT false | 0→false, 1→true ved import. |
| `verified` INTEGER 0/1 | `verified` BOOLEAN DEFAULT false | 0→false, 1→true ved import. |
| `notes` TEXT | `notes` TEXT | |
| `rating` TEXT (😐/🙂/😍/NULL) | `rating` TEXT | Bevidst *ikke* låst til enum endnu — Atlas 1 har heller ingen DB-constraint her. |

Ekstra kolonner tilføjet i Atlas 2 (ikke i Atlas 1, additive, bryder intet):
- `created_at` / `updated_at` (timestamp) — fandtes ikke i Atlas 1, men er nyttige fremadrettet og skader intet at tilføje nu (nullable/med default, ingen eksisterende kode afhænger af deres fravær).

## `jumbo_books`, `records`, `comic_years`, `trips`

Disse fire tabeller er **scaffoldet i skemaet** (så ingen data går tabt, hvis/når de migreres), men får **ingen UI i denne MVP** — kun bøger er i scope nu, som bedt om. Feltmapping for dem er 1:1 identisk med Atlas 1-handoverets §5.2 og vil blive dokumenteret i en opdateret version af denne fil, når de tages i brug.

## Fremtidig krydsgående udvidelse (ikke bygget nu)

For features der skal gælde på tværs af kulturtyper (tags, favoritter, anbefalinger) foreslås **én** ekstra tabel, i stedet for en pr. kulturtype:

```sql
-- FREMTIDIG, ikke oprettet endnu:
CREATE TABLE item_tags (
  item_type TEXT NOT NULL,   -- 'book' | 'record' | 'film' | ...
  item_id   INTEGER NOT NULL,
  tag       TEXT NOT NULL,
  PRIMARY KEY (item_type, item_id, tag)
);
CREATE TABLE favorites (
  item_type TEXT NOT NULL,
  item_id   INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id)
);
```

Dette undgår at skulle tilføje `is_favorite`/`tags`-kolonner til fem forskellige tabeller enkeltvis, og kræver ingen fremmednøgle (polymorf reference via `item_type`+`item_id`, ligesom Atlas 1 i forvejen ikke bruger fremmednøgler nogen steder).
