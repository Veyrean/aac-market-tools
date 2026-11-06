// App shell: hash router, navigation state and data freshness badge.
import { loadMeta } from './lib/data.js';
import { ago } from './lib/format.js';
import { h, mount, notice } from './lib/dom.js';

const ROUTES = {
  market: () => import('./views/market.js'),
  item: () => import('./views/item.js'),
  regrade: () => import('./views/regrade.js'),
  watchlist: () => import('./views/watchlist.js'),
  crafting: () => import('./views/soon.js'),
  packs: () => import('./views/soon.js'),
  settings: () => import('./views/settings.js'),
  about: () => import('./views/about.js'),
};

let cleanup = null;
let token = 0;

async function route() {
  const my = ++token;
  const parts = (location.hash.replace(/^#\/?/, '') || 'market').split('/').map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  const name = ROUTES[parts[0]] ? parts[0] : 'market';
  for (const a of document.querySelectorAll('.nav a')) {
    const active = a.dataset.route === name || (name === 'item' && a.dataset.route === 'market');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const app = document.getElementById('app');
  mount(app, h('p', { class: 'muted' }, 'Loading…'));
  try {
    const mod = await ROUTES[name]();
    if (my !== token) return;
    const result = await mod.render(app, parts.slice(1), { route: name, isCurrent: () => my === token });
    if (my !== token) { if (typeof result === 'function') result(); return; }
    cleanup = typeof result === 'function' ? result : null;
  } catch (err) {
    console.error(err);
    if (my === token) mount(app, notice('bad', 'Something went wrong while loading this page: ', err.message || String(err)));
  }
  window.scrollTo(0, 0);
}

async function freshness() {
  const el = document.getElementById('freshness');
  try {
    const meta = await loadMeta();
    const market = meta.datasets?.market || {};
    const stale = Object.values(meta.datasets || {}).some((d) => !d.fresh);
    const sheetDate = market.sheetDate;
    const old = sheetDate ? Date.now() - Date.parse(`${sheetDate}T00:00:00Z`) > 2.5 * 86400000 : true;
    el.textContent = sheetDate ? `Prices of ${sheetDate}` : 'Prices unavailable';
    el.title = `Price sheet dated ${sheetDate || 'unknown'}, site rebuilt ${ago(meta.generatedAt)}${stale ? ' (the last refresh failed, showing previous data)' : ''}${old ? ' (prices are more than two days old)' : ''}`;
    el.classList.toggle('stale', stale || old);
  } catch {
    el.textContent = 'Data unavailable';
    el.classList.add('stale');
  }
}

window.addEventListener('hashchange', route);
route();
freshness();
