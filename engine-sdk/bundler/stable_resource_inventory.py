# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Deterministic physical-resource inventory for the stable Realm host.

The top-level WebGPU OS bootstrap owns physical Realm connections across
replaceable runtime generations.  This module resolves the complete literal
ES-module closure needed by that host and emits a small JavaScript inventory
that the stable service worker can import while installing its offline cache.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath
from typing import Iterable

from .parser import ParseError, parse_module


STABLE_NETWORK_RESOURCE_ENTRY_PATHS = (
    # StableBootstrap is the authoritative top-document import graph. Keeping
    # it as a root makes every newly added durable host service fail the
    # deterministic inventory gate unless it is available offline.
    "webgpu-os/bootstrap/StableBootstrap.js",
    "webgpu-os/platform/network-host/StableNetworkHostFactory.js",
    "webgpu-os/platform/media-host/StableMediaHost.js",
    "webgpu-os/drivers/ProfileDriver.js",
    "webgpu-os/system-release/SystemReleaseController.js",
    # Stable Echo styles are loaded through new URL()/link elements rather than
    # ESM imports, so name their complete transparent boot surface explicitly.
    "webgpu-os/BrandMark.css",
    "webgpu-os/shared/EchoForm.css",
    "webgpu-os/shared/EchoOperationPresenceRenderer.css",
    "webgpu-os/platform/runtime-host/StableEchoAvatarHost.css",
    # Worker constructors are not ESM imports, so include the dedicated
    # package worker as an explicit offline closure root.
    "webgpu-os/system-release/SystemPackageWorker.js",
)
STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH = (
    "webgpu-os/bootstrap/StableResourceInventory.generated.js"
)
STABLE_RESOURCE_INVENTORY_EXPORT = "STABLE_NETWORK_RESOURCE_PATHS"
MAX_STABLE_NETWORK_MODULES = 4096
MAX_STABLE_NETWORK_SOURCE_BYTES = 64 * 1024 * 1024


class StableResourceInventoryError(RuntimeError):
    """Raised when the physical host's ESM graph cannot be inventoried safely."""


def _normalized_repository_path(value: str, *, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise StableResourceInventoryError(f"{field} must be a non-empty path")
    if "\\" in value or value.startswith(("/", "\\")):
        raise StableResourceInventoryError(f"{field} must be repository-relative: {value!r}")
    normalized = PurePosixPath(value)
    if normalized.is_absolute() or ".." in normalized.parts or str(normalized) != value:
        raise StableResourceInventoryError(f"{field} is not canonical: {value!r}")
    return value


def _repository_relative(root: Path, path: Path, *, field: str) -> str:
    try:
        relative = path.resolve(strict=True).relative_to(root).as_posix()
    except (OSError, ValueError) as error:
        raise StableResourceInventoryError(
            f"{field} escapes or is absent from the repository: {path}"
        ) from error
    return _normalized_repository_path(relative, field=field)


def _module_dependency(root: Path, source: Path, original_spec: str) -> Path:
    spec = re.split(r"[?#]", original_spec, maxsplit=1)[0].replace("\\", "/")
    if not spec:
        raise StableResourceInventoryError(
            f"Stable host module {source} has an empty import specifier"
        )
    if not spec.startswith(("./", "../", "/")):
        raise StableResourceInventoryError(
            f"Stable host module {source} has a bare import that cannot boot offline: {original_spec!r}"
        )
    target = root / spec.lstrip("/") if spec.startswith("/") else source.parent / spec
    try:
        target.resolve(strict=False).relative_to(root)
    except ValueError as error:
        raise StableResourceInventoryError(
            f"Stable host import escapes the repository: {source}: {original_spec!r}"
        ) from error
    candidates = [target]
    if not target.suffix:
        candidates.extend((target.with_suffix(".js"), target / "index.js"))
    dependency = next((candidate for candidate in candidates if candidate.is_file()), None)
    if dependency is None:
        raise StableResourceInventoryError(
            f"Stable host import has no source file: {source}: {original_spec!r}"
        )
    if dependency.is_symlink():
        raise StableResourceInventoryError(
            f"Stable host import closure cannot contain a symlink: {dependency}"
        )
    dependency = dependency.resolve(strict=True)
    try:
        dependency.relative_to(root)
    except ValueError as error:
        raise StableResourceInventoryError(
            f"Stable host import escapes the repository through a symlink: {source}: {original_spec!r}"
        ) from error
    prefix = dependency.read_bytes()[:256].lstrip().lower()
    if prefix.startswith((b"<!doctype html", b"<html")):
        raise StableResourceInventoryError(
            f"Stable host import resolves to HTML instead of a module: {dependency}"
        )
    return dependency


def stable_network_resource_repository_paths(
    root: str | Path,
    *,
    entry_paths: Iterable[str] = STABLE_NETWORK_RESOURCE_ENTRY_PATHS,
) -> tuple[str, ...]:
    """Return the sorted, complete literal ESM closure for the stable host."""
    repository_root = Path(root).resolve(strict=True)
    pending: list[Path] = []
    for entry_path in entry_paths:
        canonical = _normalized_repository_path(entry_path, field="stable host entry")
        entry = repository_root / canonical
        if not entry.is_file():
            raise StableResourceInventoryError(f"Stable host entry is missing: {entry}")
        if entry.is_symlink():
            raise StableResourceInventoryError(f"Stable host entry cannot be a symlink: {entry}")
        pending.append(entry.resolve(strict=True))
    if not pending:
        raise StableResourceInventoryError("Stable host inventory requires at least one entry")

    visited: set[Path] = set()
    total_bytes = 0
    while pending:
        source = pending.pop(0)
        if source in visited:
            continue
        visited.add(source)
        if len(visited) > MAX_STABLE_NETWORK_MODULES:
            raise StableResourceInventoryError(
                f"Stable host module closure exceeds {MAX_STABLE_NETWORK_MODULES} files"
            )
        payload = source.read_bytes()
        total_bytes += len(payload)
        if total_bytes > MAX_STABLE_NETWORK_SOURCE_BYTES:
            raise StableResourceInventoryError(
                f"Stable host module closure exceeds {MAX_STABLE_NETWORK_SOURCE_BYTES} bytes"
            )
        if source.suffix.lower() not in (".js", ".mjs"):
            continue
        try:
            text = payload.decode("utf-8", errors="strict")
            imports, exports = parse_module(text)
        except (UnicodeError, ParseError) as error:
            relative = _repository_relative(repository_root, source, field="stable host module")
            raise StableResourceInventoryError(
                f"Stable host module cannot be parsed: {relative}: {error}"
            ) from error
        specs = [item.spec for item in imports if item.spec]
        specs.extend(item.spec for item in exports if item.reexport and item.spec)
        for spec in specs:
            dependency = _module_dependency(repository_root, source, spec)
            if dependency not in visited and dependency not in pending:
                pending.append(dependency)

    return tuple(sorted(
        (_repository_relative(repository_root, source, field="stable host module") for source in visited),
    ))


def stable_network_resource_scope_paths(
    root: str | Path,
    *,
    entry_paths: Iterable[str] = STABLE_NETWORK_RESOURCE_ENTRY_PATHS,
    repository_paths: Iterable[str] | None = None,
) -> tuple[str, ...]:
    """Project repository paths into URLs relative to the /webgpu-os/ scope."""
    if repository_paths is None:
        repository_paths = stable_network_resource_repository_paths(
            root,
            entry_paths=entry_paths,
        )
    else:
        repository_paths = tuple(
            _normalized_repository_path(path, field="stable host module")
            for path in repository_paths
        )
    scope_paths = []
    for repository_path in repository_paths:
        if repository_path.startswith("webgpu-os/"):
            scope_paths.append(repository_path.removeprefix("webgpu-os/"))
        else:
            scope_paths.append(f"../{repository_path}")
    scope_paths.append(
        STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH.removeprefix("webgpu-os/")
    )
    return tuple(sorted(set(scope_paths)))


def stable_resource_inventory_module_bytes(
    root: str | Path,
    *,
    entry_paths: Iterable[str] = STABLE_NETWORK_RESOURCE_ENTRY_PATHS,
    repository_paths: Iterable[str] | None = None,
) -> bytes:
    """Emit canonical JavaScript bytes for the service worker inventory."""
    scope_paths = stable_network_resource_scope_paths(
        root,
        entry_paths=entry_paths,
        repository_paths=repository_paths,
    )
    encoded = json.dumps(scope_paths, ensure_ascii=False, indent=2)
    return (
        "// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n"
        "//\n"
        "// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n\n"
        "// Generated by tools/generate_stable_bootstrap_inventory.py. Do not edit by hand.\n"
        f"export const {STABLE_RESOURCE_INVENTORY_EXPORT} = Object.freeze({encoded});\n"
    ).encode("utf-8")


def _atomic_write_if_changed(destination: Path, payload: bytes) -> bool:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and destination.read_bytes() == payload:
        return False
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    return True


def generate_stable_resource_inventory(
    root: str | Path,
    *,
    destination: str | Path | None = None,
    entry_paths: Iterable[str] = STABLE_NETWORK_RESOURCE_ENTRY_PATHS,
    repository_paths: Iterable[str] | None = None,
) -> Path:
    """Atomically write the deterministic source/staged inventory module."""
    repository_root = Path(root).resolve(strict=True)
    target = Path(destination) if destination is not None else (
        repository_root / STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH
    )
    payload = stable_resource_inventory_module_bytes(
        repository_root,
        entry_paths=entry_paths,
        repository_paths=repository_paths,
    )
    _atomic_write_if_changed(target, payload)
    return target


def verify_stable_resource_inventory(root: str | Path, path: str | Path) -> int:
    """Fail unless *path* is the exact generated inventory; return item count."""
    repository_paths = stable_network_resource_repository_paths(root)
    expected = stable_resource_inventory_module_bytes(
        root,
        repository_paths=repository_paths,
    )
    candidate = Path(path)
    if not candidate.is_file() or candidate.read_bytes() != expected:
        raise StableResourceInventoryError(
            f"Stable resource inventory is missing or stale: {candidate}"
        )
    return len(stable_network_resource_scope_paths(
        root,
        repository_paths=repository_paths,
    ))
