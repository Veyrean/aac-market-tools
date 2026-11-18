// Which recipes level a crafting vocation best. No DOM access.
//
// Proficiency points per craft = the labor the craft costs (after the rank's reduction, or the listed
// base labor). Each recipe is scored by gold per 1,000 points: materials at their AH price (crafted
// only when they have no price) minus what the result sells for after the AH fee. Each step of a chain
// is its own recipe in the ranking, so cheaper-to-craft materials are not folded into the step above. Material availability is the
// number of crafts per day the market's daily volume of the scarcest bought material can supply.

import { COIN_ID } from './craft.js';

/** The item's own recipe or a variant of it ("X", "X: Mass Production x10", "Mass Production: X"). */
export const isNamedRecipe = (r) => !r.title || r.title.toLowerCase().includes(String(r.name).toLowerCase());

/**
 * @param o.calc         makeCraftCalc(...) result
 * @param o.vocation     vocation to level
 * @param o.laborFactor  (vocation) => multiplier (rank + tools)
 * @param o.points       'spent' (labor after reduction) | 'base' (listed labor)
 * @param o.sell         count the sale of what is crafted
 * @param o.sellPrice    (itemId) => copper after fee | null (no sale price: gear, untraded)
 * @param o.volume       (itemId) => sold per day | null
 * @param o.target       proficiency points to gain
 * @param o.others       also rank recipes not named after their product (exchanges, conversions, specials)
 * @returns rows sorted by gold per 1,000 points (cheapest first; incomplete costs last)
 */
export function levelingRows(o) {
  const factor = o.laborFactor(o.vocation);
  const rows = [];
  for (const id of o.calc.craftable()) {
    for (const r of o.calc.recipesOf(id)) {
      if (o.calc.vocation(r) !== o.vocation || !(r.labor > 0) || (!o.others && !isNamedRecipe(r))) continue;
      const labor = r.labor * factor;
      const points = o.points === 'base' ? r.labor : labor;
      if (!(points > 0)) continue;
      let cost = 0;
      const missing = [], crafted = [];
      const supply = []; // [{id, name, perCraft, perDay}]
      for (const m of r.materials) {
        if (m.id === COIN_ID) { cost += m.qty; continue; }
        const b = o.calc.best(m.id);
        // materials are bought on the AH, matching the market supply; a material with no price is crafted instead
        if (b.buyPrice != null) {
          cost += m.qty * b.buyPrice;
          supply.push({ id: m.id, name: m.name, perCraft: m.qty, perDay: o.volume(m.id) });
          continue;
        }
        const unit = b.craft?.unit ?? null;
        if (unit == null) { missing.push(m.name); continue; }
        cost += m.qty * unit;
        crafted.push(m.name);
        for (const l of o.calc.shoppingList(o.calc.tree(m.id, m.qty, 0, new Set(), true))) {
          if (l.id !== COIN_ID && l.qty > 0) supply.push({ id: l.id, name: l.name, perCraft: l.qty, perDay: o.volume(l.id) });
        }
      }
      const made = r.amount * ((r.chance ?? 100) / 100);
      const unitSale = o.sellPrice(id);
      const sale = o.sell && unitSale != null ? unitSale * made : 0;
      const complete = !missing.length;
      const net = complete ? cost - sale : null;
      // the bought material that limits how many crafts a day the market can supply
      let limit = null;
      for (const s of supply) {
        const crafts = s.perDay == null ? 0 : s.perDay / s.perCraft;
        if (!limit || crafts < limit.craftsPerDay) limit = { ...s, craftsPerDay: crafts };
      }
      const crafts = o.target > 0 ? Math.ceil(o.target / points) : null;
      rows.push({
        recipe: r, id, name: o.calc.nameOf(id) || String(id), points, labor, cost: complete ? cost : null, sale, sold: unitSale != null && o.sell,
        net, per1000: net == null ? null : (net / points) * 1000, missing, crafted,
        limit, productPerDay: o.volume(id), demandCrafts: (o.volume(id) ?? 0) / (made || 1), // crafts a day the AH buys the output of
        crafts, totalGold: crafts != null && net != null ? net * crafts : null, totalLabor: crafts != null ? labor * crafts : null,
      });
    }
  }
  rows.sort((a, b) => (a.per1000 == null) - (b.per1000 == null) || (a.per1000 ?? 0) - (b.per1000 ?? 0) || b.points - a.points);
  return rows;
}
