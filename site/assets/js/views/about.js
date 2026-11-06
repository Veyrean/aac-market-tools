import { h, mount } from '../lib/dom.js';

export function render(root) {
  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'About'))),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' },
        h('h2', null, 'What this is'),
        h('p', null, 'AAC Market Tools is a free, unofficial fan project for ArcheAge Classic players: market prices, regrade planning and (soon) crafting and trade pack profits.'),
        h('h3', null, 'Where the numbers come from'),
        h('ul', null,
          h('li', null, 'Market prices, regrade tables and item data: the public API of ', h('a', { href: 'https://www.sermeatball.com' }, 'Ser Meatball'), '. Refreshed automatically once or twice a day.'),
          h('li', null, 'Item details: ', h('a', { href: 'https://aa-classic.com' }, 'aa-classic.com'), ' and the ', h('a', { href: 'https://wiki.aa-classic.com' }, 'AAClassic wiki'), '.'),
          h('li', null, 'Auction House fees: 1% listing deposit (refunded on sale) and a 10% trade fee, halved to 5% with Patron, as shown on the in-game sale receipt.')),
        h('h3', null, 'How the regrade maths works'),
        h('p', { class: 'small' }, 'Every grade is a state in a Markov chain. Each attempt can succeed (+1, or +2 with a Resplendent great success), destroy the item, downgrade it, or leave it unchanged, using the game\'s own probability tables. The expected cost, its spread, the number of attempts and the chance of success are solved exactly. Downgrades below your starting grade are followed, so the cost of climbing back up is included. The optimizer tries every scroll, charm and emblem at every grade until no change makes the run cheaper on average. The simulation then shows how much luck matters.'),
        h('p', { class: 'small muted' }, 'All numbers are estimates. Prices change, and in-game rules may differ from the data. Use your own judgement.')),
      h('div', { class: 'card' },
        h('h2', null, 'Privacy'),
        h('ul', null,
          h('li', null, 'No accounts, no cookies, no analytics, no ads.'),
          h('li', null, 'Your settings, prices and watchlist are stored only in your browser\'s local storage and never sent anywhere.'),
          h('li', null, 'Opening an item page loads its price history directly from the Ser Meatball API. That request contains only the item number and date range.'),
          h('li', null, 'Everything else is served from this site. No third-party code is loaded.')),
        h('h2', null, 'Disclaimer'),
        h('p', { class: 'small' }, 'This project is not affiliated with, endorsed by, or connected to the publishers or operators of ArcheAge or ArcheAge Classic. Game names and data belong to their respective owners.'),
        h('h2', null, 'Source code & security'),
        h('p', { class: 'small' }, 'The code is public on ', h('a', { href: 'https://github.com/Veyrean/aac-market-tools' }, 'GitHub'), '. Found a security problem? Please report it privately through the repository\'s Security tab.'))));
}
