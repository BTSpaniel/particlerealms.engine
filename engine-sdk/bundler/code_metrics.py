# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Deterministic first-party source metrics for release telemetry.

The release manifest describes modules reachable from one bundle entry.  This
module deliberately measures a different thing: the maintained source corpus
across every reusable layer of the platform.  Keeping that distinction here
prevents the public site from drifting back to hand-maintained numbers.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .config import atomic_write_json_file


SCHEMA = "particle-realms-code-metrics/v1"
SOURCE_ROOTS = ("engine", "editor", "plauna", "agi", "webgpu-os")
SOURCE_EXTENSIONS = frozenset({".css", ".html", ".js", ".mjs", ".py", ".wgsl"})
EXCLUDED_PARTS = frozenset({
    ".git", ".logs", ".staging", "__pycache__", "build", "coverage",
    "dist", "evidence", "node_modules", "release", "vendor",
})
EXCLUDED_PREFIXES = ("engine/kaolin/", "engine/sim/physics/")
EXCLUDED_SUFFIXES = (".generated.js", ".min.js")

ROOT_LABELS = {
    "engine": "Engine",
    "editor": "Editor",
    "plauna": "Plauna",
    "agi": "AGI",
    "webgpu-os": "WebGPU OS",
}

ROOT_COLORS = {
    "engine": "#38bdf8",
    "editor": "#a78bfa",
    "plauna": "#2dd4bf",
    "agi": "#f59e0b",
    "webgpu-os": "#f472b6",
}

CATEGORIES = (
    ("particle-sim", "Particle Sim", "#f59e0b", ("/particles/", "/particle/", "particles")),
    ("rendering", "Rendering", "#38bdf8", ("/render/", "/renderer/", "rendering", "compositor")),
    ("shaders", "Shaders", "#22d3ee", ("/shaders/", ".wgsl", "shader")),
    ("audio", "Audio", "#a78bfa", ("/audio/", "audio", "sound", "music")),
    ("gpu-core", "GPU Core", "#0ea5e9", ("/gpu/", "/vgpu/", "virtualgpu", "gpucontext", "gpuadapter")),
    ("world", "World", "#2dd4bf", ("/world/", "world", "terrain", "ecosystem")),
    ("physics", "Physics Owned", "#fb923c", ("/physics/", "physics", "collision")),
    ("ecs", "ECS", "#34d399", ("/ecs/", "entity", "component", "systemmanager")),
    ("ai-agi", "AI + AGI", "#fbbf24", ("agi/", "/ai/", "neural", "agent", "tensor")),
    ("math", "Math Library", "#60a5fa", ("/math/", "math", "algebra", "geometry")),
    ("voxel", "Voxel", "#14b8a6", ("/voxel/", "voxel")),
    ("os-apps", "WebGPU OS Apps", "#f472b6", ("webgpu-os/apps/", "webgpu-os/factory/apps/")),
)


def _as_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def is_first_party_source(path: Path, root: Path) -> bool:
    """Return whether *path* belongs to the maintained source-metrics scope."""
    if not path.is_file() or path.suffix.lower() not in SOURCE_EXTENSIONS:
        return False
    rel = _as_posix(path, root)
    parts = set(Path(rel).parts)
    if not rel.startswith(tuple(f"{name}/" for name in SOURCE_ROOTS)):
        return False
    if parts.intersection(EXCLUDED_PARTS):
        return False
    if rel.startswith(EXCLUDED_PREFIXES) or rel.endswith(EXCLUDED_SUFFIXES):
        return False
    return rel != "webgpu-os/.bundled-os-content.generated.js"


def physical_line_count(path: Path) -> int:
    """Count physical text lines without interpreting language syntax."""
    data = path.read_bytes()
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


def _matches_category(rel: str, needles: tuple[str, ...]) -> bool:
    lowered = rel.lower()
    return any(needle in lowered for needle in needles)


def collect_code_metrics(root: Path, generated_at: str | None = None) -> dict:
    """Scan the repository and return stable, JSON-serializable telemetry."""
    root = Path(root).resolve()
    files = []
    for source_root in SOURCE_ROOTS:
        base = root / source_root
        if base.is_dir():
            files.extend(path for path in base.rglob("*") if is_first_party_source(path, root))

    records = []
    roots = {
        name: {"label": ROOT_LABELS[name], "files": 0, "lines": 0, "color": ROOT_COLORS[name]}
        for name in SOURCE_ROOTS
    }
    category_totals = {
        category_id: {"id": category_id, "label": label, "files": 0, "lines": 0, "color": color}
        for category_id, label, color, _ in CATEGORIES
    }

    for path in sorted(files, key=lambda item: _as_posix(item, root).lower()):
        rel = _as_posix(path, root)
        line_count = physical_line_count(path)
        root_name = rel.split("/", 1)[0]
        roots[root_name]["files"] += 1
        roots[root_name]["lines"] += line_count
        records.append({"path": rel, "lines": line_count})
        for category_id, _, _, needles in CATEGORIES:
            if _matches_category(rel, needles):
                category_totals[category_id]["files"] += 1
                category_totals[category_id]["lines"] += line_count

    total_lines = sum(record["lines"] for record in records)
    timestamp = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    largest = sorted(records, key=lambda record: (-record["lines"], record["path"]))[:16]
    return {
        "schema": SCHEMA,
        "generated_at": timestamp,
        "measurement": "physical lines in maintained first-party source files",
        "totals": {"files": len(records), "lines": total_lines},
        "roots": roots,
        "categories": list(category_totals.values()),
        "categories_overlap": True,
        "largest_files": largest,
        "scope": {
            "roots": list(SOURCE_ROOTS),
            "extensions": sorted(SOURCE_EXTENSIONS),
            "excluded_prefixes": list(EXCLUDED_PREFIXES),
            "excluded_parts": sorted(EXCLUDED_PARTS),
            "excluded_suffixes": list(EXCLUDED_SUFFIXES),
        },
    }


def write_code_metrics(path: Path, metrics: dict) -> None:
    """Write metrics atomically enough for a local/static build pipeline."""
    atomic_write_json_file(Path(path), metrics)
