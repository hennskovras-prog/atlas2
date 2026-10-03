// openlibrary-proxy — én lille Supabase Edge Function (Deno), kun deployet
// hvis direkte browser-fetch mod Open Library viser sig CORS-blokeret.
//
// Samme rolle som streaming-appens to Edge Functions (recommend,
// check-new-seasons): server-side kode, kun tilføjet fordi der er et
// konkret, teknisk behov (her: undgå CORS), ikke en generel applikationsserver.
//
// Deploy:  supabase functions deploy openlibrary-proxy
// Brug fra klienten (public/index.html): sæt OPENLIBRARY_PROXY_URL til
//   https://<dit-projekt>.supabase.co/functions/v1/openlibrary-proxy
//
// To operationer, matcher 1:1 Atlas 1's book_service.py + cover_storage.py:
//   GET  ?action=search&q=...   -> søgning, samme shape som frontend forventer
//   POST { action:"cover", url } -> henter et billede og re-koder som base64 data-URI

// deno-lint-ignore-file no-explicit-any
// @ts-ignore — Deno-global, findes kun i Edge Function-runtimen, ikke i almindelig Node/TS-tooling.
declare const Deno: any;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function searchOpenLibrary(q: string) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Library-søgning fejlede: ${res.status}`);
  const data = await res.json();
  return (data.docs || []).slice(0, 10).map((doc: any) => ({
    title: doc.title || '',
    author: (doc.author_name && doc.author_name[0]) || '',
    year: doc.first_publish_year || null,
    isbn: (doc.isbn && doc.isbn[0]) || null,
    cover_id: doc.cover_i || null,
    openlibrary_key: doc.key || null,
    cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
  }));
}

// Kun https og kun hostnavne (ingen IP-adresser/localhost) — en simpel
// forsvarslinje mod at funktionen bruges til at ramme interne adresser (SSRF).
// Selve adgangen er i forvejen begrænset til ejeren (se requireOwner).
function isSafeCoverUrl(u: string): boolean {
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:') return false;
    const h = p.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
    if (/^[0-9.]+$/.test(h) || h.includes(':')) return false; // IPv4-/IPv6-literal
    return true;
  } catch (_) { return false; }
}

async function downloadCoverAsDataUri(url: string) {
  if (!isSafeCoverUrl(url)) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return `data:${contentType};base64,${base64}`;
}

// ---- Adgangskontrol: KUN ejeren ----------------------------------------------
// verify_jwt=true afviser kald uden en gyldig JWT — men anon-nøglen ER en gyldig
// JWT og står i sidens kildekode, så den alene er ikke adgangskontrol. Her
// kontrolleres derfor, at kalderens token tilhører ejeren: databasefunktionen
// public.is_owner() (migrations/010_private_owner_only.sql) svarer true KUN for
// ejerens egen indloggede session. Anon-nøglen og andre brugere får afslag.
async function requireOwner(req: Request): Promise<Response | null> {
  const auth = req.headers.get('Authorization') || '';
  const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const base = Deno.env.get('SUPABASE_URL') || '';
  if (!/^bearer\s+\S+/i.test(auth) || !base) return json({ error: 'Ikke logget ind.' }, 401);
  try {
    const r = await fetch(`${base}/rest/v1/rpc/is_owner`, {
      method: 'POST',
      headers: { apikey, Authorization: auth, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (r.ok && (await r.json()) === true) return null;
  } catch (_) { /* fald igennem til afslag */ }
  return json({ error: 'Kun ejeren har adgang.' }, 403);
}

// @ts-ignore — Deno.serve findes kun i Edge Function-runtimen.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  const denied = await requireOwner(req);
  if (denied) return denied;

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      if (action === 'search') {
        const q = url.searchParams.get('q') || '';
        if (!q.trim()) return json([]);
        return json(await searchOpenLibrary(q));
      }
      return json({ error: 'Ukendt action. Brug ?action=search&q=...' }, 400);
    }

    if (req.method === 'POST') {
      const body = await req.json();
      if (body.action === 'cover' && body.url) {
        const data_uri = await downloadCoverAsDataUri(body.url);
        return json({ data_uri });
      }
      return json({ error: 'Ukendt action. Send { action: "cover", url: "..." }.' }, 400);
    }

    return json({ error: 'Metode ikke understøttet.' }, 405);
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
});
