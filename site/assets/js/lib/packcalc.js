// Trade pack maths shared by the Packs and Routes views. No DOM access.
//
// Payouts in the data are at `data.payoutDemand` (130%) and scale linearly with the demand %.
// Gold rewards are paid directly; resource rewards are valued at market price minus the AH fee.

export const COIN_ID = 500; // "Coin" in recipes: the amount is in copper
export const GILDA_STAR_DUST = 4; // 1 Gilda Star is valued as 4 Gilda Dust unless the player sets a price
export const SEA_DESTINATIONS = new Set(['Diamond Shores', 'Freedich Island', 'Sunspeck Sea']);
export const DEMAND_MIN = 70;   // turn-in demand ranges from 70% to 130% (AAClassic wiki, Commerce)
export const DEMAND_MAX = 130;
export const routeKey = (from, to) => `${from}→${to}`;

/**
 * @param {object} o
 *   data          packs.json (packs, payoutDemand)
 *   priceOfId     (itemId) => {copper, source}
 *   idOfName      (name) => itemId | null   (market lookup by exact name)
 *   opts          { defaultDemand, routeDemand: {'From→To': %}, feeRate, gildaStarCopper, lordsPenceCopper,
 *                   laborFactorOf: (vocation) => multiplier  (or a single laborFactor for every vocation) }
 */
export function makePackCalc({ data, priceOfId, idOfName, opts }) {
  const costCache = new Map();

  const priceByName = (name) => {
    const id = idOfName(name);
    return id == null ? null : priceOfId(id).copper;
  };

  function rewardUnitPrice(name) {
    if (name === 'Gilda Star') {
      if (opts.gildaStarCopper != null) return opts.gildaStarCopper;
      const dust = priceByName('Gilda Dust');
      return dust == null ? null : dust * GILDA_STAR_DUST;
    }
    if (name === "Lord's Pence") return opts.lordsPenceCopper ?? null;
    return priceByName(name);
  }

  /** Craft cost of one pack: {copper|null, partial, missing[], lines[], own?} */
  function craftCost(pack) {
    if (costCache.has(pack.id)) return costCache.get(pack.id);
    let result;
    if (!pack.materials.length) {
      const own = priceOfId(pack.id);
      result = own.source === 'your price'
        ? { copper: own.copper, partial: own.copper, missing: [], lines: [], own: true }
        : { copper: null, partial: null, missing: ['no recipe: set your own price for this pack in Settings'], lines: [] };
    } else {
      let total = 0;
      const missing = [], lines = [];
      for (const m of pack.materials) {
        const unit = m.id === COIN_ID ? 1 : (priceOfId(m.id).copper ?? priceByName(m.name));
        if (unit == null) { missing.push(m.name); lines.push({ m, unit: null, total: null }); continue; }
        total += unit * m.qty;
        lines.push({ m, unit, total: unit * m.qty });
      }
      const y = pack.yield || 1;
      result = { copper: missing.length ? null : total / y, partial: total / y, missing, lines, yield: y };
    }
    costCache.set(pack.id, result);
    return result;
  }

  const factorOf = (vocation) => (opts.laborFactorOf ? opts.laborFactorOf(vocation) : opts.laborFactor ?? 1);

  /**
   * Labor of one pack: crafting is reduced by the craft's vocation (Commerce for most packs,
   * Husbandry for larder packs), the turn-in by Commerce. Ranks and tools come from My Setup.
   */
  function laborParts(pack) {
    const craftVocation = pack.craftVocation || 'Commerce';
    const craft = pack.craftLabor * factorOf(craftVocation), turnIn = pack.turnInLabor * factorOf('Commerce');
    return { craftVocation, craft, turnIn, total: craft + turnIn };
  }
  const packLabor = (pack) => laborParts(pack).total;

  /** Demand % for a pack's route: the player's own % for a favourite route, else the default. */
  function demandFor(pack, to) {
    const own = pack.origin ? opts.routeDemand?.[routeKey(pack.origin, to)] : undefined;
    return own != null ? { demand: own, custom: true } : { demand: opts.defaultDemand, custom: false };
  }

  /** Every turn-in option of a pack: [{to, demand, custom, payout|null, reward, qty, unit}] */
  function options(pack, reward = 'all') {
    const out = [];
    if (reward !== 'resources') {
      for (const d of pack.gold) {
        const { demand, custom } = demandFor(pack, d.to);
        out.push({ to: d.to, demand, custom, payout: (d.copper * demand) / data.payoutDemand, reward: 'Gold', qty: null, unit: null });
      }
    }
    if (reward !== 'gold') {
      for (const d of pack.resources) {
        const { demand, custom } = demandFor(pack, d.to);
        const unit = rewardUnitPrice(d.reward);
        const qty = (d.qty * demand) / data.payoutDemand;
        out.push({ to: d.to, demand, custom, payout: unit == null ? null : qty * unit * (1 - opts.feeRate), reward: d.reward, qty, unit });
      }
    }
    return out;
  }

  /** One pack at one destination, with cost and profit per pack. */
  function evaluate(pack, option) {
    const cost = craftCost(pack);
    const labor = packLabor(pack);
    const profit = option.payout != null && cost.copper != null ? option.payout - cost.copper : null;
    return { pack, ...option, cost, labor, profit, spl: profit != null && labor > 0 ? profit / 100 / labor : null };
  }

  /**
   * One row per origin → destination route, filled with a full load of the best pack.
   * vehicle: {capacity, fuelCopper|null, fuelMissing[], riskPct, tripMinutes|null}
   */
  function routes({ reward = 'all', excludeSea = false, vehicle }) {
    const byRoute = new Map();
    for (const pack of data.packs) {
      if (!pack.origin) continue;
      for (const o of options(pack, reward)) {
        if (excludeSea && SEA_DESTINATIONS.has(o.to)) continue;
        const key = `${pack.origin}→${o.to}`;
        if (!byRoute.has(key)) byRoute.set(key, { from: pack.origin, to: o.to, candidates: [] });
        byRoute.get(key).candidates.push(evaluate(pack, o));
      }
    }
    const n = Math.max(0, vehicle.capacity || 0), risk = Math.min(1, Math.max(0, (vehicle.riskPct || 0) / 100));
    const fuel = vehicle.fuelCopper || 0;
    const rows = [];
    for (const r of byRoute.values()) {
      r.candidates.sort((a, b) => cmpDesc(a.profit, b.profit) || cmpDesc(a.payout, b.payout));
      const best = r.candidates[0];
      const complete = best.profit != null;
      const turnoverPack = best.payout;
      const turnoverTrip = turnoverPack == null ? null : turnoverPack * n;
      const costTrip = best.cost.copper == null ? null : best.cost.copper * n;
      const lossTrip = turnoverTrip == null ? null : turnoverTrip * risk;
      const profitTrip = complete ? turnoverTrip - lossTrip - costTrip - fuel : null;
      const laborTrip = best.labor * n;
      rows.push({
        ...r, best, complete, n, turnoverPack, turnoverTrip, costTrip, fuel, lossTrip, profitTrip, laborTrip,
        spl: profitTrip != null && laborTrip > 0 ? profitTrip / 100 / laborTrip : null,
        perHour: profitTrip != null && vehicle.tripMinutes ? profitTrip / (vehicle.tripMinutes / 60) : null,
        fuelMissing: vehicle.fuelMissing || [],
      });
    }
    return rows;
  }

  return { priceByName, rewardUnitPrice, craftCost, packLabor, laborParts, options, evaluate, routes };
}

function cmpDesc(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

/** Fuel/consumables per trip for a My Setup vehicle, priced by item name. */
export function vehicleCost(vehicle, priceByName) {
  let copper = 0;
  const missing = [];
  for (const c of vehicle?.consumables || []) {
    if (!c.name) continue;
    const p = priceByName(c.name);
    if (p == null) missing.push(c.name); else copper += p * c.qty;
  }
  return { copper, missing };
}
