#!/usr/bin/env python3
"""Static security lint for the site (run in CI).

Fails if the web app uses patterns that could let external data run as code or
that would load third-party resources:
  * inline <script> blocks, inline event handlers or inline style attributes in HTML
  * innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function in JS
  * http(s) URLs to hosts other than the allowlisted ones in HTML or JS
  * a Content-Security-Policy that is missing or allows 'unsafe-inline' / 'unsafe-eval'
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "site"
# Deliberately absent: sermeatball.com hosts (the API must not be used, and the price
# sources are credited by name only, never linked) and docs.google.com (the price sheets
# must not be reachable from the site).
ALLOWED_HOSTS = {"aa-classic.com", "wiki.aa-classic.com", "github.com", "www.w3.org"}
JS_BANNED = re.compile(r"\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(")
URL = re.compile(r"https?://([a-zA-Z0-9.-]+)")

problems = []
for path in ROOT.rglob("*"):
    if path.suffix not in {".html", ".js"} or "data" in path.relative_to(ROOT).parts:
        continue
    text = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT.parent)
    for host in URL.findall(text):
        if host not in ALLOWED_HOSTS:
            problems.append(f"{rel}: link to non-allowlisted host {host}")
    if path.suffix == ".js":
        for m in JS_BANNED.finditer(text):
            problems.append(f"{rel}: banned API {m.group(0)!r}")
    else:
        if re.search(r"<script(?![^>]*\bsrc=)[^>]*>", text):
            problems.append(f"{rel}: inline <script> block")
        if re.search(r"\son[a-z]+\s*=", text):
            problems.append(f"{rel}: inline event handler")
        if re.search(r"\sstyle\s*=", text):
            problems.append(f"{rel}: inline style attribute")
        csp = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', text)
        if not csp:
            problems.append(f"{rel}: missing Content-Security-Policy")
        elif "unsafe-inline" in csp.group(1) or "unsafe-eval" in csp.group(1):
            problems.append(f"{rel}: CSP allows unsafe-inline/unsafe-eval")

if problems:
    print("Security lint failed:\n  " + "\n  ".join(problems))
    sys.exit(1)
print("Security lint passed.")
