#!/usr/bin/env python3
"""One-time snapshot of crafting recipes → pipeline/static/crafts.json

Run by hand (never on a schedule), e.g. after a game patch:
    SNAPSHOT_CACHE=/tmp/aac-cache python3 pipeline/snapshot_crafts.py [--market site/data/market.json]

Source: aa-classic.com's public craft data. Every recipe is kept whose product is traded on the
Auction House (from the built market.json) or belongs to any item category except junk, quest items
and trade packs (see SKIP_CATEGORIES), plus, recursively, the recipes of their materials (so a
craft-or-buy tree can go all the way down).
Each recipe keeps its product, amount made, labor and materials (ids, names, quantities), and the
product's item category, which the site uses to suggest the crafting vocation.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402  (shared polite HTTP + validators)
from snapshot_packs import fetch  # noqa: E402  (optional on-disk cache)

CRAFT_INDEX_URL = "https://aa-classic.com/data/crafts/_index.json"
CRAFT_URL = "https://aa-classic.com/data/crafts/{}.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "crafts.json")
MAX_DEPTH = 8  # material chains deeper than this are not followed
# Recipes are kept for every item category except junk and quest items; trade packs have their own page.
# Everything else is kept: gear, unidentified gear (e.g. Cloaked Brimstone), talismans, lunagems,
# lunastones, mount gear, costumes, dyes, books…
SKIP_CATEGORIES = {"Other", "Specialty", "Trade Pack", "Crate", "Quest Item", "Coin", "Token", "Evidence"}
COIN_ID = 500


def chance(rate):
    """Product chance in %; some recipes store it in basis points (10000 = 100%)."""
    rate = bd.v_num(rate, "rate", 0, 10000)
    return rate / 100 if rate > 100 else rate


def parse_recipe(c, categories):
    bd.v_dict(c, "craft")
    pid = bd.v_int(c.get("primary_product_id"), "primary_product_id", 1, 10**9)
    product = next((p for p in c.get("products") or [] if p.get("item_id") == pid), None)
    if product is None:
        return None
    mats = []
    for m in bd.v_list(c.get("materials") or [], "materials"):
        bd.v_dict(m, "material")
        mats.append({"id": bd.v_int(m.get("item_id"), "item_id", 1, 10**9), "name": bd.v_text(m.get("name"), "name"),
                     "qty": bd.v_num(m.get("amount"), "amount", 0, 10**7)})
    if not mats:
        return None
    return {
        "id": bd.v_int(c.get("id"), "id", 1, 10**9),
        "product": pid,
        "name": bd.v_text(product.get("name"), "product name"),
        "title": bd.v_text(c.get("name"), "recipe name", allow_none=True),  # the recipe's own in-game name
        "category": categories.get(pid),
        "amount": bd.v_num(product.get("amount", 1), "amount", 1, 10000),
        "chance": chance(product.get("rate", 100)),
        "labor": bd.v_num(c.get("labor", 0), "labor", 0, 100000),
        "materials": mats,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--market", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site", "data", "market.json"))
    args = ap.parse_args(argv)

    with open(args.market, encoding="utf-8") as fh:
        market = json.load(fh)
    traded = {row[market["fields"].index("id")] for row in market["rows"]}
    categories = {it["id"]: it.get("category") for it in bd.v_list(fetch(bd.ITEM_INDEX_URL), "item index") if isinstance(it, dict)}

    by_product = defaultdict(list)
    for c in bd.v_list(fetch(CRAFT_INDEX_URL), "craft index"):
        if isinstance(c, dict) and isinstance(c.get("primary_product_id"), int) and str(c.get("name", "")).isascii():
            by_product[c["primary_product_id"]].append(c["id"])

    recipes, seen_products = {}, set()
    # every category except junk and quest items (trade packs have their own page)
    plannable = lambda cat: bool(cat) and cat not in SKIP_CATEGORIES  # noqa: E731
    wanted = traded | {pid for pid in by_product if plannable(categories.get(pid))}
    queue = [(pid, 0) for pid in sorted(wanted) if pid in by_product]
    while queue:
        pid, depth = queue.pop(0)
        if pid in seen_products or depth > MAX_DEPTH:
            continue
        seen_products.add(pid)
        for cid in by_product.get(pid, []):
            try:
                r = parse_recipe(fetch(CRAFT_URL.format(cid)), categories)
            except (bd.NotFound, bd.ValidationError, RuntimeError) as err:
                print(f"[warn] craft {cid}: {err}", file=sys.stderr)
                continue
            if not r:
                continue
            recipes[r["id"]] = r
            for m in r["materials"]:
                if m["id"] != COIN_ID and m["id"] in by_product and m["id"] not in seen_products:
                    queue.append((m["id"], depth + 1))
        if len(seen_products) % 100 == 0:
            print(f"[..] {len(seen_products)} products, {len(recipes)} recipes", flush=True)

    if len(recipes) < 500:
        raise SystemExit(f"only {len(recipes)} recipes — refusing to write")
    data = {
        "source": {"crafts": "aa-classic.com craft data", "snapshotTakenAt": date.today().isoformat()},
        "recipes": sorted(recipes.values(), key=lambda r: (r["name"], r["id"])),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(recipes)} recipes for {len(seen_products)} products")


if __name__ == "__main__":
    main()
