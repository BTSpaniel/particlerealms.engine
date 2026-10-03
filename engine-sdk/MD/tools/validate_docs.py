#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Validate documentation truth, discovery, and public-wrapper contracts.

Run after ``extract_api.py``, ``build_docs.py``, and ``build_llms.py``. The
checks use only the Python standard library and fail closed with actionable
paths instead of allowing stale or invented API guidance into generated output.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from extract_api import SUBSYSTEMS, export_descriptors, parse_file


MD = Path(__file__).resolve().parents[1]
REPO = MD.parent
SHARED_NOTES = MD / "_notes" / "_shared.json"
ROOT_DISCOVERY = (
    "llms.txt",
    "llms-full.txt",
    "api-index.json",
    "docs-chunks.jsonl",
    "api-symbols.jsonl",
    "robots.txt",
    "sitemap.xml",
)
JSONL_MAX_BYTES = 25 * 1024 * 1024
DOC_CHUNK_MAXIMUM = 1800
CURATED_SKIP_PARTS = {
    "_notes",
    "_templates",
    "archive",
    "reference",
    "site",
    "tools",
    "viewer",
}


class Validation:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.checks = 0

    def require(self, condition: bool, message: str) -> None:
        self.checks += 1
        if not condition:
            self.errors.append(message)


def check_curated_ports(result: Validation) -> None:
    stale = []
    for path in sorted(MD.rglob("*.md")):
        rel = path.relative_to(MD)
        if any(part in CURATED_SKIP_PARTS for part in rel.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"(?:localhost|127\.0\.0\.1):8000\b|\bport\s+8000\b", text, re.I):
            stale.append(rel.as_posix())
    result.require(not stale, "stale port 8000 in curated docs: " + ", ".join(stale))


def named_imports(markdown: str) -> list[tuple[list[str], str]]:
    imports = []
    pattern = re.compile(
        r"import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]\s*;?"
    )
    for match in pattern.finditer(markdown):
        names = []
        for raw in match.group(1).split(","):
            original = raw.strip().split(" as ", 1)[0].strip()
            if original:
                names.append(original)
        imports.append((names, match.group(2)))
    return imports


def check_gpu_shared_note(result: Validation) -> None:
    data = json.loads(SHARED_NOTES.read_text(encoding="utf-8"))
    block = next((item for item in data.get("blocks", []) if item.get("id") == "gpu-device-sharing"), None)
    result.require(block is not None, "missing gpu-device-sharing block")
    if not block:
        return
    body = block.get("body", "")
    forbidden = (
        "GpuDevice.acquire",
        "GpuDevice.recreate",
        "GpuDevice.queryFeatures",
        "new Renderer(device);",
        "new ComputeSystem(device);",
        "never call `navigator.gpu.requestDevice()` yourself, since a second device causes context loss",
    )
    for symbol in forbidden:
        result.require(symbol not in body, f"gpu-device-sharing uses nonexistent symbol: {symbol}")
    for required in ("getGpuDevice", "getDevice", "getQueue", "getCapabilities", "onDeviceLost"):
        result.require(required in body, f"gpu-device-sharing omits verified API: {required}")

    gpu_surfaces = [MD / "_notes"] + [MD / name / "reference" for name in SUBSYSTEMS]
    for symbol in forbidden:
        offenders = []
        for root in gpu_surfaces:
            if not root.exists():
                continue
            for path in root.rglob("*.md"):
                if symbol in path.read_text(encoding="utf-8", errors="replace"):
                    offenders.append(path.relative_to(MD).as_posix())
                    if len(offenders) == 5:
                        break
            if len(offenders) == 5:
                break
        result.require(
            not offenders,
            f"obsolete GPU guidance remains in generated/overlay docs ({symbol}): {', '.join(offenders)}",
        )

    for names, specifier in named_imports(body):
        source = REPO / specifier.lstrip("/")
        result.require(source.is_file(), f"gpu-device-sharing import does not resolve: {specifier}")
        if not source.is_file():
            continue
        info = parse_file(source.read_text(encoding="utf-8", errors="replace"))
        actual = {item["name"] for item in export_descriptors(info)}
        missing = sorted(set(names) - actual)
        result.require(
            not missing,
            f"gpu-device-sharing imports missing export(s) from {specifier}: {', '.join(missing)}",
        )


def check_api_indexes(result: Validation) -> int:
    total = 0
    required = {
        "schemaVersion",
        "title",
        "path",
        "source",
        "import",
        "sourceHash",
        "summary",
        "exports",
    }
    for subsystem in SUBSYSTEMS:
        index_path = MD / subsystem / "reference" / "_index.json"
        result.require(index_path.is_file(), f"missing API index: {index_path.relative_to(REPO)}")
        if not index_path.is_file():
            continue
        records = json.loads(index_path.read_text(encoding="utf-8"))
        result.require(isinstance(records, list), f"API index is not an array: {index_path.relative_to(REPO)}")
        if not isinstance(records, list):
            continue
        total += len(records)
        for record in records:
            label = f"{subsystem}:{record.get('title', '<untitled>')}"
            result.require(required.issubset(record), f"{label} lacks enriched API index fields")
            source_rel = record.get("source", "")
            source = REPO / source_rel
            result.require(source.is_file(), f"{label} source does not exist: {source_rel}")
            generated_page = MD / record.get("path", "")
            result.require(generated_page.is_file(), f"{label} generated reference page is missing")
            if generated_page.is_file():
                generated_text = generated_page.read_text(encoding="utf-8", errors="replace")
                result.require(
                    "TODO: describe." not in generated_text,
                    f"{label} exposes a TODO placeholder instead of a source-coverage gap",
                )
            if not source.is_file():
                continue
            source_text = source.read_text(encoding="utf-8", errors="replace")
            result.require(record.get("schemaVersion") == 1, f"{label} has unsupported schemaVersion")
            result.require(record.get("import") == f"/{source_rel}", f"{label} import path drifted")
            result.require(
                record.get("sourceHash") == hashlib.sha256(source_text.encode("utf-8")).hexdigest(),
                f"{label} sourceHash is stale; run extract_api.py",
            )
            expected_exports = export_descriptors(parse_file(source_text))
            result.require(
                record.get("exports") == expected_exports,
                f"{label} export catalog is stale; run extract_api.py",
            )
            invalid_names = [
                item.get("name", "")
                for item in record.get("exports", [])
                if not re.fullmatch(r"[A-Za-z_$][\w$]*", item.get("name", ""))
            ]
            result.require(
                not invalid_names,
                f"{label} has invalid/comment-contaminated export name(s): {invalid_names[:3]}",
            )
            result.require(isinstance(record.get("summary"), str), f"{label} summary must be a string")
    result.require(total > 0, "API catalogs contain no modules")
    return total


def check_root_discovery(result: Validation, expected_modules: int) -> None:
    nav = json.loads((MD / "_config" / "nav.json").read_text(encoding="utf-8"))
    result.require(
        nav.get("site", {}).get("repo") == "https://github.com/BTSpaniel/particlerealms.engine",
        "nav.json must use the verified public platform-download URL",
    )
    result.require(
        nav.get("site", {}).get("repoRole") == "platform-downloads",
        "nav.json must identify particlerealms.engine as platform downloads, not source truth",
    )
    for name in ROOT_DISCOVERY:
        path = REPO / name
        result.require(path.is_file() and path.stat().st_size > 0, f"missing root discovery asset: /{name}")

    for name in (
            "llms-full.txt", "api-index.json", "docs-chunks.jsonl",
            "api-symbols.jsonl", "sitemap.xml"):
        root_path = REPO / name
        md_path = MD / name
        if root_path.is_file() and md_path.is_file():
            result.require(root_path.read_bytes() == md_path.read_bytes(), f"root /{name} drifted from MD/{name}")

    root_llms = REPO / "llms.txt"
    if root_llms.is_file():
        text = root_llms.read_text(encoding="utf-8", errors="replace")
        result.require("MD/getting-started/" in text or "http" in text, "root llms.txt links do not resolve into MD/")
        result.require("api-index.json" in text, "root llms.txt omits the machine API catalog")
        result.require(
            "[Documentation chunks](docs-chunks.jsonl)" in text,
            "root llms.txt omits the linked documentation-chunk feed",
        )
        result.require(
            "[API modules and symbols](api-symbols.jsonl)" in text,
            "root llms.txt omits the linked API-symbol feed",
        )
        result.require(
            "https://github.com/BTSpaniel/particlerealms.engine" in text,
            "root llms.txt omits the public platform-download repository",
        )
        result.require(
            "https://github.com/BTSpaniel/particlerealms.engine-master-server" in text,
            "root llms.txt omits the separate master-server source repository",
        )

    api_path = REPO / "api-index.json"
    if api_path.is_file():
        catalog = json.loads(api_path.read_text(encoding="utf-8"))
        result.require(catalog.get("schemaVersion") == 1, "root api-index.json schemaVersion is missing")
        result.require(len(catalog.get("modules", [])) == expected_modules, "root API catalog module count drifted")
        runtime = catalog.get("runtimeLoading", {})
        result.require("start_server.py" in runtime.get("sourceMode", ""), "API catalog omits source-mode loading context")
        result.require("bundles" in runtime.get("compiledMode", ""), "API catalog omits compiled-mode loading context")
        repositories = catalog.get("repositories", {})
        platform = repositories.get("platformDistribution", {})
        master = repositories.get("masterServer", {})
        result.require(
            platform.get("url") == "https://github.com/BTSpaniel/particlerealms.engine",
            "API catalog omits the platform-download repository",
        )
        result.require(
            platform.get("sourceOfApiTruth") is False,
            "API catalog must not present the public distribution repository as API source truth",
        )
        result.require(
            master.get("url") == "https://github.com/BTSpaniel/particlerealms.engine-master-server",
            "API catalog omits the separate master-server source repository",
        )
        result.require(
            master.get("gameplayAuthority") is False,
            "API catalog must state that the master server is not gameplay authority",
        )
        coverage = catalog.get("summaryCoverage", {})
        module_coverage = coverage.get("modules", {})
        export_coverage = coverage.get("exports", {})
        exports = [
            item
            for module in catalog.get("modules", [])
            for item in module.get("exports", [])
        ]
        result.require(
            module_coverage.get("total") == expected_modules,
            "root API catalog module summary coverage total drifted",
        )
        result.require(
            module_coverage.get("documented") == sum(
                bool(module.get("summary")) for module in catalog.get("modules", [])
            ),
            "root API catalog module summary coverage count drifted",
        )
        result.require(
            export_coverage.get("total") == len(exports),
            "root API catalog export summary coverage total drifted",
        )
        result.require(
            export_coverage.get("documented") == sum(bool(item.get("summary")) for item in exports),
            "root API catalog export summary coverage count drifted",
        )

    sitemap_path = REPO / "sitemap.xml"
    if sitemap_path.is_file():
        try:
            root = ET.fromstring(sitemap_path.read_text(encoding="utf-8"))
            url_nodes = root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url")
            locations = [
                (node.findtext("{http://www.sitemaps.org/schemas/sitemap/0.9}loc") or "")
                for node in url_nodes
            ]
            result.require(
                all(
                    urlsplit(location).scheme == "https"
                    and urlsplit(location).netloc == "particlerealms.online"
                    for location in locations
                ),
                "sitemap contains a non-canonical or non-HTTPS deployment origin",
            )
            reference_queries = []
            raw_reference_pages = []
            deployed_paths = set()
            for location in locations:
                parsed = urlsplit(location)
                deployed_paths.add(parsed.path)
                if "/reference/" in parsed.path and parsed.path.endswith(".md"):
                    raw_reference_pages.append(location)
                doc = parse_qs(parsed.query).get("doc", [])
                if parsed.path.endswith("/MD/viewer/") and doc and "/reference/" in doc[0]:
                    reference_queries.append(doc[0])
            result.require(
                len(reference_queries) == expected_modules,
                "sitemap must expose every bundled API reference through /MD/viewer/?doc=...",
            )
            result.require(
                not raw_reference_pages,
                "sitemap advertises generated raw Markdown that release does not ship",
            )
            for deployed in (
                    "/", "/guide/", "/api/", "/learn/", "/learn/starter/",
                    "/playground/", "/webgpu-os/", "/docs-chunks.jsonl",
                    "/api-symbols.jsonl"):
                result.require(deployed in deployed_paths, f"sitemap omits deployed route: {deployed}")
        except ET.ParseError as exc:
            result.require(False, f"sitemap.xml is not valid XML: {exc}")

    robots_path = REPO / "robots.txt"
    if robots_path.is_file():
        robots = robots_path.read_text(encoding="utf-8", errors="replace")
        for deployed in (
                "/guide/", "/api/", "/learn/", "/learn/starter/",
                "/playground/", "/webgpu-os/"):
            result.require(f"Allow: {deployed}" in robots, f"robots.txt omits deployed route: {deployed}")
        for feed in ("/docs-chunks.jsonl", "/api-symbols.jsonl"):
            result.require(f"Allow: {feed}" in robots, f"robots.txt omits JSONL feed: {feed}")
        result.require(
            "Sitemap: https://particlerealms.online/sitemap.xml" in robots,
            "root robots.txt does not advertise the canonical HTTPS sitemap",
        )
        result.require("Allow: /tests/" not in robots, "robots.txt exposes development-only /tests routes")


def read_jsonl(result: Validation, path: Path, label: str) -> list[dict]:
    """Parse one UTF-8 JSONL feed while retaining actionable line errors."""
    if not path.is_file():
        result.require(False, f"missing {label}: {path.relative_to(REPO).as_posix()}")
        return []
    raw = path.read_bytes()
    result.require(bool(raw), f"{label} is empty")
    result.require(len(raw) <= JSONL_MAX_BYTES, f"{label} exceeds the 25 MiB discovery-feed limit")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        result.require(False, f"{label} is not valid UTF-8: {exc}")
        return []
    result.require(text.endswith("\n"), f"{label} must end with a newline")
    records = []
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            result.require(False, f"{label}:{line_number} is blank")
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            result.require(False, f"{label}:{line_number} is invalid JSON: {exc}")
            continue
        if not isinstance(record, dict):
            result.require(False, f"{label}:{line_number} is not a JSON object")
            continue
        records.append(record)
    result.require(bool(records), f"{label} contains no records")
    identifiers = [record.get("id") for record in records]
    result.require(
        all(isinstance(identifier, str) and identifier for identifier in identifiers),
        f"{label} contains an empty or non-string record id",
    )
    result.require(len(identifiers) == len(set(identifiers)), f"{label} contains duplicate record ids")
    return records


def check_jsonl_discovery(result: Validation, expected_modules: int) -> None:
    """Prove both JSONL feeds match their canonical generated inputs."""
    docs_records = read_jsonl(result, REPO / "docs-chunks.jsonl", "docs-chunks.jsonl")
    search = json.loads((MD / "_config" / "search-index.json").read_text(encoding="utf-8"))
    documents = {document["path"]: document for document in search}
    result.require(len(documents) == len(search), "search-index.json contains duplicate document paths")
    grouped: dict[str, list[dict]] = {}
    for record in docs_records:
        path = record.get("path")
        grouped.setdefault(path, []).append(record)
        result.require(record.get("schemaVersion") == 1, f"docs JSONL record has invalid schema: {record.get('id')}")
        result.require(
            record.get("recordType") == "documentation-chunk",
            f"docs JSONL record has invalid type: {record.get('id')}",
        )
        document = documents.get(path)
        result.require(document is not None, f"docs JSONL record has unknown path: {path}")
        text = record.get("text")
        result.require(
            isinstance(text, str) and 0 < len(text) <= DOC_CHUNK_MAXIMUM,
            f"docs JSONL record has invalid chunk length: {record.get('id')}",
        )
        if isinstance(text, str):
            result.require("\n" not in text and "\r" not in text, f"docs JSONL chunk is not normalized: {record.get('id')}")
            result.require(
                record.get("contentHash") == hashlib.sha256(text.encode("utf-8")).hexdigest(),
                f"docs JSONL content hash drifted: {record.get('id')}",
            )
        index = record.get("chunkIndex")
        if isinstance(path, str) and isinstance(index, int):
            result.require(record.get("id") == f"{path}::{index:04d}", f"docs JSONL id drifted: {record.get('id')}")
        else:
            result.require(False, f"docs JSONL record has invalid path/index: {record.get('id')}")
        if document:
            for key in ("title", "description", "kind", "source", "updated", "headings"):
                result.require(
                    record.get(key) == document.get(key, "" if key != "headings" else []),
                    f"docs JSONL metadata drifted for {path}: {key}",
                )
    result.require(set(grouped) == set(documents), "docs JSONL path coverage drifted from search-index.json")
    for path, records in grouped.items():
        indices = sorted(record.get("chunkIndex") for record in records if isinstance(record.get("chunkIndex"), int))
        result.require(indices == list(range(len(records))), f"docs JSONL chunk indexes are not contiguous: {path}")
        result.require(
            all(record.get("chunkCount") == len(records) for record in records),
            f"docs JSONL chunkCount drifted: {path}",
        )

    catalog = json.loads((REPO / "api-index.json").read_text(encoding="utf-8"))
    api_records = read_jsonl(result, REPO / "api-symbols.jsonl", "api-symbols.jsonl")
    exports_total = sum(len(module.get("exports", [])) for module in catalog.get("modules", []))
    result.require(
        len(api_records) == expected_modules + exports_total,
        "api-symbols.jsonl record count drifted from api-index.json",
    )
    for record in api_records:
        identifier = record.get("id")
        result.require(record.get("schemaVersion") == 1, f"API JSONL record has invalid schema: {identifier}")
        result.require(
            record.get("recordType") in {"api-module", "api-symbol"},
            f"API JSONL record has invalid type: {identifier}",
        )
        result.require(
            isinstance(record.get("modulePath"), str) and record["modulePath"].endswith(".md"),
            f"API JSONL record has invalid module path: {identifier}",
        )
        result.require(
            isinstance(record.get("sourceHash"), str)
            and bool(re.fullmatch(r"[0-9a-f]{64}", record["sourceHash"])),
            f"API JSONL record has invalid source hash: {identifier}",
        )
        source = record.get("source")
        result.require(
            isinstance(source, str) and (REPO / source).is_file(),
            f"API JSONL record points to missing source: {identifier}",
        )
        if record.get("recordType") == "api-module":
            result.require(
                isinstance(record.get("exportCount"), int) and record["exportCount"] >= 0,
                f"API module record has invalid export count: {identifier}",
            )
        else:
            result.require(
                isinstance(record.get("exportIndex"), int) and record["exportIndex"] >= 0,
                f"API symbol record has invalid export index: {identifier}",
            )
            result.require(
                bool(re.fullmatch(r"[A-Za-z_$][\w$]*", str(record.get("name", "")))),
                f"API symbol record has invalid name: {identifier}",
            )

    # Exact deterministic comparisons catch stale but internally self-consistent
    # feeds while the checks above keep failures explainable to maintainers.
    from build_llms import build_api_symbols, build_docs_chunks
    result.require(docs_records == build_docs_chunks(), "docs-chunks.jsonl is stale; run build_llms.py")
    result.require(api_records == build_api_symbols(catalog), "api-symbols.jsonl is stale; run build_llms.py")


def check_public_wrappers(result: Validation) -> None:
    expected = {
        "tests/guide/index.html": {
            "type": "TechArticle",
            "default": "index.md",
            "canonical": "https://particlerealms.online/guide/",
            "workspace": "docs-workspace",
        },
        "tests/api/index.html": {
            "type": "APIReference",
            "default": "api/index.md",
            "canonical": "https://particlerealms.online/api/",
            "workspace": "api-workspace",
        },
    }
    required_ids = {
        "canonical-link", "markdown-alternate", "page-structured-data",
        "sidebar-toggle", "search-input", "search-results", "version-badge",
        "read-progress", "sidebar", "nav-filter", "nav-collapse-all", "nav-tree",
        "breadcrumbs", "doc-content", "prev-link", "next-link", "source-path",
        "toc", "toc-list", "nav-backdrop", "back-to-top",
    }
    for rel, contract in expected.items():
        path = REPO / rel
        result.require(path.is_file(), f"missing public docs wrapper: {rel}")
        if not path.is_file():
            continue
        html = path.read_text(encoding="utf-8", errors="replace")
        result.require(
            not re.search(r"<\s*(?:iframe|object|embed)\b", html, re.I),
            f"{rel} must mount documentation directly without frame/embed elements",
        )
        ids = re.findall(r"\bid=['\"]([^'\"]+)['\"]", html, re.I)
        duplicate_ids = sorted(item for item in set(ids) if ids.count(item) != 1)
        result.require(not duplicate_ids, f"{rel} has duplicate IDs: {duplicate_ids}")
        result.require(required_ids.issubset(ids), f"{rel} omits required viewer IDs: {sorted(required_ids - set(ids))}")
        result.require(contract["workspace"] in ids, f"{rel} omits workspace target {contract['workspace']}")
        fragments = re.findall(r"href=['\"]#(?!/)([^'\"]+)['\"]", html, re.I)
        result.require(
            all(fragment in ids for fragment in fragments),
            f"{rel} contains a fragment link with no matching ID",
        )
        result.require('/MD/viewer/viewer.css' in html, f"{rel} omits the shared viewer stylesheet")
        viewer_tag = re.search(r"<script\b[^>]*src=['\"]/MD/viewer/viewer\.js['\"][^>]*>", html, re.I)
        result.require(viewer_tag is not None, f"{rel} does not mount the shared viewer runtime")
        if viewer_tag:
            tag = viewer_tag.group(0)
            for attr, value in (
                ("data-doc-root", "/MD/"),
                ("data-default-doc", contract["default"]),
                ("data-inline", "true"),
                ("data-portal-canonical", contract["canonical"]),
                ("data-platform-repository", "https://github.com/BTSpaniel/particlerealms.engine"),
            ):
                result.require(
                    bool(re.search(rf"\b{re.escape(attr)}=['\"]{re.escape(value)}['\"]", tag)),
                    f"{rel} viewer runtime has incorrect {attr}",
                )
        if rel.startswith("tests/api/"):
            result.require('data-default-kind="reference"' in html, f"{rel} must preserve APIReference metadata")
        result.require(
            "/MD/assets/vendor/mermaid/mermaid.min.js" not in html,
            f"{rel} eagerly loads the multi-megabyte Mermaid renderer",
        )
        result.require(bool(re.search(r"<main\b", html, re.I)), f"{rel} has no semantic main content")
        result.require(bool(re.search(r"<h1\b", html, re.I)), f"{rel} has no crawlable H1")
        direct = re.findall(r"href=['\"][^'\"]+\.(?:md|json)(?:[#?][^'\"]*)?['\"]", html, re.I)
        result.require(len(direct) >= 3, f"{rel} needs at least three direct Markdown/JSON links")
        visible_text = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", html, flags=re.I)
        visible_text = re.sub(r"<style\b[^>]*>[\s\S]*?</style>", "", visible_text, flags=re.I)
        visible_text = re.sub(r"<[^>]+>", " ", visible_text)
        visible_text = re.sub(r"\s+", " ", visible_text).strip()
        result.require(len(visible_text) >= 350, f"{rel} has insufficient semantic fallback content")
        result.require("rel=\"alternate\"" in html or "rel='alternate'" in html, f"{rel} lacks a machine-readable alternate")
        for feed in ("/docs-chunks.jsonl", "/api-symbols.jsonl"):
            result.require(feed in html, f"{rel} omits machine-readable discovery feed: {feed}")
        canonical = re.search(r"<link\b[^>]*rel=['\"]canonical['\"][^>]*href=['\"]([^'\"]+)", html, re.I)
        result.require(canonical is not None, f"{rel} lacks a canonical URL")
        if canonical:
            result.require("#" not in canonical.group(1), f"{rel} canonical URL must not contain a fragment")
        scripts = re.findall(
            r"<script\b[^>]*type=['\"]application/ld\+json['\"][^>]*>([\s\S]*?)</script>",
            html,
            re.I,
        )
        result.require(bool(scripts), f"{rel} lacks JSON-LD")
        types = set()
        for raw in scripts:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                result.require(False, f"{rel} has invalid JSON-LD: {exc}")
                continue
            nodes = data.get("@graph", [data]) if isinstance(data, dict) else []
            for node in nodes:
                if isinstance(node, dict) and node.get("@type"):
                    types.add(node["@type"])
        result.require(contract["type"] in types, f"{rel} JSON-LD omits {contract['type']}")
        result.require("BreadcrumbList" in types, f"{rel} JSON-LD omits BreadcrumbList")
        result.require("SoftwareApplication" in types, f"{rel} JSON-LD omits platform download metadata")
        result.require("Canonical source:" not in html, f"{rel} mislabels platform downloads as source truth")
        result.require("Platform downloads:" in html, f"{rel} omits the platform-download footer")

    guide = (REPO / "tests" / "guide" / "index.html").read_text(encoding="utf-8", errors="replace")
    result.require(
        "https://github.com/BTSpaniel/particlerealms.engine-master-server" in guide,
        "Guide omits the separate master-server repository",
    )
    result.require("never gameplay authority" in guide.lower(), "Guide misstates master-server authority")

    portal_css = (REPO / "tests" / "common" / "docs-portal.css").read_text(encoding="utf-8")
    for marker in (".portal-docs-workspace", ".portal-docs-toolbar", ".portal-docs-layout"):
        result.require(marker in portal_css, f"public portal CSS omits scoped mount rule: {marker}")
    result.require(".docs-embed" not in portal_css, "public portal CSS retains obsolete iframe styling")
    result.require("transition: transform" not in portal_css, "portal hover transitions move their own hitboxes")
    for selector in (".portal-action:hover", ".route-card:hover"):
        match = re.search(re.escape(selector) + r"\s*\{([^}]+)\}", portal_css)
        result.require(match is not None, f"public portal CSS omits {selector}")
        if match:
            result.require("transform:" not in match.group(1), f"{selector} moves its own hitbox")


def check_viewer_fallback(result: Validation) -> None:
    path = MD / "viewer" / "index.html"
    html = path.read_text(encoding="utf-8", errors="replace")
    result.require("viewer-static-intro" in html, "docs viewer lacks initial static fallback content")
    result.require(len(re.findall(r"href=['\"][^'\"]+\.md['\"]", html, re.I)) >= 3, "docs viewer fallback needs direct Markdown links")
    result.require('id="markdown-alternate"' in html, "docs viewer lacks per-page Markdown alternate")
    for feed in ("/docs-chunks.jsonl", "/api-symbols.jsonl"):
        result.require(feed in html, f"docs viewer fallback omits machine-readable feed: {feed}")
    script = (MD / "viewer" / "viewer.js").read_text(encoding="utf-8", errors="replace")
    result.require("updateDocumentMetadata" in script, "docs viewer does not update canonical page metadata")
    result.require("APIReference" in script and "TechArticle" in script, "docs viewer does not distinguish reference structured data")
    result.require("URLSearchParams(location.search)" in script, "docs viewer cannot open stable ?doc= reference URLs")
    result.require("Download bundled Markdown" in script, "bundled API references lack a Markdown download")
    result.require("normalizeDocPath" in script, "docs viewer does not constrain hash/query document paths")
    result.require("INLINE_MODE" in script, "docs viewer lacks direct-portal scroll behavior")
    result.require("isBundledOnlyPath" in script, "bundled-only Markdown pages expose dead raw-source links")
    result.require("state.mermaidPromise" in script, "docs viewer does not lazily load Mermaid")


def check_static_404(result: Validation) -> None:
    path = REPO / "tests" / "404.html"
    result.require(path.is_file(), "public static 404 page is missing")
    if not path.is_file():
        return
    html = path.read_text(encoding="utf-8", errors="replace")
    result.require("noindex,follow" in html, "static 404 must be noindex,follow")
    result.require(bool(re.search(r"<main\b", html, re.I)), "static 404 has no semantic main")
    result.require(bool(re.search(r"<h1\b", html, re.I)), "static 404 has no H1")
    result.require(not re.search(r"<script\b", html, re.I), "static 404 must work without JavaScript")
    result.require(
        not re.search(r"<\s*(?:iframe|object|embed)\b", html, re.I),
        "static 404 must not contain embedded browsing contexts",
    )
    for href in ("./index.html", "./learn/", "./guide/", "./api/", "./playground/"):
        result.require(f'href="{href}"' in html, f"static 404 omits destination: {href}")


def check_server_markdown_contract(result: Validation) -> None:
    source = (REPO / "start_server.py").read_text(encoding="utf-8", errors="replace")
    result.require(
        '".md": "text/markdown; charset=utf-8"' in source,
        "start_server.py does not serve Markdown as UTF-8 text/markdown",
    )
    compressible = re.search(r"COMPRESSIBLE\s*=\s*\{([^}]+)\}", source)
    result.require(
        compressible is not None and "'.md'" in compressible.group(1),
        "start_server.py does not compress Markdown responses",
    )
    result.require(
        '".jsonl": "application/x-ndjson; charset=utf-8"' in source,
        "start_server.py does not serve JSONL as UTF-8 application/x-ndjson",
    )
    result.require(
        compressible is not None and "'.jsonl'" in compressible.group(1),
        "start_server.py does not compress JSONL responses",
    )


def check_release_packaging(result: Validation) -> None:
    path = REPO / "bundler" / "site.py"
    result.require(path.is_file(), "release-site assembler is missing")
    if not path.is_file():
        return
    source = path.read_text(encoding="utf-8", errors="replace")
    for required in (
        '"404.html",',
        '"learn",',
        '"docs-portal.css",',
        '"validate_docs.py",',
        '"api-index.json",',
        '"docs-chunks.jsonl",',
        '"api-symbols.jsonl",',
        'public_md_paths',
        'public_json_paths',
    ):
        result.require(required in source, f"release-site assembler omits docs contract: {required}")


def main() -> int:
    result = Validation()
    check_curated_ports(result)
    check_gpu_shared_note(result)
    total = check_api_indexes(result)
    check_root_discovery(result, total)
    check_jsonl_discovery(result, total)
    check_public_wrappers(result)
    check_viewer_fallback(result)
    check_static_404(result)
    check_server_markdown_contract(result)
    check_release_packaging(result)
    if result.errors:
        print(f"Documentation validation failed: {len(result.errors)} error(s)", file=sys.stderr)
        for error in result.errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print(f"Documentation validation passed: {result.checks:,} checks, {total:,} API modules")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
