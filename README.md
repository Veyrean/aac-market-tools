# AAC Market Tools

A free, fan-made toolkit for **ArcheAge Classic** traders and crafters:

- **Market** – search every traded item, see 24-hour / 7-day / 30-day prices and volume, price history, buy & sell targets, and what you actually receive after Auction House fees.
- **Regrade Lab** – exact expected cost, risk and material shopping list for any regrade, using the game's success / destruction / downgrade tables, current material prices, and an optimizer that picks the cheapest scroll, charm and anchoring emblem for every grade.
- **Watchlist** – pin items with your own buy/sell targets and see at a glance when they are hit.
- **Trade Packs** – every pack and destination with payout, craft cost at current prices, profit and silver per labor (default 130% demand, own % per favourite route). Larder packs (Aged Salve, Cheese, Honey) use the larder recipe and Husbandry for crafting labor.
- **Crafting** – every recipe worth crafting to sell (profit, silver per labor, daily volume) and a craft-or-buy tree per item: each material bought or crafted, whichever is cheaper, with your proficiency ranks and labor value; shopping list and labor per vocation.
- **Costumes** – costume and undergarment builder: pick up to 5 wanted stats and a target grade for the order in which to keep and roll for them, and the synthium stones it takes, each priced at the cheaper of buying or crafting it. Stats and build order from Raffin's "Costume and Undergarments Guide".
- *Coming next:* Pack Planner, Discord alerts.

The site is a static web page. It has no accounts, no cookies, no tracking and no ads. Your settings and watchlist are stored only in your own browser.

## How it works

```
Google Sheets + aa-classic.com          GitHub Actions (scheduled)            GitHub Pages (static)
┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌────────────────────────────┐
│ our sheet =IMPORTRANGE(      │─▶│ pipeline/build_data.py       │─▶│ site/  + site/data/*.json  │──▶ browser
│   public AH price sheet)     │  │ read → validate → write,     │  │ all calculations run in    │
│ aa-classic item categories   │  │ append today to the history  │  │ the visitor's browser      │
└──────────────────────────────┘  └──────────────────────────────┘  └────────────────────────────┘
```

- **Prices** come from our own Google Sheet, which imports Ser Meatball's AA Classic AH Prices sheet with `IMPORTRANGE`, as its creator recommends. The sheet is read through its "anyone with the link can view" CSV export: no Google API key or account credentials are needed or stored.
- **The Ser Meatball API is not used.** Its creator asked people not to rely on it because it is fragile. The regrade tables are a one-time snapshot in `pipeline/static/regrade.json`; do not refresh it automatically.
- **Crafting recipes**: a one-time snapshot of aa-classic.com's craft data (recipes for items traded on the Auction House and their materials), made with `pipeline/snapshot_crafts.py` and stored in `pipeline/static/crafts.json`. The recipe data has no vocation, so the site suggests one from the product's category; players can change it per recipe.
- **Land**: property types (size, base tax, seedbeds, pens) and every seed, sapling and livestock item (harvesting vocation, growing and harvest times) are a one-time snapshot of the in-game item descriptions from aa-classic.com, made with `pipeline/snapshot_land.py` and stored in `pipeline/static/land.json`.
- **Trade packs**: payouts are a one-time snapshot of Ser Meatball's trade pack prices (its creator allows downloading them from the page's request), made with `pipeline/snapshot_packs.py` and stored in `pipeline/static/packs.json`. Pack routes and live demand % come from the game client via our addon (`tools/pack-export-addon`), imported with `pipeline/import_pack_export.py` into `pipeline/static/pack_routes.json`. Both are refreshed by hand, never on a schedule.
- **Price history** is recorded by the job itself: every run appends the sheet's daily prices to the previously published history files.
- `site/` – the web app. Plain HTML/CSS/JavaScript modules, no build step, no third-party code, and the browser only talks to this site.
- `tests/` – regrade engine tests (`node --test tests/*.test.mjs`), pipeline tests (`python3 -m unittest discover -s pipeline`) and a security lint (`python3 tests/check_security.py`).

### Setting up the price sheet

1. Create a new Google Sheet and set **File → Settings → Locale → United States** (otherwise the formula needs `;` instead of `,`, and prices are exported with decimal commas, which the data job refuses). In cell **A1** enter
   `=IMPORTRANGE("<URL of the AH Prices sheet>","AHPrices!A1:L")`
   using the sheet address its creator shares in the Ser Meatball Discord, and click **Allow access**. (A1:L, not A2:L, so the "Last Updated At" date comes along.)
2. **Share → General access → Anyone with the link → Viewer.**
3. Copy the id from its URL (`https://docs.google.com/spreadsheets/d/<THIS PART>/edit`) into the repository variable **PRICE_SHEET_ID** (Settings → Secrets and variables → Actions → Variables).

## Run it locally

```bash
PRICE_SHEET_ID=<your sheet id> python3 pipeline/build_data.py --out site/data
python3 -m http.server 8000 --directory site
```

Then open <http://localhost:8000>.

## Credits & disclaimer

Auction House prices come from the AH price sheet by **Ser Meatball**, and the regrade tables from a snapshot of Ser Meatball's regrade data. Item categories come from **[aa-classic.com](https://aa-classic.com)**; regrade rates match the **[AAClassic wiki](https://wiki.aa-classic.com)**. Thank you to the people who run them.

This is an unofficial fan project. It is **not affiliated with, endorsed by, or connected to** the publishers or operators of ArcheAge or ArcheAge Classic. All game names and data belong to their respective owners. Numbers are estimates and come with no guarantee; trade at your own risk.

## Security

See [SECURITY.md](SECURITY.md) for how the project is hardened and how to report a problem privately.
