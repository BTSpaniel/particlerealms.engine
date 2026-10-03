# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.signing — ring-0 root keygen, publisher certs, official signed app packages."""

import os
import json
import base64
import hashlib
import datetime
import re
import subprocess
import sys
from pathlib import Path
from .config import ROOT, ENGINE_VERSION


# ---- Ring-0 trust keygen ----------------------------------------------------

def generate_ring0_roots(count):
    """Generate N ECDSA P-256 ring-0 root keypairs.

    Public roots (raw 65-byte uncompressed key, base64) are baked into
    webgpu-os/kernel/trust/roots.json with a fingerprint computed the SAME way
    the OS does: SHA-256(raw public key) hex, truncated to 16 chars
    (engine/collab/CollabIdentity.js::_computeFingerprint). Private keys are
    written as PEM to .trust-keys/ which is kept OUT of the bundle.
    """
    try:
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization
    except ImportError:
        print("[trust] ERROR: the 'cryptography' package is required for keygen.")
        print("[trust]        Install it with:  pip install cryptography")
        return

    if count < 1:
        print("[trust] --gen-roots N requires N >= 1")
        return

    roots_path = ROOT / "webgpu-os" / "kernel" / "trust" / "roots.json"
    keys_dir   = ROOT / ".trust-keys"
    keys_dir.mkdir(parents=True, exist_ok=True)

    # Refuse to clobber existing private keys silently.
    existing = sorted(keys_dir.glob("ring0-root-*.private.pem"))
    if existing:
        print(f"[trust] WARNING: {len(existing)} existing private key(s) in {keys_dir}.")
        print("[trust]          Move/remove them first to regenerate (will not overwrite).")
        return

    roots = []
    for i in range(count):
        priv = ec.generate_private_key(ec.SECP256R1())
        pub  = priv.public_key()

        # Raw uncompressed point: 0x04 || X || Y  (65 bytes) — matches WebCrypto exportKey('raw').
        raw = pub.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        fingerprint = hashlib.sha256(raw).hexdigest()[:16]
        pub_b64     = base64.b64encode(raw).decode("ascii")

        # Private key → PEM (PKCS#8), kept out of the bundle.
        priv_pem = priv.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        key_file = keys_dir / f"ring0-root-{i+1}.private.pem"
        key_file.write_bytes(priv_pem)

        root_id = f"ring0-root-{i+1}"
        roots.append({
            "id": root_id,
            "name": f"WebGPU-OS Ring-0 Root {i+1}",
            "publicKey": pub_b64,
            "fingerprint": fingerprint,
            "algorithm": "ECDSA-P256",
        })
        print(f"[trust] root {i+1}: fp={fingerprint}  priv={key_file}")

    payload = {
        "format": "os-trust-roots-v1",
        "comment": ("Ring-0 root public keys baked into the OS bundle. Private keys "
                    "live in .trust-keys/ and never ship. Regenerate with "
                    "`python bundle_engine.py --gen-roots N`."),
        "generatedAt": _utc_now_iso(),
        "roots": roots,
    }
    roots_path.parent.mkdir(parents=True, exist_ok=True)
    roots_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(f"[trust] Wrote {len(roots)} public root(s) -> {roots_path}")
    print(f"[trust] Private keys -> {keys_dir}  (KEEP SECRET; not bundled)")
    print("[trust] Add '.trust-keys/' to .gitignore if not already ignored.")


def issue_publisher_cert(pubkey_b64, subject, root_id=None, out_path=None):
    """Issue a publisher certificate signed by a ring-0 root private key.

    The OS's TrustStore.verifyChain() trusts a publisher cert that (a) names a
    known root as issuer and (b) carries an issuer signature over the cert's
    canonical bytes that verifies against the root's public key.

    CRITICAL compatibility details (must match the OS exactly):
      * Canonical payload == TrustStore._certPayload(cert): JSON of the cert
        WITHOUT issuerSig, keys sorted, no whitespace, ASCII-escaped. We
        reproduce that with json.dumps(sort_keys=True, separators=(',',':')).
      * Signature == WebCrypto ECDSA P-256 / SHA-256, which is RAW r||s (P1363,
        64 bytes), NOT DER. cryptography emits DER, so we decode + re-encode raw.
    """
    try:
        from cryptography.hazmat.primitives import serialization, hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    except ImportError:
        print("[trust] ERROR: the 'cryptography' package is required. pip install cryptography")
        return

    if not pubkey_b64 or not subject:
        print("[trust] --issue-cert requires --cert-pubkey <base64> and --cert-subject <name>")
        print("[trust] Get the public key from the OS: Package Manager → Install → Show publisher key.")
        return

    roots_path = ROOT / "webgpu-os" / "kernel" / "trust" / "roots.json"
    if not roots_path.is_file():
        print("[trust] No roots.json found. Run `--gen-roots N` first.")
        return
    try:
        roots_data = json.loads(roots_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[trust] Could not read roots.json: {e}")
        return
    roots = roots_data.get("roots") or []
    if not roots:
        print("[trust] roots.json has no roots. Run `--gen-roots N` first.")
        return

    root = next((r for r in roots if r.get("id") == root_id), None) if root_id else roots[0]
    if not root:
        known = ", ".join(r.get("id", "?") for r in roots)
        print(f"[trust] root '{root_id}' not found. Known roots: {known}")
        return

    rid = root["id"]
    priv_path = ROOT / ".trust-keys" / f"{rid}.private.pem"
    if not priv_path.is_file():
        print(f"[trust] Root private key not found: {priv_path}")
        print("[trust] (Public roots ship in the bundle; the matching private key must exist locally to issue certs.)")
        return

    try:
        priv = serialization.load_pem_private_key(priv_path.read_bytes(), password=None)
    except Exception as e:
        print(f"[trust] Could not load root private key: {e}")
        return

    try:
        pub_raw = base64.b64decode(pubkey_b64, validate=True)
    except Exception:
        print("[trust] --cert-pubkey is not valid base64.")
        return
    pub_fp = hashlib.sha256(pub_raw).hexdigest()[:16]

    # Cert WITHOUT issuerSig (this is exactly what the OS re-serializes to verify).
    cert = {
        "format": "prcert-v1",
        "subject": subject,
        "publicKey": pubkey_b64,
        "fingerprint": pub_fp,
        "issuer": root.get("name", rid),
        "issuerFingerprint": root["fingerprint"],
        "algorithm": "ECDSA-P256",
        "issuedAt": _utc_now_iso(),
        "selfSigned": False,
    }
    canonical = json.dumps(cert, sort_keys=True, separators=(",", ":"))

    der = priv.sign(canonical.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    r_int, s_int = decode_dss_signature(der)
    raw_sig = r_int.to_bytes(32, "big") + s_int.to_bytes(32, "big")   # P1363 r||s
    cert["issuerSig"] = base64.b64encode(raw_sig).decode("ascii")

    out = Path(out_path) if out_path else (ROOT / ".trust-keys" / f"{subject}.prcert.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cert, indent=2) + "\n", encoding="utf-8")

    print(f"[trust] Issued publisher cert for '{subject}'")
    print(f"[trust]   publisher fp : {pub_fp}")
    print(f"[trust]   signed by    : {rid} ({root['fingerprint']})")
    print(f"[trust]   -> {out}")
    print("[trust] Import it into the OS: Package Manager → Install → Import publisher cert.")
    print("[trust] Then 'Package v2' attaches it automatically and the package verifies as TRUSTED.")


def _utc_now_iso():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---- Official (ring-0 signed) app packages ----------------------------------

# The browser CANNOT sign with the ring-0 root key (it never ships). So at build
# time we package every built-in app, sign it with the root private key, and bake
# the resulting official `.prpkg` (container + envelope) into the bundle under
# globalThis.__OS_OFFICIAL_PACKAGES__. PackageManager.exportPackageV2 emits that
# pre-signed artifact for built-ins, so exported official apps verify as TRUSTED
# (chain-to-root) instead of being re-signed with the local, self-signed identity.
#
# Cross-language compatibility (must match the OS JS exactly):
#   * AES-GCM key  = SHA-256("webgpu-os/ring0/prpkg/v2/default-wrap-key")  (PackageCrypto._aesKey)
#   * Container    = PRPKG2 frame: "PRPKG2"|0x02|0x01|IV(12)|ciphertext+tag, AAD="id@version"
#   * Inner payload= gzip(JSON{manifest,blockmap,files})  (DecompressionStream('gzip'))
#   * Hashed/signed JSON uses compact, NON-ASCII-preserving form == JS JSON.stringify
#   * blockmap signature payload == JSON.stringify(blockmap, Object.keys(blockmap).sort()):
#       a key-array replacer, so nested objects (files) collapse to {} — replicated below.
#   * Signature    = ECDSA P-256 / SHA-256, RAW r||s (P1363, 64 bytes), NOT DER.

OFFICIAL_PKG_INCLUDE_EXTS = {".js", ".mjs", ".css", ".html", ".json", ".svg", ".wgsl", ".txt", ".md"}
# This is a build-integrity guard, not a user-file limit. Built-in source that
# exceeds it must fail the release explicitly; it must never be silently omitted
# from a package that the OS will later describe as complete and trusted.
OFFICIAL_PKG_MAX_FILE     = 16 * 1024 * 1024
PRPKG_DEFAULT_KEY_MATERIAL = b"webgpu-os/ring0/prpkg/v2/default-wrap-key"
# Publisher signing-cert lifetime. Mirrors the CA/Browser Forum's 2026 max for
# code-signing certs (~460 days). The publisher key rotates every build; the OS
# rejects packages whose cert is outside [notBefore, notAfter] (date-based trust).
OFFICIAL_CERT_VALIDITY_DAYS = 460
OFFICIAL_FALLBACK_MIN_VALIDITY_DAYS = 30
ARTIFACT_STUDIO_PACKAGE_ID = "os.navi-faculty.artifact-studio"
ARTIFACT_STUDIO_FACULTY_ID = "faculty:particle-realms:artifact-studio"
ARTIFACT_STUDIO_VERSION_BASE = "1.0.0"
# Backward-compatible family version for callers that construct unsigned test
# fixtures. Official signed packages receive a deterministic content-addressed
# build revision derived from their complete reviewed authority contract.
ARTIFACT_STUDIO_VERSION = ARTIFACT_STUDIO_VERSION_BASE
ARTIFACT_STUDIO_PUBLISHER_ID = "organization:particle-realms"
ARTIFACT_STUDIO_SOURCE_PATH = "files/artifact-studio.faculty.js"
ARTIFACT_STUDIO_DESCRIPTOR_HASHES = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "ArtifactStudioDescriptorHashes.json"
)
ARTIFACT_STUDIO_FACULTY_MODULE = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "ArtifactStudioFaculty.js"
)
ARTIFACT_STUDIO_GENERATED_MODULE = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "ArtifactStudioFacultyPackage.generated.js"
)
BROWSER_SEMANTIC_PACKAGE_ID = "os.navi-faculty.browser-semantic"
BROWSER_SEMANTIC_FACULTY_ID = "faculty:particle-realms:browser-semantic"
BROWSER_SEMANTIC_VERSION_BASE = "1.3.0"
BROWSER_SEMANTIC_VERSION = BROWSER_SEMANTIC_VERSION_BASE
BROWSER_SEMANTIC_PUBLISHER_ID = "organization:particle-realms"
BROWSER_SEMANTIC_SOURCE_PATH = "files/browser-semantic.faculty.js"
BROWSER_SEMANTIC_NETWORK_BYTES_PER_CALL = 4 * 1024 * 1024
BROWSER_SEMANTIC_DESCRIPTOR_HASHES = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "BrowserSemanticDescriptorHashes.json"
)
BROWSER_SEMANTIC_FACULTY_MODULE = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "BrowserSemanticFaculty.js"
)
BROWSER_SEMANTIC_GENERATED_MODULE = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "BrowserSemanticFacultyPackage.generated.js"
)
BUILT_IN_TOOL_FACULTY_MODULE = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolFaculties.js"
)
BUILT_IN_TOOL_DESCRIPTOR_HASHES = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolDescriptorHashes.json"
)
BUILT_IN_TOOL_FACULTY_GENERATED_MODULE = (
    ROOT / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolFacultyPackages.generated.js"
)


def verify_live_descriptor_fixtures(root):
    """Check real browser descriptor hashes without rewriting supplied fixtures."""
    resolved_root = Path(root).resolve()
    helper = resolved_root / "tests/navi/run_dump_built_in_tool_descriptors.py"
    if not helper.is_file() or helper.is_symlink() or not helper.resolve().is_relative_to(resolved_root):
        raise RuntimeError(f"live built-in descriptor verifier is missing or unsafe: {helper}")
    try:
        completed = subprocess.run(
            [sys.executable, "-B", str(helper), "--verify"], cwd=resolved_root,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f"live built-in descriptor verification failed: {error}") from error
    if completed.returncode:
        raise RuntimeError("live built-in descriptor verification failed: " +
                           (completed.stderr.strip() or completed.stdout.strip()))
    try:
        receipt = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("live built-in descriptor verifier returned malformed JSON") from error
    if (not isinstance(receipt, dict) or receipt.get("format") != "built-in-tool-descriptor-verify-v1"
            or receipt.get("status") != "PASS" or not isinstance(receipt.get("counts"), dict)
            or set(receipt["counts"]) != {"generic", "artifactStudio", "browserSemantic"}
            or any(type(count) is not int or count < 1 for count in receipt["counts"].values())):
        raise RuntimeError("live built-in descriptor verifier returned unsupported evidence")
    print(f"[official] verified live descriptor fixtures without writes ({sum(receipt['counts'].values())} descriptors)")
    return receipt


def _synchronize_live_descriptor_fixtures(root, *, required):
    """Refresh signed Faculty fixtures from the browser's live descriptors.

    Static Python parsing still verifies catalog ownership and coverage, but it
    cannot reproduce browser-native descriptor normalization. The official
    release signer therefore asks the real ES-module runtime for every portable
    descriptor hash immediately before packaging. Each fixture file is replaced
    atomically by the helper; the normal signer validation then rejects any
    malformed, missing, overlapping, or unclassified descriptor.
    """
    resolved_root = Path(root).resolve()
    if resolved_root != ROOT.resolve():
        # Unit tests use isolated fixture roots. Their explicit JSON records are
        # the test input and must not be rewritten from the working repository.
        return None
    helper = resolved_root / "tests" / "navi" / "run_dump_built_in_tool_descriptors.py"
    if not helper.is_file():
        message = f"live built-in descriptor synchronizer is missing: {helper}"
        if required:
            raise RuntimeError(message)
        print(f"[official] {message} — retaining reviewed fixtures")
        return None
    try:
        completed = subprocess.run(
            [sys.executable, str(helper), "--sync"],
            cwd=resolved_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        if required:
            raise RuntimeError(f"live built-in descriptor synchronization failed: {error}") from error
        print(f"[official] live descriptor synchronization unavailable ({error}) — retaining reviewed fixtures")
        return None
    output = completed.stdout.strip()
    if completed.returncode != 0:
        detail = completed.stderr.strip() or output or "browser descriptor helper failed"
        if required:
            raise RuntimeError(f"live built-in descriptor synchronization failed: {detail}")
        print(f"[official] live descriptor synchronization unavailable ({detail}) — retaining reviewed fixtures")
        return None
    try:
        receipt = json.loads(output)
    except json.JSONDecodeError as error:
        if required:
            raise RuntimeError("live descriptor synchronizer returned malformed JSON") from error
        print("[official] live descriptor synchronizer returned malformed JSON — retaining reviewed fixtures")
        return None
    counts = receipt.get("counts") if isinstance(receipt, dict) else None
    if (not isinstance(receipt, dict)
            or receipt.get("format") != "built-in-tool-descriptor-sync-v1"
            or not isinstance(counts, dict)):
        raise RuntimeError("live descriptor synchronizer returned an unsupported receipt")
    print(
        "[official] synchronized live descriptor fixtures "
        f"(generic={counts.get('generic', 0)}, artifact={counts.get('artifactStudio', 0)}, "
        f"browser={counts.get('browserSemantic', 0)}, changed={len(receipt.get('changed') or [])})"
    )
    return receipt


def _js_json(obj):
    """Compact JSON matching JS JSON.stringify (no spaces, non-ASCII preserved)."""
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def _sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def _prpkg_merkle_root(file_hashes):
    """Replicate PackageVerifier.merkleRoot — order-independent (paths sorted)."""
    paths = sorted(file_hashes.keys())
    if not paths:
        return None
    level = [_sha256_hex(f"leaf:{p}:{file_hashes[p]}".encode("utf-8")) for p in paths]
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            a = level[i]
            b = level[i + 1] if i + 1 < len(level) else level[i]  # duplicate last if odd
            nxt.append(_sha256_hex(f"node:{a}:{b}".encode("utf-8")))
        level = nxt
    return level[0]


def _canonical_json(value):
    """RFC-8785-style JSON used by engine/state/util/canonical.js for these ASCII fixtures."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _tagged_hash(value, domain, schema):
    canonical = f"{domain}\0{schema}\0{_canonical_json(value)}".encode("utf-8")
    return f"sha256:256:{_sha256_hex(canonical)}"


def _content_addressed_faculty_version(base_version, material):
    """Return a stable immutable Faculty revision for reviewed build inputs.

    Build timestamps, certificates, signatures, IVs, and encrypted containers
    deliberately remain outside ``material``. Rebuilding identical reviewed
    inputs therefore keeps the same identity, while any executable, descriptor,
    schema, authority, test, failure, or resource-contract change creates a new
    installable version instead of colliding with a persisted immutable record.
    """
    base = str(base_version)
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", base):
        raise RuntimeError("Faculty base version must be a canonical release semver")
    revision = _sha256_hex(_canonical_json(material).encode("utf-8"))
    return f"{base}+rev.{revision[:16]}", f"sha256:256:{revision}"


def _ecdsa_raw_b64(private_key, payload):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    der = private_key.sign(payload, ec.ECDSA(hashes.SHA256()))
    r_int, s_int = decode_dss_signature(der)
    raw = r_int.to_bytes(32, "big") + s_int.to_bytes(32, "big")
    return base64.b64encode(raw).decode("ascii")


def _ecdsa_raw_b64url(private_key, payload):
    return base64.urlsafe_b64encode(base64.b64decode(_ecdsa_raw_b64(private_key, payload))).decode("ascii").rstrip("=")


def _raw_p256_signature_der(value, *, urlsafe=False):
    """Decode one canonical raw P-256 r||s signature into DER for verification."""
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

    if not isinstance(value, str) or not value:
        raise RuntimeError("Official package signature must be a non-empty string")
    try:
        if urlsafe:
            padding = "=" * ((4 - len(value) % 4) % 4)
            raw = base64.b64decode(value + padding, altchars=b"-_", validate=True)
        else:
            raw = base64.b64decode(value, validate=True)
    except Exception as error:
        raise RuntimeError("Official package signature is not canonical base64") from error
    if len(raw) != 64:
        raise RuntimeError("Official package P-256 signature must be raw 64-byte r||s")
    return encode_dss_signature(
        int.from_bytes(raw[:32], "big"),
        int.from_bytes(raw[32:], "big"),
    )


def _parse_utc_timestamp(value, label):
    if not isinstance(value, str) or not value.endswith("Z"):
        raise RuntimeError(f"{label} must be a canonical UTC timestamp")
    try:
        parsed = datetime.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise RuntimeError(f"{label} must be a canonical UTC timestamp") from error
    if parsed.tzinfo is None:
        raise RuntimeError(f"{label} must include a UTC timezone")
    return parsed.astimezone(datetime.timezone.utc)


def _faculty_source_hash_domain(package_id):
    if package_id == ARTIFACT_STUDIO_PACKAGE_ID:
        return "webgpu-os:artifact-studio:faculty-source"
    if package_id == BROWSER_SEMANTIC_PACKAGE_ID:
        return "webgpu-os:browser-semantic:faculty-source"
    if package_id.startswith("os.navi-faculty.built-in-"):
        return "webgpu-os:built-in-tool-faculty:source"
    raise RuntimeError(f"Official Faculty source-hash domain is unknown for {package_id}")


def verify_official_package_record(
    record,
    roots,
    *,
    aes_key=None,
    expected_package_id=None,
    verification_time=None,
    minimum_remaining_days=0,
):
    """Cryptographically verify the exact official record that will be emitted.

    This is deliberately independent of the package constructors. It decrypts
    and reconstructs the serialized evidence, verifies both P-256 signatures,
    and recomputes every package and Faculty binding from the emitted bytes.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import gzip as _gzip

    def require_object(value, label):
        if not isinstance(value, dict):
            raise RuntimeError(f"{label} must be an object")
        return value

    def require_text(value, label):
        if not isinstance(value, str) or not value:
            raise RuntimeError(f"{label} must be a non-empty string")
        return value

    record = require_object(record, "Official package record")
    envelope = require_object(record.get("envelope"), "Official package envelope")
    manifest = require_object(envelope.get("manifest"), "Official package manifest")
    blockmap = require_object(envelope.get("blockmap"), "Official package blockmap")
    signature = require_object(envelope.get("signature"), "Official package signature")
    certificate = require_object(envelope.get("cert"), "Official package certificate")
    enc_meta = require_object(envelope.get("encMeta"), "Official package encryption metadata")
    provenance = require_object(envelope.get("provenance"), "Official package provenance")
    sbom = require_object(envelope.get("sbom"), "Official package SBOM")

    package_id = require_text(manifest.get("id"), "Official package id")
    version = require_text(record.get("version"), "Official package version")
    if expected_package_id is not None and package_id != expected_package_id:
        raise RuntimeError(f"Official package key does not match its manifest: {expected_package_id}")
    if (
        envelope.get("format") != "prpkg-v2"
        or manifest.get("format") != "prpkg-v2"
        or blockmap.get("format") != "blockmap-v1"
    ):
        raise RuntimeError(f"Official package format is invalid for {package_id}")
    if (
        manifest.get("version") != version
        or blockmap.get("packageId") != package_id
        or blockmap.get("version") != version
    ):
        raise RuntimeError(f"Official package identity or version drifted for {package_id}")

    try:
        container = base64.b64decode(require_text(record.get("container"), "Official package container"), validate=True)
    except Exception as error:
        raise RuntimeError(f"Official package container is not canonical base64 for {package_id}") from error
    if len(container) < 37 or container[:8] != b"PRPKG2\x02\x01":
        raise RuntimeError(f"Official package container header is invalid for {package_id}")
    if (
        enc_meta.get("encrypted") is not True
        or enc_meta.get("compression") != "gzip"
        or enc_meta.get("algorithm") != "AES-GCM"
    ):
        raise RuntimeError(f"Official package encryption contract is invalid for {package_id}")
    key = aes_key if aes_key is not None else hashlib.sha256(PRPKG_DEFAULT_KEY_MATERIAL).digest()
    try:
        compressed = AESGCM(key).decrypt(
            container[8:20],
            container[20:],
            f"{package_id}@{version}".encode("utf-8"),
        )
    except Exception as error:
        raise RuntimeError(f"Official package container authentication failed for {package_id}") from error
    if _sha256_hex(compressed) != enc_meta.get("payloadSha256"):
        raise RuntimeError(f"Official package payload hash drifted for {package_id}")
    try:
        payload = json.loads(_gzip.decompress(compressed).decode("utf-8"))
    except Exception as error:
        raise RuntimeError(f"Official package payload is not valid gzip JSON for {package_id}") from error
    if not isinstance(payload, dict) or set(payload) != {"manifest", "blockmap", "files"}:
        raise RuntimeError(f"Official package payload shape is invalid for {package_id}")
    if payload["manifest"] != manifest or payload["blockmap"] != blockmap:
        raise RuntimeError(f"Official package envelope does not match its encrypted payload for {package_id}")
    files = require_object(payload.get("files"), "Official package files")
    if not files or any(not isinstance(path, str) or not isinstance(content, str) for path, content in files.items()):
        raise RuntimeError(f"Official package files must be a non-empty text map for {package_id}")
    file_hashes = {path: _sha256_hex(content.encode("utf-8")) for path, content in files.items()}
    if manifest.get("files") != file_hashes or blockmap.get("files") != file_hashes:
        raise RuntimeError(f"Official package file hashes drifted for {package_id}")
    entry = require_text(manifest.get("entry"), "Official package entry")
    if entry not in files:
        raise RuntimeError(f"Official package entry is missing for {package_id}")
    merkle_root = _prpkg_merkle_root(file_hashes)
    if blockmap.get("merkleRoot") != merkle_root:
        raise RuntimeError(f"Official package Merkle root drifted for {package_id}")
    if blockmap.get("manifestHash") != _sha256_hex(_js_json(manifest).encode("utf-8")):
        raise RuntimeError(f"Official package manifest hash drifted for {package_id}")

    roots = roots.get("roots") if isinstance(roots, dict) else roots
    if not isinstance(roots, list) or not roots:
        raise RuntimeError("Official package verification requires at least one ring-0 root")
    issuer_fingerprint = require_text(
        certificate.get("issuerFingerprint"), "Official certificate issuer fingerprint"
    )
    root_record = next(
        (candidate for candidate in roots if isinstance(candidate, dict) and candidate.get("fingerprint") == issuer_fingerprint),
        None,
    )
    if root_record is None:
        raise RuntimeError(f"Official package certificate has an unknown issuer for {package_id}")
    try:
        root_raw = base64.b64decode(require_text(root_record.get("publicKey"), "Ring-0 public key"), validate=True)
        if hashlib.sha256(root_raw).hexdigest()[:16] != root_record.get("fingerprint"):
            raise RuntimeError("Ring-0 root fingerprint drifted")
        root_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), root_raw)
        cert_unsigned = dict(certificate)
        issuer_signature = cert_unsigned.pop("issuerSig", None)
        root_public.verify(
            _raw_p256_signature_der(issuer_signature),
            json.dumps(cert_unsigned, sort_keys=True, separators=(",", ":")).encode("utf-8"),
            ec.ECDSA(hashes.SHA256()),
        )
    except RuntimeError:
        raise
    except Exception as error:
        raise RuntimeError(f"Official package certificate chain is invalid for {package_id}") from error

    not_before = _parse_utc_timestamp(certificate.get("notBefore"), "Official certificate notBefore")
    not_after = _parse_utc_timestamp(certificate.get("notAfter"), "Official certificate notAfter")
    if verification_time is None:
        checked_at = datetime.datetime.now(datetime.timezone.utc)
    elif isinstance(verification_time, str):
        checked_at = _parse_utc_timestamp(verification_time, "Official verification time")
    elif isinstance(verification_time, datetime.datetime):
        if verification_time.tzinfo is None:
            raise RuntimeError("Official verification time must be timezone-aware")
        checked_at = verification_time.astimezone(datetime.timezone.utc)
    else:
        raise RuntimeError("Official verification time has an unsupported type")
    if not_before > checked_at or checked_at > not_after:
        raise RuntimeError(f"Official package certificate is outside its validity window for {package_id}")
    minimum_remaining = datetime.timedelta(days=max(0, int(minimum_remaining_days)))
    if not_after - checked_at < minimum_remaining:
        raise RuntimeError(f"Official package certificate requires renewal for {package_id}")

    try:
        publisher_raw = base64.b64decode(
            require_text(certificate.get("publicKey"), "Official publisher public key"), validate=True
        )
        publisher_fingerprint = hashlib.sha256(publisher_raw).hexdigest()[:16]
        if (
            publisher_fingerprint != certificate.get("fingerprint")
            or publisher_fingerprint != signature.get("fingerprint")
            or certificate.get("publicKey") != signature.get("pubKey")
            or signature.get("publisher") != manifest.get("publisher")
        ):
            raise RuntimeError("Publisher identity drifted")
        publisher_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), publisher_raw)
        signed_blockmap = {
            key_name: ({} if isinstance(blockmap[key_name], dict) else blockmap[key_name])
            for key_name in sorted(blockmap)
        }
        publisher_public.verify(
            _raw_p256_signature_der(signature.get("sig")),
            _js_json(signed_blockmap).encode("utf-8"),
            ec.ECDSA(hashes.SHA256()),
        )
    except RuntimeError:
        raise
    except Exception as error:
        raise RuntimeError(f"Official package publisher signature is invalid for {package_id}") from error

    materials = [{"path": path, "sha256": file_hashes[path]} for path in sorted(file_hashes)]
    actual_materials = provenance.get("materials")
    if not isinstance(actual_materials, list) or sorted(actual_materials, key=lambda item: item.get("path", "") if isinstance(item, dict) else "") != materials:
        raise RuntimeError(f"Official package provenance materials drifted for {package_id}")
    if sbom.get("package") != {"id": package_id, "version": version} or sbom.get("files") != actual_materials:
        raise RuntimeError(f"Official package SBOM drifted for {package_id}")

    revision_input_hash = None
    binding = manifest.get("naviFaculty")
    if binding is not None:
        binding = require_object(binding, "Official Faculty package binding")
        faculty = require_object(binding.get("manifest"), "Official Faculty manifest")
        signatures = faculty.get("signatures")
        if not isinstance(signatures, list) or len(signatures) != 1 or not isinstance(signatures[0], dict):
            raise RuntimeError(f"Official Faculty must contain one signature for {package_id}")
        faculty_signature = signatures[0]
        unsigned_faculty = dict(faculty)
        unsigned_faculty.pop("signatures")
        payload_hash = _tagged_hash(
            unsigned_faculty, "particle-realms.navi-contract", "navi-faculty-v1"
        )
        envelope_hash = _tagged_hash(
            faculty, "particle-realms.navi-contract.envelope", "navi-faculty-v1"
        )
        if (
            binding.get("format") != "navi-faculty-package-binding-v1"
            or binding.get("schema") != "navi-faculty-v1"
            or binding.get("facultyId") != faculty.get("facultyId")
            or binding.get("facultyVersion") != version
            or faculty.get("version") != version
            or binding.get("payloadHash") != payload_hash
            or binding.get("envelopeHash") != envelope_hash
        ):
            raise RuntimeError(f"Official Faculty package binding drifted for {package_id}")
        faculty_publisher = require_object(faculty.get("publisher"), "Official Faculty publisher")
        if (
            faculty_publisher.get("id") != manifest.get("publisher")
            or certificate.get("subject") != manifest.get("publisher")
            or faculty_signature.get("keyId") != certificate.get("keyId")
            or faculty_signature.get("signerId") != manifest.get("publisher")
            or faculty_signature.get("signedHash") != payload_hash
        ):
            raise RuntimeError(f"Official Faculty publisher binding drifted for {package_id}")
        try:
            publisher_public.verify(
                _raw_p256_signature_der(faculty_signature.get("value"), urlsafe=True),
                (
                    "particle-realms.navi-contract\0navi-faculty-v1\0"
                    + _canonical_json(unsigned_faculty)
                ).encode("utf-8"),
                ec.ECDSA(hashes.SHA256()),
            )
        except RuntimeError:
            raise
        except Exception as error:
            raise RuntimeError(f"Official Faculty signature is invalid for {package_id}") from error
        faculty_provenance = require_object(
            unsigned_faculty.get("provenance"), "Official Faculty provenance"
        )
        resource_root = f"sha256:256:{merkle_root}"
        if faculty_provenance.get("packageHash") != resource_root:
            raise RuntimeError(f"Official Faculty package hash drifted for {package_id}")
        expected_source_hash = _tagged_hash(
            files[entry], _faculty_source_hash_domain(package_id), "1"
        )
        if faculty_provenance.get("sourceHash") != expected_source_hash:
            raise RuntimeError(f"Official Faculty source hash drifted for {package_id}")
        revision_faculty = dict(unsigned_faculty)
        revision_faculty.pop("version", None)
        base_version = version.split("+rev.", 1)[0]
        expected_version, revision_input_hash = _content_addressed_faculty_version(
            base_version,
            {
                "format": "navi-faculty-revision-input-v1",
                "packageId": package_id,
                "sourcePath": entry,
                "faculty": revision_faculty,
            },
        )
        build_params = require_object(provenance.get("buildParams"), "Official package build parameters")
        if (
            expected_version != version
            or build_params.get("versionStrategy") != "content-addressed-v1"
            or build_params.get("facultyId") != faculty.get("facultyId")
            or build_params.get("revisionInputHash") != revision_input_hash
        ):
            raise RuntimeError(f"Official Faculty revision binding drifted for {package_id}")

    return {
        "packageId": package_id,
        "version": version,
        "containerSha256": _sha256_hex(container),
        "envelopeSha256": _sha256_hex(_canonical_json(envelope).encode("utf-8")),
        "recordSha256": _sha256_hex(_canonical_json(record).encode("utf-8")),
        "certificateNotBefore": certificate["notBefore"],
        "certificateNotAfter": certificate["notAfter"],
        "revisionInputHash": revision_input_hash,
    }


def verify_official_package_records(
    records,
    roots,
    *,
    aes_key=None,
    verification_time=None,
    minimum_remaining_days=0,
):
    """Verify every exact registry record and return deterministic evidence."""
    if not isinstance(records, dict) or not records:
        raise RuntimeError("Official package registry must be a non-empty object")
    return {
        package_id: verify_official_package_record(
            records[package_id],
            roots,
            aes_key=aes_key,
            expected_package_id=package_id,
            verification_time=verification_time,
            minimum_remaining_days=minimum_remaining_days,
        )
        for package_id in sorted(records)
    }


def _extract_artifact_studio_source(root):
    return _extract_static_faculty_source(
        root / "webgpu-os" / "kernel" / "navi" / "builtins" / "ArtifactStudioFaculty.js",
        "ARTIFACT_STUDIO_FACULTY_SOURCE",
        "Artifact Studio",
    )


def _extract_browser_semantic_source(root):
    return _extract_static_faculty_source(
        root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BrowserSemanticFaculty.js",
        "BROWSER_SEMANTIC_FACULTY_SOURCE",
        "Browser Semantic",
    )


def _extract_static_faculty_source(module_path, export_name, label):
    source = module_path.read_text(encoding="utf-8")
    match = re.search(
        rf"export const {re.escape(export_name)} = `([^`]*)`;",
        source,
        flags=re.DOTALL,
    )
    if not match or "${" in match.group(1):
        raise RuntimeError(f"{label} Faculty source must remain one non-interpolated template literal")
    return match.group(1)


def _artifact_studio_tool_names(root, worker_source=None):
    """Read the dedicated Artifact boundary from its canonical browser module.

    The signer never maintains a second tool list. It requires the exported
    reviewed catalog and the isolated worker allowlist to be identical, then
    binds that exact set to checked-in descriptor hashes.
    """
    module_path = root / "webgpu-os" / "kernel" / "navi" / "builtins" / "ArtifactStudioFaculty.js"
    source = module_path.read_text(encoding="utf-8")
    catalog_match = re.search(
        r"export const ARTIFACT_STUDIO_TOOL_NAMES = Object\.freeze\(\[(?P<body>.*?)\]\);",
        source,
        flags=re.DOTALL,
    )
    if not catalog_match:
        raise RuntimeError("Artifact Studio tool catalog must remain a static frozen string array")
    names = re.findall(r"['\"]([a-z0-9][a-z0-9:._/-]{0,255})['\"]", catalog_match.group("body"))
    if not names or len(names) != len(set(names)) or any(
        not name.startswith("os.ai-echo.artifacts.") for name in names
    ):
        raise RuntimeError("Artifact Studio tool catalog is empty, duplicated, or outside its namespace")
    worker = worker_source if worker_source is not None else _extract_artifact_studio_source(root)
    allowlist_match = re.search(r"const allowed=new Set\(\[(?P<body>.*?)\]\)", worker)
    worker_names = re.findall(
        r"['\"]([a-z0-9][a-z0-9:._/-]{0,255})['\"]",
        allowlist_match.group("body") if allowlist_match else "",
    )
    if worker_names != names:
        raise RuntimeError("Artifact Studio exported tool catalog and isolated worker allowlist drifted")
    return names


def _browser_semantic_tool_names(root, worker_source=None):
    """Read and cross-check the dedicated semantic-browser authority boundary."""
    module_path = root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BrowserSemanticFaculty.js"
    source = module_path.read_text(encoding="utf-8")
    catalog_match = re.search(
        r"export const BROWSER_SEMANTIC_TOOL_NAMES = Object\.freeze\(\[(?P<body>.*?)\]\);",
        source,
        flags=re.DOTALL,
    )
    if not catalog_match:
        raise RuntimeError("Browser Semantic tool catalog must remain a static frozen string array")
    names = re.findall(r"['\"]([a-z0-9][A-Za-z0-9:._/-]{0,255})['\"]", catalog_match.group("body"))
    if not names or len(names) != len(set(names)) or any(
        not name.startswith("os.ai-echo.browser.") for name in names
    ):
        raise RuntimeError("Browser Semantic tool catalog is empty, duplicated, or outside its namespace")
    worker = worker_source if worker_source is not None else _extract_browser_semantic_source(root)
    allowlist_match = re.search(r"const allowed=new Set\(\[(?P<body>.*?)\]\)", worker)
    worker_names = re.findall(
        r"['\"]([a-z0-9][A-Za-z0-9:._/-]{0,255})['\"]",
        allowlist_match.group("body") if allowlist_match else "",
    )
    if worker_names != names:
        raise RuntimeError("Browser Semantic exported tool catalog and isolated worker allowlist drifted")
    return names


def _artifact_studio_descriptor_hashes(root):
    """Load the one authoritative descriptor fixture for Artifact Studio.

    Artifact tools have a dedicated security boundary and therefore must not
    also be maintained in the generic built-in descriptor fixture. The release
    signer composes this specialized fixture into its full coverage view.
    """
    hashes_path = (
        root
        / "webgpu-os"
        / "kernel"
        / "navi"
        / "builtins"
        / "ArtifactStudioDescriptorHashes.json"
    )
    descriptor_record = json.loads(hashes_path.read_text(encoding="utf-8"))
    if descriptor_record.get("format") != "artifact-studio-descriptor-hashes-v1":
        raise RuntimeError("Artifact Studio descriptor hash fixture has an unsupported format")
    descriptor_hashes = descriptor_record.get("descriptorHashes") or {}
    expected_names = _artifact_studio_tool_names(root)
    if set(descriptor_hashes) != set(expected_names) or any(
        not re.fullmatch(r"sha256:256:[0-9a-f]{64}", str(descriptor_hashes.get(name, "")))
        for name in expected_names
    ):
        raise RuntimeError("Artifact Studio descriptor hash fixture is incomplete or malformed")
    return descriptor_hashes


def _browser_semantic_descriptor_hashes(root):
    hashes_path = (
        root
        / "webgpu-os"
        / "kernel"
        / "navi"
        / "builtins"
        / "BrowserSemanticDescriptorHashes.json"
    )
    descriptor_record = json.loads(hashes_path.read_text(encoding="utf-8"))
    if descriptor_record.get("format") != "browser-semantic-descriptor-hashes-v1":
        raise RuntimeError("Browser Semantic descriptor hash fixture has an unsupported format")
    descriptor_hashes = descriptor_record.get("descriptorHashes") or {}
    expected_names = _browser_semantic_tool_names(root)
    if set(descriptor_hashes) != set(expected_names) or any(
        not re.fullmatch(r"sha256:256:[0-9a-f]{64}", str(descriptor_hashes.get(name, "")))
        for name in expected_names
    ):
        raise RuntimeError("Browser Semantic descriptor hash fixture is incomplete or malformed")
    return descriptor_hashes


def _discover_built_in_tool_names(root):
    """Discover the browser-native tools that require release classification.

    The signer cannot execute browser ES modules, so it reads the canonical
    registration and identity sites. They deliberately use static string
    literals. A new literal appears here before it can be signed, making an
    unreviewed tool a build failure instead of a runtime-only Faculty error.
    """
    agent_path = root / "webgpu-os" / "apps" / "ai-echo" / "AgentToolset.js"
    image_identity_path = (
        root / "webgpu-os" / "apps" / "ai-echo" / "ImageGenerationIdentity.js"
    )
    driver_path = root / "webgpu-os" / "kernel" / "ToolDriver.js"
    agent_source = agent_path.read_text(encoding="utf-8")
    image_identity_source = image_identity_path.read_text(encoding="utf-8")
    driver_source = driver_path.read_text(encoding="utf-8")
    suffixes = [match[1] for match in re.findall(
        r"\btool\(\s*(['\"])([a-z0-9][A-Za-z0-9._/-]{0,255})\1",
        agent_source,
    )]
    init_match = re.search(
        r"\n\s*init\(\)\s*\{(?P<body>.*?)\n\s*return this;",
        driver_source,
        flags=re.DOTALL,
    )
    if not init_match:
        raise RuntimeError("ToolDriver.init must remain statically discoverable by the release signer")
    kernel_names = [match[1] for match in re.findall(
        r"\bname:\s*(['\"])([a-z0-9][a-z0-9:._/-]{0,255})\1",
        init_match.group("body"),
    )]
    image_name_matches = re.findall(
        r"export const (AI_ECHO_IMAGE_(?:GENERATION|ROUTE)_TOOL)\s*=\s*"
        r"(['\"])([a-z0-9][a-z0-9:._/-]{0,255})\2\s*;",
        image_identity_source,
    )
    image_names_by_constant = {
        constant: name for constant, _quote, name in image_name_matches
    }
    expected_image_constants = {
        "AI_ECHO_IMAGE_GENERATION_TOOL",
        "AI_ECHO_IMAGE_ROUTE_TOOL",
    }
    if set(image_names_by_constant) != expected_image_constants:
        raise RuntimeError(
            "AI Echo image tool identities must remain exact static string exports"
        )
    image_names = [
        image_names_by_constant[constant]
        for constant in sorted(expected_image_constants)
    ]
    names = [f"os.ai-echo.{suffix}" for suffix in suffixes] + kernel_names + image_names
    if not suffixes or not kernel_names or len(names) != len(set(names)):
        raise RuntimeError("Built-in tool registration contains no tools or duplicate static names")
    return set(names)


def _built_in_tool_faculty_inputs(root):
    module_path = root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolFaculties.js"
    source = module_path.read_text(encoding="utf-8")
    definitions_match = re.search(
        r"export const BUILT_IN_TOOL_FACULTY_DEFINITIONS_JSON = `([^`]*)`;",
        source,
        flags=re.DOTALL,
    )
    worker_match = re.search(
        r"export const BUILT_IN_TOOL_FACULTY_SOURCE = `([^`]*)`;",
        source,
        flags=re.DOTALL,
    )
    exclusions_match = re.search(
        r"export const BUILT_IN_TOOL_FACULTY_EXCLUSIONS_JSON = `([^`]*)`;",
        source,
        flags=re.DOTALL,
    )
    if not definitions_match or "${" in definitions_match.group(1):
        raise RuntimeError("Built-in tool Faculty definitions must remain one non-interpolated JSON literal")
    if not worker_match or "${" in worker_match.group(1):
        raise RuntimeError("Built-in tool Faculty source must remain one non-interpolated template literal")
    if not exclusions_match or "${" in exclusions_match.group(1):
        raise RuntimeError("Built-in tool Faculty exclusions must remain one non-interpolated JSON literal")
    definitions = json.loads(definitions_match.group(1))
    exclusions = json.loads(exclusions_match.group(1))
    descriptor_record = json.loads((
        root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolDescriptorHashes.json"
    ).read_text(encoding="utf-8"))
    if descriptor_record.get("format") != "built-in-tool-descriptor-hashes-v1":
        raise RuntimeError("Built-in tool descriptor hash fixture has an unsupported format")
    generic_descriptor_hashes = descriptor_record.get("descriptorHashes") or {}
    artifact_descriptor_hashes = _artifact_studio_descriptor_hashes(root)
    browser_descriptor_hashes = _browser_semantic_descriptor_hashes(root)
    duplicate_specialized = (
        set(generic_descriptor_hashes).intersection(artifact_descriptor_hashes)
        | set(generic_descriptor_hashes).intersection(browser_descriptor_hashes)
        | set(artifact_descriptor_hashes).intersection(browser_descriptor_hashes)
    )
    if duplicate_specialized:
        raise RuntimeError(
            "Dedicated Faculty descriptors must have one authority source and cannot overlap "
            f"(duplicates={sorted(duplicate_specialized)})"
        )
    descriptor_hashes = {
        **generic_descriptor_hashes,
        **artifact_descriptor_hashes,
        **browser_descriptor_hashes,
    }
    discovered_tools = _discover_built_in_tool_names(root)
    fixture_tools = set(descriptor_hashes)
    if discovered_tools != fixture_tools:
        raise RuntimeError(
            "Built-in tool descriptor hashes are stale; regenerate them before signing "
            f"(unhashed={sorted(discovered_tools - fixture_tools)}, "
            f"unregistered={sorted(fixture_tools - discovered_tools)})"
        )
    if not isinstance(definitions, list) or not definitions:
        raise RuntimeError("Built-in tool Faculty catalog is empty")
    seen_keys = set()
    seen_tools = set()
    for definition in definitions:
        key = str(definition.get("key", ""))
        tools = definition.get("tools") or []
        network_destinations = definition.get("networkDestinations", [])
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", key) or key in seen_keys:
            raise RuntimeError("Built-in tool Faculty keys must be unique canonical identifiers")
        if not tools or len(tools) != len(set(tools)):
            raise RuntimeError(f"Built-in tool Faculty '{key}' has an empty or duplicate tool list")
        if (
            not isinstance(network_destinations, list)
            or len(network_destinations) != len(set(network_destinations))
            or any(
                not isinstance(destination, str)
                or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,127}", destination)
                for destination in network_destinations
            )
        ):
            raise RuntimeError(
                f"Built-in tool Faculty '{key}' has invalid network destinations"
            )
        for resource_name in ("networkBytes", "storageBytes"):
            if resource_name not in definition:
                continue
            resource_value = definition[resource_name]
            if (
                isinstance(resource_value, bool)
                or not isinstance(resource_value, int)
                or resource_value <= 0
                or resource_value > (2 ** 53 - 1)
            ):
                raise RuntimeError(
                    f"Built-in tool Faculty '{key}' has an invalid {resource_name} ceiling"
                )
        if network_destinations and "networkBytes" not in definition:
            raise RuntimeError(
                f"Built-in tool Faculty '{key}' has destinations without a network-byte ceiling"
            )
        overlap = seen_tools.intersection(tools)
        if overlap:
            raise RuntimeError(f"Built-in tool Faculties overlap: {sorted(overlap)}")
        for name in tools:
            if not re.fullmatch(r"[a-z0-9][A-Za-z0-9:._/-]{0,255}", str(name)):
                raise RuntimeError(f"Built-in tool Faculty '{key}' has an invalid tool name")
            if not re.fullmatch(r"sha256:256:[0-9a-f]{64}", str(descriptor_hashes.get(name, ""))):
                raise RuntimeError(f"Built-in tool Faculty '{key}' lacks a valid descriptor hash for {name}")
        seen_keys.add(key)
        seen_tools.update(tools)
    if not isinstance(exclusions, list) or not exclusions:
        raise RuntimeError("Built-in tool Faculty exclusions must be a non-empty ownership list")
    exclusion_owners = {}
    for exclusion in exclusions:
        if not isinstance(exclusion, dict) or set(exclusion) != {"tool", "owner"}:
            raise RuntimeError("Built-in tool Faculty exclusions require exact tool and owner fields")
        tool_name = str(exclusion.get("tool", ""))
        owner = str(exclusion.get("owner", ""))
        if (
            not re.fullmatch(r"[a-z0-9][A-Za-z0-9:._/-]{0,255}", tool_name)
            or not re.fullmatch(r"(?:os\.navi-faculty\.[a-z0-9][a-z0-9.-]{0,127}|policy:[a-z0-9][a-z0-9-]{0,63})", owner)
            or tool_name in exclusion_owners
        ):
            raise RuntimeError("Built-in tool Faculty exclusions contain an invalid or duplicate ownership record")
        exclusion_owners[tool_name] = owner
    excluded_tools = set(exclusion_owners)
    artifact_tools = set(artifact_descriptor_hashes)
    browser_tools = set(browser_descriptor_hashes)
    if any(exclusion_owners.get(name) != ARTIFACT_STUDIO_PACKAGE_ID for name in artifact_tools):
        raise RuntimeError(
            "Artifact Studio descriptors must remain owned by its dedicated signed Faculty "
            f"(misowned={sorted(name for name in artifact_tools if exclusion_owners.get(name) != ARTIFACT_STUDIO_PACKAGE_ID)})"
        )
    if any(exclusion_owners.get(name) != BROWSER_SEMANTIC_PACKAGE_ID for name in browser_tools):
        raise RuntimeError(
            "Browser Semantic descriptors must remain owned by its dedicated signed Faculty "
            f"(misowned={sorted(name for name in browser_tools if exclusion_owners.get(name) != BROWSER_SEMANTIC_PACKAGE_ID)})"
        )
    overlap = seen_tools.intersection(excluded_tools)
    if overlap:
        raise RuntimeError(f"Built-in tools cannot be both signed and excluded: {sorted(overlap)}")
    known_tools = set(descriptor_hashes)
    missing = known_tools.difference(seen_tools).difference(excluded_tools)
    unknown = seen_tools.union(excluded_tools).difference(known_tools)
    if missing or unknown:
        raise RuntimeError(
            "Built-in tool Faculty coverage changed; review and classify every descriptor "
            f"(missing={sorted(missing)}, unknown={sorted(unknown)})"
        )
    return definitions, worker_match.group(1), descriptor_hashes


def _issue_ephemeral_publisher(root_record, root_private_key, subject, built_at, not_after):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    publisher_private = ec.generate_private_key(ec.SECP256R1())
    public_raw = publisher_private.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    public_b64 = base64.b64encode(public_raw).decode("ascii")
    fingerprint = hashlib.sha256(public_raw).hexdigest()[:16]
    cert = {
        "algorithm": "ECDSA-P256",
        "fingerprint": fingerprint,
        "format": "prcert-v1",
        "issuedAt": built_at,
        "issuer": root_record.get("name", root_record["id"]),
        "issuerFingerprint": root_record["fingerprint"],
        "keyId": fingerprint,
        "notAfter": not_after,
        "notBefore": built_at,
        "publicKey": public_b64,
        "selfSigned": False,
        "subject": subject,
    }
    cert_payload = json.dumps(cert, sort_keys=True, separators=(",", ":")).encode("utf-8")
    cert["issuerSig"] = _ecdsa_raw_b64(root_private_key, cert_payload)
    return publisher_private, public_raw, public_b64, fingerprint, cert


def _build_dedicated_faculty_official_package(
    root_record,
    root_private_key,
    aes_key,
    built_at,
    *,
    spec,
    descriptor_hashes,
    worker_source,
    tool_names,
    projection_only=False,
):
    """Build one exact ring-0 chained deterministic Faculty package."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import gzip as _gzip
    import datetime as _dt

    if not tool_names or set(descriptor_hashes) != set(tool_names):
        raise RuntimeError(f"{spec['name']} descriptor authority is incomplete")
    files = {spec["sourcePath"]: worker_source}
    file_hashes = {path: _sha256_hex(content.encode("utf-8")) for path, content in files.items()}
    resource_root = _prpkg_merkle_root(file_hashes)
    package_hash = f"sha256:256:{resource_root}"
    source_hash = _tagged_hash(
        worker_source,
        spec["sourceHashDomain"],
        "1",
    )

    now_dt = _dt.datetime.now(_dt.timezone.utc)
    not_after = (now_dt + _dt.timedelta(days=OFFICIAL_CERT_VALIDITY_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    unsigned_faculty = {
        "schema": "navi-faculty-v1",
        "facultyId": spec["facultyId"],
        "name": spec["name"],
        "kind": "deterministic-tool-adapter",
        "publisher": {"kind": "organization", "id": spec["publisherId"]},
        "provenance": {
            "sourceHash": source_hash,
            "packageHash": package_hash,
            "buildReceiptRef": spec["buildReceiptRef"],
            "license": "LicenseRef-ParticleRealms-Alpha",
        },
        "inputs": [{
            "name": "request",
            "mediaType": "application/json",
            "schemaRef": spec["inputSchemaRef"],
            "required": True,
        }],
        "outputs": [{
            "name": "result",
            "mediaType": "application/json",
            "schemaRef": spec["outputSchemaRef"],
        }],
        "requiredDomains": list(spec["domains"]),
        "readableDataClasses": list(spec["readable"]),
        "writableDataClasses": list(spec["writable"]),
        "tools": [{
            "descriptorId": name,
            "descriptorHash": descriptor_hashes[name],
            "maxCalls": 1,
        } for name in tool_names],
        "models": [],
        "networkDestinations": [],
        "expectedCost": dict(spec["expectedCost"]),
        "tests": [{
            "testId": spec["testId"],
            "fixtureHash": source_hash,
            "expectedHash": descriptor_hashes[spec["testTool"]],
        }],
        "failureBehavior": "fail-closed",
        "rollbackProcedureRef": None,
        "compatibility": {
            "minOsVersion": "1.0.0",
            "contractVersions": ["navi-faculty-v1"],
        },
        "enabledByDefault": bool(spec["enabledByDefault"]),
    }
    version, revision_input_hash = _content_addressed_faculty_version(
        spec["versionBase"],
        {
            "format": "navi-faculty-revision-input-v1",
            "packageId": spec["packageId"],
            "sourcePath": spec["sourcePath"],
            "faculty": unsigned_faculty,
        },
    )
    if projection_only:
        return {"version": version, "revisionInputHash": revision_input_hash}
    pub_priv, pub_raw, pub_b64, pub_fp, cert = _issue_ephemeral_publisher(
        root_record, root_private_key, spec["publisherId"], built_at, not_after,
    )
    unsigned_faculty["version"] = version
    signing_text = (
        "particle-realms.navi-contract\0navi-faculty-v1\0"
        + _canonical_json(unsigned_faculty)
    ).encode("utf-8")
    payload_hash = _tagged_hash(
        unsigned_faculty,
        "particle-realms.navi-contract",
        "navi-faculty-v1",
    )
    faculty = dict(unsigned_faculty)
    faculty["signatures"] = [{
        "algorithm": "ECDSA-P256-SHA256",
        "keyId": cert["keyId"],
        "signerId": spec["publisherId"],
        "signedAt": built_at,
        "signedHash": payload_hash,
        "scope": "navi-contract-v1",
        "value": _ecdsa_raw_b64url(pub_priv, signing_text),
    }]
    envelope_hash = _tagged_hash(
        faculty,
        "particle-realms.navi-contract.envelope",
        "navi-faculty-v1",
    )
    binding = {
        "format": "navi-faculty-package-binding-v1",
        "schema": "navi-faculty-v1",
        "facultyId": spec["facultyId"],
        "facultyVersion": version,
        "payloadHash": payload_hash,
        "envelopeHash": envelope_hash,
        "manifest": faculty,
    }

    manifest = {
        "format": "prpkg-v2",
        "id": spec["packageId"],
        "name": spec["packageName"],
        "version": version,
        "publisher": spec["publisherId"],
        "entry": spec["sourcePath"],
        "icon": None,
        "category": "utility",
        "description": spec["description"],
        "surface": "window",
        "permissions": [],
        "capabilities": [],
        "commands": {},
        "tags": list(spec["tags"]),
        "keywords": list(spec["keywords"]),
        "defaultWidth": None,
        "defaultHeight": None,
        "sizingHint": None,
        "files": file_hashes,
        "naviFaculty": binding,
    }
    manifest_hash = _sha256_hex(_js_json(manifest).encode("utf-8"))
    blockmap = {
        "format": "blockmap-v1",
        "packageId": spec["packageId"],
        "version": version,
        "files": file_hashes,
        "merkleRoot": resource_root,
        "manifestHash": manifest_hash,
        "builtAt": built_at,
    }
    payload = _js_json({"manifest": manifest, "blockmap": blockmap, "files": files}).encode("utf-8")
    gz = _gzip.compress(payload)
    payload_sha = _sha256_hex(gz)
    iv = os.urandom(12)
    ciphertext = AESGCM(aes_key).encrypt(
        iv,
        gz,
        f"{spec['packageId']}@{version}".encode("utf-8"),
    )
    container = bytes([0x50, 0x52, 0x50, 0x4B, 0x47, 0x32, 0x02, 0x01]) + iv + ciphertext
    signed_blockmap = {key: ({} if isinstance(blockmap[key], dict) else blockmap[key]) for key in sorted(blockmap)}
    signature = {
        "algorithm": "ECDSA-P256",
        "publisher": spec["publisherId"],
        "fingerprint": pub_fp,
        "pubKey": pub_b64,
        "sig": _ecdsa_raw_b64(pub_priv, _js_json(signed_blockmap).encode("utf-8")),
        "signedAt": built_at,
    }
    materials = [{"path": path, "sha256": digest} for path, digest in file_hashes.items()]
    provenance = {
        "builderId": "webgpu-os/bundler",
        "sourceRef": spec["sourceRef"],
        "builtAt": built_at,
        "buildParams": {
            "official": True,
            "facultyId": spec["facultyId"],
            "versionStrategy": "content-addressed-v1",
            "revisionInputHash": revision_input_hash,
        },
        "materials": materials,
    }
    sbom = {
        "format": "sbom-v1",
        "package": {"id": spec["packageId"], "version": version},
        "generatedAt": built_at,
        "files": materials,
        "dependencies": {"requires": [], "recommends": []},
        "permissions": [],
        "capabilities": [],
    }
    envelope = {
        "format": "prpkg-v2",
        "manifest": manifest,
        "blockmap": blockmap,
        "signature": signature,
        "cert": cert,
        "encMeta": {
            "encrypted": True,
            "compression": "gzip",
            "payloadSha256": payload_sha,
            "algorithm": "AES-GCM",
        },
        "provenance": provenance,
        "sbom": sbom,
        "lineage": None,
    }
    return {
        "version": version,
        "container": base64.b64encode(container).decode("ascii"),
        "envelope": envelope,
    }


def build_artifact_studio_official_package(root, root_record, root_private_key, aes_key, built_at, *, projection_only=False):
    """Build the exact signed Artifact Studio package from reviewed browser inputs."""
    worker_source = _extract_artifact_studio_source(root)
    tool_names = _artifact_studio_tool_names(root, worker_source)
    return _build_dedicated_faculty_official_package(
        root_record,
        root_private_key,
        aes_key,
        built_at,
        spec={
            "packageId": ARTIFACT_STUDIO_PACKAGE_ID,
            "facultyId": ARTIFACT_STUDIO_FACULTY_ID,
            "versionBase": ARTIFACT_STUDIO_VERSION_BASE,
            "publisherId": ARTIFACT_STUDIO_PUBLISHER_ID,
            "sourcePath": ARTIFACT_STUDIO_SOURCE_PATH,
            "sourceRef": "webgpu-os/kernel/navi/builtins/ArtifactStudioFaculty.js",
            "sourceHashDomain": "webgpu-os:artifact-studio:faculty-source",
            "name": "Artifact Studio",
            "packageName": "Artifact Studio Faculty",
            "description": "Signed deterministic adapter for AI Echo Artifact Workspace tools.",
            "inputSchemaRef": "artifact-studio-request-v1",
            "outputSchemaRef": "artifact-studio-result-v1",
            "domains": ["creative", "files"],
            "readable": ["public", "operator", "shared"],
            "writable": ["public", "operator", "shared"],
            "expectedCost": {
                "toolCalls": 1,
                "wallTimeMs": 30000,
                "storageBytes": 16 * 1024 * 1024,
                "workerCount": 1,
            },
            "testId": "test:artifact-studio-built-in",
            "testTool": "os.ai-echo.artifacts.create",
            "buildReceiptRef": "receipt:artifact-studio-built-in:1",
            "enabledByDefault": True,
            "tags": ["navi", "faculty", "artifacts"],
            "keywords": ["artifact", "workspace", "faculty"],
        },
        descriptor_hashes=_artifact_studio_descriptor_hashes(root),
        worker_source=worker_source,
        tool_names=tool_names,
        projection_only=projection_only,
    )


def build_browser_semantic_official_package(root, root_record, root_private_key, aes_key, built_at, *, projection_only=False):
    """Build Browser Semantic from its exact catalog, worker, and descriptor evidence."""
    worker_source = _extract_browser_semantic_source(root)
    tool_names = _browser_semantic_tool_names(root, worker_source)
    return _build_dedicated_faculty_official_package(
        root_record,
        root_private_key,
        aes_key,
        built_at,
        spec={
            "packageId": BROWSER_SEMANTIC_PACKAGE_ID,
            "facultyId": BROWSER_SEMANTIC_FACULTY_ID,
            "versionBase": BROWSER_SEMANTIC_VERSION_BASE,
            "publisherId": BROWSER_SEMANTIC_PUBLISHER_ID,
            "sourcePath": BROWSER_SEMANTIC_SOURCE_PATH,
            "sourceRef": "webgpu-os/kernel/navi/builtins/BrowserSemanticFaculty.js",
            "sourceHashDomain": "webgpu-os:browser-semantic:faculty-source",
            "name": "Browser Semantic Automation",
            "packageName": "Browser Semantic Automation Faculty",
            "description": "Signed deterministic adapter for extension-backed semantic browser tools.",
            "inputSchemaRef": "browser-semantic-request-v1",
            "outputSchemaRef": "browser-semantic-result-v1",
            "domains": ["devices", "network"],
            "readable": ["public", "operator", "shared"],
            "writable": ["public", "operator", "shared"],
            "expectedCost": {
                "toolCalls": 1,
                "wallTimeMs": 30000,
                "networkBytes": BROWSER_SEMANTIC_NETWORK_BYTES_PER_CALL,
            },
            "testId": "test:browser-semantic-built-in",
            "testTool": "os.ai-echo.browser.page.snapshot",
            "buildReceiptRef": "receipt:browser-semantic-built-in:1",
            "enabledByDefault": False,
            "tags": ["navi", "faculty", "browser", "semantic"],
            "keywords": ["browser", "webmcp", "automation", "faculty"],
        },
        descriptor_hashes=_browser_semantic_descriptor_hashes(root),
        worker_source=worker_source,
        tool_names=tool_names,
        projection_only=projection_only,
    )


def build_built_in_tool_faculty_packages(root, root_record, root_private_key, aes_key, built_at, *, projection_only=False):
    """Build ring-0 packages for the OS-owned deterministic tool adapters."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import gzip as _gzip
    import datetime as _dt

    definitions, worker_source, descriptor_hashes = _built_in_tool_faculty_inputs(root)
    source_hash = _tagged_hash(
        worker_source,
        "webgpu-os:built-in-tool-faculty:source",
        "1",
    )
    now_dt = _dt.datetime.now(_dt.timezone.utc)
    not_after = (now_dt + _dt.timedelta(days=OFFICIAL_CERT_VALIDITY_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    output = {}
    for definition in definitions:
        key = definition["key"]
        name = definition["name"]
        faculty_id = f"faculty:particle-realms:built-in-{key}"
        package_id = f"os.navi-faculty.built-in-{key}"
        version_base = "1.0.0"
        publisher_id = "organization:particle-realms"
        source_path = f"files/built-in-{key}.faculty.js"
        tool_names = definition["tools"]
        files = {source_path: worker_source}
        file_hashes = {path: _sha256_hex(content.encode("utf-8")) for path, content in files.items()}
        resource_root = _prpkg_merkle_root(file_hashes)
        package_hash = f"sha256:256:{resource_root}"
        unsigned_faculty = {
            "schema": "navi-faculty-v1",
            "facultyId": faculty_id,
            "name": name,
            "kind": "deterministic-tool-adapter",
            "publisher": {"kind": "organization", "id": publisher_id},
            "provenance": {
                "sourceHash": source_hash,
                "packageHash": package_hash,
                "buildReceiptRef": f"receipt:built-in-faculty:{key}:1",
                "license": "LicenseRef-ParticleRealms-Alpha",
            },
            "inputs": [{
                "name": "request",
                "mediaType": "application/json",
                "schemaRef": "built-in-tool-request-v1",
                "required": True,
            }],
            "outputs": [{
                "name": "result",
                "mediaType": "application/json",
                "schemaRef": "built-in-tool-result-v1",
            }],
            "requiredDomains": definition["domains"],
            "readableDataClasses": definition["readable"],
            "writableDataClasses": definition["writable"],
            "tools": [{
                "descriptorId": tool_name,
                "descriptorHash": descriptor_hashes[tool_name],
                "maxCalls": 1,
            } for tool_name in tool_names],
            "models": [],
            "networkDestinations": definition.get("networkDestinations", []),
            "expectedCost": {
                "toolCalls": 1,
                "wallTimeMs": 30000,
                **({"networkBytes": int(definition["networkBytes"])}
                   if "networkBytes" in definition else {}),
                "storageBytes": int(definition.get("storageBytes", 16 * 1024 * 1024)),
                "workerCount": 1,
            },
            "tests": [{
                "testId": f"test:built-in-faculty:{key}",
                "fixtureHash": source_hash,
                "expectedHash": descriptor_hashes[tool_names[0]],
            }],
            "failureBehavior": "fail-closed",
            "rollbackProcedureRef": None,
            "compatibility": {
                "minOsVersion": "1.0.0",
                "contractVersions": ["navi-faculty-v1"],
            },
            "enabledByDefault": True,
        }
        version, revision_input_hash = _content_addressed_faculty_version(
            version_base,
            {
                "format": "navi-faculty-revision-input-v1",
                "packageId": package_id,
                "sourcePath": source_path,
                "faculty": unsigned_faculty,
            },
        )
        if projection_only:
            output[package_id] = {"version": version, "revisionInputHash": revision_input_hash}
            continue
        pub_priv, _pub_raw, pub_b64, pub_fp, cert = _issue_ephemeral_publisher(
            root_record, root_private_key, publisher_id, built_at, not_after,
        )
        unsigned_faculty["version"] = version
        signing_text = (
            "particle-realms.navi-contract\0navi-faculty-v1\0"
            + _canonical_json(unsigned_faculty)
        ).encode("utf-8")
        payload_hash = _tagged_hash(
            unsigned_faculty,
            "particle-realms.navi-contract",
            "navi-faculty-v1",
        )
        faculty = dict(unsigned_faculty)
        faculty["signatures"] = [{
            "algorithm": "ECDSA-P256-SHA256",
            "keyId": cert["keyId"],
            "signerId": publisher_id,
            "signedAt": built_at,
            "signedHash": payload_hash,
            "scope": "navi-contract-v1",
            "value": _ecdsa_raw_b64url(pub_priv, signing_text),
        }]
        envelope_hash = _tagged_hash(
            faculty,
            "particle-realms.navi-contract.envelope",
            "navi-faculty-v1",
        )
        binding = {
            "format": "navi-faculty-package-binding-v1",
            "schema": "navi-faculty-v1",
            "facultyId": faculty_id,
            "facultyVersion": version,
            "payloadHash": payload_hash,
            "envelopeHash": envelope_hash,
            "manifest": faculty,
        }
        manifest = {
            "format": "prpkg-v2",
            "id": package_id,
            "name": f"{name} Faculty",
            "version": version,
            "publisher": publisher_id,
            "entry": source_path,
            "icon": None,
            "category": "utility",
            "description": f"Signed deterministic adapter for {name.lower()} tools.",
            "surface": "window",
            "permissions": [],
            "capabilities": [],
            "commands": {},
            "tags": ["navi", "faculty", "built-in", key],
            "keywords": ["navi", "tool", "faculty", key],
            "defaultWidth": None,
            "defaultHeight": None,
            "sizingHint": None,
            "files": file_hashes,
            "naviFaculty": binding,
        }
        manifest_hash = _sha256_hex(_js_json(manifest).encode("utf-8"))
        blockmap = {
            "format": "blockmap-v1",
            "packageId": package_id,
            "version": version,
            "files": file_hashes,
            "merkleRoot": resource_root,
            "manifestHash": manifest_hash,
            "builtAt": built_at,
        }
        payload = _js_json({"manifest": manifest, "blockmap": blockmap, "files": files}).encode("utf-8")
        gz = _gzip.compress(payload)
        payload_sha = _sha256_hex(gz)
        iv = os.urandom(12)
        ciphertext = AESGCM(aes_key).encrypt(
            iv,
            gz,
            f"{package_id}@{version}".encode("utf-8"),
        )
        container = bytes([0x50, 0x52, 0x50, 0x4B, 0x47, 0x32, 0x02, 0x01]) + iv + ciphertext
        signed_blockmap = {
            block_key: ({} if isinstance(blockmap[block_key], dict) else blockmap[block_key])
            for block_key in sorted(blockmap)
        }
        signature = {
            "algorithm": "ECDSA-P256",
            "publisher": publisher_id,
            "fingerprint": pub_fp,
            "pubKey": pub_b64,
            "sig": _ecdsa_raw_b64(pub_priv, _js_json(signed_blockmap).encode("utf-8")),
            "signedAt": built_at,
        }
        materials = [{"path": path, "sha256": digest} for path, digest in file_hashes.items()]
        envelope = {
            "format": "prpkg-v2",
            "manifest": manifest,
            "blockmap": blockmap,
            "signature": signature,
            "cert": cert,
            "encMeta": {
                "encrypted": True,
                "compression": "gzip",
                "payloadSha256": payload_sha,
                "algorithm": "AES-GCM",
            },
            "provenance": {
                "builderId": "webgpu-os/bundler",
                "sourceRef": "webgpu-os/kernel/navi/builtins/BuiltInToolFaculties.js",
                "builtAt": built_at,
                "buildParams": {
                    "official": True,
                    "facultyId": faculty_id,
                    "versionStrategy": "content-addressed-v1",
                    "revisionInputHash": revision_input_hash,
                },
                "materials": materials,
            },
            "sbom": {
                "format": "sbom-v1",
                "package": {"id": package_id, "version": version},
                "generatedAt": built_at,
                "files": materials,
                "dependencies": {"requires": [], "recommends": []},
                "permissions": [],
                "capabilities": [],
            },
            "lineage": None,
        }
        output[package_id] = {
            "version": version,
            "container": base64.b64encode(container).decode("ascii"),
            "envelope": envelope,
        }
    return output


def _atomic_write_text(path, source):
    """Durably replace one generated public module without exposing partial bytes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{os.urandom(8).hex()}.tmp"
    )
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            stream.write(source)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def write_built_in_tool_faculty_generated_module(package_records, path=None):
    """Write public development fallback evidence for all core tool Faculties."""
    path = Path(path) if path is not None else BUILT_IN_TOOL_FACULTY_GENERATED_MODULE
    literal = json.dumps(package_records, ensure_ascii=True, separators=(",", ":"))
    source = (
        "// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n"
        "//\n"
        "// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n\n"
        "// AUTO-GENERATED by bundler.signing; contains public verification evidence only.\n"
        "export const BUILT_IN_TOOL_FACULTY_GENERATED_PACKAGES = Object.freeze(" + literal + ");\n"
        "export default BUILT_IN_TOOL_FACULTY_GENERATED_PACKAGES;\n"
    )
    _atomic_write_text(path, source)
    return path


def _write_dedicated_faculty_generated_module(package_record, path, export_name):
    """Write one public-only checked-in fallback for a dedicated Faculty."""
    literal = json.dumps(package_record, ensure_ascii=True, separators=(",", ":"))
    source = (
        "// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n"
        "//\n"
        "// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n\n"
        "// AUTO-GENERATED by bundler.signing; contains public verification evidence only.\n"
        f"export const {export_name} = Object.freeze(" + literal + ");\n"
        f"export default {export_name};\n"
    )
    _atomic_write_text(path, source)
    return path


def write_artifact_studio_generated_module(package_record, path=None):
    """Write the development fallback. Release bundles use the fresher preamble copy."""
    return _write_dedicated_faculty_generated_module(
        package_record,
        Path(path) if path is not None else ARTIFACT_STUDIO_GENERATED_MODULE,
        "ARTIFACT_STUDIO_GENERATED_PACKAGE",
    )


def write_browser_semantic_generated_module(package_record, path=None):
    """Write Browser Semantic public evidence without enabling its authority."""
    return _write_dedicated_faculty_generated_module(
        package_record,
        Path(path) if path is not None else BROWSER_SEMANTIC_GENERATED_MODULE,
        "BROWSER_SEMANTIC_GENERATED_PACKAGE",
    )


def _generated_faculty_fallback_specs(root):
    builtins = Path(root) / "webgpu-os" / "kernel" / "navi" / "builtins"
    return (
        (
            builtins / "ArtifactStudioFacultyPackage.generated.js",
            "ARTIFACT_STUDIO_GENERATED_PACKAGE",
            False,
        ),
        (
            builtins / "BrowserSemanticFacultyPackage.generated.js",
            "BROWSER_SEMANTIC_GENERATED_PACKAGE",
            False,
        ),
        (
            builtins / "BuiltInToolFacultyPackages.generated.js",
            "BUILT_IN_TOOL_FACULTY_GENERATED_PACKAGES",
            True,
        ),
    )


def _read_generated_faculty_value(path, export_name):
    """Parse one generated Object.freeze(JSON) module without executing JavaScript."""
    path = Path(path)
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        raise RuntimeError(f"Generated Faculty fallback is unreadable: {path}") from error
    marker = f"export const {export_name} = Object.freeze("
    if source.count(marker) != 1:
        raise RuntimeError(f"Generated Faculty fallback has an invalid export: {path}")
    start = source.index(marker) + len(marker)
    try:
        value, end = json.JSONDecoder().raw_decode(source[start:])
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Generated Faculty fallback does not contain one JSON value: {path}") from error
    if not source[start + end:].lstrip().startswith(");"):
        raise RuntimeError(f"Generated Faculty fallback has trailing data before its export closes: {path}")
    return value


def read_development_faculty_fallback_records(root):
    """Load the exact checked-in public fallback registry from generated modules."""
    records = {}
    for path, export_name, is_registry in _generated_faculty_fallback_specs(root):
        value = _read_generated_faculty_value(path, export_name)
        if is_registry:
            if not isinstance(value, dict) or not value:
                raise RuntimeError(f"Generated Faculty fallback registry is empty: {path}")
            overlap = set(records).intersection(value)
            if overlap:
                raise RuntimeError(f"Generated Faculty fallback registry contains duplicates: {sorted(overlap)}")
            records.update(value)
            continue
        if not isinstance(value, dict):
            raise RuntimeError(f"Generated Faculty fallback record is invalid: {path}")
        manifest = value.get("envelope", {}).get("manifest", {})
        package_id = manifest.get("id") if isinstance(manifest, dict) else None
        if not isinstance(package_id, str) or not package_id or package_id in records:
            raise RuntimeError(f"Generated Faculty fallback identity is invalid: {path}")
        records[package_id] = value
    return records


def _build_all_official_faculty_records(root, root_record, root_private_key, aes_key, built_at):
    artifact = build_artifact_studio_official_package(
        root, root_record, root_private_key, aes_key, built_at,
    )
    browser = build_browser_semantic_official_package(
        root, root_record, root_private_key, aes_key, built_at,
    )
    generic = build_built_in_tool_faculty_packages(
        root, root_record, root_private_key, aes_key, built_at,
    )
    return {
        ARTIFACT_STUDIO_PACKAGE_ID: artifact,
        BROWSER_SEMANTIC_PACKAGE_ID: browser,
        **generic,
    }


def _faculty_revision_projection(records):
    projection = {}
    for package_id, record in sorted(records.items()):
        envelope = record.get("envelope") if isinstance(record, dict) else None
        manifest = envelope.get("manifest") if isinstance(envelope, dict) else None
        provenance = envelope.get("provenance") if isinstance(envelope, dict) else None
        params = provenance.get("buildParams") if isinstance(provenance, dict) else None
        if not isinstance(manifest, dict) or not isinstance(params, dict) or "naviFaculty" not in manifest:
            raise RuntimeError(f"Development fallback is not a signed Faculty package: {package_id}")
        projection[package_id] = {
            "version": record.get("version"),
            "revisionInputHash": params.get("revisionInputHash"),
        }
    return projection


def _expected_faculty_revision_projection(root, built_at):
    """Project reviewed contracts without generating keys or invoking a signer."""
    root = Path(root)
    return {
        ARTIFACT_STUDIO_PACKAGE_ID: build_artifact_studio_official_package(
            root, None, None, None, built_at, projection_only=True,
        ),
        BROWSER_SEMANTIC_PACKAGE_ID: build_browser_semantic_official_package(
            root, None, None, None, built_at, projection_only=True,
        ),
        **build_built_in_tool_faculty_packages(
            root, None, None, None, built_at, projection_only=True,
        ),
    }


def _load_ring0_roots(root):
    roots_path = Path(root) / "webgpu-os" / "kernel" / "trust" / "roots.json"
    try:
        document = json.loads(roots_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Ring-0 trust roots are unreadable: {roots_path}") from error
    roots = document.get("roots") if isinstance(document, dict) else None
    if not isinstance(roots, list) or not roots:
        raise RuntimeError("Ring-0 trust store contains no roots")
    return roots


def verify_development_faculty_fallbacks(
    root,
    *,
    verification_time=None,
    minimum_remaining_days=OFFICIAL_FALLBACK_MIN_VALIDITY_DAYS,
):
    """Verify fallback signatures, freshness, and exact current source contracts."""
    root = Path(root)
    roots = _load_ring0_roots(root)
    records = read_development_faculty_fallback_records(root)
    aes_key = hashlib.sha256(PRPKG_DEFAULT_KEY_MATERIAL).digest()
    evidence = verify_official_package_records(
        records,
        roots,
        aes_key=aes_key,
        verification_time=verification_time,
        minimum_remaining_days=minimum_remaining_days,
    )
    _assert_dedicated_faculty_owners_emitted(root, records)
    built_at = (
        verification_time
        if isinstance(verification_time, str)
        else _utc_now_iso()
    )
    expected = _expected_faculty_revision_projection(root, built_at)
    actual = _faculty_revision_projection(records)
    if actual != expected:
        missing = sorted(set(expected).difference(actual))
        extra = sorted(set(actual).difference(expected))
        changed = sorted(
            package_id for package_id in set(actual).intersection(expected)
            if actual[package_id] != expected[package_id]
        )
        raise RuntimeError(
            "Development Faculty fallbacks are stale "
            f"(missing={missing}, extra={extra}, changed={changed})"
        )
    return {
        "status": "current",
        "records": records,
        "evidence": evidence,
        "revisionProjection": actual,
    }


def prepare_development_faculty_fallbacks(
    root,
    *,
    verification_time=None,
    minimum_remaining_days=OFFICIAL_FALLBACK_MIN_VALIDITY_DAYS,
):
    """Reuse a verified current fallback or atomically refresh it before graphing."""
    root = Path(root)
    # Descriptor fixtures are generated from the live browser-normalized tools.
    # Synchronize them before freshness comparison; otherwise a descriptor edit
    # can make the signer reuse a package that only matches yesterday's fixture,
    # then update that fixture later in the same build and ship immediate drift.
    _synchronize_live_descriptor_fixtures(root, required=True)
    try:
        state = verify_development_faculty_fallbacks(
            root,
            verification_time=verification_time,
            minimum_remaining_days=minimum_remaining_days,
        )
        state["refreshed"] = False
        return state
    except RuntimeError as existing_error:
        stale_reason = str(existing_error)

    roots = _load_ring0_roots(root)
    root_record = roots[0]
    private_path = root / ".trust-keys" / f"{root_record.get('id', '')}.private.pem"
    try:
        from cryptography.hazmat.primitives import serialization
        private = serialization.load_pem_private_key(private_path.read_bytes(), password=None)
        private_public = private.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        declared_public = base64.b64decode(str(root_record.get("publicKey", "")), validate=True)
        if private_public != declared_public:
            raise RuntimeError("Ring-0 private key does not match its declared public root")
    except RuntimeError:
        raise
    except Exception as error:
        raise RuntimeError(
            "Development Faculty fallbacks require refresh, but matching signing material "
            f"is unavailable ({stale_reason})"
        ) from error

    # Tests and reproducible development builds may provide the exact clock that
    # freshness was evaluated against.  Use that same instant for the refreshed
    # certificate so the record is immediately valid under the reviewed clock.
    built_at = (
        verification_time
        if isinstance(verification_time, str)
        else _utc_now_iso()
    )
    aes_key = hashlib.sha256(PRPKG_DEFAULT_KEY_MATERIAL).digest()
    records = _build_all_official_faculty_records(
        root, root_record, private, aes_key, built_at,
    )
    verify_official_package_records(
        records,
        roots,
        aes_key=aes_key,
        verification_time=built_at,
        minimum_remaining_days=minimum_remaining_days,
    )
    _assert_dedicated_faculty_owners_emitted(root, records)
    builtins = root / "webgpu-os" / "kernel" / "navi" / "builtins"
    write_artifact_studio_generated_module(
        records[ARTIFACT_STUDIO_PACKAGE_ID],
        builtins / "ArtifactStudioFacultyPackage.generated.js",
    )
    write_browser_semantic_generated_module(
        records[BROWSER_SEMANTIC_PACKAGE_ID],
        builtins / "BrowserSemanticFacultyPackage.generated.js",
    )
    generic = {
        package_id: record for package_id, record in records.items()
        if package_id not in {ARTIFACT_STUDIO_PACKAGE_ID, BROWSER_SEMANTIC_PACKAGE_ID}
    }
    write_built_in_tool_faculty_generated_module(
        generic,
        builtins / "BuiltInToolFacultyPackages.generated.js",
    )
    refreshed = verify_development_faculty_fallbacks(
        root,
        verification_time=verification_time,
        minimum_remaining_days=minimum_remaining_days,
    )
    refreshed["refreshed"] = True
    refreshed["previousError"] = stale_reason
    return refreshed


def _assert_dedicated_faculty_owners_emitted(root, official):
    """Prove every package-owned generic exclusion has one emitted exact owner."""
    source = (
        root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolFaculties.js"
    ).read_text(encoding="utf-8")
    match = re.search(
        r"export const BUILT_IN_TOOL_FACULTY_EXCLUSIONS_JSON = `([^`]*)`;",
        source,
        flags=re.DOTALL,
    )
    if not match or "${" in match.group(1):
        raise RuntimeError("Built-in tool Faculty exclusion ownership is not statically reviewable")
    owned = {}
    for record in json.loads(match.group(1)):
        owner = str(record.get("owner", "")) if isinstance(record, dict) else ""
        if owner.startswith("os.navi-faculty."):
            owned.setdefault(owner, []).append(str(record.get("tool", "")))
    for owner, expected_tools in owned.items():
        package = official.get(owner)
        manifest = package.get("envelope", {}).get("manifest", {}) if isinstance(package, dict) else {}
        faculty = manifest.get("naviFaculty", {}).get("manifest", {}) if isinstance(manifest, dict) else {}
        emitted_tools = [
            tool.get("descriptorId")
            for tool in faculty.get("tools", [])
            if isinstance(tool, dict)
        ]
        if manifest.get("id") != owner or len(emitted_tools) != len(set(emitted_tools)) or set(emitted_tools) != set(expected_tools):
            raise RuntimeError(
                f"Dedicated Faculty exclusion owner was not emitted with its exact tools: {owner}"
            )


_APP_RUNTIME_VERSION_RE = re.compile(
    r"\b(?:const|let|var)\s+APP_VERSION\s*=\s*(['\"])([^'\"]+)\1"
)


def assert_app_runtime_version_matches_manifest(app_id, manifest_version, entry_path):
    """Reject a release whose app runtime and signed manifest disagree.

    Apps without an ``APP_VERSION`` declaration are unaffected. Once an app
    declares one, every declaration in its entry module must be identical and
    must match the version that will be signed into the package manifest.
    """
    entry_path = Path(entry_path)
    if not entry_path.is_file():
        return None
    try:
        source = entry_path.read_text(encoding="utf-8")
    except Exception as error:
        raise RuntimeError(
            f"Official app runtime version could not be inspected for {app_id}: {entry_path}: {error}"
        ) from error
    runtime_versions = {
        match.group(2).strip()
        for match in _APP_RUNTIME_VERSION_RE.finditer(source)
        if match.group(2).strip()
    }
    if not runtime_versions:
        return None
    manifest_version = str(manifest_version).strip()
    if len(runtime_versions) != 1:
        found = ", ".join(sorted(runtime_versions))
        raise RuntimeError(
            f"Official app runtime declares conflicting APP_VERSION values for {app_id}: {found}"
        )
    runtime_version = next(iter(runtime_versions))
    if runtime_version != manifest_version:
        raise RuntimeError(
            "Official app runtime/manifest version mismatch for "
            f"{app_id}: runtime APP_VERSION={runtime_version}, manifest version={manifest_version}"
        )
    return runtime_version


def collect_official_app_inputs(root, *, required=True):
    """Collect exact unsigned app inputs shared by signing and SDK rebuilding."""
    root = Path(root)
    apps_dir = root / "webgpu-os" / "apps"
    if not apps_dir.is_dir():
        raise RuntimeError("webgpu-os/apps is missing")
    official = {}
    for app_dir in sorted(p for p in apps_dir.iterdir() if p.is_dir()):
        mpath = app_dir / "manifest.json"
        if not mpath.is_file():
            continue
        try:
            am = json.loads(mpath.read_text(encoding="utf-8"))
        except Exception as error:
            if required:
                raise RuntimeError(f"Official app manifest is unreadable: {mpath}: {error}") from error
            continue
        app_id = am.get("appId") or am.get("id")
        if not app_id:
            if required:
                raise RuntimeError(f"Official app manifest has no appId or id: {mpath}")
            continue

        version    = am.get("version") or "1.0.0"
        entry_raw  = (am.get("entry") or "index.js").lstrip("./")
        if entry_raw.startswith("files/"):
            entry_raw = entry_raw[len("files/"):]
        entry = f"files/{entry_raw}"
        assert_app_runtime_version_matches_manifest(app_id, version, app_dir / entry_raw)

        # Gather the app payload (code/assets), keyed `files/<rel>` like the OS expects.
        files = {}
        for fp in sorted(app_dir.rglob("*")):
            if not fp.is_file() or fp.name == "manifest.json":
                continue
            rel_path = fp.relative_to(app_dir)
            if any(part.startswith(".") or part == "__pycache__" for part in rel_path.parts):
                continue
            if fp.suffix.lower() not in OFFICIAL_PKG_INCLUDE_EXTS:
                continue
            try:
                size = fp.stat().st_size
                if size > OFFICIAL_PKG_MAX_FILE:
                    raise RuntimeError(
                        f"Official app source exceeds the {OFFICIAL_PKG_MAX_FILE}-byte integrity guard: {fp} ({size} bytes)"
                    )
                rel = str(rel_path).replace("\\", "/")
                files[f"files/{rel}"] = fp.read_text(encoding="utf-8")
            except RuntimeError:
                raise
            except Exception as error:
                raise RuntimeError(f"Official app source is unreadable: {fp}: {error}") from error
        if not files:
            if required:
                raise RuntimeError(f"Official app has no packageable source files: {app_id}")
            continue
        if entry not in files:
            raise RuntimeError(f"Official package entry is missing for {app_id}: {entry_raw}")
        if app_id in official:
            raise RuntimeError(f"Duplicate official app id: {app_id}")

        file_hashes = {p: _sha256_hex(c.encode("utf-8")) for p, c in files.items()}

        # Manifest — built in the SAME key order as PackageBuilder.buildV2 so the
        # OS's recomputed manifestHash matches blockmap.manifestHash.
        manifest = {
            "format": "prpkg-v2",
            "id": app_id,
            "name": am.get("name", app_id),
            "version": version,
            "publisher": am.get("publisher", "core"),
            "entry": entry,
            "icon": am.get("icon"),
            "category": am.get("category", "utility"),
            "description": am.get("description", ""),
            "surface": am.get("surface", "window"),
            "permissions": am.get("permissions", []),
            "capabilities": am.get("capabilities", []),
            "commands": am.get("commands", {}),
            "defaultWidth": am.get("defaultWidth"),
            "defaultHeight": am.get("defaultHeight"),
            "sizingHint": am.get("sizingHint"),
            "files": file_hashes,
        }
        official[app_id] = {
            "sourceManifest": am, "manifest": manifest, "files": files,
            "sourcePaths": [mpath.relative_to(root).as_posix(), *[
                (app_dir / path.removeprefix("files/")).relative_to(root).as_posix()
                for path in files
            ]],
        }
    return official


def build_official_app_packages(root, *, write_generated_fallback=True, required=False, container_assets=None):
    """Sign every built-in app into an official `.prpkg` and return a JS preamble
    that assigns them to globalThis.__OS_OFFICIAL_PACKAGES__.

    Development callers may retain the historical unsigned fallback by leaving
    ``required`` false. Production and release callers set it true so missing,
    unreadable, or mismatched ring-0 material aborts the build instead of
    silently publishing a bundle whose built-in Faculties cannot be trusted.
    """
    def unavailable(message):
        detail = str(message)
        if required:
            raise RuntimeError(f"Official package signing is required: {detail}")
        print(f"[official] {detail} — skipping official package signing")
        return None

    try:
        from cryptography.hazmat.primitives import serialization, hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        return unavailable("'cryptography' is not installed")
    import gzip as _gzip

    roots_path = root / "webgpu-os" / "kernel" / "trust" / "roots.json"
    if not roots_path.is_file():
        return unavailable("roots.json is missing (run --gen-roots N)")
    try:
        roots = (json.loads(roots_path.read_text(encoding="utf-8")).get("roots") or [])
    except Exception as e:
        return unavailable(f"roots.json could not be read: {e}")
    if not roots:
        return unavailable("roots.json contains no trust roots")

    root0     = roots[0]
    priv_path = root / ".trust-keys" / f"{root0['id']}.private.pem"
    if not priv_path.is_file():
        return unavailable(f"root private key was not found at {priv_path}")
    try:
        priv = serialization.load_pem_private_key(priv_path.read_bytes(), password=None)
    except Exception as e:
        return unavailable(f"root private key could not be loaded: {e}")

    try:
        root_public_raw = priv.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        declared_public_raw = base64.b64decode(str(root0["publicKey"]), validate=True)
        declared_fingerprint = str(root0["fingerprint"])
        actual_fingerprint = hashlib.sha256(root_public_raw).hexdigest()[:16]
        if root_public_raw != declared_public_raw or actual_fingerprint != declared_fingerprint:
            return unavailable("root private key does not match the declared ring-0 public identity")
    except Exception as e:
        return unavailable(f"ring-0 root identity could not be validated: {e}")

    _synchronize_live_descriptor_fixtures(root, required=required)

    root_pub_b64 = root0["publicKey"]
    root_fp      = root0["fingerprint"]
    aes_key      = hashlib.sha256(PRPKG_DEFAULT_KEY_MATERIAL).digest()
    built_at     = _utc_now_iso()

    # Rotating publisher key (standard PKI): the ring-0 ROOT private key is the
    # offline master and never changes; each build mints a FRESH publisher signing
    # keypair and a root-signed cert for it, with a [notBefore, notAfter] window.
    # The OS only needs the unchanging root PUBLIC key baked in to verify any
    # rotated publisher cert (via its issuerSig), so the official signing key can
    # rotate every build without reshipping trust anchors. Packages are signed by
    # the publisher key — NOT the root — keeping the root key's exposure minimal.
    import datetime as _dt
    pub_priv = ec.generate_private_key(ec.SECP256R1())
    pub_raw  = pub_priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    pub_b64  = base64.b64encode(pub_raw).decode("ascii")
    pub_fp   = hashlib.sha256(pub_raw).hexdigest()[:16]

    now_dt    = _dt.datetime.now(_dt.timezone.utc)
    not_after = (now_dt + _dt.timedelta(days=OFFICIAL_CERT_VALIDITY_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Root-signed publisher cert. FLAT scalar fields only — TrustStore._certPayload
    # serializes with a key-ARRAY replacer (which strips nested objects), and we
    # must reproduce that exact canonical form for the issuer signature to verify.
    cert = {
        "algorithm": "ECDSA-P256",
        "fingerprint": pub_fp,
        "format": "prcert-v1",
        "issuedAt": built_at,
        "issuer": root0.get("name", root0["id"]),
        "issuerFingerprint": root_fp,
        "keyId": pub_fp,
        "notAfter": not_after,
        "notBefore": built_at,
        "publicKey": pub_b64,
        "selfSigned": False,
        "subject": "WebGPU OS Core",
    }
    cert_canonical = json.dumps(cert, sort_keys=True, separators=(",", ":"))
    cder = priv.sign(cert_canonical.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    cr_int, cs_int = decode_dss_signature(cder)
    cert["issuerSig"] = base64.b64encode(cr_int.to_bytes(32, "big") + cs_int.to_bytes(32, "big")).decode("ascii")

    apps_dir = root / "webgpu-os" / "apps"
    if not apps_dir.is_dir():
        return unavailable("webgpu-os/apps is missing")

    official = {}
    for app_id, inputs in collect_official_app_inputs(root, required=required).items():
        am = inputs["sourceManifest"]
        manifest = inputs["manifest"]
        files = inputs["files"]
        version, entry = manifest["version"], manifest["entry"]
        file_hashes = manifest["files"]
        manifest_hash = _sha256_hex(_js_json(manifest).encode("utf-8"))
        blockmap = {
            "format": "blockmap-v1", "packageId": app_id, "version": version,
            "files": file_hashes, "merkleRoot": _prpkg_merkle_root(file_hashes),
            "manifestHash": manifest_hash, "builtAt": built_at,
        }

        # Inner payload → gzip → AES-GCM seal (PRPKG2 container).
        gz          = _gzip.compress(_js_json({"manifest": manifest, "blockmap": blockmap, "files": files}).encode("utf-8"))
        payload_sha = _sha256_hex(gz)
        iv          = os.urandom(12)
        ct          = AESGCM(aes_key).encrypt(iv, gz, f"{app_id}@{version}".encode("utf-8"))
        container   = bytes([0x50, 0x52, 0x50, 0x4B, 0x47, 0x32, 0x02, 0x01]) + iv + ct  # "PRPKG2"|v2|enc

        # Sign the blockmap with the PUBLISHER key (rotates per build); its cert
        # chains to the unchanging ring-0 root. JS signs/verifies the canonical
        # JSON.stringify(blockmap, sortedKeys) — a key-array replacer empties files.
        signed_obj = {k: ({} if isinstance(blockmap[k], dict) else blockmap[k]) for k in sorted(blockmap)}
        der        = pub_priv.sign(_js_json(signed_obj).encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        r_int, s_int = decode_dss_signature(der)
        raw_sig    = r_int.to_bytes(32, "big") + s_int.to_bytes(32, "big")  # P1363 r||s

        # SLSA-style provenance + SBOM for first-party built-ins. The bundler is
        # the most trusted build path (it alone holds the offline ring-0 root key),
        # so official packages should reach the HIGHEST provenance level — not L0.
        # materials bind the declared source to the packaged files (ProvenanceChecker
        # re-hashes each file and compares), and builderId 'webgpu-os/bundler' is a
        # recognized trusted builder → level 2.
        materials = [{"path": p, "sha256": h} for p, h in file_hashes.items()]
        provenance = {
            "builderId": "webgpu-os/bundler",
            "sourceRef": "webgpu-os/bundle_engine",
            "builtAt": built_at,
            "buildParams": {"official": True, "publisherFingerprint": pub_fp},
            "materials": materials,
        }
        sbom = {
            "format": "sbom-v1",
            "package": {"id": app_id, "version": version},
            "generatedAt": built_at,
            "files": materials,
            "dependencies": {
                "requires": am.get("requires", []),
                "recommends": am.get("recommends", []),
            },
            "permissions": manifest["permissions"],
            "capabilities": manifest["capabilities"],
        }

        envelope = {
            "format": "prpkg-v2", "manifest": manifest, "blockmap": blockmap,
            "signature": {
                "algorithm": "ECDSA-P256", "publisher": manifest["publisher"],
                "fingerprint": pub_fp, "pubKey": pub_b64,
                "sig": base64.b64encode(raw_sig).decode("ascii"), "signedAt": built_at,
            },
            "cert": cert,
            "encMeta": {"encrypted": True, "compression": "gzip", "payloadSha256": payload_sha, "algorithm": "AES-GCM"},
            "provenance": provenance, "sbom": sbom,
        }
        official[app_id] = {
            "version": version,
            "container": base64.b64encode(container).decode("ascii"),
            "envelope": envelope,
        }

    # Artifact Studio is a kernel Faculty package, not an application folder,
    # so it cannot enter the generic app scan above. Build it through the same
    # ring-0 release boundary, then publish the exact public package evidence to
    # both the release preamble and, when explicitly requested, the raw-browser
    # development fallback. Release bundle targets must not rewrite graph source
    # after discovery: each target mints a fresh key, timestamp, IV, and signature,
    # so mutating the shared fallback would make an earlier target stale as soon as
    # the next target builds. The release preamble remains the authoritative fresh
    # package while the development API keeps its historical write-by-default
    # behavior.
    artifact_package = build_artifact_studio_official_package(
        root,
        root0,
        priv,
        aes_key,
        built_at,
    )
    official[ARTIFACT_STUDIO_PACKAGE_ID] = artifact_package

    browser_semantic_package = build_browser_semantic_official_package(
        root,
        root0,
        priv,
        aes_key,
        built_at,
    )
    official[BROWSER_SEMANTIC_PACKAGE_ID] = browser_semantic_package

    built_in_faculty_packages = build_built_in_tool_faculty_packages(
        root,
        root0,
        priv,
        aes_key,
        built_at,
    )
    official.update(built_in_faculty_packages)

    _assert_dedicated_faculty_owners_emitted(root, official)

    if not official:
        return unavailable("no built-in app packages were produced")

    verification = verify_official_package_records(
        official,
        roots,
        aes_key=aes_key,
        verification_time=built_at,
    )
    if set(verification) != set(official):
        raise RuntimeError("Official package self-verification did not cover the complete registry")
    print(f"[official] cryptographically self-verified {len(verification)} exact package record(s)")

    # Generated fallbacks are emitted only after the entire registry passes the
    # independent verifier. Each file replacement is atomic, so a crash cannot
    # expose a truncated JavaScript module to a concurrent development server.
    if write_generated_fallback:
        generated_path = write_artifact_studio_generated_module(
            artifact_package,
            root / "webgpu-os" / "kernel" / "navi" / "builtins" / "ArtifactStudioFacultyPackage.generated.js",
        )
        print(f"[official] wrote Artifact Studio Faculty fallback -> {generated_path}")
        generated_path = write_browser_semantic_generated_module(
            browser_semantic_package,
            root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BrowserSemanticFacultyPackage.generated.js",
        )
        print(f"[official] wrote Browser Semantic Faculty fallback -> {generated_path}")
        generated_path = write_built_in_tool_faculty_generated_module(
            built_in_faculty_packages,
            root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolFacultyPackages.generated.js",
        )
        print(f"[official] wrote built-in tool Faculty fallbacks -> {generated_path}")
    else:
        print("[official] retained stable development Faculty fallbacks; release preamble carries fresh packages")

    # ensure_ascii=True keeps the embedded literal pure-ASCII (safe through minify);
    # JS reconstructs the original unicode (e.g. emoji icons) when it parses the object.
    if container_assets is not None:
        from .official_inventory import externalize_official_package_containers
        official = externalize_official_package_containers(official, container_assets)
    literal = json.dumps(official, ensure_ascii=True, separators=(",", ":"))
    preamble = ("// Official ring-0 signed app packages -- AUTO-GENERATED by bundle_engine.py\n"
                "globalThis.__OS_OFFICIAL_PACKAGES__=" + literal + ";")
    total = sum(len(v.get("container", "")) for v in official.values())
    print(f"[official] signed {len(official)} official app package(s) -- publisher fp {pub_fp} "
          f"(rotates per build) -> chains to root {root_fp}, valid until {not_after} "
          f"(~{total // 1024} KB containers)")
    return preamble
