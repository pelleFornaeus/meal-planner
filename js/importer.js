// Turns a recipe web page (or pasted recipe text) into a recipe.
// Most recipe sites include the recipe as schema.org "Recipe" data for search engines;
// that's what we read first. Pure functions, so they can be tested.
import { parseIngredient } from './model.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°' };

export function cleanText(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

const isType = (o, t) => {
  const types = [].concat(o?.['@type'] || []);
  return types.some((x) => String(x).toLowerCase() === t.toLowerCase() || String(x).endsWith(`/${t}`));
};

// Finds the Recipe object in the page's JSON-LD blocks, wherever it's nested.
export function findRecipeLd(blocks) {
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return null;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const x of o) { const r = walk(x); if (r) return r; }
      return null;
    }
    if (isType(o, 'Recipe')) return o;
    for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
      const r = walk(o[k]);
      if (r) return r;
    }
    return null;
  };
  return walk(blocks);
}

// "PT1H30M" -> 90
export function isoMinutes(s) {
  const m = String(s || '').match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m || !m[0] || m[0].toUpperCase() === 'P' || m[0].toUpperCase() === 'PT') return null;
  const min = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  return min > 0 ? Math.round(min) : null;
}

// "1 hour 30 minutes", "1 hr 5 mins", "45 min" -> minutes
export function textMinutes(s) {
  const t = String(s || '').toLowerCase();
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const m = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (!h && !m) return null;
  return Math.round((h ? Number(h[1].replace(',', '.')) * 60 : 0) + (m ? Number(m[1]) : 0)) || null;
}

// "4 servings", "Makes 12", ["4", "4 servings"], 6 -> a number of portions
export function yieldCount(y) {
  for (const v of [].concat(y ?? [])) {
    const m = String(v).match(/\d+(?:[.,]\d+)?/);
    if (m) {
      const n = Number(m[0].replace(',', '.'));
      if (n > 0 && n < 500) return Math.round(n);
    }
  }
  return null;
}

function firstImage(img, base) {
  for (const v of [].concat(img ?? [])) {
    const u = typeof v === 'string' ? v : v?.url || v?.contentUrl || v?.['@id'];
    if (u) {
      try { return new URL(u, base).href; } catch { /* try the next */ }
    }
  }
  return '';
}

// Instructions come as a string, a list of strings, HowToStep objects or HowToSections.
export function stepsFrom(ins) {
  const out = [];
  const add = (s) => {
    for (const line of cleanText(s).split(/\n+/)) {
      const t = line.replace(/^\s*(step\s*)?\d+[.):]\s*/i, '').trim();
      if (t) out.push(t);
    }
  };
  const walk = (x) => {
    if (!x) return;
    if (typeof x === 'string') { add(x); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.itemListElement) {
      if (x.name && isType(x, 'HowToSection')) out.push(`${cleanText(x.name).replace(/:$/, '')}:`);
      walk(x.itemListElement);
      return;
    }
    add(x.text || x.name || x.description || '');
  };
  walk(ins);
  // A section heading with no steps after it isn't useful.
  return out.filter((s, i) => !(s.endsWith(':') && (i === out.length - 1 || out[i + 1].endsWith(':'))));
}

const NUTRITION_KEYS = {
  cal: 'calories', protein: 'proteinContent', carbs: 'carbohydrateContent', fat: 'fatContent', sugar: 'sugarContent', fiber: 'fiberContent',
};

// Nutrition per serving. "320 kcal", "320 calories", "12 g", "12g" -> numbers
export function nutritionFrom(n) {
  const out = {};
  if (!n || typeof n !== 'object') return out;
  for (const [k, field] of Object.entries(NUTRITION_KEYS)) {
    const raw = String(n[field] ?? '').replace(',', '.');
    const m = raw.match(/\d+(?:\.\d+)?/);
    if (!m) continue;
    let v = Number(m[0]);
    if (k === 'cal' && /kj/i.test(raw) && !/kcal|cal/i.test(raw.replace(/kj/ig, ''))) v /= 4.184;
    else if (k !== 'cal' && /\bmg\b/i.test(raw)) v /= 1000;
    out[k] = Math.round(v * 10) / 10;
  }
  return out;
}

function ingredientsFrom(list) {
  return [].concat(list ?? [])
    .map((x) => cleanText(typeof x === 'string' ? x : x?.text || x?.name || ''))
    .flatMap((x) => x.split(/\n+/))
    .map((x) => parseIngredient(x))
    .filter(Boolean);
}

export function fromLd(r, pageUrl = '') {
  const minutes = isoMinutes(r.totalTime)
    ?? ((isoMinutes(r.prepTime) || 0) + (isoMinutes(r.cookTime) || 0) || null)
    ?? textMinutes(r.totalTime);
  return {
    name: cleanText(r.name || r.headline || ''),
    servings: yieldCount(r.recipeYield ?? r.yield),
    minutes,
    ingredients: ingredientsFrom(r.recipeIngredient || r.ingredients),
    steps: stepsFrom(r.recipeInstructions),
    nutrition: nutritionFrom(r.nutrition),
    image: firstImage(r.image || r.thumbnailUrl, pageUrl),
    notes: cleanText(r.description || '').slice(0, 500),
    source: pageUrl,
  };
}

const ING_HEAD = /^(ingredients?|you(?:'|’)ll need|what you need)\s*:?$/i;
const STEP_HEAD = /^(instructions?|directions?|method|steps|preparation|how to make it)\s*:?$/i;
const END_HEAD = /^(notes?|recipe notes|nutrition( facts| information)?|video|reviews?|comments?|tips|storage|faq|related|more recipes|you might also like)\b/i;

// Pasted recipe text, or a page with no recipe data: look for the headings.
export function fromText(text, pageUrl = '') {
  const lines = cleanText(text).split('\n').map((l) => l.replace(/^[-•*▢☐□]\s*/, '').trim()).filter(Boolean);
  const ingAt = lines.findIndex((l) => l.length < 40 && ING_HEAD.test(l));
  const stepAt = lines.findIndex((l, i) => i > ingAt && l.length < 40 && STEP_HEAD.test(l));
  let ingredients = [];
  let steps = [];
  if (ingAt >= 0) {
    const end = stepAt > ingAt ? stepAt : lines.findIndex((l, i) => i > ingAt && END_HEAD.test(l));
    ingredients = lines.slice(ingAt + 1, end > ingAt ? end : ingAt + 40)
      .filter((l) => !/:$/.test(l) || /\d/.test(l))
      .map(parseIngredient).filter(Boolean);
  }
  if (stepAt >= 0) {
    const end = lines.findIndex((l, i) => i > stepAt && l.length < 40 && END_HEAD.test(l));
    steps = lines.slice(stepAt + 1, end > stepAt ? end : stepAt + 41)
      .map((l) => l.replace(/^\s*(step\s*)?\d+[.):]?\s*/i, '').trim())
      .filter((l) => l && !/^step\s*\d*$/i.test(l));
  }
  const all = lines.join('\n');
  const serves = all.match(/\b(?:serves|servings|yield|yields|makes|portions)\b\s*:?\s*(\d+)/i);
  const time = all.match(/\btotal time\b\s*:?\s*([^\n]{1,40})/i);
  const first = lines[0] && lines[0] !== lines[ingAt] ? lines[0] : '';
  return {
    name: first.length <= 100 ? first : '',
    servings: serves ? Number(serves[1]) : null,
    minutes: time ? textMinutes(time[1]) : null,
    ingredients,
    steps,
    nutrition: {},
    image: '',
    notes: '',
    source: pageUrl,
  };
}

// What the import function sent back -> a recipe (or null when there's none to find).
export function fromPage(page) {
  const ld = findRecipeLd(page.ld || []);
  let r = ld ? fromLd(ld, page.url) : fromText(page.text || '', page.url);
  if (!ld && !r.ingredients.length && !r.steps.length) return null;
  if (!r.name) r.name = cleanText(page.meta?.title || '').replace(/\s*[|–—-]\s*[^|–—-]+$/, '');
  if (!r.image && page.meta?.image) r = { ...r, image: firstImage(page.meta.image, page.url) };
  return r;
}

