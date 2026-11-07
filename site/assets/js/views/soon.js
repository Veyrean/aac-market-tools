import { h, mount } from '../lib/dom.js';

const PAGES = {
  crafting: {
    title: 'Crafting',
    intro: 'Profit for every recipe, with the cheapest way to get each material.',
    points: [
      'Profit per craft and silver per labor, with the correct Auction House fee for your Patron status.',
      'Craft-or-buy trees: every material priced at the cheaper of buying it or crafting it from its own recipe.',
      'All 2,500 recipes, refreshed daily.',
    ],
  },
};

export function render(root, _params, ctx) {
  const page = PAGES[ctx.route] || PAGES.crafting;
  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, page.title), h('p', { class: 'sub' }, page.intro))),
    h('div', { class: 'card soon' },
      h('h2', null, 'Coming in the next update'),
      h('ul', null, page.points.map((p) => h('li', null, p))),
      h('p', { class: 'small muted' }, 'Meanwhile, try the ', h('a', { href: '#/market' }, 'Market'), ' and the ', h('a', { href: '#/regrade' }, 'Regrade Lab'), '.')));
}
