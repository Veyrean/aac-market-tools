#!/usr/bin/env python3
"""Build the static data files for AAC Market Tools.

Sources (no Ser Meatball API calls — its creator asked that the API not be used):
  * Auction House prices: our own Google Sheet, which imports the public
    "AA Classic AH Prices" sheet with =IMPORTRANGE(...) as its creator recommends.
    It is read as CSV through the public "anyone with the link" export, so no
    Google API key or service account is needed.
  * Item categories: aa-classic.com's public item index.
  * Regrade tables: a one-time snapshot committed in pipeline/static/regrade.json.
  * Price history: built by this job itself — each run appends the sheet's daily
    prices to the previously published history files.

Design rules:
  * Python standard library only.
  * Polite: one request at a time, a pause between requests, honest User-Agent.
  * Defensive: every value is type- and range-checked and text is cleaned. A
    dataset that fails validation is never published; the previously published
    copy is reused instead (via --fallback-base), otherwise the run fails.

Usage:
  PRICE_SHEET_ID=<your sheet id> python3 pipeline/build_data.py --out site/data
  python3 pipeline/build_data.py --out site/data --sheet-csv prices.csv   # offline/testing
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

USER_AGENT = "aac-market-tools/1.0 (+https://github.com/Veyrean/aac-market-tools)"
REQUEST_PAUSE_S = 1.0
TIMEOUT_S = 60
RETRIES = 3
MAX_RESPONSE_BYTES = 40 * 1024 * 1024
MAX_NAME_LEN = 120
MAX_COPPER = 10**13  # 1 billion gold; anything above is treated as bad data
COPPER_PER_GOLD = 10000
HISTORY_BUCKETS = 32
HISTORY_DAYS = 180
ITEM_INDEX_URL = "https://aa-classic.com/data/items/_index.json"
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
STATIC_REGRADE = os.path.join(STATIC_DIR, "regrade.json")
STATIC_PACKS = os.path.join(STATIC_DIR, "packs.json")
STATIC_PACK_ROUTES = os.path.join(STATIC_DIR, "pack_routes.json")

_JUNK_NAME = re.compile(r"DO NOT TRANSLATE|^\d{4,}\b", re.I)
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f​-‏ -‮⁦-⁩]")
_SHEET_ID = re.compile(r"^[A-Za-z0-9_-]{20,100}$")


class ValidationError(Exception):
    pass


class NotFound(Exception):
    pass


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
_last_request = 0.0


def fetch_bytes(url: str) -> bytes:
    """GET politely, with retries. Raises NotFound on 404, RuntimeError on other failures."""
    global _last_request
    last_err: Exception | None = None
    for attempt in range(RETRIES):
        wait = REQUEST_PAUSE_S - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                body = resp.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise ValidationError(f"response too large: {url}")
                return body
        except urllib.error.HTTPError as err:
            if err.code == 404:
                raise NotFound(url) from err
            last_err = err
            if 400 <= err.code < 500 and err.code != 429:
                break
        except (urllib.error.URLError, TimeoutError) as err:
            last_err = err
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def fetch_json(url: str):
    try:
        return json.loads(fetch_bytes(url).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise ValidationError(f"not JSON: {url}: {err}") from err


# --------------------------------------------------------------------------
# Field validators
# --------------------------------------------------------------------------
def v_int(value, name, lo=-(2**31), hi=2**31, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value != int(value):
        raise ValidationError(f"{name}: expected integer, got {value!r}")
    value = int(value)
    if not lo <= value <= hi:
        raise ValidationError(f"{name}: {value} outside [{lo}, {hi}]")
    return value


def v_num(value, name, lo=0.0, hi=float(MAX_COPPER), allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValidationError(f"{name}: expected number, got {value!r}")
    if not lo <= value <= hi:
        raise ValidationError(f"{name}: {value} outside [{lo}, {hi}]")
    return value


def v_copper(value, name):
    """Optional non-negative copper amount, rounded to a whole copper."""
    v = v_num(value, name, 0, MAX_COPPER, allow_none=True)
    return None if v is None else int(round(v))


def v_text(value, name, allow_none=False, max_len=MAX_NAME_LEN):
    if value is None and allow_none:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{name}: expected text, got {type(value).__name__}")
    clean = _CONTROL_CHARS.sub("", value).strip()
    if not clean and not allow_none:
        raise ValidationError(f"{name}: empty text")
    return clean[:max_len] if clean else None


def v_list(value, name):
    if not isinstance(value, list):
        raise ValidationError(f"{name}: expected list")
    return value


def v_dict(value, name):
    if not isinstance(value, dict):
        raise ValidationError(f"{name}: expected object")
    return value


def cell_number(text, name):
    """Parse a sheet cell holding a plain number ('' → None)."""
    text = (text or "").strip()
    if not text:
        return None
    if "," in text:
        # A sheet in a European locale exports "0,5488" (decimal comma). That is ambiguous
        # with thousands separators, so refuse it rather than risk prices off by 10 000×.
        raise ValidationError(f"{name}: {text[:30]!r} contains a comma; set the Google Sheet's locale to "
                              "United States (File → Settings → Locale)")
    # some rows are written with a gold suffix ("21.7443g")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*g?", text)
    if not m:
        raise ValidationError(f"{name}: not a number: {text[:30]!r}")
    return v_num(float(m.group(1)), name, 0, MAX_COPPER)


# --------------------------------------------------------------------------
# Market prices (from the Google Sheet)
# --------------------------------------------------------------------------
SHEET_COLUMNS = ["Item ID", "Item Name", "24h Average", "24h Volume", "7d Average", "7d Volume", "30d Average", "30d Volume"]
MARKET_FIELDS = ["id", "name", "cat", "latest", "avg7", "avg30", "vol1", "vol7", "vol30"]


def sheet_csv_url(sheet_id: str, gid: str | None) -> str:
    if not _SHEET_ID.match(sheet_id):
        raise ValidationError("PRICE_SHEET_ID does not look like a Google Sheet id")
    params = {"tqx": "out:csv", "headers": "1"}
    if gid:
        if not gid.isdigit():
            raise ValidationError("PRICE_SHEET_GID must be numeric")
        params["gid"] = gid
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?" + urllib.parse.urlencode(params)


def parse_price_sheet(text: str):
    """Parse the AH price sheet CSV. Returns (rows, sheet_date)."""
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration as err:
        raise ValidationError("price sheet is empty") from err
    if [h.strip() for h in header[:8]] != SHEET_COLUMNS:
        raise ValidationError(f"unexpected price sheet columns: {header[:8]!r} (is IMPORTRANGE set up in cell A1?)")
    sheet_date = None
    for cell in header[8:]:
        m = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})\s*", cell)
        if m:
            sheet_date = m.group(1)
    if sheet_date is None:
        raise ValidationError("price sheet: 'Last Updated At' date not found (import AHPrices!A1:L, not A2:L)")
    date.fromisoformat(sheet_date)

    by_id = {}
    for line_no, row in enumerate(reader, start=2):
        if len(row) < 8 or not row[0].strip().isdigit():
            continue
        item_id = v_int(int(row[0]), f"line {line_no} id", 1, 10**9)
        name = v_text(row[1], f"line {line_no} name", allow_none=True)
        if not name or _JUNK_NAME.search(name) or "(DEPRECATED)" in name:
            continue
        gold = [cell_number(row[i], f"line {line_no} col {i + 1}") for i in range(2, 8)]
        avg1, vol1, avg7, vol7, avg30, vol30 = gold
        if avg30 is None and avg7 is None and avg1 is None:
            continue  # never traded in the last 30 days
        to_c = lambda g: None if g is None else v_copper(g * COPPER_PER_GOLD, f"line {line_no} price")
        rec = [item_id, name, None, to_c(avg1), to_c(avg7), to_c(avg30),
               int(vol1 or 0), int(vol7 or 0), int(vol30 or 0)]
        prev = by_id.get(item_id)
        if prev is None or (rec[8] > prev[8]):
            by_id[item_id] = rec
    rows = sorted(by_id.values(), key=lambda r: -r[8])
    if len(rows) < 500:
        raise ValidationError(f"price sheet: only {len(rows)} traded items, expected thousands")
    return rows, sheet_date


def load_categories():
    """item id → game category name, from aa-classic.com's public item index."""
    data = v_list(fetch_json(ITEM_INDEX_URL), "item index")
    cats = {}
    for it in data:
        if not isinstance(it, dict):
            continue
        try:
            item_id = v_int(it.get("id"), "id", 1, 10**9)
            cat = v_text(it.get("category"), "category", allow_none=True, max_len=60)
        except ValidationError:
            continue
        if cat:
            cats[item_id] = cat
    if len(cats) < 1000:
        raise ValidationError("item index looks incomplete")
    return cats


def build_market(sheet_text: str, categories: dict | None):
    rows, sheet_date = parse_price_sheet(sheet_text)
    labels, cat_ids = {}, {}
    for r in rows:
        name = (categories or {}).get(r[0])
        if name:
            if name not in cat_ids:
                cat_ids[name] = len(cat_ids) + 1
                labels[str(cat_ids[name])] = name
            r[2] = cat_ids[name]
    return {"fields": MARKET_FIELDS, "categories": labels, "rows": rows, "sheetDate": sheet_date}


# --------------------------------------------------------------------------
# Price history (built up by this job, one point per sheet date)
# --------------------------------------------------------------------------
def history_bucket(item_id: int) -> int:
    return item_id % HISTORY_BUCKETS


def merge_history(previous: dict | None, market: dict, keep_days: int = HISTORY_DAYS):
    """Add today's 24h averages to one history bucket.

    Format: {"days": ["YYYY-MM-DD", ...], "items": {"<id>": [[dayIndex, avgCopper, volume], ...]}}
    """
    days = list(previous.get("days", [])) if previous else []
    items = {k: list(v) for k, v in (previous or {}).get("items", {}).items()}
    today = market["sheetDate"]
    if today not in days:
        days.append(today)
        days.sort()
    # re-index after sort, then trim to the newest keep_days dates
    old_days = list(previous.get("days", [])) if previous else []
    remap = {i: days.index(d) for i, d in enumerate(old_days)}
    for k, pts in items.items():
        items[k] = [[remap[p[0]], p[1], p[2]] for p in pts if p[0] in remap]
    t = days.index(today)
    for r in market["bucketRows"]:
        if r[3] is None:
            continue
        pts = [p for p in items.get(str(r[0]), []) if p[0] != t]
        pts.append([t, r[3], r[6]])
        items[str(r[0])] = sorted(pts)
    if len(days) > keep_days:
        cut = len(days) - keep_days
        days = days[cut:]
        items = {k: [[p[0] - cut, p[1], p[2]] for p in v if p[0] >= cut] for k, v in items.items()}
    return {"days": days, "items": {k: v for k, v in items.items() if v}}


def validate_history(data):
    v_dict(data, "history")
    days = v_list(data.get("days"), "days")
    for d in days:
        date.fromisoformat(v_text(d, "day"))
    for k, pts in v_dict(data.get("items"), "items").items():
        if not k.isdigit():
            raise ValidationError("history item key")
        for p in v_list(pts, "points"):
            v_int(p[0], "day index", 0, len(days) - 1)
            v_copper(p[1], "avg")
            v_int(p[2], "volume", 0, 10**12)
    return data


# --------------------------------------------------------------------------
# Regrade data (static snapshot, re-validated on every build)
# --------------------------------------------------------------------------
def clean_rules(raw):
    v_dict(raw, "regrade rules")
    fee = v_dict(raw.get("fee"), "fee")
    out_fee = {k: v_num(fee.get(k), f"fee.{k}", 0, 10**7) for k in ("base_copper", "exponent", "grade_coef", "level_coef", "slot_coef")}
    grades = [{"id": v_int(g.get("id"), "grade.id", 0, 30), "name": v_text(g.get("name"), "grade.name")}
              for g in v_list(raw.get("grades"), "grades")]
    if len(grades) < 10:
        raise ValidationError("rules: too few grades")
    groups = {}
    for gid, group in v_dict(raw.get("groups"), "groups").items():
        v_int(int(gid), "group id", 0, 1000)
        rows = {}
        for grade, r in v_dict(group.get("rows"), "group.rows").items():
            v_int(int(grade), "row grade", 0, 30)
            v_dict(r, "row")
            rows[str(int(grade))] = {
                "success": v_int(r.get("success"), "success", 0, 10000),
                "great": v_int(r.get("great"), "great", 0, 10000),
                "break": v_int(r.get("break"), "break", 0, 10000),
                "downgrade": v_int(r.get("downgrade"), "downgrade", 0, 10000),
                "dmin": v_int(r.get("dmin"), "dmin", -1, 30),
                "dmax": v_int(r.get("dmax"), "dmax", -1, 30),
                "cost": v_int(r.get("cost"), "cost", 0, 10000),
            }
        groups[str(int(gid))] = {"name": v_text(group.get("name"), "group.name"), "rows": rows}
    if not groups:
        raise ValidationError("rules: no groups")
    scrolls = [{
        "item_id": v_int(s.get("item_id"), "scroll.item_id", 1, 10**9),
        "name": v_text(s.get("name"), "scroll.name"),
        "type": v_text(s.get("type"), "scroll.type"),
        "resplendent": bool(s.get("resplendent")),
        "lucky_point_item_id": v_int(s.get("lucky_point_item_id"), "lucky_point_item_id", 1, 10**9, allow_none=True),
    } for s in v_list(raw.get("scrolls"), "scrolls")]
    supports = []
    for s in v_list(raw.get("supports"), "supports"):
        kind = v_text(s.get("kind"), "support.kind")
        if kind not in ("charm", "emblem"):
            continue
        supports.append({
            "item_id": v_int(s.get("item_id"), "support.item_id", 1, 10**9),
            "name": v_text(s.get("name"), "support.name"),
            "kind": kind,
            "applies_to": [v_text(t, "applies_to") for t in v_list(s.get("applies_to"), "applies_to")][:10],
            "grade_min": v_int(s.get("grade_min"), "grade_min", -1, 30),
            "grade_max": v_int(s.get("grade_max"), "grade_max", -1, 30),
            "success_mul": v_num(s.get("success_mul"), "success_mul", -100, 1000),
            "success_ratio": v_num(s.get("success_ratio"), "success_ratio", -10000, 10000),
            "break_mul": v_num(s.get("break_mul"), "break_mul", -100, 1000),
            "break_ratio": v_num(s.get("break_ratio"), "break_ratio", -10000, 10000),
            "downgrade_mul": v_num(s.get("downgrade_mul"), "downgrade_mul", -100, 1000),
            "downgrade_ratio": v_num(s.get("downgrade_ratio"), "downgrade_ratio", -10000, 10000),
            "shard_item_id": v_int(s.get("shard_item_id"), "shard_item_id", 1, 10**9, allow_none=True),
            "shard_name": v_text(s.get("shard_name"), "shard_name", allow_none=True),
            "shard_multiplier": v_int(s.get("shard_multiplier"), "shard_multiplier", 1, 10000, allow_none=True),
        })
    return {"fee": out_fee, "grades": grades, "groups": groups, "scrolls": scrolls, "supports": supports,
            "generatedAt": v_text(raw.get("generatedAt"), "generatedAt", allow_none=True)}


REGRADE_ITEM_FIELDS = ["id", "name", "group", "type", "level", "slotCost", "maxGrade", "baseCost"]


def build_regrade():
    with open(STATIC_REGRADE, encoding="utf-8") as fh:
        raw = json.load(fh)
    v_dict(raw, "regrade snapshot")
    if raw.get("fields") != REGRADE_ITEM_FIELDS:
        raise ValidationError("regrade snapshot: unexpected item fields")
    items = []
    for r in v_list(raw.get("items"), "items"):
        item = [
            v_int(r[0], "id", 1, 10**9), v_text(r[1], "name"), v_int(r[2], "group", 0, 1000),
            v_text(r[3], "type", max_len=40), v_int(r[4], "level", 0, 200),
            v_int(r[5], "slotCost", 0, 10**6, allow_none=True), v_int(r[6], "maxGrade", 0, 30), v_copper(r[7], "baseCost"),
        ]
        if not _JUNK_NAME.search(item[1]):
            items.append(item)
    if len(items) < 100:
        raise ValidationError("regrade snapshot: too few items")
    return {"rules": clean_rules(raw.get("rules")), "fields": REGRADE_ITEM_FIELDS, "items": items,
            "source": raw.get("source")}


# --------------------------------------------------------------------------
# Trade packs (static snapshots, re-validated on every build)
# --------------------------------------------------------------------------
def _clean_turn_in(d, kind):
    v_dict(d, "turn-in")
    out = {"to": v_text(d.get("to"), "to"), "reward": v_text(d.get("reward"), "reward")}
    if kind == "gold":
        out["copper"] = v_int(d.get("copper"), "copper", 0, MAX_COPPER)
    else:
        out["qty"] = v_int(d.get("qty"), "qty", 1, 100000)
    return out


def build_packs():
    with open(STATIC_PACKS, encoding="utf-8") as fh:
        raw = v_dict(json.load(fh), "packs snapshot")
    routes = {}
    if os.path.exists(STATIC_PACK_ROUTES):
        with open(STATIC_PACK_ROUTES, encoding="utf-8") as fh:
            routes = v_dict(json.load(fh), "pack routes")
    route_packs = v_dict(routes.get("packs", {}), "route packs")
    packs = []
    for p in v_list(raw.get("packs"), "packs"):
        v_dict(p, "pack")
        pid = v_int(p.get("id"), "id", 1, 10**9)
        game = route_packs.get(str(pid)) or {}
        demand = {}
        for zone, pct in v_dict(game.get("demand", {}), "demand").items():
            demand[v_text(zone, "zone")] = v_num(pct, "demand %", 0, 200)
        packs.append({
            "id": pid,
            "name": v_text(p.get("name"), "name"),
            "origin": v_text(game.get("origin"), "origin", allow_none=True),
            "craftLabor": v_num(p.get("craftLabor"), "craftLabor", 0, 10000),
            "turnInLabor": v_num(p.get("turnInLabor"), "turnInLabor", 0, 10000),
            "yield": v_num(p.get("yield", 1), "yield", 1, 1000),
            "materials": [{"id": v_int(m.get("id"), "material id", 1, 10**9), "name": v_text(m.get("name"), "material name"),
                           "qty": v_num(m.get("qty"), "material qty", 0, 10**7)} for m in v_list(p.get("materials"), "materials")],
            "gold": [_clean_turn_in(d, "gold") for d in v_list(p.get("gold"), "gold")],
            "resources": [_clean_turn_in(d, "resource") for d in v_list(p.get("resources"), "resources")],
            "demand": demand,
        })
    if len(packs) < 100:
        raise ValidationError("packs snapshot: too few packs")
    tiers = [{"name": v_text(t.get("name"), "tier"), "advantage": v_num(t.get("advantage"), "advantage", 0, 100)}
             for t in v_list(raw.get("tiers", []), "tiers")]
    src = v_dict(raw.get("source", {}), "source")
    return {"packs": packs, "tiers": tiers,
            "payoutDemand": v_num(src.get("payoutDemand", 130), "payoutDemand", 1, 200),
            "snapshotTakenAt": v_text(src.get("snapshotTakenAt"), "snapshotTakenAt", allow_none=True),
            "demandExportedOn": v_text(routes.get("exportedOn"), "exportedOn", allow_none=True)}


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
    return os.path.getsize(path)


def fetch_published(base, name):
    """Previously published JSON file, or None if it does not exist yet."""
    if not base:
        return None
    try:
        return fetch_json(base.rstrip("/") + "/" + name)
    except NotFound:
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="output directory (e.g. site/data)")
    ap.add_argument("--fallback-base", default=os.environ.get("FALLBACK_BASE", ""),
                    help="URL of the currently published data directory (fallback + history)")
    ap.add_argument("--sheet-id", default=os.environ.get("PRICE_SHEET_ID", ""), help="Google Sheet id of your price sheet")
    ap.add_argument("--sheet-gid", default=os.environ.get("PRICE_SHEET_GID", ""), help="tab id (gid) if prices are not on the first tab")
    ap.add_argument("--sheet-csv", help="read prices from a local CSV export instead (testing)")
    ap.add_argument("--no-categories", action="store_true", help="skip the aa-classic.com item index")
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    meta = {"generatedAt": now, "datasets": {}}
    failed = []

    # ---- regrade (static snapshot) ------------------------------------------
    try:
        regrade = build_regrade()
        regrade["builtAt"] = now
        write_json(os.path.join(args.out, "regrade.json"), regrade)
        meta["datasets"]["regrade"] = {"fresh": True, "builtAt": now, "snapshot": (regrade.get("source") or {}).get("snapshotTakenAt")}
        print(f"[ok] regrade: {len(regrade['items'])} items from the committed snapshot")
    except Exception as err:  # noqa: BLE001
        print(f"[error] regrade snapshot invalid: {err}", file=sys.stderr)
        failed.append("regrade")

    # ---- trade packs (static snapshots) ---------------------------------------
    try:
        packs = build_packs()
        packs["builtAt"] = now
        write_json(os.path.join(args.out, "packs.json"), packs)
        meta["datasets"]["packs"] = {"fresh": True, "builtAt": now, "snapshot": packs.get("snapshotTakenAt"),
                                     "demandExportedOn": packs.get("demandExportedOn")}
        print(f"[ok] packs: {len(packs['packs'])} packs from the committed snapshots")
    except Exception as err:  # noqa: BLE001
        print(f"[error] packs snapshot invalid: {err}", file=sys.stderr)
        failed.append("packs")

    # ---- market ---------------------------------------------------------------
    market = None
    try:
        if args.sheet_csv:
            with open(args.sheet_csv, encoding="utf-8") as fh:
                sheet_text = fh.read()
        elif args.sheet_id:
            sheet_text = fetch_bytes(sheet_csv_url(args.sheet_id, args.sheet_gid)).decode("utf-8")
        else:
            raise ValidationError("no price source: set PRICE_SHEET_ID (or --sheet-csv)")
        categories = None
        if not args.no_categories:
            try:
                categories = load_categories()
            except Exception as err:  # noqa: BLE001 - categories are optional
                print(f"[warn] categories unavailable: {err}", file=sys.stderr)
        market = build_market(sheet_text, categories)
        market["builtAt"] = now
        size = write_json(os.path.join(args.out, "market.json"), market)
        meta["datasets"]["market"] = {"fresh": True, "builtAt": now, "sheetDate": market["sheetDate"]}
        print(f"[ok] market: {len(market['rows'])} items, sheet date {market['sheetDate']} ({size / 1024:.0f} KB)")
    except Exception as err:  # noqa: BLE001
        print(f"[warn] market: fresh build failed: {err}", file=sys.stderr)
        prev = None
        try:
            prev = fetch_published(args.fallback_base, "market.json")
        except Exception as fb_err:  # noqa: BLE001
            print(f"[error] market fallback failed: {fb_err}", file=sys.stderr)
        if prev and isinstance(prev.get("rows"), list) and len(prev["rows"]) >= 500:
            write_json(os.path.join(args.out, "market.json"), prev)
            meta["datasets"]["market"] = {"fresh": False, "builtAt": prev.get("builtAt"), "sheetDate": prev.get("sheetDate"), "error": str(err)[:300]}
            print("[info] market: reusing previously published data", file=sys.stderr)
        else:
            failed.append("market")

    # ---- history ----------------------------------------------------------------
    # Each deploy replaces the whole site, so the history must always be carried over:
    # extended with today's prices when they are fresh, copied unchanged otherwise.
    if market is None and "market" not in failed:
        try:
            for b in range(HISTORY_BUCKETS):
                prev = fetch_published(args.fallback_base, f"history/{b}.json")
                if prev is not None:
                    write_json(os.path.join(args.out, "history", f"{b}.json"), validate_history(prev))
            meta["datasets"]["history"] = {"fresh": False, "builtAt": now, "buckets": HISTORY_BUCKETS}
        except Exception as err:  # noqa: BLE001
            print(f"[error] history: could not carry over previous history: {err}", file=sys.stderr)
            failed.append("history")
    if market is not None:
        buckets = {}
        for r in market["rows"]:
            buckets.setdefault(history_bucket(r[0]), []).append(r)
        try:
            for b in range(HISTORY_BUCKETS):
                prev = fetch_published(args.fallback_base, f"history/{b}.json")
                if prev is not None:
                    validate_history(prev)
                merged = merge_history(prev, {"sheetDate": market["sheetDate"], "bucketRows": buckets.get(b, [])})
                write_json(os.path.join(args.out, "history", f"{b}.json"), merged)
            meta["datasets"]["history"] = {"fresh": True, "builtAt": now, "buckets": HISTORY_BUCKETS}
            print(f"[ok] history: {HISTORY_BUCKETS} buckets updated for {market['sheetDate']}")
        except Exception as err:  # noqa: BLE001
            # Never publish a history that lost its past: fail so the old site stays up.
            print(f"[error] history: could not extend previous history: {err}", file=sys.stderr)
            failed.append("history")

    write_json(os.path.join(args.out, "meta.json"), meta)
    if failed:
        print(f"[error] no usable data for: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
