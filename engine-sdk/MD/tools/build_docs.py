#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Build derived artifacts for the docs viewers.

Produces:
  * ``_config/search-index.json`` — full-text search index for the zero-build viewer.
  * validates that every ``path`` in ``_config/nav.json`` resolves to a real file.

Run after editing or generating Markdown:
    python tools/build_docs.py

Author: Jake Wehmeier (BTSpaniel) — https://github.com/BTSpaniel
"""
import json
import re
import subprocess
import sys
from pathlib import Path

MD = Path(__file__).resolve().parents[1]
REPO = MD.parent
NAV = MD / "_config" / "nav.json"
SEARCH = MD / "_config" / "search-index.json"
GIT_DATES = MD / "_config" / "git-dates.json"

SKIP_DIRS = {"viewer", "assets", "tools", "_config", "_templates", "_notes"}


def parse_frontmatter(text: str):
    """Return (meta_dict, body) splitting a leading YAML frontmatter block."""
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.DOTALL)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        i = line.find(":")
        if i > 0:
            k = line[:i].strip()
            v = line[i + 1:].strip().strip("\"'")
            if k:
                meta[k] = v
    return meta, text[m.end():]


def first_h1(text: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else fallback


def strip_markdown(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)      # code fences
    text = re.sub(r"`[^`]*`", " ", text)                          # inline code
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)             # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)          # links -> label
    text = re.sub(r"[#>*_~|-]", " ", text)                        # md punctuation
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def headings(text: str) -> list:
    """Return plain H1-H3 labels as lightweight retrieval structure."""
    out = []
    for match in re.finditer(r"^#{1,3}\s+(.+)$", text, re.MULTILINE):
        label = re.sub(r"[`*_]", "", match.group(1)).strip()
        if label:
            out.append(label)
    return out


def build_search_index() -> int:
    docs = []
    for path in sorted(MD.rglob("*.md")):
        rel_parts = path.relative_to(MD).parts
        if rel_parts[0] in SKIP_DIRS:
            continue
        rel = path.relative_to(MD).as_posix()
        raw = path.read_text(encoding="utf-8", errors="replace")
        meta, body = parse_frontmatter(raw)
        title = meta.get("title") or first_h1(body, rel)
        desc = meta.get("description", "")
        text = (desc + " " + strip_markdown(body)) if desc else strip_markdown(body)
        docs.append({
            "id": rel,
            "title": title,
            "path": rel,
            "description": desc,
            "kind": meta.get("kind", "guide"),
            "source": meta.get("source", f"MD/{rel}"),
            "updated": meta.get("updated", ""),
            "headings": headings(body),
            "text": text[:4000],
        })
    SEARCH.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"search-index.json: {len(docs)} documents indexed")
    return len(docs)


def build_git_dates() -> int:
    """Map each MD/*.md page to the date of its most recent git commit.

    Written to ``_config/git-dates.json`` ({rel_path: 'YYYY-MM-DD'}). The viewer
    uses this as a fallback "last updated" when a page has no ``updated``
    frontmatter. Degrades gracefully if git is unavailable or the tree is not a
    repository (writes an empty map).
    """
    dates: dict = {}
    try:
        proc = subprocess.run(
            ["git", "log", "--format=%cI", "--name-only", "--", "MD"],
            cwd=REPO, capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
    except (OSError, FileNotFoundError):
        GIT_DATES.write_text("{}", encoding="utf-8")
        print("git-dates.json: git not available; wrote empty map")
        return 0
    if proc.returncode != 0:
        GIT_DATES.write_text("{}", encoding="utf-8")
        print("git-dates.json: no git history; wrote empty map")
        return 0

    cur = None
    for line in proc.stdout.splitlines():
        line = line.strip().strip('"')
        if not line:
            continue
        if re.match(r"^\d{4}-\d{2}-\d{2}T", line):   # commit date line (%cI)
            cur = line[:10]
        elif line.startswith("MD/") and line.endswith(".md") and cur:
            rel = line[len("MD/"):]
            dates.setdefault(rel, cur)               # newest-first: first wins
    GIT_DATES.write_text(json.dumps(dates, ensure_ascii=False), encoding="utf-8")
    print(f"git-dates.json: {len(dates)} pages dated from git history")
    return len(dates)


def validate_nav() -> int:
    nav = json.loads(NAV.read_text(encoding="utf-8"))
    missing = []
    for section in nav.get("sections", []):
        for item in section.get("items", []):
            p = MD / item["path"]
            if not p.exists():
                missing.append(item["path"])
    if missing:
        print(f"\nWARNING: {len(missing)} nav path(s) missing:")
        for m in missing:
            print(f"  - {m}")
    else:
        print("nav.json: all curated paths resolve")
    return len(missing)


def main() -> int:
    if not NAV.exists():
        print("nav.json not found", file=sys.stderr)
        return 2
    build_search_index()
    build_git_dates()
    missing = validate_nav()
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
