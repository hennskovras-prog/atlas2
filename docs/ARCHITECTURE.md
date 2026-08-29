# Atlas 2 — arkitektur

**Status: v2 — browser → Supabase/PostgREST → Postgres. Ingen applikationsserver.**

Denne fil er opdateret efter en kritisk gennemgang af den oprindelige MVP (v1, Node + SQLite). Konklusionen på den gennemgang var, at Node-laget løste et problem i *byggesessionen* (ingen adgang til et rigtigt Supabase-projekt eller Docker), ikke et reelt behov i Atlas selv. v2 retter det: Atlas 2 følger nu samme grundarkitektur som streaming-tracker-appen, punkt for punkt. Den oprindelige v1-vurdering er bevaret nederst i denne fil (§8) som historik.

---

## 1. Teknisk stack (v2)

| Lag | Valg |
|---|---|
| Frontend | Vanilla HTML/CSS/JavaScript, én fil (`public/index.html`), intet build-step |
| Data-adgang | Direkte `fetch()` mod Supabase's auto-genererede REST-API (PostgREST) — ingen egen backend |
| Database | Supabase Postgres |
| Auth | Supabase Auth (e-mail + kodeord), håndhævet af Row Level Security i Postgres |
| Ekstern data | Open Library, direkte browser-fetch; automatisk fallback til én Supabase Edge Function ved CORS-problemer. Discogs, KUN via Edge Function (se §10 — her er behovet ikke CORS, men at skjule en rigtig hemmelighed) |
| Hosting | Frontend: Netlify (eller enhver statisk fil-hosting). Backend: Supabase (managed) |

**Ingen applikationsserver, ingen SQLite i produktion.** Det tidligere Node-lag ligger i `legacy-node-sqlite/` udelukkende som reference og bruges ikke af appen.

---

## 2. Projektstruktur

```
atlas2/
├── public/
│   └── index.html                 # hele frontend-appen — HTML+CSS+JS, taler direkte til Supabase
├── supabase/
│   └── functions/
│       ├── openlibrary-proxy/
│       │   └── index.ts           # Edge Function: fallback for Open Library hvis CORS blokerer direkte fetch
│       └── discogs-sync/
│           └── index.ts           # Edge Function: holder DISCOGS_TOKEN skjult, henter+normaliserer pladesamlingen
├── migrations/
│   ├── 001_init.sql               # Postgres-skema + RLS-policies — køres i Supabase SQL Editor
│   └── SCHEMA_MAPPING.md          # felt-for-felt mapping Atlas 1 → Atlas 2
├── scripts/
│   └── migrate_from_turso.py      # kører DU lokalt med jeres rigtige Turso-nøgler: eksporterer Atlas 1-data til JSON
├── data/
│   ├── seed_books.json            # testdata (samme 24 opdigtede bøger som i v1-sessionen)
│   └── seed_books.sql             # samme testdata som færdige INSERT-statements til Supabase SQL Editor
├── docs/
│   ├── ARCHITECTURE.md            # denne fil
│   └── RUNNING.md                 # opsætning, kørsel, deploy, videre migrering
├── legacy-node-sqlite/            # IKKE brugt af appen — kun reference, se legacy-node-sqlite/README.md
└── README.md
```

Ingen `package.json` i roden længere — der er intet at installere eller bygge. `public/index.html` er hele appen.

---

## 3. Database / persistence

Supabase Postgres, tilgået direkte fra klienten via PostgREST. Skemaet (`migrations/001_init.sql`) er en 1:1-oversættelse af Atlas 1's `books`-tabel, se `SCHEMA_MAPPING.md`. De fire øvrige Atlas 1-tabeller (`jumbo_books`, `comic_years`, `records`, `trips`) er scaffoldet med samme RLS-mønster, men uden UI endnu — kun bøger er i scope for denne MVP.

**Listevisningens ydelse** (den samme bekymring som fik Atlas 1 til at bygge `get_books_index()`/`get_book_covers()`) løses nu ved PostgREST's `select=`-parameter i stedet for custom kode:

```
GET /rest/v1/books?select=id,title,author,year,...&order=id.desc     ← uden cover_data
GET /rest/v1/books?select=id,cover_data&id=in.(4,7,12)               ← kun covers for synlige rækker
```

**Partial update** — kritisk for at undgå Atlas 1's kendte fejl (at en generisk update kunne nulstille `cover_data`) — er PostgREST's standardopførsel: en `PATCH` sætter kun de kolonner, der faktisk er i body. Dette er verificeret direkte mod en ægte Postgres-instans under udvikling (se §6) og igen via en fuld browser-baseret test: opret bog med cover → tryk kun "Tjekket" (sender `{verified: true}`) → coveret var stadig intakt.

---

## 4. Auth og Row Level Security

Model: **alle kan læse, kun en logget-ind bruger kan skrive.** Håndhævet af Postgres selv (RLS), ikke af applikationskode — kan ikke omgås ved at ramme et andet endpoint.

```sql
create policy "books_public_read" on books for select to anon, authenticated using (true);
create policy "books_authenticated_write" on books for all to authenticated using (true) with check (true);
```

Login sker via Supabase Auth's e-mail+kodeord-flow (rå `fetch()` mod `/auth/v1/token`, ingen SDK — samme "ingen npm-pakker i browseren"-princip som streaming-appen). Du opretter din egen bruger i Supabase Dashboard → Authentication → Users → Add user.

**Overvejet, men ikke valgt: kræv login for at se biblioteket overhovedet.**

| | Offentlig læsning (valgt) | Login for alt |
|---|---|---|
| Fordele | Du kan dele et link med familie uden at de skal have en konto. Matcher Atlas 1's eksisterende, bevidste "public/private split" (håndoveret §12). | Simplere RLS (kun én policy). Ingen data synlig for nogen udefra, selv ved et lækket link. |
| Ulemper | Bogtitler/covers er synlige for enhver med URL'en (ikke søgbart/indekseret, men ikke adgangskontrolleret). | Skal logge ind selv for at kigge på egen boghylde på egen telefon — friktion for et rent personligt brugsmønster. Familie kan ikke længere bare "kigge". |

Da du selv beskrev Atlas som noget der skal føles som "et personligt digitalt bibliotek", og Atlas 1 allerede bevidst valgte offentlig visning, holder v2 den samme model. Skift er én linje SQL, hvis du ombestemmer dig (fjern `anon` fra `books_public_read`-policyen).

**Strammere variant** (kommenteret ind i `001_init.sql`): begræns skrivning til ét bestemt `auth.uid()` i stedet for "enhver logget-ind bruger" — relevant hvis I nogensinde opretter en ekstra Auth-bruger, der kun må se, ikke redigere.

---

## 5. Covers: base64-i-DB vs. Supabase Storage

**Valgt for nu: behold base64-i-DB** (som Atlas 1), for at holde denne omlægning til ét ændret lag ad gangen, som bedt om.

Kort vurdering af alternativet: Supabase Storage (rigtig objekt-storage, browser kan uploade direkte via samme apikey/RLS-mønster) er den bedre langsigtede løsning, *hvis* biblioteket vokser væsentligt — den undgår at Postgres-rækker bliver unødigt store, og undgår `records`-tabellens nuværende problem (ekstern, ikke-selv-hostet Discogs-URL uden fallback). Men for ~300 bøger, hvor `select=`-parameteren allerede løser performance-problemet Atlas 1 havde, er gevinsten ved at skifte nu marginal, og det ville ændre både skema og upload-flow samtidig med denne arkitekturomlægning. Anbefaling: revisit når/hvis I bygger `records`-UI'en (som allerede har det eksterne-URL-problem, der reelt kræver en løsning).

---

## 6. Testet, ikke kun antaget

Da hverken denne sandkasse eller (givetvis) dens netværksadgang kan nå et rigtigt Supabase-projekt (supabase.co er ikke på den tilladte netværksliste herfra), er v2 valideret på to niveauer, begge mod **ægte Postgres**, ikke en simuleret erstatning:

1. **RLS testet direkte i Postgres** via rolleskift (`SET ROLE anon` / `SET ROLE authenticated`) — bekræftet: anon kan læse men ikke skrive, authenticated kan begge dele, og en `UPDATE ... SET verified = true` rører aldrig `cover_data`.
2. **Hele frontend'en testet end-to-end** (Playwright, 17 automatiserede tjek dækkende hele testlisten i opgaven) mod den samme Postgres-instans, via et minimalt test-only HTTP-lag der taler PostgREST's og Supabase Auth's kontrakt. Dette lag er **ikke** en del af leverancen — det findes kun for at kunne bevise frontend-koden virker, før du selv peger den mod dit rigtige projekt.

Det, jeg **ikke** har kunnet teste: et faktisk HTTP-kald til jeres rigtige Supabase-projekt, og Open Library's reelle CORS-opførsel (denne sandkasses netværk blokerer begge). Se `docs/RUNNING.md` for den smoke-test, du selv bør køre først.

---

## 7. Risici

- **Test mod rigtigt Supabase-projekt er ikke udført af mig** — kun mod en lokal, ægte Postgres-instans med identisk skema/RLS. Kør smoke-testen i `docs/RUNNING.md`, når dit projekt er oprettet.
- **Open Library CORS er ikke bekræftet.** Koden forsøger direkte fetch først; hvis det fejler i praksis, er Edge Function-fallbacken allerede skrevet og klar til `supabase functions deploy`.
- **Reel Atlas 1-data er migreret** (301 bøger, 16 Jumbo-bøger, 5 tegneserie-år, 22 plader, 13 rejser — se §9 for hvordan og hvad der blev fundet undervejs).
- **Refresh-token-håndtering er minimal** (rå fetch, ingen SDK) — testet for det almindelige forløb (login, log ud, RLS-håndhævelse), men ikke for kant-tilfælde som udløbet refresh-token efter lang inaktivitet. Hvis det bliver et problem i praksis, er næste skridt at logge brugeren pænt ud og bede om login igen (koden gør allerede dette ved en mislykket refresh).
- **`cover_data` som base64 fortsætter** — se §5. Revisit ved skalering eller ved `records`-UI.

---

## 8. Historik: hvorfor v1 blev lavet om

Den oprindelige MVP (denne sessions første version) brugte en Node-server + lokal SQLite, fordi denne sandkasse ikke kunne oprette et rigtigt Supabase-projekt eller køre Docker. En efterfølgende kritisk gennemgang (spurgt direkte: "hvorfor introducerede du en Node-backend?") konkluderede, at intet i Atlas selv krævede det:

- Den ønskede "offentlig læsning / gated skrivning" er PostgREST + RLS + Supabase Auth's kernefunktion, ikke noget der kræver egen serverkode.
- Cover-håndtering (base64) er en almindelig Postgres-kolonne, uanset hvilket lag der sidder foran.
- Open Library-behovet for evt. CORS-håndtering løses af én Edge Function — samme princip streaming-appen selv bruger (kun tilføj server-kode ved et konkret, snævert behov).

v1's Node/SQLite-kode ligger bevaret i `legacy-node-sqlite/` som reference, men er ikke en del af den anbefalede eller leverede produktionsarkitektur.

---

## 9. Historik: migrering af de rigtige Atlas 1-data

Udført efter arkitekturen var testet og godkendt med testdata. Kort version af forløbet, for eftertiden:

1. **Eksport fra Turso var blokeret** fra denne sessions sky-sandkasse (netværks-allowlist tillader ikke `*.turso.io`). Løst ved at køre selve eksporten fra Christians linkede computer i stedet (`device_bash`), som HAR adgang til den specifikke database-host — men ikke til Turso's generelle domæner eller til Supabase, så det er ikke en generel netværksomgåelse, kun denne ene host.
2. **`libsql_client` (Python) kunne ikke bruges der** — det respekterer ikke maskinens proxy-miljøvariabler, så DNS-opslag fejlede. Løst ved at kalde Turso's HTTP-API (`/v2/pipeline`, samme protokol som `sqld`/Hrana bruger) direkte med `curl`, som proxy-miljøet allerede er sat op til at håndtere.
3. **Alle 5 tabeller blev hentet i ét hug hver** (ikke i småbidder) og talte præcis: 301 bøger, 16 Jumbo-bøger, 5 tegneserie-år, 22 plader, 13 rejser — identisk med Atlas 1-håndoverets kendte tal. Data blev skrevet direkte til Christians eget Downloads-mappe, aldrig gennem chatten.
4. **Værktøjet `tools/migrate_real_data.html`** (ikke en del af selve appen) blev bygget til selve importen: en statisk side, samme "browser taler direkte med Supabase"-princip som resten af Atlas 2, hvor Christian logger ind, vælger de 5 eksporterede JSON-filer, og trykker importér — resten (ryd testdata, batch-indsæt, verificér) sker automatisk i browseren.
5. **Testet fuldt igennem lokalt FØR Christian rørte noget rigtigt**: hele værktøjet blev kørt mod en ægte lokal Postgres-kopi med de faktiske eksporterede data (ikke opdigtet testdata), via samme test-only HTTP-shim-teknik som resten af projektet (se §6). Det fangede en reel fejl: skemaets `id`-kolonner var sat til `GENERATED ALWAYS AS IDENTITY`, hvilket forhindrer PostgREST i at indsætte bøgernes oprindelige id'er — ville være stoppet halvvejs i den rigtige import. Rettet til `GENERATED BY DEFAULT AS IDENTITY` (`migrations/002_pre_real_data_import.sql`), som stadig auto-genererer id for nye rækker, men tillader eksplicitte værdier ved import.
6. **Sekvens-kollision efter import** var en tilsvarende fundet-og-rettet risiko: efter at indsætte rækker med eksplicitte id'er "ved" auto-increment-tælleren det ikke selv, så den næste bog oprettet uden eksplicit id ville kunne kollidere med et lige importeret id. Løst med en lille `reset_all_sequences()`-funktion (samme migrationsfil), kaldt automatisk som sidste skridt i importværktøjet.
7. **Resultat, verificeret ende-til-ende** (både lokalt og af Christian mod det rigtige projekt): alle 5 tabeller matcher de forventede antal rækker, cover-data er byte-for-byte identisk med kildematerialet (inkl. den største, ~6,8 MB), og `needs_review`/`verified`-tællingerne matcher kildedataen.

---

## 10. Jumbo-bøger og Plader (UI tilføjet efter bøger)

**Jumbo-bøger** følger `booksApi`-mønsteret, men forenklet: kun 16 rækker, så ingen to-vejs cover-indlæsning, ingen søgning, ingen paginering — fast sorteret efter `number`, som i Atlas 1. Redigering sker direkte fra kortet (`jumboApi`, `jumbo-form-backdrop`), en bevidst modernisering af Atlas 1's dropdown-admin-panel (se ATLAS_1_HANDOVER.md §"Jumbo-bøger" — beskrevet der som et "inconsistent pattern").

**Plader** tilføjes UDELUKKENDE via Discogs-sync (ingen manuel "opret plade", som i Atlas 1). To ting er værd at fremhæve:

- **`recordsApi.upsertFromDiscogs`** bruger PostgREST's native upsert (`POST /records?on_conflict=discogs_release_id` + `Prefer: resolution=merge-duplicates`) — en ægte `INSERT ... ON CONFLICT DO UPDATE`, som udnytter `discogs_release_id`'s UNIQUE-constraint. Atlas 1 gjorde det manuelt (et `SELECT`-tjek før insert/update, se håndoveret §12 — "the only column-level UNIQUE constraint in the schema is not actually relied on here"). Samme resultat (idempotent, sikker at genkøre), men databasen gør arbejdet i stedet for applikationskode.
- **DISCOGS_TOKEN er en RIGTIG hemmelighed** — i modsætning til `SUPABASE_ANON_KEY`, som er sikker at have i klientkode (den er begrænset af RLS). Et Discogs personal token giver adgang til Christians Discogs-konto og må aldrig stå i `index.html`. Løsningen er Edge Function'en `discogs-sync`: den holder token'et som et Supabase-secret (`DISCOGS_TOKEN`, sat via `supabase secrets set` eller Dashboardet, aldrig i noget fil i dette repo), henter og normaliserer hele samlingen server-side, og returnerer kun de rensede pladedata til browseren. Selve databaseskrivningen sker stadig fra klienten med Christians egen indlogning — funktionen har derfor ikke selv brug for en `service_role`-nøgle.

**Testet lokalt** (samme metode som hele projektet): en mock af `discogs-sync`'s output blev sat op i test-shimmen, og hele synk-flowet (opret nye, opdatér eksisterende, genkør uden dubletter, manuel redigering, sletning) blev kørt mod den ægte lokale Postgres-kopi med de rigtige 22 plader, inkl. regression på bog- og Jumbo-fanerne. Det, der IKKE er testet herfra, er selve netværkskaldet til Discogs (samme begrænsning som Open Library og Supabase — sandkassen kan ikke nå `api.discogs.com`), samt Deno-runtimen selv (kun den rene transformationslogik er smoke-testet i Node). Christian bør derfor bekræfte selv, første gang, at synkroniseringen rent faktisk henter fra hans konto.
