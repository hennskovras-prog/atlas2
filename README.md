# Atlas 2

Personligt digitalt kulturbibliotek. MVP: bøger. Efterfølger til Atlas 1 (Streamlit/Turso), bygget efter samme grundarkitektur som streaming-tracker-appen "Serier & film": browser → Supabase/PostgREST → Postgres, ingen applikationsserver.

- **Opsætning og kørsel:** `docs/RUNNING.md`
- **Arkitektur, RLS-model og risici:** `docs/ARCHITECTURE.md`
- **Feltmapping Atlas 1 → Atlas 2:** `migrations/SCHEMA_MAPPING.md`

Hurtig start:

1. Opret et Supabase-projekt, kør `migrations/001_init.sql` og `data/seed_books.sql` i SQL Editor.
2. Udfyld `SUPABASE_URL`/`SUPABASE_ANON_KEY` øverst i `public/index.html`.
3. Åbn `public/index.html` i browseren.

Se `docs/RUNNING.md` for alle detaljer, inkl. login-opsætning og Open Library-fallback.

`legacy-node-sqlite/` er den oprindelige MVP (Node + SQLite) fra før arkitekturomlægningen — ikke en del af den kørende app, kun bevaret som reference.

`tools/migrate_real_data.html` er engangsværktøjet, der blev brugt til at importere de rigtige Atlas 1-data fra Turso — ikke en del af den kørende app, se `docs/ARCHITECTURE.md` §9.
