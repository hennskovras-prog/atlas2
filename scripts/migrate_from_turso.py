#!/usr/bin/env python3
"""
migrate_from_turso.py — eksporterer ALLE fem tabeller fra jeres RIGTIGE
Atlas 1-database (Turso/libSQL) til JSON-filer, som Atlas 2 kan importere.

Denne fil kan IKKE køres i denne session — den kræver jeres rigtige
TURSO_DATABASE_URL og TURSO_AUTH_TOKEN, som ikke er delt her (med god grund:
det er jeres produktions-secrets). Kør den lokalt, hvor I har adgang til
Atlas 1's .env-fil.

FØR du kører dette script:
  1. Tag en fuld backup af databasen, uafhængigt af dette script:
       turso db shell <db-navn> .dump > atlas1_backup_$(date +%Y%m%d).sql
  2. Bekræft at backuppen er læsbar/ikke-tom, før du går videre.

Brug:
  uv run python scripts/migrate_from_turso.py
  (kræver: pip install libsql-client python-dotenv, eller uv add samme)

Output:
  data/atlas1_export.json  — {"books": [...], "jumbo_books": [...], "records": [...],
                               "comic_years": [...], "trips": [...]}

Herefter, i Atlas 2:
  node scripts/import_json.js data/atlas1_export.json
  (importerer i første omgang kun "books" — de øvrige fire ligger klar i
  JSON-filen til når UI'et for dem bygges, jf. ARCHITECTURE.md §7)
"""

import json
import os
import sys
from pathlib import Path

try:
    import libsql_client
except ImportError:
    print("Mangler 'libsql-client'. Kør: pip install libsql-client python-dotenv", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # .env er valgfri, hvis env-vars allerede er sat i shellen

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

if not TURSO_DATABASE_URL or not TURSO_AUTH_TOKEN:
    print(
        "TURSO_DATABASE_URL og/eller TURSO_AUTH_TOKEN mangler.\n"
        "Sæt dem i en .env-fil i denne mappe, eller i miljøet, før du kører scriptet.",
        file=sys.stderr,
    )
    sys.exit(1)

# Samme rewrite som Atlas 1's database.py: libsql:// -> https:// (wss:// gav
# forbindelsesfejl i Atlas 1's udvikling, jf. ATLAS_1_HANDOVER.md §5.1).
url = TURSO_DATABASE_URL.replace("libsql://", "https://")

client = libsql_client.create_client_sync(url=url, auth_token=TURSO_AUTH_TOKEN)

# Kolonnenavne holdt i eksplicit rækkefølge, IKKE "SELECT *", for at undgå
# den positional-index-fragilitet ATLAS_1_HANDOVER.md §14 selv advarer om.
TABLES = {
    "books": [
        "id", "title", "author", "year", "isbn", "cover_id", "openlibrary_key",
        "cover_data", "source", "needs_review", "verified", "notes", "rating",
    ],
    "jumbo_books": ["id", "title", "number", "cover_data"],
    "comic_years": ["id", "year", "cover_data"],
    "records": ["id", "title", "artist", "year", "discogs_release_id", "cover_url"],
    "trips": [
        "id", "destination", "city", "country", "start_date", "end_date",
        "duration_days", "companions", "notes", "confidence", "cover_data",
    ],
}

export = {}
for table, columns in TABLES.items():
    col_list = ", ".join(columns)
    try:
        result = client.execute(f"SELECT {col_list} FROM {table}")
    except Exception as exc:  # tabel findes evt. ikke, eller andet skema-drift
        print(f"Advarsel: kunne ikke læse '{table}' ({exc}) — springer over.", file=sys.stderr)
        export[table] = []
        continue
    rows = []
    for row in result.rows:
        record = {col: row[i] for i, col in enumerate(columns)}
        # needs_review/verified er 0/1 i SQLite — bevar som heltal her;
        # import_json.js normaliserer selv til boolean ved skrivning.
        rows.append(record)
    export[table] = rows
    print(f"{table}: {len(rows)} rækker")

out_dir = Path(__file__).resolve().parent.parent / "data"
out_dir.mkdir(exist_ok=True)
out_path = out_dir / "atlas1_export.json"
out_path.write_text(json.dumps(export, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"\nSkrev eksport til {out_path}")
print("Næste skridt: node scripts/import_json.js data/atlas1_export.json")
