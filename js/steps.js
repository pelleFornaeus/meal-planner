// Steps with checklists. A step is saved as plain text: the step itself, then one
// "- " line per checklist item, so old recipes, imports and sync keep working:
//   "Combine the dry ingredients\n- 1/4 cup chili powder\n- 1 tsp salt"
// Pure functions, so they can be tested.
import { ingredientText } from './model.js';

export function splitStep(step) {
  const lines = String(step || '').split('\n');
  const text = [];
  const items = [];
  for (const line of lines) {
    const m = line.match(/^\s*[-•]\s+(.*\S)\s*$/);
    if (m && (text.length || items.length)) items.push(m[1]);
    else if (line.trim()) text.push(line.trim());
  }
  return { text: text.join('\n'), items };
}

export function joinStep({ text, items }) {
  const list = (items || []).map((x) => String(x || '').trim()).filter(Boolean);
  const t = String(text || '').trim();
  if (!t && !list.length) return '';
  return [t || 'Step', ...list.map((x) => `- ${x}`)].join('\n');
}

// A checklist item that is one of the recipe's ingredients, scaled with the portions.
export function itemText(item, ingredients, factor = 1) {
  if (factor === 1) return item;
  const ing = (ingredients || []).find((i) => ingredientText(i) === item);
  return ing ? ingredientText(ing, factor) : item;
}

// Ingredients not yet on any step's checklist.
export function unusedIngredients(ingredients, steps) {
  const used = new Set(steps.flatMap((s) => (typeof s === 'string' ? splitStep(s).items : s.items || [])));
  return (ingredients || []).filter((i) => String(i.name || '').trim() && !used.has(ingredientText(i)));
}
