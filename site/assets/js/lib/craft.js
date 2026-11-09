// Craft-or-buy maths. No DOM access.
//
// For every item the cheapest way to get one unit is chosen: buy it (market or your own price), or
// craft it with one of its recipes, where each material is again bought or crafted. Crafting labor is
// reduced by the player's rank in the recipe's vocation and priced at the player's labor value.

export const COIN_ID = 500; // "Coin" in recipes: the amount is in copper

/** Suggested crafting vocation by the product's item category (the recipe data has no vocation). */
export const CATEGORY_VOCATION = {
  Lumber: 'Carpentry', Furniture: 'Carpentry', Storage: 'Carpentry', Lighting: 'Carpentry',
  'Stone Brick': 'Masonry',
  Metal: 'Metalwork', 'Precious Metal': 'Metalwork', 'Plate Armor': 'Metalwork',
  Fabric: 'Tailoring', Textile: 'Tailoring', 'Cloth Armor': 'Tailoring', Cloak: 'Tailoring', Costume: 'Tailoring',
  Hide: 'Leatherwork', 'Leather Armor': 'Leatherwork', Rubber: 'Leatherwork',
  Paper: 'Printing', Book: 'Printing', Design: 'Printing', 'Sheet Music': 'Printing',
  Food: 'Cooking', Drink: 'Cooking', 'Cooking Oil': 'Cooking', Spice: 'Cooking', Spices: 'Cooking',
  Potion: 'Alchemy', 'Healing Potion': 'Alchemy', 'Mana Potion': 'Alchemy', 'Defense Potion': 'Alchemy', Alchemy: 'Alchemy', Dye: 'Alchemy',
  Axe: 'Weaponry', Bow: 'Weaponry', Club: 'Weaponry', Dagger: 'Weaponry', Greataxe: 'Weaponry', Greatclub: 'Weaponry',
  Greatsword: 'Weaponry', Katana: 'Weaponry', Longspear: 'Weaponry', Nodachi: 'Weaponry', Scepter: 'Weaponry',
  Shortspear: 'Weaponry', Staff: 'Weaponry', Sword: 'Weaponry', Shield: 'Weaponry', Rifle: 'Weaponry', Scythe: 'Weaponry',
  Talisman: 'Handicrafts', Gem: 'Handicrafts', Lunagem: 'Handicrafts', Lunastone: 'Handicrafts', Ring: 'Handicrafts',
  Earring: 'Handicrafts', Necklace: 'Handicrafts', Archeum: 'Handicrafts', Relic: 'Handicrafts', Toy: 'Handicrafts',
  Lute: 'Handicrafts', Flute: 'Handicrafts', Drum: 'Handicrafts',
  Machining: 'Machining', Vehicle: 'Machining', Ship: 'Machining', Sail: 'Machining', Mast: 'Machining', Figurehead: 'Machining',
  'Steering Gear': 'Machining', Navigation: 'Machining', 'Ship Propellant': 'Machining', Glider: 'Machining', Magithopter: 'Machining',
  Buildings: 'Construction',
  Seed: 'Farming', Saplings: 'Farming', Livestock: 'Husbandry',
};

/**
 * @param o.recipes        [{id, product, name, category, amount, chance, labor, materials:[{id,name,qty}]}]
 * @param o.buyPrice       (itemId) => copper | null     market or own price of one unit
 * @param o.laborFactor    (vocation|null) => multiplier  rank + tool reduction (1 when unknown)
 * @param o.laborCopper    value of one labor point in copper (0 = labor is free)
 * @param o.vocationOf     (recipe) => vocation | null    player's choice, else the category suggestion
 * @param o.choiceOf       (itemId) => 'auto' | 'buy' | 'craft'
 * @param o.recipeOf       (itemId) => recipeId | null    forced recipe for an item with several
 */
export function makeCraftCalc(o) {
  // recipes by product; identical recipes (same materials and amount, e.g. one per faction's workbench) count once
  const byProduct = new Map(), seen = new Map();
  for (const r of o.recipes) {
    const sig = `${r.product}|${r.amount}|${r.materials.map((m) => `${m.id}:${m.qty}`).sort().join(',')}`;
    const prev = seen.get(sig);
    if (prev) { if (r.labor < prev.labor) Object.assign(prev, { ...r }); continue; }
    const copy = { ...r };
    seen.set(sig, copy);
    if (!byProduct.has(r.product)) byProduct.set(r.product, []);
    byProduct.get(r.product).push(copy);
  }
  const names = new Map(o.recipes.flatMap((r) => [[r.product, r.name], ...r.materials.map((m) => [m.id, m.name])]));
  const memo = new Map();

  const buy = (id) => (id === COIN_ID ? 1 : o.buyPrice(id));
  const vocation = (r) => o.vocationOf?.(r) ?? CATEGORY_VOCATION[r.category] ?? null;

  /** One unit made with recipe r: {unit, mats, labor, missing[]} where unit = mats + labor × labor value. */
  function viaRecipe(r, stack) {
    const made = r.amount * ((r.chance ?? 100) / 100);
    let mats = 0, labor = 0;
    const missing = [];
    for (const m of r.materials) {
      const b = best(m.id, stack);
      if (b.unit == null) { missing.push(...(b.missing.length ? b.missing : [m.name])); continue; }
      mats += m.qty * b.mats;
      labor += m.qty * b.labor;
    }
    labor += r.labor * o.laborFactor(vocation(r));
    if (missing.length) return { unit: null, mats: null, labor: labor / made, missing: [...new Set(missing)] };
    return { unit: (mats + labor * o.laborCopper) / made, mats: mats / made, labor: labor / made, missing: [] };
  }

  /**
   * Cheapest way to get one unit of an item.
   * @returns {id, name, decision:'buy'|'craft'|null, unit, mats, labor, buyPrice, recipe, craft, missing[]}
   */
  function best(id, stack = new Set()) {
    if (memo.has(id)) return memo.get(id);
    const buyPrice = buy(id);
    const recipes = id === COIN_ID ? [] : byProduct.get(id) || [];
    const res = { id, name: names.get(id) || String(id), buyPrice, recipes, decision: null, unit: null, mats: null, labor: 0, recipe: null, craft: null, missing: [] };
    if (stack.has(id)) { // a material that (indirectly) needs itself: only buying is possible here
      if (buyPrice != null) Object.assign(res, { decision: 'buy', unit: buyPrice, mats: buyPrice });
      else res.missing = [res.name];
      return res; // not memoized: the full answer comes from the outer call
    }
    const inner = new Set(stack).add(id);
    const choice = o.choiceOf?.(id) || 'auto';
    const forced = o.recipeOf?.(id);
    let craft = null;
    for (const r of recipes) {
      if (forced != null && r.id !== forced && recipes.some((x) => x.id === forced)) continue;
      const c = { recipe: r, ...viaRecipe(r, inner) };
      if (!craft || (c.unit != null && (craft.unit == null || c.unit < craft.unit))) craft = c;
    }
    res.craft = craft;
    const canBuy = buyPrice != null, canCraft = craft?.unit != null;
    let pick = null;
    if (choice === 'buy') pick = canBuy ? 'buy' : canCraft ? 'craft' : null;
    else if (choice === 'craft') pick = canCraft ? 'craft' : canBuy ? 'buy' : null;
    else if (canBuy && canCraft) pick = craft.unit < buyPrice ? 'craft' : 'buy';
    else pick = canBuy ? 'buy' : canCraft ? 'craft' : null;
    if (pick === 'buy') Object.assign(res, { decision: 'buy', unit: buyPrice, mats: buyPrice, labor: 0 });
    else if (pick === 'craft') Object.assign(res, { decision: 'craft', unit: craft.unit, mats: craft.mats, labor: craft.labor, recipe: craft.recipe });
    else res.missing = craft?.missing?.length ? craft.missing : [res.name];
    memo.set(id, res);
    return res;
  }

  /**
   * The tree for `qty` units of an item, following the chosen decisions.
   * forceCraft: show the item itself as crafted even when buying it is cheaper (its materials keep their choice).
   * Node: {id, name, qty, decision, unit, total, buyPrice, craftUnit, recipe, vocation, runs, ownLabor, children[]}
   */
  function tree(id, qty = 1, depth = 0, stack = new Set(), forceCraft = false) {
    let b = best(id);
    if (forceCraft && b.decision !== 'craft' && b.craft?.recipe) {
      b = { ...b, decision: 'craft', unit: b.craft.unit, recipe: b.craft.recipe, labor: b.craft.labor };
    }
    const node = {
      id, name: b.name, qty, decision: b.decision, unit: b.unit, total: b.unit == null ? null : b.unit * qty,
      buyPrice: b.buyPrice, craftUnit: b.craft?.unit ?? null, recipes: b.recipes, recipe: b.recipe,
      vocation: b.recipe ? vocation(b.recipe) : null, labor: b.labor * qty, missing: b.missing, children: [],
    };
    if (b.decision === 'craft' && depth < 12 && !stack.has(id)) {
      const r = b.recipe, runs = qty / (r.amount * ((r.chance ?? 100) / 100)), inner = new Set(stack).add(id);
      node.runs = runs;
      node.ownLabor = r.labor * o.laborFactor(vocation(r)) * runs;
      node.children = r.materials.map((m) => tree(m.id, m.qty * runs, depth + 1, inner));
    }
    return node;
  }

  /** Everything to buy for a tree: [{id, name, qty, unit, total}] (coins as one line). */
  function shoppingList(root) {
    const acc = new Map();
    (function walk(n) {
      if (n.decision === 'craft' && n.children.length) { n.children.forEach(walk); return; }
      const cur = acc.get(n.id) || { id: n.id, name: n.name, qty: 0, unit: n.unit, total: 0, missing: n.decision == null };
      cur.qty += n.qty;
      cur.total = n.unit == null ? null : (cur.total ?? 0) + n.unit * n.qty;
      acc.set(n.id, cur);
    })(root);
    return [...acc.values()].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  }

  /** Labor of a tree by vocation: [{vocation, labor}] */
  function laborByVocation(root) {
    const acc = new Map();
    (function walk(n) {
      if (n.ownLabor) acc.set(n.vocation || 'Unknown', (acc.get(n.vocation || 'Unknown') || 0) + n.ownLabor);
      n.children.forEach(walk);
    })(root);
    return [...acc.entries()].map(([v, labor]) => ({ vocation: v, labor })).sort((a, b) => b.labor - a.labor);
  }

  const craftable = () => [...byProduct.keys()];
  const recipesOf = (id) => byProduct.get(id) || [];
  return { best, tree, shoppingList, laborByVocation, craftable, recipesOf, vocation, nameOf: (id) => names.get(id) };
}
