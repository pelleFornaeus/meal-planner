import { store } from './store.js';
import { sync } from './sync.js';
import { initPhotos, photoUrl, savePhoto } from './photos.js';
import {
  addDays, dateKey, daysBetween, formatDay, fromKey, monthName, shortDate, shortDay, startOfWeek,
} from './dates.js';
import {
  NUTRIENTS, addEntry, batchLeft, batchSize, blankRecipe, costPerServing, dayEntries, dayTotals,
  deleteRecipe, entryName, entryTotals, filterRecipes, findRecipe, fmtMoney, fmtNum, fmtQty, foodFor,
  getEntry, ingredientText, leftoversOf, moveEntry, openBatches, parseFoods, parseIngredient, parseQty,
  parseSteps, perServing, rangeTotals, recentFoods, recipeTags, refOf, rememberFood, removeEntry,
  removeEntryRaw, servingsOf, sourceOf, uid, defaultState,
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
  filter: {}, // groupId -> Set(optionIds)
  filtersOpen: false,
  summaryMode: 'week',
  summaryAnchor: null,
  sheets: [], // stack of open sheets; the last one shows
};

const top = () => ui.sheets[ui.sheets.length - 1] || null;
function openSheet(sheet) { ui.sheets.push(sheet); renderSheet(); }
function closeSheet() { ui.sheets.pop(); renderSheet(); }
function closeAllSheets() { ui.sheets = []; renderSheet(); }

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
    <div class="days">
      ${daysBetween(from, to).map((d) => renderDay(d, t)).join('')}
    </div>
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

function renderRecipes() {
  const list = filterRecipes(S(), { search: ui.search, filter: ui.filter, sort: ui.sort });
  const active = Object.values(ui.filter).reduce((n, s) => n + (s?.size || 0), 0);
  const groups = S().categories;
  return `
    <header class="page-header">
      <h1>Recipes</h1>
      <button class="btn primary" data-act="new-recipe">+ New</button>
    </header>
    ${S().recipes.length ? `
      <div class="toolbar">
        <input id="recipe-search" class="search" type="search" placeholder="Search recipes or ingredients" value="${esc(ui.search)}" autocomplete="off" />
        <select id="recipe-sort" aria-label="Sort">
          ${[['name', 'A–Z'], ['newest', 'Newest'], ['cost', 'Cheapest'], ['cal', 'Fewest calories'], ['protein', 'Most protein'], ['time', 'Quickest']]
            .map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="filter-bar">
        <button class="chip${ui.filtersOpen || active ? ' on' : ''}" data-act="toggle-filters">Filter${active ? ` (${active})` : ''} ${ui.filtersOpen ? '▾' : '▸'}</button>
        ${active ? '<button class="link" data-act="clear-filters">Clear</button>' : ''}
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
        <p class="hint flush">Add your first recipe with ingredients, steps, a photo, nutrition and price. You can also paste a list of ingredients or steps from a website.</p>
        <button class="btn primary" data-act="new-recipe">Add a recipe</button>
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
          <span class="title">${esc(r.name)}</span>
          ${facts.length ? `<span class="meta">${esc(facts.join(' · '))}</span>` : ''}
          <span class="badges">${recipeTags(S(), r).slice(0, 4).map(({ option }) => `<span class="badge">${esc(option.name)}</span>`).join('')}</span>
        </span>
      </button>
    </li>`;
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
        <h1 class="recipe-title">${esc(r.name)}</h1>
        <div class="badges">${recipeTags(S(), r).map(({ option }) => `<span class="badge">${esc(option.name)}</span>`).join('')}</div>
        <p class="facts">${[
          `Makes ${base} portion${base === 1 ? '' : 's'}`,
          r.minutes ? `${r.minutes} min` : '',
          r.cost != null && r.cost !== '' ? `${money(Number(r.cost))} in total (${money(cps)} a portion)` : '',
        ].filter(Boolean).map(esc).join(' · ')}</p>

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
          <ol class="step-list">${r.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
        </div>` : ''}

        ${r.notes ? `<div class="card"><h2 class="section tight">Notes</h2><p class="notes">${esc(r.notes)}</p></div>` : ''}
        ${r.source ? `<p class="hint">Source: <a class="link" href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a></p>` : ''}
      </div>
    </div>`;
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
  return `
    <div class="sheet">
      ${sheetHeader(d.id ? 'Edit recipe' : 'New recipe', { left: 'Cancel', right: 'Save', rightAct: 'save-recipe' })}
      <div class="sheet-body">
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
                <input type="text" class="qty" inputmode="decimal" placeholder="Qty" data-bind="ingredients.${n}.qtyText" value="${esc(i.qtyText)}" aria-label="Amount" />
                <input type="text" class="unit" placeholder="Unit" data-bind="ingredients.${n}.unit" value="${esc(i.unit)}" aria-label="Unit" list="units" />
                <input type="text" class="name" placeholder="Ingredient" data-bind="ingredients.${n}.name" value="${esc(i.name)}" aria-label="Ingredient" />
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
          <div class="nutri-inputs">
            ${NUTRIENTS.map((n) => `
              <label class="field"><span>${n.label} (${n.unit})</span>
                <input type="number" inputmode="decimal" min="0" step="any" data-bind="nutrition.${n.key}" data-num data-optional value="${esc(d.nutrition[n.key] ?? '')}" /></label>`).join('')}
          </div>
          <p class="hint flush">Automatic lookup from the ingredients comes in the next update.</p>
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
      .map((i) => ({ id: i.id || uid(), qty: parseQty(i.qtyText), unit: (i.unit || '').trim(), name: i.name.trim() })),
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
    <input id="add-search" class="search" type="search" placeholder="Search recipes" value="${esc(s.search || '')}" autocomplete="off" />
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
    <p class="hint">Type what you had, with amounts. Separate items with commas. Foods you've added before fill in their nutrition and price.</p>
    ${foods.length ? `
      <h2 class="section">Your foods</h2>
      <ul class="pick-list">
        ${foods.map((f) => `<li><button class="pick" data-act="add-saved-food" data-id="${f.id}">
          <span class="entry-main"><span class="title">${esc(f.name)}</span>
          <span class="meta">${esc([[f.amount != null ? fmtQty(f.amount) : '', f.unit].filter(Boolean).join(' '), f.nutrition?.cal != null ? kcal(f.nutrition.cal) : '', f.cost != null ? money(f.cost) : ''].filter(Boolean).join(' · '))}</span></span>
        </button></li>`).join('')}
      </ul>` : ''}
  `;
}

function addFoods(s, text) {
  const parts = parseFoods(text);
  if (!parts.length) return;
  const added = [];
  for (const p of parts) {
    const { item, matched } = foodFor(S(), p);
    const e = addEntry(S(), s.date, { type: 'food', slot: s.slot, ...item });
    added.push({ e, matched });
  }
  store.save();
  ui.sheets.pop();
  const unmatched = added.filter((a) => !a.matched);
  if (added.length === 1 && unmatched.length === 1) {
    openFoodSheet(s.date, unmatched[0].e.id);
  } else {
    renderSheet();
    toast(unmatched.length
      ? `Added. Tap ${unmatched.length === 1 ? 'the item' : 'items'} marked “Add nutrition” to fill in the numbers.`
      : `Added ${added.length} item${added.length === 1 ? '' : 's'}`);
  }
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

function openFoodSheet(date, id) {
  const e = getEntry(S(), date, id);
  if (!e) return;
  openSheet({
    kind: 'food', date, id, key: key(),
    draft: {
      name: e.name || '',
      amountText: e.amount != null ? fmtQty(e.amount) : '',
      unit: e.unit || '',
      nutrition: { ...(e.nutrition || {}) },
      costText: e.cost != null ? String(e.cost) : '',
      remember: true,
      slot: e.slot,
    },
  });
}

function renderFoodSheet(s) {
  const d = s.draft;
  return `
    <div class="sheet">
      ${sheetHeader(shortDay(s.date), { left: 'Cancel', right: 'Save', rightAct: 'save-food' })}
      <div class="sheet-body">
        <label class="field"><span>Food</span><input type="text" id="food-name" data-bind="name" value="${esc(d.name)}" /></label>
        <div class="two-col">
          <label class="field"><span>Amount</span><input type="text" inputmode="decimal" data-bind="amountText" value="${esc(d.amountText)}" placeholder="e.g. 100" /></label>
          <label class="field"><span>Unit</span><input type="text" data-bind="unit" value="${esc(d.unit)}" placeholder="g, ml, cup…" list="units" /></label>
        </div>
        <datalist id="units">${['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'oz', 'lb', 'piece', 'slice'].map((u) => `<option value="${u}">`).join('')}</datalist>
        <div class="card">
          <h2 class="section tight">Nutrition for this amount</h2>
          <div class="nutri-inputs">
            ${NUTRIENTS.map((n) => `
              <label class="field"><span>${n.label} (${n.unit})</span>
                <input type="number" inputmode="decimal" min="0" step="any" data-bind="nutrition.${n.key}" data-num data-optional value="${esc(d.nutrition[n.key] ?? '')}" /></label>`).join('')}
          </div>
          <p class="hint flush">Tip: the label on the package lists these. Automatic lookup comes in the next update.</p>
        </div>
        <label class="field"><span>Price for this amount (${esc(S().settings.currency)})</span>
          <input type="text" inputmode="decimal" data-bind="costText" value="${esc(d.costText)}" placeholder="Optional" /></label>
        <label class="field row"><input type="checkbox" data-bind="remember" ${d.remember ? 'checked' : ''} />
          <span>Remember this food, so next time the numbers fill in by themselves</span></label>
        <button class="btn danger wide" data-act="food-remove">Remove from this day</button>
      </div>
    </div>`;
}

function saveFood(s) {
  const d = s.draft;
  const e = getEntry(S(), s.date, s.id);
  if (!e) { closeSheet(); return; }
  if (!d.name.trim()) { alert('Give the food a name.'); return; }
  const nutrition = {};
  for (const n of NUTRIENTS) {
    const v = d.nutrition[n.key];
    if (v != null && v !== '' && Number.isFinite(Number(v))) nutrition[n.key] = Number(v);
  }
  Object.assign(e, {
    name: d.name.trim(),
    amount: parseQty(d.amountText),
    unit: d.unit.trim(),
    nutrition,
    cost: parseQty(d.costText),
  });
  if (d.remember) rememberFood(S(), e);
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

    // Summary tab
    case 'summary-mode': ui.summaryMode = el.dataset.mode; render(); break;
    case 'summary-prev':
    case 'summary-next': {
      const dir = act === 'summary-prev' ? -1 : 1;
      const anchor = ui.summaryAnchor || today();
      if (ui.summaryMode === 'week') ui.summaryAnchor = addDays(anchor, 7 * dir);
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
    case 'add-saved-food': {
      const f = st.foods.find((x) => x.id === el.dataset.id);
      const { item } = foodFor(st, { name: f.name, amount: null, unit: '' });
      addEntry(st, s.date, { type: 'food', slot: s.slot, ...item });
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
  if (kind === 'add-food') {
    const input = $('#food-input');
    addFoods(top(), input.value);
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
  if (el.dataset.bind) { bindInput(el); return; }
  if (el.dataset.file === 'import' && el.files?.[0]) { importData(el.files[0]); return; }
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
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    st.settings[k] = k === 'weekStart' ? Number(el.value) : el.value.trim() || '$';
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
  if (el.id === 'food-input') { top().foodText = el.value; return; }
  if (el.id === 'paste-ings') { top().pasteIngs = el.value; return; }
  if (el.id === 'paste-steps') { top().pasteSteps = el.value; }
}

// ---------- Start ----------

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', onChange);
document.addEventListener('input', onInput);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && top()) closeSheet();
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
