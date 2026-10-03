#!/usr/bin/env python3
"""Download the front-end libraries the zero-build viewer depends on.

Vendors them locally into ``MD/assets/vendor/`` so the docs work fully offline
with no CDN dependency (matching the project's pure-browser, no-Node ethos).

Usage:
    python tools/fetch_vendor.py            # download any missing libs
    python tools/fetch_vendor.py --force    # re-download everything

Author: Jake Wehmeier (BTSpaniel) — https://github.com/BTSpaniel
"""
import argparse
import sys
import urllib.request
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "assets" / "vendor"

# (relative target path, source URL)
ASSETS = [
    ("marked/marked.min.js",
     "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"),
    ("highlight/highlight.min.js",
     "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js"),
    ("highlight/github-dark.min.css",
     "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github-dark.min.css"),
    ("mermaid/mermaid.min.js",
     "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"),
]


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "wgpu-os-docs/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.write_bytes(data)
    print(f"  saved {dest.relative_to(VENDOR.parent.parent)} ({len(data):,} bytes)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    args = ap.parse_args()

    print(f"Vendoring libraries into {VENDOR}")
    failed = 0
    for rel, url in ASSETS:
        dest = VENDOR / rel
        if dest.exists() and not args.force:
            print(f"  skip {rel} (exists)")
            continue
        try:
            print(f"  fetch {url}")
            fetch(url, dest)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED {rel}: {exc}", file=sys.stderr)
            failed += 1

    if failed:
        print(f"\n{failed} asset(s) failed. The viewer still works via its built-in "
              "fallback Markdown renderer, but syntax highlighting / diagrams will be off.")
        return 1
    print("\nAll vendor assets present. Open MD/viewer/ over HTTP to view the docs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
