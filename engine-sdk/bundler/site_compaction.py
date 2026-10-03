# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Pack small release resources into verified, URL-preserving browser ZIPs.

The compact Cloudflare tree is published at release/site. A byte-identical
compact mirror remains at site-upload, while site-full retains the uncompressed
diagnostic tree used to produce and verify the host representation.
"""
from __future__ import annotations

import base64
import fnmatch
import hashlib
import html
import io
import json
import mimetypes
import re
import shutil
import zipfile
from pathlib import Path, PurePosixPath

from .parser import parse_module
from .stable_resource_inventory import stable_network_resource_repository_paths

MAX_FILES = 1000
MAX_ENTRY_BYTES = 128 * 1024
MAX_ARCHIVE_RAW_BYTES = 8 * 1024 * 1024
MAX_HOST_BYTES = 25 * 1024 * 1024
MANIFEST_PATH = "site-archive-manifest.json"
BOOT_SHELL_PATH = Path(__file__).parent / "runtime/site-archive-shell.html"
BOOT_BRAND_PATH = Path(__file__).resolve().parents[1] / "webgpu-os/assets/webgpu-os-icon.svg"
CONFIG_PATH = "webgpu-os/platform/runtime-host/SiteArchiveConfig.js"
ROUTER_PATH = "webgpu-os/platform/runtime-host/SiteArchiveRouter.js"
PACK_ROOTS = frozenset({"engine", "vendor", "playground", "plauna", "agi", "webgpu-os"})
KEPT_SUFFIXES = frozenset({".html", ".wasm", ".py", ".bat"})
RUNTIME_COPIES = (
    ("bundler/runtime/site-archive-boot.js", "site-archive-boot.js"),
    (ROUTER_PATH, ROUTER_PATH),
    ("webgpu-os/packages/Zip.js", "webgpu-os/packages/Zip.js"),
    ("engine/core/math/ChecksumMath.js", "engine/core/math/ChecksumMath.js"),
    ("engine/core/math/BufferMath.js", "engine/core/math/BufferMath.js"),
)
LICENSE_HEADER = (
    "// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n"
    "// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n"
)
WORKER_SOURCE = LICENSE_HEADER + """
import { createSiteArchiveRouter } from './webgpu-os/platform/runtime-host/SiteArchiveRouter.js';
const router = createSiteArchiveRouter();
self.addEventListener('install', event => event.waitUntil((async () => {
  await router.install();
  await self.skipWaiting();
})()));
// No clients.claim(): do not steal live OS/package clients from their worker.
self.addEventListener('message', event => {
  if (event.data?.type === 'PE_SITE_ARCHIVE_VERSION') {
    event.ports[0]?.postMessage({ version: router.version, progress: router.progress });
  }
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  if (router.matches(event.request)) event.respondWith(router.handle(event.request));
});
"""


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _sha(payload):
    return hashlib.sha256(payload).hexdigest()


def _safe_path(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name \
            or str(path) != name or any(char in name for char in "?#\x00"):
        raise ValueError(f"Non-canonical archive path: {name!r}")
    return name


def _header_rules(site):
    rules = []
    path = site / "_headers"
    if not path.is_file():
        return rules
    for line in path.read_text("utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            rules.append((line.strip(), {}))
        elif rules:
            key, separator, value = line.strip().partition(":")
            if not separator:
                raise ValueError(f"Cannot preserve release response header: {line}")
            rules[-1][1][key] = value.strip()
    return rules


def _headers_for(name, rules):
    result = {}
    for pattern, headers in rules:
        if fnmatch.fnmatchcase("/" + name, pattern):
            result.update(headers)
    return result


def _content_type(name):
    extension = PurePosixPath(name).suffix.lower()
    return {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
            ".css": "text/css", ".wgsl": "text/plain", ".md": "text/markdown"}.get(
                extension, mimetypes.guess_type(name)[0] or "application/octet-stream")


def _verify_worker_closure(site, entry):
    pending, visited = [entry], set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        path = site / name
        if not path.is_file():
            raise FileNotFoundError(f"Archive worker needs physical bootstrap module: {name}")
        imports, exports = parse_module(path.read_text("utf-8"))
        specs = [item.spec for item in imports if item.spec]
        specs += [item.spec for item in exports if item.reexport and item.spec]
        for spec in specs:
            spec = re.split(r"[?#]", spec, maxsplit=1)[0]
            if not spec.startswith(("./", "../", "/")):
                raise ValueError(f"Unsupported worker import: {name}: {spec}")
            target = site / spec.lstrip("/") if spec.startswith("/") else path.parent / spec
            pending.append(target.resolve().relative_to(site.resolve()).as_posix())
    return visited


def _boot_document(source, version, os_worker):
    title = re.search(r"<title[^>]*>(.*?)</title>", source.decode("utf-8"), re.I | re.S)
    label = html.escape(html.unescape(title.group(1))) if title else "Particle Realms"
    values = {
        "TITLE": label,
        "BRAND": base64.b64encode(BOOT_BRAND_PATH.read_bytes()).decode("ascii"),
        "DOCUMENT": base64.b64encode(source).decode("ascii"),
        "VERSION": html.escape(version, quote=True),
        "OS_WORKER": str(os_worker).lower(),
    }
    # Single-pass expansion also preserves user page titles containing tokens.
    return re.sub(r"@@([A-Z_]+)@@", lambda match: values[match[1]],
                  BOOT_SHELL_PATH.read_text("utf-8")).encode("utf-8")


def verify_site_archives(site):
    """Return verified logical members, never trusting manifest-only existence."""
    site = Path(site)
    manifest_path = site / MANIFEST_PATH
    if not manifest_path.is_file():
        return set()
    manifest = json.loads(manifest_path.read_text("utf-8"))
    if manifest.get("schema") != "particle-site-archive-v1":
        raise ValueError("Unsupported site archive schema")
    expected_config = LICENSE_HEADER + f"export const SITE_ARCHIVE_CONFIG = {_json(manifest)};\n"
    if (site / CONFIG_PATH).read_text("utf-8") != expected_config:
        raise ValueError("Site archive worker configuration differs from its manifest")
    members = set()
    for index, archive in enumerate(manifest["archives"]):
        payload = (site / _safe_path(archive["path"])).read_bytes()
        if len(payload) != archive["bytes"] or _sha(payload) != archive["sha256"]:
            raise ValueError(f"Site archive integrity mismatch: {archive['path']}")
        with zipfile.ZipFile(io.BytesIO(payload)) as zipped:
            names = zipped.namelist()
            expected = {name for name, record in manifest["files"].items() if record["archive"] == index}
            if len(names) != len(set(names)) or set(names) != expected or len(names) != archive["fileCount"]:
                raise ValueError("Site archive membership mismatch")
            raw_bytes = 0
            for name in names:
                _safe_path(name)
                data = zipped.read(name)
                record = manifest["files"][name]
                if len(data) != record["bytes"] or _sha(data) != record["sha256"]:
                    raise ValueError(f"Site archive member integrity mismatch: {name}")
                if len(data) > manifest["maxEntryBytes"] or name in members:
                    raise ValueError(f"Site archive member limit/duplicate: {name}")
                raw_bytes += len(data)
                members.add(name)
            if raw_bytes != archive["rawBytes"]:
                raise ValueError("Site archive expansion size mismatch")
    if members != set(manifest["files"]):
        raise ValueError("Site archive manifest has unresolved members")
    return members


def compact_release_site(root, source, destination, *, max_files=MAX_FILES):
    """Create an atomic compact upload tree without changing its source."""
    from .site import (_publish_staged_site, _read_webgpu_os_shell_resource_paths,
                       _validate_static_site_file_cap, watch_party_runtime_asset_manifest,
                       validate_watch_party_deployment)

    root, source, destination = Path(root).resolve(), Path(source).resolve(), Path(destination).resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError("Compact upload output must not overlap its source")
    staging = destination.parent / ".staging" / destination.name
    if staging == source or source in staging.parents:
        raise ValueError("Compact staging must not overlap its source")
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(source, staging)
    original_count = sum(path.is_file() for path in staging.rglob("*"))
    print(f"[bundle][site-archive][entry] source_files={original_count}", flush=True)
    # Small test/deployment sites need no indirection. Real large releases use
    # this same gate, with failures leaving the previous upload tree intact.
    if original_count <= max_files:
        _validate_static_site_file_cap(staging, max_files=max_files)
        _publish_staged_site(staging, destination)
        return destination

    rules = _header_rules(staging)
    protected = set(stable_network_resource_repository_paths(root))
    guest_page = 'webgpu-os/watch-party.html'
    has_guest = (staging / guest_page).is_file()
    if has_guest:
        # Invite entry must work on a cold visit without the OS/archive loader.
        protected.update(destination for _source, destination in watch_party_runtime_asset_manifest(root))
        validate_watch_party_deployment(staging)
    for src, dst in RUNTIME_COPIES:
        target = staging / dst
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / src, target)
        protected.add(dst)
    (staging / CONFIG_PATH).write_text(LICENSE_HEADER + "export const SITE_ARCHIVE_CONFIG = null;\n", "utf-8")
    (staging / "site-archive-sw.js").write_text(WORKER_SOURCE, "utf-8")
    protected.update(_verify_worker_closure(staging, "site-archive-sw.js"))
    os_worker = (staging / "webgpu-os/sw.js").is_file()
    if os_worker:
        shutil.copy2(root / "webgpu-os/sw.js", staging / "webgpu-os/sw.js")
        protected.update(_verify_worker_closure(staging, "webgpu-os/sw.js"))
        # Service-worker install fetches bypass page fetch interception. Its
        # literal precache resources must exist before either worker controls
        # the page, including CSS, icons and bootstrap modules.
        protected.update("webgpu-os/" + name for name in
                         _read_webgpu_os_shell_resource_paths(staging / "webgpu-os/sw.js"))

    selected = []
    for path in sorted(staging.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        name = path.relative_to(staging).as_posix()
        # The portable kit is also fetched from outside the site's worker
        # scope. Keep its verifier, descriptors and multipart downloads direct.
        portable_kit = name.startswith("webgpu-os/assets/engine-demo/")
        if path.relative_to(staging).parts[0] in PACK_ROOTS and name not in protected and not portable_kit \
                and path.suffix.lower() not in KEPT_SUFFIXES and path.stat().st_size <= MAX_ENTRY_BYTES:
            selected.append((name, path.read_bytes()))
    # Keep a physical bootstrap for a cold visit, and a cached copy for offline
    # OS navigation. It is intentionally not removed after archive verification.
    selected.append(("site-archive-boot.js", (staging / "site-archive-boot.js").read_bytes()))
    groups, group, size = [], [], 0
    for item in selected:
        if group and size + len(item[1]) > MAX_ARCHIVE_RAW_BYTES:
            groups.append(group)
            group, size = [], 0
        group.append(item)
        size += len(item[1])
    if group:
        groups.append(group)
    manifest = {"schema": "particle-site-archive-v1", "maxEntryBytes": MAX_ENTRY_BYTES,
                "archives": [], "files": {}}
    for index, entries in enumerate(groups):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
            for name, payload in entries:
                info = zipfile.ZipInfo(_safe_path(name), (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                zipped.writestr(info, payload)
                manifest["files"][name] = {"archive": index, "bytes": len(payload), "sha256": _sha(payload),
                                           "type": _content_type(name), "headers": _headers_for(name, rules)}
        payload = stream.getvalue()
        digest = _sha(payload)
        name = f"assets/site-files-{index}-{digest[:24]}.zip"
        (staging / name).parent.mkdir(parents=True, exist_ok=True)
        (staging / name).write_bytes(payload)
        manifest["archives"].append({"path": name, "bytes": len(payload), "sha256": digest,
                                     "rawBytes": sum(len(data) for _, data in entries), "fileCount": len(entries)})

    pages = [(path, path.read_bytes()) for path in sorted(staging.rglob("*.html"))
             if path.relative_to(staging).as_posix() not in {"404.html", "webgpu-os/companion-privacy.html", guest_page}]
    identity = {"manifest": manifest, "pages": [(path.relative_to(staging).as_posix(), _sha(data)) for path, data in pages],
                "bootShell": _sha(BOOT_SHELL_PATH.read_bytes()), "bootBrand": _sha(BOOT_BRAND_PATH.read_bytes()),
                "worker": _sha(WORKER_SOURCE.encode()), "router": _sha((staging / ROUTER_PATH).read_bytes()),
                "osWorker": _sha((staging / "webgpu-os/sw.js").read_bytes()) if os_worker else None}
    manifest["version"] = _sha(_json(identity).encode())[:24]
    (staging / MANIFEST_PATH).write_text(_json(manifest) + "\n", "utf-8")
    (staging / CONFIG_PATH).write_text(LICENSE_HEADER + f"export const SITE_ARCHIVE_CONFIG = {_json(manifest)};\n", "utf-8")
    verify_site_archives(staging)
    for name, _ in selected:
        if name != "site-archive-boot.js":
            (staging / name).unlink()
    for path, data in pages:
        path.write_bytes(_boot_document(data, manifest["version"], os_worker and path.is_relative_to(staging / "webgpu-os")))
    count, largest = _validate_static_site_file_cap(staging, max_files=max_files)
    _verify_worker_closure(staging, "site-archive-sw.js")
    if os_worker:
        _verify_worker_closure(staging, "webgpu-os/sw.js")
    if has_guest:
        validate_watch_party_deployment(staging)
    _publish_staged_site(staging, destination)
    print(f"[bundle][site-archive][exit] packed={len(selected) - 1} archives={len(groups)} "
          f"upload_files={count}/{max_files} largest_bytes={largest} version={manifest['version']}", flush=True)
    return destination


def promote_compact_release_site(source, compact, diagnostic, *, max_files=MAX_FILES):
    """Publish the compact tree at ``source`` and preserve the full tree.

    Both publications use the release builder's recoverable directory swap.
    The compact mirror remains untouched so the resulting Cloudflare directory
    can be compared byte-for-byte with the already verified archive source.
    """
    from .site import _publish_staged_site, _validate_static_site_file_cap

    source, compact, diagnostic = (Path(path).resolve() for path in (source, compact, diagnostic))
    if len({source, compact, diagnostic}) != 3:
        raise ValueError("Cloudflare, compact mirror, and diagnostic paths must be distinct")
    if source.parent != compact.parent or source.parent != diagnostic.parent:
        raise ValueError("Release site trees must be siblings")
    if not source.is_dir() or not compact.is_dir():
        raise FileNotFoundError("Full and compact release site trees must exist before promotion")

    staging_root = source.parent / ".staging"
    diagnostic_staging = staging_root / f"{diagnostic.name}-promote"
    source_staging = staging_root / f"{source.name}-cloudflare-promote"
    for staging in (diagnostic_staging, source_staging):
        if staging.exists():
            shutil.rmtree(staging)

    shutil.copytree(source, diagnostic_staging)
    _publish_staged_site(diagnostic_staging, diagnostic)
    shutil.copytree(compact, source_staging)
    compact_count, largest = _validate_static_site_file_cap(source_staging, max_files=max_files)
    _publish_staged_site(source_staging, source)

    def inventory(directory):
        return {
            path.relative_to(directory).as_posix(): (path.stat().st_size, _sha(path.read_bytes()))
            for path in directory.rglob("*")
            if path.is_file()
        }

    if inventory(source) != inventory(compact):
        raise RuntimeError("Published Cloudflare site differs from its verified compact mirror")
    print(
        f"[bundle][site-cloudflare][exit] files={compact_count}/{max_files} "
        f"largest_bytes={largest} diagnostic={diagnostic.name}",
        flush=True,
    )
    return source, diagnostic
