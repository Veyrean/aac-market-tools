#!/usr/bin/env python3
"""Stamp every CSS/JS reference in the built site with a version, for cache busting.

GitHub Pages lets browsers cache files for 10 minutes. Without this, a visitor right
after a deploy can get the new index.html with an old main.js (or a mix of old and new
modules). Run on the deploy copy only, never on the source tree:

    python3 pipeline/stamp_assets.py site <version>

Rewrites, with ?v=<version>:
  * index.html:  <script src="assets/js/main.js">, <link href="assets/css/app.css">
  * every .js module under assets/js: static `from './x.js'` and dynamic `import('./x.js')`
"""
from __future__ import annotations

import pathlib
import re
import sys

_VERSION = re.compile(r"^[0-9A-Za-z._-]{4,40}$")
_HTML_ASSET = re.compile(r'((?:src|href)=")(assets/[A-Za-z0-9_./-]+\.(?:js|css))(")')
_JS_IMPORT = re.compile(r"""((?:\bfrom\s*|\bimport\s*\(\s*)(['"]))(\.{1,2}/[A-Za-z0-9_./-]+\.js)(\2)""")


def stamp_html(text: str, version: str) -> str:
    return _HTML_ASSET.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(3)}", text)


def stamp_js(text: str, version: str) -> str:
    return _JS_IMPORT.sub(lambda m: f"{m.group(1)}{m.group(3)}?v={version}{m.group(4)}", text)


def main(argv):
    if len(argv) != 3 or not _VERSION.match(argv[2]):
        raise SystemExit(__doc__)
    root, version = pathlib.Path(argv[1]), argv[2]
    index = root / "index.html"
    index.write_text(stamp_html(index.read_text(encoding="utf-8"), version), encoding="utf-8")
    count = 0
    for path in (root / "assets" / "js").rglob("*.js"):
        old = path.read_text(encoding="utf-8")
        new = stamp_js(old, version)
        if new != old:
            path.write_text(new, encoding="utf-8")
            count += 1
    print(f"stamped index.html and {count} modules with v={version}")


if __name__ == "__main__":
    main(sys.argv)
