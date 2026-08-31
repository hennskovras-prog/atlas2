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

## 11. Anders And-årgange, detalje-visning og mobilrettelser

**`comic_years`-UI (tilføjet):** Samme simple mønster som Jumbo-bøger (år + valgfrit cover), men bygget direkte med den delte detalje-modal-tilgang (se næste punkt) i stedet for det ældre direkte-redigér-mønster — der var derfor intet at "rette" her bagefter.

**Detalje-visning før redigering, ensrettet på tværs af collections:** Bøgerne har fra Atlas 2's start haft en detalje-modal (`detail-backdrop`/`openDetail`) — klik på et cover viser info frit, uden login, med "Redigér"/"Slet" som separate handlinger der kræver login. Da Jumbo-bøger og Plader blev bygget (se §10), fik de ved en fejl IKKE dette mønster: klik gik direkte til `openJumboForm`/`openRecordForm`, som begge starter med `requireAuthOrPrompt()` — så en ikke-logget-ind besøgende fik en login-prompt i stedet for info, blot ved at ville se et kort. Rettet ved at give Jumbo og Plader deres egne detalje-modaler (`jumbo-detail-backdrop`, `record-detail-backdrop`), efter nøjagtig samme struktur som bøgernes. Anders And-årgange blev bygget med dette mønster fra starten. Alle fire collections med UI har nu identisk interaktionsmønster: klik = fri info, Redigér/Slet = kræver login.

**Mobilvisning — modal under skærmen (rettet):** `.modal-backdrop`/`.modal` brugte ren `vh`/`inset:0` til positionering. Nogle mobilbrowsere (rapporteret på Samsung Internet) regner `vh` ud fra den fulde layout-viewport i stedet for den faktisk synlige del af skærmen, særligt når adresselinjen er synlig eller det virtuelle tastatur er åbent — det kan få en bund-forankret (`align-items:flex-end`) fixed-positioneret modal til at havne delvist eller helt under den synlige skærm. Rettet med en lille JS-funktion (`syncAppViewportHeight`), der lytter på `window.visualViewport`'s `resize`/`scroll`-events (samt almindelig `resize`/`orientationchange`) og opdaterer en CSS-variabel `--app-vh` til den faktisk synlige højde; `.modal-backdrop`/`.modal` bruger `var(--app-vh, 100vh)` i stedet for ren `vh`. `visualViewport` er understøttet i alle nutidige mobilbrowsere (Chrome/Samsung Internet/Safari/Firefox). **Ikke testet på en fysisk Samsung-enhed fra denne sandkasse** — kun i en headless browser sat til mobil-viewport-størrelse, hvor `--app-vh` bekræftes sat korrekt. Christian bør bekræfte på sin egen telefon.

**Ikon til hjemmeskærm/faneblad (tilføjet):** `public/icons/` (apple-touch-icon 180×180, 192×192 og 512×512 til `site.webmanifest`, 16×16/32×32 til favicon) + `public/favicon.ico` + `public/site.webmanifest`, linket fra `<head>`. Simpelt "A"-monogram (Liberation Serif Bold) i appens eksisterende farvepalet (terracotta `--accent` baggrund, cremefarvet `--bg` bogstav) — genereret programmatisk, ikke hentet et sted fra, så der er ingen licensspørgsmål. Ingen build-step eller ekstra opsætning: filerne ligger i `public/` og følger automatisk med ved næste `git push` + Netlify-deploy.

## 12. Bogcovers for nyere danske bøger — undersøgt, ikke bygget endnu

Christian har observeret, at Open Library ofte mangler covers for nyere danske bøger, og spurgte om der findes et dansk alternativ (han nævnte specifikt at covers ofte findes på saxo.dk).

**Undersøgt:** DBC (Dansk BiblioteksCenter) driver Danmarks officielle bibliografiske infrastruktur og har flere cover-/data-services (den gamle `moreinfo.addi.dk`, det nyere "Open Platform" på `openplatform.dbc.dk`, og det nuværende "FBI-API" som efterfølger). Alle er undersøgt via deres egen dokumentation. Konklusionen er entydig: **de er alle forbeholdt biblioteker og deres partnere** — Cover Service'ens egen side skriver direkte "Cover Service er udelukkende for biblioteker," og Open Platform's registreringsproces kræver et tilknyttet folkebibliotek ("client_id's are only issued to a library or a partner via a library"). Der er ikke en selvbetjent, åben adgang for en privat/hobby-udvikler — i modsætning til Open Library, som netop er designet til fri, nøglefri offentlig brug.

**Anbefaling, godkendt af Christian og implementeret:**
1. **Google Books' Volumes API er tilføjet som ekstra kilde** ved siden af Open Library i bogsøgningen ("+ Tilføj bog"/redigér). Gratis, ingen API-nøgle brugt (samme "prøv direkte, degradér roligt"-princip som Open Library — se `googleBooksApi.search()` i `public/index.html`), og har ofte bedre/nyere dækning for internationale (herunder danske) udgivelser end Open Library. Begge kilder søges parallelt (`Promise.all`), resultaterne slås sammen og dedupes på ISBN (fallback: titel+forfatter), og hvert resultat viser tydeligt hvilken kilde det kommer fra — både i søgeresultatlisten og i bogens `source`-felt, når det vælges. Google Books er en ren tillægskilde: fejler kaldet (fx CORS i praksis, eller krav om nøgle udover det dokumenterede), returneres bare et tomt resultat derfra — Open Library, som er hovedkilden, påvirkes ikke.
2. **Saxo.dk er bevidst IKKE brugt som cover-kilde.** Det er ikke en API bygget til formålet — billed-URL'er kan ændre sig uden varsel, mange forhandlere blokerer "hotlinking" via en Referer-header-tjek, og det er en uafklaret gråzone at genbruge en forhandlers produktbilleder på et andet site, selv et privat et.
3. **Manuel cover-upload (fandtes allerede)** er stadig den mest robuste løsning for de bøger, hverken Open Library eller Google Books rammer — data ligger i egen database, uafhængigt af en ekstern URLs levetid. Værd at bruge fremfor at jagte endnu flere eksterne kilder.

**Testet lokalt:** klientlogikken (parallelt kald, merge, dedup på ISBN, visning af kildetag, korrekt udfyldning af felter ved valg af et Google Books-resultat) er testet med begge kilder mocket via Playwright's `page.route()`. **Ikke testet herfra:** det rigtige kald til `googleapis.com/books/v1/volumes` — denne sandkasses netværksadgang blokerer også dette domæne (samme begrænsning som alle andre eksterne API-kald i projektet), så Christian bør selv bekræfte i praksis at Google Books-resultater dukker op ved søgning.

## 13. Stregkode-scanner (ISBN via kameraet)

Tilføjet efter en kort snak om, hvorvidt AI-billedgenkendelse af bogomslag (som Atlas 1 forsøgte og droppede igen pga. "billing friction" — se `ATLAS_1_HANDOVER.md`) var den rigtige vej. Vurderingen var, at det var mere kompleks og dyrere end nødvendigt: det kræver en ægte hemmelighed (en Anthropic API-nøgle) bag endnu en Edge Function, rammer sjældent ISBN korrekt (som sidder bagpå ved stregkoden, ikke på forsiden), og kan forveksle udgaver ud fra omslagsdesign alene. En stregkode-scanner løser det samme kernebehov — mindre tastearbejde ved tilføjelse — markant simplere: ingen nøgle, ingen server-kode, ingen løbende omkostning.

**Sådan virker det:** en ny "📷 Scan stregkode"-knap i "+ Tilføj bog" åbner kameraet (`getUserMedia({video:{facingMode:'environment'}})`, bagkameraet) i en lille modal, og bruger browserens indbyggede `BarcodeDetector`-API (`formats:['ean_13']` — ISBN-13-stregkoder er Bookland EAN-13) til at scanne løbende billeder fra videofeedet via `requestAnimationFrame`. Så snart en fundet kode matcher et ISBN-13-mønster (`^97[89]\d{10}$` — starter altid med 978 eller 979), lukkes scanneren automatisk, og koden sendes som `isbn:<kode>` ind i den **allerede eksisterende** Open Library/Google Books-søgning (§12) — begge API'er forstår `isbn:`-søgesyntaks direkte, så der er genbrugt 100% eksisterende søge- og udvælgelseslogik. Ingen ny database-kolonne, ingen nyt API, ingen ny hemmelighed.

**Browser-understøttelse — vigtigt at forstå:** `BarcodeDetector` er **ikke** en universel web-standard endnu (MDN: "Limited availability"). Den virker i Chrome/Samsung Internet på **Android** (bekræftet via caniuse.com — Samsung Internet 13+ og Chrome for Android understøtter den fuldt) samt til dels Windows/macOS, men **slet ikke** i Firefox, Safari/iOS, eller — vigtigt at vide, hvis I nogensinde tester dette i et Linux-udviklingsmiljø — desktop Linux Chrome/Chromium overhovedet (bekræftet ved research: kun platforme med en bagvedliggende OS-/ML-baseret genkendelsesmotor har den, og Linux har historisk ingen). Koden tjekker `'BarcodeDetector' in window` og degraderer roligt: findes den ikke, vises en forklarende besked i stedet for at knappen bare ikke gør noget. Da Christian bruger Samsung Internet på Android, rammer han den understøttede sti.

**Testet lokalt — med en vigtig detalje:** Fordi denne sandkasses Chromium kører på Linux, findes `BarcodeDetector` slet ikke her (bekræftet direkte: `'BarcodeDetector' in window` er `false`), så selve pixel-genkendelsen kunne ikke testes fra denne session — det er også irrelevant, da det er Googles egen (allerede grundigt testede) genkendelsesmotor, ikke vores kode. Det, der ER testet grundigt, er ALT omkring det native kald: en stub-`BarcodeDetector` (der opfører sig som en rigtig — nogle "tomme" frames, så en fundet kode, blandet med en irrelevant ikke-ISBN-stregkode for at bekræfte 978/979-filtreringen virker) blev sat op via Playwright, og hele kæden blev bekræftet: kameraadgang, video-wiring, polling-loop, korrekt ISBN-filtrering, automatisk lukning ved fund, viderestilling til den eksisterende søgning, korrekt udfyldning af formularen ved valg af resultat — samt at kameraet frigives korrekt i **alle** tre lukke-veje (fundet kode, ✕-knap, klik udenfor modalen), så det aldrig bliver kørende i baggrunden. **Christian bør selv bekræfte på sin Samsung**, at den rigtige genkendelse (den ene del, der ikke kunne testes herfra) fungerer i praksis.

## 14. Rettelser efter rigtig test på Christians Samsung

Christian testede stregkode-scanneren og de nye detalje-visninger på sin egen telefon og fandt fire konkrete problemer, som alle er rettet:

**Stregkode-scanner lukkede/søgte for hurtigt på et enkelt fejlaflæst billede.** Den oprindelige version accepterede den FØRSTE fundne ISBN-lignende kode med det samme — ét enkelt dårligt billede (bevægelsesuskarphed, skæv vinkel) kunne udløse en søgning på en forkert kode, hvilket i praksis føltes som om scanneren "gav op" før man nåede at holde kameraet stille (bekræftet af Christians beskrivelse og af en fejlslået søgning på `isbn:9782014001334` i hans skærmbillede). Rettet: `scanBarcodeLoop` kræver nu **samme kode i to træk i streg** (`barcodeLastSeen`), før den accepteres og sender søgningen af sted — et enkelt fejlaflæst billede nulstiller bare tælleren og fortsætter i stedet for at slå fejl igennem. Statuslinjen viser desuden "Kode fundet — hold kameraet stille et øjeblik…" ved første træf, så Christian får feedback om at holde positionen. Testet med en stub-`BarcodeDetector`: en kode der kun ses i ét enkelt frame udløser aldrig en accept, uanset hvor mange frames der går bagefter; samme kode set to gange i streg gør.

**Mobilvisning: modal viste stadig baggrundssiden (fx pagineringen) gennem et "hul" i bunden.** `--app-vh`-rettelsen fra §11 løste kun selve højde-beregningen, men et beslægtet — og på mobil velkendt — problem med `position:fixed` og samtidig side-scroll bestod: åbnes en modal, mens siden er scrollet ned (fx side 9 af bøgerne, hvor Christian klikkede en bog nær pagineringen i bunden), kan overlayet på nogle mobilbrowsere (bl.a. Samsung Internet) ende forskudt i forhold til det, der reelt er synligt, så en del af den udimmede baggrundsside kan ses uden om overlayet. Rettet ved roden i stedet for at jagte endnu en vh-variant: `openModal`/`closeModal` låser nu heleside-scrollet (`document.body.style.position:'fixed'` med `top` sat til den negative scroll-position), mens ÉN ELLER FLERE modaler er åbne, og gendanner nøjagtigt scroll-positionen, når den sidste modal lukkes. Uden samtidig scroll under en åben modal kan denne klasse af fejl slet ikke opstå, uanset den præcise mobilbrowser-årsag. Testet: scroll siden ned → åbn en detalje → `body.style.position === 'fixed'` → luk → scroll-position gendannet præcis. **Selve den visuelle effekt er stadig kun bekræftet i en headless browser, ikke på Christians fysiske Samsung — bør bekræftes i praksis.**

**"Luk"-knappen i detalje-visningerne virkede ikke (kun ✕ virkede).** Årsag: click-lytterne for `[data-close]`-knapper bliver kun bundet ÉN gang ved sidens indlæsning (`document.querySelectorAll('[data-close]').forEach(...)`, se `public/index.html`). De fire "Luk"-knapper i bog-, Anders And-, Jumbo- og plade-detaljerne indsættes derimod dynamisk via `innerHTML`, hver gang en detalje åbnes — de eksisterer altså ikke endnu, når den ene binding kører ved opstart, og får derfor aldrig en click-handler. ✕-knappen virkede, fordi den er en fast del af modalens grundskabelon (findes allerede ved sidens indlæsning). Rettet efter Christians eget forslag: de fire overflødige "Luk"-knapper er simpelthen fjernet (✕ er tilstrækkelig og virker allerede korrekt) i stedet for at indføre event-delegation for en enkelt, let undværlig knap.

**Søgning via Open Library/Google Books var skjult ved redigering af en eksisterende bog.** Var en bevidst forsigtighedsbeslutning tidligere (for at undgå ved en fejl at overskrive et allerede sat cover), men Christian vil gerne kunne bruge søgningen til også at rette/genfinde data på bøger, der allerede er i systemet. `openForm(book)` viser nu søgefeltet i begge tilfælde (opret og redigér) — vælges et søgeresultat under redigering, opdateres titel/forfatter/år/ISBN/kilde og cover, præcis som ved oprettelse.

Alle fire rettelser er testet lokalt med Playwright (login, klik, DOM-state) mod en lokal Postgres-kopi af de rigtige data — se `run_fixes_e2e.js` (test-only, ikke en del af deployet).

## 15. Pagineringen overflowede på mobil (fundet af Christian, skærmbillede af tal 6-12 cirklet ind)

Efter §14 sendte Christian et skærmbillede, der viste pagineringen med tallene 6-12 synlige og resten klippet af i begge sider, med kommentaren "alt spiller med pager i bunden driller stadig". Dette var IKKE det samme som mobil-modal-problemet fra §11/§14 — det var en helt separat, hidtil uopdaget fejl i selve `renderPagination()`: den lavede **én knap pr. side** (301 bøger ≈ 51 sider = 51 knapper) i en `display:flex; justify-content:center`-række uden `flex-wrap`. På en 400px-bred mobilskærm er den samlede rækkebredde (51 × ~48px ≈ 2450px) langt bredere end skærmen; `justify-content:center` centrerer rækken ud fra sin egen fulde bredde, så det meste af den overflower usynligt til begge sider, og brugeren ser kun en tilfældig midterskive af sidetal uden nogen synlig måde at scrolle til eller nå side 1 eller den sidste side.

**Rettet:** `renderPagination()` viser nu "« Første", "‹ Forrige", "Side X af Y", "Næste ›", "Sidste »" — fem faste elementer uanset antal sider, så rækken aldrig kan overflowe uanset hvor mange bøger biblioteket vokser til. `.pagination` har desuden fået `flex-wrap:wrap` som ekstra sikkerhed på meget smalle skærme. Testet med en 412px mobil-viewport i Playwright: ingen horisontal overflow på siden, korrekt deaktivering af Første/Forrige på side 1 og Næste/Sidste på sidste side, og navigation til første/sidste side virker.

## 16. Google Books virkede aldrig — krævede en API-nøgle (fundet af Christian)

Christian rapporterede at Google Books "aldrig" foreslog noget. §12's antagelse om, at Google Books' søge-endpoint kunne bruges helt nøglefrit (samme princip som Open Library), viste sig at være forkert. Christian besøgte selv `https://www.googleapis.com/books/v1/volumes?...` direkte i sin telefons browser og fik et konkret svar tilbage: HTTP 429 med `"reason": "RATE_LIMIT_EXCEEDED"` og — afgørende — `"quota_limit_value": "0"`. Det er ikke lejlighedsvis rate-limiting; det er en permanent nul-kvote for alle nøglefri kald til `books.googleapis.com`, uden undtagelse. Derfor bidrog Google Books reelt aldrig noget, uanset søgning eller enhed.

**Rettet:** Christian oprettede selv en gratis API-nøgle i Google Cloud Console, låst til kun at virke fra `https://hennskov.netlify.app/*` (Application restrictions → Websites) og kun til Books API (API restrictions → Restrict key). Nøglen er derfor ikke en hemmelighed på samme måde som fx `DISCOGS_TOKEN` eller `TURSO_AUTH_TOKEN` — den er designet til at ligge synligt i offentlig frontend-kode (præcis som en Google Maps JavaScript-nøgle), og virker slet ikke, hvis nogen kopierer den til et andet site. Nøglen (`GOOGLE_BOOKS_API_KEY`) er derfor sat direkte i `public/index.html` ved siden af `GOOGLE_BOOKS_SEARCH_URL`, og sendes med som `&key=...` i søgekaldet.

Samtidig er `googleBooksApi.search()` gjort mere gennemsigtig (se §14's `googleBooksLastError`): en HTTP 429 viser nu specifikt "Google Books-kvoten er opbrugt lige nu — prøv igen senere" i søgeresultat-panelet, i stedet for bare et generisk fejlsvar — så hvis nøglens (langt højere, men ikke uendelige) kvote nogensinde skulle blive opbrugt igen, er det synligt med det samme i appen uden at skulle gennem den samme fejlsøgning igen.

**Vigtig lære, værd at huske i denne type projekt:** en antagelse om, at en ekstern API opfører sig "ligesom" en anden (her: Open Library) blev ikke testet grundigt nok, fordi denne sandkasse aldrig kunne nå `googleapis.com` for at bekræfte det direkte — kun Christians eget rigtige browsertest på sin telefon afslørede den præcise årsag. Der hvor en ekstern afhængighed ikke kan testes fra sandkassen, er det værd eksplicit at bede om et rigtigt testresultat derfra, fremfor at antage at "prøv direkte, degradér roligt"-mønstret automatisk gælder.

## 17. Google Books-covers virkede ikke — løst ved at deploye `openlibrary-proxy`

Efter Google Books-nøglen (§16) blev søgningen selv rettet, men Christian bemærkede at "Henter cover…"-knappen så ud til at hænge fast, når han valgte et Google Books-resultat med cover. To ting viste sig at være galt:

1. **En reel UI-fejl:** `btn.textContent = 'Henter cover…'` blev aldrig nulstillet igen, uanset udfald — `coverAsDataUri()` kaster aldrig en fejl (den returnerer `null` i stedet, med vilje, jf. dens egen kommentar), så det omkringliggende try/catch ramte reelt aldrig. Rettet: knappen ender nu altid i en tydelig sluttilstand ("✓ Cover hentet" eller "✓ Valgt (intet cover)"), og en toast forklarer det, hvis coveret ikke kunne hentes.
2. **Den egentlige årsag til at coveret ikke kunne hentes:** Google Books' cover-billeder (`books.google.com/books/content?...`) tillader ikke browseren at læse selve billedbytes via `fetch()` (kun at vise dem i en `<img>`-tag) — en CORS-begrænsning på Googles side, ikke noget i vores kode. `coverAsDataUri()` har fra starten haft en fallback til netop dette: `openlibrary-proxy`-Edge Functionen, som — til trods for navnet — er en helt generisk server-side billed-proxy (`downloadCoverAsDataUri(url)` fetcher blot den URL, den får, uden nogen domænebegrænsning). Server-side kald rammes ikke af browserens CORS-regler. Men funktionen var aldrig deployet til Christians Supabase-projekt, fordi Open Library-covers altid har virket via direkte download, så fallback-stien aldrig har været nødvendig før nu.

**Løsning:** Christian deployede `openlibrary-proxy` via Supabase Dashboard (samme fremgangsmåde som `discogs-sync`, se RUNNING.md §8) — ingen kodeændring nødvendig, funktionen lå allerede i repoet. Bekræftet virkende i praksis: Google Books-covers hentes nu korrekt ned og gemmes som base64 data-URI, ligesom Open Library-covers altid har gjort.

**Lære til fremtidige lignende situationer:** et navn på en fil/funktion ("openlibrary-proxy") kan skabe en forkert antagelse om dens faktiske omfang — værd at læse selve koden igennem, før man konkluderer at noget kun virker for én bestemt kilde.
