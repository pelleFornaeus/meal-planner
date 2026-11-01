// Looks foods up online: Open Food Facts (packaged foods and barcodes) and
// USDA FoodData Central (plain foods like chicken thighs or milk). Both are free.
import { fromOpenFoodFacts, fromUsda } from './foods.js';

const OFF_FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_quantity,categories';
const TIMEOUT = 12000;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429) throw new Error('busy');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const hasNumbers = (f) => f.nutrition && f.nutrition.cal != null;

export async function searchOpenFoodFacts(query) {
  const q = encodeURIComponent(query);
  let products;
  try {
    const data = await getJson(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`);
    products = data.products || [];
  } catch (e) {
    // Their newer search service, if the classic one is down or busy.
    const data = await getJson(`https://search.openfoodfacts.org/search?q=${q}&page_size=20&fields=${OFF_FIELDS}`);
    products = data.hits || [];
  }
  return products.map(fromOpenFoodFacts).filter(hasNumbers);
}

export async function searchUsda(query, key) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key || 'DEMO_KEY')}`
    + `&query=${encodeURIComponent(query)}&pageSize=20&dataType=${encodeURIComponent('Foundation,SR Legacy,Survey (FNDDS)')}`;
  const data = await getJson(url);
  return (data.foods || []).map(fromUsda).filter(hasNumbers);
}

// Both at once. Each list comes back with an error message if that source failed.
export async function searchFoods(query, { usdaKey } = {}) {
  const [usda, off] = await Promise.allSettled([searchUsda(query, usdaKey), searchOpenFoodFacts(query)]);
  const why = (r) => {
    if (r.status === 'fulfilled') return '';
    if (!navigator.onLine) return 'You’re offline.';
    if (r.reason?.message === 'busy') return 'Too many searches right now. Try again in a while.';
    return 'Couldn’t reach it.';
  };
  return {
    usda: usda.status === 'fulfilled' ? usda.value : [],
    off: off.status === 'fulfilled' ? off.value : [],
    usdaError: why(usda),
    offError: why(off),
  };
}

export async function lookupBarcode(code) {
  const clean = String(code).replace(/\D/g, '');
  const data = await getJson(`https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${OFF_FIELDS}`);
  if (!data.product || data.status === 0) return null;
  return fromOpenFoodFacts({ code: clean, ...data.product });
}
