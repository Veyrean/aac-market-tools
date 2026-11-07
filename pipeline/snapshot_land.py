#!/usr/bin/env python3
"""One-time snapshot of land data → pipeline/static/land.json

Run by hand (never on a schedule), e.g. after a game patch:
    SNAPSHOT_CACHE=/tmp/aac-cache python3 pipeline/snapshot_land.py

Source: aa-classic.com's public item data (the in-game item descriptions).
  * Property types: one building design per type, with its classification, dimensions,
    base weekly tax in Tax Certificates, seedbeds and pens.
  * Plantables: every seed, sapling and livestock item, with the vocation(s) that harvest
    it, maturing time, repeat harvest interval (fruit, milk, wool…), climate and where it
    can grow.
Only facts parsed from the descriptions are kept, as plain text and numbers.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402  (shared polite HTTP + validators)
from snapshot_packs import fetch  # noqa: E402  (optional on-disk cache)

ITEM_URL = "https://aa-classic.com/data/items/{}.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "land.json")

PLANT_CATEGORIES = ("Seed", "Saplings", "Livestock")
LAND_VOCATIONS = ("Husbandry", "Farming", "Logging", "Gathering", "Mining")
# Not something a player owns: siege, territory, castle and test buildings.
SKIP_BUILDING = re.compile(r"Territory|Tower|Wall|Gatehouse|Siege|Catapult|Rampart|Lodestone|Headquarters|Plaza|Vault|Hub|Test|Blueprint|Castle")
VARIANT = re.compile(r" \((Balcony|Terrace|Porch|Sunroom|Veranda)\)$")

_COLOR = re.compile(r"\|c[0-9A-Fa-f]{8}|\|r|\|n[a-z];|@ITEM_NAME\(\d+\)s?")


def plain(text):
    return _COLOR.sub("", text or "").replace("\r", "")


def hours(text):
    """'1 d 2 h' / '14 h 18 m' / '2 h' / '45 m' → hours (float) or None."""
    if not text:
        return None
    total, found = 0.0, False
    for num, unit in re.findall(r"(\d+(?:\.\d+)?)\s*(d|h|m)\b", text):
        found = True
        total += float(num) * {"d": 24, "h": 1, "m": 1 / 60}[unit]
    return round(total, 3) if found else None


def building_type(name):
    """'Full Kit: Stone Spring Villa (Porch)' → 'Stone Spring Villa'; None for non-player buildings."""
    if not name.isascii():
        return None
    n = re.sub(r"^(Full Kit: |Full-Kit: |Design: )", "", name)
    n = re.sub(r" (Design|Kit)$", "", n).replace("`", "'")
    n = VARIANT.sub("", n)
    n = re.sub(r"^Haranyan (Private )", r"\1", n)
    if SKIP_BUILDING.search(n):
        return None
    return n


def group_of(name, classification, text):
    if name.startswith("Private "):
        return "Private workstations"
    if "aquafarm" in text.lower() or "Marine" in (classification or ""):
        return "Aquafarms & marine"
    if re.search(r"Garden|Scarecrow Farm|Gazebo|Pavilion|Treehouse|Beanstalk", name):
        return "Farms"
    if re.search(r"Farmhouse|Harvester's Bungalow", name):
        return "Farmhouses"
    if "Silo" in name:
        return "Other"
    return "Houses"


def parse_building(name, d):
    desc, skill = plain(d.get("description")), plain(d.get("skill_description"))
    size = re.search(r"(\d+)\s*m?\s*x\s*(\d+)\s*m", desc)
    cls = re.search(r"(?:Classification|Category):\s*(.+)", desc)
    tax = re.search(r"Taxes:\s*(\d+)", skill)
    seedbeds = re.search(r"(\d+) Seedbeds?", desc)
    pens = re.search(r"(\d+) Pens?\b", desc)
    out = {
        "name": name,
        "classification": cls.group(1).strip()[:40] if cls else None,
        "size": int(size.group(1)) if size else None,
        "sizeApprox": bool(size) and "slightly smaller" in desc[max(0, size.start() - 25):size.start()],
        "taxCerts": int(tax.group(1)) if tax else None,
        "seedbeds": int(seedbeds.group(1)) if seedbeds else 0,
        "pens": int(pens.group(1)) if pens else 0,
    }
    out["group"] = group_of(name, out["classification"], desc)
    return out


def parse_plant(d, category):
    desc = plain(d.get("description"))
    voc = re.search(r"Vocation:\s*(.+)", desc)
    vocations = [v.strip() for v in re.split(r"[;,/]| and ", voc.group(1))] if voc else []
    vocations = [v for v in vocations if v in LAND_VOCATIONS]
    if not vocations:
        return None
    mature = re.search(r"Matures in\s*(?:approx\.\s*)?([^\n]+)", desc)
    repeat = re.search(r"(\w+) every\s*([^\n]+)", desc)
    climate = re.search(r"Climate:\s*([^\n]+)", desc)
    only = re.search(r"Can only be (?:grown|raised|placed) (?:at|in|on)\s*([^\n.]+)", desc)
    yields = re.search(r"(Yields [^\n]+)", desc)
    return {
        "id": bd.v_int(d.get("id"), "id", 1, 10**9),
        "name": bd.v_text(d.get("name"), "name"),
        "category": category,
        "vocations": vocations,
        "matureH": hours(mature.group(1)) if mature else None,
        "repeat": {"verb": repeat.group(1).capitalize(), "everyH": hours(repeat.group(2))} if repeat and hours(repeat.group(2)) else None,
        "climate": climate.group(1).strip()[:40] if climate else None,
        "onlyAt": only.group(1).strip()[:80] if only else None,
        "yields": yields.group(1).strip()[:160] if yields else None,
    }


def main():
    index = bd.v_list(fetch(bd.ITEM_INDEX_URL), "item index")

    # one design per property type (prefer "X Design" over kits, and the base over variants)
    designs = {}
    for it in index:
        if not isinstance(it, dict) or it.get("category") != "Buildings":
            continue
        name = it.get("name") or ""
        t = building_type(name)
        if not t:
            continue
        rank = (0 if name.endswith(" Design") else 1) + (2 if VARIANT.search(re.sub(r" (Design|Kit)$", "", name)) else 0)
        if t not in designs or rank < designs[t][0]:
            designs[t] = (rank, it["id"])
    types = []
    for t, (_, item_id) in sorted(designs.items()):
        try:
            b = parse_building(t, bd.v_dict(fetch(ITEM_URL.format(item_id)), "item"))
        except (bd.NotFound, bd.ValidationError, RuntimeError) as err:
            print(f"[warn] {t}: {err}", file=sys.stderr)
            continue
        if b["size"] is None and b["taxCerts"] is None:
            print(f"[skip] {t}: no size or tax in its description", file=sys.stderr)
            continue
        types.append(b)
        print(f"[ok] {t}: {b['group']}, {b['size']} m, {b['taxCerts']} certs")

    plants = {}
    for it in index:
        if not isinstance(it, dict) or it.get("category") not in PLANT_CATEGORIES:
            continue
        name = it.get("name") or ""
        if not name.isascii() or name.endswith(" Bundle") or name in plants:
            continue
        try:
            p = parse_plant(bd.v_dict(fetch(ITEM_URL.format(it["id"])), "item"), it["category"])
        except (bd.NotFound, bd.ValidationError, RuntimeError) as err:
            print(f"[warn] {name}: {err}", file=sys.stderr)
            continue
        if p:
            plants[name] = p
            print(f"[ok] {name}: {'/'.join(p['vocations'])}, matures {p['matureH']} h" + (f", {p['repeat']['verb'].lower()} every {p['repeat']['everyH']} h" if p["repeat"] else ""))

    if len(types) < 50 or len(plants) < 100:
        raise SystemExit(f"only {len(types)} types / {len(plants)} plantables — refusing to write")
    data = {
        "source": {"items": "aa-classic.com item data (in-game descriptions)", "snapshotTakenAt": date.today().isoformat()},
        "types": types,
        "plantables": sorted(plants.values(), key=lambda p: p["name"]),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(types)} property types, {len(plants)} plantables")


if __name__ == "__main__":
    main()
