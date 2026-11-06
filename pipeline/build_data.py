#!/usr/bin/env python3
"""Build the static data files for AAC Market Tools.

Fetches public data from the Ser Meatball API, validates and compacts it, and
writes JSON files into the site's data directory.

Design rules:
  * Python standard library only (no third-party packages to audit or pin).
  * Polite: one request at a time, a pause between requests, an honest
    User-Agent, retries with backoff, and a hard cap on the number of pages.
  * Defensive: every field from upstream is type- and range-checked, text is
    stripped of control characters and length-limited. A dataset that fails
    validation is never published; the previously published copy is reused
    instead (when --fallback-base is given), otherwise the run fails.

Usage:
  python3 pipeline/build_data.py --out site/data
  python3 pipeline/build_data.py --out site/data --fallback-base https://<user>.github.io/<repo>/data
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API_BASE = "https://api.sermeatball.com"
USER_AGENT = "aac-market-tools/1.0 (+https://github.com/Veyrean/aac-market-tools)"
REQUEST_PAUSE_S = 1.0
TIMEOUT_S = 45
RETRIES = 3
MAX_RESPONSE_BYTES = 20 * 1024 * 1024
MARKET_PAGE_SIZE = 200
MARKET_MAX_PAGES = 80
REGRADE_PAGE_SIZE = 100
REGRADE_MAX_PAGES = 120
MAX_NAME_LEN = 120
MAX_COPPER = 10**13  # 1 billion gold; anything above is treated as bad data

_JUNK_NAME = re.compile(r"DO NOT TRANSLATE|^\d{4,}\b", re.I)
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f​-‏ -‮⁦-⁩]")


class ValidationError(Exception):
    pass


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
_last_request = 0.0


def fetch_json(path: str, params: dict | None = None, base: str = API_BASE):
    """GET a JSON document politely, with retries. Raises on final failure."""
    global _last_request
    url = base.rstrip("/") + "/" + path.lstrip("/")
    if params:
        url += "?" + urllib.parse.urlencode(params)
    last_err: Exception | None = None
    for attempt in range(RETRIES):
        wait = REQUEST_PAUSE_S - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                body = resp.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise ValidationError(f"response too large: {url}")
                return json.loads(body.decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as err:
            last_err = err
            status = getattr(err, "code", None)
            if status is not None and 400 <= status < 500 and status != 429:
                break  # client error: retrying will not help
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


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
    return clean[:max_len]


def v_list(value, name):
    if not isinstance(value, list):
        raise ValidationError(f"{name}: expected list")
    return value


def v_dict(value, name):
    if not isinstance(value, dict):
        raise ValidationError(f"{name}: expected object")
    return value


# --------------------------------------------------------------------------
# Datasets
# --------------------------------------------------------------------------
MARKET_FIELDS = ["id", "name", "cat", "latest", "avg7", "avg30", "vol7", "vol30", "allTime"]


def clean_market_row(row):
    v_dict(row, "market row")
    return [
        v_int(row.get("item_id"), "item_id", 1, 10**9),
        v_text(row.get("item_name"), "item_name"),
        # upstream "category_label" names the *sub*category, so key rows by subcategory id
        v_int(row.get("subcategory_id"), "subcategory_id", 0, 10**6, allow_none=True),
        v_copper(row.get("latest_copper"), "latest_copper"),
        v_copper(row.get("avg_7d_copper"), "avg_7d_copper"),
        v_copper(row.get("avg_30d_copper"), "avg_30d_copper"),
        v_copper(row.get("volume_7d"), "volume_7d"),
        v_copper(row.get("volume_30d"), "volume_30d"),
        v_copper(row.get("all_time_copper"), "all_time_copper"),
    ]


def build_market():
    """All items that traded in the last 30 days, most-traded first."""
    rows, categories, seen = [], {}, set()
    total = None
    for page in range(MARKET_MAX_PAGES):
        data = v_dict(fetch_json("/auction/market-items", {
            "limit": MARKET_PAGE_SIZE, "offset": page * MARKET_PAGE_SIZE,
            "sort": "volume_30d", "direction": "desc"}), "market page")
        total = v_int(data.get("total"), "total", 0, 10**7)
        page_rows = v_list(data.get("rows"), "rows")
        traded_on_page = 0
        for raw in page_rows:
            row = clean_market_row(raw)
            if not row[7]:  # no 30-day volume: everything after this is untraded
                continue
            traded_on_page += 1
            if row[0] in seen:
                continue
            seen.add(row[0])
            rows.append(row)
            if row[2] is not None:
                label = v_text(raw.get("category_label"), "category_label", allow_none=True)
                if label:
                    categories[str(row[2])] = label
        if traded_on_page < len(page_rows) or (page + 1) * MARKET_PAGE_SIZE >= total:
            break
    else:
        raise ValidationError("market: hit page cap; upstream ordering may have changed")
    if len(rows) < 500:
        raise ValidationError(f"market: only {len(rows)} traded items, expected thousands")
    groups = []
    for c in v_list(fetch_json("/auction/categories"), "categories"):
        v_dict(c, "category")
        subs = [v_int(s.get("subcategory_id"), "subcategory_id", 0, 10**6)
                for s in v_list(c.get("subcategories") or [], "subcategories") if isinstance(s, dict)]
        subs = [s for s in subs if str(s) in categories]
        if subs:
            groups.append({"label": v_text(c.get("label"), "category label"), "subs": subs})
    return {"fields": MARKET_FIELDS, "categories": categories, "groups": groups, "rows": rows, "upstreamTotal": total}


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
    scrolls = []
    for s in v_list(raw.get("scrolls"), "scrolls"):
        scrolls.append({
            "item_id": v_int(s.get("item_id"), "scroll.item_id", 1, 10**9),
            "name": v_text(s.get("name"), "scroll.name"),
            "type": v_text(s.get("type"), "scroll.type"),
            "resplendent": bool(s.get("resplendent")),
            "lucky_point_item_id": v_int(s.get("lucky_point_item_id"), "lucky_point_item_id", 1, 10**9, allow_none=True),
        })
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
    prices = {}
    for item_id, p in v_dict(raw.get("prices") or {}, "prices").items():
        v_dict(p, "price")
        prices[str(v_int(int(item_id), "price id", 1, 10**9))] = {
            "copper": v_copper(p.get("unit_price_copper"), "unit_price_copper"),
            "tier": v_text(p.get("price_tier"), "price_tier", allow_none=True) or "none",
        }
    return {"fee": out_fee, "grades": grades, "groups": groups, "scrolls": scrolls, "supports": supports,
            "prices": prices, "generatedAt": v_text(raw.get("generated_at"), "generated_at", allow_none=True)}


REGRADE_ITEM_FIELDS = ["id", "name", "group", "type", "level", "slotCost", "maxGrade", "baseCost"]


def clean_regrade_item(r):
    v_dict(r, "regrade item")
    return [
        v_int(r.get("item_id"), "item_id", 1, 10**9),
        v_text(r.get("name"), "name"),
        v_int(r.get("group_id"), "group_id", 0, 1000),
        v_text(r.get("type"), "type", max_len=40),
        v_int(r.get("level"), "level", 0, 200),
        v_int(r.get("slot_enchant_cost"), "slot_enchant_cost", 0, 10**6, allow_none=True),
        v_int(r.get("max_grade"), "max_grade", 0, 30),
        v_copper(r.get("base_cost_copper"), "base_cost_copper"),
    ]


def build_regrade():
    rules = clean_rules(fetch_json("/regrade/rules"))
    items, seen, total = [], set(), None
    for page in range(REGRADE_MAX_PAGES):
        data = v_dict(fetch_json("/regrade/items", {"limit": REGRADE_PAGE_SIZE, "offset": page * REGRADE_PAGE_SIZE}), "regrade page")
        total = v_int(data.get("total"), "total", 0, 10**6)
        page_rows = v_list(data.get("rows"), "rows")
        for raw in page_rows:
            row = clean_regrade_item(raw)
            if _JUNK_NAME.search(row[1]):
                continue  # untranslated placeholder entries from the game files
            if row[0] not in seen:
                seen.add(row[0])
                items.append(row)
        if not page_rows or (page + 1) * REGRADE_PAGE_SIZE >= total:
            break
    else:
        raise ValidationError("regrade items: hit page cap")
    if len(items) < 100:
        raise ValidationError(f"regrade items: only {len(items)} items")
    items.sort(key=lambda r: r[1].lower())
    return {"rules": rules, "fields": REGRADE_ITEM_FIELDS, "items": items}


def validate_published(name, data):
    """Light re-validation of a previously published file used as fallback."""
    v_dict(data, name)
    if name == "market":
        rows = v_list(data.get("rows"), "rows")
        if len(rows) < 500:
            raise ValidationError("fallback market too small")
        for r in rows[:50]:
            v_int(r[0], "id", 1, 10**9)
            v_text(r[1], "name")
    elif name == "regrade":
        v_dict(data.get("rules"), "rules")
        if len(v_list(data.get("items"), "items")) < 100:
            raise ValidationError("fallback regrade too small")
    return data


DATASETS = {"market": build_market, "regrade": build_regrade}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="output directory (e.g. site/data)")
    ap.add_argument("--fallback-base", default=os.environ.get("FALLBACK_BASE", ""),
                    help="URL of the currently published data directory, used if a fresh build fails")
    ap.add_argument("--only", choices=sorted(DATASETS), action="append", help="build only these datasets")
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    meta = {"generatedAt": now, "source": "api.sermeatball.com", "datasets": {}}
    failed = []
    for name in args.only or sorted(DATASETS):
        builder = DATASETS[name]
        status = {"fresh": True, "builtAt": now}
        try:
            data = builder()
        except Exception as err:  # noqa: BLE001 - any failure falls back to last good data
            print(f"[warn] {name}: fresh build failed: {err}", file=sys.stderr)
            data = None
            if args.fallback_base:
                try:
                    data = validate_published(name, fetch_json(f"{name}.json", base=args.fallback_base))
                    status = {"fresh": False, "builtAt": data.get("builtAt"), "error": str(err)[:300]}
                    print(f"[info] {name}: reusing previously published data", file=sys.stderr)
                except Exception as fb_err:  # noqa: BLE001
                    print(f"[error] {name}: fallback failed too: {fb_err}", file=sys.stderr)
            if data is None:
                failed.append(name)
                continue
        data["builtAt"] = status["builtAt"]
        path = os.path.join(args.out, f"{name}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
        size_kb = os.path.getsize(path) / 1024
        print(f"[ok] {name}: wrote {path} ({size_kb:.0f} KB, fresh={status['fresh']})")
        meta["datasets"][name] = status

    with open(os.path.join(args.out, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    if failed:
        print(f"[error] no usable data for: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
