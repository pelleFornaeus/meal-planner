import { store } from './store.js';
import { sync } from './sync.js';
import { initPhotos, photoUrl, savePhoto } from './photos.js';
import { lookupBarcode, searchFoods } from './lookup.js';
import { startScanner } from './scanner.js';
import { fromPage, fromText } from './importer.js';
import {
  matchFood, parseReceipt, priceTrend, rememberReceiptName, setPrice, unitLabel, unitPrice,
} from './receipt.js';
import { readImageText } from './ocr.js';
import {
  amazonCartUrl, compareRows, compareTotals, getLink, instacartItems, parseAmazonLink, parsePrice, setLink, titleFromAmazonUrl,
} from './stores.js';
import { autoPlan, planTotals, useItUp, useSoon, weekDays } from './planner.js';
import { yearRecap } from './recap.js';
import {
  addRecipeToList, amountText, guessStaple, itemKey, listText, pruneChecks, removeRecipeFromList, setChecked, shoppingList,
} from './shopping.js';
import {
  clockText, copyWeek, cookDates, lastCooked, pickSurprise, stepTimers,
} from './extras.js';
import {
  SECTIONS, guessSection, normUnit, nutritionFor, perLabel, priceFor,
} from './foods.js';
import {
  addDays, dateKey, daysBetween, formatDay, fromKey, monthName, shortDate, shortDay, startOfWeek,
} from './dates.js';
import {
  NUTRIENTS, addEntry, batchLeft, batchSize, blankRecipe, costPerServing, dayEntries, dayTotals,
  deleteRecipe, entryName, entryTotals, filterRecipes, findRecipe, fmtMoney, fmtNum, fmtQty, foodFor,
  getEntry, ingredientText, leftoversOf, moveEntry, openBatches, parseFoods, parseIngredient, parseQty,
  parseSteps, perServing, rangeTotals, recentFoods, recipeTags, refOf, rememberFood, removeEntry,
  removeEntryRaw, servingsOf, sourceOf, uid, defaultState,
  addFood, deleteFood, entryFromFood, findFood, getFood, linkName, recipeFromIngredients,
} from './model.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const S = () => store.state;
const today = () => dateKey(new Date());
const money = (n) => fmtMoney(n, S().settings.currency || '$');
const slots = () => S().settings.slots;
const slotName = (id) => slots().find((s) => s.id === id)?.name || 'Other';

const ui = {
  tab: 'plan',
  week: null, // first day of the week shown on the Plan tab
  openDays: new Set(),
  search: '',
  sort: 'name',
  recipesView: 'recipes', // or 'foods'
  foodSearch: '',
  filter: {}, // groupId -> Set(optionIds)
  filtersOpen: false,
  shopFrom: null, // first day of the shopping list (default today)
  shopGroup: 'section', // or 'recipe'
  shopView: 'list', // or 'pantry'
  atHomeOpen: false,
  favOnly: false,
  timers: [], // running kitchen timers
  shopRecipes: new Set(), // show only these recipes ('foods' = foods added to days)
  summaryMode: 'week',
  summaryAnchor: null,
  sheets: [], // stack of open sheets; the last one shows
};

const top = () => ui.sheets[ui.sheets.length - 1] || null;
function openSheet(sheet) { ui.sheets.push(sheet); renderSheet(); }
function closeSheet() {
  if (top()?.kind === 'scan') endScan();
  if (top()?.kind === 'cook') keepScreenOn(false);
  ui.sheets.pop();
  renderSheet();
}
function closeAllSheets() { endScan(); keepScreenOn(false); ui.sheets = []; renderSheet(); }

// ---------- Formatting ----------

const kcal = (n) => `${Math.round(n || 0).toLocaleString()} kcal`;
const grams = (n) => `${fmtNum(n || 0, n >= 10 ? 0 : 1)} g`;
function nutrientText(key, n) {
  return key === 'cal' ? kcal(n) : grams(n);
}

function totalsLine(t, { withCost = true } = {}) {
  const parts = [];
  if (t.items - t.missingNutrition > 0) {
    parts.push(kcal(t.cal));
    parts.push(`${grams(t.protein)} protein`);
  }
  if (withCost && t.items - t.missingCost > 0) parts.push(money(t.cost));
  return parts.join(' · ');
}

function thumb(photoId, cls = 'thumb') {
  const url = photoUrl(photoId);
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" />`
    : `<span class="${cls} placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 11h14a7 7 0 0 1-14 0zM4 11h16M9 7c0-1.5 1-2 1-3.5M13 7c0-1.5 1-2 1-3.5"/></svg></span>`;
}

// ---------- Rendering ----------

// Redraws keep whatever is being typed (a sync can redraw at any moment).
function keepTyping(fn) {
  const a = document.activeElement;
  const sel = a?.id ? `#${a.id}` : a?.dataset?.bind ? `[data-bind="${a.dataset.bind}"]` : null;
  const pos = sel && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (sel) {
    const el = $(sel);
    if (el && el !== document.activeElement) {
      el.focus({ preventScroll: true });
      if (pos) try { el.setSelectionRange(...pos); } catch { /* not a text field */ }
    }
  }
}

function render() { keepTyping(renderAll); }

function renderAll() {
  if (!ui.week) ui.week = startOfWeek(today(), S().settings.weekStart);
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === ui.tab);
  });
  const main = $('#main');
  if (ui.tab === 'plan') main.innerHTML = renderPlan();
  else if (ui.tab === 'recipes') main.innerHTML = renderRecipes();
  else if (ui.tab === 'shop') main.innerHTML = renderShop();
  else if (ui.tab === 'summary') main.innerHTML = renderSummary();
  else main.innerHTML = renderSettings();
  renderSheetInner();
}

// ---------- Plan tab ----------

function renderPlan() {
  const t = today();
  const from = ui.week;
  const to = addDays(from, 6);
  const isThisWeek = from === startOfWeek(t, S().settings.weekStart);
  const week = rangeTotals(S(), from, to);
  const hasCost = week.total.items - week.total.missingCost > 0;
  return `
    <header class="day-header">
      <button class="icon-btn" data-act="prev-week" aria-label="Previous week">‹</button>
      <div class="day-title">
        <h1>${isThisWeek ? 'This week' : esc(`${shortDate(from)} – ${shortDate(to)}`)}</h1>
        <div class="day-sub">${isThisWeek ? esc(`${shortDate(from)} – ${shortDate(to)}`) : '<button class="link" data-act="this-week">Back to this week</button>'}</div>
      </div>
      <button class="icon-btn" data-act="next-week" aria-label="Next week">›</button>
    </header>
    ${week.total.items ? `
      <div class="week-sum">
        ${hasCost ? `<span><strong>${esc(money(week.total.cost))}</strong> this week</span>` : ''}
        ${week.plannedDays && week.total.items - week.total.missingNutrition > 0 ? `<span><strong>${esc(kcal(week.total.cal / week.plannedDays))}</strong> a day on average</span>` : ''}
        <button class="link" data-act="go-summary">Details</button>
      </div>` : `<p class="hint center">Tap <strong>+</strong> on a meal to plan it. Add recipes in the Recipes tab.</p>`}
    ${S().recipes.length ? `<div class="plan-tools"><button class="btn small" data-act="autoplan">✨ Auto-plan this week</button></div>` : ''}
    ${renderUseItUp(true)}
    <div class="days">
      ${daysBetween(from, to).map((d) => renderDay(d, t)).join('')}
    </div>
    ${Object.keys(S().plan).some((d) => d >= addDays(from, -7) && d < from) ? `
      <p class="hint center"><button class="link" data-act="copy-week">Copy last week’s meals into this week</button></p>` : ''}
  `;
}

function renderDay(date, t) {
  const totals = dayTotals(S(), date);
  const open = ui.openDays.has(date);
  const line = totalsLine(totals);
  return `
    <section class="day card${date === t ? ' is-today' : ''}${date < t ? ' is-past' : ''}" id="day-${date}">
      <div class="day-head">
        <h2>${esc(shortDay(date))}${date === t ? ' <span class="badge live">Today</span>' : ''}</h2>
        ${totals.items ? `<button class="day-totals" data-act="toggle-day" data-date="${date}" aria-expanded="${open}">${esc(line || 'Add nutrition')} <span class="chev">${open ? '▾' : '▸'}</span></button>` : ''}
      </div>
      ${open && totals.items ? renderDayDetails(totals) : ''}
      ${slots().map((s) => renderSlot(date, s)).join('')}
      ${renderOrphanSlot(date)}
    </section>`;
}

function renderDayDetails(t) {
  const goals = S().settings.goals || {};
  return `
    <div class="nutri-grid">
      ${NUTRIENTS.map((n) => {
        const goal = Number(goals[n.key]) || 0;
        const pct = goal ? Math.min(100, Math.round((t[n.key] / goal) * 100)) : 0;
        return `<div class="nutri">
          <span class="nutri-label">${n.label}</span>
          <strong>${esc(nutrientText(n.key, t[n.key]))}</strong>
          ${goal ? `<div class="bar"><span style="width:${pct}%"></span></div><span class="nutri-goal">of ${esc(nutrientText(n.key, goal))}</span>` : ''}
        </div>`;
      }).join('')}
      <div class="nutri"><span class="nutri-label">Cost</span><strong>${esc(money(t.cost))}</strong></div>
    </div>
    ${t.missingNutrition || t.missingCost ? `<p class="hint flush">${[
      t.missingNutrition ? `${t.missingNutrition} item${t.missingNutrition === 1 ? '' : 's'} without nutrition` : '',
      t.missingCost ? `${t.missingCost} without a price` : '',
    ].filter(Boolean).join(', ')}. Not counted above.</p>` : ''}`;
}

function renderSlot(date, slot) {
  const entries = dayEntries(S(), date, slot.id);
  return `
    <div class="slot">
      <div class="slot-head">
        <span class="slot-name">${esc(slot.name)}</span>
        <button class="add-btn" data-act="add" data-date="${date}" data-slot="${esc(slot.id)}" aria-label="Add to ${esc(slot.name)}">+</button>
      </div>
      ${entries.length ? `<ul class="entries">${entries.map((e) => renderEntry(date, e)).join('')}</ul>` : ''}
    </div>`;
}

// Entries whose meal slot was removed in Settings still show, so nothing is lost.
function renderOrphanSlot(date) {
  const ids = new Set(slots().map((s) => s.id));
  const entries = dayEntries(S(), date).filter((e) => !ids.has(e.slot));
  if (!entries.length) return '';
  return `<div class="slot"><div class="slot-head"><span class="slot-name">Other</span></div>
    <ul class="entries">${entries.map((e) => renderEntry(date, e)).join('')}</ul></div>`;
}

function entryMeta(date, e) {
  if (e.type === 'food') {
    const t = entryTotals(S(), e);
    const amount = [e.amount != null ? fmtQty(e.amount) : '', e.unit].filter(Boolean).join(' ');
    return [amount, t.missingNutrition ? '<span class="badge warn">Add nutrition</span>' : esc(kcal(t.cal))].filter(Boolean).join(' · ');
  }
  const portions = Number(e.portions) || 0;
  const p = portions === 1 ? '' : `${fmtQty(portions)} portions`;
  if (e.type === 'cook') {
    const left = batchLeft(S(), date, e);
    const size = batchSize(S(), e);
    const parts = [`<span class="badge cook">Cook</span>`];
    if (size > 1) parts.push(left > 0 ? `${fmtQty(left)} of ${fmtQty(size)} left` : `all ${fmtQty(size)} planned`);
    if (p) parts.push(p);
    return parts.join(' ');
  }
  const src = sourceOf(S(), e);
  return `<span class="badge">Leftovers</span> ${src ? `from ${esc(formatDay(src.date, today()).replace(/^(\w+),.*/, '$1'))}` : ''}${p ? ` · ${p}` : ''}`;
}

function renderEntry(date, e) {
  const t = entryTotals(S(), e);
  const recipe = e.type === 'food' ? null : findRecipe(S(), e.recipeId);
  return `
    <li>
      <button class="entry" data-act="entry" data-date="${date}" data-id="${e.id}">
        ${e.type === 'food' ? '<span class="thumb food-dot" aria-hidden="true"></span>' : thumb(recipe?.photo)}
        <span class="entry-main">
          <span class="title">${esc(entryName(S(), e))}</span>
          <span class="meta">${entryMeta(date, e)}</span>
        </span>
        ${t.cost != null ? `<span class="entry-cost">${esc(money(t.cost))}</span>` : ''}
      </button>
    </li>`;
}

// ---------- Recipes tab ----------

function recipesSwitch() {
  return `
    <div class="seg">
      <button class="${ui.recipesView !== 'foods' ? 'on' : ''}" data-act="recipes-view" data-view="recipes">Recipes</button>
      <button class="${ui.recipesView === 'foods' ? 'on' : ''}" data-act="recipes-view" data-view="foods">Foods</button>
    </div>`;
}

function renderRecipes() {
  if (ui.recipesView === 'foods') return renderFoods();
  const list = filterRecipes(S(), { search: ui.search, filter: ui.filter, sort: ui.sort, favorites: ui.favOnly });
  const active = Object.values(ui.filter).reduce((n, s) => n + (s?.size || 0), 0);
  const groups = S().categories;
  return `
    <header class="page-header">
      <h1>Recipes</h1>
      <div class="btn-row">
        <button class="btn" data-act="import-recipe">Import</button>
        <button class="btn primary" data-act="new-recipe">+ New</button>
      </div>
    </header>
    ${recipesSwitch()}
    ${S().recipes.length ? `
      <div class="toolbar">
        <input id="recipe-search" class="search" type="search" placeholder="Search recipes or ingredients" value="${esc(ui.search)}" autocomplete="off" />
        <select id="recipe-sort" aria-label="Sort">
          ${[['name', 'A–Z'], ['newest', 'Newest'], ['favorite', 'Favourites first'], ['rating', 'Top rated'], ['stale', 'Not made in a while'], ['cost', 'Cheapest'], ['cal', 'Fewest calories'], ['protein', 'Most protein'], ['time', 'Quickest']]
            .map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="filter-bar">
        <button class="chip${ui.filtersOpen || active ? ' on' : ''}" data-act="toggle-filters">Filter${active ? ` (${active})` : ''} ${ui.filtersOpen ? '▾' : '▸'}</button>
        <button class="chip${ui.favOnly ? ' on' : ''}" data-act="fav-only">★ Favourites</button>
        ${active ? '<button class="link" data-act="clear-filters">Clear</button>' : ''}
        <button class="chip surprise-chip" data-act="surprise">🎲 Surprise me</button>
      </div>
      ${ui.filtersOpen ? `
        <div class="card filters">
          ${groups.map((g) => `
            <div class="filter-group">
              <span class="field-label">${esc(g.name)}</span>
              <div class="chips">
                ${g.options.map((o) => `<button class="chip tiny${ui.filter[g.id]?.has(o.id) ? ' on' : ''}" data-act="filter" data-group="${g.id}" data-option="${o.id}">${esc(o.name)}</button>`).join('')}
              </div>
            </div>`).join('')}
          <p class="hint flush">Pick several in one group to see any of them. <button class="link" data-act="categories">Edit categories</button></p>
        </div>` : ''}
      ${list.length ? `<ul class="recipe-grid">${list.map(renderRecipeCard).join('')}</ul>`
        : '<p class="empty">No recipes match.</p>'}
    ` : `
      <div class="card empty-card">
        <p><strong>No recipes yet.</strong></p>
        <p class="hint flush">Add your first recipe with ingredients, steps, a photo, nutrition and price, or import one from a recipe website.</p>
        <div class="btn-row">
          <button class="btn primary" data-act="new-recipe">Add a recipe</button>
          <button class="btn" data-act="import-recipe">Import from a link</button>
        </div>
      </div>`}
  `;
}

function renderRecipeCard(r) {
  const ps = perServing(r);
  const cps = costPerServing(r);
  const facts = [
    ps.cal != null && ps.cal !== '' ? kcal(ps.cal) : '',
    cps != null ? `${money(cps)}/serving` : '',
    r.minutes ? `${r.minutes} min` : '',
  ].filter(Boolean);
  return `
    <li>
      <button class="recipe-card" data-act="view-recipe" data-id="${r.id}">
        ${thumb(r.photo, 'cover')}
        <span class="recipe-body">
          <span class="title">${r.favorite ? '<span class="fav-star" aria-label="Favourite">★</span> ' : ''}${esc(r.name)}</span>
          ${r.rating ? `<span class="stars-small" aria-label="Rated ${r.rating} of 5">${'★'.repeat(r.rating)}<span class="dim">${'★'.repeat(5 - r.rating)}</span></span>` : ''}
          ${facts.length ? `<span class="meta">${esc(facts.join(' · '))}</span>` : ''}
          <span class="badges">${recipeTags(S(), r).slice(0, 4).map(({ option }) => `<span class="badge">${esc(option.name)}</span>`).join('')}</span>
        </span>
      </button>
    </li>`;
}

// ---------- Your food list ----------

function foodFacts(f) {
  const n = f.nutrition || {};
  const parts = [];
  if (n.cal != null) parts.push(`${Math.round(n.cal)} kcal`);
  if (n.protein != null) parts.push(`${fmtNum(n.protein)} g protein`);
  return parts.length ? `${parts.join(' · ')} ${perLabel(f)}` : 'No nutrition yet';
}

function priceText(f) {
  const p = f.price;
  if (!p || p.amount == null || p.amount === '') return '';
  return `${money(Number(p.amount))} for ${[fmtQty(Number(p.qty ?? 1)), p.unit].filter(Boolean).join(' ')}`;
}

function renderFoods() {
  const q = ui.foodSearch.trim().toLowerCase();
  const list = S().foods
    .filter((f) => !q || `${f.name} ${f.brand || ''} ${(f.aliases || []).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  return `
    <header class="page-header">
      <h1>Foods</h1>
      <div class="btn-row">
        <button class="btn" data-act="receipt-open">Scan receipt</button>
        <button class="btn primary" data-act="food-add">+ Add</button>
      </div>
    </header>
    ${recipesSwitch()}
    <p class="hint">Foods you’ve looked up or typed in, with their nutrition, sizes and price. Recipes and quick-adds use these to fill in the numbers.</p>
    ${S().foods.length ? `
      <input id="foods-search" class="search spaced" type="search" placeholder="Search your foods" value="${esc(ui.foodSearch)}" autocomplete="off" />
      ${list.length ? `<ul class="food-list">${list.map((f) => `
        <li><button class="food-row" data-act="food-edit" data-id="${f.id}">
          <span class="entry-main">
            <span class="title">${esc(f.name)}${f.brand ? ` <span class="muted">· ${esc(f.brand)}</span>` : ''}</span>
            <span class="meta">${esc(foodFacts(f))}${priceText(f) ? ` · ${esc(priceText(f))}` : ''} ${trendBadge(f)}</span>
          </span>
          <span class="badge">${esc(f.section || 'Other')}</span>
        </button></li>`).join('')}</ul>` : '<p class="empty">No foods match.</p>'}
    ` : `
      <div class="card empty-card">
        <p><strong>No foods yet.</strong></p>
        <p class="hint flush">Search the free food databases, scan a barcode, or type a food in yourself.</p>
        <button class="btn primary" data-act="food-add">Add a food</button>
      </div>`}
  `;
}

// ---------- Shopping list ----------

function shopRange() {
  const from = ui.shopFrom || today();
  const days = Math.max(1, Math.min(31, Number(S().settings.shopDays) || 7));
  return { from, to: addDays(from, days - 1), days };
}

// The list, filtered by recipe, in groups by store section or by recipe.
function shopGroups() {
  const st = S();
  const { from, to } = shopRange();
  const list = shoppingList(st, from, to);
  const picked = ui.shopRecipes;
  const extras = (st.shopping?.extras || []).map((x) => ({
    key: `x:${x.id}`, extraId: x.id, name: x.name, amount: '', cost: null, recipes: [],
    section: x.section || guessSection(x.name), done: !!x.checked, extra: true,
  }));
  const keep = (i) => !picked.size || i.recipes.some((id) => picked.has(id)) || (picked.has('foods') && i.hasFoods);
  const atHome = list.items.filter((i) => i.atHome && keep(i));
  const items = list.items.filter((i) => !i.atHome && keep(i));
  const shownExtras = picked.size ? [] : extras;
  const order = (a, b) => (a.done - b.done) || a.name.localeCompare(b.name);
  let groups;
  if (ui.shopGroup === 'recipe') {
    groups = list.recipes.filter((r) => !picked.size || picked.has(r.recipe.id)).map(({ recipe, cooks }) => ({
      title: recipe.name,
      sub: cooks.map((c) => `${c.date ? shortDay(c.date) : 'not planned'}${c.scale !== 1 ? ` ×${fmtQty(c.scale)}` : ''}`).join(', '),
      items: items.filter((i) => i.recipes.includes(recipe.id)).map((i) => {
        // Just this recipe's share of the item.
        const parts = i.parts.filter((p) => p.recipeId === recipe.id);
        return { ...i, amount: amountText(parts, i.food), cost: null, share: true };
      }).sort(order),
    }));
    const foods = items.filter((i) => i.hasFoods).map((i) => ({ ...i, amount: amountText(i.parts.filter((p) => !p.recipeId), i.food), cost: null, share: true }));
    if (foods.length && (!picked.size || picked.has('foods'))) groups.push({ title: 'Other foods', sub: 'added to days', items: foods.sort(order) });
    if (shownExtras.length) groups.push({ title: 'Extra items', items: shownExtras.sort(order) });
  } else {
    const all = [...items, ...shownExtras];
    groups = SECTIONS.map((sec) => ({ title: sec, items: all.filter((i) => i.section === sec).sort(order) }));
    groups.push({ title: 'Other', items: all.filter((i) => !SECTIONS.includes(i.section)).sort(order) });
    groups = groups.filter((g) => g.items.length);
    // Merge the two "Other" groups if both exist.
    const others = groups.filter((g) => g.title === 'Other');
    if (others.length > 1) { others[0].items.push(...others[1].items); groups = groups.filter((g) => g !== others[1]); }
  }
  const visible = [...items, ...shownExtras];
  const open = visible.filter((i) => !i.done);
  return {
    list, groups, from, to, atHome, open,
    left: open.length,
    total: visible.length,
    cost: open.reduce((s, i) => s + (i.cost || 0), 0),
    unpriced: open.filter((i) => i.cost == null && !i.extra).length,
  };
}

function renderShop() {
  if (ui.shopView === 'pantry') return renderPantry();
  const st = S();
  const { from, to, days } = shopRange();
  const g = shopGroups();
  const recipeChips = g.list.recipes;
  const hasFoods = g.list.items.some((i) => i.hasFoods);
  return `
    <header class="page-header">
      <h1>Shopping</h1>
      ${g.total ? '<button class="btn small" data-act="shop-share">Copy list</button>' : ''}
    </header>
    ${shopSwitch()}
    ${renderListRecipes()}
    <div class="card shop-range">
      <div class="shop-range-row">
        <label class="field"><span>From</span><input id="shop-from" type="date" value="${from}" /></label>
        <label class="field"><span>Days</span><input id="shop-days" type="number" min="1" max="31" inputmode="numeric" value="${days}" /></label>
      </div>
      <p class="hint flush">${esc(shortDate(from))} – ${esc(shortDate(to))}. Each batch is bought for the day it’s cooked, so leftovers aren’t bought twice.</p>
    </div>
    <div class="seg small-seg">
      <button class="${ui.shopGroup !== 'recipe' ? 'on' : ''}" data-act="shop-group" data-group="section">By aisle</button>
      <button class="${ui.shopGroup === 'recipe' ? 'on' : ''}" data-act="shop-group" data-group="recipe">By recipe</button>
    </div>
    ${recipeChips.length > 1 || (recipeChips.length && hasFoods) ? `
      <div class="chips shop-filter">
        <button class="chip tiny${!ui.shopRecipes.size ? ' on' : ''}" data-act="shop-filter" data-id="">All</button>
        ${recipeChips.map(({ recipe }) => `<button class="chip tiny${ui.shopRecipes.has(recipe.id) ? ' on' : ''}" data-act="shop-filter" data-id="${recipe.id}">${esc(recipe.name)}</button>`).join('')}
        ${hasFoods ? `<button class="chip tiny${ui.shopRecipes.has('foods') ? ' on' : ''}" data-act="shop-filter" data-id="foods">Other foods</button>` : ''}
      </div>` : ''}
    ${g.total ? `
      <div class="shop-summary">
        <span><strong>${g.left}</strong> of ${g.total} left${g.cost ? ` · about <strong>${esc(money(g.cost))}</strong>` : ''}</span>
        ${g.left < g.total ? '<button class="link" data-act="shop-uncheck">Untick all</button>' : ''}
      </div>
      ${g.left ? '<button class="btn wide send-btn" data-act="shop-send">🛒 Send to Amazon or Instacart</button>' : ''}
      ${g.unpriced && g.cost ? `<p class="hint">${g.unpriced} item${g.unpriced === 1 ? ' has' : 's have'} no price, so the total leaves ${g.unpriced === 1 ? 'it' : 'them'} out.</p>` : ''}
      ${g.groups.map((grp) => `
        <h2 class="section">${esc(grp.title)}${grp.sub ? ` <span class="source">${esc(grp.sub)}</span>` : ''}</h2>
        <ul class="food-list shop-list">${grp.items.map(renderShopItem).join('')}</ul>`).join('')}
    ` : `<div class="card empty-card">
        <p><strong>${g.atHome.length ? 'You have everything at home.' : 'Nothing to buy for these days.'}</strong></p>
        <p class="hint flush">Plan some meals on the Plan tab and their ingredients show up here. You can also add things by hand below.</p>
      </div>`}
    ${g.atHome.length ? `
      <details class="at-home"${ui.atHomeOpen ? ' open' : ''}>
        <summary data-act="toggle-at-home">Already at home (${g.atHome.length})</summary>
        <ul class="food-list shop-list">${g.atHome.map((i) => `
          <li class="shop-item is-home">
            <span class="food-row static">
              <span class="home-dot" aria-hidden="true">✓</span>
              <span class="entry-main"><span class="title">${esc(i.name)}${i.amount ? ` <span class="amount">${esc(i.amount)}</span>` : ''}</span>
              <span class="meta">${esc(i.atHome.staple ? 'You always have this' : `In your pantry${i.atHome.until ? ` · use by ${shortDate(i.atHome.until)}` : ''}`)}</span></span>
            </span>
            <button class="btn small" data-act="pantry-need" data-id="${i.atHome.id}">Need it</button>
          </li>`).join('')}</ul>
      </details>` : ''}
    <form class="shop-add" data-form="shop-add">
      <input id="shop-extra" class="search" type="text" placeholder="Add an item, like paper towels" autocomplete="off" enterkeyhint="done" />
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${(st.shopping?.extras || []).some((x) => x.checked) ? '<p class="hint center"><button class="link" data-act="shop-clear-extras">Remove ticked extra items</button></p>' : ''}
    <p class="hint center"><button class="link" data-act="receipt-open">Back from the store? Scan the receipt to update prices</button></p>
  `;
}

// Recipes added to the list without planning them.
function renderListRecipes() {
  const adds = (S().shopping?.recipes || []).map((a) => ({ a, r: findRecipe(S(), a.recipeId) })).filter((x) => x.r);
  if (!adds.length) return '';
  return `
    <div class="card list-recipes">
      <span class="field-label">Also shopping for (not planned)</span>
      <ul class="mini-list">${adds.map(({ a, r }) => {
        const portions = Math.round(servingsOf(r) * (Number(a.scale) || 1) * 10) / 10;
        return `<li><button class="link-ish" data-act="view-recipe" data-id="${r.id}">${esc(r.name)}</button>
          <span class="meta">${fmtQty(portions)} portion${portions === 1 ? '' : 's'}</span>
          <button class="icon-btn small" data-act="shop-remove-recipe" data-id="${a.id}" aria-label="Take ${esc(r.name)} off the list">×</button></li>`;
      }).join('')}</ul>
    </div>`;
}

function renderShopItem(i) {
  const names = i.recipes.map((id) => findRecipe(S(), id)?.name).filter(Boolean);
  if (i.hasFoods && !i.share) names.push('added to a day');
  const meta = [
    i.share ? '' : names.join(', '),
    i.boughtSome && !i.done ? 'some bought already' : '',
  ].filter(Boolean).join(' · ');
  return `
    <li class="shop-item${i.done ? ' is-done' : ''}">
      <button class="food-row" data-act="shop-check" data-key="${esc(i.key)}" aria-pressed="${i.done}">
        <span class="check${i.done ? ' on' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <span class="entry-main">
          <span class="title">${esc(i.name)}${i.amount ? ` <span class="amount">${esc(i.amount)}</span>` : ''}</span>
          ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
        </span>
        ${i.cost != null && !i.share ? `<span class="price">${esc(money(i.cost))}</span>` : ''}
      </button>
      ${i.extra ? `<button class="icon-btn small" data-act="shop-remove-extra" data-id="${i.extraId}" aria-label="Remove ${esc(i.name)}">×</button>`
        : i.done ? '' : `<button class="have-btn" data-act="pantry-have" data-key="${esc(i.key)}" data-name="${esc(i.name)}" data-food="${i.food?.id || ''}" title="I have this at home" aria-label="I have ${esc(i.name)} at home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/></svg></button>`}
    </li>`;
}

function shopSwitch() {
  const n = (S().pantry || []).length;
  return `
    <div class="seg">
      <button class="${ui.shopView !== 'pantry' ? 'on' : ''}" data-act="shop-view" data-view="list">To buy</button>
      <button class="${ui.shopView === 'pantry' ? 'on' : ''}" data-act="shop-view" data-view="pantry">At home${n ? ` (${n})` : ''}</button>
    </div>`;
}

function renderPantry() {
  const t = today();
  const list = (S().pantry || []).slice().sort((a, b) => (b.staple ? 1 : 0) - (a.staple ? 1 : 0) || a.name.localeCompare(b.name));
  const staples = list.filter((p) => p.staple);
  const other = list.filter((p) => !p.staple).sort((a, b) => (a.until || '9999').localeCompare(b.until || '9999') || a.name.localeCompare(b.name));
  const row = (p) => {
    const soon = p.until && p.until <= addDays(t, 2);
    return `
      <li class="shop-item pantry-item">
        <span class="food-row static">
          <span class="entry-main">
            <span class="title">${esc(p.name)}</span>
            <span class="meta">
              <label class="mini-toggle"><input type="checkbox" data-pantry-staple="${p.id}" ${p.staple ? 'checked' : ''} /> Always have</label>
              ${p.staple ? '' : `<label class="mini-date${soon ? ' soon' : ''}">Use by <input type="date" data-pantry-until="${p.id}" value="${esc(p.until || '')}" /></label>`}
            </span>
          </span>
        </span>
        <button class="icon-btn small" data-act="pantry-remove" data-id="${p.id}" aria-label="Used up: remove ${esc(p.name)}">×</button>
      </li>`;
  };
  return `
    <header class="page-header"><h1>Shopping</h1></header>
    ${shopSwitch()}
    <p class="hint">Things you have at home are left off the shopping list. Tick <strong>Always have</strong> for staples like salt and oil. Add a <strong>use by</strong> date and the app suggests recipes to use it up.</p>
    <form class="shop-add top" data-form="pantry-add">
      <input id="pantry-name" class="search" type="text" placeholder="Add something you have, like rice" autocomplete="off" enterkeyhint="done" />
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${list.length ? `
      ${staples.length ? `<h2 class="section">Always have</h2><ul class="food-list shop-list">${staples.map(row).join('')}</ul>` : ''}
      ${other.length ? `<h2 class="section">In the pantry and fridge</h2><ul class="food-list shop-list">${other.map(row).join('')}</ul>` : ''}
    ` : '<p class="empty">Nothing here yet. You can also tap the house button next to an item on the shopping list.</p>'}
    ${list.length ? renderUseItUp(false) : ''}
  `;
}

function addToPantry(name, foodId = '', fields = {}) {
  const st = S();
  const clean = name.trim();
  if (!clean) return null;
  const key = itemKey(st, clean, foodId);
  const ex = st.pantry.find((p) => p.key === key || p.name.toLowerCase() === clean.toLowerCase());
  if (ex) return ex;
  const item = { id: uid(), name: clean, key, ...(foodId ? { foodId } : {}), staple: guessStaple(clean), until: null, addedAt: today(), ...fields };
  st.pantry.push(item);
  return item;
}

async function shareShopList() {
  const g = shopGroups();
  const groups = g.groups.map((grp) => ({ title: grp.title, items: grp.items.filter((i) => !i.done) })).filter((grp) => grp.items.length);
  if (!groups.length) { toast('Everything is ticked off'); return; }
  const text = listText(groups);
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Shopping list', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied. Paste it into Notes or a message.');
  } catch {
    prompt('Copy the list:', text);
  }
}

// ----- Sending the list to Amazon or Instacart -----

const amazonHost = () => S().settings.amazonHost || 'www.amazon.com';
const linkKeyFor = (name) => itemKey(S(), name);

function openSend() {
  openSheet({ kind: 'send', key: key(), picks: {} });
}

function sendRows(s) {
  return compareRows(S(), shopGroups().open, { picks: s.picks, keyFor: linkKeyFor });
}

function renderSend(s) {
  const rows = sendRows(s);
  const t = compareTotals(rows);
  const cur = S().settings.currency || '$';
  const storeCost = (n) => (n != null ? esc(money(n)) : '');
  const row = (r) => `
    <li class="send-row${r.pick === 'skip' ? ' is-skip' : ''}">
      <div class="send-top">
        <span class="title">${esc(r.name)}${r.amount ? ` <span class="amount">${esc(r.amount)}</span>` : ''}</span>
        ${r.estimate != null ? `<span class="meta">usually ${esc(money(r.estimate))}</span>` : ''}
      </div>
      <button class="send-store${r.pick === 'amazon' ? ' on' : ''}${r.cheaper === 'amazon' ? ' cheaper' : ''}" data-act="store-link" data-key="${esc(r.key)}">
        <span class="store-name">Amazon</span>
        <span class="store-what">${r.amazon ? `${esc(r.amazon.title || r.amazon.asin)}${r.qty > 1 ? ` <span class="amount">×${r.qty}</span>` : ''}` : '<span class="muted">Pick a product</span>'}</span>
        <span class="price">${r.cheaper === 'amazon' ? '<span class="cheaper-tag">cheaper</span>' : ''}${storeCost(r.amazonCost)}</span>
      </button>
      <div class="send-store${r.pick === 'instacart' ? ' on' : ''}${r.cheaper === 'instacart' ? ' cheaper' : ''}">
        <span class="store-name">Instacart</span>
        <button class="store-what link-ish" data-act="store-link" data-key="${esc(r.key)}">“${esc(r.instacart?.name || r.name)}”</button>
        <label class="price-in">${r.cheaper === 'instacart' ? '<span class="cheaper-tag">cheaper</span>' : ''}<span class="sr-only">Instacart price for ${esc(r.name)}</span>
          <input type="text" inputmode="decimal" placeholder="${esc(cur)} price" data-ic-price="${esc(r.linkKey)}" value="${r.instacartCost != null ? esc(r.instacartCost.toFixed(2)) : ''}" /></label>
      </div>
      <div class="seg small-seg send-pick">
        <button class="${r.pick === 'amazon' ? 'on' : ''}" data-act="send-pick" data-key="${esc(r.key)}" data-pick="amazon"${r.amazon ? '' : ' disabled'}>Amazon</button>
        <button class="${r.pick === 'instacart' ? 'on' : ''}" data-act="send-pick" data-key="${esc(r.key)}" data-pick="instacart">Instacart</button>
        <button class="${r.pick === 'skip' ? 'on' : ''}" data-act="send-pick" data-key="${esc(r.key)}" data-pick="skip">Skip</button>
      </div>
    </li>`;
  const diff = t.both.count ? Math.abs(t.both.amazon - t.both.instacart) : 0;
  return `
    <div class="sheet">
      ${sheetHeader('Send to a store')}
      <div class="sheet-body">
        ${!rows.length ? '<p class="empty">Everything is ticked off.</p>' : `
        <div class="card compare-card">
          <div class="compare-cols">
            <div><span class="field-label">Amazon</span>
              <strong>${t.amazon.linked ? esc(money(t.amazon.cost)) : '–'}</strong>
              <span class="meta">${t.amazon.linked} of ${rows.length} items have a product${t.amazon.unpriced ? `, ${t.amazon.unpriced} without a price` : ''}</span></div>
            <div><span class="field-label">Instacart</span>
              <strong>${t.instacart.priced ? esc(money(t.instacart.cost)) : '–'}</strong>
              <span class="meta">${t.instacart.priced ? `${t.instacart.priced} of ${rows.length} items priced` : 'Type in prices to compare'}</span></div>
          </div>
          ${t.both.count ? `<p class="hint flush">For the ${t.both.count} item${t.both.count === 1 ? '' : 's'} priced at both: Amazon ${esc(money(t.both.amazon))}, Instacart ${esc(money(t.both.instacart))}${diff >= 0.01 ? `. <strong>${t.both.amazon < t.both.instacart ? 'Amazon' : 'Instacart'} is ${esc(money(diff))} cheaper.</strong>` : '.'}</p>` : ''}
        </div>
        <p class="hint">Choose a store for each item. Tap an Amazon line to pick the product (the app remembers it). Instacart finds products itself; after opening the list there you can type its prices here to compare next time.</p>
        <ul class="send-list">${rows.map(row).join('')}</ul>
        <div class="send-actions">
          <button class="btn primary wide" data-act="send-amazon"${t.toAmazon.count ? '' : ' disabled'}>Add ${t.toAmazon.count} item${t.toAmazon.count === 1 ? '' : 's'} to Amazon cart${t.toAmazon.cost ? ` · ${esc(money(t.toAmazon.cost))}` : ''}</button>
          ${s.instacartUrl ? `<a class="btn primary wide" href="${esc(s.instacartUrl)}" target="_blank" rel="noopener">Open the list in Instacart</a>`
            : `<button class="btn wide" data-act="send-instacart"${t.toInstacart.count && !s.instacartBusy ? '' : ' disabled'}>${s.instacartBusy ? 'Making the Instacart list…' : `Make an Instacart list of ${t.toInstacart.count} item${t.toInstacart.count === 1 ? '' : 's'}`}</button>`}
          ${s.instacartError ? `<p class="hint error-text">${esc(s.instacartError)}</p>` : ''}
          ${s.sent?.length ? `<button class="btn wide" data-act="send-tick">Tick off the ${s.sent.length} item${s.sent.length === 1 ? '' : 's'} I sent</button>` : ''}
        </div>`}
      </div>
    </div>`;
}

function sendTo(s, store) {
  const rows = sendRows(s).filter((r) => r.pick === store);
  s.sent = [...new Set([...(s.sent || []), ...rows.map((r) => r.key)])];
  return rows;
}

function sendAmazon(s) {
  const rows = sendTo(s, 'amazon');
  if (!rows.length) return;
  const url = amazonCartUrl(amazonHost(), rows.map((r) => ({ asin: r.amazon.asin, qty: r.qty })));
  window.open(url, '_blank', 'noopener');
  renderSheet();
}

async function sendInstacart(s) {
  if (!sync.user) {
    s.instacartError = 'Instacart lists are made through your Supabase account, so sign in first (Settings → Sync).';
    renderSheet();
    return;
  }
  const rows = sendRows(s).filter((r) => r.pick === 'instacart');
  if (!rows.length) return;
  s.instacartBusy = true;
  s.instacartError = '';
  renderSheet();
  try {
    let res;
    try {
      res = await importFunction({ instacart: { title: `Meals: ${shortDate(shopRange().from)} – ${shortDate(shopRange().to)}`, items: instacartItems(rows) } });
    } catch {
      throw new Error(navigator.onLine ? 'Couldn’t reach the app’s Supabase function. See “Recipe import” in the README.' : 'You’re offline.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 501 || data.setup) throw new Error('Instacart isn’t set up yet. See “Instacart setup” in the app’s README: it needs a free Instacart developer key saved in Supabase.');
    if (!res.ok || !data.url) {
      if (data.error === 'Bad request' || res.status === 404) throw new Error('Update the recipe-import function in Supabase with the latest code (see “Instacart setup” in the README).');
      throw new Error(`Instacart didn’t make the list${data.error ? ` (${data.error})` : ''}.`);
    }
    s.instacartUrl = data.url;
    sendTo(s, 'instacart');
  } catch (err) {
    s.instacartError = err.message;
  }
  s.instacartBusy = false;
  if (top() === s) renderSheet();
}

function tickSent(s) {
  const st = S();
  const { to } = shopRange();
  for (const k of s.sent || []) {
    if (k.startsWith('x:')) {
      const x = st.shopping.extras.find((y) => y.id === k.slice(2));
      if (x) x.checked = true;
    } else setChecked(st, k, true, to);
  }
  const n = (s.sent || []).length;
  closeSheet();
  store.save();
  toast(`Ticked off ${n} item${n === 1 ? '' : 's'}`);
}

// Pick the Amazon product (and Instacart search) for one item.
function openStoreLink(itemKeyValue) {
  const r = sendRows(top()).find((x) => x.key === itemKeyValue);
  if (!r) return;
  const a = r.amazon || {};
  openSheet({
    kind: 'store-link', key: key(), linkKey: r.linkKey, name: r.name, amount: r.amount,
    draft: {
      paste: '', asin: a.asin || '', host: a.host || '', title: a.title || '', price: a.price ?? '', qty: r.amazon ? r.qty : 1,
      icName: r.instacart?.name || '', icPrice: r.instacart?.price ?? '',
    },
  });
}

function renderStoreLink(s) {
  const d = s.draft;
  const search = `https://${amazonHost()}/s?k=${encodeURIComponent(d.icName || s.name)}`;
  return `
    <div class="sheet">
      ${sheetHeader(s.name, { left: 'Cancel', right: 'Save', rightAct: 'store-link-save' })}
      <div class="sheet-body">
        ${s.amount ? `<p class="hint flush">The list needs ${esc(s.amount)}.</p>` : ''}
        <h2 class="section tight">Amazon</h2>
        <div class="card">
          ${d.asin ? `
            <label class="field"><span>Product</span><input type="text" data-bind="title" value="${esc(d.title)}" placeholder="${esc(d.asin)}" /></label>
            <div class="field-row">
              <label class="field"><span>Price (${esc(S().settings.currency || '$')})</span><input type="text" inputmode="decimal" data-bind="price" value="${esc(d.price)}" placeholder="Optional" /></label>
              <label class="field"><span>How many</span><input type="number" min="1" max="99" inputmode="numeric" data-bind="qty" data-num value="${esc(d.qty)}" /></label>
            </div>
            <p class="hint flush">Amazon product ${esc(d.asin)}. <a href="https://${esc(d.host || amazonHost())}/dp/${esc(d.asin)}" target="_blank" rel="noopener">See it on Amazon</a> · <button class="link" data-act="store-link-clear">Use a different product</button></p>
          ` : `
            <ol class="steps-help">
              <li><a href="${esc(search)}" target="_blank" rel="noopener">Search Amazon for “${esc(d.icName || s.name)}”</a> and open the product you want.</li>
              <li>Tap <strong>Share → Copy link</strong> (or copy the address) and paste it here.</li>
            </ol>
            <form class="shop-add" data-form="store-link-paste">
              <input id="amz-paste" class="search" type="text" placeholder="Paste the Amazon link" autocomplete="off" value="${esc(d.paste)}" />
              <button class="btn primary" type="submit"${s.busy ? ' disabled' : ''}>${s.busy ? 'Reading…' : 'Use it'}</button>
            </form>
          `}
          ${s.error ? `<p class="hint error-text">${esc(s.error)}</p>` : ''}
        </div>
        <h2 class="section tight">Instacart</h2>
        <div class="card">
          <label class="field"><span>Search Instacart for</span><input type="text" data-bind="icName" value="${esc(d.icName)}" placeholder="${esc(s.name)}" /></label>
          <label class="field"><span>Price you saw there (${esc(S().settings.currency || '$')})</span><input type="text" inputmode="decimal" data-bind="icPrice" value="${esc(d.icPrice)}" placeholder="Optional, for comparing" /></label>
          <p class="hint flush">Instacart picks the product at the store you choose. Add words like a brand or size to the search to steer it.</p>
        </div>
        ${getLink(S(), s.linkKey) ? '<p class="hint center"><button class="link danger" data-act="store-link-remove">Forget the store details for this item</button></p>' : ''}
      </div>
    </div>`;
}

async function useAmazonPaste(s) {
  const d = s.draft;
  d.paste = $('#amz-paste')?.value || d.paste;
  s.error = '';
  let link = parseAmazonLink(d.paste);
  if (!link) { s.error = 'That doesn’t look like an Amazon product link.'; renderSheet(); return; }
  let info = null;
  if (link.short || link.url) {
    // Ask the app's Supabase function to follow short links and read the name and price.
    if (sync.user) {
      s.busy = true;
      renderSheet();
      try {
        const res = await importFunction({ product: link.short || link.url });
        if (res.ok) info = await res.json();
      } catch { /* fine: fill it in by hand */ }
      s.busy = false;
    }
    if (link.short) {
      link = info?.url ? parseAmazonLink(info.url) : null;
      if (!link) {
        s.error = sync.user ? 'Couldn’t open that short link. Open it in Safari and copy the full address instead.' : 'Short a.co links need you to be signed in (Settings → Sync). Or open it and copy the full address.';
        if (top() === s) renderSheet();
        return;
      }
    }
  }
  d.asin = link.asin;
  d.host = link.host || '';
  d.title = (info?.title || titleFromAmazonUrl(link.url || info?.url || '') || d.title || '').slice(0, 160);
  if (info?.price) d.price = info.price;
  if (top() === s) renderSheet();
}

function saveStoreLink(s) {
  const st = S();
  const d = s.draft;
  const price = parsePrice(d.price);
  const icPrice = parsePrice(d.icPrice);
  const icName = String(d.icName || '').trim();
  setLink(st, s.linkKey, {
    amazon: d.asin ? { asin: d.asin, host: d.host || '', title: String(d.title || '').trim(), price, qty: Math.max(1, Math.round(Number(d.qty) || 1)) } : null,
    instacart: icName || icPrice != null ? { name: icName, price: icPrice } : null,
  });
  if (d.host && d.host !== amazonHost()) st.settings.amazonHost = d.host;
  closeSheet();
  store.save();
}

// ---------- Summary tab ----------

function summaryRange() {
  const anchor = ui.summaryAnchor || today();
  if (ui.summaryMode === 'week') {
    const from = startOfWeek(anchor, S().settings.weekStart);
    return { from, to: addDays(from, 6), label: `${shortDate(from)} – ${shortDate(addDays(from, 6))}` };
  }
  const d = fromKey(anchor);
  const from = dateKey(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  const to = dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
  return { from, to, label: monthName(from) };
}

function renderSummary() {
  if (ui.summaryMode === 'year') return renderYear();
  const { from, to, label } = summaryRange();
  const r = rangeTotals(S(), from, to);
  const tot = r.total;
  const planned = r.days.filter((d) => d.items);
  const nDays = planned.length || 1;
  const goals = S().settings.goals || {};
  return `
    <header class="page-header"><h1>Summary</h1></header>
    <div class="seg" role="tablist">
      <button class="${ui.summaryMode === 'week' ? 'on' : ''}" data-act="summary-mode" data-mode="week">Week</button>
      <button class="${ui.summaryMode === 'month' ? 'on' : ''}" data-act="summary-mode" data-mode="month">Month</button>
      <button class="${ui.summaryMode === 'year' ? 'on' : ''}" data-act="summary-mode" data-mode="year">Year in food</button>
    </div>
    <header class="day-header">
      <button class="icon-btn" data-act="summary-prev" aria-label="Previous">‹</button>
      <div class="day-title"><h2 class="range-title">${esc(label)}</h2></div>
      <button class="icon-btn" data-act="summary-next" aria-label="Next">›</button>
    </header>
    ${!tot.items ? '<p class="empty">Nothing planned in this period.</p>' : `
      <div class="tiles">
        <div class="tile"><span class="tile-label">Total cost</span><strong>${esc(money(tot.cost))}</strong><span class="tile-sub">${planned.length} day${planned.length === 1 ? '' : 's'} planned</span></div>
        <div class="tile"><span class="tile-label">Cost per day</span><strong>${esc(money(tot.cost / nDays))}</strong><span class="tile-sub">on planned days</span></div>
        <div class="tile"><span class="tile-label">Calories per day</span><strong>${esc(Math.round(tot.cal / nDays).toLocaleString())}</strong><span class="tile-sub">${goals.cal ? `goal ${Number(goals.cal).toLocaleString()}` : 'kcal'}</span></div>
        <div class="tile"><span class="tile-label">Protein per day</span><strong>${esc(grams(tot.protein / nDays))}</strong><span class="tile-sub">${goals.protein ? `goal ${grams(Number(goals.protein))}` : `${r.cooks} batch${r.cooks === 1 ? '' : 'es'} cooked`}</span></div>
      </div>
      ${tot.missingCost || tot.missingNutrition ? `<p class="hint">${[
        tot.missingCost ? `${tot.missingCost} item${tot.missingCost === 1 ? ' has' : 's have'} no price` : '',
        tot.missingNutrition ? `${tot.missingNutrition} no nutrition` : '',
      ].filter(Boolean).join(' and ')}, so the totals leave them out.</p>` : ''}
      <div class="card">
        <h2 class="section tight">Cost per day</h2>
        ${barChart(r.days, (d) => d.cost, (v) => money(v))}
      </div>
      <div class="card">
        <h2 class="section tight">Calories per day</h2>
        ${barChart(r.days, (d) => d.cal, (v) => kcal(v), Number(goals.cal) || 0)}
        ${goals.cal ? '<div class="legend"><span class="key bar-key"></span> Planned <span class="key goal-key"></span> Goal</div>' : ''}
      </div>
      <div class="card table-card">
        <table class="sum-table">
          <thead><tr><th>Day</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Cost</th></tr></thead>
          <tbody>
            ${planned.map((d) => `<tr>
              <td><button class="link" data-act="goto-day" data-date="${d.date}">${esc(shortDay(d.date))}</button></td>
              <td>${Math.round(d.cal).toLocaleString()}</td><td>${fmtNum(d.protein, 0)} g</td><td>${fmtNum(d.carbs, 0)} g</td><td>${fmtNum(d.fat, 0)} g</td>
              <td>${esc(money(d.cost))}</td></tr>`).join('')}
          </tbody>
          <tfoot><tr><th>Total</th><th>${Math.round(tot.cal).toLocaleString()}</th><th>${fmtNum(tot.protein, 0)} g</th><th>${fmtNum(tot.carbs, 0)} g</th><th>${fmtNum(tot.fat, 0)} g</th><th>${esc(money(tot.cost))}</th></tr></tfoot>
        </table>
      </div>
    `}
  `;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function renderYear() {
  const year = (ui.summaryAnchor || today()).slice(0, 4);
  const r = yearRecap(S(), year, today());
  const isNow = year === today().slice(0, 4);
  const top = r.topRecipes[0];
  const W = 640;
  const H = 150;
  const max = Math.max(1, ...r.months.map((m) => m.cost));
  const slot = W / 12;
  return `
    <header class="page-header"><h1>Summary</h1></header>
    <div class="seg" role="tablist">
      <button data-act="summary-mode" data-mode="week">Week</button>
      <button data-act="summary-mode" data-mode="month">Month</button>
      <button class="on" data-act="summary-mode" data-mode="year">Year in food</button>
    </div>
    <header class="day-header">
      <button class="icon-btn" data-act="summary-prev" aria-label="Previous year">‹</button>
      <div class="day-title"><h2 class="range-title">${esc(year)}${isNow ? ' so far' : ''}</h2></div>
      <button class="icon-btn" data-act="summary-next" aria-label="Next year" ${isNow ? 'disabled' : ''}>›</button>
    </header>
    ${!r.meals ? '<p class="empty">Nothing planned in this year yet.</p>' : `
      <div class="year-hero card">
        ${top ? `
          ${top.recipe?.photo && photoUrl(top.recipe.photo) ? `<img class="hero small" src="${esc(photoUrl(top.recipe.photo))}" alt="" />` : ''}
          <span class="tile-label">Your dish of the year</span>
          <strong class="year-dish">${esc(top.recipe?.name || '')}</strong>
          <span class="tile-sub">cooked ${top.count} time${top.count === 1 ? '' : 's'}, ${fmtQty(top.portions)} portion${top.portions === 1 ? '' : 's'} eaten</span>` : '<strong class="year-dish">A year of quick meals</strong>'}
      </div>
      <div class="tiles">
        <div class="tile"><span class="tile-label">Meals</span><strong>${r.meals.toLocaleString()}</strong><span class="tile-sub">on ${r.days} day${r.days === 1 ? '' : 's'}</span></div>
        <div class="tile"><span class="tile-label">Batches cooked</span><strong>${r.batches.toLocaleString()}</strong><span class="tile-sub">${r.newRecipes.length} new recipe${r.newRecipes.length === 1 ? '' : 's'} tried</span></div>
        <div class="tile"><span class="tile-label">Spent on food</span><strong>${esc(money(r.cost))}</strong><span class="tile-sub">${r.days ? `${esc(money(r.cost / r.days))} a day` : ''}</span></div>
        <div class="tile"><span class="tile-label">Busiest month</span><strong>${r.busiestMonth != null ? MONTHS[r.busiestMonth] : '–'}</strong><span class="tile-sub">${r.busiestMonth != null ? `${r.months[r.busiestMonth].meals} meals` : ''}</span></div>
      </div>
      <div class="card">
        <h2 class="section tight">Spent each month</h2>
        <svg class="chart" viewBox="0 0 ${W} ${H + 24}" role="img" aria-label="Cost per month">
          <line class="grid" x1="0" x2="${W}" y1="${H}" y2="${H}" />
          ${r.months.map((m, i) => {
            const h = (m.cost / max) * (H - 10);
            const x = i * slot + slot * 0.2;
            return `${h > 0 ? `<rect class="bar-fill" x="${x}" y="${H - h}" width="${slot * 0.6}" height="${h}" rx="3" />` : ''}
              <text class="axis" x="${x + slot * 0.3}" y="${H + 18}" text-anchor="middle">${MONTHS[i].slice(0, 1)}</text>
              <rect class="hit" x="${i * slot}" y="0" width="${slot}" height="${H}" data-tip="${esc(`${MONTHS[i]}: ${money(m.cost)}, ${m.meals} meals`)}" />`;
          }).join('')}
        </svg>
      </div>
      <div class="year-cols">
        ${r.topRecipes.length ? `<div class="card"><h2 class="section tight">Most cooked</h2><ol class="rank">${r.topRecipes.map((x) => `<li><button class="link" data-act="view-recipe" data-id="${x.recipe?.id}">${esc(x.recipe?.name || '')}</button> <span class="muted">${x.count}×</span></li>`).join('')}</ol></div>` : ''}
        ${r.topIngredients.length ? `<div class="card"><h2 class="section tight">Favourite ingredients</h2><ol class="rank">${r.topIngredients.map((x) => `<li>${esc(x.name)} <span class="muted">in ${x.count} batch${x.count === 1 ? '' : 'es'}</span></li>`).join('')}</ol></div>` : ''}
      </div>
      ${r.topRated || r.newRecipes.length ? `<div class="card">
        ${r.topRated ? `<p class="flush-p"><strong>Top rated:</strong> ${esc(r.topRated.name)} ${'★'.repeat(r.topRated.rating)}</p>` : ''}
        ${r.newRecipes.length ? `<p class="flush-p"><strong>New this year:</strong> ${esc(r.newRecipes.filter(Boolean).slice(0, 12).map((x) => x.name).join(', '))}${r.newRecipes.length > 12 ? '…' : ''}</p>` : ''}
        ${r.cal ? `<p class="flush-p"><strong>Calories planned:</strong> ${Math.round(r.cal).toLocaleString()} kcal${r.cal > 2000 * 30 ? `, about ${Math.round(r.cal / 2000)} days of a 2,000 kcal diet` : ''}</p>` : ''}
      </div>` : ''}
    `}
  `;
}

function barChart(days, value, fmt, goal = 0) {
  const W = 640;
  const H = 180;
  const padL = 8;
  const padB = 26;
  const vals = days.map(value);
  const max = Math.max(goal * 1.1, ...vals, 1);
  const n = days.length;
  const slot = (W - padL) / n;
  const bw = Math.max(4, Math.min(48, slot * 0.62));
  const y = (v) => H - padB - (v / max) * (H - padB - 10);
  const every = n > 14 ? 7 : 1;
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart per day">
      <line class="grid" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" />
      ${days.map((d, i) => {
        const x = padL + i * slot + (slot - bw) / 2;
        const v = vals[i] || 0;
        const h = Math.max(0, H - padB - y(v));
        const label = n > 14 ? String(fromKey(d.date).getDate()) : shortDay(d.date).slice(0, 3);
        return `
          ${h > 0 ? `<rect class="bar-fill" x="${x}" y="${y(v)}" width="${bw}" height="${h}" rx="3" />` : ''}
          ${i % every === 0 || n <= 14 ? `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(label)}</text>` : ''}
          <rect class="hit" x="${padL + i * slot}" y="0" width="${slot}" height="${H - padB}" data-tip="${esc(`${shortDay(d.date)}: ${v ? fmt(v) : 'nothing'}`)}" />`;
      }).join('')}
      ${goal ? `<line class="goal" x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke-dasharray="6 6" />` : ''}
    </svg>`;
}

// ---------- Settings tab ----------

function syncStatusText() {
  const st = sync.status;
  const pending = sync.pending();
  const time = st.lastSync ? new Date(st.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  switch (st.state) {
    case 'syncing': return 'Syncing…';
    case 'ok': return `Up to date${time ? ` · synced ${time}` : ''}`;
    case 'offline': return `Offline. ${pending ? `${pending} change${pending === 1 ? '' : 's'} will sync` : 'Changes will sync'} when you're back online.`;
    case 'error': return `Couldn't sync: ${st.error}`;
    default: return 'Waiting to sync…';
  }
}

function renderSyncCard() {
  const user = sync.user;
  if (user) {
    return `
    <div class="card">
      <h2 class="section tight">Sync</h2>
      <p class="flush-p">Signed in as <strong>${esc(user.email)}</strong></p>
      <p class="hint sync-status ${sync.status.state}" id="sync-status">${esc(syncStatusText())}</p>
      <div class="btn-row">
        <button class="btn" data-act="sync-now">Sync now</button>
        <button class="btn" data-act="sign-out">Sign out</button>
      </div>
    </div>`;
  }
  return `
    <div class="card">
      <h2 class="section tight">Sync</h2>
      <p class="hint">Sign in on your phone and computer to keep them in step. Use the same email and password as the to-do app. Everything still works offline and catches up later.</p>
      ${sync.status.error ? `<p class="form-msg error">${esc(sync.status.error)}</p>` : ''}
      <form class="sign-in" data-form="sign-in">
        <label class="field"><span>Email</span><input id="sync-email" type="email" autocomplete="username" required value="${esc(ui.syncEmail || '')}" /></label>
        <label class="field"><span>Password</span><input id="sync-password" type="password" autocomplete="current-password" minlength="6" required /></label>
        <p class="form-msg" id="sync-msg" hidden></p>
        <div class="btn-row">
          <button class="btn primary" type="submit">Sign in</button>
          <button class="btn" type="button" data-act="sign-up">Create account</button>
        </div>
      </form>
    </div>`;
}

async function syncAuth(kind) {
  const email = $('#sync-email')?.value.trim();
  const password = $('#sync-password')?.value || '';
  const msg = $('#sync-msg');
  const say = (text, isError) => { if (msg) { msg.textContent = text; msg.hidden = false; msg.classList.toggle('error', !!isError); } };
  if (!email || password.length < 6) { say('Enter your email and a password of at least 6 characters.', true); return; }
  ui.syncEmail = email;
  document.querySelectorAll('.sign-in button').forEach((b) => { b.disabled = true; });
  say(kind === 'up' ? 'Creating your account…' : 'Signing in…');
  try {
    if (kind === 'up') {
      const { confirm: needsConfirm } = await sync.signUp(email, password);
      if (needsConfirm) {
        say('Almost done: open the email from Supabase and tap the link, then come back and sign in here.');
        document.querySelectorAll('.sign-in button').forEach((b) => { b.disabled = false; });
        return;
      }
    } else {
      await sync.signIn(email, password);
    }
    render();
    toast('Signed in. Syncing is on.');
  } catch (e) {
    say(e instanceof TypeError ? 'No connection. Try again when you’re online.' : e.message, true);
    document.querySelectorAll('.sign-in button').forEach((b) => { b.disabled = false; });
  }
}

function renderSettings() {
  const st = S().settings;
  return `
    <header class="page-header"><h1>Settings</h1></header>

    ${renderSyncCard()}

    <div class="card">
      <h2 class="section tight">Meals in a day</h2>
      <ul class="edit-list">
        ${st.slots.map((s, i) => `
          <li>
            <input type="text" value="${esc(s.name)}" data-slot-name="${i}" aria-label="Meal name" />
            <button class="icon-btn small" data-act="slot-up" data-index="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn small" data-act="slot-remove" data-index="${i}" aria-label="Remove">×</button>
          </li>`).join('')}
      </ul>
      <button class="btn small" data-act="slot-add">+ Add a meal</button>
    </div>

    <div class="card">
      <h2 class="section tight">Daily goals (optional)</h2>
      <p class="hint flush">Shown on each day and in the summary.</p>
      <div class="nutri-inputs">
        ${NUTRIENTS.map((n) => `
          <label class="field"><span>${n.label} (${n.unit})</span>
            <input type="number" inputmode="decimal" min="0" value="${esc(st.goals?.[n.key] ?? '')}" data-goal="${n.key}" /></label>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2 class="section tight">Preferences</h2>
      <label class="field inline"><span class="wide-label">Currency symbol</span>
        <input type="text" maxlength="4" value="${esc(st.currency)}" data-setting="currency" /></label>
      <label class="field inline"><span class="wide-label">Week starts on</span>
        <select data-setting="weekStart">
          <option value="1" ${Number(st.weekStart) === 1 ? 'selected' : ''}>Monday</option>
          <option value="0" ${Number(st.weekStart) === 0 ? 'selected' : ''}>Sunday</option>
          <option value="6" ${Number(st.weekStart) === 6 ? 'selected' : ''}>Saturday</option>
        </select></label>
      <button class="btn" data-act="categories">Edit recipe categories</button>
    </div>

    <div class="card">
      <h2 class="section tight">Food lookup</h2>
      <p class="hint flush">Plain foods come from USDA. Without a key the app shares a small free allowance (about 30 searches an hour). For more, get a free key at <a class="link" href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov</a> and paste it here.</p>
      <label class="field"><span>USDA key (optional)</span>
        <input type="text" value="${esc(st.usdaKey || '')}" data-setting="usdaKey" autocomplete="off" spellcheck="false" placeholder="Leave empty to use the shared one" /></label>
    </div>

    <div class="card">
      <h2 class="section tight">Backup</h2>
      <p class="hint flush">A file with all your recipes and plans (photos aren’t included).</p>
      <div class="btn-row">
        <button class="btn" data-act="export">Download backup</button>
        <label class="btn">Restore backup<input type="file" accept="application/json,.json" data-file="import" hidden /></label>
      </div>
    </div>

    <div class="card">
      <h2 class="section tight">Install on iPhone</h2>
      <p class="hint flush">Open this page in Safari, tap the Share button, then <strong>Add to Home Screen</strong>. It then opens like a regular app and works offline.</p>
    </div>

    <div class="card">
      <button class="btn danger" data-act="erase">Erase all data on this device</button>
    </div>
  `;
}

// ---------- Sheets (pop-ups) ----------

function renderSheet() { keepTyping(renderSheetInner); }

function renderSheetInner() {
  const el = $('#sheet');
  const s = top();
  document.body.classList.toggle('modal-open', !!s);
  if (!s) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const scroll = $('.sheet-body', el)?.scrollTop || 0;
  const sameSheet = el.dataset.sheet === s.key;
  const html = {
    'recipe-view': renderRecipeView,
    'recipe-edit': renderRecipeEdit,
    add: renderAddSheet,
    entry: renderEntrySheet,
    food: renderFoodSheet,
    leftovers: renderLeftoversSheet,
    categories: renderCategoriesSheet,
    'food-search': renderFoodSearch,
    'food-edit': renderFoodEdit,
    scan: renderScan,
    cook: renderCookSheet,
    receipt: renderReceipt,
    autoplan: renderAutoPlan,
    surprise: renderSurprise,
    send: renderSend,
    'store-link': renderStoreLink,
  }[s.kind](s);
  el.innerHTML = html;
  el.dataset.sheet = s.key;
  // Slide in only when a new pop-up opens, not on every redraw.
  if (!sameSheet) el.firstElementChild?.classList.add('enter');
  if (sameSheet) { const b = $('.sheet-body', el); if (b) b.scrollTop = scroll; }
}

function sheetHeader(title, { left = 'Close', right = '', rightAct = '' } = {}) {
  return `
    <div class="sheet-header">
      <button class="link" data-act="sheet-close">${left}</button>
      <strong class="sheet-title">${esc(title)}</strong>
      ${right ? `<button class="link strong" data-act="${rightAct}">${right}</button>` : '<span class="spacer"></span>'}
    </div>`;
}

const key = () => uid();

// ----- Recipe view -----

function renderRecipeView(s) {
  const r = findRecipe(S(), s.id);
  if (!r) return `<div class="sheet">${sheetHeader('Recipe')}<div class="sheet-body"><p class="empty">This recipe was deleted.</p></div></div>`;
  const base = servingsOf(r);
  const servings = s.servings || base;
  const factor = servings / base;
  const ps = perServing(r);
  const cps = costPerServing(r);
  const hasNutrition = NUTRIENTS.some((n) => ps[n.key] != null && ps[n.key] !== '');
  const url = photoUrl(r.photo);
  return `
    <div class="sheet">
      ${sheetHeader('', { right: 'Edit', rightAct: 'edit-recipe' })}
      <div class="sheet-body">
        ${url ? `<img class="hero" src="${esc(url)}" alt="" />` : ''}
        <div class="title-row">
          <h1 class="recipe-title">${esc(r.name)}</h1>
          <button class="fav-btn${r.favorite ? ' on' : ''}" data-act="toggle-fav" data-id="${r.id}" aria-pressed="${!!r.favorite}" aria-label="Favourite">${r.favorite ? '★' : '☆'}</button>
        </div>
        ${starsInput(r)}
        <div class="badges">${recipeTags(S(), r).map(({ option }) => `<span class="badge">${esc(option.name)}</span>`).join('')}</div>
        <p class="facts">${[
          `Makes ${base} portion${base === 1 ? '' : 's'}`,
          r.minutes ? `${r.minutes} min` : '',
          r.cost != null && r.cost !== '' ? `${money(Number(r.cost))} in total (${money(cps)} a portion)` : '',
        ].filter(Boolean).map(esc).join(' · ')}</p>
        ${cookedLine(r)}
        ${r.steps?.length ? `<button class="btn primary wide cook-start" data-act="cook-start">Start cooking</button>` : ''}
        ${r.ingredients?.length ? (() => {
          const on = (S().shopping?.recipes || []).filter((a) => a.recipeId === r.id);
          return `<button class="btn wide" data-act="list-recipe">🛒 Add ${servings} portion${servings === 1 ? '' : 's'} to the shopping list</button>
            ${on.length ? `<p class="hint center">On the shopping list${on.length > 1 ? ` ${on.length} times` : ''} without a plan · <button class="link" data-act="unlist-recipe">Take it off</button></p>` : ''}`;
        })() : ''}

        <div class="card">
          <h2 class="section tight">Plan it</h2>
          <div class="plan-row">
            <input type="date" id="plan-date" value="${esc(s.planDate || today())}" />
            <select id="plan-slot">${slots().map((sl) => `<option value="${esc(sl.id)}" ${(s.planSlot || guessSlot(r)) === sl.id ? 'selected' : ''}>${esc(sl.name)}</option>`).join('')}</select>
            <button class="btn primary" data-act="plan-recipe">Add</button>
          </div>
        </div>

        ${hasNutrition ? `
        <div class="card">
          <h2 class="section tight">Per portion</h2>
          <div class="nutri-grid">
            ${NUTRIENTS.filter((n) => ps[n.key] != null && ps[n.key] !== '').map((n) => `<div class="nutri"><span class="nutri-label">${n.label}</span><strong>${esc(nutrientText(n.key, Number(ps[n.key])))}</strong></div>`).join('')}
          </div>
        </div>` : ''}

        ${r.ingredients?.length ? `
        <div class="card">
          <div class="card-head">
            <h2 class="section tight">Ingredients</h2>
            <div class="stepper" aria-label="Portions">
              <button class="icon-btn small" data-act="view-servings" data-delta="-1" aria-label="Fewer portions">−</button>
              <span>${servings} portion${servings === 1 ? '' : 's'}</span>
              <button class="icon-btn small" data-act="view-servings" data-delta="1" aria-label="More portions">+</button>
            </div>
          </div>
          <ul class="ing-list">${r.ingredients.map((i) => `<li>${esc(ingredientText(i, factor))}</li>`).join('')}</ul>
        </div>` : ''}

        ${r.steps?.length ? `
        <div class="card">
          <h2 class="section tight">Steps</h2>
          <ol class="step-list">${r.steps.map((st) => `<li>${esc(st)}${timerButtons(st, r.name)}</li>`).join('')}</ol>
        </div>` : ''}

        ${r.notes ? `<div class="card"><h2 class="section tight">Notes</h2><p class="notes">${esc(r.notes)}</p></div>` : ''}
        ${r.source ? `<p class="hint">Source: <a class="link" href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a></p>` : ''}
      </div>
    </div>`;
}

function starsInput(r, act = 'rate') {
  const n = r.rating || 0;
  return `<div class="stars" role="group" aria-label="Your rating">${[1, 2, 3, 4, 5].map((i) => `<button class="star${i <= n ? ' on' : ''}" data-act="${act}" data-id="${r.id}" data-stars="${i}" aria-label="${i} star${i === 1 ? '' : 's'}">★</button>`).join('')}</div>`;
}

function cookedLine(r) {
  const dates = cookDates(S(), r.id, today());
  if (!dates.length) return '<p class="hint flush">Not cooked yet.</p>';
  const last = dates[dates.length - 1];
  const ago = Math.round((Date.parse(`${today()}T12:00:00Z`) - Date.parse(`${last}T12:00:00Z`)) / 86400000);
  return `<p class="hint flush">Cooked ${dates.length} time${dates.length === 1 ? '' : 's'} · last ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`}</p>`;
}

function timerButtons(step, recipeName) {
  const ts = stepTimers(step);
  if (!ts.length) return '';
  return `<span class="step-timers">${ts.map((t) => `<button class="timer-btn" data-act="timer-start" data-seconds="${t.seconds}" data-label="${esc(`${recipeName}: ${t.label}`)}">⏱ ${esc(clockText(t.seconds))}</button>`).join('')}</span>`;
}

// ----- Cooking mode -----

function renderCookSheet(s) {
  const r = findRecipe(S(), s.id);
  if (!r) return `<div class="sheet">${sheetHeader('')}<div class="sheet-body"><p class="empty">This recipe was deleted.</p></div></div>`;
  const steps = r.steps || [];
  const i = Math.min(s.step || 0, steps.length);
  const done = i >= steps.length;
  const factor = (s.servings || servingsOf(r)) / servingsOf(r);
  return `
    <div class="sheet cook-sheet">
      ${sheetHeader(done ? 'Done!' : `Step ${i + 1} of ${steps.length}`, { left: 'Close' })}
      <div class="sheet-body">
        <div class="cook-progress"><span style="width:${Math.round((i / Math.max(1, steps.length)) * 100)}%"></span></div>
        <details class="paste cook-ings"${s.ingsOpen ? ' open' : ''}>
          <summary data-act="toggle-cook-ings">Ingredients${factor !== 1 ? ` (for ${s.servings} portions)` : ''}</summary>
          <ul class="ing-list">${(r.ingredients || []).map((g) => `<li>${esc(ingredientText(g, factor))}</li>`).join('')}</ul>
        </details>
        ${done ? `
          <div class="cook-done">
            <p class="cook-step">Enjoy your ${esc(r.name)}!</p>
            <p class="hint center">How was it?</p>
            <div class="center-row">${starsInput(r)}</div>
          </div>` : `
          <p class="cook-step">${esc(steps[i])}</p>
          ${timerButtons(steps[i], r.name).replace('step-timers', 'step-timers big')}`}
        <div class="cook-nav">
          <button class="btn" data-act="cook-step" data-delta="-1" ${i === 0 ? 'disabled' : ''}>‹ Back</button>
          ${done ? '<button class="btn primary" data-act="sheet-close">Finish</button>' : `<button class="btn primary" data-act="cook-step" data-delta="1">${i === steps.length - 1 ? 'Finish' : 'Next ›'}</button>`}
        </div>
        ${s.wakeLock === false ? '<p class="hint center">Your screen may turn off while cooking on this device.</p>' : ''}
      </div>
    </div>`;
}

let wakeLock = null;
async function keepScreenOn(on, s) {
  try {
    if (on && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      if (s) s.wakeLock = true;
    } else if (on && s) s.wakeLock = false;
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { if (s) s.wakeLock = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ui.sheets.some((x) => x.kind === 'cook')) keepScreenOn(true);
});

// ----- Kitchen timers -----

function startTimer(seconds, label) {
  ui.timers.push({ id: uid(), label, total: seconds, end: Date.now() + seconds * 1000, done: false });
  renderTimers();
  ensureTick();
  unlockSound();
}

let tick = null;
function ensureTick() {
  if (tick) return;
  tick = setInterval(() => {
    let rang = false;
    for (const t of ui.timers) {
      if (!t.done && !t.paused && t.end <= Date.now()) { t.done = true; rang = true; }
    }
    if (rang) ring();
    renderTimers();
    if (!ui.timers.length) { clearInterval(tick); tick = null; }
  }, 500);
}

function renderTimers() {
  let el = $('#timers');
  if (!el) {
    el = document.createElement('div');
    el.id = 'timers';
    el.className = 'timers';
    document.body.appendChild(el);
  }
  el.hidden = !ui.timers.length;
  el.innerHTML = ui.timers.map((t) => {
    const left = t.paused ? t.left : Math.max(0, (t.end - Date.now()) / 1000);
    return `
      <div class="timer${t.done ? ' ringing' : ''}">
        <span class="timer-label">${esc(t.label)}</span>
        <strong class="timer-clock">${t.done ? 'Done!' : esc(clockText(Math.ceil(left)))}</strong>
        ${t.done ? '' : `<button class="link" data-act="timer-pause" data-id="${t.id}">${t.paused ? 'Resume' : 'Pause'}</button>`}
        <button class="icon-btn small" data-act="timer-stop" data-id="${t.id}" aria-label="${t.done ? 'Dismiss' : 'Cancel timer'}">×</button>
      </div>`;
  }).join('');
}

let audio = null;
function unlockSound() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no sound on this device */ }
}
function ring() {
  try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* not supported */ }
  if (!audio) return;
  for (let k = 0; k < 3; k++) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(audio.destination);
    const at = audio.currentTime + k * 0.5;
    g.gain.setValueAtTime(0.001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    o.start(at); o.stop(at + 0.4);
  }
}

// ----- Surprise me -----

function surprisePool(s) {
  if (s.date) {
    // From a meal on the plan: recipes tagged for that meal, if any.
    const all = S().recipes;
    const forSlot = all.filter((r) => guessSlot(r) === s.slot);
    return forSlot.length ? forSlot : all;
  }
  return filterRecipes(S(), { search: ui.search, filter: ui.filter, favorites: ui.favOnly });
}

function spin(s) {
  const pool = surprisePool(s);
  const pick = pickSurprise(pool, S(), today(), { exclude: s.seen });
  if (!pick) { s.pick = null; renderSheet(); return; }
  s.seen = [...(s.seen || []), pick.id].slice(-Math.max(1, pool.length - 1));
  s.spinning = true;
  s.pick = pick.id;
  let n = 0;
  renderSheet();
  clearInterval(spin.t);
  spin.t = setInterval(() => {
    const el = $('#spin-name');
    if (!el) { clearInterval(spin.t); return; }
    el.textContent = pool[Math.floor(Math.random() * pool.length)].name;
    if (++n > 12) {
      clearInterval(spin.t);
      s.spinning = false;
      if (top() === s) renderSheet();
    }
  }, 70);
}

function renderSurprise(s) {
  const r = s.pick && findRecipe(S(), s.pick);
  const ps = r ? perServing(r) : {};
  const cps = r ? costPerServing(r) : null;
  const last = r ? lastCooked(S(), r.id, today()) : null;
  return `
    <div class="sheet">
      ${sheetHeader('Surprise me')}
      <div class="sheet-body surprise">
        ${!r ? '<p class="empty">No recipes to pick from. Add some recipes, or clear the filters.</p>' : s.spinning ? `
          <div class="spin-box"><span class="spin-die" aria-hidden="true">🎲</span><p id="spin-name" class="spin-name">${esc(r.name)}</p></div>` : `
          ${r.photo && photoUrl(r.photo) ? `<img class="hero" src="${esc(photoUrl(r.photo))}" alt="" />` : '<div class="spin-box"><span class="spin-die done" aria-hidden="true">🎲</span></div>'}
          <h1 class="recipe-title center">${esc(r.name)}</h1>
          <p class="facts center">${esc([
            r.minutes ? `${r.minutes} min` : '',
            ps.cal != null && ps.cal !== '' ? kcal(ps.cal) : '',
            cps != null ? `${money(cps)} a portion` : '',
            last ? `last made ${shortDate(last)}` : 'never made',
          ].filter(Boolean).join(' · '))}</p>
          <div class="btn-row center-row">
            <button class="btn" data-act="surprise-again">Spin again</button>
            ${s.date ? `<button class="btn primary" data-act="surprise-add">Add to ${esc(shortDay(s.date))}</button>`
              : `<button class="btn primary" data-act="view-recipe" data-id="${r.id}">Open recipe</button>`}
          </div>`}
      </div>
    </div>`;
}

// ----- Use it up -----

function renderUseItUp(compact) {
  const soon = useSoon(S(), today());
  if (compact && !soon.length) return '';
  const ideas = useItUp(S(), today(), { limit: compact ? 3 : 6 });
  if (compact && !ideas.some((x) => x.urgent.length)) {
    return `<div class="card use-up"><p class="flush-p"><strong>Use it up:</strong> ${esc(soon.map((p) => `${p.name} (by ${shortDay(p.until)})`).join(', '))}. None of your recipes use ${soon.length === 1 ? 'it' : 'them'} yet.</p></div>`;
  }
  if (!ideas.length) return '';
  return `
    <div class="card use-up">
      ${compact ? `<p class="flush-p"><strong>Use it up:</strong> ${esc(soon.map((p) => `${p.name} (by ${shortDay(p.until)})`).join(', '))}</p>` : '<h2 class="section tight">Recipes that use what you have</h2>'}
      <ul class="pick-list">${ideas.map((x) => `
        <li><button class="pick" data-act="view-recipe" data-id="${x.recipe.id}">
          ${thumb(x.recipe.photo)}
          <span class="entry-main"><span class="title">${esc(x.recipe.name)}</span>
          <span class="meta">uses ${esc(x.uses.map((p) => p.name).join(', '))}${x.urgent.length ? ' <span class="badge warn">soon</span>' : ''}</span></span>
        </button></li>`).join('')}</ul>
    </div>`;
}

// ----- Auto-plan -----

function fitsSlot(r, slotId) {
  const mealGroup = S().categories.find((g) => g.id === 'meal' || /^meal/i.test(g.name));
  const tagged = mealGroup && (r.tags || []).some((t) => mealGroup.options.some((o) => o.id === t));
  if (tagged) {
    const names = recipeTags(S(), r).map(({ option }) => option.name.toLowerCase());
    const slot = slots().find((x) => x.id === slotId);
    const n = (slot?.name || '').toLowerCase();
    if (names.some((x) => x === n || `${x}s` === n || x === `${n}s`)) return true;
    // A dinner recipe is fine for lunch too.
    if (/lunch/.test(n) && names.includes('dinner')) return true;
    return guessSlot(r) === slotId;
  }
  const n = (slots().find((x) => x.id === slotId)?.name || '').toLowerCase();
  return !/breakfast|snack|dessert/.test(n);
}

function openAutoPlan() {
  const days = weekDays(ui.week, today());
  const sl = slots().filter((x) => /dinner/i.test(x.name)).map((x) => x.id);
  const sh = {
    kind: 'autoplan', key: key(),
    days: days.length ? days : daysBetween(ui.week, addDays(ui.week, 6)),
    slots: sl.length ? sl : [slots()[slots().length - 1].id],
    leftovers: true, budgetText: S().settings.planBudget || '', plan: null,
  };
  openSheet(sh);
  suggestPlan(sh);
}

function suggestPlan(s) {
  s.plan = autoPlan(S(), {
    days: s.days.slice().sort(), slots: s.slots, today: today(), fits: fitsSlot,
    leftovers: s.leftovers, budget: parseQty(String(s.budgetText || '')) || null,
  });
  renderSheet();
}

function renderAutoPlan(s) {
  const all = daysBetween(ui.week, addDays(ui.week, 6));
  const tot = s.plan ? planTotals(S(), s.plan) : null;
  const byDay = {};
  for (const p of s.plan || []) (byDay[p.date] ||= []).push(p);
  const order = Object.fromEntries(slots().map((x, i) => [x.id, i]));
  return `
    <div class="sheet">
      ${sheetHeader('Auto-plan', { left: 'Cancel', right: s.plan?.length ? 'Add to plan' : '', rightAct: 'autoplan-apply' })}
      <div class="sheet-body">
        <p class="hint flush">Fills the empty meals with your recipes: favourites and dishes you haven’t had in a while, recipes that share ingredients (less waste), things in your pantry that need using, and your calorie goal and budget.</p>
        <div class="card">
          <span class="field-label">Days</span>
          <div class="chips">${all.map((d) => `<button class="chip tiny${s.days.includes(d) ? ' on' : ''}" data-act="ap-day" data-date="${d}">${esc(shortDay(d).split(',')[0])}</button>`).join('')}</div>
          <span class="field-label">Meals</span>
          <div class="chips">${slots().map((x) => `<button class="chip tiny${s.slots.includes(x.id) ? ' on' : ''}" data-act="ap-slot" data-slot="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>
          <label class="field row"><input type="checkbox" id="ap-leftovers" ${s.leftovers ? 'checked' : ''} /> <span>Cook once, eat leftovers on the next days</span></label>
          <label class="field inline"><span class="wide-label">Budget for these meals (${esc(S().settings.currency)})</span>
            <input type="text" inputmode="decimal" id="ap-budget" value="${esc(s.budgetText)}" placeholder="Optional" /></label>
        </div>
        ${!s.plan ? '' : !s.plan.length ? '<p class="empty">Nothing to fill: those meals are already planned.</p>' : `
          <div class="card-head"><h2 class="section tight">Suggested</h2><button class="btn small" data-act="autoplan-shuffle">↻ Shuffle</button></div>
          <p class="hint flush">${esc([
            `${s.plan.filter((p) => p.type === 'cook').length} to cook, ${s.plan.filter((p) => p.type === 'leftover').length} leftovers`,
            tot.cost ? `about ${money(tot.cost)}${tot.unpriced ? ' (some without a price)' : ''}` : '',
          ].filter(Boolean).join(' · '))}</p>
          ${Object.keys(byDay).sort().map((d) => `
            <div class="ap-day">
              <strong>${esc(shortDay(d))}</strong>
              <ul class="mini-list">${byDay[d].sort((a, b) => (order[a.slot] ?? 9) - (order[b.slot] ?? 9)).map((p) => {
                const r = findRecipe(S(), p.recipeId);
                return `<li>${esc(slotName(p.slot))}: ${esc(r?.name || '')} ${p.type === 'leftover' ? '<span class="badge">Leftovers</span>' : '<span class="badge cook">Cook</span>'}</li>`;
              }).join('')}</ul>
            </div>`).join('')}`}
      </div>
    </div>`;
}

function applyAutoPlan(s) {
  const st = S();
  const made = [];
  for (const p of s.plan) {
    if (p.type === 'cook') {
      made.push({ p, e: addEntry(st, p.date, { type: 'cook', slot: p.slot, recipeId: p.recipeId, scale: 1 }) });
    } else {
      const src = made.find((m) => m.p === s.plan[p.from]);
      if (src) made.push({ p, e: addEntry(st, p.date, { type: 'leftover', slot: p.slot, recipeId: p.recipeId, from: refOf(src.p.date, src.e.id) }) });
    }
  }
  st.settings.planBudget = s.budgetText || '';
  ui.sheets.pop();
  store.save();
  renderSheet();
  toast(`Planned ${made.length} meal${made.length === 1 ? '' : 's'}`);
}

// A recipe tagged Breakfast goes to breakfast, and so on; otherwise dinner.
function guessSlot(r) {
  const names = recipeTags(S(), r).map(({ option }) => option.name.toLowerCase());
  for (const sl of slots()) {
    const n = sl.name.toLowerCase();
    if (names.some((x) => x === n || `${x}s` === n || x === `${n}s`)) return sl.id;
  }
  if (names.includes('dessert') || names.includes('snack')) {
    const sn = slots().find((sl) => /snack|dessert/i.test(sl.name));
    if (sn) return sn.id;
  }
  return slots().find((sl) => /dinner/i.test(sl.name))?.id || slots()[slots().length - 1]?.id;
}

// ----- Recipe editor -----

function draftFrom(r) {
  const d = JSON.parse(JSON.stringify(r || blankRecipe()));
  d.ingredients = (d.ingredients || []).map((i) => ({ ...i, qtyText: i.qty != null ? fmtQty(i.qty) : '' }));
  d.steps = (d.steps || []).slice();
  d.nutrition = { ...(d.nutrition || {}) };
  if (!d.ingredients.length) d.ingredients.push({ id: uid(), qtyText: '', unit: '', name: '' });
  if (!d.steps.length) d.steps.push('');
  return d;
}

function renderRecipeEdit(s) {
  const d = s.draft;
  const url = photoUrl(d.photo);
  const cost = parseQty(d.costText ?? (d.cost ?? ''));
  const servings = Math.max(1, Number(d.servings) || 1);
  const calc = recipeFromIngredients(S(), draftAsRecipe(d));
  const rowFor = (ing) => calc.rows.find((r) => r.ing.id === ing.id);
  return `
    <div class="sheet">
      ${sheetHeader(d.id ? 'Edit recipe' : 'New recipe', { left: 'Cancel', right: 'Save', rightAct: 'save-recipe' })}
      <div class="sheet-body">
        ${d.id ? '' : renderImportCard(s)}
        <label class="field"><span>Name</span>
          <input type="text" id="ed-name" data-bind="name" value="${esc(d.name)}" placeholder="e.g. Chili" autocomplete="off" /></label>

        <div class="photo-field">
          ${url ? `<img class="hero small" src="${esc(url)}" alt="" />` : ''}
          <div class="btn-row">
            <label class="btn small">${d.photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" data-file="photo" hidden /></label>
            ${d.photo ? '<button class="btn small danger" data-act="remove-photo">Remove</button>' : ''}
          </div>
          ${s.photoBusy ? '<p class="hint flush">Saving photo…</p>' : ''}
        </div>

        <div class="two-col">
          <label class="field"><span>Makes (portions)</span>
            <input type="number" inputmode="numeric" min="1" step="1" data-bind="servings" data-num value="${esc(d.servings)}" /></label>
          <label class="field"><span>Time (minutes)</span>
            <input type="number" inputmode="numeric" min="0" data-bind="minutes" data-num data-optional value="${esc(d.minutes ?? '')}" placeholder="Optional" /></label>
        </div>

        <div class="card">
          <h2 class="section tight">Categories</h2>
          ${S().categories.map((g) => `
            <div class="filter-group">
              <span class="field-label">${esc(g.name)}</span>
              <div class="chips">${g.options.map((o) => `<button class="chip tiny${d.tags.includes(o.id) ? ' on' : ''}" data-act="ed-tag" data-option="${o.id}">${esc(o.name)}</button>`).join('')}</div>
            </div>`).join('')}
          <button class="link small-link" data-act="categories">Edit categories</button>
        </div>

        <div class="card">
          <h2 class="section tight">Ingredients</h2>
          <ul class="ed-ings">
            ${d.ingredients.map((i, n) => `
              <li>
                <input type="text" class="qty" inputmode="decimal" placeholder="Qty" data-bind="ingredients.${n}.qtyText" data-recalc value="${esc(i.qtyText)}" aria-label="Amount" />
                <input type="text" class="unit" placeholder="Unit" data-bind="ingredients.${n}.unit" data-recalc value="${esc(i.unit)}" aria-label="Unit" list="units" />
                <input type="text" class="name" placeholder="Ingredient" data-bind="ingredients.${n}.name" data-recalc value="${esc(i.name)}" aria-label="Ingredient" />
                ${ingStatus(rowFor(i), n)}
                <button class="icon-btn small" data-act="ed-remove-ing" data-index="${n}" aria-label="Remove">×</button>
              </li>`).join('')}
          </ul>
          <datalist id="units">${['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'oz', 'lb', 'clove', 'can', 'piece', 'slice', 'pinch'].map((u) => `<option value="${u}">`).join('')}</datalist>
          <div class="btn-row">
            <button class="btn small" data-act="ed-add-ing">+ Ingredient</button>
          </div>
          <details class="paste"${s.pasteIngOpen ? ' open' : ''}>
            <summary data-act="toggle-paste-ing">Paste a list</summary>
            <textarea rows="5" id="paste-ings" placeholder="One per line, e.g.&#10;500 g ground beef&#10;1 can kidney beans&#10;2 tbsp chili powder">${esc(s.pasteIngs || '')}</textarea>
            <button class="btn small" data-act="ed-paste-ings">Add these</button>
          </details>
        </div>

        <div class="card">
          <h2 class="section tight">Steps</h2>
          <ol class="ed-steps">
            ${d.steps.map((st, n) => `
              <li>
                <textarea rows="2" data-bind="steps.${n}" placeholder="Step ${n + 1}">${esc(st)}</textarea>
                <button class="icon-btn small" data-act="ed-remove-step" data-index="${n}" aria-label="Remove">×</button>
              </li>`).join('')}
          </ol>
          <div class="btn-row"><button class="btn small" data-act="ed-add-step">+ Step</button></div>
          <details class="paste"${s.pasteStepsOpen ? ' open' : ''}>
            <summary data-act="toggle-paste-steps">Paste steps</summary>
            <textarea rows="5" id="paste-steps" placeholder="One step per line">${esc(s.pasteSteps || '')}</textarea>
            <button class="btn small" data-act="ed-paste-steps">Add these</button>
          </details>
        </div>

        <div class="card">
          <h2 class="section tight">Nutrition per portion</h2>
          ${renderCalcBox(calc)}
          <div class="nutri-inputs">
            ${NUTRIENTS.map((n) => `
              <label class="field"><span>${n.label} (${n.unit})</span>
                <input type="number" inputmode="decimal" min="0" step="any" data-bind="nutrition.${n.key}" data-num data-optional value="${esc(d.nutrition[n.key] ?? '')}" /></label>`).join('')}
          </div>
        </div>

        <div class="card">
          <h2 class="section tight">Price</h2>
          <label class="field"><span>Cost of the whole recipe (${esc(S().settings.currency)})</span>
            <input type="text" inputmode="decimal" data-bind="costText" data-rerender value="${esc(d.costText ?? (d.cost ?? ''))}" placeholder="e.g. 12.50" /></label>
          ${cost != null ? `<p class="hint flush">${esc(money(cost / servings))} a portion</p>` : ''}
        </div>

        <label class="field"><span>Notes</span>
          <textarea rows="3" data-bind="notes" placeholder="Optional">${esc(d.notes)}</textarea></label>
        <label class="field"><span>Link to the original</span>
          <input type="url" data-bind="source" value="${esc(d.source)}" placeholder="Optional" /></label>

        ${d.id ? '<button class="btn danger wide" data-act="delete-recipe">Delete recipe</button>' : ''}
      </div>
    </div>`;
}

// ----- Importing a recipe -----

function renderImportCard(s) {
  return `
    <div class="card import-card">
      <h2 class="section tight">Import a recipe</h2>
      <form class="import-row" data-form="import-url">
        <input type="url" id="import-url" placeholder="Paste a link to a recipe" value="${esc(s.importUrl || '')}" autocomplete="off" enterkeyhint="go" ${s.importBusy ? 'disabled' : ''} />
        <button class="btn primary small" type="submit" ${s.importBusy ? 'disabled' : ''}>${s.importBusy ? 'Reading…' : 'Import'}</button>
      </form>
      ${s.importError ? `<p class="hint flush error-text">${esc(s.importError)}</p>` : ''}
      ${s.importDone ? `<p class="hint flush">${esc(s.importDone)}</p>` : ''}
      <details class="paste"${s.pasteAllOpen ? ' open' : ''}>
        <summary data-act="toggle-paste-all">Or paste the whole recipe text</summary>
        <textarea rows="7" id="paste-all" placeholder="Copy the recipe from the page, with its “Ingredients” and “Instructions” headings, and paste it here.">${esc(s.pasteAll || '')}</textarea>
        <button class="btn small" data-act="import-text">Fill in</button>
      </details>
    </div>`;
}

// Fills the editor from an imported recipe.
function applyImport(s, r) {
  const d = s.draft;
  if (r.name) d.name = r.name;
  if (r.servings) d.servings = r.servings;
  if (r.minutes) d.minutes = r.minutes;
  if (r.ingredients.length) {
    d.ingredients = r.ingredients.map((i) => ({ id: uid(), qtyText: i.qty != null ? fmtQty(i.qty) : '', unit: i.unit, name: i.name }));
  }
  if (r.steps.length) d.steps = r.steps.slice();
  for (const [k, v] of Object.entries(r.nutrition || {})) d.nutrition[k] = v;
  if (r.notes && !d.notes) d.notes = r.notes;
  if (r.source) d.source = r.source;
  const got = [
    r.ingredients.length ? `${r.ingredients.length} ingredients` : '',
    r.steps.length ? `${r.steps.length} steps` : '',
    Object.keys(r.nutrition || {}).length ? 'nutrition' : '',
  ].filter(Boolean);
  s.importDone = got.length ? `Filled in ${got.join(', ')}. Check it over, then save.` : 'Filled in what it could find. Check it over, then save.';
  s.importError = '';
}

function hasContent(d) {
  return d.name.trim() || d.ingredients.some((i) => i.name.trim()) || d.steps.some((x) => x.trim());
}

async function importFunction(body) {
  const res = await sync.fileRequest('/functions/v1/recipe-import', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });
  return res;
}

async function importFromUrl(s) {
  const url = (s.importUrl || '').trim();
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) { s.importError = 'That doesn’t look like a web address.'; renderSheet(); return; }
  if (!sync.user) {
    s.importError = 'Importing from a link needs you to be signed in (Settings → Sync). You can paste the recipe text below instead.';
    s.pasteAllOpen = true;
    renderSheet();
    return;
  }
  if (hasContent(s.draft) && !confirm('Replace what’s in the editor with the imported recipe?')) return;
  s.importBusy = true;
  s.importError = '';
  s.importDone = '';
  renderSheet();
  try {
    let res;
    try {
      res = await importFunction({ url });
    } catch {
      throw new Error(navigator.onLine
        ? 'Couldn’t reach the import service. Check that it’s set up in Supabase with “Verify JWT” turned off (see “Recipe import” in the app’s README).'
        : 'You’re offline.');
    }
    if (res.status === 404) throw new Error('The import service isn’t set up yet. See “Recipe import” in the app’s README for the one-time setup.');
    if (res.status === 401) throw new Error('The import service didn’t accept your sign-in. Sign out and in again under Settings → Sync, and check that “Verify JWT” is off for the recipe-import function in Supabase.');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Couldn’t read that page${data.error ? ` (${data.error})` : ''}. Try pasting the recipe text below instead.`);
    const r = fromPage(data);
    if (!r) throw new Error('Couldn’t find a recipe on that page. Try pasting the recipe text below instead.');
    applyImport(s, r);
    if (r.image) {
      s.photoBusy = true;
      renderSheet();
      try {
        const img = await importFunction({ image: r.image });
        if (img.ok) s.draft.photo = await savePhoto(await img.blob());
      } catch { /* the recipe is still fine without its photo */ }
      s.photoBusy = false;
    }
  } catch (err) {
    s.importError = err.message;
    if (/paste/.test(err.message)) s.pasteAllOpen = true;
  }
  s.importBusy = false;
  if (top() === s) renderSheet();
}

function importFromText(s) {
  const text = $('#paste-all')?.value || '';
  const r = fromText(text);
  if (!r.ingredients.length && !r.steps.length) {
    s.importError = 'Couldn’t find the “Ingredients” and “Instructions” headings in that text. You can also paste the ingredients and steps separately further down.';
    renderSheet();
    return;
  }
  if (hasContent(s.draft) && !confirm('Replace what’s in the editor with the pasted recipe?')) return;
  applyImport(s, r);
  s.pasteAll = '';
  s.pasteAllOpen = false;
  renderSheet();
}

function draftAsRecipe(d) {
  return {
    servings: d.servings,
    ingredients: d.ingredients.map((i) => ({ ...i, qty: parseQty(i.qtyText) })),
  };
}

// The small ✓ / Find button next to an ingredient.
function ingStatus(row, n) {
  if (!row) return '<span class="ing-status"></span>';
  if (row.nutrition) {
    return `<button class="ing-status ok" data-act="ing-find" data-index="${n}" data-tip="${esc(`${row.food.name}: ${Math.round(row.nutrition.cal || 0)} kcal${row.cost != null ? `, ${money(row.cost)}` : ''}`)}" aria-label="Matched: ${esc(row.food.name)}">✓</button>`;
  }
  return `<button class="ing-status find" data-act="ing-find" data-index="${n}" data-tip="${esc(row.problem)}" aria-label="Find food">${row.food ? '?' : 'Find'}</button>`;
}

function renderCalcBox(calc) {
  const total = calc.rows.length;
  if (!total) return '';
  const pp = calc.perPortion;
  const left = calc.rows.filter((r) => !r.nutrition);
  return `
    <div class="calc-box">
      ${calc.counted ? `
        <p class="flush-p"><strong>From your ingredients:</strong> ${esc(kcal(pp.cal))} · ${esc(grams(pp.protein))} protein · ${esc(grams(pp.carbs))} carbs · ${esc(grams(pp.fat))} fat a portion${calc.totalCost != null ? `, ${esc(money(calc.totalCost))} for the whole recipe${calc.priced < calc.counted ? ` (only ${calc.priced} of ${calc.counted} ingredients have a price)` : ''}` : ''}.</p>
        <p class="hint flush">${calc.counted} of ${total} ingredients counted${left.length ? `. Not counted: ${left.map((r) => `${esc(r.ing.name)} (${esc(r.problem)})`).join(', ')}` : ''}.</p>
        <button class="btn small" data-act="ed-use-calc">Use these numbers</button>`
        : `<p class="hint flush">Tap <strong>Find</strong> next to an ingredient to look it up. Once they’re matched, the nutrition and price work themselves out.</p>`}
    </div>`;
}

function saveRecipe(s) {
  const d = s.draft;
  if (!d.name.trim()) { alert('Give the recipe a name first.'); $('#ed-name')?.focus(); return; }
  const nutrition = {};
  for (const n of NUTRIENTS) {
    const v = d.nutrition[n.key];
    if (v != null && v !== '' && Number.isFinite(Number(v))) nutrition[n.key] = Number(v);
  }
  const fields = {
    name: d.name.trim(),
    servings: Math.max(1, Math.round(Number(d.servings) || 1)),
    minutes: d.minutes ? Math.max(0, Math.round(Number(d.minutes))) : null,
    photo: d.photo || null,
    tags: d.tags,
    ingredients: d.ingredients
      .filter((i) => i.name.trim())
      .map((i) => ({
        id: i.id || uid(), qty: parseQty(i.qtyText), unit: (i.unit || '').trim(), name: i.name.trim(), ...(i.foodId ? { foodId: i.foodId } : {}),
      })),
    steps: d.steps.map((x) => x.trim()).filter(Boolean),
    nutrition,
    cost: parseQty(d.costText ?? (d.cost ?? '')),
    source: (d.source || '').trim(),
    notes: (d.notes || '').trim(),
    updatedAt: Date.now(),
  };
  let id = d.id;
  if (id) Object.assign(findRecipe(S(), id), fields);
  else {
    id = uid();
    S().recipes.push({ id, createdAt: Date.now(), ...fields });
  }
  ui.sheets.pop();
  // A new recipe opens so you can plan it right away.
  if (!d.id && !top()) ui.sheets.push({ kind: 'recipe-view', id, key: key() });
  store.save();
  renderSheet();
}

// ----- Add to a day -----

function renderAddSheet(s) {
  const title = `${shortDay(s.date)} · ${slotName(s.slot)}`;
  if (s.choose) return renderChooseBatch(s, title);
  const body = s.mode === 'food' ? renderAddFood(s) : renderAddRecipe(s);
  return `
    <div class="sheet">
      ${sheetHeader(title, { left: 'Cancel' })}
      <div class="sheet-body">
        <div class="seg">
          <button class="${s.mode !== 'food' ? 'on' : ''}" data-act="add-mode" data-mode="recipe">Recipe</button>
          <button class="${s.mode === 'food' ? 'on' : ''}" data-act="add-mode" data-mode="food">Food</button>
        </div>
        ${body}
      </div>
    </div>`;
}

function renderAddRecipe(s) {
  const q = (s.search || '').trim().toLowerCase();
  const batches = [];
  const seen = new Set();
  for (const r of S().recipes) {
    for (const b of openBatches(S(), r.id, s.date)) {
      if (!seen.has(b.entry.id)) { seen.add(b.entry.id); batches.push({ recipe: r, ...b }); }
    }
  }
  const list = filterRecipes(S(), { search: s.search || '' });
  return `
    ${batches.length && !q ? `
      <h2 class="section">Leftovers you have</h2>
      <ul class="pick-list">
        ${batches.map((b) => `
          <li><button class="pick" data-act="add-leftover" data-from="${refOf(b.date, b.entry.id)}">
            ${thumb(b.recipe.photo)}
            <span class="entry-main"><span class="title">${esc(b.recipe.name)}</span>
            <span class="meta">${fmtQty(b.left)} portion${b.left === 1 ? '' : 's'} left · cooked ${esc(formatDay(b.date, today()))}</span></span>
          </button></li>`).join('')}
      </ul>` : ''}
    <div class="toolbar">
      <input id="add-search" class="search" type="search" placeholder="Search recipes" value="${esc(s.search || '')}" autocomplete="off" />
      ${S().recipes.length > 1 ? '<button class="btn" data-act="surprise-slot">🎲</button>' : ''}
    </div>
    ${list.length ? `
      <ul class="pick-list">
        ${list.map((r) => {
          const ps = perServing(r);
          const cps = costPerServing(r);
          return `<li><button class="pick" data-act="add-recipe" data-id="${r.id}">
            ${thumb(r.photo)}
            <span class="entry-main"><span class="title">${esc(r.name)}</span>
            <span class="meta">${esc([`makes ${servingsOf(r)}`, ps.cal != null && ps.cal !== '' ? kcal(ps.cal) : '', cps != null ? `${money(cps)}/portion` : ''].filter(Boolean).join(' · '))}</span></span>
          </button></li>`;
        }).join('')}
      </ul>` : `<p class="empty">${S().recipes.length ? 'No recipes match.' : 'No recipes yet.'}</p>`}
    <button class="btn wide" data-act="new-recipe-from-add">+ New recipe</button>
  `;
}

function renderChooseBatch(s, title) {
  const r = findRecipe(S(), s.choose);
  const batches = openBatches(S(), r.id, s.date);
  return `
    <div class="sheet">
      ${sheetHeader(title, { left: 'Back' })}
      <div class="sheet-body">
        <h2 class="recipe-title">${esc(r.name)}</h2>
        <p class="hint flush">You already have some of this planned. Eat leftovers, or cook a new batch?</p>
        <ul class="pick-list">
          ${batches.map((b) => `<li><button class="pick" data-act="add-leftover" data-from="${refOf(b.date, b.entry.id)}">
            <span class="entry-main"><span class="title">Leftovers from ${esc(formatDay(b.date, today()))}</span>
            <span class="meta">${fmtQty(b.left)} portion${b.left === 1 ? '' : 's'} left</span></span></button></li>`).join('')}
          <li><button class="pick" data-act="add-cook" data-id="${r.id}">
            <span class="entry-main"><span class="title">Cook a new batch</span>
            <span class="meta">Makes ${servingsOf(r)} portion${servingsOf(r) === 1 ? '' : 's'}</span></span></button></li>
        </ul>
      </div>
    </div>`;
}

function renderAddFood(s) {
  const foods = recentFoods(S());
  return `
    <form class="quick-add" data-form="add-food">
      <input id="food-input" type="text" placeholder="e.g. 100 g Cheerios, 200 ml milk" autocomplete="off" enterkeyhint="done" value="${esc(s.foodText || '')}" />
      <button type="submit" class="btn primary">Add</button>
    </form>
    <p class="hint">Type what you had, with amounts. Separate items with commas. Foods in your list fill in by themselves; new ones are looked up.</p>
    <div class="btn-row">
      <button class="btn small" data-act="add-search-food">Search foods</button>
      <button class="btn small" data-act="add-scan">Scan a barcode</button>
    </div>
    ${foods.length ? `
      <h2 class="section">Your foods</h2>
      <ul class="pick-list">
        ${foods.map((f) => {
          const amt = entryFromFood(f, null, '');
          return `<li><button class="pick" data-act="add-saved-food" data-id="${f.id}">
          <span class="entry-main"><span class="title">${esc(f.name)}</span>
          <span class="meta">${esc([[fmtQty(amt.amount), amt.unit].filter(Boolean).join(' '), amt.nutrition?.cal != null ? kcal(amt.nutrition.cal) : '', amt.cost != null ? money(amt.cost) : ''].filter(Boolean).join(' · '))}</span></span>
        </button></li>`;
        }).join('')}
      </ul>` : ''}
  `;
}

function addFoods(s, text) {
  const parts = parseFoods(text);
  if (!parts.length) return;
  // One food we don't know yet: look it up right away.
  if (parts.length === 1 && !findFood(S(), parts[0].name)) {
    ui.sheets.pop();
    openFoodSearch(parts[0].name, { kind: 'quick', date: s.date, slot: s.slot, ...parts[0] });
    return;
  }
  const added = [];
  for (const p of parts) {
    const { item, matched } = foodFor(S(), p);
    const e = addEntry(S(), s.date, { type: 'food', slot: s.slot, ...item });
    added.push({ e, matched: matched && !item.unconverted });
  }
  store.save();
  ui.sheets.pop();
  renderSheet();
  const missing = added.filter((a) => !a.matched).length;
  toast(missing
    ? `Added. Tap ${missing === 1 ? 'the item' : 'items'} marked “Add nutrition” to look ${missing === 1 ? 'it' : 'them'} up.`
    : `Added ${added.length} item${added.length === 1 ? '' : 's'}`);
}

// ----- One planned meal -----

function renderEntrySheet(s) {
  const e = getEntry(S(), s.date, s.id);
  if (!e) return `<div class="sheet">${sheetHeader('')}<div class="sheet-body"><p class="empty">This was removed.</p></div></div>`;
  const r = findRecipe(S(), e.recipeId);
  const t = entryTotals(S(), e);
  let batch = '';
  if (e.type === 'cook') {
    const size = batchSize(S(), e);
    const left = batchLeft(S(), s.date, e);
    const lefts = leftoversOf(S(), s.date, e.id);
    batch = `
      <div class="card">
        <h2 class="section tight">This batch</h2>
        <div class="stepper-row">
          <span>Make</span>
          <div class="stepper">
            <button class="icon-btn small" data-act="entry-scale" data-delta="-0.5" aria-label="Smaller batch">−</button>
            <span>${fmtQty(Number(e.scale) || 1)}× recipe</span>
            <button class="icon-btn small" data-act="entry-scale" data-delta="0.5" aria-label="Bigger batch">+</button>
          </div>
        </div>
        <p class="flush-p">${fmtQty(size)} portion${size === 1 ? '' : 's'}: ${fmtQty(Number(e.portions) || 0)} here${lefts.length ? `, ${lefts.length} leftover meal${lefts.length === 1 ? '' : 's'}` : ''}. <strong>${left > 0 ? `${fmtQty(left)} left over` : left < 0 ? `${fmtQty(-left)} short` : 'All used'}</strong></p>
        ${lefts.length ? `<ul class="mini-list">${lefts.map((l) => `<li>${esc(shortDay(l.date))} · ${esc(slotName(l.entry.slot))}${Number(l.entry.portions) !== 1 ? ` · ${fmtQty(Number(l.entry.portions))} portions` : ''}</li>`).join('')}</ul>` : ''}
        ${size > 1 ? '<button class="btn" data-act="plan-leftovers">Plan leftovers</button>' : ''}
        <p class="hint flush">The shopping list buys this batch once, however many days you eat it.</p>
      </div>`;
  } else if (e.type === 'leftover') {
    const src = sourceOf(S(), e);
    batch = `
      <div class="card">
        <h2 class="section tight">Leftovers</h2>
        <p class="flush-p">${src ? `From the batch cooked ${esc(shortDay(src.date))} (${fmtQty(batchLeft(S(), src.date, src.entry))} left after this).` : 'The batch this came from was removed.'}</p>
        ${src ? `<button class="btn" data-act="goto-entry" data-date="${src.date}" data-id="${src.entry.id}">Open the batch</button>` : ''}
      </div>`;
  }
  return `
    <div class="sheet">
      ${sheetHeader(shortDay(s.date))}
      <div class="sheet-body">
        ${r?.photo && photoUrl(r.photo) ? `<img class="hero small" src="${esc(photoUrl(r.photo))}" alt="" />` : ''}
        <h1 class="recipe-title">${esc(entryName(S(), e))}</h1>
        <p class="facts">${esc(slotName(e.slot))}${t.cal != null ? ` · ${esc(kcal(t.cal))}` : ''}${t.protein != null ? ` · ${esc(grams(t.protein))} protein` : ''}${t.cost != null ? ` · ${esc(money(t.cost))}` : ''}</p>

        <div class="card">
          <div class="stepper-row">
            <span>Portions you eat</span>
            <div class="stepper">
              <button class="icon-btn small" data-act="entry-portions" data-delta="-0.5" aria-label="Fewer">−</button>
              <span>${fmtQty(Number(e.portions) || 0)}</span>
              <button class="icon-btn small" data-act="entry-portions" data-delta="0.5" aria-label="More">+</button>
            </div>
          </div>
        </div>

        ${batch}

        ${r && e.type === 'cook' && s.date <= today() ? `
        <div class="card">
          <h2 class="section tight">How was it?</h2>
          ${starsInput(r)}
        </div>` : ''}

        <div class="card">
          <h2 class="section tight">Move</h2>
          <div class="plan-row">
            <input type="date" id="move-date" value="${esc(s.date)}" />
            <select id="move-slot">${slots().map((sl) => `<option value="${esc(sl.id)}" ${sl.id === e.slot ? 'selected' : ''}>${esc(sl.name)}</option>`).join('')}</select>
            <button class="btn" data-act="entry-move">Move</button>
          </div>
        </div>

        <div class="btn-row">
          ${r ? `<button class="btn" data-act="view-recipe" data-id="${r.id}">Open recipe</button>` : ''}
          <button class="btn danger" data-act="entry-remove">Remove</button>
        </div>
      </div>
    </div>`;
}

function changeEntry(s, fn) {
  const e = getEntry(S(), s.date, s.id);
  if (!e) return;
  fn(e);
  store.save();
}

// ----- Food item (no recipe) -----

function foodSheetFor(date, id, k = key()) {
  const e = getEntry(S(), date, id);
  const food = e?.foodId ? getFood(S(), e.foodId) : null;
  return {
    kind: 'food', date, id, key: k,
    draft: {
      name: e?.name || '',
      amountText: e?.amount != null ? fmtQty(e.amount) : '',
      unit: e?.unit || '',
      nutrition: { ...(e?.nutrition || {}) },
      costText: e?.cost != null ? String(e.cost) : '',
      remember: true,
      linked: !!food,
    },
  };
}

function openFoodSheet(date, id) {
  if (!getEntry(S(), date, id)) return;
  openSheet(foodSheetFor(date, id));
}

function renderFoodSheet(s) {
  const d = s.draft;
  const e = getEntry(S(), s.date, s.id);
  const food = d.linked && e?.foodId ? getFood(S(), e.foodId) : null;
  const qty = parseQty(d.amountText);
  const live = food ? nutritionFor(food, qty, d.unit) : null;
  const livePrice = food && live ? priceFor(food, qty, d.unit) : null;
  return `
    <div class="sheet">
      ${sheetHeader(shortDay(s.date), { left: 'Cancel', right: 'Save', rightAct: 'save-food' })}
      <div class="sheet-body">
        ${food ? `<h1 class="recipe-title">${esc(food.name)}</h1>
          <p class="facts">${esc([food.brand, foodFacts(food)].filter(Boolean).join(' · '))}</p>`
          : `<label class="field"><span>Food</span><input type="text" id="food-name" data-bind="name" value="${esc(d.name)}" /></label>`}
        <div class="two-col">
          <label class="field"><span>Amount</span><input type="text" inputmode="decimal" data-bind="amountText" ${food ? 'data-recalc' : ''} value="${esc(d.amountText)}" placeholder="e.g. 100" /></label>
          <label class="field"><span>Unit</span><input type="text" data-bind="unit" ${food ? 'data-recalc' : ''} value="${esc(d.unit)}" placeholder="g, ml, cup…" list="units" /></label>
        </div>
        <datalist id="units">${['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'oz', 'lb', 'piece', 'slice', 'serving', ...(food?.portions || []).map((x) => x.unit)].map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
        ${food ? `
          <div class="card">
            ${live ? `
              <div class="nutri-grid">
                ${NUTRIENTS.filter((n) => live[n.key] != null).map((n) => `<div class="nutri"><span class="nutri-label">${n.label}</span><strong>${esc(nutrientText(n.key, live[n.key]))}</strong></div>`).join('')}
                <div class="nutri"><span class="nutri-label">Price</span><strong>${livePrice != null ? esc(money(livePrice)) : '–'}</strong></div>
              </div>
              ${livePrice == null ? '<p class="hint flush">Add a price to this food in Recipes → Foods to count its cost.</p>' : ''}`
              : `<p class="flush-p warn-text">${qty == null ? 'Enter an amount.' : `Can’t tell how much “${esc(d.unit || 'one')}” is. Use g, ml, cup, oz… or add that size to the food.`}</p>`}
          </div>
          <div class="btn-row">
            <button class="btn small" data-act="food-change">Pick another food</button>
            <button class="btn small" data-act="food-edit" data-id="${food.id}">Edit food</button>
            <button class="btn small" data-act="food-unlink">Type numbers instead</button>
          </div>` : `
          <button class="btn" data-act="food-lookup">Look up nutrition</button>
          <div class="card">
            <h2 class="section tight">Nutrition for this amount</h2>
            <div class="nutri-inputs">
              ${NUTRIENTS.map((n) => `
                <label class="field"><span>${n.label} (${n.unit})</span>
                  <input type="number" inputmode="decimal" min="0" step="any" data-bind="nutrition.${n.key}" data-num data-optional value="${esc(d.nutrition[n.key] ?? '')}" /></label>`).join('')}
            </div>
            <p class="hint flush">Tip: the package label lists these.</p>
          </div>
          <label class="field"><span>Price for this amount (${esc(S().settings.currency)})</span>
            <input type="text" inputmode="decimal" data-bind="costText" value="${esc(d.costText)}" placeholder="Optional" /></label>
          <label class="field row"><input type="checkbox" data-bind="remember" ${d.remember ? 'checked' : ''} />
            <span>Save to my foods, so next time the numbers fill in by themselves</span></label>`}
        <button class="btn danger wide" data-act="food-remove">Remove from this day</button>
      </div>
    </div>`;
}

function saveFood(s) {
  const d = s.draft;
  const e = getEntry(S(), s.date, s.id);
  if (!e) { closeSheet(); return; }
  const food = d.linked && e.foodId ? getFood(S(), e.foodId) : null;
  if (food) {
    const fresh = entryFromFood(food, parseQty(d.amountText), d.unit.trim());
    delete e.unconverted;
    Object.assign(e, fresh);
  } else {
    if (!d.name.trim()) { alert('Give the food a name.'); return; }
    const nutrition = {};
    for (const n of NUTRIENTS) {
      const v = d.nutrition[n.key];
      if (v != null && v !== '' && Number.isFinite(Number(v))) nutrition[n.key] = Number(v);
    }
    delete e.foodId;
    delete e.unconverted;
    Object.assign(e, {
      name: d.name.trim(),
      amount: parseQty(d.amountText),
      unit: d.unit.trim(),
      nutrition,
      cost: parseQty(d.costText),
    });
    if (d.remember && nutrition.cal != null) e.foodId = rememberFood(S(), e).id;
  }
  ui.sheets.pop();
  store.save();
  renderSheet();
}

// ----- Plan leftovers for a batch -----

function renderLeftoversSheet(s) {
  const cook = getEntry(S(), s.date, s.id);
  if (!cook) return `<div class="sheet">${sheetHeader('Leftovers')}<div class="sheet-body"><p class="empty">This batch was removed.</p></div></div>`;
  const left = batchLeft(S(), s.date, cook);
  const lefts = leftoversOf(S(), s.date, cook.id);
  const at = (d, slot) => lefts.find((l) => l.date === d && l.entry.slot === slot);
  const days = daysBetween(s.date, addDays(s.date, 6));
  return `
    <div class="sheet">
      ${sheetHeader('Plan leftovers', { left: 'Done' })}
      <div class="sheet-body">
        <h2 class="recipe-title">${esc(entryName(S(), cook))}</h2>
        <p class="flush-p"><strong>${left > 0 ? `${fmtQty(left)} portion${left === 1 ? '' : 's'} left` : left < 0 ? `${fmtQty(-left)} portion${left === -1 ? '' : 's'} short` : 'All portions planned'}</strong> · cooked ${esc(shortDay(s.date))}</p>
        <p class="hint flush">Tap a meal to eat leftovers then. Tap again to undo.</p>
        <ul class="left-days">
          ${days.map((d) => `
            <li>
              <span class="left-day">${esc(formatDay(d, today()))}</span>
              <div class="chips">
                ${slots().map((sl) => {
                  const isCook = d === s.date && sl.id === cook.slot;
                  const on = !!at(d, sl.id);
                  return `<button class="chip tiny${on || isCook ? ' on' : ''}" data-act="toggle-leftover" data-date="${d}" data-slot="${esc(sl.id)}" ${isCook || (!on && left <= 0) ? 'disabled' : ''}>${esc(sl.name)}${isCook ? ' (cook)' : ''}</button>`;
                }).join('')}
              </div>
            </li>`).join('')}
        </ul>
      </div>
    </div>`;
}

// ----- Categories -----

function renderCategoriesSheet() {
  return `
    <div class="sheet">
      ${sheetHeader('Categories', { left: 'Done' })}
      <div class="sheet-body">
        <p class="hint flush">Groups of labels for your recipes, like Meal or Difficulty. A recipe can have any number of them, and you can filter by them.</p>
        ${S().categories.map((g) => `
          <div class="card">
            <div class="card-head">
              <input type="text" class="group-name" value="${esc(g.name)}" data-cat-group="${g.id}" aria-label="Group name" />
              <button class="link danger" data-act="cat-delete-group" data-group="${g.id}">Delete</button>
            </div>
            <ul class="edit-list">
              ${g.options.map((o) => `<li>
                <input type="text" value="${esc(o.name)}" data-cat-option="${o.id}" data-group="${g.id}" aria-label="Label" />
                <button class="icon-btn small" data-act="cat-delete-option" data-group="${g.id}" data-option="${o.id}" aria-label="Remove">×</button>
              </li>`).join('')}
            </ul>
            <form class="quick-add tight" data-form="cat-add-option" data-group="${g.id}">
              <input type="text" placeholder="Add a label" aria-label="New label" />
              <button class="btn small" type="submit">Add</button>
            </form>
          </div>`).join('')}
        <form class="quick-add" data-form="cat-add-group">
          <input type="text" placeholder="New group, e.g. Cuisine" aria-label="New group" />
          <button class="btn" type="submit">Add group</button>
        </form>
      </div>
    </div>`;
}

// ----- Finding a food (your list, or online) -----
// purpose says what the picked food is for:
//   { kind: 'quick', date, slot, name, amount, unit }  add it to a day
//   { kind: 'entry', date, id }                         fill in a food already on a day
//   { kind: 'ingredient', index }                       link a recipe ingredient (editor below)
//   { kind: 'library' }                                 just add it to your food list

function openFoodSearch(query, purpose) {
  const sheet = { kind: 'food-search', query: query || '', purpose, results: null, loading: false, key: key() };
  openSheet(sheet);
  if (sheet.query.trim()) runFoodSearch(sheet);
  else setTimeout(() => $('#fs-query')?.focus({ preventScroll: true }), 50);
}

async function runFoodSearch(sheet) {
  const q = sheet.query.trim();
  if (!q) return;
  sheet.loading = true;
  sheet.results = null;
  renderSheet();
  const results = await searchFoods(q, { usdaKey: S().settings.usdaKey });
  if (sheet.query.trim() !== q) return; // a newer search is running
  sheet.loading = false;
  sheet.results = results;
  renderSheet();
}

function foodPick(f, act, idx, list) {
  return `<li><button class="pick" data-act="${act}" data-${list === 'mine' ? 'id' : 'index'}="${list === 'mine' ? f.id : idx}" data-list="${list}">
    <span class="entry-main">
      <span class="title">${esc(f.name)}</span>
      <span class="meta">${esc([f.brand, foodFacts(f)].filter(Boolean).join(' · '))}</span>
    </span>
  </button></li>`;
}

function renderFoodSearch(s) {
  const q = s.query.trim().toLowerCase();
  const mine = q
    ? S().foods.filter((f) => `${f.name} ${f.brand || ''} ${(f.aliases || []).join(' ')}`.toLowerCase().includes(q)).slice(0, 8)
    : [];
  const r = s.results;
  const p = s.purpose;
  const forWhat = p.kind === 'ingredient' ? 'for this ingredient' : p.kind === 'library' ? 'to add to your foods' : '';
  return `
    <div class="sheet">
      ${sheetHeader('Find a food', { left: 'Cancel' })}
      <div class="sheet-body">
        <form class="quick-add" data-form="food-search">
          <input id="fs-query" type="search" placeholder="e.g. chicken thighs, Cheerios" value="${esc(s.query)}" autocomplete="off" enterkeyhint="search" />
          <button type="submit" class="btn primary">Search</button>
        </form>
        <div class="btn-row">
          <button class="btn small" data-act="scan-open">Scan a barcode</button>
          <button class="btn small" data-act="fs-manual">Type the numbers myself</button>
        </div>
        ${forWhat ? `<p class="hint flush">Pick the closest match ${forWhat}.</p>` : ''}
        ${mine.length ? `<h2 class="section">Your foods</h2><ul class="pick-list">${mine.map((f) => foodPick(f, 'fs-pick', 0, 'mine')).join('')}</ul>` : ''}
        ${s.loading ? '<p class="hint center">Searching…</p>' : ''}
        ${r ? `
          <h2 class="section">Plain foods <span class="source">USDA</span></h2>
          ${r.usda.length ? `<ul class="pick-list">${r.usda.map((f, i) => foodPick(f, 'fs-pick', i, 'usda')).join('')}</ul>`
            : `<p class="hint">${esc(r.usdaError || 'Nothing found.')}</p>`}
          <h2 class="section">Packaged foods <span class="source">Open Food Facts</span></h2>
          ${r.off.length ? `<ul class="pick-list">${r.off.map((f, i) => foodPick(f, 'fs-pick', i, 'off')).join('')}</ul>`
            : `<p class="hint">${esc(r.offError || 'Nothing found.')}</p>`}
          <p class="hint">Numbers are per 100 g. The app works out the amount you eat.</p>
        ` : ''}
        ${!r && !s.loading && !mine.length ? '<p class="hint">Search two free databases: USDA for plain foods (chicken, milk, apples) and Open Food Facts for packaged foods and barcodes. Foods you pick are saved, so they work offline afterwards.</p>' : ''}
      </div>
    </div>`;
}

// Something was picked in the search: save it to your foods and use it.
function useFood(sheet, food) {
  const st = S();
  const f = food.id ? food : addFood(st, food);
  const p = sheet.purpose;
  ui.sheets.pop();
  if (p.kind === 'quick') {
    if (p.name) linkName(f, p.name);
    const e = addEntry(st, p.date, { type: 'food', slot: p.slot, ...entryFromFood(f, p.amount, p.unit) });
    store.save();
    if (e.unconverted) {
      openFoodSheet(p.date, e.id);
      toast(`How much is “${p.unit}”? Change it to g, ml, cup… or add that size to the food.`);
    } else {
      renderSheet();
      toast(`Added ${f.name}`);
    }
    return;
  }
  if (p.kind === 'entry') {
    const e = getEntry(st, p.date, p.id);
    if (e) {
      linkName(f, e.name);
      Object.assign(e, entryFromFood(f, e.amount, e.unit));
      if (!e.unconverted) delete e.unconverted;
    }
    store.save();
    // Refresh the food pop-up underneath with the new numbers.
    const under = top();
    if (under?.kind === 'food') ui.sheets[ui.sheets.length - 1] = foodSheetFor(p.date, p.id, under.key);
    renderSheet();
    return;
  }
  if (p.kind === 'ingredient') {
    const ed = top();
    const ing = ed?.draft?.ingredients?.[p.index];
    if (ing) { ing.foodId = f.id; linkName(f, ing.name); }
    store.save();
    renderSheet();
    return;
  }
  store.save();
  openSheet(foodEditSheet(f));
  toast('Added to your foods. Add a price and sizes if you like.');
}

function manualFromSearch(sheet) {
  const p = sheet.purpose;
  const st = S();
  ui.sheets.pop();
  if (p.kind === 'quick') {
    const e = addEntry(st, p.date, { type: 'food', slot: p.slot, name: p.name || sheet.query, amount: p.amount, unit: p.unit || '', nutrition: {}, cost: null });
    store.save();
    openFoodSheet(p.date, e.id);
    return;
  }
  if (p.kind === 'entry') {
    const under = top();
    if (under?.kind === 'food') under.draft.linked = false;
    renderSheet();
    return;
  }
  const name = (p.kind === 'ingredient' ? top()?.draft?.ingredients?.[p.index]?.name : sheet.query) || sheet.query || '';
  const f = addFood(st, { name: name.trim() || 'New food', source: 'manual', base: 'g', per: 100, nutrition: {}, portions: [], section: guessSection(name) });
  if (p.kind === 'ingredient') {
    const ing = top()?.draft?.ingredients?.[p.index];
    if (ing) ing.foodId = f.id;
  }
  store.save();
  openSheet(foodEditSheet(f));
}

// ----- Barcode scanner -----

function renderScan(s) {
  return `
    <div class="sheet">
      ${sheetHeader('Scan a barcode', { left: 'Cancel' })}
      <div class="sheet-body">
        <div class="scan-box">
          <video id="scan-video" playsinline muted></video>
          <div class="scan-line" aria-hidden="true"></div>
        </div>
        <p class="hint flush">${esc(s.status || 'Point the camera at the barcode on the package.')}</p>
        <form class="quick-add" data-form="barcode">
          <input id="barcode-input" type="text" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off" />
          <button class="btn" type="submit">Look up</button>
        </form>
      </div>
    </div>`;
}

let stopScan = null;
function endScan() { if (stopScan) { try { stopScan(); } catch { /* already stopped */ } stopScan = null; } }

async function openScanner(purpose) {
  const sheet = { kind: 'scan', purpose, key: key(), status: '' };
  openSheet(sheet);
  const video = $('#scan-video');
  if (!navigator.mediaDevices?.getUserMedia) {
    sheet.status = 'This browser can’t use the camera here. Type the number instead.';
    renderSheet();
    return;
  }
  try {
    stopScan = await startScanner(video, (code) => barcodeFound(sheet, code));
  } catch (e) {
    sheet.status = e?.name === 'NotAllowedError'
      ? 'Camera access was blocked. Allow it in Settings → Safari → Camera, or type the number.'
      : `Couldn’t start the camera${e?.message ? ` (${e.message})` : ''}. Type the number instead.`;
    if (top() === sheet) renderSheet();
  }
}

async function barcodeFound(sheet, code) {
  endScan();
  if (top() !== sheet) return;
  const mine = S().foods.find((f) => f.barcode && f.barcode === String(code).replace(/\D/g, ''));
  if (mine) { useScanned(sheet, mine); return; }
  sheet.status = `Found ${code}. Looking it up…`;
  // Keep the video element: only update the status line.
  const hint = $('.sheet-body .hint');
  if (hint) hint.textContent = sheet.status;
  try {
    const food = await lookupBarcode(code);
    if (top() !== sheet) return;
    if (!food) {
      sheet.status = `No product with barcode ${code} in Open Food Facts. Search by name, or type the numbers yourself.`;
      renderSheet();
      return;
    }
    useScanned(sheet, food);
  } catch {
    sheet.status = navigator.onLine ? 'Couldn’t look it up right now. Try again in a moment.' : 'You’re offline. Barcode lookup needs a connection.';
    if (top() === sheet) renderSheet();
  }
}

// The scanner sits on top of a search pop-up, or is opened on its own.
function useScanned(sheet, food) {
  ui.sheets.pop();
  const under = top();
  if (under?.kind === 'food-search') useFood(under, food);
  else useFood({ purpose: sheet.purpose }, food) ;
}

// ----- Editing a food in your list -----

function foodEditSheet(f) {
  const d = JSON.parse(JSON.stringify(f));
  d.nutrition = d.nutrition || {};
  d.portions = (d.portions || []).map((x) => ({ ...x }));
  d.priceAmount = d.price?.amount ?? '';
  d.priceQty = d.price?.qty != null ? fmtQty(Number(d.price.qty)) : '1';
  d.priceUnit = d.price?.unit ?? (d.base === 'g' ? 'lb' : '');
  d.servingQty = d.serving?.qty != null ? fmtQty(Number(d.serving.qty)) : '';
  d.servingUnit = d.serving?.unit ?? '';
  return { kind: 'food-edit', id: f.id, draft: d, key: key() };
}

function renderFoodEdit(s) {
  const d = s.draft;
  const isG = !d.base || d.base === 'g';
  const per = isG ? `per ${d.per || 100} g (or ml)` : `per ${d.per || 1} ${d.base}`;
  const sourceNote = d.source === 'usda' ? 'From USDA FoodData Central' : d.source === 'off' ? `From Open Food Facts${d.barcode ? ` · barcode ${d.barcode}` : ''}` : 'Typed in by you';
  const test = d.priceAmount !== '' && parseQty(String(d.priceAmount)) != null
    ? priceFor({ ...d, price: { amount: parseQty(String(d.priceAmount)), qty: parseQty(d.priceQty) ?? 1, unit: d.priceUnit }, portions: d.portions.map((x) => ({ unit: x.unit, grams: Number(x.grams) })) }, 100, isG ? 'g' : d.base)
    : null;
  return `
    <div class="sheet">
      ${sheetHeader('Food', { left: 'Cancel', right: 'Save', rightAct: 'food-save' })}
      <div class="sheet-body">
        <label class="field"><span>Name</span><input type="text" id="fe-name" data-bind="name" value="${esc(d.name)}" /></label>
        <label class="field"><span>Brand</span><input type="text" data-bind="brand" value="${esc(d.brand || '')}" placeholder="Optional" /></label>
        <p class="hint flush">${esc(sourceNote)}</p>

        <div class="card">
          <h2 class="section tight">Nutrition ${esc(per)}</h2>
          <div class="nutri-inputs">
            ${NUTRIENTS.map((n) => `
              <label class="field"><span>${n.label} (${n.unit})</span>
                <input type="number" inputmode="decimal" min="0" step="any" data-bind="nutrition.${n.key}" data-num data-optional value="${esc(d.nutrition[n.key] ?? '')}" /></label>`).join('')}
          </div>
        </div>

        <div class="card">
          <h2 class="section tight">Price</h2>
          <div class="price-row">
            <span>${esc(S().settings.currency)}</span>
            <input type="text" inputmode="decimal" data-bind="priceAmount" data-recalc value="${esc(d.priceAmount)}" placeholder="3.49" aria-label="Price" />
            <span>for</span>
            <input type="text" inputmode="decimal" class="short" data-bind="priceQty" data-recalc value="${esc(d.priceQty)}" aria-label="Amount" />
            <input type="text" class="short" data-bind="priceUnit" data-recalc value="${esc(d.priceUnit)}" placeholder="lb" list="units" aria-label="Unit" />
          </div>
          <p class="hint flush">${test != null ? `That’s ${esc(money(test))} per 100 ${isG ? 'g' : d.base}.` : 'What you pay at the store, e.g. 3.49 for 1 gal, or 5.99 for 1 lb.'}</p>
          ${renderPriceHistory(getFood(S(), s.id))}
        </div>

        <div class="card">
          <h2 class="section tight">Sizes</h2>
          <p class="hint flush">How much one cup, slice, piece… weighs, so amounts like “2 slices” work.</p>
          <ul class="edit-list">
            ${d.portions.map((x, i) => `<li>
              <span class="muted">1</span>
              <input type="text" class="short" data-bind="portions.${i}.unit" value="${esc(x.unit)}" placeholder="slice" aria-label="Size" />
              <span class="muted">=</span>
              <input type="number" inputmode="decimal" class="short" data-bind="portions.${i}.grams" data-num value="${esc(x.grams)}" aria-label="Grams" />
              <span class="muted">${isG ? 'g' : esc(d.base)}</span>
              <button class="icon-btn small" data-act="fe-remove-size" data-index="${i}" aria-label="Remove">×</button>
            </li>`).join('')}
          </ul>
          <button class="btn small" data-act="fe-add-size">+ Size</button>
          <div class="serving-row">
            <span>Usual amount</span>
            <input type="text" inputmode="decimal" class="short" data-bind="servingQty" value="${esc(d.servingQty)}" placeholder="${isG ? '100' : '1'}" aria-label="Usual amount" />
            <input type="text" class="short" data-bind="servingUnit" value="${esc(d.servingUnit)}" placeholder="${isG ? 'g' : ''}" list="units" aria-label="Unit" />
          </div>
          <p class="hint flush">Used when you add it without an amount.</p>
        </div>

        <label class="field"><span>Store section (for the shopping list)</span>
          <select data-bind="section">${SECTIONS.map((x) => `<option ${(d.section || 'Other') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>

        ${(d.aliases || []).length ? `<p class="hint">Also matches: ${d.aliases.map(esc).join(', ')}</p>` : ''}
        <datalist id="units">${['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'oz', 'lb', 'gal', 'piece', 'slice', 'can'].map((u) => `<option value="${u}">`).join('')}</datalist>
        <button class="btn danger wide" data-act="fe-delete">Delete food</button>
      </div>
    </div>`;
}

function trendBadge(f) {
  const t = priceTrend(f);
  if (!t || Math.abs(t.change) < 0.01) return '';
  const up = t.change > 0;
  return `<span class="badge ${up ? 'warn' : 'good'}" title="Since ${esc(t.from ? shortDate(t.from) : 'the first price')}">${up ? '▲' : '▼'} ${Math.round(Math.abs(t.change) * 100)}%</span>`;
}

function renderPriceHistory(f) {
  const h = (f?.priceHistory || []).filter((p) => unitPrice(f, p) != null);
  if (h.length < 2) return h.length ? '' : '';
  const vals = h.map((p) => unitPrice(f, p));
  const W = 300;
  const H = 60;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const y = (v) => (max === min ? H / 2 : H - 6 - ((v - min) / (max - min)) * (H - 12));
  const x = (i) => 6 + (i * (W - 12)) / (vals.length - 1);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `
    <div class="price-history">
      <div class="card-head"><span class="field-label">Price history ${trendBadge(f)}</span><span class="hint flush">${esc(unitLabel(f))}</span></div>
      <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price over time">
        <polyline points="${pts}" />
        ${vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" />`).join('')}
      </svg>
      <ul class="mini-list">${h.slice().reverse().slice(0, 8).map((p) => `<li>${esc(p.date ? shortDate(p.date) : 'Before')}${p.store ? ` · ${esc(p.store)}` : ''}: ${esc(money(Number(p.amount)))} for ${esc([fmtQty(Number(p.qty ?? 1)), p.unit].filter(Boolean).join(' '))} <span class="muted">(${esc(money(unitPrice(f, p)))})</span></li>`).join('')}</ul>
    </div>`;
}

// ----- Receipts -----

function openReceipt() {
  openSheet({ kind: 'receipt', key: key(), stage: 'start', date: today(), store: S().settings.lastStore || '' });
}

function renderReceipt(s) {
  const foods = S().foods.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (s.stage === 'review') {
    const used = s.rows.filter((r) => r.foodId).length;
    return `
      <div class="sheet">
        ${sheetHeader('Receipt', { left: 'Back', right: used ? 'Save prices' : '', rightAct: 'receipt-save' })}
        <div class="sheet-body">
          <div class="two-col">
            <label class="field"><span>Store</span><input type="text" id="rc-store" value="${esc(s.store)}" placeholder="Optional" /></label>
            <label class="field"><span>Date</span><input type="date" id="rc-date" value="${esc(s.date)}" /></label>
          </div>
          <p class="hint">${s.rows.length} item${s.rows.length === 1 ? '' : 's'} found. Pick the food each line is, and how much you bought for that price. Lines you leave on “Skip” aren’t saved. The app remembers your picks for next time.</p>
          <ul class="receipt-rows">
            ${s.rows.map((r, i) => `
              <li class="card receipt-row${r.foodId ? '' : ' skipped'}">
                <div class="card-head"><span class="rc-name">${esc(r.name)}</span><strong>${esc(money(r.price))}</strong></div>
                <select data-rc-food="${i}" aria-label="Food">
                  <option value="">Skip</option>
                  ${foods.map((f) => `<option value="${f.id}" ${r.foodId === f.id ? 'selected' : ''}>${esc(f.name)}${f.brand ? ` (${esc(f.brand)})` : ''}</option>`).join('')}
                </select>
                ${r.foodId ? `<div class="price-row"><span>for</span>
                  <input type="text" inputmode="decimal" class="short" data-rc-qty="${i}" value="${esc(r.qty ?? '')}" aria-label="Amount" />
                  <input type="text" class="short" data-rc-unit="${i}" value="${esc(r.unit || '')}" placeholder="lb" list="units" aria-label="Unit" />
                  ${receiptChange(r)}</div>` : ''}
              </li>`).join('')}
          </ul>
          <datalist id="units">${['g', 'kg', 'ml', 'l', 'oz', 'lb', 'gal', 'qt', 'cup', 'can', 'pack', 'piece', 'dozen'].map((u) => `<option value="${u}">`).join('')}</datalist>
          ${!foods.length ? '<p class="hint">You have no foods in your list yet. Add foods under Recipes → Foods first, then their prices can come from receipts.</p>' : ''}
        </div>
      </div>`;
  }
  return `
    <div class="sheet">
      ${sheetHeader('Scan a receipt')}
      <div class="sheet-body">
        <p class="hint flush">Take a photo of a grocery receipt and the app reads the prices, so your foods and recipes stay up to date. Lay it flat in good light.</p>
        ${s.stage === 'reading' ? `
          <div class="card center"><p><strong>Reading the receipt…</strong></p><div class="cook-progress"><span style="width:${Math.round((s.progress || 0) * 100)}%"></span></div>
          <p class="hint flush">The first time takes a little longer while the reader loads.</p></div>` : `
          <label class="btn primary wide">Take or choose a photo<input type="file" accept="image/*" data-file="receipt" hidden /></label>`}
        ${s.error ? `<p class="hint error-text">${esc(s.error)}</p>` : ''}
        <details class="paste"${s.pasteOpen ? ' open' : ''}>
          <summary data-act="toggle-receipt-paste">Or paste the receipt text</summary>
          <p class="hint flush">On iPhone you can open the photo, press and hold on the text, choose Select All, and Copy.</p>
          <textarea rows="7" id="receipt-text" placeholder="MILK 1 GAL   3.49&#10;BANANAS     1.18">${esc(s.text || '')}</textarea>
          <button class="btn small" data-act="receipt-read-text">Read these</button>
        </details>
      </div>
    </div>`;
}

function receiptChange(r) {
  const f = getFood(S(), r.foodId);
  if (!f) return '';
  const now = unitPrice(f, { amount: r.price, qty: parseQty(String(r.qty ?? '')) ?? 1, unit: r.unit });
  const was = unitPrice(f);
  if (now == null || was == null || !was) return now == null ? '<span class="hint flush">Can’t convert that unit.</span>' : '';
  const ch = now / was - 1;
  if (Math.abs(ch) < 0.01) return '<span class="badge">same price</span>';
  return `<span class="badge ${ch > 0 ? 'warn' : 'good'}">${ch > 0 ? '▲' : '▼'} ${Math.round(Math.abs(ch) * 100)}%</span>`;
}

function receiptRows(text) {
  const foods = S().foods;
  return parseReceipt(text).map((l) => {
    const f = matchFood(foods, l.name);
    return {
      name: l.name,
      price: l.price,
      foodId: f?.id || '',
      qty: l.qty ?? f?.price?.qty ?? 1,
      unit: l.qty ? l.unit : (f?.price?.unit || ''),
    };
  });
}

function showReceiptRows(s, text) {
  s.rows = receiptRows(text);
  if (!s.rows.length) {
    s.stage = 'start';
    s.error = 'Couldn’t find any prices in that. Try a sharper photo, or paste the text instead.';
    s.pasteOpen = true;
    s.text = text;
  } else {
    s.stage = 'review';
    s.error = '';
  }
  renderSheet();
}

async function readReceiptPhoto(s, file) {
  s.stage = 'reading';
  s.progress = 0;
  s.error = '';
  renderSheet();
  try {
    const text = await readImageText(file, (p) => {
      s.progress = p;
      const bar = $('.sheet .cook-progress span');
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    });
    if (top() !== s) return;
    showReceiptRows(s, text);
  } catch (err) {
    s.stage = 'start';
    s.error = navigator.onLine ? (err.message || 'Couldn’t read that picture.') : 'The receipt reader needs the internet the first time.';
    renderSheet();
  }
}

function saveReceipt(s) {
  const st = S();
  const date = $('#rc-date')?.value || s.date || today();
  const storeName = ($('#rc-store')?.value || '').trim();
  let n = 0;
  for (const r of s.rows) {
    const f = r.foodId && getFood(st, r.foodId);
    if (!f) continue;
    setPrice(f, { amount: r.price, qty: parseQty(String(r.qty ?? '')) ?? 1, unit: (r.unit || '').trim() }, date, storeName);
    rememberReceiptName(f, r.name);
    n += 1;
  }
  if (storeName) st.settings.lastStore = storeName;
  ui.sheets.pop();
  store.save();
  renderSheet();
  toast(`Updated ${n} price${n === 1 ? '' : 's'}`);
}

function saveFoodEdit(s) {
  const d = s.draft;
  const f = getFood(S(), s.id);
  if (!f) { closeSheet(); return; }
  if (!d.name.trim()) { alert('Give the food a name.'); return; }
  const nutrition = {};
  for (const n of NUTRIENTS) {
    const v = d.nutrition[n.key];
    if (v != null && v !== '' && Number.isFinite(Number(v))) nutrition[n.key] = Number(v);
  }
  const amount = parseQty(String(d.priceAmount));
  const sq = parseQty(d.servingQty);
  Object.assign(f, {
    name: d.name.trim(),
    brand: (d.brand || '').trim(),
    nutrition,
    portions: d.portions
      .filter((x) => String(x.unit || '').trim() && Number(x.grams) > 0)
      .map((x) => ({ unit: normUnit(x.unit), grams: Number(x.grams) })),
    serving: sq != null ? { qty: sq, unit: (d.servingUnit || '').trim() } : null,
    section: d.section || 'Other',
    updatedAt: Date.now(),
  });
  if (amount != null) setPrice(f, { amount, qty: parseQty(d.priceQty) ?? 1, unit: (d.priceUnit || '').trim() }, today());
  else f.price = null;
  ui.sheets.pop();
  store.save();
  renderSheet();
}

// ---------- Small helpers ----------

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
}

function bindInput(el) {
  const s = top();
  if (!s?.draft) return;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.dataset.num !== undefined) {
    value = el.value === '' ? (el.dataset.optional !== undefined ? undefined : '') : Number(el.value);
  } else value = el.value;
  setPath(s.draft, el.dataset.bind, value);
  if (el.dataset.rerender !== undefined) renderSheet();
}

function showTip(el, x, y) {
  const tip = $('#tip');
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
  tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
}
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY);
  else $('#tip').hidden = true;
});
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY);
});
window.addEventListener('scroll', () => { $('#tip').hidden = true; }, { passive: true });

function exportData() {
  const blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `meals-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.recipes)) throw new Error('not a backup');
    if (confirm('Replace everything on this device with this backup?')) {
      store.replace(data);
      alert('Backup restored.');
    }
  } catch {
    alert('That file is not a backup from this app.');
  }
}

function addRecipeToDay(date, slot, recipeId) {
  const r = findRecipe(S(), recipeId);
  addEntry(S(), date, { type: 'cook', slot, recipeId, scale: 1 });
  store.save();
  const n = servingsOf(r);
  toast(n > 1 ? `Added to ${formatDay(date, today()).toLowerCase()}. Makes ${n} portions: tap it to plan leftovers.` : `Added to ${formatDay(date, today()).toLowerCase()}`);
}

// ---------- Events ----------

function onClick(e) {
  const tabBtn = e.target.closest('.tabbar button');
  if (tabBtn) {
    ui.tab = tabBtn.dataset.tab;
    closeAllSheets();
    render();
    window.scrollTo(0, 0);
    return;
  }
  // Clicking the dark area around a pop-up closes it (phone layout).
  if (e.target.id === 'sheet') { closeSheet(); return; }

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const s = top();
  const st = S();
  if (el.tagName === 'SUMMARY') {
    e.preventDefault();
    if (act === 'toggle-paste-ing') s.pasteIngOpen = !s.pasteIngOpen;
    if (act === 'toggle-paste-steps') s.pasteStepsOpen = !s.pasteStepsOpen;
    if (act === 'toggle-paste-all') s.pasteAllOpen = !s.pasteAllOpen;
    if (act === 'toggle-at-home') { ui.atHomeOpen = !ui.atHomeOpen; render(); return; }
    if (act === 'toggle-cook-ings') s.ingsOpen = !s.ingsOpen;
    if (act === 'toggle-receipt-paste') s.pasteOpen = !s.pasteOpen;
    renderSheet();
    return;
  }
  switch (act) {
    // Plan tab
    case 'prev-week': ui.week = addDays(ui.week, -7); render(); break;
    case 'next-week': ui.week = addDays(ui.week, 7); render(); break;
    case 'this-week': ui.week = startOfWeek(today(), st.settings.weekStart); render(); break;
    case 'go-summary': ui.tab = 'summary'; ui.summaryMode = 'week'; ui.summaryAnchor = ui.week; render(); window.scrollTo(0, 0); break;
    case 'toggle-day': {
      const d = el.dataset.date;
      ui.openDays.has(d) ? ui.openDays.delete(d) : ui.openDays.add(d);
      render();
      break;
    }
    case 'add': openSheet({ kind: 'add', date: el.dataset.date, slot: el.dataset.slot, mode: 'recipe', key: key() }); setTimeout(() => $('#add-search')?.focus({ preventScroll: true }), 50); break;
    case 'entry': {
      const entry = getEntry(st, el.dataset.date, el.dataset.id);
      if (entry?.type === 'food') openFoodSheet(el.dataset.date, el.dataset.id);
      else openSheet({ kind: 'entry', date: el.dataset.date, id: el.dataset.id, key: key() });
      break;
    }
    case 'goto-day': {
      ui.tab = 'plan';
      ui.week = startOfWeek(el.dataset.date, st.settings.weekStart);
      ui.openDays.add(el.dataset.date);
      render();
      $(`#day-${el.dataset.date}`)?.scrollIntoView({ block: 'start' });
      break;
    }

    // Recipes tab
    case 'new-recipe': openSheet({ kind: 'recipe-edit', draft: draftFrom(null), key: key() }); setTimeout(() => $('#ed-name')?.focus({ preventScroll: true }), 50); break;
    case 'view-recipe': openSheet({ kind: 'recipe-view', id: el.dataset.id, key: key() }); break;
    case 'toggle-filters': ui.filtersOpen = !ui.filtersOpen; render(); break;
    case 'clear-filters': ui.filter = {}; render(); break;
    case 'filter': {
      const g = el.dataset.group;
      if (!ui.filter[g]) ui.filter[g] = new Set();
      const set = ui.filter[g];
      set.has(el.dataset.option) ? set.delete(el.dataset.option) : set.add(el.dataset.option);
      render();
      break;
    }
    case 'categories': openSheet({ kind: 'categories', key: key() }); break;
    case 'fav-only': ui.favOnly = !ui.favOnly; render(); break;
    case 'surprise': { const sh = { kind: 'surprise', key: key(), seen: [] }; openSheet(sh); spin(sh); break; }
    case 'surprise-slot': { const sh = { kind: 'surprise', key: key(), seen: [], date: s.date, slot: s.slot }; openSheet(sh); spin(sh); break; }
    case 'surprise-again': spin(s); break;
    case 'surprise-add': {
      const id = s.pick;
      ui.sheets.pop(); // the surprise
      const add = top();
      if (add?.kind === 'add') {
        if (openBatches(st, id, add.date).length) { add.choose = id; renderSheet(); break; }
        ui.sheets.pop();
      }
      addRecipeToDay(s.date, s.slot, id);
      renderSheet();
      break;
    }
    case 'toggle-fav': {
      const r = findRecipe(st, el.dataset.id);
      if (r) { r.favorite = !r.favorite; store.save(); }
      break;
    }
    case 'rate': {
      const r = findRecipe(st, el.dataset.id);
      if (r) {
        const n = Number(el.dataset.stars);
        r.rating = r.rating === n ? 0 : n;
        store.save();
        if (r.rating) toast(`Rated ${r.rating} star${r.rating === 1 ? '' : 's'}`);
      }
      break;
    }
    case 'cook-start': {
      const sh = { kind: 'cook', id: s.id, servings: s.servings, step: 0, key: key() };
      openSheet(sh);
      keepScreenOn(true, sh).then(() => { if (top() === sh) renderSheet(); });
      break;
    }
    case 'cook-step': s.step = Math.max(0, (s.step || 0) + Number(el.dataset.delta)); renderSheet(); $('.sheet-body')?.scrollTo(0, 0); break;
    case 'timer-start': startTimer(Number(el.dataset.seconds), el.dataset.label); toast(`Timer started: ${clockText(Number(el.dataset.seconds))}`); break;
    case 'timer-stop': ui.timers = ui.timers.filter((t) => t.id !== el.dataset.id); renderTimers(); break;
    case 'timer-pause': {
      const t = ui.timers.find((x) => x.id === el.dataset.id);
      if (!t) break;
      if (t.paused) { t.end = Date.now() + t.left * 1000; t.paused = false; } else { t.left = Math.max(0, (t.end - Date.now()) / 1000); t.paused = true; }
      renderTimers();
      break;
    }
    case 'copy-week': {
      const from = ui.week;
      const has = daysBetween(from, addDays(from, 6)).some((d) => dayEntries(st, d).length);
      if (has && !confirm('This week already has meals. Add last week’s meals on top of them?')) break;
      const n = copyWeek(st, addDays(from, -7), from);
      store.save();
      toast(`Copied ${n} meal${n === 1 ? '' : 's'} from last week`);
      break;
    }

    // Shopping list
    case 'shop-group': ui.shopGroup = el.dataset.group; render(); break;
    case 'shop-filter': {
      const id = el.dataset.id;
      if (!id) ui.shopRecipes.clear();
      else if (ui.shopRecipes.has(id)) ui.shopRecipes.delete(id);
      else ui.shopRecipes.add(id);
      render();
      break;
    }
    case 'shop-check': {
      const k = el.dataset.key;
      if (k.startsWith('x:')) {
        const x = st.shopping.extras.find((y) => y.id === k.slice(2));
        if (x) x.checked = !x.checked;
      } else {
        const item = shoppingList(st, shopRange().from, shopRange().to).items.find((i) => i.key === k);
        setChecked(st, k, !item?.done, shopRange().to);
      }
      store.save();
      break;
    }
    case 'shop-uncheck':
      if (confirm('Untick everything on the list?')) {
        st.shopping.checked = {};
        for (const x of st.shopping.extras) x.checked = false;
        for (const a of st.shopping.recipes || []) a.bought = {};
        store.save();
      }
      break;
    case 'shop-remove-recipe': removeRecipeFromList(st, el.dataset.id); store.save(); break;
    case 'list-recipe': {
      const r = findRecipe(st, s.id);
      const scale = (s.servings || servingsOf(r)) / servingsOf(r);
      addRecipeToList(st, r.id, scale, uid(), today());
      store.save();
      renderSheet();
      toast(`${r.name} is on the shopping list`);
      break;
    }
    case 'unlist-recipe':
      for (const a of (st.shopping.recipes || []).filter((x) => x.recipeId === s.id)) removeRecipeFromList(st, a.id);
      store.save();
      renderSheet();
      break;
    case 'shop-remove-extra': st.shopping.extras = st.shopping.extras.filter((x) => x.id !== el.dataset.id); store.save(); break;
    case 'shop-clear-extras': st.shopping.extras = st.shopping.extras.filter((x) => !x.checked); store.save(); break;
    case 'shop-share': shareShopList(); break;
    case 'shop-view': ui.shopView = el.dataset.view; render(); break;
    case 'receipt-open': openReceipt(); break;
    case 'shop-send': openSend(); break;
    case 'send-pick': s.picks[el.dataset.key] = el.dataset.pick; s.instacartUrl = ''; renderSheet(); break;
    case 'send-amazon': sendAmazon(s); break;
    case 'send-instacart': sendInstacart(s); break;
    case 'send-tick': tickSent(s); break;
    case 'store-link': openStoreLink(el.dataset.key); break;
    case 'store-link-save': saveStoreLink(s); break;
    case 'store-link-clear': Object.assign(s.draft, { asin: '', host: '', title: '', price: '', paste: '' }); renderSheet(); break;
    case 'store-link-remove':
      setLink(st, s.linkKey, { amazon: null, instacart: null });
      closeSheet();
      store.save();
      break;
    case 'autoplan': openAutoPlan(); break;
    case 'autoplan-shuffle': suggestPlan(s); break;
    case 'autoplan-apply': applyAutoPlan(s); break;
    case 'ap-day': {
      const d = el.dataset.date;
      s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d];
      suggestPlan(s);
      break;
    }
    case 'ap-slot': {
      const id = el.dataset.slot;
      s.slots = s.slots.includes(id) ? s.slots.filter((x) => x !== id) : [...s.slots, id];
      suggestPlan(s);
      break;
    }
    case 'receipt-read-text': s.text = $('#receipt-text')?.value || ''; showReceiptRows(s, s.text); break;
    case 'receipt-save': saveReceipt(s); break;
    case 'pantry-have': {
      const p = addToPantry(el.dataset.name, el.dataset.food);
      if (p) p.key = el.dataset.key;
      store.save();
      toast(`${el.dataset.name} is at home, so it's off the list`);
      break;
    }
    case 'pantry-need':
    case 'pantry-remove':
      st.pantry = st.pantry.filter((p) => p.id !== el.dataset.id);
      store.save();
      break;

    // Summary tab
    case 'summary-mode': ui.summaryMode = el.dataset.mode; render(); break;
    case 'summary-prev':
    case 'summary-next': {
      const dir = act === 'summary-prev' ? -1 : 1;
      const anchor = ui.summaryAnchor || today();
      if (ui.summaryMode === 'year') ui.summaryAnchor = `${Number(anchor.slice(0, 4)) + dir}-06-01`;
      else if (ui.summaryMode === 'week') ui.summaryAnchor = addDays(anchor, 7 * dir);
      else {
        const d = fromKey(anchor);
        ui.summaryAnchor = dateKey(new Date(d.getFullYear(), d.getMonth() + dir, 1, 12));
      }
      render();
      break;
    }

    // Settings tab
    case 'sync-now': sync.syncNow(); break;
    case 'sign-up': syncAuth('up'); break;
    case 'sign-out':
      if (confirm('Sign out? Your data stays on this device, but stops syncing.')) sync.signOut().then(render);
      break;
    case 'slot-add': st.settings.slots.push({ id: uid(), name: 'Meal' }); store.save(); break;
    case 'slot-remove': {
      const i = Number(el.dataset.index);
      if (st.settings.slots.length <= 1) { alert('Keep at least one meal.'); break; }
      if (confirm(`Remove “${st.settings.slots[i].name}”? Anything already planned there moves to “Other”.`)) {
        st.settings.slots.splice(i, 1);
        store.save();
      }
      break;
    }
    case 'slot-up': {
      const i = Number(el.dataset.index);
      if (i > 0) {
        const list = st.settings.slots;
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        store.save();
      }
      break;
    }
    case 'export': exportData(); break;
    case 'erase':
      if (confirm('Erase all recipes and plans on this device? If you’re signed in, they stay in your account and come back when you sign in again.')) {
        sync.signOut().finally(() => { store.replace(defaultState()); render(); });
      }
      break;

    // Pop-ups
    case 'sheet-close':
      // "Back" from choosing leftovers returns to the recipe list.
      if (s?.kind === 'add' && s.choose && !s.fromView) { s.choose = null; renderSheet(); break; }
      if (s?.kind === 'receipt' && s.stage === 'review') { s.stage = 'start'; renderSheet(); break; }
      closeSheet();
      break;
    case 'edit-recipe': openSheet({ kind: 'recipe-edit', draft: draftFrom(findRecipe(st, s.id)), key: key() }); break;
    case 'view-servings': {
      const r = findRecipe(st, s.id);
      s.servings = Math.max(1, (s.servings || servingsOf(r)) + Number(el.dataset.delta));
      renderSheet();
      break;
    }
    case 'plan-recipe': {
      const date = $('#plan-date').value || today();
      const slot = $('#plan-slot').value;
      s.planDate = date;
      s.planSlot = slot;
      const batches = openBatches(st, s.id, date);
      if (batches.length) {
        openSheet({ kind: 'add', date, slot, choose: s.id, key: key(), fromView: true });
      } else {
        addRecipeToDay(date, slot, s.id);
      }
      break;
    }
    case 'save-recipe': saveRecipe(s); break;
    case 'delete-recipe': {
      const r = findRecipe(st, s.draft.id);
      const uses = Object.values(st.plan).reduce((n, day) => n + Object.values(day).filter((x) => x.recipeId === r.id).length, 0);
      if (confirm(`Delete “${r.name}”?${uses ? ` It's planned ${uses} time${uses === 1 ? '' : 's'}; those meals are removed too.` : ''}`)) {
        deleteRecipe(st, r.id);
        ui.sheets = ui.sheets.filter((x) => !(x.kind === 'recipe-view' && x.id === r.id) && x !== s);
        store.save();
        renderSheet();
      }
      break;
    }
    case 'remove-photo': s.draft.photo = null; renderSheet(); break;
    case 'ed-tag': {
      const tags = new Set(s.draft.tags);
      tags.has(el.dataset.option) ? tags.delete(el.dataset.option) : tags.add(el.dataset.option);
      s.draft.tags = [...tags];
      renderSheet();
      break;
    }
    case 'import-text': importFromText(s); break;
    case 'import-recipe': openSheet({ kind: 'recipe-edit', draft: draftFrom(null), key: key() }); setTimeout(() => $('#import-url')?.focus({ preventScroll: true }), 50); break;
    case 'ed-add-ing':
      s.draft.ingredients.push({ id: uid(), qtyText: '', unit: '', name: '' });
      renderSheet();
      $(`[data-bind="ingredients.${s.draft.ingredients.length - 1}.qtyText"]`)?.focus();
      break;
    case 'ed-remove-ing': s.draft.ingredients.splice(Number(el.dataset.index), 1); renderSheet(); break;
    case 'ed-paste-ings': {
      const lines = ($('#paste-ings')?.value || '').split('\n').map(parseIngredient).filter(Boolean);
      s.draft.ingredients = s.draft.ingredients.filter((i) => i.name.trim() || i.qtyText.trim());
      for (const p of lines) s.draft.ingredients.push({ id: uid(), qtyText: p.qty != null ? fmtQty(p.qty) : '', unit: p.unit, name: p.name });
      s.pasteIngOpen = false;
      s.pasteIngs = '';
      renderSheet();
      break;
    }
    case 'ed-add-step':
      s.draft.steps.push('');
      renderSheet();
      $(`[data-bind="steps.${s.draft.steps.length - 1}"]`)?.focus();
      break;
    case 'ed-remove-step': s.draft.steps.splice(Number(el.dataset.index), 1); renderSheet(); break;
    case 'ed-paste-steps': {
      const steps = parseSteps($('#paste-steps')?.value);
      s.draft.steps = s.draft.steps.filter((x) => x.trim()).concat(steps);
      s.pasteStepsOpen = false;
      s.pasteSteps = '';
      renderSheet();
      break;
    }

    // Adding to a day
    case 'add-mode': s.mode = el.dataset.mode; renderSheet(); setTimeout(() => $(s.mode === 'food' ? '#food-input' : '#add-search')?.focus({ preventScroll: true }), 50); break;
    case 'add-recipe': {
      const id = el.dataset.id;
      if (openBatches(st, id, s.date).length) { s.choose = id; renderSheet(); break; }
      ui.sheets.pop();
      addRecipeToDay(s.date, s.slot, id);
      renderSheet();
      break;
    }
    case 'add-cook':
      ui.sheets.pop();
      addRecipeToDay(s.date, s.slot, el.dataset.id);
      renderSheet();
      break;
    case 'add-leftover': {
      const [d, id] = el.dataset.from.split('|');
      const cook = getEntry(st, d, id);
      addEntry(st, s.date, { type: 'leftover', slot: s.slot, recipeId: cook.recipeId, from: el.dataset.from });
      ui.sheets.pop();
      store.save();
      renderSheet();
      toast('Leftovers added');
      break;
    }
    case 'new-recipe-from-add': openSheet({ kind: 'recipe-edit', draft: draftFrom(null), key: key() }); break;
    case 'add-search-food':
      ui.sheets.pop();
      openFoodSearch('', { kind: 'quick', date: s.date, slot: s.slot });
      break;
    case 'add-scan':
      ui.sheets.pop();
      openScanner({ kind: 'quick', date: s.date, slot: s.slot });
      break;
    case 'add-saved-food': {
      const f = getFood(st, el.dataset.id);
      addEntry(st, s.date, { type: 'food', slot: s.slot, ...entryFromFood(f, null, '') });
      ui.sheets.pop();
      store.save();
      renderSheet();
      toast(`Added ${f.name}`);
      break;
    }

    // One planned meal
    case 'entry-portions': changeEntry(s, (x) => { x.portions = Math.max(0.5, (Number(x.portions) || 1) + Number(el.dataset.delta)); }); break;
    case 'entry-scale': changeEntry(s, (x) => { x.scale = Math.max(0.5, (Number(x.scale) || 1) + Number(el.dataset.delta)); }); break;
    case 'plan-leftovers': openSheet({ kind: 'leftovers', date: s.date, id: s.id, key: key() }); break;
    case 'goto-entry': openSheet({ kind: 'entry', date: el.dataset.date, id: el.dataset.id, key: key() }); break;
    case 'entry-move': {
      const to = $('#move-date').value;
      const slot = $('#move-slot').value;
      if (!to) break;
      moveEntry(st, s.date, s.id, to, slot);
      s.date = to;
      store.save();
      toast(`Moved to ${formatDay(to, today()).toLowerCase()}`);
      break;
    }
    case 'entry-remove': {
      const entry = getEntry(st, s.date, s.id);
      const lefts = entry?.type === 'cook' ? leftoversOf(st, s.date, s.id) : [];
      let withLeftovers = true;
      if (lefts.length) {
        withLeftovers = confirm(`Also remove the ${lefts.length} leftover meal${lefts.length === 1 ? '' : 's'} from this batch?\n\nOK removes them. Cancel keeps them, and the first one becomes the day you cook.`);
      }
      removeEntry(st, s.date, s.id, { withLeftovers });
      ui.sheets.pop();
      store.save();
      renderSheet();
      break;
    }
    case 'toggle-leftover': {
      const cook = getEntry(st, s.date, s.id);
      if (!cook) break;
      const ex = leftoversOf(st, s.date, s.id).find((l) => l.date === el.dataset.date && l.entry.slot === el.dataset.slot);
      if (ex) removeEntryRaw(st, ex.date, ex.entry.id);
      else addEntry(st, el.dataset.date, { type: 'leftover', slot: el.dataset.slot, recipeId: cook.recipeId, from: refOf(s.date, s.id) });
      store.save();
      break;
    }

    // Food items
    case 'save-food': saveFood(s); break;
    case 'food-remove':
      removeEntryRaw(st, s.date, s.id);
      ui.sheets.pop();
      store.save();
      renderSheet();
      break;

    // Foods
    case 'recipes-view': ui.recipesView = el.dataset.view; render(); break;
    case 'food-add': openFoodSearch('', { kind: 'library' }); break;
    case 'food-edit': {
      const f = getFood(st, el.dataset.id);
      if (f) openSheet(foodEditSheet(f));
      break;
    }
    case 'food-save': saveFoodEdit(s); break;
    case 'fe-add-size': s.draft.portions.push({ unit: '', grams: '' }); renderSheet(); break;
    case 'fe-remove-size': s.draft.portions.splice(Number(el.dataset.index), 1); renderSheet(); break;
    case 'fe-delete': {
      const f = getFood(st, s.id);
      if (f && confirm(`Delete “${f.name}” from your foods? Meals already planned keep their numbers.`)) {
        deleteFood(st, f.id);
        ui.sheets.pop();
        store.save();
        renderSheet();
      }
      break;
    }
    case 'fs-pick': {
      const list = el.dataset.list;
      const food = list === 'mine' ? getFood(st, el.dataset.id) : s.results?.[list]?.[Number(el.dataset.index)];
      if (food) useFood(s, food);
      break;
    }
    case 'fs-manual': manualFromSearch(s); break;
    case 'scan-open': openScanner(s.purpose); break;
    case 'food-change':
    case 'food-lookup': {
      const e = getEntry(st, s.date, s.id);
      if (!e) break;
      // Keep the amount typed so far.
      e.amount = parseQty(s.draft.amountText);
      e.unit = s.draft.unit.trim();
      openFoodSearch(act === 'food-lookup' ? s.draft.name : e.name, { kind: 'entry', date: s.date, id: s.id });
      break;
    }
    case 'food-unlink': {
      const e = getEntry(st, s.date, s.id);
      s.draft.linked = false;
      s.draft.name = e?.name || s.draft.name;
      s.draft.nutrition = { ...(e?.nutrition || {}) };
      s.draft.costText = e?.cost != null ? String(e.cost) : '';
      s.draft.remember = false;
      renderSheet();
      break;
    }
    case 'ing-find': {
      const ing = s.draft.ingredients[Number(el.dataset.index)];
      if (!ing?.name.trim()) break;
      openFoodSearch(ing.name.split(',')[0].replace(/\(.*?\)/g, '').trim(), { kind: 'ingredient', index: Number(el.dataset.index) });
      break;
    }
    case 'ed-use-calc': {
      const calc = recipeFromIngredients(st, draftAsRecipe(s.draft));
      for (const n of NUTRIENTS) s.draft.nutrition[n.key] = calc.perPortion[n.key];
      if (calc.totalCost != null) s.draft.costText = String(calc.totalCost);
      renderSheet();
      toast('Filled in from the ingredients');
      break;
    }

    // Categories
    case 'cat-delete-group': {
      const g = st.categories.find((x) => x.id === el.dataset.group);
      if (confirm(`Delete the “${g.name}” group and its labels?`)) {
        st.categories = st.categories.filter((x) => x !== g);
        store.save();
      }
      break;
    }
    case 'cat-delete-option': {
      const g = st.categories.find((x) => x.id === el.dataset.group);
      g.options = g.options.filter((o) => o.id !== el.dataset.option);
      store.save();
      break;
    }
    default: break;
  }
}

function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const st = S();
  if (kind === 'sign-in') { syncAuth('in'); return; }
  if (kind === 'store-link-paste') { useAmazonPaste(top()); return; }
  if (kind === 'food-search') {
    const sh = top();
    sh.query = $('#fs-query').value;
    $('#fs-query').blur();
    runFoodSearch(sh);
    return;
  }
  if (kind === 'barcode') {
    const code = $('#barcode-input').value.replace(/\D/g, '');
    if (code.length >= 6) barcodeFound(top(), code);
    return;
  }
  if (kind === 'add-food') {
    const input = $('#food-input');
    addFoods(top(), input.value);
    return;
  }
  if (kind === 'import-url') {
    const sh = top();
    sh.importUrl = $('#import-url').value;
    $('#import-url').blur();
    importFromUrl(sh);
    return;
  }
  if (kind === 'pantry-add') {
    const input = $('#pantry-name');
    for (const name of input.value.split(/[,;\n]+/)) addToPantry(name);
    input.value = '';
    store.save();
    $('#pantry-name')?.focus({ preventScroll: true });
    return;
  }
  if (kind === 'shop-add') {
    const input = $('#shop-extra');
    const name = input.value.trim();
    if (!name) return;
    st.shopping.extras.push({ id: uid(), name, section: guessSection(name), checked: false });
    input.value = '';
    store.save();
    $('#shop-extra')?.focus({ preventScroll: true });
    return;
  }
  if (kind === 'cat-add-option') {
    const input = $('input', form);
    const name = input.value.trim();
    if (!name) return;
    st.categories.find((g) => g.id === form.dataset.group)?.options.push({ id: uid(), name });
    store.save();
    return;
  }
  if (kind === 'cat-add-group') {
    const input = $('input', form);
    const name = input.value.trim();
    if (!name) return;
    st.categories.push({ id: uid(), name, options: [] });
    store.save();
  }
}

async function onChange(e) {
  const el = e.target;
  const st = S();
  if (el.dataset.bind) {
    bindInput(el);
    // A renamed ingredient may be a different food now.
    const m = el.dataset.bind.match(/^ingredients\.(\d+)\.name$/);
    if (m) {
      const ing = top()?.draft?.ingredients?.[Number(m[1])];
      if (ing?.foodId) {
        const f = getFood(st, ing.foodId);
        if (!f || findFood(st, ing.name) !== f) delete ing.foodId;
      }
    }
    if (el.dataset.recalc !== undefined) renderSheet();
    return;
  }
  if (el.dataset.icPrice !== undefined) {
    const k = el.dataset.icPrice;
    const price = parsePrice(el.value);
    const old = getLink(st, k)?.instacart || {};
    setLink(st, k, { instacart: price == null && !old.name ? null : { ...old, name: old.name || '', price } });
    store.save();
    renderSheet();
    return;
  }
  if (el.dataset.file === 'import' && el.files?.[0]) { importData(el.files[0]); return; }
  if (el.dataset.file === 'receipt' && el.files?.[0]) { readReceiptPhoto(top(), el.files[0]); return; }
  if (el.dataset.rcFood !== undefined) {
    const sh = top();
    const r = sh.rows[Number(el.dataset.rcFood)];
    r.foodId = el.value;
    const f = getFood(st, r.foodId);
    if (f && !r.unit) { r.qty = f.price?.qty ?? 1; r.unit = f.price?.unit || ''; }
    renderSheet();
    return;
  }
  if (el.dataset.rcQty !== undefined || el.dataset.rcUnit !== undefined) {
    const sh = top();
    const i = Number(el.dataset.rcQty ?? el.dataset.rcUnit);
    if (el.dataset.rcQty !== undefined) sh.rows[i].qty = el.value; else sh.rows[i].unit = el.value;
    renderSheet();
    return;
  }
  if (el.dataset.file === 'photo' && el.files?.[0]) {
    const s = top();
    s.photoBusy = true;
    renderSheet();
    try {
      s.draft.photo = await savePhoto(el.files[0]);
    } catch (err) {
      alert(err.message || 'Could not use that picture.');
    }
    s.photoBusy = false;
    renderSheet();
    return;
  }
  if (el.id === 'recipe-sort') { ui.sort = el.value; render(); return; }
  if (el.dataset.pantryStaple) {
    const p = st.pantry.find((x) => x.id === el.dataset.pantryStaple);
    if (p) { p.staple = el.checked; store.save(); }
    return;
  }
  if (el.dataset.pantryUntil) {
    const p = st.pantry.find((x) => x.id === el.dataset.pantryUntil);
    if (p) { p.until = el.value || null; store.save(); }
    return;
  }
  if (el.id === 'ap-leftovers') { top().leftovers = el.checked; suggestPlan(top()); return; }
  if (el.id === 'ap-budget') { suggestPlan(top()); return; }
  if (el.id === 'shop-from') { ui.shopFrom = el.value || null; render(); return; }
  if (el.id === 'shop-days') {
    const n = Math.max(1, Math.min(31, Math.round(Number(el.value)) || 7));
    st.settings.shopDays = n;
    store.save();
    return;
  }
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    if (k === 'weekStart') st.settings[k] = Number(el.value);
    else if (k === 'usdaKey') st.settings[k] = el.value.trim();
    else st.settings[k] = el.value.trim() || '$';
    if (k === 'weekStart') ui.week = startOfWeek(ui.week, st.settings.weekStart);
    store.save();
    return;
  }
  if (el.dataset.goal) {
    const v = el.value === '' ? undefined : Math.max(0, Number(el.value));
    if (v === undefined) delete st.settings.goals[el.dataset.goal];
    else st.settings.goals[el.dataset.goal] = v;
    store.save();
    return;
  }
  if (el.dataset.slotName !== undefined) {
    const sl = st.settings.slots[Number(el.dataset.slotName)];
    if (sl && el.value.trim()) { sl.name = el.value.trim(); store.save(); }
    return;
  }
  if (el.dataset.catGroup) {
    const g = st.categories.find((x) => x.id === el.dataset.catGroup);
    if (g && el.value.trim()) { g.name = el.value.trim(); store.save(); }
    return;
  }
  if (el.dataset.catOption) {
    const g = st.categories.find((x) => x.id === el.dataset.group);
    const o = g?.options.find((x) => x.id === el.dataset.catOption);
    if (o && el.value.trim()) { o.name = el.value.trim(); store.save(); }
  }
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.bind && el.dataset.rerender === undefined && el.type !== 'checkbox') { bindInput(el); return; }
  if (el.dataset.bind && el.dataset.rerender !== undefined) { bindInput(el); return; }
  if (el.id === 'recipe-search') { ui.search = el.value; render(); return; }
  if (el.id === 'add-search') { top().search = el.value; renderSheet(); return; }
  if (el.id === 'fs-query') { top().query = el.value; return; }
  if (el.id === 'foods-search') { ui.foodSearch = el.value; render(); return; }
  if (el.id === 'food-input') { top().foodText = el.value; return; }
  if (el.id === 'paste-ings') { top().pasteIngs = el.value; return; }
  if (el.id === 'paste-steps') { top().pasteSteps = el.value; return; }
  if (el.id === 'paste-all') { top().pasteAll = el.value; return; }
  if (el.id === 'receipt-text') { top().text = el.value; return; }
  if (el.id === 'rc-store') { top().store = el.value; return; }
  if (el.id === 'ap-budget') { top().budgetText = el.value; return; }
  if (el.id === 'rc-date') { top().date = el.value; return; }
  if (el.id === 'import-url') { top().importUrl = el.value; }
}

// ---------- Start ----------

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', onChange);
document.addEventListener('input', onInput);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && top()) closeSheet();
  const c = top();
  if (c?.kind === 'cook' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
    const steps = findRecipe(S(), c.id)?.steps?.length || 0;
    c.step = Math.max(0, Math.min(steps, (c.step || 0) + (e.key === 'ArrowRight' ? 1 : -1)));
    renderSheet();
  }
});

store.subscribe(() => {
  const scroll = window.scrollY;
  render();
  window.scrollTo(0, scroll);
});

// Roll over to a new day while the app stays open.
let lastToday = today();
setInterval(() => {
  const t = today();
  if (t !== lastToday) {
    if (ui.week === startOfWeek(lastToday, S().settings.weekStart)) ui.week = startOfWeek(t, S().settings.weekStart);
    lastToday = t;
    render();
  }
}, 30_000);

pruneChecks(S(), today());
render();
initPhotos(() => render());

// Sync: redraw when changes arrive from another device, and keep the status line current.
sync.init(store, () => store.save());
let lastSyncState = sync.status.state;
sync.onStatus((st) => {
  const el = $('#sync-status');
  if (el) { el.textContent = syncStatusText(); el.className = `hint sync-status ${st.state}`; }
  const signedOut = st.state === 'off' && lastSyncState !== 'off';
  lastSyncState = st.state;
  if (signedOut && ui.tab === 'settings') render();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // When an update installs, reload once so every file comes from the new version.
  const hadWorker = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
}
