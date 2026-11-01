// Splits the saved data into small records so two devices can change different
// things at the same time without overwriting each other.
//   r|<recipeId>          a recipe
//   c|<groupId>           a category group with its options
//   f|<foodId>            a saved food (for quick-add)
//   s                     settings
//   p|<date>|<entryId>    one meal or food on a day
//   k|<itemKey>           a ticked-off shopping list item
//   x|<id>                an extra item added to the shopping list by hand
// Pure functions, so they can be tested without a browser.

const LISTS = { r: 'recipes', c: 'categories', f: 'foods' };

export function flatten(state) {
  const out = {};
  for (const [kind, list] of Object.entries(LISTS)) {
    for (const item of state[list] || []) out[`${kind}|${item.id}`] = item;
  }
  out.s = state.settings || {};
  for (const [date, day] of Object.entries(state.plan || {})) {
    for (const [id, entry] of Object.entries(day || {})) out[`p|${date}|${id}`] = entry;
  }
  const shop = state.shopping || {};
  for (const [k, v] of Object.entries(shop.checked || {})) out[`k|${k}`] = v;
  for (const x of shop.extras || []) out[`x|${x.id}`] = x;
  return out;
}

// Put one record into the state (value undefined removes it). Keeps list order.
export function applyRecord(state, key, value) {
  const [kind, a, b] = key.split('|');
  if (LISTS[kind]) {
    const list = state[LISTS[kind]];
    const i = list.findIndex((x) => x.id === a);
    if (value === undefined) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = value;
    else list.push(value);
  } else if (kind === 's') {
    if (value !== undefined) state.settings = { ...state.settings, ...value };
  } else if (kind === 'k' || kind === 'x') {
    if (!state.shopping) state.shopping = { checked: {}, extras: [] };
    const shop = state.shopping;
    if (kind === 'k') {
      const k = key.slice(2);
      if (value === undefined) delete shop.checked[k];
      else shop.checked[k] = value;
    } else {
      const i = shop.extras.findIndex((x) => x.id === a);
      if (value === undefined) { if (i >= 0) shop.extras.splice(i, 1); }
      else if (i >= 0) shop.extras[i] = value;
      else shop.extras.push(value);
    }
  } else if (kind === 'p') {
    if (value === undefined) {
      if (state.plan[a]) {
        delete state.plan[a][b];
        if (!Object.keys(state.plan[a]).length) delete state.plan[a];
      }
    } else {
      if (!state.plan[a]) state.plan[a] = {};
      state.plan[a][b] = value;
    }
  }
}

// What changed locally since the last look. `snap` maps key -> JSON text.
export function diff(snap, state) {
  const now = flatten(state);
  const changed = [];
  const json = {};
  for (const [k, v] of Object.entries(now)) {
    json[k] = JSON.stringify(v);
    if (snap[k] !== json[k]) changed.push(k);
  }
  const removed = Object.keys(snap).filter((k) => !(k in now));
  return { changed, removed, json, records: now };
}

// Decide what to do with a record from the server.
// Local wins only when it has an unsent change that is newer.
export function remoteWins(meta, key, remoteMod) {
  return !(meta.dirty[key] && (meta.mods[key] ?? 0) > remoteMod);
}
