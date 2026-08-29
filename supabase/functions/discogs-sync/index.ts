// discogs-sync — én lille Supabase Edge Function (Deno), hvis eneste formål
// er at holde DISCOGS_TOKEN (en rigtig hemmelighed, i modsætning til
// SUPABASE_ANON_KEY) væk fra browseren. Samme princip som openlibrary-proxy:
// server-side kode kun tilføjet ved et konkret, snævert behov — her er behovet
// "denne nøgle må aldrig stå i klientkode", ikke CORS (Discogs's CORS-status
// er ukendt fra denne sandkasse, men er underordnet — token'et skal skjules
// under alle omstændigheder).
//
// Funktionen taler KUN med Discogs og normaliserer svaret. Selve
// databaseskrivningen (upsert i `records`, keyed på discogs_release_id) sker
// fra klienten via almindelig PostgREST, med Christians egen indlogning —
// funktionen har derfor ikke brug for en service_role-nøgle og rører aldrig
// selve Atlas-databasen.
//
// Deploy:    supabase functions deploy discogs-sync
// Secret:    supabase secrets set DISCOGS_TOKEN=<din-discogs-personal-token>
// Brug fra klienten: GET https://<dit-projekt>.supabase.co/functions/v1/discogs-sync
//   -> returnerer hele pladesamlingen som JSON-array:
//      [{ title, artist, year, discogs_release_id, cover_url }, ...]

// deno-lint-ignore-file no-explicit-any
// @ts-ignore — Deno-global, findes kun i Edge Function-runtimen.
declare const Deno: any;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Discogs kræver en beskrivende User-Agent på alle kald, ellers svarer den 403.
const DISCOGS_HEADERS = (token: string) => ({
  Authorization: `Discogs token=${token}`,
  'User-Agent': 'Atlas2PersonalLibrary/1.0',
});

/** Slår token op til brugernavn — undgår at Christian selv skal opgive det. */
async function resolveUsername(token: string): Promise<string> {
  const res = await fetch('https://api.discogs.com/oauth/identity', { headers: DISCOGS_HEADERS(token) });
  if (!res.ok) throw new Error(`Discogs afviste token'et (identity: ${res.status})`);
  const data = await res.json();
  if (!data.username) throw new Error('Discogs-svar mangler username.');
  return data.username;
}

/** Discogs' artist-liste har et "join"-felt mellem navne (fx "&", ","),
 *  og navne kan have en disambiguerings-forlængelse som " (2)" — den fjernes,
 *  den ændrer ikke hvem kunstneren er, kun hvordan Discogs undgår
 *  navnekollisioner internt. */
function formatArtists(artists: any[]): string {
  if (!artists || !artists.length) return '';
  let out = '';
  for (let i = 0; i < artists.length; i++) {
    const name = String(artists[i].name || '').replace(/\s\(\d+\)$/, '');
    out += name;
    if (i < artists.length - 1) out += ' ' + (artists[i].join || ',').trim() + ' ';
  }
  return out.trim();
}

function normalizeRelease(item: any) {
  const bi = item.basic_information || {};
  return {
    title: bi.title || '',
    artist: formatArtists(bi.artists),
    year: bi.year ? Number(bi.year) : null,
    discogs_release_id: bi.id,
    cover_url: bi.cover_image || bi.thumb || null,
  };
}

/** Henter HELE samlingen (folder 0 = "All"), sider igennem alt før den
 *  returnerer — for de håndfulde plader Christian har, er det i praksis én
 *  side, men logikken er korrekt uanset hvor stor samlingen bliver. */
async function fetchWholeCollection(token: string) {
  const username = await resolveUsername(token);
  const all: any[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, { headers: DISCOGS_HEADERS(token) });
    if (!res.ok) throw new Error(`Discogs-samling kunne ikke hentes (side ${page}: ${res.status})`);
    const data = await res.json();
    for (const item of data.releases || []) all.push(normalizeRelease(item));
    const pages = (data.pagination && data.pagination.pages) || 1;
    if (page >= pages) break;
    page++;
  }
  return all;
}

// @ts-ignore — Deno.serve findes kun i Edge Function-runtimen.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET') return json({ error: 'Kun GET understøttet.' }, 405);

  // .trim() er vigtigt her: hvis secret'en blev sat med en efterfølgende
  // linjeskift eller mellemrum (meget almindeligt ved copy-paste, fx fra en
  // markeret linje i en editor), afviser Deno's fetch() headeren med
  // "Invalid header value" nede i DISCOGS_HEADERS(), FØR noget kald overhovedet
  // når Discogs. Trimmer vi ikke her, ser det ud som en netværksfejl, men er
  // reelt et usynligt tegn i secret-værdien.
  const token = (Deno.env.get('DISCOGS_TOKEN') || '').trim();
  if (!token) return json({ error: 'DISCOGS_TOKEN er ikke sat som secret på Supabase-projektet.' }, 500);

  try {
    const records = await fetchWholeCollection(token);
    return json(records);
  } catch (err) {
    return json({ error: String((err && (err as any).message) || err) }, 502);
  }
});
