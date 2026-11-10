// Item icons: ArcheAge game art (© XLGAMES / Kakao Games) via aa-classic.com, copied into this
// site's own assets/icons/ folder, so visitors' browsers never load anything from another site.
import { h } from './dom.js';
import { loadIcons } from './data.js';

let map = new Map();
let ready = null;

/** Load the item → icon map once; pages call this before drawing. Failure just means no icons. */
export function initIcons() {
  if (!ready) {
    ready = loadIcons().then((d) => { map = new Map(Object.entries(d.icons || {})); }).catch(() => { map = new Map(); });
  }
  return ready;
}

/** A small icon for an item, or an empty placeholder of the same size (keeps columns aligned). */
export function itemIcon(id, size = 20) {
  const file = map.get(String(id));
  if (!file) return h('span', { class: 'item-icon none', 'aria-hidden': 'true' });
  return h('img', { class: 'item-icon', src: `assets/icons/${file}`, width: size, height: size, alt: '', loading: 'lazy', decoding: 'async' });
}
