#!/usr/bin/env python3
"""One-time snapshot of trade pack data → pipeline/static/packs.json

Run by hand (never on a schedule), e.g. after a game patch:
    python3 pipeline/snapshot_packs.py

Sources:
  * Pack payouts per destination and turn-in labor: the data behind Ser Meatball's
    trade pack prices page. Its creator said it is fine to download it from the page's
    network request; it is downloaded once here (two requests) and stored statically.
    Payouts are at the maximum 130% demand.
  * Pack recipes (materials, crafting labor): aa-classic.com's public craft data.

Only quantities and names are kept — never upstream gold valuations of resources —
so the site prices everything with our own price sheet.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402  (shared polite HTTP + validators)

PACKS_URL = "https://api.sermeatball.com/packs?basis=latest&advantage=0&ah_tax=false"
TIERS_URL = "https://api.sermeatball.com/proficiency-tiers"
CRAFT_URL = "https://aa-classic.com/data/crafts/{}.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "packs.json")
CACHE_DIR = os.environ.get("SNAPSHOT_CACHE")  # optional: reuse responses between runs


def fetch(url):
    """fetch_json with an optional on-disk cache, so a failed run is not re-downloaded."""
    if not CACHE_DIR:
        return bd.fetch_json(url)
    import hashlib
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, hashlib.sha256(url.encode()).hexdigest() + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    data = bd.fetch_json(url)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    return data


def clean_delivery(d, kind):
    bd.v_dict(d, "delivery")
    reward = bd.v_text(d.get("reward_item_name"), "reward_item_name")
    out = {"to": bd.v_text(d.get("destination_zone"), "destination_zone"), "reward": reward}
    if kind == "gold":
        payout = bd.v_num(d.get("payout"), "payout", 0, 1e6)  # gold
        out["copper"] = int(round(payout * bd.COPPER_PER_GOLD))
    else:
        out["qty"] = bd.v_int(d.get("quantity"), "quantity", 1, 100000)
    return out


def clean_material(m):
    bd.v_dict(m, "material")
    return {"id": bd.v_int(m.get("item_id"), "item_id", 1, 10**9), "name": bd.v_text(m.get("name"), "name"),
            "qty": bd.v_num(m.get("amount"), "amount", 0, 10**7)}


def main():
    packs_raw = bd.v_list(fetch(PACKS_URL), "packs")
    tiers_raw = bd.v_list(fetch(TIERS_URL), "proficiency tiers")
    tiers = [{"name": bd.v_text(t.get("name"), "tier name"), "advantage": bd.v_num(t.get("advantage"), "advantage", 0, 100)}
             for t in tiers_raw if isinstance(t, dict)]

    packs = []
    for p in packs_raw:
        bd.v_dict(p, "pack")
        craft_id = bd.v_int(p.get("craft_id"), "craft_id", 1, 10**9, allow_none=True)
        pack = {
            "id": bd.v_int(p.get("item_id"), "item_id", 1, 10**9),
            "name": bd.v_text(p.get("name"), "name"),
            "craftId": craft_id,
            "craftLabor": bd.v_num(p.get("labor"), "labor", 0, 10000, allow_none=True) or 0,
            "turnInLabor": bd.v_num(p.get("turn_in_labor"), "turn_in_labor", 0, 10000, allow_none=True) or 0,
            "gold": [clean_delivery(d, "gold") for d in bd.v_list(p.get("gold_deliveries") or [], "gold")],
            "resources": [clean_delivery(d, "resource") for d in bd.v_list(p.get("resource_deliveries") or [], "res")],
            "materials": [],
        }
        if craft_id:
            try:
                craft = bd.v_dict(fetch(CRAFT_URL.format(craft_id)), "craft")
                pack["materials"] = [clean_material(m) for m in bd.v_list(craft.get("materials") or [], "materials")]
                product = next((x for x in craft.get("products") or [] if x.get("item_id") == pack["id"]), None)
                pack["yield"] = bd.v_num((product or {}).get("amount", 1), "amount", 1, 1000)
                pack["craftLabor"] = bd.v_num(craft.get("labor", pack["craftLabor"]), "labor", 0, 10000)
            except (bd.NotFound, bd.ValidationError, RuntimeError) as err:
                print(f"[warn] recipe {craft_id} for {pack['name']}: {err}", file=sys.stderr)
        packs.append(pack)
        print(f"[ok] {pack['name']}: {len(pack['gold'])} gold + {len(pack['resources'])} resource turn-ins, {len(pack['materials'])} materials")

    if len(packs) < 100:
        raise SystemExit(f"only {len(packs)} packs — refusing to write")
    data = {
        "source": {
            "payouts": "Ser Meatball trade pack prices (downloaded with the creator's permission)",
            "recipes": "aa-classic.com craft data",
            "snapshotTakenAt": date.today().isoformat(),
            "payoutDemand": 130,
        },
        "tiers": tiers,
        "packs": sorted(packs, key=lambda x: x["name"]),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(packs)} packs, {len(tiers)} proficiency tiers")


if __name__ == "__main__":
    main()
