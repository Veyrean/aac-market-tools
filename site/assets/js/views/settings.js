import { h, mount, notice, field, select, debounce } from '../lib/dom.js';
import { loadMarket, loadRegrade, loadMeta, loadPacks, priceResolver, regradeItemNames } from '../lib/data.js';
import { money, toCopper, toGold, ago } from '../lib/format.js';
import { get as settings, update, exportJSON, importJSON, wipe } from '../lib/store.js';

export async function render(root) {
  const [market, { rules }, meta, packs] = await Promise.all([loadMarket(), loadRegrade(), loadMeta().catch(() => null), loadPacks().catch(() => null)]);
  const names = regradeItemNames(rules);
  const allNames = new Map(names);
  for (const r of market.rows) allNames.set(r.id, r.name);
  for (const p of packs?.packs || []) {
    allNames.set(p.id, p.name);
    for (const m of p.materials) if (m.id !== 500 && !allNames.has(m.id)) allNames.set(m.id, m.name);
  }

  const general = h('div');
  const overridesBox = h('div');
  const dataBox = h('div');
  const msg = h('div', { class: 'notices' });

  function drawGeneral() {
    const s = settings();
    const patron = h('input', { type: 'checkbox', checked: s.patron });
    patron.addEventListener('change', () => update((x) => { x.patron = patron.checked; }));
    const emblem = h('input', { type: 'number', min: 0, step: 1, value: s.regrade.emblemExtraGold, inputmode: 'decimal' });
    emblem.addEventListener('input', debounce(() => update((x) => { x.regrade.emblemExtraGold = Math.max(0, Number(emblem.value) || 0); })));
    mount(general,
      h('label', { class: 'check' }, patron, h('span', null, h('b', null, 'I have Patron'), h('span', { class: 'muted' }, ' — Auction House trade fee 5% instead of 10%'))),
      h('div', { class: 'form', style: { marginTop: '12px' } },
        field('Prices to use', select([['latest', 'Latest daily average'], ['avg7', '7-day average'], ['avg30', '30-day average']], s.priceBasis, (v) => update((x) => { x.priceBasis = v; })))),
      h('p', { class: 'small muted' }, 'Your labor value, proficiencies, land, tools and vehicles are in ', h('a', { href: '#/setup' }, 'My Setup'), '.'),
      h('hr', { class: 'divider' }),
      h('h3', null, 'Regrade rules'),
      h('p', { class: 'small muted' }, 'Ser Meatball\'s calculator assumes this. Untick it if regular scrolls can be used on Divine and higher gear.'),
      h('div', { class: 'form' }, field('Extra cost to craft an anchoring emblem (gold)', emblem, { full: true })),
      h('p', { class: 'small muted' }, 'Emblems are priced as 100 shards. Add the value of the 2 Honorforged Medals, the coins and the 100 crafting labor here if you want them counted.'));
  }

  function drawOverrides() {
    const s = settings();
    const info = priceResolver(market, rules, names);
    const entries = Object.entries(s.overrides).map(([id, c]) => ({ id: Number(id), copper: c, name: allNames.get(Number(id)) || `Item #${id}` }));
    const search = h('input', { type: 'search', placeholder: 'Find an item to price…', autocomplete: 'off', 'aria-label': 'Find an item to price' });
    const results = h('div', { class: 'results' });
    search.addEventListener('input', debounce(() => {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { mount(results); return; }
      const found = [...allNames.entries()].filter(([, n]) => n.toLowerCase().includes(q)).slice(0, 25);
      mount(results, found.map(([id, n]) => h('button', {
        type: 'button',
        on: { click: () => { update((x) => { x.overrides[String(id)] = info(id).copper ?? 0; }); drawOverrides(); } },
      }, n, h('span', { class: 'small muted' }, ` · now ${money(info(id).copper)} (${info(id).source})`))));
    }));
    const rows = entries.sort((a, b) => a.name.localeCompare(b.name)).map((e) => {
      const input = h('input', { type: 'number', min: 0, step: 0.01, value: toGold(e.copper), inputmode: 'decimal', 'aria-label': `Your price for ${e.name}` });
      input.addEventListener('input', debounce(() => { const v = Number(input.value); if (Number.isFinite(v) && v >= 0) update((x) => { x.overrides[String(e.id)] = toCopper(v); }); }, 300));
      const marketRow = market.byId.get(e.id);
      return h('tr', null,
        h('td', { class: 'l' }, e.name),
        h('td', null, input),
        h('td', { class: 'muted' }, marketRow ? money(marketRow.latest) : '—'),
        h('td', null, h('button', { class: 'btn small bad', on: { click: () => { update((x) => { delete x.overrides[String(e.id)]; }); drawOverrides(); } } }, 'Remove')));
    });
    mount(overridesBox,
      h('p', { class: 'sub' }, 'Your own prices replace market data everywhere: for untradeable items, things you farm yourself, or when you disagree with the market. Prices are in gold.'),
      search, results,
      entries.length ? h('div', { class: 'tablewrap', style: { marginTop: '10px' } }, h('table', null,
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Your price (g)'), h('th', null, 'Market latest'), h('th'))),
        h('tbody', null, rows))) : h('p', { class: 'small muted' }, 'No custom prices yet.'));
  }

  function drawData() {
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { mount(msg, notice('bad', 'That file is too large to be a settings export.')); return; }
      const rd = new FileReader();
      rd.onload = () => {
        try { importJSON(String(rd.result)); mount(msg, notice('good', 'Settings imported.')); drawGeneral(); drawOverrides(); }
        catch (err) { mount(msg, notice('bad', `Could not import: ${err.message}`)); }
      };
      rd.readAsText(f);
      fileInput.value = '';
    });
    const download = () => {
      const blob = new Blob([exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aac-market-tools-settings.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    mount(dataBox,
      meta ? h('p', { class: 'sub' }, `Prices are from the price sheet dated ${meta.datasets?.market?.sheetDate || 'unknown'}; the site data was rebuilt ${ago(meta.generatedAt)}.`) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn good', on: { click: download } }, 'Export settings'),
        h('button', { class: 'btn', on: { click: () => fileInput.click() } }, 'Import settings'), fileInput,
        h('button', { class: 'btn bad', on: { click: () => { if (window.confirm('Delete all your settings, prices and watchlist from this browser?')) { wipe(); drawGeneral(); drawOverrides(); mount(msg, notice('good', 'Everything was deleted from this browser.')); } } } }, 'Delete my data')),
      h('p', { class: 'small muted' }, 'Everything on this page is stored only in this browser. Export it to move it to another device.'));
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings'), h('p', { class: 'sub' }, 'Changes are saved automatically in this browser.'))),
    msg,
    h('div', { class: 'grid2', style: { marginTop: '8px' } },
      h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', null, 'General'), general), h('div', { class: 'card' }, h('h2', null, 'Your data'), dataBox)),
      h('div', { class: 'card' }, h('h2', null, 'Your prices'), overridesBox)));
  drawGeneral(); drawOverrides(); drawData();
}
