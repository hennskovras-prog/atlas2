# Atlas 2 — opsætning, kørsel og videreudvikling (v2: Supabase)

## 1. Opret Supabase-projektet

1. Opret et projekt på [supabase.com](https://supabase.com) (gratis tier er rigeligt til dette).
2. Gå til **SQL Editor** → New query → indsæt hele indholdet af `migrations/001_init.sql` → kør. Dette opretter skema, trigger for `updated_at`, og alle RLS-policies.
3. (Valgfrit, men anbefalet for at kunne teste med det samme) Kør også `data/seed_books.sql` i SQL Editor — indlæser 24 opdigtede testbøger. Ingen nøgler eller credentials skal deles for dette trin, det er ren SQL.
4. Gå til **Authentication → Users → Add user** og opret din egen bruger (e-mail + kodeord). Det er den bruger, du logger ind med i appen for at kunne redigere.
5. Gå til **Project Settings → API** og notér:
   - **Project URL** (fx `https://abcdefgh.supabase.co`)
   - **anon / public key** (IKKE `service_role`-nøglen — den må aldrig havne i frontend-koden)

## 2. Konfigurér frontend'en

Åbn `public/index.html`, find konfigurationsblokken øverst i `<script>`-taggen:

```js
const SUPABASE_URL = 'https://DIT-PROJEKT.supabase.co';
const SUPABASE_ANON_KEY = 'DIN-ANON-KEY-HER';
```

Udfyld med værdierne fra trin 1.5. Det er alt — der er intet build-step, ingen `.env`-fil, ingen `npm install`. `anon`-nøglen er designet til at stå i klientkode; den er begrænset af RLS, ikke en hemmelighed (samme princip som streaming-appens `SUPABASE_KEY`).

## 3. Kør appen lokalt

Appen er én statisk HTML-fil. Enten:

```bash
# Simplest: åbn filen direkte
open public/index.html          # macOS
# eller
xdg-open public/index.html      # Linux
```

...eller server den, hvis din browser er kræsen med `file://`-origin:

```bash
npx serve public
# eller
python3 -m http.server 8080 --directory public
```

Åbn siden, og bekræft at bøgerne fra `seed_books.sql` vises. Log ind med den bruger, du oprettede i trin 1.4, og bekræft at "+ Tilføj bog" nu virker.

**Smoke-test at køre selv, før du regner arkitekturen for færdig-verificeret:** denne sessions sandkasse kunne ikke nå `*.supabase.co` over netværket (kun pakkeregistre er tilladt derfra), så selvom hele frontend-logikken er testet grundigt mod en ægte lokal Postgres-instans med identiske RLS-policies (se `docs/ARCHITECTURE.md` §6), er den ikke afprøvet mod dit faktiske Supabase-projekt. Tjek mindst: liste vises, login virker, opret/redigér/slet virker, og at logout faktisk blokerer skrivning.

## 4. Open Library — CORS-fallback (kun hvis nødvendigt)

Prøv appen som den er først — den forsøger altid direkte browser-fetch mod Open Library. Hvis søgning i "Tilføj bog"-dialogen fejler med en netværksfejl (ikke "ingen resultater", men en decideret fejlbesked), er det sandsynligvis CORS. Løsning:

```bash
# Kræver Supabase CLI: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref <dit-projekt-ref>
supabase functions deploy openlibrary-proxy
```

Sæt derefter i `public/index.html`:

```js
const OPENLIBRARY_PROXY_URL = 'https://DIT-PROJEKT.supabase.co/functions/v1/openlibrary-proxy';
```

(Denne linje udfyldes faktisk automatisk, når `SUPABASE_URL` er sat korrekt — se koden — men kan overstyres eksplicit her.)

## 5. Lokal udvikling uden internet (valgfrit)

Hvis du vil udvikle offline eller uden at røre produktionsdata, kan du køre en lokal Supabase-stak via CLI'en (kræver Docker på din maskine):

```bash
supabase start          # kører lokal Postgres + PostgREST + Auth i Docker
supabase db reset       # kører migrations/001_init.sql mod den lokale instans
```

`supabase start` printer en lokal URL og anon-nøgle, du midlertidigt kan sætte i `index.html` under udvikling.

## 6. Migrering af de rigtige Atlas 1-data (udført)

De rigtige 301 bøger + de fire øvrige samlinger er migreret fra Turso. Sådan blev det gjort — nyttigt hvis I nogensinde skal gøre det igen (fx til et nyt Supabase-projekt):

1. **Eksport fra Turso.** `scripts/migrate_from_turso.py` (Python + `libsql-client`) virker, men kræver netværksadgang til `*.turso.io`, som ikke alle miljøer tillader. Alternativ, der altid virker: Turso's eget web-dashboard (turso.tech) → databasen → "Export Database" giver en komplet SQLite-fil (= selve backuppen). Eller kald Turso's HTTP-API direkte: `POST https://<db>.turso.io/v2/pipeline` med `{"requests":[{"type":"execute","stmt":{"sql":"SELECT * FROM <tabel>"}},{"type":"close"}]}` og `Authorization: Bearer <TURSO_AUTH_TOKEN>` — det er det samme, klienten gør under motorhjelmen, og er lettere at fejlfinde/proxy'e end SQLite-filen.
2. **Konvertér til ren JSON** pr. tabel (`id`→værdi-lister, typede celler fra Hrana-svaret slås om til almindelige JSON-værdier).
3. **Importér med `tools/migrate_real_data.html`** — et engangsværktøj (ikke en del af selve appen), som Christian åbner lokalt: logger ind, vælger de 5 eksporterede JSON-filer, og trykker importér. Rydder testdata og bulk-indsætter i batches direkte via PostgREST, med de oprindelige Turso-id'er bevaret. Kør `migrations/002_pre_real_data_import.sql` i SQL Editor FØRST — den retter id-kolonnerne til at acceptere eksplicitte værdier og tilføjer en lille funktion, værktøjet selv kalder til sidst for at rette auto-increment-tælleren.

Se `docs/ARCHITECTURE.md` §9 for den fulde historik (inkl. et par fejl, der blev fundet og rettet undervejs ved at teste lokalt først), og `migrations/SCHEMA_MAPPING.md` for felt-for-felt mapping.

## 7. Deploy til produktion (GitHub + Netlify, samme mønster som "Serier & film")

Projektet ligger nu som et lokalt git-repo i `~/Development/atlas2` med et første commit ("Initial import fra Cowork"). Modsat "Serier & film" (som deployes manuelt via Netlify CLI uden GitHub) er Atlas 2 sat op til **kontinuerlig deploy**: et `git push` udløser automatisk en ny Netlify-deploy. Sådan kobler du det sammen første gang:

### 7.1 Opret GitHub-repo

1. Gå til [github.com/new](https://github.com/new), opret et nyt, **tomt** repository (kald det fx `atlas2`) — **fravælg** "Add a README" og `.gitignore`, da repoet allerede har indhold.
2. I en terminal på din egen computer:
   ```bash
   cd ~/Development/atlas2
   git remote add origin https://github.com/<dit-brugernavn>/atlas2.git
   git push -u origin main
   ```
   (Brug `git@github.com:<dit-brugernavn>/atlas2.git` i stedet, hvis du har SSH-nøgler sat op til GitHub — begge virker, HTTPS beder bare om login i browseren første gang.)

### 7.2 Forbind til Netlify

1. Gå til [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**.
2. Vælg **GitHub**, godkend adgang hvis det er første gang, og vælg `atlas2`-repoet.
3. Under build-indstillinger: lad **Build command** stå tom (der er intet build-step) og sæt **Publish directory** til `public`.
4. Klik **Deploy site**. Efter et øjeblik får du en live-URL (samme mønster som `https://extraordinary-cactus-44673c.netlify.app/` for "Serier & film"). Du kan give sitet et pænere navn under **Site settings → Site details → Change site name**.

### 7.3 Fremtidige opdateringer

```bash
git add -A
git commit -m "besked om ændringen"
git push
```

Netlify bygger og deployer automatisk, hver gang du pusher til `main` — ingen manuelle deploy-kommandoer nødvendige fremover.

### Alternativ (uden GitHub)

Hvis du på et tidspunkt hellere vil deploye direkte fra terminalen uden GitHub (som "Serier & film" gør), virker det stadig fint:

```bash
npm install -g netlify-cli   # første gang
netlify login
netlify deploy --prod --dir public
```

Eller en hvilken som helst anden statisk hosting (Vercel, GitHub Pages, Cloudflare Pages) — `public/index.html` er hele appen, ingen build-kommando nødvendig.

## 8. Sådan udvides til film, ture, m.m.

Jumbo-bøger og Plader har nu UI (tilføjet efter bøger — se de to underafsnit nedenfor) og bruges som skabeloner for de næste. Skemaet for `comic_years` og `trips` findes allerede i `migrations/001_init.sql` med samme RLS-mønster — kun UI mangler. For at tilføje en ny collection:

1. Kopiér `jumboApi`-objektet i `public/index.html` (simplere skabelon end `booksApi` — ingen to-vejs cover-indlæsning, det er kun nødvendigt ved mange rækker som bøger), tilpas tabelnavn og feltliste.
2. Kopiér `jumboCardHTML`/`renderJumbo`/`openJumboForm`-logikken, tilpas feltnavnene.
3. Tilføj en `<button class="tab-btn" data-tab="...">`-fane og en tilsvarende `view-...`-container, og udvid `switchTab()` med den nye fane.

Hvis collectionen (som Plader) skal synkroniseres fra en ekstern tjeneste med sin egen adgangsnøgle, se Plader-afsnittet nedenfor for mønsteret med en Edge Function, der holder nøglen skjult server-side.

### Jumbo-bøger (tilføjet)

Egen fane, egen modal (`jumbo-form-backdrop`), redigering direkte fra kortet (moderniseret ift. Atlas 1's dropdown-admin-panel, se ATLAS_1_HANDOVER.md §"Jumbo-bøger"). Fast sorteret efter nummer, ingen søgning/paginering (kun 16 rækker). Testet fuldt ende-til-ende lokalt (liste, login-krav, opret med cover, redigér, slet, samt regression på bog-fanen) før levering.

Bemærk ved lokal test af nye tabeller: hvis I bygger en test-shim med `pg` (node-postgres) mod en lokal Postgres, husk at `pg` som standard returnerer `bigint`/`id`-kolonner som JS-strings (for at undgå præcisionstab) — men den ægte PostgREST returnerer dem som JSON-tal. Uden `types.setTypeParser(20, parseInt)` i test-shimmen ser alle `id === Number(...)`-sammenligninger ud til at fejle i testen, selvom appkoden er korrekt.

### Plader (Discogs-sync, tilføjet)

Egen fane ("Plader") med én "Synkronisér fra Discogs"-knap i stedet for manuel oprettelse — det matcher Atlas 1's logik, hvor plader kun kommer ind via Discogs-synkronisering, aldrig manuelt. Du kan stadig redigere titel/kunstner/år direkte fra kortet (samme moderniserede mønster som Jumbo-bøger), men ikke coveret, da det udelukkende kommer fra Discogs. Sorteret efter kunstner, så titel.

**Hvorfor der er en ny Edge Function (`discogs-sync`):** Din Discogs-adgangstoken er en ægte hemmelighed — i modsætning til Supabase's `anon`-nøgle må den aldrig stå i `index.html` eller noget andet sted i browserkoden, for den giver adgang til selve din Discogs-konto. Løsningen er en lille Supabase Edge Function (`supabase/functions/discogs-sync/index.ts`), der kører server-side, læser tokenet fra en Supabase-hemmelighed (`DISCOGS_TOKEN`), henter hele din Discogs-samling, og sender den tilbage til browseren i normaliseret form (titel/kunstner/år/cover/`discogs_release_id`). Selve databaseskrivningen sker stadig fra browseren med dit eget login (samme RLS som resten af appen) — der er ikke brug for en `service_role`-nøgle noget sted.

**Sådan sætter du det op (gør det kun én gang):**

1. **Sæt `DISCOGS_TOKEN` som secret.** Nemmeste vej: Supabase Dashboard → dit projekt → **Edge Functions** → **Manage secrets** (eller **Settings → Edge Functions**) → tilføj en ny secret med navnet `DISCOGS_TOKEN` og værdien = dit Discogs personal access token. Indsæt ALDRIG selve tokenet i en chat, en fil eller andet sted end lige præcis dette secret-felt.
2. **Deploy funktionen.** Nemmeste vej via Dashboard: **Edge Functions** → **Create a new function** → navngiv den `discogs-sync` → indsæt indholdet af `supabase/functions/discogs-sync/index.ts` → deploy. Alternativt via CLI, hvis du foretrækker det (kræver Docker + Supabase CLI, se §4/§5 ovenfor for samme mønster som `openlibrary-proxy`):
   ```bash
   supabase functions deploy discogs-sync
   supabase secrets set DISCOGS_TOKEN=<dit-token>   # kun hvis du ikke allerede satte den via Dashboard
   ```
3. **Opdatér `public/index.html`** med den nyeste version (se filen leveret sammen med denne opdatering) og læg den op, hvor du plejer (samme sted som i §7 Deploy).

**Testplan i dit eget miljø (vigtigt — Discogs-kaldet og selve Edge Function-runtimen er IKKE afprøvet fra udviklingsmiljøet her, kun logikken heri via lokale enhedstests):**

1. Åbn appen, skift til **Plader**-fanen, log ind.
2. Klik **"Synkronisér fra Discogs"**. Første gang bør alle dine rigtige plader fra Discogs dukke op (knappen viser "Synkroniserer…" imens, og du får en besked med antal nye/opdaterede).
3. Klik synkronisér igen med det samme — antallet af plader må IKKE stige (idempotent — samme plader opdateres bare, ingen dubletter).
4. Redigér en plade manuelt (fx ret et årstal) og bekræft at ændringen gemmes.
5. Slet en plade og bekræft beskeden om, at den kommer tilbage ved næste synkronisering, hvis den stadig er i din Discogs-samling.
6. Hvis synkronisering fejler med en fejlbesked om `DISCOGS_TOKEN`, er secret'en fra trin 1 ikke sat korrekt endnu.

### Anders And-årgange (tilføjet)

Egen fane ("Anders And"), samme mønster som Jumbo-bøger (år + valgfrit cover af første blad), men bygget direkte med detalje-visning-før-redigering (se næste afsnit) i stedet for at gå gennem det ældre direkte-redigér-mønster. Fast sorteret efter årgang, ingen søgning/paginering (kun 5 rækker i dag). `comic_years` var allerede scaffoldet i databasen med RLS, så ingen ny SQL var nødvendig.

### Detalje-visning før redigering (rettet for Jumbo-bøger og Plader)

Bøgerne har fra starten haft en detalje-modal (klik på et cover viser titel/forfatter/år/note osv. uden at kræve login — kun "Redigér"/"Slet"-knapperne i den kræver det). Jumbo-bøger og Plader fik ved en fejl IKKE denne detalje-visning, da de blev bygget — et klik gik direkte til redigeringsformularen, som starter med et login-tjek, så en besøgende (inkl. dig selv, hvis du ikke er logget ind på mobilen) fik en login-prompt i stedet for bare at kunne se, hvad kortet indeholdt. Rettet ved at give begge de samme delte detalje-modaler (`jumbo-detail-backdrop`, `record-detail-backdrop`) som bøgerne — klik viser nu altid info frit, med "Redigér"/"Slet" som separate, login-krævende handlinger inde i den visning.

### Mobilvisning: modal under skærmen (rettet)

Modaler (login, formularer, detaljer) blev tidligere positioneret med ren `vh`/`inset:0`. Nogle mobilbrowsere (observeret på Samsung Internet) regner `vh` ud fra den fulde layout-viewport frem for den faktisk synlige del af skærmen — særligt når adresselinjen er synlig eller tastaturet er åbent — så en bund-forankret modal kunne ende delvist eller helt under den synlige skærm. Rettet ved at holde en CSS-variabel `--app-vh` opdateret fra JS ud fra `window.visualViewport` (som følger den faktisk synlige højde, også når tastaturet åbner), og bruge den i stedet for `vh` i `.modal-backdrop`/`.modal`. Kunne ikke testes på en fysisk Samsung-enhed herfra — bekræft venligst at popuppen nu opfører sig korrekt på din telefon.

### Ikon til hjemmeskærm/faneblad (tilføjet)

`public/icons/` + `site.webmanifest` + `favicon.ico` giver appen et rigtigt ikon (et "A"-monogram i appens farver) i browserfanen og når den føjes til hjemmeskærmen på mobil ("Føj til startskærm" i browserens menu). Ingen opsætning nødvendig ud over at have filerne med i deploy'et (de ligger i `public/`, så de følger automatisk med Netlify-deploy'et).

For krydsgående features (favoritter, tags, anbefalinger) — se den foreslåede `item_tags`/`favorites`-tabel i `migrations/SCHEMA_MAPPING.md`.

## 9. Kendte begrænsninger

- Bøger, Jumbo-bøger, Anders And-årgange og Plader har UI. Kun `trips` er stadig scaffoldet uden UI.
- Open Library CORS er ikke bekræftet live (se §4/§6 i ARCHITECTURE.md) — test det først.
- Bogsøgning bruger nu Open Library + Google Books (tilføjet som ekstra kilde for bedre dækning af nyere danske bøger) — se ARCHITECTURE.md §12. Der findes ikke et åbent dansk bibliotek-alternativ (DBC's services er forbeholdt biblioteker). Google Books-kaldet er ikke testet mod den rigtige API fra denne sandkasse — bekræft i praksis at det giver resultater ved søgning.
- Discogs-synkronisering er ikke afprøvet mod den ægte Discogs-API og den ægte Edge Function-runtime (Deno) — kun logikken er enhedstestet, og hele flowet er testet ende-til-ende mod en lokal Postgres med et mock-svar. Følg testplanen i §8 første gang, du kører det for rigtigt.
- Mobilvisnings-rettelsen (se §8) er testet i en headless browser i mobilstørrelse, ikke på en fysisk Samsung-enhed — bekræft gerne i praksis.
- Ingen CSV-bulk-import (fandtes i Atlas 1, ikke i MVP-scopet for Atlas 2).
- Refresh-token-fornyelse er minimal, rå fetch uden SDK — fungerer for normal brug, se ARCHITECTURE.md §7 for kendte kant-tilfælde.
- `legacy-node-sqlite/` er ikke en del af produktionsappen — se dens egen README for status.
