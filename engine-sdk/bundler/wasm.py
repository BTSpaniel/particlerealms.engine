# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Build, attest and stage the first-party compute kernels without Node tooling."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLCHAIN = "nightly-2026-09-07"
KERNEL_ROOT = "engine/core/compute/kernels"
ARTIFACT_ROOT = "engine/core/compute/artifacts"
WORKER_PATH = "engine/core/compute/ComputeWorker.js"
SCHEMA = "particle-compute-kernels"
ABI_VERSION = 1
MEMORY_MAX_BYTES = 268435456
STACK_BYTES = 1048576
VARIANTS = {
    "scalar": (),
    "simd": ("simd128",),
    "threads": ("atomics", "bulk-memory"),
    "threads-simd": ("atomics", "bulk-memory", "simd128"),
}
KERNEL_EXPORTS = {
    "abi_version", "stats", "compensated_sum", "bounds", "transform_points",
    "rgba_histogram", "luminance", "fft", "waveform", "windowed_rms", "crc32",
    "byte_histogram", "__stack_pointer", "__heap_base",
}
SIMD_OPERATIONS = ["math.geometry.transform-points@1", "math.image.luminance@1"]


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


class _Reader:
    """Bounded Wasm section reader; no third-party binary parser dependency."""
    def __init__(self, data):
        self.data, self.position = data, 0

    def take(self, count):
        end = self.position + count
        if count < 0 or end > len(self.data):
            raise ValueError("Truncated WebAssembly section")
        result = self.data[self.position:end]
        self.position = end
        return result

    def byte(self):
        return self.take(1)[0]

    def uint(self):
        result = 0
        for shift in range(0, 35, 7):
            value = self.byte()
            result |= (value & 127) << shift
            if not value & 128:
                if result > 0xffffffff:
                    raise ValueError("WebAssembly u32 overflow")
                return result
        raise ValueError("WebAssembly u32 is too long")

    def name(self):
        return self.take(self.uint()).decode("utf-8", errors="strict")


def inspect_wasm(data):
    """Read actual imports, exports, memory limits, and compiler target features."""
    reader = _Reader(data)
    if reader.take(8) != b"\0asm\x01\0\0\0":
        raise ValueError("Invalid WebAssembly magic/version")
    imports, exports, memories, features = [], [], [], []
    while reader.position < len(data):
        kind = reader.byte()
        section = _Reader(reader.take(reader.uint()))
        if kind == 0:
            if section.name() == "target_features":
                for _ in range(section.uint()):
                    enabled, name = section.byte(), section.name()
                    if enabled == 43:
                        features.append(name)
        elif kind == 2:
            for _ in range(section.uint()):
                module, name, import_kind = section.name(), section.name(), section.byte()
                if import_kind != 2:
                    raise ValueError(f"Compute kernel has forbidden import: {module}.{name}")
                flags = section.uint()
                minimum = section.uint()
                maximum = section.uint() if flags & 1 else None
                if flags & ~3:
                    raise ValueError("Compute kernels require wasm32 single memory")
                memory = {"minimumPages": minimum, "maximumPages": maximum, "shared": bool(flags & 2)}
                memories.append(memory)
                imports.append({"module": module, "name": name, "kind": "memory"})
        elif kind == 5:
            raise ValueError("Compute kernels must import host-owned memory")
        elif kind == 7:
            for _ in range(section.uint()):
                name, export_kind, _index = section.name(), section.byte(), section.uint()
                exports.append({"name": name, "kind": {0: "function", 1: "table", 2: "memory", 3: "global"}.get(export_kind, "unknown")})
    if imports != [{"module": "env", "name": "memory", "kind": "memory"}]:
        raise ValueError("Compute kernel must import exactly env.memory")
    if {entry["name"] for entry in exports} != KERNEL_EXPORTS:
        raise ValueError("Compute kernel exports do not match ABI 1")
    return {"imports": imports, "exports": sorted(exports, key=lambda entry: entry["name"]),
            "memory": memories[0], "compiledFeatures": sorted(features)}


def kernel_source_hash(root=ROOT):
    root = Path(root).resolve()
    source = root / KERNEL_ROOT
    paths = [source / "Cargo.toml", source / "Cargo.lock", source / "rust-toolchain.toml",
             *sorted((source / "src").rglob("*.rs")), root / "bundler/wasm.py"]
    digest = hashlib.sha256()
    digest.update(_canonical({"toolchain": TOOLCHAIN, "variants": VARIANTS, "abi": ABI_VERSION,
                              "maximum": MEMORY_MAX_BYTES, "stack": STACK_BYTES}))
    for path in paths:
        name = path.relative_to(root).as_posix().encode()
        data = path.read_bytes()
        digest.update(len(name).to_bytes(4, "little") + name + len(data).to_bytes(8, "little") + data)
    return digest.hexdigest()


def verify_compute_artifacts(root=ROOT, *, check_source=True):
    """Fail closed on missing, corrupt, incompatible, or stale kernel sidecars."""
    root = Path(root).resolve()
    manifest = json.loads((root / ARTIFACT_ROOT / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA or manifest.get("abiVersion") != ABI_VERSION \
            or manifest.get("toolchain") != TOOLCHAIN or set(manifest.get("variants", {})) != set(VARIANTS):
        raise ValueError("Unsupported compute kernel manifest")
    if check_source and manifest.get("sourceHash") != kernel_source_hash(root):
        raise ValueError("Stale compute kernels; run python -m bundler.wasm")
    for name, expected in VARIANTS.items():
        record = manifest["variants"][name]
        filename = f"compute-{name}.wasm"
        if record.get("file") != filename or record.get("url") != f"./{filename}" \
                or record.get("features") != list(expected) \
                or record.get("flags") != _variant_flags(expected, "<source>"):
            raise ValueError(f"Invalid compute artifact record: {name}")
        data = (root / ARTIFACT_ROOT / filename).read_bytes()
        if _sha(data) != record.get("sha256") or len(data) != record.get("byteLength"):
            raise ValueError(f"Compute artifact hash/length mismatch: {name}")
        inspected = inspect_wasm(data)
        if any(record.get(key) != value for key, value in inspected.items()):
            raise ValueError(f"Compute artifact ABI metadata mismatch: {name}")
        if inspected["memory"]["shared"] != ("atomics" in expected) \
                or inspected["memory"]["maximumPages"] != MEMORY_MAX_BYTES // 65536 \
                or not set(expected).issubset(inspected["compiledFeatures"]):
            raise ValueError(f"Compute artifact feature/memory mismatch: {name}")
        if record.get("simdOperations") != (SIMD_OPERATIONS if "simd128" in expected else []):
            raise ValueError(f"Invalid compute SIMD operation claims: {name}")
    return manifest


def _run(args, *, cwd, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(f"Compute compiler failed ({result.returncode}): {result.stderr[-12000:]}")
    return result.stdout.strip()


def _variant_flags(features, root_label):
    flags = ["-Ctarget-cpu=mvp", "-Ctarget-feature=" + ",".join("+" + f for f in ("mutable-globals", *features)),
             "-Clink-arg=--import-memory", f"-Clink-arg=--max-memory={MEMORY_MAX_BYTES}",
             f"-Clink-arg=-zstack-size={STACK_BYTES}", "-Clink-arg=--export=__stack_pointer",
             "-Clink-arg=--export=__heap_base", "-Clink-arg=--no-entry", "-Cpanic=abort",
             f"--remap-path-prefix={root_label}=/particle"]
    if "atomics" in features:
        flags.append("-Clink-arg=--shared-memory")
    return flags


def build_compute_kernels(root=ROOT, *, force=False, check=False, cache_dir=None):
    root = Path(root).resolve()
    try:
        manifest = verify_compute_artifacts(root)
        if not force:
            return {"cached": True, "manifest": manifest}
    except (OSError, ValueError, KeyError) as error:
        if check:
            raise ValueError(f"Compute artifact verification failed: {error}") from error
    if check:
        return {"cached": True, "manifest": verify_compute_artifacts(root)}
    crate = root / KERNEL_ROOT
    if not (crate / "Cargo.lock").exists():
        _run(["cargo", f"+{TOOLCHAIN}", "generate-lockfile", "--manifest-path", str(crate / "Cargo.toml")], cwd=root)
    compiler = _run(["rustc", f"+{TOOLCHAIN}", "-vV"], cwd=root)
    manifest = {"schema": SCHEMA, "abiVersion": ABI_VERSION, "toolchain": TOOLCHAIN,
                "compiler": compiler, "sourceHash": kernel_source_hash(root), "variants": {}}
    artifact_dir = root / ARTIFACT_ROOT
    artifact_dir.mkdir(parents=True, exist_ok=True)
    # Build products stay out of the source tree and are independently keyed by variant.
    cache = Path(cache_dir) if cache_dir is not None else root / ".cache/compute-wasm"
    for name, features in VARIANTS.items():
        flags = _variant_flags(features, root.as_posix())
        env = os.environ.copy()
        env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(flags)
        env.pop("RUSTFLAGS", None)
        print(f"[compute-build] Compiling {name}", flush=True)
        _run(["cargo", f"+{TOOLCHAIN}", "build", "--release", "--locked", "--target", "wasm32-unknown-unknown",
              "-Zbuild-std=core", "--manifest-path", str(crate / "Cargo.toml"), "--target-dir", str(cache / name)], cwd=root, env=env)
        data = (cache / name / "wasm32-unknown-unknown/release/particle_compute.wasm").read_bytes()
        inspection = inspect_wasm(data)
        filename = f"compute-{name}.wasm"
        record = {"file": filename, "url": f"./{filename}", "sha256": _sha(data), "byteLength": len(data),
                  "features": list(features), "simdOperations": SIMD_OPERATIONS if "simd128" in features else [],
                  "flags": _variant_flags(features, "<source>"), **inspection}
        manifest["variants"][name] = record
        _atomic_write(artifact_dir / filename, data)
    _atomic_write(artifact_dir / "manifest.json", _canonical(manifest) + b"\n")
    verify_compute_artifacts(root)
    return {"cached": False, "manifest": manifest}


def _atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def compute_release_asset_paths(root=ROOT):
    """Exact binary/manifest and raw worker module closure required after bundling."""
    from .graph import ModuleGraph
    from .parser import parse_module
    root = Path(root).resolve()
    verify_compute_artifacts(root, check_source=(root / KERNEL_ROOT).is_dir())
    paths = {f"{ARTIFACT_ROOT}/manifest.json", *(f"{ARTIFACT_ROOT}/compute-{name}.wasm" for name in VARIANTS)}
    graph = ModuleGraph(root)
    graph.walk(WORKER_PATH)
    if graph.errors:
        raise ValueError("Incomplete compute worker closure: " + "; ".join(map(str, graph.errors)))
    for filename in graph.order:
        path = Path(filename).resolve()
        relative = path.relative_to(root).as_posix()
        imports, exports = parse_module(graph.modules[filename])
        specs = [item.spec for item in imports if item.spec]
        specs.extend(item.spec for item in exports if item.reexport and item.spec)
        if any(not spec.startswith((".", "/")) or spec.startswith("//") for spec in specs):
            raise ValueError(f"Nonlocal compute worker dependency: {relative}")
        paths.add(relative)
    return tuple(sorted(paths))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify artifacts without invoking compiler or writing files")
    parser.add_argument("--force", action="store_true", help="Compile even when source/provenance checks pass")
    args = parser.parse_args(argv)
    try:
        result = build_compute_kernels(check=args.check, force=args.force)
        print(f"[compute-build] {'Verified cached' if result['cached'] else 'Built'} four ABI 1 variants")
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"[compute-build] ERROR: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
