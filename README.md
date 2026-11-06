# AAC Market Tools

A free, fan-made toolkit for **ArcheAge Classic** traders and crafters:

- **Market** – search every traded item, see latest / 7-day / 30-day prices and volume, price charts, buy & sell targets, and what you actually receive after Auction House fees.
- **Regrade Lab** – exact expected cost, risk and material shopping list for any regrade, using the game's real success / destruction / downgrade tables, live material prices, and an optimizer that picks the cheapest scroll, charm and anchoring emblem for every grade.
- **Watchlist** – pin items with your own buy/sell targets and see at a glance when they are hit.
- *Coming next:* crafting profit with craft-or-buy trees, trade pack profits, Discord alerts.

The site is a static web page. It has no accounts, no cookies, no tracking and no ads. Your settings and watchlist are stored only in your own browser.

## How it works

```
GitHub Actions (scheduled)            GitHub Pages (static)              Your browser
┌──────────────────────────┐   ┌────────────────────────────┐   ┌──────────────────────────┐
│ pipeline/build_data.py   │──▶│ site/  + site/data/*.json  │──▶│ all calculations run here │
│ fetch → validate → write │   │ (HTML, CSS, JS modules)    │   │ settings in localStorage │
└──────────────────────────┘   └────────────────────────────┘   └──────────────────────────┘
```

- `pipeline/` – Python (standard library only) job that pulls market, regrade and item data from the public Ser Meatball API, validates it, and writes compact JSON files. If upstream data fails validation, the previously published data is kept.
- `site/` – the web app. Plain HTML/CSS/JavaScript modules, no build step and no third-party code.
- `tests/` – unit tests for the regrade engine (`node --test tests/`) and the data validators (`python3 -m unittest discover -s pipeline`).

## Run it locally

```bash
python3 pipeline/build_data.py --out site/data
python3 -m http.server 8000 --directory site
```

Then open <http://localhost:8000>.

## Credits & disclaimer

Market, recipe, trade pack and regrade data come from the public API of **[Ser Meatball](https://www.sermeatball.com)**. Item information also comes from **[aa-classic.com](https://aa-classic.com)** and the **[AAClassic wiki](https://wiki.aa-classic.com)**. Thank you to the people who run them.

This is an unofficial fan project. It is **not affiliated with, endorsed by, or connected to** the publishers or operators of ArcheAge or ArcheAge Classic. All game names and data belong to their respective owners. Numbers are estimates and come with no guarantee; trade at your own risk.

## Security

See [SECURITY.md](SECURITY.md) for how the project is hardened and how to report a problem privately.
