// Weekly economics of a property and what is planted on it. No DOM access.
// One week = one tax cycle.

const COIN_ID = 500; // "Coin" in recipes: the amount is in copper
const G = 10000;

/** How a seed / sapling / animal is obtained, and the default way to price it. */
export const BUY_SOURCES = {
  npc: 'Merchant',
  badges: 'Vocation badges',
  craft: 'Crafted',
  ah: 'Auction House',
  own: 'Own price',
};
const DEFAULT_BUY = { merchant: 'npc', vocation: 'badges', craft: 'craft', special: 'ah' };

/**
 * Price of one planted item, by where the player gets it.
 * @param pl     a planting: { item, buyFrom: 'auto'|keyof BUY_SOURCES, badges, ownGold }
 * @param info   the item's land data (source, npcPrice, craft) or undefined
 * @param o      { priceByName(name) => copper|null, badgeGold: gold per 1,000 vocation badges }
 * @returns { copper|null, from, missing: string[] }
 */
export function plantUnitCost(pl, info, o) {
  let from = pl.buyFrom && pl.buyFrom !== 'auto' ? pl.buyFrom : DEFAULT_BUY[info?.source] || 'ah';
  if (from === 'npc' && info?.npcPrice == null) from = 'ah';
  if (from === 'craft' && !info?.craft) from = 'ah';
  const missing = [];
  let copper = null;
  if (from === 'npc') copper = info.npcPrice;
  else if (from === 'own') { copper = pl.ownGold != null ? pl.ownGold * G : null; if (copper == null) missing.push(`your price for ${pl.item}`); }
  else if (from === 'badges') {
    copper = pl.badges != null ? (pl.badges / 1000) * (o.badgeGold || 0) * G : null;
    if (copper == null) missing.push(`badge cost of ${pl.item}`);
  } else if (from === 'craft') {
    let total = 0;
    for (const m of info.craft.materials) {
      const unit = m.id === COIN_ID ? 1 : o.priceByName(m.name);
      if (unit == null) missing.push(m.name); else total += unit * m.qty;
    }
    copper = missing.length ? null : total / (info.craft.amount || 1);
  } else {
    copper = o.priceByName(pl.item);
    if (copper == null) missing.push(pl.item);
  }
  return { copper, from, missing };
}

/**
 * @param property  a My Setup land entry
 * @param ctx { priceByName(name) => copper|null, certCopper|null, outputFactor(vocation), laborFactor(vocation) }
 * @returns weekly totals plus one line per planting
 */
export function landWeek(property, ctx) {
  // ctx.inputCost(planting) => { copper|null, missing[] } prices the planted item (merchant, badges…);
  // without it the item is priced by name (market).
  const missing = new Set();
  const price = (name) => {
    if (!name) return null;
    const p = ctx.priceByName(name);
    if (p == null) missing.add(name);
    return p;
  };
  const tax = ctx.certCopper == null ? (property.taxCerts > 0 ? null : 0) : property.taxCerts * ctx.certCopper;
  if (tax == null) missing.add('Tax Certificate');
  const upkeep = property.extraGold * 10000;

  let inputs = 0, outputValue = 0, labor = 0;
  const lines = property.plantings.map((pl) => {
    const cycles = pl.qty * pl.cyclesPerWeek; // harvests per week (each plant / animal)
    let unit;
    if (!pl.item) unit = null;
    else if (ctx.inputCost) { const c = ctx.inputCost(pl); c.missing.forEach((m) => missing.add(m)); unit = c.copper; }
    else unit = price(pl.item);
    // a fruit tree or a cow is harvested many times before it is replaced; a cedar is planted again after each logging
    const input = unit == null ? null : (unit * cycles) / Math.max(1, pl.harvestsPerPlant || 1);
    const factor = ctx.outputFactor(pl.vocation);
    const outs = pl.outputs.filter((o) => o.name).map((o) => {
      const qty = o.qty * cycles * factor;
      const p = price(o.name);
      return { name: o.name, qty, unit: p, value: p == null ? null : p * qty };
    });
    const lineLabor = pl.laborEach * cycles * ctx.laborFactor(pl.vocation);
    const value = outs.reduce((a, o) => a + (o.value || 0), 0);
    if (input != null) inputs += input;
    outputValue += value;
    labor += lineLabor;
    return { planting: pl, cycles, input, outs, value, labor: lineLabor, factor };
  });
  const cost = (tax || 0) + upkeep + inputs;
  const net = outputValue - cost;
  return {
    tax, upkeep, inputs, cost, outputValue, net, labor, lines,
    spl: labor > 0 ? net / 100 / labor : null,
    missing: [...missing],
    hasOutputs: lines.some((l) => l.outs.length),
  };
}
