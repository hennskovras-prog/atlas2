// google-photos-thumbnail — én lille Supabase Edge Function (Deno), samme
// rolle/stil som openlibrary-proxy og discogs-sync: server-side kode kun
// tilføjet pga. et konkret, teknisk behov (her: CORS + at undgå at eksponere
// scraping-logik i browseren), ikke en generel applikationsserver.
//
// Deploy:  supabase functions deploy google-photos-thumbnail
// Brug fra klienten (public/index.html): sæt
//   GOOGLE_PHOTOS_THUMBNAIL_PROXY_URL til
//   https://<dit-projekt>.supabase.co/functions/v1/google-photos-thumbnail
//
// Baggrund: Google lukkede i marts 2025 for programmatisk søgning i hele
// Google Photos-biblioteket via Library API (se kommentaren ved
// GOOGLE_OAUTH_CLIENT_ID i public/index.html) — men et delt albumlink (fx
// https://photos.app.goo.gl/xxxxx) eksponerer stadig sit forsidebillede via
// et almindeligt og:image-meta-tag i sidens HTML, til brug for
// linkforhåndsvisninger (det samme mekanisme Slack/iMessage/WhatsApp bruger
// til at vise et billede, når man deler et Google Photos-link). Google
// server kun denne simple, forhåndsrenderede HTML til klienter, der ikke
// ligner en almindelig desktop-browser (bekræftet: både kendte bots og en
// almindelig ærlig user-agent-streng får den — kun "rigtige" browser-UA'er
// får i stedet Google Photos' interaktive JS-app at vide). Der bruges IKKE
// nogen OAuth, cookie eller login her — kun det, siden allerede eksponerer
// offentligt til enhver, der har linket, præcis som en browser ville se ved
// at indsætte linket i en chat.
//
// Én operation:
//   GET ?action=thumbnail&url=<google-photos-album-link>
//     -> { thumbnail_url: "https://lh3.googleusercontent.com/...=w400-h225-c" | null }

// deno-lint-ignore-file no-explicit-any
// @ts-ignore — Deno-global, findes kun i Edge Function-runtimen, ikke i almindelig Node/TS-tooling.
declare const Deno: any;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Transparent, ærlig user-agent — IKKE en efterligning af Slack/Twitter/
// Facebooks bots. Testet og bekræftet at give samme resultat (Google skelner
// tilsyneladende kun mellem "ligner en rigtig browser" og "gør ikke", ikke
// mellem specifikke kendte bots).
const USER_AGENT = 'AtlasApp-LinkPreview/1.0 (+https://hennskov.netlify.app; personligt kulturbibliotek, kun til eget brug)';

const OG_IMAGE_RE =
  /<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>|<meta[^>]*content="([^"]*)"[^>]*property="og:image"[^>]*>/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Google Photos' CDN-billeder tager en størrelses-suffix efter sidste "=" i
// URL'en (fx "=w600-h315-p-k"). Vi erstatter den, Google selv foreslog, med
// vores egen — en lille, beskåret 16:9-udgave, passende til et rejsekort.
function toThumbnailSize(imageUrl: string): string {
  return imageUrl.replace(/=[\w-]*$/, '') + '=w400-h225-c';
}

async function fetchAlbumThumbnail(albumUrl: string): Promise<string | null> {
  const res = await fetch(albumUrl, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Kunne ikke hente Google Photos-siden: ${res.status}`);
  const html = await res.text();
  const match = html.match(OG_IMAGE_RE);
  const raw = match ? (match[1] || match[2]) : null;
  if (!raw) return null;
  // og:image-værdien er HTML-attribut-encodet (fx "&amp;" for "&") — afkod
  // det samme minimale sæt, PostgREST/frontend allerede bruger andre steder.
  const decoded = raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return toThumbnailSize(decoded);
}

// @ts-ignore — Deno.serve findes kun i Edge Function-runtimen.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      if (action === 'thumbnail') {
        const albumUrl = url.searchParams.get('url') || '';
        if (!albumUrl.trim()) return json({ thumbnail_url: null });
        return json({ thumbnail_url: await fetchAlbumThumbnail(albumUrl) });
      }
      return json({ error: 'Ukendt action. Brug ?action=thumbnail&url=...' }, 400);
    }

    return json({ error: 'Metode ikke understøttet.' }, 405);
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
});
