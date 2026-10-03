#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Generate supplemental AI-discovery files following the llmstxt.org proposal.

Produces portable copies in ``MD/`` and discovery copies at the web root:
  * ``llms.txt``      — a curated, machine-readable index: H1 + summary blockquote
                        + H2 link lists to the key Markdown pages. An ``Optional``
                        section holds skippable/secondary links.
  * ``llms-full.txt`` — the curated (hand-authored) pages concatenated into one
                        file for full-context ingestion. The generated API
                        reference (1600+ pages) is intentionally excluded and
                        linked instead.
  * ``api-index.json`` — one enriched ES-module catalog assembled from all
                         generated subsystem indexes.
  * ``docs-chunks.jsonl`` — bounded, newline-delimited documentation chunks.
  * ``api-symbols.jsonl`` — newline-delimited module and exported-symbol records.
  * ``robots.txt`` and ``sitemap.xml`` — root crawler discovery assets.

Links are written relative to the MD/ root (where these files live). Pass
``--base-url https://example.com/MD/`` to emit absolute URLs for a deployment.

Usage:
    python tools/build_llms.py
    python tools/build_llms.py --base-url https://docs.example.com/

Author: Jake Wehmeier (BTSpaniel) — https://github.com/BTSpaniel
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

MD = Path(__file__).resolve().parents[1]
REPO = MD.parent
NAV = MD / "_config" / "nav.json"
SUBSYSTEMS = ("engine", "editor", "plauna", "agi", "webgpu-os")
DEFAULT_SITE_URL = "https://particlerealms.online"
DOC_CHUNK_MAXIMUM = 1800
DOC_CHUNK_OVERLAP = 160

SITE_SUMMARY = (
    "Unified documentation for the WebGPU OS stack — a GPU-first, browser-resident "
    "operating system composed of five reusable subsystems: the engine (WebGPU "
    "runtime + ECS), the editor (scene/asset IDE), Plauna (hybrid DOM/GPU UI "
    "framework), AGI (reinforcement-learning rig + WebGPU tensors), and webgpu-os "
    "(kernel + shell + packages + apps). This MD/ folder is the single source of "
    "truth; the same Markdown is served by a zero-build HTML viewer, a MkDocs "
    "Material site, and a `docs` app inside the OS."
)

SITE_NOTES = [
    "Discovery status: `llms.txt` is a supplemental, emerging convention. The "
    "canonical evidence remains the linked Markdown, generated API catalogs, "
    "and repository source.",
    "Source of truth: the `MD/` folder. Generated API reference lives under "
    "`<subsystem>/reference/**` (produced by `tools/extract_api.py`).",
    "Agents: read `AGENTS.md` before editing — it defines boundaries (e.g. never "
    "edit generated content above the `<!-- HUMAN-NOTES -->` marker).",
    "Naming note: older material may call the project \"Particle Engine\"; the "
    "current umbrella is the WebGPU OS stack.",
    "Machine API catalog: `api-index.json` lists source paths, browser import "
    "specifiers, source hashes, detected exports, signatures, and summaries. "
    "Its import paths target source mode served from the repository root; the "
    "compact production site loads compiled bundles and may not expose raw modules.",
    "Streaming discovery: `docs-chunks.jsonl` provides bounded documentation "
    "chunks and `api-symbols.jsonl` provides one module or exported symbol per "
    "line for incremental indexing without loading the full catalogs.",
    "Platform downloads: https://github.com/BTSpaniel/particlerealms.engine "
    "publishes browser-ready distribution artifacts, including compressed `.gz` bundles; "
    "it is not the source tree used to generate the API catalog.",
    "Optional master server source: https://github.com/BTSpaniel/particlerealms.engine-master-server "
    "implements the separate discovery, admission, encrypted-signaling, TURN, and "
    "trusted-node service. It is never gameplay authority.",
]


def strip_frontmatter(text: str):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            nl = text.find("\n", end + 1)
            return text[nl + 1:] if nl != -1 else ""
    return text


def first_paragraph(text: str) -> str:
    """First real prose paragraph after the H1 — used as a link description."""
    text = strip_frontmatter(text)
    lines = text.splitlines()
    seen_h1 = False
    buf = []
    for ln in lines:
        s = ln.strip()
        if not seen_h1:
            if s.startswith("# "):
                seen_h1 = True
            continue
        if not s:
            if buf:
                break
            continue
        if s.startswith(("#", ">", "|", "```", "-", "*", "<")):
            if buf:
                break
            continue
        buf.append(s)
    desc = " ".join(buf)
    desc = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", desc)   # links -> label
    desc = re.sub(r"[`*_]", "", desc)
    desc = re.sub(r"\s+", " ", desc).strip()
    return (desc[:200].rsplit(" ", 1)[0] + "…") if len(desc) > 200 else desc


def title_of(text: str, fallback: str) -> str:
    text = strip_frontmatter(text)
    m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else fallback


def link(base: str, rel: str) -> str:
    return (base.rstrip("/") + "/" + rel) if base else rel


def build_llms_txt(nav: dict, base: str) -> str:
    out = ["# WebGPU OS Documentation", "", f"> {SITE_SUMMARY}", ""]
    for note in SITE_NOTES:
        out.append(note)
        out.append("")

    # These files are colocated with both copies of llms.txt, so relative links
    # resolve correctly at the repository root and inside the portable MD tree.
    out.extend([
        "## Machine-readable indexes",
        "",
        "- [Documentation chunks](docs-chunks.jsonl): Bounded, source-labelled "
        "records for incremental retrieval and embedding.",
        "- [API modules and symbols](api-symbols.jsonl): One source-backed module "
        "or detected export per line.",
        "- [Combined API catalog](api-index.json): Complete module records with "
        "source hashes, imports, signatures, and summary coverage.",
        "- [XML sitemap](sitemap.xml): Canonical public routes for crawlers.",
        "",
    ])

    optional_titles = {"Contributing"}
    primary, optional = [], []
    for section in nav.get("sections", []):
        target = optional if section["title"] in optional_titles else primary
        block = ["## " + section["title"], ""]
        for item in section.get("items", []):
            p = MD / item["path"]
            desc = first_paragraph(p.read_text(encoding="utf-8", errors="replace")) if p.exists() else ""
            line = f"- [{item['title']}]({link(base, item['path'])})"
            if desc:
                line += f": {desc}"
            block.append(line)
        for grp in section.get("groups", []):
            idx = MD / grp["auto"] / "_index.json"
            n = len(json.loads(idx.read_text(encoding="utf-8"))) if idx.exists() else 0
            block.append(
                f"- [{section['title']} {grp['title']} ({n} pages)]"
                f"({link(base, grp['auto'] + '/_index.json')}): "
                f"Machine-readable index of the generated per-symbol API reference."
            )
        block.append("")
        target.extend(block)

    out.extend(primary)
    if optional:
        out.append("## Optional")
        out.append("")
        out.append("Secondary material — safe to skip when a shorter context is needed.")
        out.append("")
        # flatten optional section link lines (drop their H2s)
        for line in optional:
            if not line.startswith("## ") and line.strip():
                out.append(line)
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def build_llms_full(nav: dict) -> str:
    parts = [
        "# WebGPU OS Documentation — Full Context",
        "",
        f"> {SITE_SUMMARY}",
        "",
        "This file concatenates the curated, hand-authored pages for full-context "
        "ingestion. The generated per-symbol API reference is excluded for size; "
        "see the `reference/_index.json` files for that.",
        "",
    ]
    seen = set()
    for section in nav.get("sections", []):
        for item in section.get("items", []):
            rel = item["path"]
            if rel in seen:
                continue
            seen.add(rel)
            p = MD / rel
            if not p.exists():
                continue
            body = strip_frontmatter(p.read_text(encoding="utf-8", errors="replace")).strip()
            parts.append("\n\n---\n")
            parts.append(f"<!-- source: MD/{rel} -->\n")
            parts.append(body)
            parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def reference_indexes() -> list:
    """Load every generated subsystem index without changing its records."""
    modules = []
    for subsystem in SUBSYSTEMS:
        index_path = MD / subsystem / "reference" / "_index.json"
        if not index_path.exists():
            continue
        records = json.loads(index_path.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise ValueError(f"{index_path} must contain a JSON array")
        for record in records:
            item = dict(record)
            item["subsystem"] = subsystem
            modules.append(item)
    modules.sort(key=lambda item: (item["subsystem"], item.get("title", "")))
    return modules


def build_api_catalog() -> dict:
    """Build one discovery document spanning every generated API index."""
    modules = reference_indexes()
    exports_total = sum(len(module.get("exports", [])) for module in modules)
    modules_with_summary = sum(bool(module.get("summary")) for module in modules)
    exports_with_summary = sum(
        bool(export.get("summary"))
        for module in modules
        for export in module.get("exports", [])
    )

    def coverage(documented: int, total: int) -> dict:
        return {
            "documented": documented,
            "total": total,
            "percent": round(documented / total * 100, 1) if total else 0.0,
        }

    return {
        "schemaVersion": 1,
        "kind": "webgpu-os-es-module-catalog",
        "description": (
            "Machine-readable ES-module catalog generated from repository source. "
            "Use each sourceHash to detect drift before relying on a signature. "
            "Empty summaries mean the source has no extractable JSDoc; they are "
            "reported by summaryCoverage and are never filled with invented prose."
        ),
        "runtimeLoading": {
            "sourceMode": (
                "Serve the repository root over HTTP with start_server.py, then use "
                "each module's absolute import path."
            ),
            "compiledMode": (
                "The compact production site loads generated bundles; raw source "
                "module URLs are not guaranteed to be deployed."
            ),
        },
        "repositories": {
            "platformDistribution": {
                "url": "https://github.com/BTSpaniel/particlerealms.engine",
                "role": "Public browser-ready platform downloads, including compressed .gz bundles.",
                "sourceOfApiTruth": False,
            },
            "masterServer": {
                "url": "https://github.com/BTSpaniel/particlerealms.engine-master-server",
                "role": (
                    "Separate discovery, admission, encrypted-signaling, TURN, and "
                    "trusted-node service source."
                ),
                "gameplayAuthority": False,
            },
        },
        "summaryCoverage": {
            "modules": coverage(modules_with_summary, len(modules)),
            "exports": coverage(exports_with_summary, exports_total),
        },
        "modules": modules,
    }


def chunk_text(
        text: str,
        maximum: int = DOC_CHUNK_MAXIMUM,
        overlap: int = DOC_CHUNK_OVERLAP) -> list[str]:
    """Split normalized prose at word boundaries with deterministic overlap."""
    if maximum < 1:
        raise ValueError("maximum must be positive")
    if overlap < 0 or overlap >= maximum:
        raise ValueError("overlap must be non-negative and smaller than maximum")
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    if not value:
        return []
    chunks = []
    start = 0
    while start < len(value):
        end = min(len(value), start + maximum)
        if end < len(value):
            boundary = value.rfind(" ", start + maximum // 2, end + 1)
            if boundary > start:
                end = boundary
        chunk = value[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(value):
            break
        next_start = max(start + 1, end - overlap)
        space = value.find(" ", next_start, end)
        start = space + 1 if space >= 0 else next_start
    return chunks


def build_docs_chunks() -> list[dict]:
    """Build bounded records from the canonical generated search index."""
    search = json.loads((MD / "_config" / "search-index.json").read_text(encoding="utf-8"))
    records = []
    for document in sorted(search, key=lambda item: item["path"]):
        chunks = chunk_text(document.get("text", ""))
        if not chunks:
            raise ValueError(f"search document has no indexable text: {document['path']}")
        for index, text in enumerate(chunks):
            records.append({
                "schemaVersion": 1,
                "recordType": "documentation-chunk",
                "id": f"{document['path']}::{index:04d}",
                "path": document["path"],
                "title": document.get("title", ""),
                "description": document.get("description", ""),
                "kind": document.get("kind", ""),
                "source": document.get("source", ""),
                "updated": document.get("updated", ""),
                "headings": document.get("headings", []),
                "chunkIndex": index,
                "chunkCount": len(chunks),
                "text": text,
                "contentHash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            })
    return records


def build_api_symbols(api_catalog: dict) -> list[dict]:
    """Flatten the API catalog into independently consumable JSONL records."""
    records = []
    for module in api_catalog["modules"]:
        shared = {
            "schemaVersion": 1,
            "modulePath": module["path"],
            "moduleTitle": module.get("title", ""),
            "source": module["source"],
            "import": module["import"],
            "sourceHash": module["sourceHash"],
            "subsystem": module["subsystem"],
        }
        records.append({
            **shared,
            "recordType": "api-module",
            "id": f"module:{module['source']}",
            "title": module.get("title", ""),
            "summary": module.get("summary", ""),
            "exportCount": len(module.get("exports", [])),
        })
        for index, symbol in enumerate(module.get("exports", [])):
            records.append({
                **shared,
                "recordType": "api-symbol",
                "id": f"symbol:{module['source']}#{index:04d}:{symbol.get('name', '')}",
                "exportIndex": index,
                "name": symbol.get("name", ""),
                "kind": symbol.get("kind", ""),
                "signature": symbol.get("signature", ""),
                "summary": symbol.get("summary", ""),
            })
    return records


def jsonl(records: list[dict]) -> str:
    """Serialize records one compact JSON object per UTF-8 line."""
    identifiers = [record.get("id") for record in records]
    if not records:
        raise ValueError("JSONL discovery feed must not be empty")
    if any(not isinstance(identifier, str) or not identifier for identifier in identifiers):
        raise ValueError("every JSONL discovery record must have a non-empty string id")
    if len(identifiers) != len(set(identifiers)):
        raise ValueError("JSONL discovery record ids must be unique")
    return "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    )


def curated_document_paths(nav: dict) -> list[str]:
    """Return Markdown pages that the release ships as individual files."""
    paths = {"index.md"}
    for section in nav.get("sections", []):
        for item in section.get("items", []):
            paths.add(item["path"])
    return sorted(paths)


def documentation_urls(
        nav: dict, api_catalog: dict, site_url: str, docs_base_url: str) -> list[str]:
    """Return deployed, non-fragment URLs for people and machine consumers."""
    site = site_url.rstrip("/")
    docs = docs_base_url.rstrip("/")
    urls = {
        site + "/",
        site + "/guide/",
        site + "/api/",
        site + "/learn/",
        site + "/learn/starter/",
        site + "/playground/",
        site + "/webgpu-os/",
        site + "/llms.txt",
        site + "/llms-full.txt",
        site + "/api-index.json",
        site + "/docs-chunks.jsonl",
        site + "/api-symbols.jsonl",
    }
    for path in curated_document_paths(nav):
        urls.add(docs + "/" + quote(path, safe="/"))
    for subsystem in SUBSYSTEMS:
        urls.add(docs + f"/{subsystem}/reference/_index.json")
    # Generated references stay inside the compressed docs bundle to respect
    # static-host file caps. Their stable canonical route is the viewer query,
    # not a raw Markdown URL that production does not ship.
    viewer = docs + "/viewer/?doc="
    for module in api_catalog["modules"]:
        urls.add(viewer + quote(module["path"], safe="/"))
    return sorted(urls)


def build_sitemap(
        nav: dict, api_catalog: dict, site_url: str, docs_base_url: str) -> str:
    """Emit a standards-compliant sitemap containing only deployed URLs."""
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for url in documentation_urls(nav, api_catalog, site_url, docs_base_url):
        lines.extend([
            "  <url>",
            f"    <loc>{escape(url)}</loc>",
            "  </url>",
        ])
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def root_robots(site_url: str) -> str:
    """Use an absolute sitemap URL while keeping the checked-in policy text."""
    source = (MD / "robots.txt").read_text(encoding="utf-8")
    sitemap = site_url.rstrip("/") + "/sitemap.xml"
    return re.sub(r"(?m)^Sitemap:\s*.*$", f"Sitemap: {sitemap}", source)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--base-url",
        default="",
        help="absolute URL of the deployed MD/ docs root; MD files stay relative when omitted",
    )
    ap.add_argument(
        "--site-url",
        default=DEFAULT_SITE_URL,
        help=(
            "site origin used by sitemap.xml and the root robots.txt "
            f"(default: {DEFAULT_SITE_URL})"
        ),
    )
    args = ap.parse_args()

    nav = json.loads(NAV.read_text(encoding="utf-8"))
    md_llms = build_llms_txt(nav, args.base_url)
    full = build_llms_full(nav)
    (MD / "llms.txt").write_text(md_llms, encoding="utf-8")
    (MD / "llms-full.txt").write_text(full, encoding="utf-8")

    # Discovery happens at the web root. Keep MD/ portable for its three
    # viewers, but write root variants whose relative links resolve into MD/.
    root_link_base = args.base_url or "MD"
    (REPO / "llms.txt").write_text(
        build_llms_txt(nav, root_link_base), encoding="utf-8"
    )
    (REPO / "llms-full.txt").write_text(full, encoding="utf-8")

    api_catalog = build_api_catalog()
    api_json = json.dumps(api_catalog, ensure_ascii=False, indent=2) + "\n"
    (MD / "api-index.json").write_text(api_json, encoding="utf-8")
    (REPO / "api-index.json").write_text(api_json, encoding="utf-8")

    docs_chunks = build_docs_chunks()
    docs_jsonl = jsonl(docs_chunks)
    (MD / "docs-chunks.jsonl").write_text(docs_jsonl, encoding="utf-8")
    (REPO / "docs-chunks.jsonl").write_text(docs_jsonl, encoding="utf-8")

    api_symbols = build_api_symbols(api_catalog)
    api_jsonl = jsonl(api_symbols)
    (MD / "api-symbols.jsonl").write_text(api_jsonl, encoding="utf-8")
    (REPO / "api-symbols.jsonl").write_text(api_jsonl, encoding="utf-8")

    docs_base_url = args.base_url or (args.site_url.rstrip("/") + "/MD")
    sitemap = build_sitemap(nav, api_catalog, args.site_url, docs_base_url)
    (MD / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    (REPO / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    (REPO / "robots.txt").write_text(root_robots(args.site_url), encoding="utf-8")

    txt = (MD / "llms.txt").stat().st_size
    full = (MD / "llms-full.txt").stat().st_size
    print(f"llms.txt:      {txt:,} bytes")
    print(f"llms-full.txt: {full:,} bytes")
    coverage = api_catalog["summaryCoverage"]
    print(f"api-index.json: {len(api_catalog['modules']):,} modules")
    print(
        f"docs-chunks.jsonl: {len(docs_chunks):,} chunks, "
        f"{(MD / 'docs-chunks.jsonl').stat().st_size:,} bytes"
    )
    print(
        f"api-symbols.jsonl: {len(api_symbols):,} records, "
        f"{(MD / 'api-symbols.jsonl').stat().st_size:,} bytes"
    )
    print(
        "summary coverage: "
        f"{coverage['modules']['documented']:,}/{coverage['modules']['total']:,} modules "
        f"({coverage['modules']['percent']:.1f}%), "
        f"{coverage['exports']['documented']:,}/{coverage['exports']['total']:,} exports "
        f"({coverage['exports']['percent']:.1f}%)"
    )
    print(
        f"sitemap.xml:    "
        f"{len(documentation_urls(nav, api_catalog, args.site_url, docs_base_url)):,} URLs"
    )
    print("Root discovery assets refreshed: llms*.txt, api-index.json, *.jsonl, robots.txt, sitemap.xml")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
