# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Read-only inputs and isolated, verified outputs for canonical SDK candidates."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .config import atomic_write_json_file

STAGE_FORMAT = "particle-sdk-candidate-build/v1"
STAGE_RECEIPT = "candidate-build.json"


def validate_stage_arguments(args, arguments):
    """Reject output/maintenance conflicts before any command can write files."""
    if getattr(args, "stage_dir", None) is None:
        return
    flags = {argument.split("=", 1)[0] for argument in arguments}
    forbidden = {
        "--sdk-rebuild", "--sdk-packages", "--outdir", "--name", "--entry",
        "--targets-config", "--sync-consumer", "--sync-consumer-assets-only",
        "--gen-roots", "--issue-cert", "--cert-pubkey", "--cert-subject",
        "--cert-root", "--cert-out", "--gen-dict", "--obfuscate", "--encrypt",
        "--domain-lock", "--integrity", "--embed-source-tree", "--site-profile",
    }
    conflicts = sorted(flags & forbidden)
    if conflicts:
        raise ValueError("--stage-dir conflicts with " + ", ".join(conflicts))
    if not args.production or not args.sdk_only:
        raise ValueError("--stage-dir requires --production and --sdk-only")


def resolve_stage_destination(root, destination):
    """Resolve aliases and reject source overlap, traversal, and existing output."""
    root = Path(root).resolve()
    requested = Path(destination).absolute()
    if ".." in requested.parts:
        raise ValueError("SDK staging destination cannot contain parent traversal")
    for ancestor in (requested, *requested.parents):
        if ancestor.is_symlink() or (hasattr(ancestor, "is_junction") and ancestor.is_junction()):
            raise ValueError(f"SDK staging destination uses a filesystem redirect: {ancestor}")
    resolved = requested.resolve()
    if resolved == root or resolved.is_relative_to(root) or root.is_relative_to(resolved):
        raise ValueError("SDK staging destination overlaps the source or its live outputs")
    if requested.exists() or resolved.exists():
        raise ValueError(f"SDK staging destination must be fresh: {resolved}")
    return resolved


def validate_stage_configuration(args, entries):
    """Limit candidates to the same unwrapped public production profiles."""
    if args.target not in {"engine", "platform"}:
        raise ValueError("SDK staging supports canonical engine and platform targets only")
    primary = {"engine": "engine/EngineBootstrap.js", "platform": "engine/EngineEditorBootstrap.js"}[args.target]
    if args.name != "particle-" + args.target or not entries or entries[0] != primary:
        raise ValueError("SDK staging requires the canonical runtime name and primary entry")
    if args.build_site or not args.build_sdk:
        raise ValueError("SDK staging must package an SDK without a website")
    if args.extreme and not args.release:
        raise ValueError("SDK staging extreme compression requires --release")


def verify_stage_inputs(root, target):
    """Verify native assets and supplied signed owners without invoking compilers."""
    from .compute_contracts import verify_compute_contracts
    from .physics import physics_asset_records
    from .wasm import verify_compute_artifacts
    from .sdk_rebuild import (SDK_BUILD_FILENAME, SDK_REGISTRY_FILENAME,
                              _registry_bytes, _verify_signed_sources, prepare_sdk_rebuild)
    from .sdk import SDK_FORMAT

    root = Path(root).resolve()
    descriptor_path = root / SDK_BUILD_FILENAME
    sdk_manifest_path = root / "manifest.json"
    if sdk_manifest_path.is_file():
        sdk_manifest = json.loads(sdk_manifest_path.read_text(encoding="utf-8"))
        if (isinstance(sdk_manifest, dict) and sdk_manifest.get("format") == SDK_FORMAT
                and not descriptor_path.is_file()):
            raise ValueError("Extracted SDK staging requires its supplied sdk-build.json descriptor")
    descriptor = descriptor_record = None
    if descriptor_path.exists() or descriptor_path.is_symlink():
        if descriptor_path.is_symlink() or not descriptor_path.resolve().is_relative_to(root):
            raise ValueError("SDK supplied build descriptor escapes its source root")
        descriptor = prepare_sdk_rebuild(root, target)["descriptor"]
        descriptor_record = _record(descriptor_path)
    public_tests = None
    public_profile = root / "sdk/public_tests/profile.json"
    if public_profile.is_file():
        from sdk.public_tests import validate_public_profile
        profile = validate_public_profile(root, require_receipt=False)
        if descriptor is not None:
            required = {"sdk/public_tests/profile.json", "sdk/public_tests.py"}
            required.update("sdk/public_tests/" + name for name in profile["files"])
            missing = required - (set(descriptor["inputs"]) & set(descriptor["immutable"]))
            if missing:
                raise ValueError("SDK supplied descriptor omits immutable public test fixtures: " + ", ".join(sorted(missing)))
        catalog = root / "tools/testing_platform/suites.json"
        public_tests = {
            "profile": _record(public_profile),
            "catalog": _record(catalog) if catalog.is_file() else None,
            "assertionOriginsSha256": profile["assertionOriginsSha256"],
            "expectedCasesPerMode": profile["expectedCasesPerMode"],
            "originAuthority": "catalog-and-sources" if catalog.is_file() else "delivered-profile",
            "buildDescriptor": descriptor_record,
        }
    compute = verify_compute_artifacts(root, check_source=True)
    verify_compute_contracts(root, manifest=compute)
    native = physics_asset_records(root)
    preamble, containers, signed = None, {}, None
    if target == "platform":
        from .official_inventory import OFFICIAL_PACKAGE_ASSIGNMENT
        from .signing import verify_live_descriptor_fixtures
        descriptor_evidence = verify_live_descriptor_fixtures(root)
        registry = root / SDK_REGISTRY_FILENAME
        if registry.is_symlink() or not registry.resolve().is_relative_to(root):
            raise ValueError("SDK signed registry escapes its source root")
        raw, records = _registry_bytes(registry.read_bytes())
        owners, assets, evidence, containers = _verify_signed_sources(root, records)
        preamble = OFFICIAL_PACKAGE_ASSIGNMENT + raw.decode("utf-8") + ";"
        signed = {
            "registry": _record(registry), "owners": owners,
            "sidecars": assets, "verification": evidence,
            "descriptors": descriptor_evidence,
        }
    print(f"[bundle][stage][inputs] profile={target} native={len(native)} signed={signed is not None} publicTests={public_tests is not None}")
    return {"compute": compute, "native": native, "signed": signed,
            "publicTests": public_tests,
            "sdkBuildDescriptor": descriptor_record,
            "official_preamble": preamble, "official_container_assets": containers}


def _record(path):
    data = Path(path).read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _verify_stage_runtime(destination, sdk_root, manifest):
    """Bind every delivered runtime representation to the verified SDK copy."""
    from .sdk import _read_verified_sdk_runtime

    runtime_root = destination / "runtime"
    _read_verified_sdk_runtime(runtime_root, manifest)
    expected = {}
    for path in (sdk_root / "dist").rglob("*"):
        relative = path.relative_to(sdk_root / "dist").as_posix()
        if path.is_file() and relative not in {"release-runtime-loader.js", "physx-pe.wasm"}:
            expected[relative] = _record(path)
    for record in (*manifest.get("computeAssets", []), *manifest.get("physicsAssets", [])):
        expected[record["path"]] = _record(sdk_root / record["path"])
    for relative, record in expected.items():
        candidate = runtime_root / relative
        if (not candidate.is_file() or candidate.is_symlink()
                or not candidate.resolve().is_relative_to(runtime_root.resolve())
                or _record(candidate) != record):
            raise ValueError(f"SDK staging runtime differs from its verified SDK: {relative}")
    return expected


def complete_stage(root, destination, args, manifest, snapshot, inputs):
    """Publish evidence only after source rechecks and the shared SDK verifier."""
    from .sdk import _verify_snapshot, verify_sdk
    from .sdk_rebuild import sdk_tool_versions

    root, destination = Path(root).resolve(), Path(destination).resolve()
    _verify_snapshot(root, snapshot)
    # Native assets and registry are independently rechecked, so a stale signed
    # owner or an asset changed outside the JavaScript graph cannot be accepted.
    current = verify_stage_inputs(root, args.target)
    if current != inputs:
        raise ValueError("SDK staging verified inputs changed during assembly")
    sdk_root = destination / (args.target + "-sdk")
    archive = None if args.sdk_no_archive else destination / ("particle-" + args.target + "-sdk.zip")
    sdk_receipt = verify_sdk(sdk_root, verify_archive=archive)
    if sdk_receipt["bundle"] != manifest or sdk_receipt["buildInputsSha256"] != snapshot["sha256"]:
        raise ValueError("SDK staging receipt differs from its verified runtime/input identity")
    runtime_files = _verify_stage_runtime(destination, sdk_root, manifest)
    outputs = {}
    for path in sorted(destination.rglob("*")):
        if path.is_symlink() or not path.resolve().is_relative_to(destination):
            raise ValueError("SDK staging output escapes its destination")
        if path.is_file():
            outputs[path.relative_to(destination).as_posix()] = _record(path)
    recipe = {field: getattr(args, field) for field in (
        "target", "name", "production", "eager", "release", "extreme", "ns_order",
        "include_editor", "include_agi", "include_plauna", "include_webgpu_os", "sdk_no_archive",
    )}
    recipe["entries"] = manifest["entries"]
    receipt = {"format": STAGE_FORMAT, "status": "PASS", "recipe": recipe,
               "recipeSha256": _digest(recipe), "tools": sdk_tool_versions(),
               "inputSha256": snapshot["sha256"], "native": inputs["native"],
               "compute": inputs["compute"], "signed": inputs["signed"],
               "publicTests": inputs.get("publicTests"),
               "sdkBuildDescriptor": inputs.get("sdkBuildDescriptor"),
               "sdk": {"path": args.target + "-sdk", **_record(sdk_root / "manifest.json"),
                       "files": len(sdk_receipt["files"]), "buildInputsSha256": snapshot["sha256"]},
               "runtime": {"name": manifest["name"], "sourceSha256": manifest["source_content_sha256"],
                           "integrity": manifest["browser_runtime_integrity"],
                           "provenance": manifest["provenance"], "files": runtime_files},
               "outputs": outputs, "outputsSha256": _digest(outputs),
               "validation": {"inputsUnchanged": "PASS", "sdk": "PASS", "native": "PASS", "runtime": "PASS"}}
    atomic_write_json_file(destination / STAGE_RECEIPT, receipt)
    print(f"[bundle][stage][exit] profile={args.target} verified={len(outputs)} receipt={STAGE_RECEIPT}")
    return receipt
