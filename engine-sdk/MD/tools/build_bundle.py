#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Bundle the whole docs set into a single gzipped file for the viewer.

Static hosts cap file counts (e.g. Cloudflare Pages Direct Upload = 1000 files),
but the generated API reference alone is ~1600 Markdown files. This packs the
navigation, search index, git-dates, every Markdown page, and the reference
indexes into ONE file:

    _config/docs-bundle.json.gz

The zero-build viewer fetches that single file, gunzips it in-browser with
``DecompressionStream('gzip')``, and serves all pages from memory — so a deploy
ships a handful of files instead of thousands. When the bundle is absent (dev,
serving the raw MD/ tree), the viewer falls back to per-file fetch.

Run after build_docs.py (it consumes the freshly built search index):
    python tools/build_docs.py
    python tools/build_bundle.py

Author: Jake Wehmeier (BTSpaniel) - https://github.com/BTSpaniel
"""
import gzip
import json
from pathlib import Path

MD = Path(__file__).resolve().parents[1]
NAV = MD / "_config" / "nav.json"
SEARCH = MD / "_config" / "search-index.json"
GIT_DATES = MD / "_config" / "git-dates.json"
OUT = MD / "_config" / "docs-bundle.json.gz"

# Folders that hold tooling/assets/build output, not documentation pages.
SKIP_DIRS = {"viewer", "assets", "tools", "_config", "_templates", "_notes", "site"}


def _load_json(path, default):
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def collect_docs():
    docs = {}
    for path in sorted(MD.rglob("*.md")):
        rel = path.relative_to(MD).as_posix()
        if rel.split("/", 1)[0] in SKIP_DIRS:
            continue
        docs[rel] = path.read_text(encoding="utf-8", errors="replace")
    return docs


def collect_ref_indexes(nav):
    """Map each reference group's `auto` dir to its `_index.json` list."""
    out = {}
    for section in nav.get("sections", []):
        for grp in section.get("groups", []):
            auto = grp.get("auto")
            if not auto:
                continue
            idx = MD / auto / "_index.json"
            data = _load_json(idx, None)
            if data is not None:
                out[auto] = data
    return out


def main() -> int:
    if not NAV.exists():
        print("nav.json not found — run from MD/ after build_docs.py", flush=True)
        return 2
    nav = _load_json(NAV, {})
    bundle = {
        "version": 1,
        "nav": nav,
        "search": _load_json(SEARCH, []),
        "gitDates": _load_json(GIT_DATES, {}),
        "refIndex": collect_ref_indexes(nav),
        "docs": collect_docs(),
    }
    raw = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    gz = gzip.compress(raw, compresslevel=9)
    OUT.write_bytes(gz)
    print(f"docs-bundle.json.gz: {len(bundle['docs'])} pages, "
          f"{len(bundle['refIndex'])} reference indexes")
    print(f"  raw:  {len(raw):,} bytes")
    print(f"  gzip: {len(gz):,} bytes ({len(gz) / max(1, len(raw)) * 100:.1f}% of raw)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
