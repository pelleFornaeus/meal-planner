// Reads a recipe web page for the Meals app.
// Browsers can't read other websites directly, so the app asks this function to.
//
//   POST { url }    -> { url, ld: [...JSON-LD blocks], meta: { title, image, description }, text }
//   POST { image }  -> the picture's bytes (so the app can save the recipe photo)
//
// Only signed-in users of the app can call it (Supabase checks the sign-in token).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PAGE = 4_000_000;
const MAX_IMAGE = 10_000_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Public web addresses only.
function checkUrl(raw: string): URL {
  const u = new URL(String(raw).trim());
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Not a web address');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '[::1]'
    || /^(0|10|127|169\.254|192\.168)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^\[?f[cd]/.test(h)) {
    throw new Error('Not a public web address');
  }
  return u;
}

async function get(url: URL, accept: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en,*;q=0.5' }, redirect: 'follow', signal: ctrl.signal });
    checkUrl(res.url || url.href);
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel(); throw new Error('Too big'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const decodeEntities = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function metaTag(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content).trim();
  }
  return '';
}

// The page as plain text, one block per line, for when it has no recipe data.
function pageText(html: string): string {
  return decodeEntities(html
    .replace(/<(head|script|style|noscript|svg|nav|footer|header|form|iframe)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .slice(0, 60000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body: { url?: string; image?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    if (body.image) {
      const res = await get(checkUrl(body.image), 'image/avif,image/webp,image/jpeg,image/png,image/*');
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) return json({ error: 'Not a picture' }, 422);
      const bytes = await readLimited(res, MAX_IMAGE);
      return new Response(bytes, { headers: { ...CORS, 'Content-Type': type, 'Cache-Control': 'no-store' } });
    }

    const url = checkUrl(body.url || '');
    const res = await get(url, 'text/html,application/xhtml+xml');
    if (!res.ok) return json({ error: `The site answered ${res.status}` }, 422);
    const type = res.headers.get('content-type') || '';
    if (!/html|xml/i.test(type)) return json({ error: 'That link isn’t a web page' }, 422);
    const html = new TextDecoder().decode(await readLimited(res, MAX_PAGE));

    const ld: unknown[] = [];
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { ld.push(JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ''))); } catch { /* skip broken blocks */ }
    }
    return json({
      url: res.url || url.href,
      ld,
      meta: {
        title: metaTag(html, ['og:title', 'twitter:title']) || decodeEntities(html.match(/<title[^>]*>([^<]*)/i)?.[1] || '').trim(),
        image: metaTag(html, ['og:image', 'og:image:url', 'twitter:image']),
        description: metaTag(html, ['og:description', 'description']),
      },
      text: pageText(html),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return json({ error: msg === 'The signal has been aborted' ? 'The site took too long' : msg }, 422);
  }
});
