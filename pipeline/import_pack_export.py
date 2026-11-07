#!/usr/bin/env python3
"""Import an in-game pack export (tools/pack-export-addon) → pipeline/static/pack_routes.json

    python3 pipeline/import_pack_export.py path/to/export.txt

Keeps, per pack: its production zone and the demand % the game reported for each
destination at export time. Reads the addon's serialized Lua table with a small
stdlib-only parser (the file is treated as untrusted data and never executed).
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "pack_routes.json")
MAX_BYTES = 50 * 1024 * 1024


class ParseError(Exception):
    pass


_TOKEN = re.compile(r'''\s*(?:
    (?P<str>"(?:[^"\\]|\\.|\\\n)*")      |
    (?P<num>-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?) |
    (?P<name>[A-Za-z_][A-Za-z0-9_]*)       |
    (?P<sym>[{}=,\[\];])
)''', re.X | re.S)

_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "\n": "\n"}


def _unescape(body: str) -> str:
    out, i = [], 0
    while i < len(body):
        c = body[i]
        if c == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt.isdigit():
                m = re.match(r"\d{1,3}", body[i + 1:])
                out.append(chr(int(m.group(0))))
                i += 1 + len(m.group(0))
                continue
            out.append(_ESCAPES.get(nxt, nxt))
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def tokenize(text: str):
    pos, n = 0, len(text)
    while pos < n:
        m = _TOKEN.match(text, pos)
        if not m or m.end() == pos:
            if text[pos:].strip() == "":
                break
            raise ParseError(f"unexpected input at {pos}: {text[pos:pos + 20]!r}")
        pos = m.end()
        kind = m.lastgroup
        yield kind, m.group(kind)


def parse_lua_table(text: str):
    tokens = list(tokenize(text))
    pos = 0

    def peek(k=0):
        return tokens[pos + k] if pos + k < len(tokens) else (None, None)

    def take(expected=None):
        nonlocal pos
        tok = peek()
        if expected and tok[1] != expected:
            raise ParseError(f"expected {expected!r}, got {tok!r}")
        pos += 1
        return tok

    def value():
        kind, v = peek()
        if v == "{":
            return table()
        take()
        if kind == "str":
            return _unescape(v[1:-1])
        if kind == "num":
            f = float(v)
            return int(f) if f.is_integer() and "." not in v and "e" not in v.lower() else f
        if kind == "name" and v in ("true", "false", "nil"):
            return {"true": True, "false": False, "nil": None}[v]
        raise ParseError(f"unexpected value {v!r}")

    def table():
        take("{")
        items, arr = {}, []
        while peek()[1] != "}":
            k0, v0 = peek()
            if k0 == "name" and peek(1)[1] == "=":
                take(); take("=")
                items[v0] = value()
            elif v0 == "[":
                take(); key = value(); take("]"); take("=")
                items[key] = value()
            else:
                arr.append(value())
            if peek()[1] in (",", ";"):
                take()
        take("}")
        if arr and not items:
            return arr
        if arr:
            items.update({i + 1: v for i, v in enumerate(arr)})
        return items

    result = value()
    if pos != len(tokens):
        raise ParseError("trailing data after table")
    return result


def as_list(v):
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        return [v[k] for k in sorted(v, key=lambda x: (not isinstance(x, int), x))]
    return []


def zone_name(full: str) -> str:
    """'Haranya - Solis Headlands' → 'Solis Headlands'"""
    return full.split(" - ", 1)[1].strip() if " - " in full else full.strip()


def main(argv):
    if len(argv) != 2:
        raise SystemExit(__doc__)
    path = argv[1]
    if os.path.getsize(path) > MAX_BYTES:
        raise SystemExit("export file is unexpectedly large")
    with open(path, encoding="utf-8", errors="replace") as fh:
        data = parse_lua_table(fh.read())
    if not isinstance(data, dict) or data.get("format") != "aacmt-pack-export":
        raise SystemExit("not an AACMT pack export")
    packs = {}
    answered = 0
    for route in as_list(data.get("routes")):
        if not isinstance(route, dict) or route.get("timedOut"):
            continue
        answered += 1
        origin = zone_name(str(route["from"]["name"]))
        dest = zone_name(str(route["to"]["name"]))
        for p in as_list(route.get("packs")):
            info = p.get("itemInfo") or {}
            item_id, ratio = info.get("itemType"), p.get("ratio")
            if not isinstance(item_id, int) or not isinstance(ratio, (int, float)) or not 0 <= ratio <= 200:
                continue
            entry = packs.setdefault(str(item_id), {"name": str(info.get("name", ""))[:120], "origin": origin, "demand": {}})
            entry["demand"][dest] = ratio
    if len(packs) < 50:
        raise SystemExit(f"only {len(packs)} packs found — refusing to write")
    out = {
        "source": "in-game export (AACMT Pack Export addon, official Addon API)",
        "exportedOn": date.fromtimestamp(os.path.getmtime(path)).isoformat(),
        "answeredRoutes": answered,
        "sellerShare": data.get("sellerShareRatio"),
        "packs": packs,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(packs)} packs from {answered} answered routes")


if __name__ == "__main__":
    main(sys.argv)
