#!/usr/bin/env python3
"""One-time snapshot of item icons → site/assets/icons/ + pipeline/static/icons.json

Run by hand (never on a schedule), after the other snapshots, e.g. after a game patch:
    SNAPSHOT_CACHE=/tmp/aac-cache python3 pipeline/snapshot_icons.py

Item icons are ArcheAge game art (© XLGAMES / Kakao Games); the files are taken from aa-classic.com,
which hosts them. Only the icons of items the site shows are copied (market, crafting, trade packs,
land), so visitors' browsers never contact another site. Existing files are not downloaded again.
Each file is checked to be a small PNG before it is written.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as bd  # noqa: E402  (shared polite HTTP + validators)
from snapshot_packs import fetch  # noqa: E402  (optional on-disk cache for JSON)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICON_URL = "https://aa-classic.com/game/icons/{}"
ICON_DIR = os.path.join(ROOT, "site", "assets", "icons")
OUT = os.path.join(HERE, "static", "icons.json")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_ICON_BYTES = 64 * 1024
SOURCE_NAME = re.compile(r"^[A-Za-z0-9_\-]+(?:[/\\][A-Za-z0-9_\-]+)*\.png$")


def local_name(source):
    """'costume_set\\nu_f_in_pants012.png' → 'costume_set__nu_f_in_pants012.png' (flat, lowercase)."""
    if not SOURCE_NAME.match(source or ""):
        return None
    return re.sub(r"[/\\]", "__", source).lower()


def used_item_ids():
    ids = set()
    with open(os.path.join(ROOT, "site", "data", "market.json"), encoding="utf-8") as fh:
        market = json.load(fh)
    col = market["fields"].index("id")
    ids.update(row[col] for row in market["rows"])
    with open(os.path.join(HERE, "static", "crafts.json"), encoding="utf-8") as fh:
        for r in json.load(fh)["recipes"]:
            ids.add(r["product"])
            ids.update(m["id"] for m in r["materials"])
    with open(os.path.join(HERE, "static", "packs.json"), encoding="utf-8") as fh:
        for p in json.load(fh)["packs"]:
            ids.add(p["id"])
            ids.update(m["id"] for m in p["materials"])
    with open(os.path.join(HERE, "static", "land.json"), encoding="utf-8") as fh:
        ids.update(p["id"] for p in json.load(fh)["plantables"])
    ids.discard(500)  # coins: no icon needed
    return ids


def main():
    index = {it["id"]: it for it in bd.v_list(fetch(bd.ITEM_INDEX_URL), "item index") if isinstance(it, dict) and "id" in it}
    os.makedirs(ICON_DIR, exist_ok=True)
    icons, done, failed = {}, {}, 0
    for item_id in sorted(used_item_ids()):
        source = (index.get(item_id) or {}).get("icon")
        name = local_name(source)
        if not name:
            continue
        if name not in done:
            path = os.path.join(ICON_DIR, name)
            if not os.path.exists(path):
                try:
                    body = bd.fetch_bytes(ICON_URL.format(source.replace("\\", "/")))
                except (bd.NotFound, RuntimeError) as err:
                    print(f"[warn] {source}: {err}", file=sys.stderr)
                    failed += 1
                    done[name] = False
                    continue
                if not body.startswith(PNG_MAGIC) or len(body) > MAX_ICON_BYTES:
                    print(f"[warn] {source}: not a small PNG", file=sys.stderr)
                    failed += 1
                    done[name] = False
                    continue
                with open(path, "wb") as fh:
                    fh.write(body)
            done[name] = True
            if len(done) % 250 == 0:
                print(f"[..] {len(done)} icons", flush=True)
        if done.get(name):
            icons[str(item_id)] = name

    if len(icons) < 1000:
        raise SystemExit(f"only {len(icons)} icons — refusing to write")
    data = {
        "source": {"icons": "ArcheAge item icons (© XLGAMES / Kakao Games) via aa-classic.com", "snapshotTakenAt": date.today().isoformat()},
        "icons": dict(sorted(icons.items(), key=lambda kv: int(kv[0]))),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"wrote {OUT}: {len(icons)} items, {sum(done.values())} icon files, {failed} failed")


if __name__ == "__main__":
    main()
