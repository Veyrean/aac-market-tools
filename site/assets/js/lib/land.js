// Weekly economics of a property and what is planted on it. No DOM access.
// One week = one tax cycle.

/**
 * @param property  a My Setup land entry
 * @param ctx { priceByName(name) => copper|null, certCopper|null, outputFactor(vocation), laborFactor(vocation) }
 * @returns weekly totals plus one line per planting
 */
export function landWeek(property, ctx) {
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
    const unit = price(pl.item);
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
