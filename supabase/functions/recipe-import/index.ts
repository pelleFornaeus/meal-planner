// Reads a recipe web page for the Meals app.
// Browsers can't read other websites directly, so the app asks this function to.
//
//   POST { url }    -> { url, ld: [...JSON-LD blocks], meta: { title, image, description }, text }
//   POST { image }  -> the picture's bytes (so the app can save the recipe photo)
//   POST { product } -> { url, title, price, image } for an Amazon product link (short a.co links are followed)
//   POST { instacart: { title, items } } -> { url } of an Instacart shopping list page.
//        Needs the secret INSTACART_API_KEY (and INSTACART_ENV=development for a development key).
//
// Only signed-in users of the app can call it. The function checks the sign-in
// itself, so turn "Verify JWT" OFF in the function's settings: Supabase's own check
// doesn't work with the newer project keys and blocks every request before it gets here.

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

// Asks Supabase who the sign-in token belongs to.
async function signedIn(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  const apikey = req.headers.get('apikey') || '';
  if (!/^Bearer\s+\S+/i.test(auth) || !apikey) return false;
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  return res.ok;
}

// Best-effort product details. Amazon sometimes answers robots with a "sorry" page;
// the final address (with the product id) is still useful then.
async function product(raw: string) {
  const url = checkUrl(raw);
  const res = await get(url, 'text/html,application/xhtml+xml');
  const finalUrl = res.url || url.href;
  let title = '';
  let price: number | null = null;
  let image = '';
  if (res.ok && /html/i.test(res.headers.get('content-type') || '')) {
    const html = new TextDecoder().decode(await readLimited(res, MAX_PAGE));
    title = decodeEntities(html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
      || metaTag(html, ['og:title', 'title'])
      || decodeEntities(html.match(/<title[^>]*>([^<]*)/i)?.[1] || '').replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').replace(/\s*:\s*[^:]*$/, '').trim();
    const p = html.match(/"priceAmount"\s*:\s*([\d.]+)/)?.[1]
      || html.match(/<span class=["']a-offscreen["']>\s*[^\d<]*([\d.,]+)/)?.[1];
    if (p) {
      const n = Number(/,\d{2}$/.test(p) ? p.replace(/\./g, '').replace(',', '.') : p.replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) price = n;
    }
    image = metaTag(html, ['og:image']) || html.match(/data-old-hires=["']([^"']+)["']/i)?.[1] || '';
  } else {
    await res.body?.cancel();
  }
  return { url: finalUrl, title, price, image, status: res.status };
}

// Makes an Instacart shopping list page from the items.
async function instacart(body: { title?: string; items?: unknown[] }) {
  const key = Deno.env.get('INSTACART_API_KEY');
  if (!key) return json({ error: 'Instacart isn’t set up', setup: true }, 501);
  const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
  if (!items.length) return json({ error: 'Nothing to send' }, 400);
  const dev = /^dev/i.test(Deno.env.get('INSTACART_ENV') || '');
  const host = dev ? 'https://connect.dev.instacart.tools' : 'https://connect.instacart.com';
  const res = await fetch(`${host}/idp/v1/products/products_link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: String(body.title || 'Shopping list').slice(0, 100),
      link_type: 'shopping_list',
      expires_in: 30,
      line_items: items,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.products_link_url) {
    const msg = data?.error?.message || data?.errors?.[0]?.message || `Instacart answered ${res.status}`;
    return json({ error: msg, status: res.status }, res.status === 401 || res.status === 403 ? 502 : 422);
  }
  return json({ url: data.products_link_url });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!(await signedIn(req))) return json({ error: 'Sign in again' }, 401);
  let body: { url?: string; image?: string; product?: string; instacart?: { title?: string; items?: unknown[] } };
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    if (body.instacart) return await instacart(body.instacart);
    if (body.product) return json(await product(body.product));
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
