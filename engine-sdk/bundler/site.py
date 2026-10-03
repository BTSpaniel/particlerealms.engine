# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.site — release-site assembly, WebGPU OS laydown, app/source barrels."""

import ast
import html as _html
import io
import os
import re
import json
import math
import gzip
import base64
import shutil
import zipfile
import time
import hashlib
import stat
import tempfile
import subprocess as _subprocess
import sys
from pathlib import Path, PurePosixPath
from .config import ROOT, ENGINE_VERSION, dedupe_preserve_order
from .compress import compress_gzip, compress_brotli, compress_zstd, compress_lzma, fmt_size
from .parser import ParseError, parse_module
from .stable_resource_inventory import (
    STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH,
    generate_stable_resource_inventory,
    stable_network_resource_repository_paths,
    stable_resource_inventory_module_bytes,
)
from .official_inventory import verify_official_package_sidecars
from .engine_demo_transport import descriptor_path, publish_transport, read_transport_file, transport_paths
from .runtime_transport import (
    compressed_artifact_part_map,
    compressed_artifact_paths,
    read_compressed_artifact,
    validate_compressed_artifact_parts,
)


# ---- Release Site -----------------------------------------------------------

RELEASE_INCLUDE = [
    "index.html",
    "404.html",
    "learn",
    "guide",
    "api",
    "playground",
]

# This source-only backup predates the modular Playground and embeds a large
# inline runtime bootstrap with raw-bundle fallbacks. It is retained for local
# archaeology but is not a public, CSP-safe release route.
RELEASE_EXCLUDE = frozenset({"playground/index.legacy.html"})

PUBLIC_SITE_URL = os.environ.get(
    "PARTICLE_REALMS_SITE_URL",
    "https://particlerealms.online",
).rstrip("/")
CLOUDFLARE_PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024
CLOUDFLARE_PAGES_FREE_MAX_FILES = 20_000
WEBGPU_OS_GENERATED_RUNTIME_ASSET_PATTERNS = (
    "particle-os.js",
    "particle-os.manifest.json",
    "particle-os.min.js*",
    "particle-os.provenance.json",
)
_DOCS_PREPARED_ROOTS = set()


_RELEASE_RUNTIME_LOADER_SOURCE = """// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// CSP-safe compressed runtime loader. Configuration is supplied through data-*
// attributes on this external script. The browser fetches the build-produced
// gzip asset (or its ordered opaque parts), expands it with DecompressionStream, verifies the exact decoded
// byte length and SHA-384 SRI identity, then executes it from a Blob URL.
(() => {
  if (globalThis.__PE_RUNTIME_READY?.then) return;
  const config = document.currentScript;
  // Passive bounded telemetry, not an authority or a source of boot decisions.
  // No URLs, package contents, or error text enter this snapshot.
  let lastTime = 0;
  const clock = () => {
    try {
      const value = globalThis.performance?.now?.();
      if (Number.isFinite(value)) lastTime = Math.max(lastTime, value, 0);
    } catch {}
    return lastTime;
  };
  const startedAt = clock();
  const stages = { fetchMs: null, decompressMs: null, integrityMs: null, evaluateMs: null };
  let activeStage = null;
  let stageStartedAt = startedAt;
  let retries = 0;
  const publishTiming = (outcome) => {
    try {
      const now = clock();
      const origin = globalThis.performance?.timeOrigin;
      const positiveBytes = (value) => {
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
      };
      Object.defineProperty(globalThis, '__PE_RUNTIME_LOADER_TIMING__', {
        configurable: true, writable: true, value: Object.freeze({
          format: 'particle-runtime-loader-timing-v1', outcome, startedAt,
          timeOrigin: Number.isFinite(origin) && origin >= 0 ? origin : null,
          updatedAt: now, elapsedMs: Math.max(0, now - startedAt),
          stages: Object.freeze({ ...stages }), retries,
          decodedBytes: positiveBytes(config?.dataset?.runtimeBytes),
          compressedBytes: positiveBytes(config?.dataset?.runtimeCompressedBytes),
        }),
      });
    } catch {}
  };
  const beginStage = (name) => { activeStage = name; stageStartedAt = clock(); };
  const endStage = () => {
    if (activeStage) stages[activeStage] = Math.max(0, clock() - stageStartedAt);
    activeStage = null;
    publishTiming('loading');
  };
  publishTiming('loading');
  const hasRuntimeRegistry = (api) => !!(
    api
    && typeof (api.requireModule || api.__require || api._require) === 'function'
    && (api.__modules || api._M)
  );
  const ready = (async () => {
    if (!config) {
      throw new Error('Release runtime loader could not resolve its script element');
    }

    const runtimeSource = config.dataset.runtimeSrc;
    const assetBase = config.dataset.assetBase;
    const runtimeBase = config.dataset.runtimeBase;
    const integrity = config.dataset.integrity;
    const executorSourceHash = config.dataset.executorSourceHash || '';
    const runtimeBytes = Number(config.dataset.runtimeBytes);
    const runtimeCompressedBytes = Number(config.dataset.runtimeCompressedBytes);
    if (!runtimeSource || !assetBase || !runtimeBase || !integrity ||
        !Number.isSafeInteger(runtimeBytes) || runtimeBytes <= 0 ||
        !Number.isSafeInteger(runtimeCompressedBytes) || runtimeCompressedBytes <= 0) {
      throw new Error('Release runtime loader configuration is incomplete');
    }
    if (!/^sha384-[A-Za-z0-9+/]{64}$/.test(integrity)) {
      throw new Error('Release runtime loader received an invalid SHA-384 identity');
    }
    if (executorSourceHash && !/^sha256:[a-f0-9]{64}$/.test(executorSourceHash)) {
      throw new Error('Release runtime loader received an invalid executor source identity');
    }
    if (!globalThis.crypto?.subtle) {
      throw new Error('Release runtime verification requires Web Crypto');
    }

    const runtimeUrl = new URL(runtimeSource, document.baseURI);
    const partsAttribute = config.getAttribute('data-runtime-parts');
    let runtimeParts = null;
    if (partsAttribute !== null) {
      // The release HTML supplies the ordered transport identity beside decoded
      // SRI. Validate the entire description before fetching or reusing an API.
      if (partsAttribute.length > 131072) {
        throw new Error('Runtime parts metadata exceeds its safety bound');
      }
      let records;
      try { records = JSON.parse(partsAttribute); }
      catch { throw new Error('Runtime parts metadata is not valid JSON'); }
      if (!Array.isArray(records) || records.length < 1 || records.length > 64) {
        throw new Error('Runtime parts metadata must contain between 1 and 64 parts');
      }
      const documentOrigin = globalThis.location.origin;
      const runtimeDirectory = decodeURIComponent(new URL('.', runtimeUrl).pathname);
      if (runtimeUrl.origin !== documentOrigin || runtimeUrl.username || runtimeUrl.password || runtimeUrl.hash) {
        throw new Error('Runtime parts require a same-origin runtime identity');
      }
      const seenPaths = new Set();
      let totalBytes = 0;
      runtimeParts = records.map((record, index) => {
        if (!record || typeof record !== 'object' || Array.isArray(record) ||
            Object.keys(record).sort().join(',') !== 'bytes,sha256,src' ||
            typeof record.src !== 'string' || !record.src || record.src.length > 1024 ||
            !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > 16777216 ||
            typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) {
          throw new Error(`Runtime part ${index + 1} metadata is invalid`);
        }
        const src = record.src;
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(src) || src.startsWith('/') ||
            /[\\s\\\\]/.test(src) || src.includes('#') || /%(?:0[0-9a-f]|1[0-9a-f]|7f|2f|5c|25)/i.test(src)) {
          throw new Error(`Runtime part ${index + 1} URL is not a safe relative asset`);
        }
        const url = new URL(src, document.baseURI);
        const assetPath = decodeURIComponent(url.pathname);
        if (url.origin !== documentOrigin || url.username || url.password || url.hash ||
            !assetPath.startsWith(runtimeDirectory) || assetPath === runtimeDirectory ||
            seenPaths.has(assetPath)) {
          throw new Error(`Runtime part ${index + 1} URL escapes or repeats its runtime asset directory`);
        }
        seenPaths.add(assetPath);
        totalBytes += record.bytes;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > runtimeCompressedBytes) {
          throw new Error('Runtime parts exceed the declared compressed byte length');
        }
        return Object.freeze({ url, bytes: record.bytes, sha256: record.sha256 });
      });
      if (totalBytes !== runtimeCompressedBytes) {
        throw new Error('Runtime parts do not match the declared compressed byte length');
      }
      Object.freeze(runtimeParts);
    }

    globalThis.__PE_ASSET_BASE = new URL(assetBase, document.baseURI).href;
    const resolvedRuntimeBase = new URL(runtimeBase, document.baseURI).href;
    const configuredBases = globalThis.__PE_RUNTIME_BASES__ || {};
    globalThis.__PE_RUNTIME_BASES__ = Object.freeze({
      engine: configuredBases.engine || new URL('engine/', resolvedRuntimeBase).href,
      editor: configuredBases.editor || new URL('editor/', resolvedRuntimeBase).href,
      plauna: configuredBases.plauna || new URL('plauna/', resolvedRuntimeBase).href,
      agi: configuredBases.agi || new URL('agi/', resolvedRuntimeBase).href,
    });
    if (config.dataset.osBase) {
      globalThis.__PE_OS_BASE__ = new URL(config.dataset.osBase, document.baseURI).href;
    }
    globalThis.__PE_RUNTIME_PROVENANCE__ = Object.freeze({
      format: 'particle-runtime-provenance-v1',
      deliveryMode: 'verified-release-bundle',
      loaderUrl: config.src || '',
      runtimeUrl: new URL(runtimeSource, document.baseURI).href,
      integrity,
      executorSourceHash,
      decodedBytes: runtimeBytes,
      compressedBytes: runtimeCompressedBytes,
      transportMode: runtimeParts ? 'gzip-parts' : 'gzip',
      transportPartCount: runtimeParts?.length || 0,
      buildId: (() => {
        try { return new URL(config.src, document.baseURI).searchParams.get('v') || ''; }
        catch { return ''; }
      })(),
    });

    const existingApi = globalThis.PE || globalThis.ParticleEngine;
    if (hasRuntimeRegistry(existingApi)) {
      if (!globalThis.PE) globalThis.PE = existingApi;
      return existingApi;
    }

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 120000);
    const readRuntimeResponse = async (
      response, maxResponseBytes = Math.max(runtimeCompressedBytes, runtimeBytes), mismatchOnOverflow = false,
    ) => {
      if (!response.ok) {
        throw new Error(`Compressed runtime fetch failed (${response.status}): ${runtimeUrl.href}`);
      }
      if (!response.body) {
        throw new Error('Compressed runtime response has no readable body');
      }
      const responseReader = response.body.getReader();
      const responseChunks = [];
      let receivedBytes = 0;
      for (;;) {
        const { done, value } = await responseReader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > maxResponseBytes) {
          try { await responseReader.cancel(); } catch {}
          if (mismatchOnOverflow) return null;
          throw new Error(`Runtime response exceeds its ${maxResponseBytes}-byte safety bound`);
        }
        responseChunks.push(value);
      }
      const payload = new Uint8Array(receivedBytes);
      let responseOffset = 0;
      for (const chunk of responseChunks) {
        payload.set(chunk, responseOffset);
        responseOffset += chunk.byteLength;
      }
      return payload;
    };
    const fetchRuntime = (cache, responseUrl = runtimeUrl) => fetch(responseUrl, {
      cache,
      credentials: 'same-origin',
      redirect: runtimeParts ? 'error' : 'follow',
      signal: controller.signal,
    });
    const payloadHasExpectedIdentityLength = (value) => {
      const gzip = value.length >= 2 && value[0] === 0x1f && value[1] === 0x8b;
      return value.byteLength === (gzip ? runtimeCompressedBytes : runtimeBytes);
    };
    const fetchRuntimePayload = async (cache) => {
      if (runtimeParts) {
        const payload = new Uint8Array(runtimeCompressedBytes);
        let offset = 0;
        for (const [index, part] of runtimeParts.entries()) {
          const response = await fetchRuntime(cache, part.url);
          if (!response.ok) {
            throw new Error(`Runtime part ${index + 1} fetch failed (${response.status}): ${part.url.href}`);
          }
          const declaredLength = Number(response.headers.get('content-length'));
          if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength !== part.bytes) {
            try { await response.body?.cancel(); } catch {}
            return { payload: null, mismatch: `part ${index + 1} declares ${declaredLength} bytes` };
          }
          const bytes = await readRuntimeResponse(response, part.bytes, true);
          if (!bytes || bytes.byteLength !== part.bytes) {
            return { payload: null, mismatch: `part ${index + 1} does not have ${part.bytes} bytes` };
          }
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          controller.signal.throwIfAborted();
          const actualHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
          if (actualHash !== part.sha256) {
            return { payload: null, mismatch: `part ${index + 1} failed SHA-256 verification` };
          }
          payload.set(bytes, offset);
          offset += bytes.byteLength;
        }
        return { payload, mismatch: '' };
      }
      const response = await fetchRuntime(cache);
      if (!response.ok) {
        throw new Error(`Compressed runtime fetch failed (${response.status}): ${runtimeUrl.href}`);
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > 0 &&
          declaredLength !== runtimeCompressedBytes && declaredLength !== runtimeBytes) {
        try { await response.body?.cancel(); } catch {}
        return { payload: null, mismatch: `declares ${declaredLength} bytes` };
      }
      const responsePayload = await readRuntimeResponse(response);
      if (!payloadHasExpectedIdentityLength(responsePayload)) {
        return { payload: null, mismatch: `has ${responsePayload.byteLength} bytes` };
      }
      return { payload: responsePayload, mismatch: '' };
    };
    let payload;
    beginStage('fetchMs');
    try {
      let result = await fetchRuntimePayload('force-cache');
      if (result.mismatch) {
        // A deployment can publish fresh HTML before an intermediary evicts the
        // prior immutable runtime object. Retry once through an explicit cache
        // revalidation of the whole transport; never mix cached and reloaded
        // parts. Exact encoded/decoded lengths and SRI remain mandatory.
        retries++;
        result = await fetchRuntimePayload('reload');
      }
      if (result.mismatch) {
        throw new Error(`Runtime response ${result.mismatch} after cache reload; expected ${runtimeCompressedBytes} compressed bytes or ${runtimeBytes} decoded bytes`);
      }
      payload = result.payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Compressed runtime fetch timed out: ${runtimeUrl.href}`);
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
      endStage();
    }
    beginStage('decompressMs');
    const isGzip = payload.length >= 2 && payload[0] === 0x1f && payload[1] === 0x8b;
    if (runtimeParts && !isGzip) {
      throw new Error('Runtime parts did not reconstruct an opaque gzip payload');
    }
    let sourceBytes;
    if (isGzip) {
      if (payload.byteLength !== runtimeCompressedBytes) {
        throw new Error(`Compressed runtime has ${payload.byteLength} bytes; expected ${runtimeCompressedBytes}`);
      }
      if (typeof DecompressionStream !== 'function') {
        throw new Error("Compressed runtime requires DecompressionStream('gzip')");
      }
      const reader = new Blob([payload]).stream()
        .pipeThrough(new DecompressionStream('gzip'))
        .getReader();
      const chunks = [];
      let decodedBytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        decodedBytes += value.byteLength;
        if (decodedBytes > runtimeBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error(`Compressed runtime expands beyond ${runtimeBytes} verified bytes`);
        }
        chunks.push(value);
      }
      if (decodedBytes !== runtimeBytes) {
        throw new Error(`Compressed runtime decoded ${decodedBytes} bytes; expected ${runtimeBytes}`);
      }
      sourceBytes = new Uint8Array(decodedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        sourceBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      // A host may apply Content-Encoding to the .gz object and Fetch then
      // exposes the already-decoded response. Accept only the exact verified
      // source length so this cannot silently become an arbitrary text fallback.
      if (payload.byteLength !== runtimeBytes) {
        throw new Error(`Runtime response has ${payload.byteLength} bytes; expected ${runtimeBytes}`);
      }
      sourceBytes = payload;
    }

    endStage();
    beginStage('integrityMs');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-384', sourceBytes));
    const actualIntegrity = `sha384-${btoa(String.fromCharCode(...digest))}`;
    if (actualIntegrity !== integrity) {
      throw new Error('Compressed runtime failed SHA-384 verification');
    }
    endStage();

    beginStage('evaluateMs');
    const blobUrl = URL.createObjectURL(new Blob([sourceBytes], { type: 'text/javascript' }));
    let executionError = null;
    const captureExecutionError = (event) => {
      if (event.filename !== blobUrl) return;
      const location = event.lineno ? ` at ${event.lineno}:${event.colno || 0}` : '';
      executionError = new Error(`Verified runtime syntax failure${location}: ${event.message || 'unknown script error'}`);
    };
    globalThis.addEventListener('error', captureExecutionError, true);
    try {
      await new Promise((resolve, reject) => {
        const runtime = document.createElement('script');
        runtime.src = blobUrl;
        runtime.async = true;
        runtime.addEventListener('load', resolve, { once: true });
        runtime.addEventListener('error', () => {
          queueMicrotask(() => reject(executionError || new Error(`Verified runtime failed to execute: ${runtimeUrl.href}`)));
        }, { once: true });
        document.head.appendChild(runtime);
      });
    } finally {
      globalThis.removeEventListener('error', captureExecutionError, true);
      URL.revokeObjectURL(blobUrl);
    }
    if (executionError) throw executionError;
    endStage();

    const api = globalThis.PE || globalThis.ParticleEngine;
    if (!hasRuntimeRegistry(api)) {
      throw new Error('Compiled runtime loaded without a complete Particle Engine registry');
    }
    if (!globalThis.PE) globalThis.PE = api;
    return api;
  })();

  // Engine-backed Playground demos and generated app launchers await the same
  // promise. Attach a rejection observer immediately so a failed network load
  // cannot become an unhandled rejection before those consumers execute.
  ready.then(() => { publishTiming('ready'); }, (error) => {
    endStage();
    publishTiming('failed');
    console.error('[Release] Runtime unavailable:', error);
  });
  globalThis.__PE_RUNTIME_READY = ready;
})();
"""

_RELEASE_CONSUMER_BOOTSTRAP_SOURCE = """// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Bundler-managed Template bootstrap. It resolves subsystem namespaces from the
// verified platform runtime and fails visibly when a release contract drifts.
(() => {
  const status = document.getElementById('os-boot-status');
  const loader = document.getElementById('os-boot-loader');
  const selector = document.getElementById('boot-selector');

  const fail = (error) => {
    console.error('[Boot] Bundle failed:', error);
    if (status) status.textContent = 'Boot failed';
    const card = loader?.querySelector('.boot-card');
    if (!card) return;
    const el = document.createElement('div');
    el.className = 'error';
    el.setAttribute('role', 'alert');
    el.textContent = error?.message || String(error);
    card.appendChild(el);
  };

  const requireFunction = (owner, name, subsystem) => {
    const value = owner?.[name];
    if (typeof value !== 'function') {
      throw new Error(`Platform bundle is missing ${subsystem}.${name}`);
    }
    return value;
  };

  Promise.resolve(globalThis.__PE_RUNTIME_READY).then((runtime) => {
    const api = runtime || globalThis.PE || globalThis.ParticleEngine;
    if (!api) throw new Error('Particle Engine runtime not found after bundle load');
    const os = api.WebGPUOS || api;
    const plauna = api.Plauna || api;
    const bootWebGpuOS = requireFunction(os, 'bootWebGpuOS', 'WebGPUOS');
    const mountShowcaseApp = plauna.mountShowcaseApp;
    const ShowcaseApp = plauna.ShowcaseApp;
    if (typeof mountShowcaseApp !== 'function' && typeof ShowcaseApp !== 'function') {
      throw new Error('Platform bundle is missing Plauna.mountShowcaseApp/ShowcaseApp');
    }
    if (!api.Engine) throw new Error('Platform bundle is missing Engine');

    if (status) status.textContent = 'Bundle ready';
    selector?.classList.add('visible');
    selector?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-mode]');
      if (!button) return;
      selector.classList.remove('visible');
      const mode = button.dataset.mode;
      if (mode === 'os') {
        if (status) status.textContent = 'Starting kernel...';
        await bootWebGpuOS();
        return;
      }
      if (mode === 'plauna') {
        if (status) status.textContent = 'Starting Plauna Showcase...';
        const root = document.getElementById('plauna-root');
        if (root) root.style.display = '';
        if (typeof mountShowcaseApp === 'function') {
          await mountShowcaseApp({ root, statusElement: status });
        } else {
          const app = new ShowcaseApp({ root, statusElement: status });
          await app.boot();
        }
        loader?.remove();
        return;
      }
      if (mode === 'canvas') {
        if (status) status.textContent = 'Engine ready';
        const root = document.getElementById('canvas-root');
        if (root) root.style.display = '';
        loader?.remove();
      }
    });
  }).catch(fail);
})();
"""

_INLINE_CONSUMER_BOOTSTRAP_PATTERN = re.compile(
    r"\s*<!-- Boot logic: wait for bundle, show selector, dispatch to chosen mode -->"
    r"\s*<script>[\s\S]*?</script>",
)
_EXTERNAL_CONSUMER_BOOTSTRAP_PATTERN = re.compile(
    r"\s*<!-- Bundler-managed consumer bootstrap -->\s*"
    r"<script src=\"\./assets/release-consumer-bootstrap\.js(?:\?v=[^\"]*)?\"></script>",
)


def _read_bundle_sri(path):
    """Read and strictly validate the SHA-384 sidecar emitted by the bundler."""
    path = Path(path)
    value = path.read_text(encoding="ascii", errors="strict").strip()
    if not re.fullmatch(r"sha384-[A-Za-z0-9+/]{64}", value):
        raise ValueError(f"Invalid SHA-384 SRI sidecar: {path}")
    return value


def _release_runtime_loader_bytes():
    """Return platform-independent bytes for the generated runtime loader.

    The checked-in Template consumer uses CRLF.  Emitting the same canonical
    bytes on every build keeps its cache identity and byte-parity validation
    independent of the host running the Python bundler.
    """
    return _RELEASE_RUNTIME_LOADER_SOURCE.replace("\n", "\r\n").encode("utf-8")


def _verify_release_runtime_gzip(path, integrity, expected_bytes):
    """Stream-verify a gzip runtime against its decoded size and SHA-384 SRI."""
    path = io.BytesIO(bytes(path)) if isinstance(path, (bytes, bytearray, memoryview)) else Path(path)
    digest = hashlib.sha384()
    decoded_bytes = 0
    try:
        with gzip.open(path, "rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                decoded_bytes += len(chunk)
                if decoded_bytes > expected_bytes:
                    raise ValueError(
                        f"Compressed runtime expands beyond {expected_bytes} bytes: {path}"
                    )
                digest.update(chunk)
    except OSError as error:
        raise ValueError(f"Invalid gzip runtime: {path}: {error}") from error
    if decoded_bytes != expected_bytes:
        raise ValueError(
            f"Compressed runtime decoded {decoded_bytes} bytes; expected "
            f"{expected_bytes}: {path}"
        )
    actual = "sha384-" + base64.b64encode(digest.digest()).decode("ascii")
    if actual != integrity:
        raise ValueError(f"Compressed runtime SHA-384 mismatch: {path}")
    return decoded_bytes


def _write_release_runtime_loader(destination):
    """Write the external CSP-safe runtime loader used by release pages."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(_release_runtime_loader_bytes())
    return destination


def _release_runtime_loader_tag(
    loader_src,
    runtime_src,
    asset_base,
    integrity,
    runtime_bytes,
    runtime_compressed_bytes,
    token,
    runtime_base="../",
    os_base=None,
    executor_source_hash=None,
    runtime_parts=None,
):
    """Render a configured external loader tag without executable inline code."""
    attributes = [
        f'src="{loader_src}?v={token}"',
        f'data-runtime-src="{runtime_src}?v={token}"',
        f'data-asset-base="{asset_base}"',
        f'data-runtime-base="{runtime_base}"',
        f'data-integrity="{integrity}"',
        f'data-runtime-bytes="{int(runtime_bytes)}"',
        f'data-runtime-compressed-bytes="{int(runtime_compressed_bytes)}"',
    ]
    if os_base is not None:
        attributes.append(f'data-os-base="{os_base}"')
    if executor_source_hash is not None:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", executor_source_hash):
            raise ValueError("Release runtime executor source hash is invalid")
        attributes.append(f'data-executor-source-hash="{executor_source_hash}"')
    if runtime_parts is not None:
        records = validate_compressed_artifact_parts(
            PurePosixPath(runtime_src).name, runtime_parts, expected_bytes=runtime_compressed_bytes,
        )
        prefix = runtime_src.rpartition("/")[0]
        configured = [
            {**record, "src": (prefix + "/" if prefix else "") + record["src"] + f"?v={token}"}
            for record in records
        ]
        encoded = _html.escape(json.dumps(configured, separators=(",", ":")), quote=True)
        attributes.append(f'data-runtime-parts="{encoded}"')
    return "<script " + " ".join(attributes) + "></script>"


_PUBLISH_RETRY_DELAYS = (0.05, 0.10, 0.20, 0.40, 0.80)


def _sha256_path(path):
    """Hash one file without loading a large sidecar or archive member at once."""
    with Path(path).open("rb") as handle:
        return _sha256_stream(handle)


def _sha256_stream(handle):
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def _release_runtime_cache_token(runtime_path, runtime_parts=None):
    """Bind one browser cache identity to gzip bytes and canonical loader source."""
    runtime_digest = hashlib.sha256(bytes(runtime_path)).hexdigest() \
        if isinstance(runtime_path, (bytes, bytearray, memoryview)) else _sha256_path(runtime_path)
    identity = (
        runtime_digest.encode("ascii")
        + b"\0"
        + _RELEASE_RUNTIME_LOADER_SOURCE.encode("utf-8")
    )
    if runtime_parts is not None:
        identity += b"\0" + json.dumps(runtime_parts, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii")
    return hashlib.sha256(identity).hexdigest()[:16]


def _validate_static_site_file_cap(
    site_dir,
    max_bytes=CLOUDFLARE_PAGES_MAX_FILE_BYTES,
    max_files=CLOUDFLARE_PAGES_FREE_MAX_FILES,
):
    """Fail before publish when the static tree exceeds Cloudflare Pages limits."""
    site_dir = Path(site_dir)
    files = [path for path in site_dir.rglob("*") if path.is_file()]
    if len(files) > max_files:
        raise RuntimeError(
            f"Static deployment contains {len(files):,} files; host limit is "
            f"{max_files:,}"
        )
    oversized = sorted(
        (
            path.relative_to(site_dir).as_posix(),
            path.stat().st_size,
        )
        for path in files
        if path.stat().st_size > max_bytes
    )
    if oversized:
        details = "\n  ".join(f"{name}: {size:,} bytes" for name, size in oversized)
        raise RuntimeError(
            f"Static deployment contains files above the {max_bytes:,}-byte "
            f"host limit:\n  {details}"
        )
    largest = max((path.stat().st_size for path in files), default=0)
    return len(files), largest


def _replace_path_with_retry(source, target):
    """Replace one path after bounded Windows sharing-violation retries."""
    source = Path(source)
    target = Path(target)
    last_error = None
    for attempt in range(len(_PUBLISH_RETRY_DELAYS) + 1):
        try:
            return source.replace(target)
        except PermissionError as error:
            last_error = error
            if attempt >= len(_PUBLISH_RETRY_DELAYS):
                break
            delay = _PUBLISH_RETRY_DELAYS[attempt]
            print(
                f"[bundle][site-publish][retry] operation=directory-replace "
                f"attempt={attempt + 1} delay_ms={delay * 1000:.0f} "
                f"source={source} target={target}"
            )
            time.sleep(delay)
    raise last_error


def _os_replace_with_retry(source, target):
    """Atomically replace one file after bounded Windows lock retries."""
    source = Path(source)
    target = Path(target)
    last_error = None
    for attempt in range(len(_PUBLISH_RETRY_DELAYS) + 1):
        try:
            os.replace(source, target)
            return target
        except PermissionError as error:
            last_error = error
            if attempt >= len(_PUBLISH_RETRY_DELAYS):
                break
            time.sleep(_PUBLISH_RETRY_DELAYS[attempt])
    raise last_error


def _unlink_with_retry(path):
    """Remove one stale release file after bounded Windows lock retries."""
    path = Path(path)
    last_error = None
    for attempt in range(len(_PUBLISH_RETRY_DELAYS) + 1):
        try:
            path.unlink()
            return
        except FileNotFoundError:
            return
        except PermissionError as error:
            last_error = error
            if attempt >= len(_PUBLISH_RETRY_DELAYS):
                break
            time.sleep(_PUBLISH_RETRY_DELAYS[attempt])
    raise last_error


_RUNTIME_LOADER_TAG_PATTERN = re.compile(
    r'<script\b(?=[^>]*\bdata-runtime-src\s*=)[^>]*>.*?</script>',
    re.IGNORECASE | re.DOTALL,
)


def _copy_file_atomic(source, destination):
    """Copy one release artifact through a same-directory atomic replace."""
    source = Path(source)
    destination = Path(destination)
    if not source.is_file():
        raise FileNotFoundError(f"Release consumer source is missing: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(
        f".{destination.name}.{os.getpid()}.{time.time_ns()}.tmp"
    )
    try:
        shutil.copy2(source, temporary)
        _os_replace_with_retry(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def _write_bytes_atomic(destination, payload):
    """Publish exact bytes through a same-directory atomic replace."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(
        f".{destination.name}.{os.getpid()}.{time.time_ns()}.tmp"
    )
    try:
        temporary.write_bytes(payload)
        _os_replace_with_retry(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def _snapshot_files(paths):
    """Capture exact file bytes for a bounded multi-file rollback."""
    snapshots = {}
    for path in paths:
        path = Path(path)
        if path.exists() and not path.is_file():
            raise IsADirectoryError(f"Runtime consumer target is not a file: {path}")
        snapshots[path] = path.read_bytes() if path.is_file() else None
    return snapshots


def _restore_file_snapshots(snapshots):
    """Restore dependencies first and transaction markers last."""
    failures = []
    for path, payload in snapshots.items():
        try:
            if payload is None:
                _unlink_with_retry(path)
            else:
                _write_bytes_atomic(path, payload)
        except Exception as error:
            failures.append(f"{path}: {error}")
    if failures:
        raise RuntimeError(
            "Runtime consumer rollback failed:\n  " + "\n  ".join(failures)
        )


def _verify_compute_sidecars(records, directory):
    """Verify the compute closure named by a runtime before consumer publication."""
    if not isinstance(records, list):
        raise ValueError("Compute sidecar inventory must be a list")
    root = Path(directory).resolve()
    seen = set()
    for item in records:
        if not isinstance(item, dict) or set(item) != {"path", "sha256", "byteLength"}:
            raise ValueError("Invalid compute sidecar descriptor")
        relative = _safe_release_relative_path(item["path"], "compute sidecar")
        if relative.parts[0] != "engine" or relative.as_posix() in seen:
            raise ValueError("Compute sidecar path must be unique and engine-owned")
        seen.add(relative.as_posix())
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Compute sidecar is missing or escapes its release")
        if not isinstance(item["byteLength"], int) or path.stat().st_size != item["byteLength"] \
                or _sha256_path(path) != item["sha256"]:
            raise ValueError("Compute sidecar byte count or SHA-256 mismatch")
    if records:
        from .wasm import compute_release_asset_paths
        from .compute_contracts import compute_contract_asset_paths
        expected = set(compute_release_asset_paths(root)) | set(compute_contract_asset_paths(root))
        if expected != seen:
            raise ValueError("Compute sidecar inventory does not match the complete worker closure")
    return len(seen)


def sync_release_runtime_consumer(
    consumer_root,
    release_dir,
    manifest,
    *,
    os_base=None,
    update_bootstrap=False,
    engine_demo_root=None,
    assets_only=False,
):
    """Install one verified platform runtime into a consumer.

    The bundle bytes, generated loader, manifest, cache token, integrity, and
    decoded-size contract use file-atomic writes. When ``engine_demo_root`` is
    supplied, the target must be that repository's Template; its seven-file
    runtime-kit inventory is preflighted and the entire managed file set is
    rolled back if commit or post-write verification fails.

    ``assets_only`` explicitly installs verified artifacts for source-driven
    consumers without changing their HTML or requiring a configured loader.
    It cannot be combined with bootstrap or Template runtime-kit updates.
    """
    if assets_only and (update_bootstrap or engine_demo_root is not None):
        raise ValueError(
            "Assets-only synchronization cannot update a bootstrap or runtime kit"
        )
    consumer_root = Path(consumer_root).resolve()
    release_dir = Path(release_dir).resolve()
    engine_demo_root = (
        Path(engine_demo_root).resolve() if engine_demo_root is not None else None
    )
    if (
        engine_demo_root is not None
        and consumer_root != (engine_demo_root / "Template").resolve()
    ):
        raise ValueError(
            "Engine-demo runtime-kit synchronization is restricted to Template"
        )
    index_path = consumer_root / "index.html"
    if not index_path.is_file():
        raise FileNotFoundError(
            f"Release consumer has no index.html: {consumer_root}"
        )

    bundle_name = str(manifest.get("name") or "").strip()
    integrity = str(manifest.get("browser_runtime_integrity") or "").strip()
    decoded_bytes = int(manifest.get("browser_runtime_decoded_bytes") or 0)
    compressed_bytes = int(manifest.get("browser_runtime_bytes") or 0)
    if not bundle_name or not re.fullmatch(r"sha384-[A-Za-z0-9+/]{64}", integrity):
        raise ValueError("Release manifest has no valid browser runtime identity")
    if decoded_bytes <= 0 or compressed_bytes <= 0:
        raise ValueError("Release manifest has no valid runtime size contract")

    runtime_source = release_dir / f"{bundle_name}.min.js.gz"
    if runtime_source.stat().st_size != compressed_bytes:
        raise ValueError("Release runtime compressed byte count does not match its manifest")
    _verify_release_runtime_gzip(runtime_source, integrity, decoded_bytes)
    token = _release_runtime_cache_token(runtime_source)
    package_sidecars = manifest.get("officialPackageAssets", [])
    verify_official_package_sidecars(package_sidecars, release_dir)
    compute_sidecars = manifest.get("computeAssets", [])
    _verify_compute_sidecars(compute_sidecars, release_dir)
    from .physics import verify_physics_sidecars
    physics_sidecars = manifest.get("physicsAssets", [])
    verify_physics_sidecars(physics_sidecars, release_dir)
    assets = consumer_root / "assets"
    runtime_destination = assets / f"{bundle_name}.min.js.gz"
    loader_destination = assets / "release-runtime-loader.js"
    loader_bytes = _release_runtime_loader_bytes()
    manifest_source = release_dir / f"{bundle_name}.manifest.json"
    manifest_destination = assets / f"{bundle_name}.manifest.json"
    if engine_demo_root is not None and not manifest_source.is_file():
        raise FileNotFoundError(
            f"Template runtime manifest source is missing: {manifest_source}"
        )
    provenance = manifest.get("provenance")
    provenance_source = None
    provenance_destination = None
    if isinstance(provenance, dict):
        provenance_name = str(provenance.get("path") or "")
        provenance_sha256 = str(provenance.get("sha256") or "")
        if provenance_name != f"{bundle_name}.provenance.json" or not re.fullmatch(
            r"[0-9a-f]{64}", provenance_sha256
        ):
            raise ValueError("Release manifest has an invalid provenance contract")
        provenance_source = release_dir / provenance_name
        if _sha256_path(provenance_source) != provenance_sha256:
            raise ValueError("Release provenance SHA-256 does not match its manifest")
        provenance_destination = assets / provenance_name
    elif engine_demo_root is not None:
        raise ValueError("Template runtime manifest has no provenance contract")

    loader_tag = _release_runtime_loader_tag(
        "./assets/release-runtime-loader.js",
        f"./assets/{bundle_name}.min.js.gz",
        "./assets/",
        integrity,
        decoded_bytes,
        compressed_bytes,
        token,
        runtime_base="./",
        os_base=os_base,
    )
    html = index_path.read_text(encoding="utf-8")
    updated = html
    if not assets_only:
        updated, replacements = _RUNTIME_LOADER_TAG_PATTERN.subn(loader_tag, html)
        if replacements != 1:
            raise RuntimeError(
                f"Expected one configured runtime loader in {index_path}; found {replacements}"
            )
    if update_bootstrap:
        bootstrap_destination = assets / "release-consumer-bootstrap.js"
        bootstrap_bytes = _RELEASE_CONSUMER_BOOTSTRAP_SOURCE.encode("utf-8")
        bootstrap_tag = (
            '\n  <!-- Bundler-managed consumer bootstrap -->\n'
            f'  <script src="./assets/release-consumer-bootstrap.js?v={token}"></script>'
        )
        updated, inline_replacements = _INLINE_CONSUMER_BOOTSTRAP_PATTERN.subn(
            bootstrap_tag,
            updated,
        )
        if inline_replacements > 1:
            raise RuntimeError(
                f"Expected one inline consumer bootstrap in {index_path}; "
                f"found {inline_replacements}"
            )
        if inline_replacements == 0:
            updated, external_replacements = _EXTERNAL_CONSUMER_BOOTSTRAP_PATTERN.subn(
                bootstrap_tag,
                updated,
            )
            if external_replacements != 1:
                raise RuntimeError(
                    f"Managed consumer bootstrap marker is missing from {index_path}"
                )
    else:
        bootstrap_destination = None
        bootstrap_bytes = None

    kit_destination = None
    kit_bytes = None
    candidate_loader = None
    candidate_kit = None
    if engine_demo_root is not None:
        if bundle_name != "particle-platform":
            raise ValueError(
                "Template engine-demo runtime-kit requires particle-platform"
            )
        source_files = _engine_demo_runtime_source_file_map(engine_demo_root, overrides={
            "physx-pe.wasm": engine_demo_root / "engine/sim/physics/physx-pe.wasm",
            "particle-platform.min.js.gz": runtime_source,
            "particle-platform.manifest.json": manifest_source,
            "particle-platform.provenance.json": provenance_source,
        })
        unique = f"{os.getpid()}.{time.time_ns()}"
        candidate_loader = assets / f".engine-demo-loader.{unique}.candidate"
        candidate_kit = assets / f".engine-demo-runtime-kit.{unique}.candidate"
        assets.mkdir(parents=True, exist_ok=True)
        try:
            candidate_loader.write_bytes(loader_bytes)
            source_files["release-runtime-loader.js"] = candidate_loader
            kit_bytes = _engine_demo_runtime_kit_manifest_bytes(source_files)
            candidate_kit.write_bytes(kit_bytes)
            candidate_files = dict(source_files)
            candidate_files[ENGINE_DEMO_RUNTIME_KIT_MANIFEST] = candidate_kit
            _validate_engine_demo_runtime_kit(
                candidate_files,
                engine_demo_root
                / "engine"
                / "sim"
                / "physics"
                / "physx-pe.wasm",
            )
        except Exception:
            _unlink_with_retry(candidate_loader)
            _unlink_with_retry(candidate_kit)
            raise
        kit_destination = (
            engine_demo_root
            / "Template"
            / "assets"
            / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
        )

    managed_paths = [
        runtime_destination,
        loader_destination,
        manifest_destination,
    ]
    managed_paths.extend(assets / item["path"] for item in package_sidecars)
    managed_paths.extend(consumer_root / item["path"] for item in compute_sidecars)
    managed_paths.extend(consumer_root / item["path"] for item in physics_sidecars)
    if engine_demo_root is not None:
        managed_paths.append(assets / "physx-pe.wasm")
    if provenance_destination is not None:
        managed_paths.append(provenance_destination)
    if bootstrap_destination is not None:
        managed_paths.append(bootstrap_destination)
    if not assets_only:
        managed_paths.append(index_path)
    if kit_destination is not None:
        managed_paths.append(kit_destination)
    try:
        snapshots = (
            _snapshot_files(managed_paths) if engine_demo_root is not None else None
        )
    except Exception:
        if candidate_loader is not None:
            _unlink_with_retry(candidate_loader)
        if candidate_kit is not None:
            _unlink_with_retry(candidate_kit)
        raise
    started = time.perf_counter()
    if engine_demo_root is not None:
        print(
            f"[bundle][template-runtime-sync][entry] consumer={consumer_root} "
            f"runtime={runtime_source}"
        )

    try:
        for item in package_sidecars:
            _copy_file_atomic(release_dir / item["path"], assets / item["path"])
        for item in compute_sidecars:
            _copy_file_atomic(release_dir / item["path"], consumer_root / item["path"])
        for item in physics_sidecars:
            _copy_file_atomic(release_dir / item["path"], consumer_root / item["path"])
        if engine_demo_root is not None:
            _copy_file_atomic(engine_demo_root / "engine/sim/physics/physx-pe.wasm", assets / "physx-pe.wasm")
        _copy_file_atomic(runtime_source, runtime_destination)
        _write_bytes_atomic(loader_destination, loader_bytes)
        if manifest_source.is_file():
            _copy_file_atomic(manifest_source, manifest_destination)
        if provenance_source is not None:
            _copy_file_atomic(provenance_source, provenance_destination)
        if bootstrap_destination is not None:
            _write_bytes_atomic(bootstrap_destination, bootstrap_bytes)
        if not assets_only:
            _write_bytes_atomic(index_path, updated.encode("utf-8"))
        if kit_destination is not None:
            _write_bytes_atomic(kit_destination, kit_bytes)

        _verify_release_runtime_gzip(runtime_destination, integrity, decoded_bytes)
        verify_official_package_sidecars(package_sidecars, assets)
        _verify_compute_sidecars(compute_sidecars, consumer_root)
        verify_physics_sidecars(physics_sidecars, consumer_root)
        deployed_html = index_path.read_text(encoding="utf-8")
        for expected in (() if assets_only else (
            f'data-integrity="{integrity}"',
            f'data-runtime-bytes="{decoded_bytes}"',
            f'data-runtime-compressed-bytes="{compressed_bytes}"',
            f'?v={token}',
        )):
            if expected not in deployed_html:
                raise RuntimeError(
                    f"Release consumer metadata verification failed: {expected}"
                )
        if update_bootstrap:
            if f'release-consumer-bootstrap.js?v={token}' not in deployed_html:
                raise RuntimeError(
                    "Managed consumer bootstrap cache identity was not updated"
                )
            if bootstrap_destination.read_bytes() != bootstrap_bytes:
                raise RuntimeError(
                    "Managed consumer bootstrap bytes were not synchronized"
                )
        if engine_demo_root is not None:
            deployed_source_files = _engine_demo_runtime_source_files(engine_demo_root)
            deployed_files = dict(deployed_source_files)
            deployed_files[ENGINE_DEMO_RUNTIME_KIT_MANIFEST] = kit_destination
            _validate_engine_demo_runtime_kit(
                deployed_files,
                engine_demo_root
                / "engine"
                / "sim"
                / "physics"
                / "physx-pe.wasm",
            )
    except Exception as error:
        if snapshots is not None:
            try:
                _restore_file_snapshots(snapshots)
            except Exception as rollback_error:
                duration_ms = (time.perf_counter() - started) * 1000.0
                print(
                    f"[bundle][template-runtime-sync][rollback-error] "
                    f"duration_ms={duration_ms:.3f} error={rollback_error}"
                )
                raise RuntimeError(
                    f"Template runtime synchronization failed ({error}); "
                    f"rollback also failed ({rollback_error})"
                ) from error
            duration_ms = (time.perf_counter() - started) * 1000.0
            print(
                f"[bundle][template-runtime-sync][error] "
                f"duration_ms={duration_ms:.3f} rolled_back=true error={error}"
            )
        raise
    finally:
        if candidate_loader is not None:
            _unlink_with_retry(candidate_loader)
        if candidate_kit is not None:
            _unlink_with_retry(candidate_kit)

    receipt = {
        "root": str(consumer_root),
        "runtime": str(runtime_destination),
        "integrity": integrity,
        "decoded_bytes": decoded_bytes,
        "compressed_bytes": compressed_bytes,
        "cache_token": token,
        "bootstrap_updated": bool(update_bootstrap),
        "assets_only": bool(assets_only),
    }
    if kit_destination is not None:
        receipt.update({
            "engine_demo_runtime_kit": str(kit_destination),
            "engine_demo_runtime_kit_sha256": hashlib.sha256(kit_bytes).hexdigest(),
            "engine_demo_runtime_kit_files": len(ENGINE_DEMO_RUNTIME_ASSET_COPIES),
        })
        duration_ms = (time.perf_counter() - started) * 1000.0
        print(
            f"[bundle][template-runtime-sync][exit] duration_ms={duration_ms:.3f} "
            f"files={receipt['engine_demo_runtime_kit_files']} "
            f"kit_sha256={receipt['engine_demo_runtime_kit_sha256']}"
        )
    return receipt


def _site_tree_manifest(root):
    """Return a deterministic content manifest for a staged or live site."""
    root = Path(root)
    manifest = []
    for path in sorted((entry for entry in root.rglob("*") if entry.is_file()),
                       key=lambda entry: entry.relative_to(root).as_posix()):
        manifest.append((path.relative_to(root).as_posix(), path.stat().st_size, _sha256_path(path)))
    return tuple(manifest)


def _sync_site_tree(source_dir, target_dir):
    """Synchronize a staged site into an existing live directory file-atomically."""
    source_dir = Path(source_dir)
    target_dir = Path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    source_files = {
        path.relative_to(source_dir)
        for path in source_dir.rglob("*")
        if path.is_file()
    }

    for relative in sorted(source_files, key=lambda value: value.as_posix()):
        source = source_dir / relative
        target = target_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(
            f".{target.name}.publish-{os.getpid()}-{time.time_ns()}.tmp"
        )
        try:
            shutil.copy2(source, temporary)
            _os_replace_with_retry(temporary, target)
        finally:
            if temporary.exists():
                _unlink_with_retry(temporary)

    stale_files = [
        path for path in target_dir.rglob("*")
        if path.is_file() and path.relative_to(target_dir) not in source_files
    ]
    for stale in sorted(stale_files, key=lambda value: len(value.parts), reverse=True):
        _unlink_with_retry(stale)

    directories = [path for path in target_dir.rglob("*") if path.is_dir()]
    for directory in sorted(directories, key=lambda value: len(value.parts), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass


def _publish_staged_site_in_place(staged_dir, final_dir, previous_dir, rename_error):
    """Publish through a stable live directory when Windows locks its handle."""
    started = time.perf_counter()
    print(
        f"[bundle][site-publish][fallback] mode=file-atomic-sync "
        f"reason={rename_error} final={final_dir}"
    )
    shutil.copytree(final_dir, previous_dir, copy_function=shutil.copy2)
    restored = False
    try:
        _sync_site_tree(staged_dir, final_dir)
        if _site_tree_manifest(final_dir) != _site_tree_manifest(staged_dir):
            raise OSError("File-atomic release-site publication failed manifest verification")
    except Exception:
        try:
            _sync_site_tree(previous_dir, final_dir)
            restored = _site_tree_manifest(final_dir) == _site_tree_manifest(previous_dir)
        finally:
            if restored and previous_dir.exists():
                shutil.rmtree(previous_dir)
        raise

    shutil.rmtree(staged_dir)
    shutil.rmtree(previous_dir)
    duration_ms = (time.perf_counter() - started) * 1000.0
    print(
        f"[bundle][site-publish][exit] mode=file-atomic-sync "
        f"duration_ms={duration_ms:.3f} final={final_dir}"
    )
    return final_dir


def _publish_staged_site(staged_dir, final_dir):
    """Publish a staged site with rollback and no recursively deleted live gap."""
    staged_dir = Path(staged_dir)
    final_dir = Path(final_dir)
    previous_dir = staged_dir.parent / f"{final_dir.name}.previous"
    started = time.perf_counter()
    print(f"[bundle][site-publish][entry] staged={staged_dir} final={final_dir}")

    if not staged_dir.is_dir():
        raise FileNotFoundError(f"Staged release site does not exist: {staged_dir}")
    if staged_dir.resolve() in {final_dir.resolve(), previous_dir.resolve()}:
        raise ValueError("Staged, final, and previous release-site paths must be distinct")

    final_dir.parent.mkdir(parents=True, exist_ok=True)
    if previous_dir.exists():
        if final_dir.exists():
            shutil.rmtree(previous_dir)
        else:
            previous_dir.replace(final_dir)
            print(f"[bundle][site-publish][recovery] restored={final_dir}")

    if final_dir.exists():
        try:
            _replace_path_with_retry(final_dir, previous_dir)
        except PermissionError as error:
            return _publish_staged_site_in_place(
                staged_dir,
                final_dir,
                previous_dir,
                error,
            )

    try:
        _replace_path_with_retry(staged_dir, final_dir)
    except Exception as error:
        if previous_dir.exists() and not final_dir.exists():
            _replace_path_with_retry(previous_dir, final_dir)
        duration_ms = (time.perf_counter() - started) * 1000.0
        print(
            f"[bundle][site-publish][error] duration_ms={duration_ms:.3f} "
            f"error={error}"
        )
        raise

    if previous_dir.exists():
        shutil.rmtree(previous_dir)
    duration_ms = (time.perf_counter() - started) * 1000.0
    print(f"[bundle][site-publish][exit] duration_ms={duration_ms:.3f} final={final_dir}")
    return final_dir

# Editor CSS files to copy into release/site/editor/css/
EDITOR_CSS_FILES = [
    "layout.css",
    "dark-theme.css",
    "widgets.css",
    "audio-editor.css",
    "collab.css",
    "guide.css",
    "material-editor.css",
    "asset-panel.css",
]

RELEASE_COMMON_FILES = [
    "docs.css",
    "docs-portal.css",
    "docs.js",
    "styles.css",
]


# The construction worker is a raw module sidecar. Keep its complete WebGPU OS
# module closure explicit: platform releases intentionally do not copy the raw
# OS tree, and a missing transitive module otherwise becomes an HTML MIME error.
REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS = (
    "apps/realmforge/construction/RealmForgeConstructionGenerationWorker.js",
    "apps/realmforge/construction/RealmForgeConstructionDocumentTransaction.js",
    "apps/realmforge/construction/RealmForgeProceduralHouseWorker.js",
    "apps/realmforge/construction/RealmForgeProceduralHouse.js",
    "apps/realmforge/construction/RealmForgeClimateOptions.js",
    "apps/realmforge/construction/RealmForgeHouseClimate.js",
    "apps/realmforge/construction/RealmForgeBuildIntent.js",
    "apps/realmforge/construction/RealmForgeBuildContentsText.js",
    "apps/realmforge/construction/RealmForgeHomeFeatureText.js",
    "apps/realmforge/construction/RealmForgeBuildingProgram.js",
    "apps/realmforge/construction/RealmForgeContentsContracts.js",
    "apps/realmforge/construction/RealmForgeContentsComposition.js",
    "apps/realmforge/construction/RealmForgeBuildTextRecovery.js",
    "apps/realmforge/construction/RealmForgeBuildSpellingGuards.js",
    "apps/realmforge/construction/RealmForgeBuildFamilies.js",
    "apps/realmforge/construction/RealmForgeConstructionFinish.js",
    "apps/realmforge/construction/RealmForgeHomeComposition.js",
    "apps/realmforge/construction/RealmForgeRoomComposition.js",
    "apps/realmforge/construction/RealmForgeHouseRoomComposition.js",
    "apps/realmforge/construction/RealmForgeFurnitureComponents.js",
    "apps/realmforge/construction/RealmForgeFurnitureGeometry.js",
    "apps/realmforge/construction/RealmForgeUpholsteryProfiles.js",
    "apps/realmforge/construction/RealmForgeUpholsteryComposition.js",
    "apps/realmforge/construction/RealmForgeDoorHardware.js",
    "apps/realmforge/construction/RealmForgeDoorControl.js",
    "apps/realmforge/construction/RealmForgeDoorControlOptions.js",
    "apps/realmforge/construction/RealmForgeBottleComponent.js",
    "apps/realmforge/construction/RealmForgeShelfProps.js",
    "apps/realmforge/construction/RealmForgeFixtureComponents.js",
    "apps/realmforge/construction/RealmForgePipeGeometry.js",
    "apps/realmforge/construction/RealmForgeSeatAnchors.js",
    "apps/realmforge/construction/RealmForgeGeneratedMechanisms.js",
    "apps/realmforge/construction/RealmForgeHousePlumbingFixtures.js",
    "apps/realmforge/construction/RealmForgeHouseServiceComposition.js",
    "apps/realmforge/construction/RealmForgeHouseServiceFoundation.js",
    "apps/realmforge/construction/RealmForgeHouseServices.js",
    "apps/realmforge/construction/RealmForgeHouseUtilityOptions.js",
    "apps/realmforge/construction/RealmForgeLightingOptions.js",
    "apps/realmforge/construction/RealmForgeCeilingLighting.js",
    "apps/realmforge/construction/RealmForgeAppliancePower.js",
    "apps/realmforge/construction/RealmForgeHouseWater.js",
    "apps/realmforge/construction/RealmForgeHouseMirrorOptions.js",
    "apps/realmforge/construction/RealmForgeHouseMirrors.js",
    "apps/realmforge/construction/RealmForgeHouseOutdoor.js",
    "apps/realmforge/construction/RealmForgeHouseOutdoorLayout.js",
    "apps/realmforge/construction/RealmForgeOutdoorOptions.js",
    "apps/realmforge/construction/RealmForgeDeckAssembly.js",
    "apps/realmforge/construction/RealmForgeHouseWindows.js",
    "apps/realmforge/construction/RealmForgeHouseWindowAssemblies.js",
    "apps/realmforge/construction/RealmForgeHouseWindowSkylights.js",
    "apps/realmforge/construction/RealmForgeWindowClearance.js",
    "apps/realmforge/construction/RealmForgeWindowGeometry.js",
    "apps/realmforge/construction/RealmForgeWindowLayout.js",
    "apps/realmforge/construction/RealmForgeWindowMaterials.js",
    "apps/realmforge/construction/RealmForgeWindowOptions.js",
    "apps/realmforge/construction/RealmForgeHouseWiring.js",
    "apps/realmforge/construction/RealmForgeHouseWiringCircuit.js",
    "apps/realmforge/construction/RealmForgeHouseWiringLayout.js",
    "apps/realmforge/construction/RealmForgeHouseWiringProtection.js",
    "apps/realmforge/construction/RealmForgeMultilevelHouseServices.js",
    "apps/realmforge/construction/RealmForgeMultistoreyHouse.js",
    "apps/realmforge/construction/RealmForgeServiceCutGeometry.js",
    "apps/realmforge/construction/RealmForgeServiceJunctionGeometry.js",
    "apps/realmforge/construction/RealmForgeServicePenetrations.js",
    "apps/realmforge/construction/RealmForgeServiceRouteClearance.js",
    "apps/realmforge/packages/RealmForgeProceduralGeneration.js",
    "apps/realmforge/material/RealmForgeMaterialContracts.js",
    "apps/realmforge/material/RealmForgeMaterialDerivations.js",
    "apps/realmforge/material/RealmForgeMaterialResolver.js",
    "apps/realmforge/material/RealmForgeMirrorSurface.js",
    "apps/realmforge/material/RealmForgeWindowSurface.js",
    "apps/realmforge/packages/RealmForgePackageContracts.js",
    "apps/realmforge/document/hash/RealmForgeContentHash.js",
    "apps/realmforge/contracts/RealmForgeContracts.js",
    "apps/realmforge/document/json/RealmForgeJson.js",
    "apps/realmforge/document/validation/ProAssetV2Validation.js",
    "apps/realmforge/modeler/document/ForgeSourceDocumentProjection.js",
    "apps/realmforge/construction/ConstructionExamples.js",
    "apps/realmforge/construction/ConstructionStockProducts.js",
    "apps/realmforge/construction/ConstructionResourceGraphValidation.js",
    "apps/realmforge/document/constants.js",
    "apps/realmforge/modeler/lang/ForgeSource.js",
    "apps/realmforge/construction/ConstructionContractCore.js",
    "apps/realmforge/construction/ConstructionPatterns.js",
    "apps/realmforge/construction/patterns/index.js",
    "apps/realmforge/construction/patterns/PatternExpansionCache.js",
    "apps/realmforge/construction/patterns/BondPattern.js",
    "apps/realmforge/construction/patterns/StudWallPattern.js",
    "apps/realmforge/construction/patterns/JoistGridPattern.js",
    "apps/realmforge/construction/patterns/RafterRunPattern.js",
    "apps/realmforge/construction/patterns/SheetGridPattern.js",
    "apps/realmforge/construction/patterns/BeamGridPattern.js",
    "apps/realmforge/construction/patterns/PatternPrimitives.js",
    "apps/realmforge/construction/patterns/PatternRectangles.js",
    "apps/realmforge/construction/ConstructionResources.js",
    "apps/realmforge/construction/ConstructionArticulationProfile.js",
    "apps/realmforge/construction/ConstructionToolProfiles.js",
    "apps/realmforge/construction/runtime/ConstructionCollisionValidation.js",
    "apps/realmforge/construction/runtime/ConstructionRuntimeContracts.js",
    "apps/realmforge/construction/runtime/ConstructionWindowHardwareRuntime.js",
    "apps/realmforge/storage/RealmForgeStorageGeometry.js",
    "apps/realmforge/modeler/motion/MotionExpr.js",
    "apps/realmforge/modeler/motion/MotionDrivers.js",
    "apps/realmforge/modeler/adapters/RealmForgeConstructionProductGeometry.js",
    "apps/realmforge/modeler/adapters/RealmForgeResourceAdapterContracts.js",
    "apps/realmforge/modeler/electrical/RealmForgeElectricalContracts.js",
    "apps/realmforge/modeler/electrical/RealmForgeElectricalDocumentProjection.js",
    "apps/realmforge/modeler/electronics/RealmForgeAvrRuntime.js",
    "apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js",
    "apps/realmforge/modeler/electronics/RealmForgeMicrocontrollerBoard.js",
    "apps/realmforge/modeler/electronics/RealmForgeMicrocontrollerProfiles.js",
    "apps/realmforge/modeler/runtime-plan/RealmForgeInterfaceNetwork.js",
    "apps/realmforge/modeler/runtime-plan/RealmForgeRuntimePlanCore.js",
    "apps/realmforge/modeler/system-graph/RealmForgeGraphTypes.js",
    "apps/realmforge/modeler/system-graph/RealmForgeNodeDefinitionRegistry.js",
    "apps/realmforge/modeler/system-graph/RealmForgeSystemGraphConstants.js",
    # House profiles and compiled role materials also execute in raw workers.
    "apps/realmforge/catalog/MaterialStylePolicyRegistry.js",
    "apps/realmforge/catalog/RagdollStylePolicyRegistry.js",
    "apps/realmforge/catalog/StyleRegistry.js",
    "apps/realmforge/catalog/StyleResolver.js",
    "apps/realmforge/catalog/TopologyPolicyRegistry.js",
    "apps/realmforge/construction/RealmForgeHouseAppearanceText.js",
    "apps/realmforge/document/binary/RealmForgeBinaryObjectContracts.js",
    "apps/realmforge/material/RealmForgeProceduralPbr.js",
    "apps/realmforge/material/studio/RealmForgeHouseAppearance.js",
    "apps/realmforge/material/studio/RealmForgeHouseAppearanceProfiles.js",
    "apps/realmforge/material/studio/RealmForgeTextureBindings.js",
    "apps/realmforge/material/studio/RealmForgeTextureRecipes.js",
    # Humanoid generation shares the construction workers' immutable source lane.
    "apps/realmforge/construction/RealmForgeHumanoidText.js",
    "apps/realmforge/construction/RealmForgeProceduralHumanoid.js",
    "apps/realmforge/modeler/humanoid/RealmForgeHumanoidPhysics.js",
    "apps/realmforge/ragdoll/RagdollValidator.js",
)

RELEASE_MODULE_WORKER_ROOT_PATHS = (
    "webgpu-os/storage/StorageWorker.js",
    "webgpu-os/apps/realmforge/construction/RealmForgeConstructionGenerationWorker.js",
    "webgpu-os/apps/realmforge/construction/RealmForgeProceduralHouseWorker.js",
)

REALMFORGE_CONSTRUCTION_GENERATION_WORKER_ENGINE_MODULE_PATHS = (
    "engine/state/util/canonical.js",
    "engine/render/geometry/Profile2D.js",
    "engine/render/geometry/ProfileSolidGeometry.js",
    "engine/assets/material/composite/ConstructionCompositeMaterialCatalog.js",
    "engine/assets/material/composite/CompositeMaterialContracts.js",
    "engine/assets/material/EngineMaterial.js",
    "engine/core/math/ChecksumMath.js",
    "engine/core/math/EngineMath.js",
    "engine/core/math/UnitMath.js",
    "engine/core/math/BufferMath.js",
    "engine/assets/material/composite/EngineCompositeMaterialCatalog.js",
    "engine/core/math/ConstraintMath.js",
    "engine/core/math/MathConstants.js",
    "engine/core/math/MathLine3.js",
    "engine/core/math/MathQuat.js",
    "engine/core/math/MathRandom.js",
    "engine/core/math/MathScalar.js",
    "engine/core/math/MathVec3.js",
    "engine/core/math/UnionFind.js",
    "engine/core/schema/StrictJsonValue.js",
    "engine/kaolin/ops/mesh/MeshOps.js",
    "engine/render/geometry/CapsuleGeometry.js",
    "engine/render/geometry/ConeGeometry.js",
    "engine/render/geometry/CubeGeometry.js",
    "engine/render/geometry/CylinderGeometry.js",
    "engine/render/geometry/GroundGeometry.js",
    "engine/render/geometry/PlaneGeometry.js",
    "engine/render/geometry/PolyhedralCsg.js",
    "engine/render/geometry/PrimitiveGeometry.js",
    "engine/render/geometry/RoundedBoxGeometry.js",
    "engine/render/geometry/SkyboxGeometry.js",
    "engine/render/geometry/SphereGeometry.js",
    "engine/render/geometry/TorusGeometry.js",
    "engine/sim/electrical/ElectricalContracts.js",
    "engine/sim/electrical/ElectricalNetCompiler.js",
    "engine/sim/electrical/Mechanics1D.js",
    # Authored humanoid geometry, skinning, and physics descriptors. The three
    # physics/rig utilities do not import or initialize a PhysX/WASM backend.
    "engine/assets/EngineModel.js",
    "engine/assets/humanoid/BoneMapper.js",
    "engine/assets/humanoid/FingerGenerator.js",
    "engine/assets/humanoid/FingerMapper.js",
    "engine/assets/humanoid/HandRig.js",
    "engine/assets/humanoid/HandRigBuilder.js",
    "engine/assets/humanoid/HumanoidRig.js",
    "engine/assets/humanoid/HumanoidRigBuilder.js",
    "engine/assets/humanoid/ProceduralHumanoid.js",
    "engine/assets/humanoid/SkeletonHeal.js",
    "engine/assets/humanoid/SkinPose.js",
    "engine/assets/rig/CharacterPhysicsAsset.js",
    "engine/assets/rig/JointLimits.js",
    "engine/assets/rig/RagdollBuilder.js",
    "engine/assets/rig/RagdollSim.js",
    "engine/assets/rig/RagdollSkinning.js",
    "engine/assets/rig/active-body/ActiveBodyRigBuilder.js",
    "engine/assets/vehicle/VehicleMath.js",
    "engine/sim/physics/rig/ActiveRigSchema.js",
    "engine/sim/physics/rig/CharacterPhysicsAssetAdapter.js",
    "engine/sim/physics/rig/RetargetGraph.js",
    # StyleRegistry retains the shared state registries through their barrel.
    "engine/assets/material/procedural/ProceduralPbrTexture.js",
    "engine/collab/CollabIdentity.js",
    "engine/core/math/BlendMath.js",
    "engine/core/math/FormatMath.js",
    "engine/core/math/FrameMath.js",
    "engine/core/math/ImageMath.js",
    "engine/core/math/MathBits.js",
    "engine/core/math/MathColor.js",
    "engine/core/math/MathEntropy.js",
    "engine/core/math/MathQuality.js",
    "engine/core/math/MathStatistics.js",
    "engine/core/math/MathValidation.js",
    "engine/state/authority/Capability.js",
    "engine/state/authority/CapabilityRegistry.js",
    "engine/state/authority/Identity.js",
    "engine/state/authority/PolicyEngine.js",
    "engine/state/causal/CausalParents.js",
    "engine/state/causal/DottedVersionVector.js",
    "engine/state/causal/HLC.js",
    "engine/state/codebook/CodeEntry.js",
    "engine/state/codebook/PatternCodebook.js",
    "engine/state/codebook/SymbolicSig.js",
    "engine/state/commit/CommitGate.js",
    "engine/state/commit/CorrectionGate.js",
    "engine/state/consistency/CRDT.js",
    "engine/state/consistency/InvariantConfluence.js",
    "engine/state/consistency/OptimisticValidator.js",
    "engine/state/consistency/Reservation.js",
    "engine/state/consistency/SerializableQueue.js",
    "engine/state/entity/EntityRegistry.js",
    "engine/state/entity/ProvenanceStore.js",
    "engine/state/entity/SchemaRegistry.js",
    "engine/state/facts/Branch.js",
    "engine/state/facts/Causality.js",
    "engine/state/facts/Constraints.js",
    "engine/state/facts/Fact.js",
    "engine/state/facts/FactStore.js",
    "engine/state/index.js",
    "engine/state/integrity/Checkpoint.js",
    "engine/state/integrity/EventLog.js",
    "engine/state/integrity/GarbageCollector.js",
    "engine/state/integrity/Retention.js",
    "engine/state/integrity/SecureCrypto.js",
    "engine/state/integrity/SecureRetention.js",
    "engine/state/integrity/StateRoot.js",
    "engine/state/observer/Projection.js",
    "engine/state/perception/ResonanceIndex.js",
    "engine/state/replication/ByzantineAdapter.js",
    "engine/state/replication/CheckpointQuorum.js",
    "engine/state/replication/CrossShardCoordinator.js",
    "engine/state/replication/RaftAdapter.js",
    "engine/state/replication/ReplicatedLog.js",
    "engine/state/replication/ShardRouter.js",
    "engine/state/resonance/ResonanceVector.js",
    "engine/state/resonance/Transforms.js",
    "engine/state/sim/WorldDynamics.js",
    "engine/state/spatial/SpatialCode.js",
    "engine/state/time/Fencing.js",
    "engine/state/time/SimulationClock.js",
    "engine/state/time/TimeModel.js",
    "engine/state/transaction/CommitCoordinator.js",
    "engine/state/transaction/Idempotency.js",
    "engine/state/transaction/ProposalPool.js",
    "engine/state/transaction/Transaction.js",
    "engine/state/uso/USO.js",
    "engine/state/uso/USORegistry.js",
    "engine/state/util/hashing.js",
    "engine/state/verify/ModelCheck.js",
    "engine/state/version.js",
    "engine/state/witness/Witness.js",
    "engine/state/workflow/Inbox.js",
    "engine/state/workflow/Outbox.js",
    "engine/state/workflow/Reconciler.js",
    "engine/state/workflow/Saga.js",
    "engine/state/worldmodel/AffordanceRegistry.js",
    "engine/state/worldmodel/BeliefStore.js",
    "engine/state/worldmodel/CausalDynamics.js",
    "engine/state/worldmodel/ObjectGraph.js",
    "engine/state/worldmodel/PredictionSandbox.js",
    "engine/state/worldmodel/ToolEffectModel.js",
    "engine/state/worldmodel/UntrustedBoundary.js",
)

# The AVR runtime's native index re-exports this complete, pinned dependency
# graph. Keep the vendor layout intact so raw worker imports resolve unchanged.
REALMFORGE_CONSTRUCTION_GENERATION_WORKER_VENDOR_MODULE_PATHS = (
    "vendor/avr8js/0.21.1/browser/index.js",
    "vendor/avr8js/0.21.1/browser/cpu/cpu.js",
    "vendor/avr8js/0.21.1/browser/cpu/instruction.js",
    "vendor/avr8js/0.21.1/browser/cpu/interrupt.js",
    "vendor/avr8js/0.21.1/browser/peripherals/adc.js",
    "vendor/avr8js/0.21.1/browser/peripherals/clock.js",
    "vendor/avr8js/0.21.1/browser/peripherals/eeprom.js",
    "vendor/avr8js/0.21.1/browser/peripherals/gpio.js",
    "vendor/avr8js/0.21.1/browser/peripherals/spi.js",
    "vendor/avr8js/0.21.1/browser/peripherals/timer-attiny.js",
    "vendor/avr8js/0.21.1/browser/peripherals/timer.js",
    "vendor/avr8js/0.21.1/browser/peripherals/twi.js",
    "vendor/avr8js/0.21.1/browser/peripherals/usart.js",
    "vendor/avr8js/0.21.1/browser/peripherals/usi.js",
    "vendor/avr8js/0.21.1/browser/peripherals/watchdog.js",
)

RELEASE_MODULE_WORKER_CLOSURE_PATHS = (
    "webgpu-os/storage/StorageWorker.js",
    "webgpu-os/storage/IncrementalSha256.js",
    "webgpu-os/packages/Zip.js",
    *(f"webgpu-os/{path}" for path in REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS),
    *REALMFORGE_CONSTRUCTION_GENERATION_WORKER_ENGINE_MODULE_PATHS,
    *REALMFORGE_CONSTRUCTION_GENERATION_WORKER_VENDOR_MODULE_PATHS,
)

# This public Engine worker runs in its own module realm, including when the
# calling GpuRenderWorkerHost is compiled into the platform or Engine bundle.
GPU_RENDER_WORKER_ENTRY_PATH = "engine/core/gpu/GpuRenderWorker.js"
GPU_RENDER_WORKER_MODULE_PATHS = (
    GPU_RENDER_WORKER_ENTRY_PATH,
    "engine/core/gpu/AsyncGPUWorkScheduler.js",
    "engine/core/gpu/BufferPool.js",
    "engine/core/gpu/GpuFormats.js",
    "engine/core/gpu/GpuFrameBudgetBroker.js",
    "engine/core/gpu/GpuDescriptorIdentity.js",
    "engine/core/math/BufferMath.js",
    "engine/core/math/ChecksumMath.js",
    "engine/core/gpu/GpuShaderDiagnostics.js",
    "engine/core/gpu/PipelineCache.js",
    "engine/core/gpu/GpuDevice.js",
)

REALMFORGE_SOURCE_CITY_CAPTURE_PATHS = (
    "apps/realmforge/virtual-realm/captures/source-city.snapshot.json",
    "apps/realmforge/virtual-realm/captures/source-city-kernel.snapshot.json",
)


# The compiled WebGPU OS still resolves these files by URL at runtime. Most of
# their parent directories are intentionally excluded from the release tree
# because their JavaScript is already in particle-os.min.js; this explicit
# allow-list prevents SPA HTML fallbacks from being returned for the parser-time
# source-authority bootstrap, module workers, and JSON catalogs.
WEBGPU_OS_RUNTIME_ASSET_PATHS = (
    "app.html",
    "app-boot.js",
    "app.css",
    "watch-party.html",
    "watch-party-boot.js",
    "watch-party.css",
    "apps/realmforge/release/RealmForgePhase10SourceTimingBootstrap.js",
    *REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS,
    "storage/StorageWorker.js",
    "storage/IncrementalSha256.js",
    "packages/Zip.js",
    "platform/runtime-host/SiteArchiveRouter.js",
    "platform/runtime-host/SiteArchiveConfig.js",
    "kernel/net-safety.js",
    "kernel/trust/roots.json",
    "shared/EchoStatusGlyph.css",
    "shell/echo-guide/EchoGuidePresence.css",
    "factory/apps/sewing/studio/studio.css",
    *REALMFORGE_SOURCE_CITY_CAPTURE_PATHS,
    "apps/ai-echo/manifest.json",
    "apps/the-first-shard/content/examples/spell/echo-bolt/package.json",
    "apps/the-first-shard/content/examples/storylet/unpaid-garrison/package.json",
    "apps/the-first-shard/content/examples/rift/ruined-future-overlap/package.json",
    "apps/the-first-shard/content/examples/animation/humanoid-base/package.json",
    "factory/layouts/browser.json",
    "factory/layouts/document.json",
    "factory/layouts/fullscreen.json",
    "factory/layouts/ide.json",
    "factory/layouts/minimal.json",
    "factory/layouts/split.json",
    "factory/profiles/built-in/asset-browser.json",
    "factory/profiles/built-in/code.json",
    "factory/profiles/built-in/document.json",
    "factory/profiles/built-in/game-editor.json",
    "factory/profiles/built-in/minimal.json",
    "factory/profiles/built-in/shader-debug.json",
    "factory/profiles/built-in/shader.json",
    "factory/profiles/built-in/system.json",
    "factory/apps/notepad/large-text-index-worker.js",
    "factory/apps/paint/platform/paintWorker.js",
    "factory/apps/paint/platform/animationExportWorker.js",
    "factory/apps/paint/io/gifEncoder.js",
    "factory/apps/fractal/assets/materials/cosmic-marble-v1.webp",
    "factory/apps/fractal/assets/materials/forged-bronze-v1.webp",
    "factory/apps/fractal/assets/materials/iridescent-geode-v1.webp",
    "factory/apps/fractal/assets/materials/living-mineral-v1.webp",
    "factory/apps/particles/assets/materials/cosmic-plasma.png",
    "factory/apps/particles/assets/materials/crystal-frost.png",
    "factory/apps/particles/assets/materials/molten-mineral.png",
    "factory/apps/pinball/assets/dimensional-foundry-playfield-v1.png",
    "factory/apps/setup-center/assets/setup-realm-orbit-v1.png",
    "factory/apps/setup-center/assets/setup-spark-trail-v1.png",
    "factory/apps/smith-lab/assets/smith-lab-rf-hero.png",
)

WEBGPU_OS_STABLE_BOOTSTRAP_DIRECTORY_PATHS = (
    "bootstrap",
    "platform/runtime-host",
    "platform/network-host",
    "system-release",
)


def _webgpu_os_stable_bootstrap_asset_paths(root=ROOT):
    """Inventory every physical file owned by the stable browser bootstrap.

    The replaceable system-release builder excludes these paths from release
    install operations.  Keeping the source inventory here makes both static
    site layouts ship the complete host, including transitive modules that are
    not necessarily members of the service worker's recovery hotset.
    """
    source_root = Path(root).resolve() / "webgpu-os"
    paths = [
        "index.html",
        "runtime.html",
        "boot-theme.js",
        "BrandMark.js",
        "BrandMark.css",
        "BrandMarkSurface.js",
        "shared/EchoFormProfile.js",
        "shared/EchoForm.js",
        "shared/EchoForm.css",
        STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH.removeprefix("webgpu-os/"),
    ]
    missing = []
    for relative_name in paths:
        if not (source_root / relative_name).is_file():
            missing.append(str(source_root / relative_name))
    for relative_directory in WEBGPU_OS_STABLE_BOOTSTRAP_DIRECTORY_PATHS:
        directory = source_root / relative_directory
        if not directory.is_dir():
            missing.append(str(directory))
            continue
        for source in directory.rglob("*"):
            if source.is_symlink():
                raise ValueError(
                    f"Stable WebGPU OS bootstrap assets cannot contain symlinks: {source}"
                )
            if source.is_file():
                paths.append(source.relative_to(source_root).as_posix())
    if missing:
        raise FileNotFoundError(
            "Required stable WebGPU OS bootstrap assets are missing:\n  "
            + "\n  ".join(missing)
        )
    return tuple(sorted(set(paths)))


# Engine SDKs carry a few shared OS resources without shipping the OS launcher.
# Importing their bundler must not require the full platform source tree. An
# actual OS publisher always resolves the strict inventory from its own root.
WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS = (
    _webgpu_os_stable_bootstrap_asset_paths(ROOT)
    if (ROOT / "webgpu-os/index.html").is_file() else ()
)

_WEBGPU_OS_PWA_FIXED_ASSET_PATHS = (
    "manifest.webmanifest",
    "assets/webgpu-os-icon.svg",
    "assets/particle-realms-192.png",
    "assets/particle-realms-512.png",
    "assets/particle-realms-maskable-512.png",
    "assets/particle-realms-apple-touch-180.png",
    "offline.html",
    "sw.js",
)
WEBGPU_OS_PWA_ASSET_PATHS = (
    *_WEBGPU_OS_PWA_FIXED_ASSET_PATHS,
    *WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS,
)

ENGINE_DEMO_RUNTIME_DEPLOYMENT_ROOT = "assets/engine-demo"

# AI Echo exports and previews engine demos against one immutable, provenance-
# verified platform runtime profile.  Keep the source and flat deployed name in
# a single allow-list so no unrelated Template file can leak into production.
ENGINE_DEMO_RUNTIME_ASSET_COPIES = (
    ("Template/assets/particle-platform.min.js.gz", "particle-platform.min.js.gz"),
    ("Template/assets/particle-platform.manifest.json", "particle-platform.manifest.json"),
    ("Template/assets/particle-platform.provenance.json", "particle-platform.provenance.json"),
    ("Template/assets/release-runtime-loader.js", "release-runtime-loader.js"),
    ("Template/assets/physx-pe.wasm", "physx-pe.wasm"),
    ("Template/serve.py", "serve.py"),
    ("Template/launch.bat", "launch.bat"),
)

ENGINE_DEMO_RUNTIME_KIT_MANIFEST = "engine-demo.runtime-kit.json"
ENGINE_DEMO_STARTER_ARCHIVE_PATH = (
    "assets/engine-demo/downloads/v1/particle-engine-demo-starter.zip"
)

ENGINE_DEMO_RUNTIME_DEPLOYMENT_PATHS = tuple(
    f"{ENGINE_DEMO_RUNTIME_DEPLOYMENT_ROOT}/{deployed_name}"
    for _, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
) + (f"{ENGINE_DEMO_RUNTIME_DEPLOYMENT_ROOT}/{ENGINE_DEMO_RUNTIME_KIT_MANIFEST}",)

WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS = (
    *WEBGPU_OS_PWA_ASSET_PATHS,
    *WEBGPU_OS_RUNTIME_ASSET_PATHS,
    *ENGINE_DEMO_RUNTIME_DEPLOYMENT_PATHS,
    ENGINE_DEMO_STARTER_ARCHIVE_PATH,
    "release-boot.js",
    "assets/release-runtime-loader.js",
)

WEBGPU_OS_SHELL_ASSET_COPIES = (
    ("plauna/styles/plauna.css", "styles/plauna.css"),
    ("plauna/styles/plauna.css", "webgpu-os/styles/plauna.css"),
    ("plauna/styles/plauna.css", "plauna/styles/plauna.css"),
    ("plauna/motion/MPAFallback.js", "plauna/motion/MPAFallback.js"),
    ("plauna/motion/PageTransition.js", "plauna/motion/PageTransition.js"),
    ("plauna/motion/PageTransitionContracts.js", "plauna/motion/PageTransitionContracts.js"),
    ("plauna/motion/PageTransitionManager.js", "plauna/motion/PageTransitionManager.js"),
    ("plauna/motion/PageTransitionPresets.js", "plauna/motion/PageTransitionPresets.js"),
    ("editor/js/workers/CollabSignalWorker.js", "editor/js/workers/CollabSignalWorker.js"),
    *((path, path) for path in REALMFORGE_CONSTRUCTION_GENERATION_WORKER_ENGINE_MODULE_PATHS),
    *((path, path) for path in REALMFORGE_CONSTRUCTION_GENERATION_WORKER_VENDOR_MODULE_PATHS),
    ("vendor/avr8js/0.21.1/LICENSE", "vendor/avr8js/0.21.1/LICENSE"),
    ("vendor/avr8js/0.21.1/upstream/LICENSE", "vendor/avr8js/0.21.1/upstream/LICENSE"),
    ("vendor/avr8js/0.21.1/provenance.json", "vendor/avr8js/0.21.1/provenance.json"),
)


# Files that remain URL-addressable beside a compiled platform bundle. The
# bundler cannot absorb module workers, CSS @imports, fetch()-loaded JSON,
# browser-decoded images, or WASM and still preserve their URL semantics. Keep
# their source and deployed paths in one audited contract instead of scattering
# one-off copies through the release builder.
RELEASE_SITE_FIXED_SIDECAR_ASSET_COPIES = (
    ("favicon.svg", "favicon.svg"),
    ("assets/ragdoll.glb", "assets/ragdoll.glb"),
    *((path, path) for path in GPU_RENDER_WORKER_MODULE_PATHS),
    ("webgpu-os/BrandMark.js", "webgpu-os/BrandMark.js"),
    ("webgpu-os/BrandMarkSurface.js", "webgpu-os/BrandMarkSurface.js"),
    ("webgpu-os/BrandMark.css", "webgpu-os/BrandMark.css"),
    # The preview publisher reads this declaration to select the audited
    # thumbnail inventory. Preserve it for isolated builds of both SDKs.
    ("webgpu-os/factory/apps/ambient-studio/AmbientCollectionCatalog.js",
     "webgpu-os/factory/apps/ambient-studio/AmbientCollectionCatalog.js"),
    ("webgpu-os/assets/webgpu-os-icon.svg", "webgpu-os/assets/webgpu-os-icon.svg"),
    ("tests/assets/corridor/academy-prism-v1.webp", "assets/corridor/academy-prism-v1.webp"),
    ("tests/assets/corridor/playground-observatory-v1.webp", "assets/corridor/playground-observatory-v1.webp"),
    ("tests/assets/corridor/companion-gateway-v1.webp", "assets/corridor/companion-gateway-v1.webp"),
    ("agi/llm/workers/LLMTokenizerWorker.js", "agi/llm/workers/LLMTokenizerWorker.js"),
    ("agi/llm/runtime/Tokenizer.js", "agi/llm/runtime/Tokenizer.js"),
    ("agi/llm/runtime/PromptTemplate.js", "agi/llm/runtime/PromptTemplate.js"),
    ("agi/llm/workers/LLMLoadPlannerWorker.js", "agi/llm/workers/LLMLoadPlannerWorker.js"),
    ("agi/llm/inference/CacheGovernor.js", "agi/llm/inference/CacheGovernor.js"),
    ("editor/js/workers/ProfilerCanvasWorker.js", "editor/js/workers/ProfilerCanvasWorker.js"),
    ("editor/js/workers/CollabSignalWorker.js", "editor/js/workers/CollabSignalWorker.js"),
    ("engine/sim/particles/SnapshotWorker.js", "editor/SnapshotWorker.js"),
    ("engine/audio/synth/PatchRunner.worklet.js", "engine/audio/synth/PatchRunner.worklet.js"),
    ("engine/sim/particles/SnapshotWorker.js", "engine/sim/particles/SnapshotWorker.js"),
    ("engine/core/math/MathPacking.js", "engine/core/math/MathPacking.js"),
    ("engine/core/math/MathBits.js", "engine/core/math/MathBits.js"),
    ("engine/sim/physics/physx-pe.wasm", "assets/physx-pe.wasm"),
    ("engine/sim/physics/physx-pe.wasm", "editor/physx-pe.wasm"),
    ("engine/sim/physics/physx-pe.wasm", "engine/sim/physics/physx-pe.wasm"),
    ("plauna/styles/plauna.css", "plauna/styles/plauna.css"),
    ("plauna/styles/plauna-modular.css", "plauna/styles/plauna-modular.css"),
    ("plauna/styles/tokens.css", "plauna/styles/tokens.css"),
)

ENGINE_COMPOSITE_MATERIAL_CATALOG = (
    "engine/assets/material/composite/EngineCompositeMaterialCatalog.js"
)

PARTICLE_VOICE_LAB_PATH = "agi/particle_voice/lab/voice-lab.html"
PARTICLE_VOICE_WORKLET_PATH = "agi/particle_voice/worklet/ParticleVoiceProcessor.js"


MORPHFIELD_SCHEMA_SOURCE_ROOT = PurePosixPath("engine/render/morphfield/schemas")
MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT = PurePosixPath("schemas/morphfield/v2")
MORPHFIELD_SCHEMA_ID_ROOT = "https://particlerealms.online/schemas/morphfield/v2"
MORPHFIELD_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"


def _reject_non_json_constant(token):
    raise ValueError(f"non-JSON numeric token {token!r}")


def _parse_finite_json_float(token):
    value = float(token)
    if not math.isfinite(value):
        raise ValueError(f"JSON number {token!r} exceeds the finite runtime range")
    return value


def _reject_duplicate_json_members(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object member {key!r}")
        result[key] = value
    return result


def _safe_release_relative_path(value, label):
    """Normalize one source/deployment path and reject traversal or drive syntax."""
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"Invalid {label} path: {value!r}")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or not path.parts
        or any(part in {"", ".", ".."} or ":" in part for part in path.parts)
    ):
        raise ValueError(f"Unsafe {label} path: {value!r}")
    return path


def _strict_json_file(path, label):
    try:
        return json.loads(
            Path(path).read_bytes(),
            parse_constant=_reject_non_json_constant,
            parse_float=_parse_finite_json_float,
            object_pairs_hook=_reject_duplicate_json_members,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise ValueError(f"Invalid {label} JSON: {path}: {error}") from error


def particle_voice_release_asset_paths(root):
    """Return the exact raw lab/AudioWorklet module and stylesheet closure.

    AudioWorklet.addModule() cannot execute the compiled module registry, and
    the standalone lab deliberately uses ordinary ESM. Walk both real entry
    points with the existing dependency parser instead of copying the whole AGI
    tree or maintaining a second, easily stale list of their imported modules.
    The lab stylesheet is linked from the HTML and admitted only when it is a
    local, dependency-free CSS file, so a future @import/url() cannot become a
    production-only omission. Particle Voice's shaders are generated JS
    strings, not fetched WGSL assets.
    """
    from .graph import ModuleGraph

    root = Path(root).resolve()
    lab_path = root / PARTICLE_VOICE_LAB_PATH
    html = lab_path.read_text(encoding="utf-8", errors="strict")
    scripts = re.findall(
        r'<script\b([^>]*)>([\s\S]*?)</script\s*>', html, flags=re.IGNORECASE,
    )
    modules = [
        (attributes, source) for attributes, source in scripts
        if re.search(r'\btype\s*=\s*([\'"])module\1', attributes, flags=re.IGNORECASE)
    ]
    if len(modules) != 1 or re.search(r'\bsrc\s*=', modules[0][0], flags=re.IGNORECASE):
        raise ValueError("Particle Voice lab must contain exactly one inline module entry")

    stylesheets = []
    for attributes in re.findall(r'<link\b([^>]*)>', html, flags=re.IGNORECASE):
        rel_matches = re.findall(
            r'\brel\s*=\s*([\'"])(.*?)\1', attributes,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not rel_matches:
            continue
        if len(rel_matches) != 1:
            raise ValueError("Particle Voice lab link elements must not repeat rel")
        rel_tokens = {token.lower() for token in rel_matches[0][1].split()}
        if "stylesheet" not in rel_tokens:
            continue
        href_matches = re.findall(
            r'\bhref\s*=\s*([\'"])(.*?)\1', attributes,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if len(href_matches) != 1 or not href_matches[0][1]:
            raise ValueError("Particle Voice lab stylesheet must have exactly one quoted href")
        stylesheets.append(href_matches[0][1])
    if len(stylesheets) != 1:
        raise ValueError("Particle Voice lab must contain exactly one local stylesheet")

    stylesheet_spec = stylesheets[0]
    if (
        not stylesheet_spec.startswith((".", "/"))
        or stylesheet_spec.startswith("//")
        or "?" in stylesheet_spec
        or "#" in stylesheet_spec
        or "\\" in stylesheet_spec
    ):
        raise ValueError(
            f"Particle Voice release stylesheet is not a plain local path: {stylesheet_spec}"
        )
    stylesheet_path = (
        root / stylesheet_spec.lstrip("/")
        if stylesheet_spec.startswith("/")
        else lab_path.parent / stylesheet_spec
    ).resolve()
    try:
        stylesheet_relative = stylesheet_path.relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError(
            f"Particle Voice stylesheet escapes release root: {stylesheet_path}"
        ) from error
    if stylesheet_path.suffix.lower() != ".css":
        raise ValueError(
            f"Particle Voice release stylesheet must be CSS: {stylesheet_relative}"
        )
    if not stylesheet_path.is_file():
        raise FileNotFoundError(
            f"Particle Voice release stylesheet is missing: {stylesheet_path}"
        )
    stylesheet_source = stylesheet_path.read_text(encoding="utf-8", errors="strict")
    stylesheet_without_comments = re.sub(
        r'/\*[\s\S]*?\*/', '', stylesheet_source,
    )
    if re.search(r'@import\b|url\s*\(', stylesheet_without_comments, flags=re.IGNORECASE):
        raise ValueError(
            "Particle Voice release stylesheet must not contain @import or url() dependencies: "
            f"{stylesheet_relative}"
        )

    graph = ModuleGraph(root)
    graph.walk_source(PARTICLE_VOICE_LAB_PATH, modules[0][1])
    graph.walk(PARTICLE_VOICE_WORKLET_PATH)
    if graph.errors:
        raise RuntimeError(
            "Particle Voice release dependency graph is incomplete:\n  "
            + "\n  ".join(str(error) for error in graph.errors)
        )
    paths = {stylesheet_relative}
    for filename in graph.order:
        path = Path(filename).resolve()
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError as error:
            raise ValueError(f"Particle Voice dependency escapes release root: {path}") from error
        if not path.is_file():
            raise FileNotFoundError(f"Particle Voice release dependency is missing: {path}")
        # Do not accept the graph's legacy parse fallback or external packages
        # in this independently executable, first-party sidecar closure.
        try:
            imports, exports = parse_module(graph.modules[filename])
        except ParseError as error:
            raise ValueError(f"Invalid Particle Voice release module: {relative}: {error}") from error
        specs = [item.spec for item in imports if item.spec]
        specs.extend(item.spec for item in exports if item.reexport and item.spec)
        for spec in specs:
            if not spec.startswith((".", "/")) or spec.startswith("//"):
                raise ValueError(f"Particle Voice release dependency is not local: {relative}: {spec}")
        paths.add(relative)
    return tuple(sorted(paths))


def release_site_sidecar_asset_manifest(root):
    """Return the audited source-to-deployment contract for bundle sidecars.

    The dynamic portions are still fail-closed: the Plauna theme registry must
    exactly match theme directories, modular CSS must index every widget CSS
    file, the composite material catalog must reference every resource JSON,
    and the Particle Voice lab/worklet must have a complete raw module and
    stylesheet closure.
    This makes adding a URL-loaded asset a release-contract change instead of a
    production-only 404.
    """
    from .compute_contracts import compute_contract_asset_paths
    from .wasm import compute_release_asset_paths
    root = Path(root).resolve()
    _validate_release_module_graph(
        root, ".", "GPU render worker", follow_imports=True,
        entry_relative_paths=(GPU_RENDER_WORKER_ENTRY_PATH,),
        expected_relative_paths=GPU_RENDER_WORKER_MODULE_PATHS,
    )
    copies = list(RELEASE_SITE_FIXED_SIDECAR_ASSET_COPIES)
    from .physics import physics_release_asset_paths
    copies.extend((path, path) for path in physics_release_asset_paths(root))
    copies.extend((path, path) for path in compute_release_asset_paths(root))
    copies.extend((path, path) for path in compute_contract_asset_paths(root))
    copies.extend((path, path) for path in particle_voice_release_asset_paths(root))
    from .ambient import ambient_release_asset_paths
    copies.extend((path, path) for path in ambient_release_asset_paths(root))
    copies.extend(
        (f"editor/css/{name}", f"editor/css/{name}")
        for name in EDITOR_CSS_FILES
    )

    theme_index_path = root / "plauna" / "themes" / "index.json"
    theme_index = _strict_json_file(theme_index_path, "Plauna theme registry")
    theme_names = theme_index.get("themes") if isinstance(theme_index, dict) else None
    if (
        not isinstance(theme_names, list)
        or not theme_names
        or any(not isinstance(name, str) or not name for name in theme_names)
        or len(theme_names) != len(set(theme_names))
    ):
        raise ValueError("Plauna theme registry must contain a unique, non-empty themes list")
    for name in theme_names:
        normalized = _safe_release_relative_path(name, "Plauna theme name")
        if len(normalized.parts) != 1:
            raise ValueError(f"Plauna theme name must be one folder: {name!r}")
    discovered_themes = {
        path.parent.name
        for path in (root / "plauna" / "themes").glob("*/theme.json")
        if path.is_file()
    }
    if set(theme_names) != discovered_themes:
        raise ValueError(
            "Plauna theme registry/directory mismatch: "
            f"missing={sorted(set(theme_names) - discovered_themes)}, "
            f"unindexed={sorted(discovered_themes - set(theme_names))}"
        )
    copies.append(("plauna/themes/index.json", "plauna/themes/index.json"))
    copies.extend(
        (f"plauna/themes/{name}/theme.json", f"plauna/themes/{name}/theme.json")
        for name in theme_names
    )

    widget_root = (root / "plauna" / "widgets").resolve()
    widget_sources = {
        path.relative_to(root).as_posix()
        for path in widget_root.rglob("*.css")
        if path.is_file()
    }
    modular_path = root / "plauna" / "styles" / "plauna-modular.css"
    modular_source = modular_path.read_text(encoding="utf-8", errors="strict")
    imported_widgets = set()
    for spec in re.findall(r"@import\s+url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", modular_source):
        target = (modular_path.parent / spec).resolve()
        try:
            target.relative_to(widget_root)
        except ValueError:
            continue
        imported_widgets.add(target.relative_to(root).as_posix())
    if not widget_sources or imported_widgets != widget_sources:
        raise ValueError(
            "Plauna modular CSS/widget directory mismatch: "
            f"missing={sorted(imported_widgets - widget_sources)}, "
            f"unindexed={sorted(widget_sources - imported_widgets)}"
        )
    copies.extend((path, path) for path in sorted(widget_sources))

    catalog_path = root / ENGINE_COMPOSITE_MATERIAL_CATALOG
    catalog_source = catalog_path.read_text(encoding="utf-8", errors="strict")
    catalog_resources = {
        f"engine/assets/material/composite/{relative}"
        for relative in re.findall(
            r"new\s+URL\(\s*['\"]\./(resources/[^'\"]+\.json)['\"]",
            catalog_source,
        )
    }
    resource_root = root / "engine" / "assets" / "material" / "composite" / "resources"
    discovered_resources = {
        path.relative_to(root).as_posix()
        for path in resource_root.rglob("*.json")
        if path.is_file()
    }
    if not catalog_resources or catalog_resources != discovered_resources:
        raise ValueError(
            "Composite material catalog/resource mismatch: "
            f"missing={sorted(catalog_resources - discovered_resources)}, "
            f"unindexed={sorted(discovered_resources - catalog_resources)}"
        )
    copies.extend((path, path) for path in sorted(catalog_resources))

    manifest = []
    destinations = {}
    missing = []
    for source_name, destination_name in copies:
        source_relative = _safe_release_relative_path(source_name, "sidecar source")
        destination_relative = _safe_release_relative_path(destination_name, "sidecar destination")
        normalized_source = source_relative.as_posix()
        normalized_destination = destination_relative.as_posix()
        previous = destinations.get(normalized_destination)
        if previous is not None and previous != normalized_source:
            raise ValueError(
                f"Sidecar destination {normalized_destination!r} has multiple sources: "
                f"{previous!r}, {normalized_source!r}"
            )
        if previous == normalized_source:
            continue
        destinations[normalized_destination] = normalized_source
        source_path = root.joinpath(*source_relative.parts)
        if not source_path.is_file():
            missing.append(f"{normalized_destination} <- {source_path}")
            continue
        if source_path.suffix.lower() == ".json":
            _strict_json_file(source_path, "release sidecar")
        manifest.append((normalized_source, normalized_destination))
    if missing:
        raise FileNotFoundError(
            "Required release sidecar assets are missing:\n  " + "\n  ".join(missing)
        )
    return tuple(sorted(manifest, key=lambda entry: (entry[1], entry[0])))


def lay_down_release_site_sidecar_assets(site_dir, root):
    """Copy every canonical sidecar and prove source/deployment byte parity."""
    copied = _copy_release_asset_manifest(
        site_dir, root, release_site_sidecar_asset_manifest(root)
    )
    _validate_release_module_graph(
        site_dir, ".", "GPU render worker", follow_imports=True,
        entry_relative_paths=(GPU_RENDER_WORKER_ENTRY_PATH,),
        expected_relative_paths=GPU_RENDER_WORKER_MODULE_PATHS,
    )
    return copied


def _copy_release_asset_manifest(site_dir, root, manifest):
    """Copy an audited asset manifest through the common byte-parity contract."""
    site_dir = Path(site_dir).resolve()
    root = Path(root).resolve()
    for source_name, destination_name in manifest:
        source = root.joinpath(*_safe_release_relative_path(source_name, "sidecar source").parts).resolve()
        destination = site_dir.joinpath(*_safe_release_relative_path(destination_name, "sidecar destination").parts).resolve()
        try:
            source.relative_to(root)
        except ValueError as error:
            raise ValueError(f"Sidecar source escapes release root: {source_name}") from error
        try:
            destination.relative_to(site_dir)
        except ValueError as error:
            raise ValueError(f"Sidecar destination escapes release site: {destination_name}") from error
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        if source.stat().st_size != destination.stat().st_size or _sha256_path(source) != _sha256_path(destination):
            raise OSError(f"Release sidecar copy changed bytes: {source} -> {destination}")
    return len(manifest)


def _copy_release_compressed_artifact(source_dir, destination_dir, manifest, logical_name, expected_bytes=None):
    """Copy declared public transport and prove it reconstructs the local artifact."""
    original = read_compressed_artifact(
        source_dir, logical_name, manifest, expected_bytes=expected_bytes,
    )
    paths = compressed_artifact_paths(manifest, logical_name)
    copied = _copy_release_asset_manifest(
        destination_dir, source_dir, [(path, path) for path in paths],
    )
    deployed = read_compressed_artifact(
        destination_dir, logical_name, manifest, expected_bytes=len(original), prefer_full=False,
    )
    if deployed != original:
        raise ValueError(f"Deployed compressed artifact differs from its source: {logical_name}")
    return copied


def _morphfield_schema_sources(root):
    """Return validated canonical MorphField JSON Schema source files."""
    source_dir = Path(root).joinpath(*MORPHFIELD_SCHEMA_SOURCE_ROOT.parts)
    if not source_dir.is_dir():
        raise FileNotFoundError(
            f"Canonical MorphField schema directory is missing: {source_dir}"
        )

    source_paths = tuple(sorted(source_dir.glob("*.schema.json"), key=lambda path: path.name))
    if not source_paths:
        raise FileNotFoundError(
            f"Canonical MorphField schema directory contains no schemas: {source_dir}"
        )

    seen_ids = set()
    for source_path in source_paths:
        try:
            document = json.loads(
                source_path.read_bytes(),
                parse_constant=_reject_non_json_constant,
                parse_float=_parse_finite_json_float,
                object_pairs_hook=_reject_duplicate_json_members,
            )
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError(f"Invalid MorphField JSON Schema: {source_path}: {error}") from error
        if not isinstance(document, dict):
            raise ValueError(f"MorphField JSON Schema must be an object: {source_path}")

        expected_id = f"{MORPHFIELD_SCHEMA_ID_ROOT}/{source_path.name}"
        actual_id = document.get("$id")
        if actual_id != expected_id:
            raise ValueError(
                f"MorphField schema $id mismatch for {source_path.name}: "
                f"expected {expected_id!r}, got {actual_id!r}"
            )
        if document.get("$schema") != MORPHFIELD_SCHEMA_DIALECT:
            raise ValueError(
                f"MorphField schema dialect mismatch for {source_path.name}: "
                f"expected {MORPHFIELD_SCHEMA_DIALECT!r}"
            )
        if actual_id in seen_ids:
            raise ValueError(f"Duplicate MorphField schema $id: {actual_id}")
        seen_ids.add(actual_id)

    return source_paths


def morphfield_schema_deployment_paths(root):
    """Return deterministic publish-root paths for every canonical schema."""
    return tuple(
        (MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT / source_path.name).as_posix()
        for source_path in _morphfield_schema_sources(root)
    )


def lay_down_morphfield_schemas(site_dir, root):
    """Publish canonical MorphField schemas byte-for-byte at their public IDs."""
    source_paths = _morphfield_schema_sources(root)
    site_root = Path(site_dir).resolve()
    destination_dir = site_root.joinpath(*MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT.parts).resolve()
    if destination_dir == site_root or site_root not in destination_dir.parents:
        raise ValueError(f"Unsafe MorphField schema deployment path: {destination_dir}")
    if destination_dir.exists():
        shutil.rmtree(destination_dir)
    destination_dir.mkdir(parents=True, exist_ok=True)

    for source_path in source_paths:
        source_bytes = source_path.read_bytes()
        destination_path = destination_dir / source_path.name
        shutil.copy2(source_path, destination_path)
        if destination_path.read_bytes() != source_bytes:
            raise OSError(
                f"MorphField schema copy changed bytes: {source_path} -> {destination_path}"
            )
    return len(source_paths)


ABYSSAL_DIVER_V3_FRAME_ROOT = "abyssal-divers-v3/frames"
ABYSSAL_DIVER_V3_MANIFEST = f"{ABYSSAL_DIVER_V3_FRAME_ROOT}/manifest.json"
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Runtime-reachable public-site assets. Keep this list explicit: release ZIPs
# must contain every load-bearing fallback, but must not absorb source masters,
# provenance records, or superseded artwork merely because they share a folder.
RELEASE_SITE_STATIC_ASSETS = (
    "code-metrics.json",
    "abyssal-backdrop.js",
    "abyssal-camera-rig.js",
    "abyssal-dive-team.js",
    "abyssal-fauna.js",
    "abyssal-smoke.js",
    "underwater-silt.js",
    "abyssal-layers/mineral-base-v4.webp",
    "abyssal-layers/godray-breakup-v1.webp",
    "abyssal-layers/smoke-atlas-1-v3.png",
    "abyssal-layers/smoke-atlas-2-v3.png",
    "abyssal-layers/smoke-atlas-3-v3.png",
    "abyssal-layers/smoke-far-v2.png",
    "abyssal-layers/foreground-rocks-v2.png",
    "abyssal-fauna/eelpout-sheet-1-v1.png",
    "abyssal-fauna/eelpout-sheet-2-v1.png",
    "abyssal-fauna/eelpout-sheet-3-v1.png",
    "abyssal-fauna/sculpin-sheet-1-v1.png",
    "abyssal-fauna/sculpin-sheet-2-v1.png",
    "abyssal-fauna/sculpin-sheet-3-v1.png",
    "abyssal-fauna/vent-habitat-kit-v1.png",
    "abyssal-fauna/vent-habitat-kit-v1.atlas.json",
    "abyssal-fauna/vent-benthic-cycles-v1.png",
    "abyssal-fauna/vent-benthic-cycles-v1.atlas.json",
    "abyssal-fauna/abyssal-visitor-cycles-v1.png",
    "abyssal-fauna/abyssal-visitor-cycles-v1.atlas.json",
    "abyssal-divers/diver-leader-atlas-v1.png",
    "abyssal-divers/diver-geologist-atlas-v1.png",
    "abyssal-divers/diver-surveyor-atlas-v1.png",
    "abyssal-divers-v2/leader-body-v2.png",
    "abyssal-divers-v2/leader-body-v2.atlas.json",
    "abyssal-divers-v2/leader-limbs-v2.png",
    "abyssal-divers-v2/leader-limbs-v2.atlas.json",
    "abyssal-divers-v2/leader-actions-v2.png",
    "abyssal-divers-v2/leader-actions-v2.atlas.json",
    "abyssal-divers-v2/geologist-body-v2.png",
    "abyssal-divers-v2/geologist-body-v2.atlas.json",
    "abyssal-divers-v2/geologist-limbs-v2.png",
    "abyssal-divers-v2/geologist-limbs-v2.atlas.json",
    "abyssal-divers-v2/geologist-actions-v2.png",
    "abyssal-divers-v2/geologist-actions-v2.atlas.json",
    "abyssal-divers-v2/surveyor-body-v2.png",
    "abyssal-divers-v2/surveyor-body-v2.atlas.json",
    "abyssal-divers-v2/surveyor-limbs-v2.png",
    "abyssal-divers-v2/surveyor-limbs-v2.atlas.json",
    "abyssal-divers-v2/surveyor-actions-v2.png",
    "abyssal-divers-v2/surveyor-actions-v2.atlas.json",
)

RELEASE_SITE_ENGINE_ASSET_SOURCES = {
    "abyssal-backdrop.js": "engine/render/passes/ImageHeatHazePass.js",
    "abyssal-camera-rig.js": "engine/render/passes/AbyssalCameraRig.js",
    "abyssal-dive-team.js": "engine/render/passes/AbyssalDiveTeam.js",
    "abyssal-fauna.js": "engine/render/passes/AbyssalFaunaField.js",
    "abyssal-smoke.js": "engine/render/passes/AbyssalSmokeAnimator.js",
    "underwater-silt.js": "engine/render/passes/UnderwaterSiltField.js",
}


def _read_png_dimensions(payload, source_path):
    """Read an image's IHDR dimensions without introducing an image dependency."""
    if (
        len(payload) < 24
        or payload[:8] != _PNG_SIGNATURE
        or payload[12:16] != b"IHDR"
    ):
        raise ValueError(f"Abyssal diver V3 frame is not a valid PNG: {source_path}")
    width = int.from_bytes(payload[16:20], byteorder="big")
    height = int.from_bytes(payload[20:24], byteorder="big")
    if width <= 0 or height <= 0:
        raise ValueError(f"Abyssal diver V3 frame has invalid dimensions: {source_path}")
    return width, height


def validate_abyssal_diver_v3_assets(assets_root):
    """Validate and return every load-bearing V3 manifest asset.

    Frame paths are relative to ``abyssal-divers-v3/frames``. The validator
    rejects path traversal and ambiguous duplicate references before checking
    each PNG's exact canvas dimensions and SHA-256 digest.
    """
    assets_root = Path(assets_root).resolve()
    frames_root = (assets_root / ABYSSAL_DIVER_V3_FRAME_ROOT).resolve()
    try:
        frames_root.relative_to(assets_root)
    except ValueError as error:
        raise ValueError(
            f"Abyssal diver V3 frame root escapes the asset tree: {frames_root}"
        ) from error
    manifest_path = frames_root / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Required abyssal diver V3 manifest is missing: {manifest_path}")

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8", errors="strict"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid abyssal diver V3 manifest: {manifest_path}: {error}") from error

    if not isinstance(manifest, dict) or manifest.get("version") != 3:
        raise ValueError("Abyssal diver V3 manifest must be an object with version 3")
    canvas = manifest.get("canvas")
    if not isinstance(canvas, dict):
        raise ValueError("Abyssal diver V3 manifest is missing its canvas object")
    width = canvas.get("width")
    height = canvas.get("height")
    if type(width) is not int or type(height) is not int or width <= 0 or height <= 0:
        raise ValueError("Abyssal diver V3 manifest canvas dimensions must be positive integers")
    roles = manifest.get("roles")
    if not isinstance(roles, dict) or not roles:
        raise ValueError("Abyssal diver V3 manifest must define at least one role")

    required_paths = [ABYSSAL_DIVER_V3_MANIFEST]
    seen_frames = set()
    for role_name, role in roles.items():
        if not isinstance(role_name, str) or not isinstance(role, dict):
            raise ValueError("Abyssal diver V3 manifest contains an invalid role")
        actions = role.get("actions")
        if not isinstance(actions, dict) or not actions:
            raise ValueError(f"Abyssal diver V3 role {role_name!r} has no actions")
        for action_name, action in actions.items():
            if not isinstance(action_name, str) or not isinstance(action, dict):
                raise ValueError(f"Abyssal diver V3 role {role_name!r} has an invalid action")
            frames = action.get("frames")
            if not isinstance(frames, list) or not frames:
                raise ValueError(
                    f"Abyssal diver V3 action {role_name}/{action_name} has no frames"
                )
            for frame_index, frame in enumerate(frames):
                label = f"{role_name}/{action_name}[{frame_index}]"
                if not isinstance(frame, dict):
                    raise ValueError(f"Abyssal diver V3 frame {label} must be an object")
                relative_name = frame.get("file")
                if not isinstance(relative_name, str) or not relative_name:
                    raise ValueError(f"Abyssal diver V3 frame {label} has no file path")
                if "\\" in relative_name:
                    raise ValueError(
                        f"Abyssal diver V3 frame {label} uses a non-portable path: {relative_name!r}"
                    )
                raw_path_parts = relative_name.split("/")
                relative_path = PurePosixPath(relative_name)
                path_parts = relative_path.parts
                if (
                    relative_path.is_absolute()
                    or not path_parts
                    or any(
                        part in {"", ".", ".."} or ":" in part
                        for part in raw_path_parts
                    )
                    or relative_path.suffix != ".png"
                ):
                    raise ValueError(
                        f"Abyssal diver V3 frame {label} has an unsafe PNG path: {relative_name!r}"
                    )
                normalized_name = relative_path.as_posix()
                if normalized_name in seen_frames:
                    raise ValueError(
                        f"Abyssal diver V3 manifest references a frame twice: {normalized_name}"
                    )
                seen_frames.add(normalized_name)

                source_path = (frames_root / Path(*path_parts)).resolve()
                try:
                    source_path.relative_to(frames_root)
                except ValueError as error:
                    raise ValueError(
                        f"Abyssal diver V3 frame {label} escapes its asset root: {relative_name!r}"
                    ) from error
                if not source_path.is_file():
                    raise FileNotFoundError(
                        f"Required abyssal diver V3 frame is missing: {source_path}"
                    )

                expected_sha256 = frame.get("sha256")
                if not isinstance(expected_sha256, str) or not re.fullmatch(
                    r"[0-9a-f]{64}", expected_sha256
                ):
                    raise ValueError(f"Abyssal diver V3 frame {label} has an invalid SHA-256")
                payload = source_path.read_bytes()
                frame_dimensions = _read_png_dimensions(payload, source_path)
                if frame_dimensions != (width, height):
                    raise ValueError(
                        f"Abyssal diver V3 frame {normalized_name} is "
                        f"{frame_dimensions[0]}x{frame_dimensions[1]}, expected {width}x{height}"
                    )
                actual_sha256 = hashlib.sha256(payload).hexdigest()
                if actual_sha256 != expected_sha256:
                    raise ValueError(
                        f"Abyssal diver V3 frame hash mismatch: {normalized_name}; "
                        f"expected {expected_sha256}, got {actual_sha256}"
                    )
                required_paths.append(
                    f"{ABYSSAL_DIVER_V3_FRAME_ROOT}/{normalized_name}"
                )

    return tuple(required_paths)


def release_site_static_asset_paths(root, require_v3=True):
    """Return the complete, deterministic set of runtime site asset paths.

    Release assembly requires the validated V3 frame set. Digest-only callers
    may opt out when exercising an intentionally minimal fixture root.
    """
    assets_root = Path(root) / "tests" / "assets"
    manifest_path = assets_root / ABYSSAL_DIVER_V3_MANIFEST
    v3_assets = validate_abyssal_diver_v3_assets(assets_root) \
        if require_v3 or manifest_path.is_file() else ()
    return tuple(dedupe_preserve_order([
        *RELEASE_SITE_STATIC_ASSETS,
        *v3_assets,
    ]))


def release_site_static_asset_source(root, release_dir, relative_path):
    """Resolve one public asset to its authoritative repository source."""
    root = Path(root)
    if relative_path == "code-metrics.json" or relative_path.endswith(".provenance.json"):
        return Path(release_dir) / relative_path
    return root / "tests" / "assets" / relative_path


def lay_down_release_site_static_modules(site_dir, root):
    """Keep public Engine facades and their closure at correct module URLs."""
    from .graph import ModuleGraph

    root = Path(root).resolve()
    site_dir = Path(site_dir).resolve()
    graph = ModuleGraph(root)
    for asset_name in RELEASE_SITE_ENGINE_ASSET_SOURCES:
        graph.walk(root / "tests" / "assets" / asset_name)
    # The homepage imports version metadata from its inline module script.
    graph.walk(root / "engine" / "version.js")
    if graph.errors:
        raise RuntimeError(
            "Public-site Engine dependency graph is incomplete:\n  "
            + "\n  ".join(str(error) for error in graph.errors)
        )
    manifest = []
    for source in graph.order:
        relative = Path(source).resolve().relative_to(root).as_posix()
        destination = relative.removeprefix("tests/")
        manifest.append((relative, destination))
    copied = _copy_release_asset_manifest(site_dir, root, manifest)
    for asset_name, engine_source in RELEASE_SITE_ENGINE_ASSET_SOURCES.items():
        facade = site_dir / "assets" / asset_name
        source_text = facade.read_text(encoding="utf-8", errors="strict")
        source_spec = "../../" + engine_source
        if source_spec not in source_text:
            raise RuntimeError(f"Public-site facade lacks its canonical Engine export: {asset_name}")
        facade.write_text(source_text.replace(source_spec, "../" + engine_source), encoding="utf-8")
    checked = _validate_release_module_graph(
        site_dir, "assets", "public-site Engine facades", follow_imports=True,
        entry_relative_paths=[
            *("assets/" + name for name in RELEASE_SITE_ENGINE_ASSET_SOURCES),
            "engine/version.js",
        ],
        expected_relative_paths=[destination for _, destination in manifest],
    )
    print(f"[bundle]   public-site modules: shipped {copied} canonical file(s); validated {checked} module edge(s)")
    return copied


def _validate_release_module_graph(
    site_dir,
    source_relative,
    label,
    forbid_raw_engine=False,
    follow_imports=False,
    entry_relative_paths=None,
    expected_relative_paths=None,
):
    """Reject deployed module edges that cannot return JavaScript.

    The public site intentionally does not ship the raw ``engine/`` source tree.
    A direct Playground import that escapes into that tree therefore receives the
    SPA HTML fallback in production and aborts the complete ES-module graph with
    a MIME error. Bundle-aware engine access must go through ``core/engine.js``.

    Validation runs against a staged, cache-busted subtree, so every literal
    static/dynamic import and re-export is checked exactly as it will deploy.
    Returns the number of checked module edges for build telemetry.
    """
    site_root = Path(site_dir).resolve()
    source_root = site_root.joinpath(*PurePosixPath(source_relative).parts)
    if not source_root.is_dir():
        raise FileNotFoundError(f"Release {label} source is missing: {source_root}")

    violations = []
    checked_edges = 0
    if entry_relative_paths is None:
        pending_sources = list(sorted(source_root.rglob("*.js")))
    else:
        pending_sources = []
        for relative_path in entry_relative_paths:
            entry = (site_root / PurePosixPath(relative_path)).resolve()
            try:
                entry.relative_to(site_root)
            except ValueError as error:
                raise ValueError(
                    f"Release {label} entry escapes the release site: {relative_path}"
                ) from error
            if not entry.is_file():
                raise FileNotFoundError(
                    f"Release {label} entry is missing: {entry}"
                )
            pending_sources.append(entry)
    checked_sources = set()
    while pending_sources:
        source_path = pending_sources.pop(0)
        if source_path in checked_sources:
            continue
        checked_sources.add(source_path)
        source = source_path.read_text(encoding="utf-8", errors="strict")
        try:
            imports, exports = parse_module(source)
        except ParseError as error:
            relative_source = source_path.relative_to(site_root).as_posix()
            violations.append(f"{relative_source}: cannot parse module graph ({error})")
            continue

        specs = [item.spec for item in imports if item.spec]
        specs.extend(item.spec for item in exports if item.reexport and item.spec)
        for original_spec in specs:
            spec = re.split(r"[?#]", original_spec, maxsplit=1)[0]
            if not spec.startswith(("./", "../", "/")):
                continue
            checked_edges += 1
            relative_source = source_path.relative_to(site_root).as_posix()
            normalized_spec = spec.replace("\\", "/")

            if forbid_raw_engine and (
                normalized_spec.startswith("/engine/") or "/engine/" in normalized_spec
            ):
                violations.append(
                    f"{relative_source}: raw Engine import {original_spec!r} is forbidden; "
                    "use playground/src/core/engine.js loadEngine() or "
                    "loadRawEngineModule()"
                )
                continue

            if normalized_spec.startswith("/"):
                target = (site_root / normalized_spec.lstrip("/")).resolve()
            else:
                target = (source_path.parent / normalized_spec).resolve()
            try:
                target.relative_to(site_root)
            except ValueError:
                violations.append(
                    f"{relative_source}: import {original_spec!r} escapes the release site"
                )
                continue

            candidates = [target]
            if not target.suffix:
                candidates.extend((target.with_suffix(".js"), target / "index.js"))
            target = next((candidate for candidate in candidates if candidate.is_file()), None)
            if target is None:
                violations.append(
                    f"{relative_source}: import {original_spec!r} has no deployed module; "
                    "a static host would return its HTML fallback"
                )
                continue

            prefix = target.read_bytes()[:256].lstrip().lower()
            if prefix.startswith((b"<!doctype html", b"<html")):
                target_name = target.relative_to(site_root).as_posix()
                violations.append(
                    f"{relative_source}: import {original_spec!r} resolves to HTML "
                    f"({target_name}), not a JavaScript module"
                )
                continue
            if follow_imports and target.suffix.lower() in {".js", ".mjs"}:
                pending_sources.append(target)

    if expected_relative_paths is not None:
        expected_sources = set(expected_relative_paths)
        actual_sources = {
            source.relative_to(site_root).as_posix()
            for source in checked_sources
        }
        missing_sources = sorted(expected_sources.difference(actual_sources))
        extra_sources = sorted(actual_sources.difference(expected_sources))
        if missing_sources or extra_sources:
            violations.append(
                "module closure differs from its audited deployment inventory"
                f"; missing={missing_sources}; unexpected={extra_sources}"
            )

    if violations:
        raise RuntimeError(
            f"Release {label} module graph is not deployable:\n  "
            + "\n  ".join(violations)
        )
    return checked_edges


def _validate_playground_module_graph(site_dir):
    """Validate the complete deployed Playground module closure."""
    return _validate_release_module_graph(
        site_dir,
        "playground/src",
        "Playground",
        forbid_raw_engine=True,
    )


def _validate_playground_demo_manifest(site_dir):
    """Require the static demo manifest to match every top-level demo entry."""
    demo_root = Path(site_dir) / "playground" / "src" / "demos"
    manifest = demo_root / "manifest.js"
    if not manifest.is_file():
        raise FileNotFoundError(
            f"Required Playground demo manifest is missing: {manifest}"
        )

    manifest_source = manifest.read_text(encoding="utf-8", errors="strict")
    entries = re.findall(
        r"(?m)^\s*(['\"])([^'\"\r\n]+\.js)\1\s*,?\s*(?://[^\r\n]*)?$",
        manifest_source,
    )
    names = [name for _, name in entries]
    invalid = sorted({name for name in names if Path(name).name != name})
    duplicates = sorted({name for name in names if names.count(name) > 1})

    default_export = re.compile(
        r"(?m)^\s*export\s+(?:default\b|\{\s*default\s*\}\s+from\b)"
    )
    expected = sorted(
        path.name
        for path in demo_root.glob("*.js")
        if path.name != "manifest.js"
        and default_export.search(path.read_text(encoding="utf-8", errors="strict"))
    )
    missing = sorted(set(expected).difference(names))
    unexpected = sorted(set(names).difference(expected))
    if invalid or duplicates or missing or unexpected:
        details = []
        if invalid:
            details.append("nested or invalid entries: " + ", ".join(invalid))
        if duplicates:
            details.append("duplicate entries: " + ", ".join(duplicates))
        if missing:
            details.append("missing demo entries: " + ", ".join(missing))
        if unexpected:
            details.append("non-demo entries: " + ", ".join(unexpected))
        raise RuntimeError(
            "Playground demo manifest is not the canonical static catalog:\n  "
            + "\n  ".join(details)
        )
    return len(names)


def _validate_academy_module_graph(site_dir):
    """Validate every recursive Academy import after release cache busting."""
    checked = _validate_release_module_graph(site_dir, "learn", "Academy")
    checked += _validate_release_module_graph(
        site_dir,
        "engine",
        "Academy starter Engine closure",
    )
    return checked


def _cache_bust_js_dir(root_dir, token, *, immutable_paths=()):
    """Append a build token to relative and same-origin ES module specifiers.

    This keeps static module imports, dynamic imports, and import.meta.url-based
    demo loaders from being served from stale browser/edge caches after a rebuild.
    The token is a build-time constant, so the same release gets stable cache
    entries and the next build always busts them. Dev-tree files stay untouched.
    """
    if not root_dir.is_dir():
        return
    immutable_paths = {Path(path).resolve() for path in immutable_paths}

    def bust_path(path):
        is_relative = path.startswith(("./", "../"))
        is_same_origin_absolute = path.startswith("/") and not path.startswith("//")
        if not (is_relative or is_same_origin_absolute):
            return path
        base, hash_mark, fragment = path.partition("#")
        if "?" in base:
            if re.search(r"([?&])release=[^&#]*", base):
                base = re.sub(
                    r"([?&])release=[^&#]*",
                    lambda match: f"{match.group(1)}release={token}",
                    base,
                )
            else:
                base += f"&release={token}"
        else:
            base += f"?v={token}"
        return base + (hash_mark + fragment if hash_mark else "")

    for fpath in root_dir.rglob("*"):
        if not fpath.is_file() or fpath.suffix not in (".js", ".mjs"):
            continue
        if fpath.resolve() in immutable_paths:
            continue
        text = fpath.read_text(encoding="utf-8", errors="replace")

        # 1) import/export ... from a relative or same-origin absolute module.
        text = re.sub(
            r"(import|export)\s+(?:[\w\s{},*]+\s+from\s+|from\s+)(['\"])((?:\./|\.\./|/(?!/))[^'\"]*?\.(?:js|mjs)(?:[?#][^'\"]*)?)\2",
            lambda m: m.group(0).replace(m.group(3), bust_path(m.group(3))),
            text
        )

        # 1b) side-effect import './x.js' or '/x.js'.
        text = re.sub(
            r"(import\s*)(['\"])((?:\./|\.\./|/(?!/))[^'\"]*?\.(?:js|mjs)(?:[?#][^'\"]*)?)\2",
            lambda m: m.group(0).replace(m.group(3), bust_path(m.group(3))),
            text,
        )

        # 2) dynamic imports using relative or same-origin absolute paths.
        text = re.sub(
            r"import\s*\(\s*(['\"])((?:\./|\.\./|/(?!/))[^'\"]*?\.(?:js|mjs)(?:[?#][^'\"]*)?)\1\s*\)",
            lambda m: m.group(0).replace(m.group(2), bust_path(m.group(2))),
            text
        )

        # 3) new URL() paths anchored to import.meta.url.
        text = re.sub(
            r"(new\s+URL\s*\(\s*)(['\"])((?:\./|\.\./|/(?!/))[^'\"]*?)\2(\s*,\s*import\.meta\.url\s*\)(?:\s*\.href)?)",
            lambda m: m.group(0).replace(m.group(3), bust_path(m.group(3))),
            text
        )

        # 4) new URL(`./demos/${f}`, import.meta.url).href (template literal dynamic imports)
        text = re.sub(
            r"(new\s+URL\s*\(\s*`)((?:\./|\.\./|/(?!/))[^`\$]*?\$\{[^}]+\}[^`]*?)(`\s*,\s*import\.meta\.url\s*\)(?:\s*\.href)?)",
            lambda m: m.group(0).replace(m.group(2), bust_path(m.group(2))),
            text
        )

        fpath.write_text(text, encoding="utf-8")


def _cache_bust_html_module_entry(
    index_path,
    module_source,
    token,
    label,
    prefix_html="",
):
    """Version one canonical module entry and optionally prefix trusted HTML."""
    index_path = Path(index_path)
    if not index_path.is_file():
        raise FileNotFoundError(f"Required {label} entry page is missing: {index_path}")
    html = index_path.read_text(encoding="utf-8", errors="strict")
    pattern = re.compile(
        rf'(<script\s+type="module"\s+src=")({re.escape(module_source)})([^"\s]*)("\s*></script>)'
    )
    match = pattern.search(html)
    if match is None:
        raise RuntimeError(
            f"{label} release entry must contain the canonical {module_source} module script"
        )
    existing_suffix = match.group(3)
    module_url = module_source + existing_suffix
    if existing_suffix:
        base, hash_mark, fragment = module_url.partition("#")
        separator = "&" if "?" in base else "?"
        module_url = base + f"{separator}release={token}"
        if hash_mark:
            module_url += hash_mark + fragment
    else:
        module_url += f"?v={token}"
    html = pattern.sub(
        lambda current: prefix_html + current.group(1) + module_url + current.group(4),
        html,
        count=1,
    )
    index_path.write_text(html, encoding="utf-8")


def _lay_down_academy_starter_engine_closure(site_dir, root):
    """Ship the exact raw Engine closure imported by the canonical starter."""
    from .graph import ModuleGraph

    site_dir = Path(site_dir).resolve()
    root = Path(root).resolve()
    starter = root / "tests" / "learn" / "starter" / "main.js"
    if not starter.is_file():
        raise FileNotFoundError(f"Canonical Academy starter is missing: {starter}")
    graph = ModuleGraph(root)
    graph.walk(starter)
    if graph.errors:
        raise RuntimeError(
            "Canonical Academy starter dependency graph is incomplete:\n  "
            + "\n  ".join(str(error) for error in graph.errors)
        )

    copied = 0
    for source in graph.order:
        source = Path(source).resolve()
        try:
            relative = source.relative_to(root)
        except ValueError as error:
            raise ValueError(f"Academy starter dependency escapes repository: {source}") from error
        if not relative.as_posix().startswith("engine/"):
            continue
        destination = site_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        if source.stat().st_size != destination.stat().st_size or _sha256_path(source) != _sha256_path(destination):
            raise OSError(f"Academy starter dependency copy changed bytes: {source} -> {destination}")
        copied += 1

    deployed_starter = site_dir / "learn" / "starter" / "main.js"
    source_text = deployed_starter.read_text(encoding="utf-8", errors="strict")
    old_prefix = "../../../engine/"
    if old_prefix not in source_text:
        raise RuntimeError("Canonical Academy starter has no repository-relative Engine imports")
    deployed_starter.write_text(
        source_text.replace(old_prefix, "../../engine/"),
        encoding="utf-8",
    )
    return copied


def _validate_release_include_tree_parity(tests_dir, site_dir):
    """Prove every public source file has exactly one staged deployment path.

    Content may be intentionally rewritten for deployment (cache tokens, bundle
    loaders, and depth-correct links), so this gate compares recursive file
    membership. Byte parity for untouched sidecars is enforced separately.
    """
    tests_dir = Path(tests_dir).resolve()
    site_dir = Path(site_dir).resolve()
    checked = 0
    violations = []
    for item_name in RELEASE_INCLUDE:
        source = tests_dir / item_name
        destination = site_dir / item_name
        if source.is_symlink():
            violations.append(f"{item_name}: symbolic public inputs are not release-safe")
            continue
        if source.is_file():
            if not destination.is_file():
                violations.append(f"{item_name}: deployed file is missing")
            checked += 1
            continue
        if not source.is_dir() or not destination.is_dir():
            violations.append(f"{item_name}: source/deployment type mismatch")
            continue
        source_files = {
            path.relative_to(source).as_posix()
            for path in source.rglob("*")
            if path.is_file()
            and f"{item_name}/{path.relative_to(source).as_posix()}" not in RELEASE_EXCLUDE
        }
        destination_files = {
            path.relative_to(destination).as_posix()
            for path in destination.rglob("*")
            if path.is_file()
        }
        symbolic = [
            path.relative_to(source).as_posix()
            for path in source.rglob("*")
            if path.is_symlink()
        ]
        if symbolic:
            violations.append(f"{item_name}: symbolic inputs={sorted(symbolic)}")
        missing = sorted(source_files - destination_files)
        unexpected = sorted(destination_files - source_files)
        if missing or unexpected:
            violations.append(
                f"{item_name}: missing={missing}, unexpected={unexpected}"
            )
        checked += len(source_files)
    if violations:
        raise RuntimeError(
            "Release public-tree parity failed:\n  " + "\n  ".join(violations)
        )
    return checked


# Editor path rewrites are depth-aware (see _rewrite_editor_paths below).
# Dev layout:  tests/<subdir>/  uses  ../../editor/   (2 levels up)
#              tests/           uses  ../editor/       (1 level up)
# Release:     site/<subdir>/   needs ../editor/       (1 level up)
#              site/            needs editor/           (same level)

def _prepare_md_docs(root):
    """Generate and validate docs once before capturing any release inputs."""
    root = Path(root)
    md_src = root / "MD"
    if not md_src.is_dir():
        return False

    root_key = str(root.resolve()).casefold()
    tools_dir = md_src / "tools"
    if root_key not in _DOCS_PREPARED_ROOTS and tools_dir.is_dir():
        steps = (
            ("extract_api.py", []),
            ("build_docs.py", []),
            (
                "build_llms.py",
                [
                    "--base-url", PUBLIC_SITE_URL + "/MD",
                    "--site-url", PUBLIC_SITE_URL,
                ],
            ),
            ("build_bundle.py", []),
            ("validate_docs.py", []),
        )
        started = time.perf_counter()
        print(f"[bundle][docs][entry] root={root}")
        for script, arguments in steps:
            tool = tools_dir / script
            if not tool.is_file():
                raise FileNotFoundError(f"Required documentation tool is missing: {tool}")
            command = [sys.executable, str(tool), *arguments]
            completed = _subprocess.run(
                command,
                cwd=str(md_src),
                capture_output=True,
                text=True,
                timeout=900,
            )
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout or "no output").strip()
                print(
                    f"[bundle][docs][error] tool={script} "
                    f"returncode={completed.returncode} detail={detail}"
                )
                raise RuntimeError(
                    f"Documentation release gate failed in {script}:\n{detail}"
                )
            print(f"[bundle][docs][tool] name={script} status=ok")
        _DOCS_PREPARED_ROOTS.add(root_key)
        duration_ms = (time.perf_counter() - started) * 1000.0
        print(f"[bundle][docs][validated] duration_ms={duration_ms:.3f}")

    return True


def _lay_down_md_docs(site_dir, root):
    """Ship compact docs plus every public URL advertised by the docs portals.

    Generated reference Markdown remains in ``docs-bundle.json.gz`` to stay
    below static-host file limits. Curated Markdown, subsystem JSON indexes,
    discovery files, and viewer fallback metadata remain individually
    addressable for browsers, crawlers, and agents. Generation and validation
    fail closed in a real repository so a release cannot publish stale API
    claims or dead discovery links.
    """
    site_dir = Path(site_dir)
    root = Path(root)
    md_src = root / "MD"
    if not _prepare_md_docs(root):
        return 0

    md_dst = site_dir / "MD"
    if md_dst.exists():
        shutil.rmtree(md_dst)

    bundle = md_src / "_config" / "docs-bundle.json.gz"
    if not bundle.is_file():
        # Small fixtures without the repository tools can still exercise the
        # laydown helper. Real releases have the tools above and fail closed.
        shutil.copytree(md_src, md_dst, ignore=shutil.ignore_patterns(
            "site", "tools", "_templates", "__pycache__", ".git", "*.pyc", "mkdocs.yml"))
        return sum(1 for _ in md_dst.rglob("*") if _.is_file())

    count = 0
    shutil.copytree(md_src / "viewer", md_dst / "viewer")
    count += sum(1 for _ in (md_dst / "viewer").rglob("*") if _.is_file())
    vendor = md_src / "assets" / "vendor"
    if vendor.is_dir():
        shutil.copytree(vendor, md_dst / "assets" / "vendor")
        count += sum(1 for _ in (md_dst / "assets" / "vendor").rglob("*") if _.is_file())
    (md_dst / "_config").mkdir(parents=True, exist_ok=True)
    shutil.copy2(bundle, md_dst / "_config" / bundle.name)
    count += 1

    # The viewer falls back to these files if bundle decompression is not
    # available, and crawlers can inspect the navigation/search contracts.
    for relative in (
        "_config/nav.json",
        "_config/search-index.json",
        "_config/git-dates.json",
    ):
        source = md_src / relative
        if source.is_file():
            destination = md_dst / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            count += 1

    nav_path = md_src / "_config" / "nav.json"
    nav = json.loads(nav_path.read_text(encoding="utf-8"))
    public_md_paths = {"index.md"}
    public_json_paths = set()
    for section in nav.get("sections", []):
        for item in section.get("items", []):
            public_md_paths.add(item["path"])
        for group in section.get("groups", []):
            public_json_paths.add(group["auto"].rstrip("/") + "/_index.json")

    for relative in sorted(public_md_paths | public_json_paths):
        source = md_src / relative
        if not source.is_file():
            raise FileNotFoundError(f"Public documentation path is missing: {source}")
        destination = md_dst / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        count += 1

    discovery_names = (
        "llms.txt",
        "llms-full.txt",
        "api-index.json",
        "docs-chunks.jsonl",
        "api-symbols.jsonl",
        "robots.txt",
        "sitemap.xml",
    )
    for name in discovery_names:
        portable_source = md_src / name
        if portable_source.is_file():
            shutil.copy2(portable_source, md_dst / name)
            count += 1
        root_source = root / name
        if not root_source.is_file():
            raise FileNotFoundError(f"Root discovery asset is missing: {root_source}")
        shutil.copy2(root_source, site_dir / name)
        count += 1

    print(
        f"[bundle][docs][exit] files={count} curated_markdown={len(public_md_paths)} "
        f"api_indexes={len(public_json_paths)}"
    )
    return count


def copy_release_site(root, release_dir, bundle_name="particle-engine", best_ext=".br", include_os=False):
    """Copy public-facing pages + editor + bundled runtime into release/site/.
    The editor uses the bundled runtime instead of ES module imports.
    If include_os, also generates site/webgpu-os/index.html that boots the OS
    from the same bundle (the bundle must include the webgpu-os entry)."""
    tests_dir = root / "tests"
    site_dir = release_dir / ".staging" / "site"

    # Clean old staging copy
    if site_dir.exists():
        shutil.rmtree(site_dir)
    site_dir.mkdir(parents=True, exist_ok=True)

    copied = 0

    # 1) Copy public page directories/files
    missing_public_items = []
    for item_name in RELEASE_INCLUDE:
        src = tests_dir / item_name
        dst = site_dir / item_name
        if src.is_file():
            shutil.copy2(src, dst)
            copied += 1
        elif src.is_dir():
            shutil.copytree(src, dst)
            copied += sum(1 for _ in dst.rglob("*") if _.is_file())
        else:
            missing_public_items.append(str(src))
    if missing_public_items:
        raise FileNotFoundError(
            "Required public-site inputs are missing:\n  " + "\n  ".join(missing_public_items)
        )

    homepage = site_dir / "index.html"
    if homepage.is_file():
        from .app_catalog import homepage_app_catalog, update_homepage_app_catalog

        update_homepage_app_catalog(homepage, root)
        print(f"[bundle]   homepage catalogue: verified {len(homepage_app_catalog(root))} visible app cards")

    excluded_public_files = 0
    for relative_path in sorted(RELEASE_EXCLUDE):
        excluded = site_dir / PurePosixPath(relative_path)
        if excluded.is_file():
            excluded.unlink()
            copied -= 1
            excluded_public_files += 1
    if excluded_public_files:
        print(
            f"[bundle]   public exclusions: omitted {excluded_public_files} "
            "source-only legacy file(s)"
        )

    starter_dependency_count = _lay_down_academy_starter_engine_closure(site_dir, root)
    copied += starter_dependency_count
    print(
        f"[bundle]   Academy starter: shipped {starter_dependency_count} "
        "byte-verified Engine dependency file(s)"
    )

    # 1a) Ship the shared Plauna motion module so the playground and other pages
    #     can import the PageTransition engine without pulling in all of Plauna.
    plauna_motion_src = root / "plauna" / "motion"
    plauna_motion_dst = site_dir / "plauna" / "motion"
    if plauna_motion_src.is_dir():
        if plauna_motion_dst.exists():
            shutil.rmtree(plauna_motion_dst)
        shutil.copytree(plauna_motion_src, plauna_motion_dst)
        copied += sum(1 for _ in plauna_motion_dst.rglob("*") if _.is_file())

    # registry.js lives one directory shallower inside release/site than it does
    # in the repository tree. Point its shared PageTransition import at the
    # Plauna motion copy above; otherwise the browser requests /release/plauna/
    # and aborts the entire Playground module graph before demo discovery.
    playground_registry = site_dir / "playground" / "src" / "registry.js"
    if playground_registry.is_file():
        registry_source = playground_registry.read_text(encoding="utf-8")
        registry_source = registry_source.replace("../../../plauna/motion/", "../../plauna/motion/")
        playground_registry.write_text(registry_source, encoding="utf-8")

    # 1a) Ship the standalone network mesh diagnostic page at site root so it is
    #     reachable over the deployed HTTPS origin (mobile browsers require a
    #     secure context for crypto.subtle — plain LAN http:// won't work).
    mesh_test = tests_dir / "network" / "mesh-test.html"
    if mesh_test.is_file():
        shutil.copy2(mesh_test, site_dir / "mesh-test.html")
        copied += 1
        print("[bundle]   mesh-test: shipped /mesh-test.html (network discovery + WebRTC diagnostic)")

    # 1a-turn) Ship Cloudflare Pages Functions (functions/ at the publish root is
    #     auto-detected by Cloudflare Pages). WITHOUT this, /api/turn/credentials
    #     falls through to the SPA and returns index.html instead of JSON, so
    #     CollabCore.js's fetchTurnCredentials() gets no TURN relay — peers behind
    #     symmetric / carrier-grade NAT (typical on mobile data) can NEVER connect
    #     (ICE stalls at 'checking'). This is the production root cause of
    #     "no peers found" for real cross-network users.
    functions_src = tests_dir / "functions"
    if functions_src.is_dir():
        functions_dst = site_dir / "functions"
        shutil.copytree(functions_src, functions_dst)
        fn_count = sum(1 for _ in functions_dst.rglob("*") if _.is_file())
        copied += fn_count
        print(f"[bundle]   functions: shipped functions/ ({fn_count} file(s)) — incl. /api/turn/credentials TURN relay")

    # 1b) Single-source docs: ship MD/ (viewer runtime + Markdown + vendored
    #     libs) so the direct Guide/API navigators share one documentation truth.
    md_count = _lay_down_md_docs(site_dir, root)
    copied += md_count
    if md_count:
        print(f"[bundle]   docs: shipped MD/ ({md_count} files) for the Guide/API navigators")

    schema_count = lay_down_morphfield_schemas(site_dir, root)
    copied += schema_count
    print(
        f"[bundle]   MorphField schemas: shipped {schema_count} canonical schema(s) "
        f"at /{MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT.as_posix()}/"
    )

    # 2) Copy doc-related files from common/ (not test harness scripts)
    common_dst = site_dir / "common"
    common_dst.mkdir(parents=True, exist_ok=True)
    for fname in RELEASE_COMMON_FILES:
        src = tests_dir / "common" / fname
        if src.is_file():
            shutil.copy2(src, common_dst / fname)
            copied += 1

    # 3) Copy bundled runtime + manifest into site/assets/
    assets_dst = site_dir / "assets"
    assets_dst.mkdir(parents=True, exist_ok=True)
    assets_src = tests_dir / "assets"
    # Copy the compressed runtime + manifest + WASM dependencies. The raw
    # .min.js remains a local build artifact used to establish the decoded byte
    # length and SRI identity, but is deliberately absent from the public site:
    # static hosts enforce upload limits before CDN wire compression can help.
    bundle_min_source = assets_src / f"{bundle_name}.min.js"
    if not bundle_min_source.is_file():
        raise FileNotFoundError(
            f"Required compiled runtime source is missing: {bundle_min_source}"
        )
    runtime_bytes = bundle_min_source.stat().st_size
    bundle_manifest = _strict_json_file(
        assets_src / f"{bundle_name}.manifest.json",
        "bundle manifest",
    )
    verify_official_package_sidecars(bundle_manifest.get("officialPackageAssets", []), assets_src)
    provenance = bundle_manifest.get("provenance") if isinstance(bundle_manifest, dict) else None
    provenance_name = None
    if isinstance(provenance, dict):
        provenance_name = str(provenance.get("path") or "")
        if provenance_name != f"{bundle_name}.provenance.json":
            raise ValueError("Bundle manifest has an invalid provenance path")
    static_asset_paths = release_site_static_asset_paths(root)
    for compressed_name in dedupe_preserve_order([
        f"{bundle_name}.min.js.gz", f"{bundle_name}.min.js{best_ext}",
    ]):
        copied += _copy_release_compressed_artifact(assets_src, assets_dst, bundle_manifest, compressed_name)
    required_assets = dedupe_preserve_order([
        f"{bundle_name}.min.js.sri",
        f"{bundle_name}.manifest.json",
        *([provenance_name] if provenance_name else []),
        *(path for path in static_asset_paths if path not in RELEASE_SITE_ENGINE_ASSET_SOURCES),
        *[item["path"] for item in bundle_manifest.get("officialPackageAssets", [])],
    ])
    missing_assets = []
    for fname in required_assets:
        src = release_site_static_asset_source(root, release_dir, fname)
        if src.is_file():
            destination = assets_dst / fname
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, destination)
            copied += 1
        else:
            missing_assets.append(f"{fname} <- {src}")
    if missing_assets:
        raise FileNotFoundError(
            "Required release-site assets are missing:\n  " + "\n  ".join(missing_assets)
        )
    verify_official_package_sidecars(bundle_manifest.get("officialPackageAssets", []), assets_dst)
    if provenance_name:
        expected_provenance_sha256 = str(provenance.get("sha256") or "")
        if (
            not re.fullmatch(r"[0-9a-f]{64}", expected_provenance_sha256)
            or _sha256_path(assets_dst / provenance_name) != expected_provenance_sha256
        ):
            raise ValueError("Deployed bundle provenance SHA-256 is invalid")

    runtime_integrity = _read_bundle_sri(assets_dst / f"{bundle_name}.min.js.sri")
    runtime_parts = compressed_artifact_part_map(bundle_manifest).get(f"{bundle_name}.min.js.gz")
    runtime_payload = read_compressed_artifact(
        assets_dst, f"{bundle_name}.min.js.gz", bundle_manifest,
        expected_bytes=bundle_manifest.get("browser_runtime_bytes"), prefer_full=False,
    )
    runtime_compressed_bytes = len(runtime_payload)
    _verify_release_runtime_gzip(
        runtime_payload,
        runtime_integrity,
        runtime_bytes,
    )
    _write_release_runtime_loader(assets_dst / "release-runtime-loader.js")
    copied += 1
    runtime_cache_token = _release_runtime_cache_token(
        runtime_payload, runtime_parts,
    )

    if any(path in RELEASE_SITE_ENGINE_ASSET_SOURCES for path in static_asset_paths):
        copied += lay_down_release_site_static_modules(site_dir, root)
    static_asset_count = len(static_asset_paths)
    print(
        f"[bundle]   site assets: shipped {static_asset_count} runtime-reachable "
        "file(s); source masters and superseded artwork excluded"
    )

    sidecar_count = lay_down_release_site_sidecar_assets(site_dir, root)
    copied += sidecar_count
    print(
        f"[bundle]   sidecars: shipped and byte-verified {sidecar_count} "
        "worker/JSON/CSS/WASM/image file(s)"
    )

    # 3b) Wire the deployed playground to the compiled bundle so engine-backed
    #     demos (doubleSlit, rootAlgebra, glassBoids) resolve `window.PE`. The
    #     built site ships NO raw engine/ tree, so core/engine.js's raw-import
    #     fallback 404s; without a bundle-set window.PE those demos hard-throw.
    #     The dev tree keeps loading ./src/main.js directly (raw import works
    #     there). The external loader starts the verified runtime in parallel;
    #     core/engine.js awaits its shared promise for engine-backed demos.
    #
    #     Safe for BOTH engine and platform (include_webgpu_os) sites: merely
    #     executing the bundle only DEFINES window.PE — webgpu-os/index.js is
    #     explicitly documented as having no import-time side effects (it does
    #     not auto-boot; that requires an explicit PE.bootWebGpuOS() call the
    #     playground never makes). The editor's runtime_boot above already
    #     performs this exact injection for the platform bundle.
    pg_index = site_dir / "playground" / "index.html"
    if pg_index.is_file():
        pg_html = pg_index.read_text(encoding="utf-8", errors="replace")
        pg_old = '<script type="module" src="./src/main.js"></script>'
        if pg_old in pg_html:
            pg_build = str(int(time.time()))
            runtime_loader = _release_runtime_loader_tag(
                "../assets/release-runtime-loader.js",
                f"../assets/{bundle_name}.min.js.gz",
                "../assets/",
                runtime_integrity,
                runtime_bytes,
                runtime_compressed_bytes,
                runtime_cache_token,
                os_base="../webgpu-os/",
                runtime_parts=runtime_parts,
            )
            pg_loader = (
                f"{runtime_loader}\n"
                f'<script type="module" src="./src/main.js?v={pg_build}"></script>'
            )
            pg_index.write_text(pg_html.replace(pg_old, pg_loader), encoding="utf-8")
            _cache_bust_js_dir(site_dir / "playground" / "src", pg_build)
            _cache_bust_js_dir(site_dir / "plauna" / "motion", pg_build)
            print(f"[bundle]   playground: module imports cache-busted with token {pg_build}")

    # Academy resolves compiled Engine symbols lazily from its lesson runner.
    # Start the same verified gzip runtime used by Playground before the module
    # entry; runtime-loader.js awaits the shared promise and retains raw-module
    # imports only for the source development layout.
    academy_build = str(int(time.time()))
    academy_runtime_loader = _release_runtime_loader_tag(
        "../assets/release-runtime-loader.js",
        f"../assets/{bundle_name}.min.js.gz",
        "../assets/",
        runtime_integrity,
        runtime_bytes,
        runtime_compressed_bytes,
        runtime_cache_token,
        runtime_parts=runtime_parts,
    )
    _cache_bust_html_module_entry(
        site_dir / "learn" / "index.html",
        "./src/main.js",
        academy_build,
        "Academy",
        prefix_html=academy_runtime_loader + "\n",
    )
    _cache_bust_html_module_entry(
        site_dir / "learn" / "starter" / "index.html",
        "./main.js",
        academy_build,
        "Academy starter",
    )
    _cache_bust_js_dir(site_dir / "learn", academy_build)
    _cache_bust_js_dir(site_dir / "engine", academy_build, immutable_paths=(
        site_dir / record["path"] for record in bundle_manifest.get("physicsAssets", [])
    ))
    print(f"[bundle]   Academy: recursive module imports cache-busted with token {academy_build}")


    # 4) Copy editor HTML and CSS into site/editor/
    editor_dir = root / "editor"
    editor_dst = site_dir / "editor"
    editor_dst.mkdir(parents=True, exist_ok=True)

    # Editor CSS was copied through the verified sidecar contract above.
    css_dst = editor_dst / "css"
    css_dst.mkdir(parents=True, exist_ok=True)

    # Generate runtime-based editor index.html
    #   - Same HTML body as source editor/index.html
    #   - Replaces <script type="module" src="js/main.js"> with runtime boot
    editor_html_src = editor_dir / "index.html"
    if editor_html_src.is_file():
        html = editor_html_src.read_text(encoding="utf-8", errors="replace")

        loader_guard_src = editor_dir / "js" / "loader-guard.js"
        if not loader_guard_src.is_file():
            raise FileNotFoundError(
                f"Required editor CSP guard is missing: {loader_guard_src}"
            )
        loader_guard_dst = editor_dst / "js" / "loader-guard.js"
        loader_guard_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(loader_guard_src, loader_guard_dst)
        copied += 1

        # Rewrite CSS paths: href="css/X" -> href="editor/css/X" is not needed
        # since the editor index.html is at site/editor/index.html, same relative path

        # Replace the ES module script tag with runtime boot
        old_script = '<script type="module" src="js/main.js"></script>'
        editor_boot = f'''// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

    (function() {{
        Promise.resolve(window.__PE_RUNTIME_READY).then(function() {{
            boot();
        }}).catch(function(err) {{
            console.error('[Release] Failed to load runtime:', err);
        }});

        function boot() {{
        var PE = window.PE || window.ParticleEngine;
        if (!PE) {{ console.error('[Release] Runtime not loaded'); return; }}
        console.log('[Release] Particle Engine v{ENGINE_VERSION} loaded (' + Object.keys(PE._C || PE.__cache || {{}}).length + ' modules)');

        var EditorApp = PE.EditorApp || (PE.Editor && PE.Editor.EditorApp);
        var ProjectManager = PE.ProjectManager || (PE.Editor && PE.Editor.ProjectManager);
        if (!EditorApp) {{ console.error('[Release] EditorApp not found in runtime'); return; }}
        if (!ProjectManager) {{ console.error('[Release] ProjectManager not found in runtime'); return; }}

        var DB_NAME = 'GameEditorDB';
        var STORE_NAME = 'projectHandles';

        function openDB() {{
            return new Promise(function(resolve, reject) {{
                var request = indexedDB.open(DB_NAME, 1);
                request.onerror = function() {{ reject(request.error); }};
                request.onsuccess = function() {{ resolve(request.result); }};
                request.onupgradeneeded = function(e) {{
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {{
                        db.createObjectStore(STORE_NAME);
                    }}
                }};
            }});
        }}

        function saveProjectHandle(handle) {{
            return openDB().then(function(db) {{
                return new Promise(function(resolve, reject) {{
                    var tx = db.transaction(STORE_NAME, 'readwrite');
                    tx.objectStore(STORE_NAME).put(handle, 'lastProject');
                    tx.oncomplete = function() {{ resolve(); }};
                    tx.onerror = function() {{ reject(tx.error); }};
                }});
            }});
        }}

        function getLastProjectHandle() {{
            return openDB().then(function(db) {{
                return new Promise(function(resolve, reject) {{
                    var tx = db.transaction(STORE_NAME, 'readonly');
                    var request = tx.objectStore(STORE_NAME).get('lastProject');
                    request.onsuccess = function() {{ resolve(request.result); }};
                    request.onerror = function() {{ reject(request.error); }};
                }});
            }});
        }}

        function startEditor(dirHandle) {{
            var modal = document.getElementById('modal-project-select');
            return saveProjectHandle(dirHandle).then(function() {{
                return ProjectManager.initializeProject(dirHandle);
            }}).then(function(projectData) {{
                console.log('[Main] Project initialized:', projectData.settings.projectName);
                modal.style.display = 'none';
                var editor = new EditorApp(projectData);
                window.editor = editor;
                return editor.initialize();
            }});
        }}

        function init() {{
            console.log('[Main] Starting Game Editor (Runtime v{ENGINE_VERSION})...');
            var modal = document.getElementById('modal-project-select');
            var selectBtn = document.getElementById('btn-select-project');

            selectBtn.addEventListener('click', function() {{
                ProjectManager.selectProjectFolder().then(function(dirHandle) {{
                    console.log('[Main] Project folder selected:', dirHandle.name);
                    return startEditor(dirHandle);
                }}).catch(function(err) {{
                    if (err.name === 'AbortError') {{
                        console.log('[Main] User cancelled project selection');
                    }} else {{
                        console.error('[Main] Error:', err);
                        alert('Failed to open project: ' + err.message);
                    }}
                }});
            }});

            getLastProjectHandle().then(function(lastHandle) {{
                if (lastHandle) {{
                    return lastHandle.requestPermission({{ mode: 'readwrite' }}).then(function(permission) {{
                        if (permission === 'granted') {{
                            console.log('[Main] Restoring last project:', lastHandle.name);
                            return startEditor(lastHandle);
                        }}
                        throw new Error('permission denied');
                    }});
                }}
                throw new Error('no last project');
            }}).catch(function() {{
                var loader = document.getElementById('instant-loader');
                if (loader) {{
                    loader.classList.add('fade-out');
                    setTimeout(function() {{ loader.remove(); }}, 600);
                }}
                modal.style.display = 'flex';
            }});
        }}

        if (document.readyState === 'loading') {{
            document.addEventListener('DOMContentLoaded', init);
        }} else {{
            init();
        }}
        }} // end boot()
    }})();
    '''

        editor_boot_path = editor_dst / "release-boot.js"
        editor_boot_path.write_text(editor_boot, encoding="utf-8")
        editor_build = str(int(time.time()))
        runtime_loader = _release_runtime_loader_tag(
            "../assets/release-runtime-loader.js",
            f"../assets/{bundle_name}.min.js.gz",
            "../assets/",
            runtime_integrity,
            runtime_bytes,
            runtime_compressed_bytes,
            runtime_cache_token,
            runtime_parts=runtime_parts,
        )
        runtime_boot = (
            f"{runtime_loader}\n"
            f'<script src="./release-boot.js?v={editor_build}"></script>'
        )
        html = html.replace(old_script, runtime_boot)
        (editor_dst / "index.html").write_text(html, encoding="utf-8")
        copied += 2
        print(f"[bundle] Editor: generated runtime-based index.html")

    # 5) Rewrite editor paths in all HTML files (depth-aware)
    for html_file in site_dir.rglob("*.html"):
        if html_file == editor_dst / "index.html":
            continue  # skip editor, already processed
        text = html_file.read_text(encoding="utf-8", errors="replace")
        changed = False
        # Determine depth: files in subdirs (playground/, api/, guide/) are depth 1+
        rel = html_file.relative_to(site_dir)
        depth = len(rel.parts) - 1  # 0 = top-level, 1 = one subdir deep
        if depth >= 1:
            # Subdir pages (guide/, api/, ...): two-levels-up -> one-level-up.
            if "../../editor/" in text:
                text = text.replace("../../editor/", "../editor/")
                changed = True
            if "../../MD/" in text:
                text = text.replace("../../MD/", "../MD/")
                changed = True
        elif depth == 0:
            # Top-level pages: one-level-up -> same level.
            if "../editor/" in text:
                text = text.replace("../editor/", "editor/")
                changed = True
            if "../MD/" in text:
                text = text.replace("../MD/", "MD/")
                changed = True
        if changed:
            html_file.write_text(text, encoding="utf-8")

    # 6) WebGPU OS launcher — a thin page that boots the OS from THIS bundle
    #    (the platform bundle compiles in the OS core + all apps/mods), exactly
    #    like the editor's generated index.html. No raw OS file tree is copied.
    if include_os:
        copied += _write_platform_os_launcher(site_dir, root, bundle_name)

    # Stable public MorphField route. The production surface is the compiled
    # Engine.MorphField-powered Playground demo; the raw validation console has
    # a 1,000+ module source closure and is intentionally not deployed.
    morphfield_dir = site_dir / "morphfield"
    morphfield_dir.mkdir(parents=True, exist_ok=True)
    (morphfield_dir / "index.html").write_text(
        "<!doctype html>\n"
        "<html lang=\"en\"><head><meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        "<meta http-equiv=\"refresh\" content=\"0;url=../playground/?demo=morphfield-r2\">\n"
        "<title>MorphField R2 — Particle Realms</title></head>\n"
        "<body><p>Opening <a href=\"../playground/?demo=morphfield-r2\">"
        "MorphField R2 in the Playground</a>…</p>\n"
        "</body></html>\n",
        encoding="utf-8",
    )
    copied += 1

    playground_demo_count = _validate_playground_demo_manifest(site_dir)
    print(
        f"[bundle]   playground: validated {playground_demo_count} static demo entry(s)"
    )
    playground_edges = _validate_playground_module_graph(site_dir)
    print(
        f"[bundle]   playground: validated {playground_edges} deployed module edge(s)"
    )
    academy_edges = _validate_academy_module_graph(site_dir)
    print(f"[bundle]   Academy: validated {academy_edges} deployed module edge(s)")
    public_file_count = _validate_release_include_tree_parity(tests_dir, site_dir)
    print(
        f"[bundle]   public tree: verified exact recursive membership for "
        f"{public_file_count} source file(s)"
    )
    capped_file_count, largest_file_bytes = _validate_static_site_file_cap(site_dir)
    print(
        f"[bundle]   static-host cap: verified {capped_file_count} file(s); "
        f"largest {largest_file_bytes:,} bytes"
    )

    # Publish the staged site while retaining a recoverable previous version.
    from .physics import verify_physics_sidecars
    verify_physics_sidecars(bundle_manifest.get("physicsAssets", []), site_dir)
    final_dir = release_dir / "site"
    site_dir = _publish_staged_site(site_dir, final_dir)

    # Calculate total size
    total = sum(f.stat().st_size for f in site_dir.rglob("*") if f.is_file())
    return copied, total


_SITE_ARCHIVE_STORED_SUFFIXES = frozenset({
    ".br", ".gz", ".jpg", ".jpeg", ".mp3", ".mp4", ".png", ".wasm",
    ".webm", ".webp", ".zip", ".zst",
})
_SITE_ARCHIVE_COMPRESSED_PART_RE = re.compile(
    r".+\.(?:br|gz|zst)\.[0-9a-f]{24}\.part-[0-9]{4}\.bin"
)

_ZIP_MIN_EPOCH = 315532800  # 1980-01-01, the earliest representable ZIP date.
_ZIP_MAX_EPOCH = 4354819199  # 2107-12-31 23:59:59 UTC.


def _release_archive_datetime():
    """Return a deterministic UTC ZIP timestamp honoring SOURCE_DATE_EPOCH."""
    raw_epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if raw_epoch is None:
        epoch = _ZIP_MIN_EPOCH
    else:
        try:
            epoch = int(raw_epoch, 10)
        except ValueError as error:
            raise ValueError("SOURCE_DATE_EPOCH must be an integer Unix timestamp") from error
        if epoch < 0:
            raise ValueError("SOURCE_DATE_EPOCH must not be negative")
        epoch = min(max(epoch, _ZIP_MIN_EPOCH), _ZIP_MAX_EPOCH)
    return time.gmtime(epoch)[:6]


def create_release_site_archive(site_dir, archive_path, required_paths=()):
    """Create and verify a root-layout deployment ZIP from ``site_dir``.

    Every file beneath the publish directory is included exactly once at the
    archive root. The temporary archive must pass a CRC scan and contain the
    exact same relative-path set before it atomically replaces the prior ZIP.
    Returns ``(file_count, archive_bytes)``.
    """
    site_dir = Path(site_dir)
    archive_path = Path(archive_path)
    if not site_dir.is_dir():
        raise FileNotFoundError(f"Release site directory does not exist: {site_dir}")

    source_entries = sorted(
        (
            (path.relative_to(site_dir).as_posix(), path)
            for path in site_dir.rglob("*")
            if path.is_file()
        ),
        key=lambda entry: entry[0],
    )
    source_names = [archive_name for archive_name, _ in source_entries]
    required_names = {
        physical.relative_to(site_dir).as_posix()
        for path in required_paths
        for physical in transport_paths(site_dir / str(path).replace("\\", "/").lstrip("/"))
    }
    missing_required = sorted(required_names.difference(source_names))
    if missing_required:
        from .site_compaction import verify_site_archives
        missing_required = sorted(set(missing_required).difference(verify_site_archives(site_dir)))
    if missing_required:
        raise FileNotFoundError(
            "Required deployment files are missing from release/site:\n  "
            + "\n  ".join(missing_required)
        )

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    temp_archive = archive_path.with_suffix(archive_path.suffix + ".tmp")
    if temp_archive.exists():
        temp_archive.unlink()

    try:
        archive_datetime = _release_archive_datetime()
        with zipfile.ZipFile(
            temp_archive,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            allowZip64=True,
        ) as archive:
            for archive_name, source_path in source_entries:
                compression = (
                    zipfile.ZIP_STORED
                    if (source_path.suffix.lower() in _SITE_ARCHIVE_STORED_SUFFIXES
                        or _SITE_ARCHIVE_COMPRESSED_PART_RE.fullmatch(source_path.name))
                    else zipfile.ZIP_DEFLATED
                )
                info = zipfile.ZipInfo(archive_name, archive_datetime)
                info.compress_type = compression
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.flag_bits |= 0x800
                with source_path.open("rb") as source, archive.open(
                    info,
                    "w",
                    force_zip64=True,
                ) as destination:
                    shutil.copyfileobj(source, destination, length=1024 * 1024)

        with zipfile.ZipFile(temp_archive, "r") as archive:
            archive_names = sorted(
                info.filename for info in archive.infolist() if not info.is_dir()
            )
            if archive_names != source_names:
                missing = sorted(set(source_names).difference(archive_names))
                unexpected = sorted(set(archive_names).difference(source_names))
                raise RuntimeError(
                    "Deployment ZIP membership mismatch: "
                    f"missing={missing}, unexpected={unexpected}"
                )
            byte_mismatches = []
            for archive_name, source_path in source_entries:
                try:
                    # Reading to EOF checks the member CRC in ZipExtFile as
                    # well as hashing its bytes; do not decompress it twice.
                    with archive.open(archive_name, "r") as archived_file:
                        archived_hash = _sha256_stream(archived_file)
                except zipfile.BadZipFile as error:
                    raise RuntimeError(f"Deployment ZIP CRC/read failed: {archive_name}: {error}") from error
                if archived_hash != _sha256_path(source_path):
                    byte_mismatches.append(archive_name)
            if byte_mismatches:
                raise RuntimeError(
                    "Deployment ZIP byte-parity mismatch: "
                    + ", ".join(byte_mismatches)
                )

        os.replace(temp_archive, archive_path)
    except Exception:
        if temp_archive.exists():
            temp_archive.unlink()
        raise

    return len(source_names), archive_path.stat().st_size


_ENGINE_DEMO_PLATFORM_ENTRIES = (
    "engine/EngineEditorBootstrap.js",
    "agi/index.js",
    "plauna/index.js",
    "webgpu-os/index.js",
    "webgpu-os/.bundled-os-content.generated.js",
)

_ENGINE_DEMO_PUBLIC_NAMESPACES = (
    "AGI",
    "Plauna",
    "WebGPUOS",
    "WebGPUOSContent",
)

_ENGINE_DEMO_PROVENANCE_TYPE = "https://in-toto.io/Statement/v1"
_ENGINE_DEMO_PREDICATE_TYPE = "https://slsa.dev/provenance/v1"
_ENGINE_DEMO_BUILD_TYPE = (
    "https://particlerealms.online/buildtypes/python-browser-bundle/v1"
)
_ENGINE_DEMO_KIT_FORMAT = "particle-engine-demo-runtime-kit/v1"
_ENGINE_DEMO_KIT_PROFILE = "particle-engine-v1"
_ENGINE_DEMO_PROJECT_FILES = (
    "index.html",
    "styles.css",
    "app.js",
    "dodad.behavior.json",
)
_ENGINE_DEMO_PUBLIC_API_NAMES = (
    "createEntity",
    "createParticleQualityManager",
    "createParticleSimWorld",
    "createQuery",
    "createSandboxMaterialCatalog",
    "createStandardRoomRenderer",
    "createTransform",
    "createUniformBuffer",
    "createUnitCubeMesh",
    "createWorld",
    "destroyEntity",
    "destroyParticleSimWorld",
    "forEachEntity",
    "initWebGpuCanvas",
    "packSandboxCell",
    "setEntityComponent",
    "stepParticleSimWorld",
    "stepWorld",
    "stepWorldFrame",
    "unpackSandboxCell",
    "updateBuffer",
    "updateStandardCamera",
    "validateSandboxMaterialCatalog",
)
_ENGINE_DEMO_STARTER_CSP = (
    "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; "
    "script-src 'self' blob:; style-src 'self'; connect-src 'self'; "
    "img-src 'self' data: blob:; media-src 'self' data: blob:; "
    "font-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; "
    "manifest-src 'none'"
)


def _engine_demo_public_api_membrane_source():
    """Return the canonical starter membrane shared with AI Echo exports."""
    names = json.dumps(
        list(_ENGINE_DEMO_PUBLIC_API_NAMES),
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return """(()=>{
'use strict';
const names=""" + names + """;
const key='__PE_RUNTIME_READY';
const baseline=Object.getOwnPropertyDescriptors(globalThis);
const ownKeys=Reflect.ownKeys;
const hasOwn=Object.hasOwn;
const descriptor=Object.getOwnPropertyDescriptor;
const define=Object.defineProperty;
const remove=Reflect.deleteProperty;
let wrapped=null;
let assigned=false;
const restore=()=>{
  for(const name of ownKeys(globalThis))if(!hasOwn(baseline,name)&&!remove(globalThis,name))throw new Error('Engine demo could not remove a private runtime global');
  for(const name of ownKeys(baseline)){
    const expected=baseline[name];
    const current=descriptor(globalThis,name);
    if(current&&current.value===expected.value&&current.get===expected.get&&current.set===expected.set&&current.writable===expected.writable&&current.enumerable===expected.enumerable&&current.configurable===expected.configurable)continue;
    define(globalThis,name,expected);
  }
};
const settle=(api)=>{
  const result=Object.create(null);
  for(const name of names){const value=api?.[name];if(typeof value==='function')define(result,name,{value,enumerable:true,writable:false,configurable:false})}
  if(typeof result.initWebGpuCanvas!=='function')throw new Error('Verified runtime omitted the required public engine-demo API');
  return Object.freeze(result);
};
define(globalThis,key,{configurable:true,enumerable:false,get(){return wrapped},set(value){
  if(assigned)throw new Error('Verified runtime promise was assigned more than once');
  if(!value||typeof value.then!=='function')throw new Error('Verified runtime promise is unavailable');
  assigned=true;
  wrapped=Promise.resolve(value).then(settle);
  wrapped=wrapped.then(value=>{restore();define(globalThis,key,{value:wrapped,writable:false,enumerable:false,configurable:false});return value},error=>{restore();define(globalThis,key,{value:wrapped,writable:false,enumerable:false,configurable:false});throw error});
}});
})();
"""


def _engine_demo_runtime_source_file_map(root, *, overrides=None):
    """Resolve the seven allow-listed Template paths without trusting inventory."""
    root = Path(root).resolve()
    files = {
        deployed_name: root / source_name
        for source_name, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
    }
    if overrides:
        if not overrides.keys() <= files.keys():
            raise ValueError("Engine-demo source overrides must use allow-listed paths")
        files.update(overrides)
    missing = [str(path) for path in files.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            "Required engine-demo runtime files are missing:\n  "
            + "\n  ".join(missing)
        )
    return files


def _engine_demo_runtime_source_files(root):
    """Resolve the seven Template inputs and verify their canonical inventory."""
    root = Path(root).resolve()
    files = _engine_demo_runtime_source_file_map(root)
    source_manifest = (
        root / "Template" / "assets" / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
    )
    if not source_manifest.is_file():
        raise FileNotFoundError(
            f"Required engine-demo runtime-kit manifest is missing: {source_manifest}"
        )
    expected_manifest_bytes = _engine_demo_runtime_kit_manifest_bytes(files)
    if source_manifest.read_bytes() != expected_manifest_bytes:
        raise ValueError(
            "Template engine-demo runtime-kit manifest does not canonically bind "
            "the exact seven source files"
        )
    return files


def _engine_demo_runtime_kit_manifest(files):
    """Build the deterministic inventory binding every source-supplied byte."""
    expected_names = [
        deployed_name for _, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
    ]
    if set(files) != set(expected_names):
        raise ValueError("Engine-demo source kit does not have the exact file set")
    inventory = []
    for deployed_name in expected_names:
        path = Path(files[deployed_name])
        if not path.is_file():
            raise FileNotFoundError(f"Engine-demo kit file is missing: {path}")
        inventory.append({
            "path": deployed_name,
            "bytes": path.stat().st_size,
            "sha256": _sha256_path(path),
        })
    return {
        "format": _ENGINE_DEMO_KIT_FORMAT,
        "schema_version": 1,
        "profile": _ENGINE_DEMO_KIT_PROFILE,
        "kind": "runtime-only",
        "contains_authored_project": False,
        "required_project_files": list(_ENGINE_DEMO_PROJECT_FILES),
        "files": inventory,
    }


def _engine_demo_runtime_kit_manifest_bytes(files):
    """Encode the exact portable kit manifest without timestamps or host data."""
    return (
        json.dumps(
            _engine_demo_runtime_kit_manifest(files),
            indent=2,
            ensure_ascii=True,
        )
        + "\n"
    ).encode("utf-8")


def _engine_demo_decoded_sha256(runtime_path, expected_bytes):
    """Hash the decoded runtime subject with the same expansion bound as SRI."""
    digest = hashlib.sha256()
    decoded_bytes = 0
    try:
        with gzip.open(runtime_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                decoded_bytes += len(chunk)
                if decoded_bytes > expected_bytes:
                    raise ValueError(
                        "Engine-demo runtime exceeds its decoded byte contract"
                    )
                digest.update(chunk)
    except OSError as error:
        raise ValueError(
            f"Invalid engine-demo gzip runtime: {runtime_path}: {error}"
        ) from error
    if decoded_bytes != expected_bytes:
        raise ValueError(
            f"Engine-demo runtime decoded {decoded_bytes} bytes; expected "
            f"{expected_bytes}"
        )
    return digest.hexdigest()


def _validate_engine_demo_local_launchers(files):
    """Validate the localhost-only server and Windows launcher contract."""
    serve_path = files["serve.py"]
    launch_path = files["launch.bat"]
    try:
        serve_source = serve_path.read_text(encoding="utf-8")
        compile(serve_source, str(serve_path), "exec")
        launch_source = launch_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError, SyntaxError) as error:
        raise ValueError(f"Invalid engine-demo local launcher: {error}") from error

    required_server_fragments = (
        'HOST = "127.0.0.1"',
        'self.send_header("Cross-Origin-Opener-Policy", "same-origin")',
        'self.send_header("Cross-Origin-Embedder-Policy", "require-corp")',
        'self.send_header("X-Content-Type-Options", "nosniff")',
        "class ThreadingHTTPServer",
        "os.chdir(ROOT)",
    )
    missing_server = [
        fragment for fragment in required_server_fragments
        if fragment not in serve_source
    ]
    if missing_server or 'HOST = "0.0.0.0"' in serve_source:
        raise ValueError(
            "Engine-demo serve.py violates its localhost/isolation contract"
        )

    required_launcher_fragments = (
        'set "SCRIPT_DIR=%~dp0"',
        "where python >nul 2>&1",
        'start "" http://127.0.0.1:%PORT%',
        'python "%SCRIPT_DIR%serve.py" %PORT%',
    )
    missing_launcher = [
        fragment for fragment in required_launcher_fragments
        if fragment not in launch_source
    ]
    if missing_launcher or "http://0.0.0.0" in launch_source:
        raise ValueError(
            "Engine-demo launch.bat violates its localhost server contract"
        )


def _validate_engine_demo_runtime_kit(files, canonical_wasm):
    """Fail closed unless an engine-demo kit is the verified platform profile."""
    runtime = Path(files.get('particle-platform.min.js.gz', ''))
    if not runtime.is_file() and descriptor_path(runtime).is_file():
        with tempfile.TemporaryDirectory(prefix='engine-demo-verify-') as temporary:
            restored = Path(temporary) / runtime.name
            restored.write_bytes(read_transport_file(runtime))
            return _validate_engine_demo_runtime_kit({**files, runtime.name: restored}, canonical_wasm)
    expected_names = {
        deployed_name for _, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
    } | {ENGINE_DEMO_RUNTIME_KIT_MANIFEST}
    if set(files) != expected_names:
        raise ValueError("Engine-demo runtime kit does not have the exact file set")
    missing = [str(path) for path in files.values() if not Path(path).is_file()]
    if missing:
        raise FileNotFoundError(
            "Engine-demo runtime kit is incomplete:\n  " + "\n  ".join(missing)
        )

    kit_manifest_path = Path(files[ENGINE_DEMO_RUNTIME_KIT_MANIFEST])
    kit_manifest = _strict_json_file(
        kit_manifest_path,
        "engine-demo runtime-kit manifest",
    )
    expected_kit_values = {
        "format": _ENGINE_DEMO_KIT_FORMAT,
        "schema_version": 1,
        "profile": _ENGINE_DEMO_KIT_PROFILE,
        "kind": "runtime-only",
        "contains_authored_project": False,
        "required_project_files": list(_ENGINE_DEMO_PROJECT_FILES),
    }
    for key, expected in expected_kit_values.items():
        if kit_manifest.get(key) != expected:
            raise ValueError(
                f"Engine-demo runtime-kit manifest {key!r} is invalid"
            )
    source_files = {
        deployed_name: files[deployed_name]
        for _, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
    }
    expected_inventory = _engine_demo_runtime_kit_manifest(source_files)["files"]
    if kit_manifest.get("files") != expected_inventory:
        raise ValueError(
            "Engine-demo runtime-kit inventory does not bind every shipped byte"
        )
    expected_manifest_bytes = _engine_demo_runtime_kit_manifest_bytes(source_files)
    if kit_manifest_path.read_bytes() != expected_manifest_bytes:
        raise ValueError("Engine-demo runtime-kit manifest encoding is not canonical")

    manifest = _strict_json_file(
        files["particle-platform.manifest.json"],
        "engine-demo runtime manifest",
    )
    exact_manifest_values = {
        "format": "particle-bundle-manifest/v2",
        "schema_version": 2,
        "name": "particle-platform",
        "target": "platform",
        "site_profile": "platform",
        "browser_runtime": "particle-platform.min.js.gz",
        "browser_runtime_compression": "gzip",
        "browser_runtime_loader": "release-runtime-loader.js",
    }
    for key, expected in exact_manifest_values.items():
        if manifest.get(key) != expected:
            raise ValueError(
                f"Engine-demo manifest {key!r} must be {expected!r}"
            )
    exact_boolean_values = {
        "include_editor": True,
        "include_agi": True,
        "include_plauna": True,
        "include_webgpu_os": True,
        "embed_source_tree": False,
        "eager": True,
        "production": True,
        "obfuscate": False,
        "encrypt": False,
        "integrity_wrapper": False,
    }
    for key, expected in exact_boolean_values.items():
        if manifest.get(key) is not expected:
            raise ValueError(
                f"Engine-demo manifest {key!r} must be {expected!r}"
            )
    if tuple(manifest.get("entries") or ()) != _ENGINE_DEMO_PLATFORM_ENTRIES:
        raise ValueError("Engine-demo manifest has an unexpected platform entry set")

    runtime_path = Path(files["particle-platform.min.js.gz"])
    compressed_bytes = manifest.get("browser_runtime_bytes")
    decoded_bytes = manifest.get("browser_runtime_decoded_bytes")
    if (
        type(compressed_bytes) is not int
        or compressed_bytes <= 0
        or type(decoded_bytes) is not int
        or decoded_bytes <= 0
    ):
        raise ValueError("Engine-demo manifest has an invalid runtime size contract")
    if runtime_path.stat().st_size != compressed_bytes:
        raise ValueError("Engine-demo compressed runtime byte count is invalid")
    if manifest.get("gzip_bytes") != compressed_bytes:
        raise ValueError("Engine-demo gzip byte identities disagree")
    if manifest.get("min_bytes") != decoded_bytes:
        raise ValueError("Engine-demo decoded byte identities disagree")

    integrity = str(manifest.get("browser_runtime_integrity") or "")
    if not re.fullmatch(r"sha384-[A-Za-z0-9+/]{64}", integrity):
        raise ValueError("Engine-demo runtime has an invalid SHA-384 identity")
    if manifest.get("sri") != integrity:
        raise ValueError("Engine-demo runtime SRI identities disagree")
    _verify_release_runtime_gzip(runtime_path, integrity, decoded_bytes)
    gzip_sha256 = _sha256_path(runtime_path)
    decoded_sha256 = _engine_demo_decoded_sha256(runtime_path, decoded_bytes)
    decoded_sha384 = base64.b64decode(integrity.removeprefix("sha384-")).hex()

    modules = manifest.get("modules")
    files_inventory = manifest.get("files")
    if type(modules) is not int or modules <= 0:
        raise ValueError("Engine-demo manifest has an invalid module count")
    if not isinstance(files_inventory, list) or len(files_inventory) != modules:
        raise ValueError("Engine-demo manifest file inventory is incomplete")
    post_build = manifest.get("post_build_verification")
    if not isinstance(post_build, dict):
        raise ValueError("Engine-demo manifest has no post-build verification")
    exact_post_build_values = {
        "format": 1,
        "files_verified": modules,
        "registry_entries": modules,
        "static_registry_verified": True,
        "decoded_sha384": integrity,
        "gzip_sha256": gzip_sha256,
    }
    for key, expected in exact_post_build_values.items():
        if post_build.get(key) != expected:
            raise ValueError(
                f"Engine-demo post-build identity {key!r} is invalid"
            )
    if tuple(post_build.get("public_namespaces_verified") or ()) != (
        _ENGINE_DEMO_PUBLIC_NAMESPACES
    ):
        raise ValueError("Engine-demo public namespace verification is incomplete")
    for key in ("file_inventory_sha256", "source_content_sha256"):
        value = str(post_build.get(key) or "")
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError(f"Engine-demo post-build {key} is invalid")
    if manifest.get("source_content_sha256") != post_build["source_content_sha256"]:
        raise ValueError("Engine-demo source content identities disagree")

    provenance_contract = manifest.get("provenance")
    if not isinstance(provenance_contract, dict):
        raise ValueError("Engine-demo manifest has no provenance contract")
    if provenance_contract.get("path") != "particle-platform.provenance.json":
        raise ValueError("Engine-demo provenance path is invalid")
    if provenance_contract.get("predicate_type") != _ENGINE_DEMO_PREDICATE_TYPE:
        raise ValueError("Engine-demo provenance predicate type is invalid")
    provenance_sha256 = str(provenance_contract.get("sha256") or "")
    provenance_path = Path(files["particle-platform.provenance.json"])
    if (
        not re.fullmatch(r"[0-9a-f]{64}", provenance_sha256)
        or _sha256_path(provenance_path) != provenance_sha256
    ):
        raise ValueError("Engine-demo provenance SHA-256 is invalid")

    provenance = _strict_json_file(provenance_path, "engine-demo provenance")
    if provenance.get("_type") != _ENGINE_DEMO_PROVENANCE_TYPE:
        raise ValueError("Engine-demo provenance statement type is invalid")
    if provenance.get("predicateType") != _ENGINE_DEMO_PREDICATE_TYPE:
        raise ValueError("Engine-demo provenance predicate is invalid")
    subjects = provenance.get("subject")
    if not isinstance(subjects, list) or len(subjects) != 2:
        raise ValueError("Engine-demo provenance subjects are incomplete")
    subject_by_name = {
        item.get("name"): item.get("digest")
        for item in subjects
        if isinstance(item, dict) and isinstance(item.get("digest"), dict)
    }
    if set(subject_by_name) != {
        "particle-platform.min.js.gz",
        "particle-platform.min.js",
    }:
        raise ValueError("Engine-demo provenance subjects are invalid")
    if subject_by_name["particle-platform.min.js.gz"] != {
        "sha256": gzip_sha256
    }:
        raise ValueError("Engine-demo gzip provenance subject is invalid")
    if subject_by_name["particle-platform.min.js"] != {
        "sha256": decoded_sha256,
        "sha384": decoded_sha384,
    }:
        raise ValueError("Engine-demo decoded provenance subject is invalid")

    predicate = provenance.get("predicate")
    build_definition = (
        predicate.get("buildDefinition") if isinstance(predicate, dict) else None
    )
    if not isinstance(build_definition, dict):
        raise ValueError("Engine-demo provenance has no build definition")
    if build_definition.get("buildType") != _ENGINE_DEMO_BUILD_TYPE:
        raise ValueError("Engine-demo provenance build type is invalid")
    external = build_definition.get("externalParameters")
    if not isinstance(external, dict):
        raise ValueError("Engine-demo provenance external parameters are invalid")
    expected_external = {
        "target": "platform",
        "entries": list(_ENGINE_DEMO_PLATFORM_ENTRIES),
        "production": True,
        "eager": True,
        "obfuscate": False,
        "encrypt": False,
    }
    if external != expected_external:
        raise ValueError("Engine-demo provenance build parameters are invalid")
    dependencies = build_definition.get("resolvedDependencies")
    if not isinstance(dependencies, list) or len(dependencies) != 1:
        raise ValueError("Engine-demo provenance source dependency is invalid")
    dependency_digest = dependencies[0].get("digest") if isinstance(
        dependencies[0], dict
    ) else None
    if dependency_digest != {"sha256": post_build["source_content_sha256"]}:
        raise ValueError("Engine-demo provenance source identity is invalid")
    run_details = predicate.get("runDetails")
    metadata = run_details.get("metadata") if isinstance(run_details, dict) else None
    if not isinstance(metadata, dict) or metadata.get("reproducible") is not True:
        raise ValueError("Engine-demo provenance is not reproducible")

    loader_path = Path(files["release-runtime-loader.js"])
    if loader_path.read_bytes() != _release_runtime_loader_bytes():
        raise ValueError("Engine-demo runtime loader differs from the canonical loader")
    canonical_wasm = Path(canonical_wasm)
    wasm_path = Path(files["physx-pe.wasm"])
    if not canonical_wasm.is_file():
        raise FileNotFoundError(
            f"Canonical PhysX WebAssembly source is missing: {canonical_wasm}"
        )
    if (
        wasm_path.stat().st_size != canonical_wasm.stat().st_size
        or _sha256_path(wasm_path) != _sha256_path(canonical_wasm)
    ):
        raise ValueError("Engine-demo PhysX WebAssembly differs from engine source")
    _validate_engine_demo_local_launchers(files)
    return manifest


def _remove_engine_demo_publish_tree(path, parent):
    """Remove one private staging tree only when it is under the asset root."""
    path = Path(path).resolve()
    parent = Path(parent).resolve()
    if path.parent != parent or not path.name.startswith(".engine-demo."):
        raise RuntimeError(f"Refusing to remove unsafe engine-demo path: {path}")
    if path.exists():
        shutil.rmtree(path)


_ENGINE_DEMO_STARTER_INDEX = """<!doctype html>
<html lang="en">
<head>
  <!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
  <!-- SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha -->
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Particle Matrix Field</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="shell">
    <header class="hero">
      <p class="eyebrow">Particle Realms · verified starter</p>
      <h1>Matrix field</h1>
      <p>A compact WebGPU shader running through the signed Particle Platform runtime.</p>
    </header>
    <section class="stage" aria-label="Animated WebGPU matrix field">
      <canvas id="canvas" aria-label="Animated cyan and violet matrix field"></canvas>
      <div class="telemetry" aria-hidden="true"><span>PE</span><span>WEBGPU</span><span>LOCAL</span></div>
    </section>
    <section class="controls" aria-label="Demo controls">
      <button id="toggle" type="button">Pause field</button>
      <output id="status" role="status" aria-live="polite">Loading verified engine…</output>
    </section>
    <p id="error" role="alert" aria-live="assertive" hidden></p>
  </main>
  <script src="app.js"></script>
</body>
</html>
"""

_ENGINE_DEMO_STARTER_STYLES = """/* SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> */
/* SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha */
:root {
  color-scheme: dark;
  --ink: #eef4ff;
  --muted: #8995ad;
  --panel: #0a1020;
  --line: #263455;
  --cyan: #65e8ff;
  --violet: #aa7dff;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  color: var(--ink);
  background: radial-gradient(circle at 50% -20%, #243665 0, #070b14 48%, #03050a 100%);
}
.shell { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 56px 0; }
.hero { display: grid; gap: 10px; max-width: 720px; margin-bottom: 24px; }
.hero p { margin: 0; color: var(--muted); line-height: 1.55; }
.eyebrow { color: var(--cyan) !important; font: 700 12px/1 ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(42px, 8vw, 88px); font-weight: 620; letter-spacing: -.055em; }
.stage { position: relative; min-height: 520px; overflow: hidden; border: 1px solid var(--line); border-radius: 26px; background: var(--panel); box-shadow: 0 34px 90px #0009; }
canvas { display: block; width: 100%; height: 520px; }
.telemetry { position: absolute; inset: auto 18px 16px; display: flex; gap: 8px; pointer-events: none; }
.telemetry span { padding: 6px 9px; border: 1px solid #6d7aa744; border-radius: 99px; color: #b8c6e5; background: #070b14aa; font: 600 10px/1 ui-monospace, monospace; letter-spacing: .12em; }
.controls { display: flex; align-items: center; gap: 16px; padding: 18px 2px; }
button { appearance: none; border: 1px solid #7ce8ff66; border-radius: 12px; padding: 11px 16px; color: #021019; background: var(--cyan); font: 750 14px/1 system-ui, sans-serif; cursor: pointer; }
button:hover { filter: brightness(1.08); }
button:focus-visible { outline: 3px solid var(--violet); outline-offset: 3px; }
output { color: var(--muted); font: 600 12px/1.4 ui-monospace, monospace; }
#error { padding: 14px 16px; border: 1px solid #ff7688; border-radius: 12px; color: #ffdce1; background: #3b1018; }
@media (max-width: 640px) {
  .shell { width: min(100% - 20px, 1080px); padding: 30px 0; }
  .stage, canvas { min-height: 420px; height: 420px; }
  .controls { align-items: flex-start; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
"""

_ENGINE_DEMO_STARTER_APP = """// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
(() => {
"use strict";

const canvas = document.querySelector("#canvas");
const toggle = document.querySelector("#toggle");
const status = document.querySelector("#status");
const errorOutput = document.querySelector("#error");
const state = { paused: false, frame: 0, startedAt: 0, disposed: false };
let surface = null;
let device = null;
let uniformBuffer = null;
let frameHandle = 0;

function showError(message) {
  status.textContent = "Stopped";
  errorOutput.hidden = false;
  errorOutput.textContent = String(message);
}

function resizeCanvas() {
  surface?.resizeCanvas?.();
}

function draw(now) {
  if (state.disposed) return;
  if (!state.paused && device && surface) {
    const seconds = (now - state.startedAt) / 1000;
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
      seconds, canvas.width, canvas.height, window.devicePixelRatio || 1,
    ]));
    const encoder = device.createCommandEncoder({ label: "MatrixField.Frame" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: surface.context.getCurrentTexture().createView(),
        clearValue: { r: 0.01, g: 0.015, b: 0.035, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, state.bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  frameHandle = requestAnimationFrame(draw);
}

function toggleMotion() {
  state.paused = !state.paused;
  toggle.textContent = state.paused ? "Resume field" : "Pause field";
  status.textContent = state.paused ? "Paused" : "Running · verified Particle Platform";
}

async function start() {
  if (!navigator.gpu) {
    showError("WebGPU is unavailable in this browser. Open the demo on localhost in a current WebGPU-capable browser.");
    return;
  }
  try {
    const runtime = await globalThis.__PE_RUNTIME_READY;
    if (typeof runtime.initWebGpuCanvas !== "function") throw new Error("The verified runtime does not expose initWebGpuCanvas.");
    surface = await runtime.initWebGpuCanvas({ canvasSelector: "#canvas", label: "ParticleRealms.EngineDemoStarter" });
    device = surface.gpuDevice.getDevice();
    device.lost.then((info) => {
      if (!state.disposed && info?.reason !== "destroyed") showError(`GPU device lost: ${info?.message || info?.reason || "unknown"}`);
    });
    const shader = device.createShaderModule({
      label: "MatrixField.Shader",
      code: `
struct Frame { time: f32, width: f32, height: f32, dpr: f32 }
@group(0) @binding(0) var<uniform> frame: Frame;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOut;
  output.position = vec4f(points[vertexIndex], 0.0, 1.0);
  output.uv = points[vertexIndex] * 0.5 + 0.5;
  return output;
}
@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let aspect = frame.width / max(frame.height, 1.0);
  var p = (input.uv - 0.5) * vec2f(aspect, 1.0);
  let drift = frame.time * 0.17;
  let gridA = abs(fract((p + vec2f(drift, -drift * 0.65)) * 13.0) - 0.5);
  let gridB = abs(fract((p.yx + vec2f(-drift * 0.43, drift * 0.8)) * 21.0) - 0.5);
  let lines = exp(-55.0 * min(min(gridA.x, gridA.y), min(gridB.x, gridB.y)));
  let wave = 0.5 + 0.5 * cos(length(p) * 19.0 - frame.time * 2.1);
  let cyan = vec3f(0.12, 0.82, 1.0);
  let violet = vec3f(0.58, 0.24, 1.0);
  let color = mix(violet, cyan, wave) * lines + vec3f(0.008, 0.014, 0.035);
  let vignette = smoothstep(0.82, 0.18, length(p * vec2f(0.75, 1.0)));
  return vec4f(color * (0.38 + vignette), 1.0);
}`,
    });
    const pipeline = await device.createRenderPipelineAsync({
      label: "MatrixField.Pipeline",
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertexMain" },
      fragment: { module: shader, entryPoint: "fragmentMain", targets: [{ format: surface.format }] },
      primitive: { topology: "triangle-list" },
    });
    uniformBuffer = device.createBuffer({
      label: "MatrixField.FrameUniforms",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    state.pipeline = pipeline;
    state.bindGroup = device.createBindGroup({
      label: "MatrixField.FrameBindGroup",
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    state.startedAt = performance.now();
    status.textContent = state.paused ? "Paused" : "Running · verified Particle Platform";
    frameHandle = requestAnimationFrame(draw);
  } catch (error) {
    showError(error?.message || error);
  }
}

function cleanup() {
  state.disposed = true;
  cancelAnimationFrame(frameHandle);
  removeEventListener("resize", resizeCanvas);
  try { uniformBuffer?.destroy(); } catch {}
  try { surface?.dispose(); } catch {}
  try { surface?.gpuDevice?.destroy(); } catch {}
}

toggle.addEventListener("click", toggleMotion);
addEventListener("resize", resizeCanvas);
addEventListener("pagehide", cleanup, { once: true });
start();
})();
"""

_ENGINE_DEMO_STARTER_BEHAVIOR = {
    "format": "webgpu-os-dodad-behavior-v1",
    "family": "engine-demo",
    "entrypoint": "index.html",
    "runtime": {"profile": _ENGINE_DEMO_KIT_PROFILE},
    "state": [{"id": "motion", "initial": "running"}],
    "interactions": [{
        "id": "toggleMotion",
        "event": "click",
        "target": "#toggle",
        "effect": "Pause or resume the owned WebGPU animation loop.",
    }],
    "controls": [{
        "id": "motionToggle",
        "selector": "#toggle",
        "label": "Pause or resume the matrix field",
    }],
    "breakpoints": [
        {"id": "compact", "minWidth": 0, "maxWidth": 640},
        {"id": "wide", "minWidth": 641, "maxWidth": 10000},
    ],
    "accessibility": {
        "landmarks": True,
        "keyboard": True,
        "reducedMotion": True,
        "liveRegions": ["#status", "#error"],
    },
    "scenarios": [{
        "id": "pauseField",
        "steps": [{"action": "click", "target": "#toggle"}],
        "assertions": [{"kind": "text", "target": "#status", "value": "Paused"}],
    }],
}


def _engine_demo_starter_files(source_dir):
    """Build one source-pinned runnable starter and its exact source graph."""
    source_dir = Path(source_dir)
    runtime_manifest = _strict_json_file(
        source_dir / "particle-platform.manifest.json",
        "engine-demo starter runtime manifest",
    )
    integrity = str(runtime_manifest.get("browser_runtime_integrity") or "")
    decoded_bytes = runtime_manifest.get("browser_runtime_decoded_bytes")
    compressed_bytes = runtime_manifest.get("browser_runtime_bytes")
    if not re.fullmatch(r"sha384-[A-Za-z0-9+/]{64}", integrity):
        raise ValueError("Engine-demo starter runtime SRI is invalid")
    if type(decoded_bytes) is not int or type(compressed_bytes) is not int:
        raise ValueError("Engine-demo starter runtime sizes are invalid")
    app_tag = '  <script src="app.js"></script>'
    if _ENGINE_DEMO_STARTER_INDEX.count(app_tag) != 1:
        raise RuntimeError("Engine-demo starter authored script marker is invalid")
    head_tag = "<head>\n"
    if _ENGINE_DEMO_STARTER_INDEX.count(head_tag) != 1:
        raise RuntimeError("Engine-demo starter head marker is invalid")
    csp_tag = (
        '  <meta http-equiv="Content-Security-Policy" '
        f'content="{_ENGINE_DEMO_STARTER_CSP}">'
    )
    membrane_tag = '  <script src="./engine-demo-public-api.js"></script>'
    loader_tag = (
        '  <script src="./release-runtime-loader.js" '
        'data-runtime-src="./particle-platform.min.js.gz" data-asset-base="./" '
        'data-runtime-base="./" '
        f'data-integrity="{integrity}" data-runtime-bytes="{decoded_bytes}" '
        f'data-runtime-compressed-bytes="{compressed_bytes}" '
        'data-os-base="./"></script>'
    )
    executable_index = _ENGINE_DEMO_STARTER_INDEX.replace(
        head_tag,
        f"{head_tag}{csp_tag}\n",
    ).replace(
        app_tag,
        f"{membrane_tag}\n{loader_tag}\n{app_tag}",
    )
    behavior_bytes = (
        json.dumps(_ENGINE_DEMO_STARTER_BEHAVIOR, indent=2) + "\n"
    ).encode("utf-8")
    authored = {
        "index.html": _ENGINE_DEMO_STARTER_INDEX.encode("utf-8"),
        "styles.css": _ENGINE_DEMO_STARTER_STYLES.encode("utf-8"),
        "app.js": _ENGINE_DEMO_STARTER_APP.encode("utf-8"),
        "dodad.behavior.json": behavior_bytes,
    }
    files = {
        "index.html": executable_index.encode("utf-8"),
        "styles.css": authored["styles.css"],
        "app.js": authored["app.js"],
        "dodad.behavior.json": authored["dodad.behavior.json"],
        "engine-demo-public-api.js": (
            _engine_demo_public_api_membrane_source().encode("utf-8")
        ),
    }
    for _, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES:
        files[deployed_name] = read_transport_file(source_dir / deployed_name)
    files[ENGINE_DEMO_RUNTIME_KIT_MANIFEST] = (
        source_dir / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
    ).read_bytes()
    for name, payload in authored.items():
        files[f"source/{name}"] = payload
    files["README.md"] = (
        "# Particle Matrix Field\n\n"
        "This is the verified Particle Engine demo starter distributed as an ordinary "
        "Cloudflare Pages static asset. It has no CDN, npm, R2, Worker, or upload dependency.\n\n"
        "Run `python serve.py`, then open http://127.0.0.1:8000. On Windows, "
        "`launch.bat` does both. Do not open index.html with file://.\n\n"
        "The accepted four authored files are preserved byte-for-byte in `source/`. "
        "The root index adds a restrictive CSP, the curated public-API membrane, and the "
        "verified local gzip runtime loader. The membrane restores ambient globals before "
        "the authored app receives its frozen, sidecar-free API. Custom AI Echo exports "
        "are built privately in the browser and are not uploaded.\n"
    ).encode("utf-8")
    inventory = [
        {"path": name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        for name, payload in sorted(files.items())
    ]
    starter_manifest = {
        "format": "particle-engine-demo-starter/v1",
        "schema_version": 1,
        "profile": _ENGINE_DEMO_KIT_PROFILE,
        "kind": "cloudflare-pages-static-download",
        "entrypoint": "index.html",
        "source_files": list(_ENGINE_DEMO_PROJECT_FILES),
        "coverage": {
            "mode": "all-files-except-manifest",
            "manifest_path": "engine-demo.starter.json",
        },
        "files": inventory,
    }
    files["engine-demo.starter.json"] = (
        json.dumps(starter_manifest, indent=2) + "\n"
    ).encode("utf-8")
    return files


def _write_engine_demo_starter_archive(source_dir, destination):
    """Write the deterministic logical ZIP; publication splits oversized bytes."""
    destination = Path(destination)
    files = _engine_demo_starter_files(source_dir)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(
        f".{destination.name}.{os.getpid()}.{time.time_ns()}.tmp"
    )
    try:
        with zipfile.ZipFile(
            temporary,
            "w",
            compression=zipfile.ZIP_STORED,
            allowZip64=False,
        ) as archive:
            for member_name, payload in sorted(files.items()):
                info = zipfile.ZipInfo(member_name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, payload)
        _os_replace_with_retry(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def _validate_engine_demo_starter_archive(archive_path, source_dir):
    """Verify deterministic metadata and every starter/kit byte in the ZIP."""
    archive_path = Path(archive_path)
    expected = _engine_demo_starter_files(source_dir)
    expected_names = sorted(expected)
    try:
        with zipfile.ZipFile(io.BytesIO(read_transport_file(archive_path)), "r") as archive:
            infos = archive.infolist()
            if [info.filename for info in infos] != expected_names:
                raise ValueError("Engine-demo starter archive has unexpected members")
            if len({info.filename for info in infos}) != len(expected_names):
                raise ValueError("Engine-demo starter archive has duplicate members")
            for info in infos:
                if (
                    info.is_dir()
                    or info.compress_type != zipfile.ZIP_STORED
                    or info.date_time != (1980, 1, 1, 0, 0, 0)
                ):
                    raise ValueError(
                        f"Engine-demo starter archive metadata is invalid: {info.filename}"
                    )
                if archive.read(info) != expected[info.filename]:
                    raise ValueError(
                        f"Engine-demo starter archive byte mismatch: {info.filename}"
                    )
            corrupt = archive.testzip()
            if corrupt is not None:
                raise ValueError(f"Engine-demo starter archive CRC failed: {corrupt}")
    except (OSError, zipfile.BadZipFile) as error:
        raise ValueError(
            f"Invalid engine-demo starter archive: {archive_path}: {error}"
        ) from error
    return len(expected_names)


def lay_down_engine_demo_runtime_assets(root, os_dst):
    """Atomically publish the verified platform kit used by AI Echo demos."""
    root = Path(root).resolve()
    os_dst = Path(os_dst).resolve()
    source_files = _engine_demo_runtime_source_files(root)
    canonical_wasm = root / "engine" / "sim" / "physics" / "physx-pe.wasm"
    assets_root = os_dst / "assets"
    assets_root.mkdir(parents=True, exist_ok=True)
    destination = assets_root / "engine-demo"
    unique = f"{os.getpid()}.{time.time_ns()}"
    staging = assets_root / f".engine-demo.{unique}.tmp"
    previous = assets_root / f".engine-demo.{unique}.previous"
    staging.mkdir()
    moved_previous = False
    installed = False
    success = False
    try:
        for deployed_name, source in source_files.items():
            shutil.copy2(source, staging / deployed_name)
        staged_source_files = {
            deployed_name: staging / deployed_name
            for deployed_name in source_files
        }
        (staging / ENGINE_DEMO_RUNTIME_KIT_MANIFEST).write_bytes(
            _engine_demo_runtime_kit_manifest_bytes(staged_source_files)
        )
        staged_files = {
            deployed_name: staging / deployed_name
            for deployed_name in (
                *source_files.keys(),
                ENGINE_DEMO_RUNTIME_KIT_MANIFEST,
            )
        }
        _validate_engine_demo_runtime_kit(staged_files, canonical_wasm)
        for deployed_name, source in source_files.items():
            if _sha256_path(staging / deployed_name) != _sha256_path(source):
                raise OSError(
                    f"Engine-demo staging byte-parity failure: {deployed_name}"
                )
        starter_relative = PurePosixPath(ENGINE_DEMO_STARTER_ARCHIVE_PATH)
        starter_inside_kit = Path(*starter_relative.parts[2:])
        starter_path = staging / starter_inside_kit
        # The versioned download lives below the eight flat kit files, so the
        # entire publication can still commit through one directory replace.
        starter_path.parent.mkdir(parents=True, exist_ok=True)
        _write_engine_demo_starter_archive(staging, starter_path)
        _validate_engine_demo_starter_archive(starter_path, staging)
        publish_transport(staging / 'particle-platform.min.js.gz', CLOUDFLARE_PAGES_MAX_FILE_BYTES)
        publish_transport(starter_path, CLOUDFLARE_PAGES_MAX_FILE_BYTES)

        try:
            if destination.exists():
                if not destination.is_dir():
                    raise NotADirectoryError(
                        f"Engine-demo deployment target is not a directory: {destination}"
                    )
                _replace_path_with_retry(destination, previous)
                moved_previous = True
            _replace_path_with_retry(staging, destination)
            installed = True
            deployed_files = {
                deployed_name: destination / deployed_name
                for deployed_name in staged_files
            }
            _validate_engine_demo_runtime_kit(deployed_files, canonical_wasm)
            _validate_engine_demo_starter_archive(
                os_dst / ENGINE_DEMO_STARTER_ARCHIVE_PATH,
                destination,
            )
        except Exception:
            if installed and destination.exists():
                _replace_path_with_retry(destination, staging)
                installed = False
            if moved_previous and previous.exists() and not destination.exists():
                _replace_path_with_retry(previous, destination)
                moved_previous = False
            raise
        success = True
    finally:
        _remove_engine_demo_publish_tree(staging, assets_root)
        if success and previous.exists():
            _remove_engine_demo_publish_tree(previous, assets_root)
    return sum(path.is_file() for path in destination.rglob('*'))


DOCUMENT_RUNTIME_ASSET_DIRECTORIES = (
    "vendor/pdfjs",
    "vendor/pdf-lib",
    "vendor/pdf-fontkit",
)
DOCUMENT_RUNTIME_WORKER_ENTRIES = (
    ("document analysis", "webgpu-os/factory/components/ocr/worker.js"),
    ("Sewing fitting", "webgpu-os/factory/apps/sewing/fitted-worker.js"),
    ("Sewing accessory geometry", "webgpu-os/factory/apps/sewing/accessory-mesh-worker.js"),
    ("Sewing accessory assembly", "webgpu-os/factory/apps/sewing/accessory-assembly-worker.js"),
    ("triangular cloth", "engine/sim/cloth/triangular/worker.js"),
    ("surface material", "engine/sim/surfaceFields/SurfaceFieldWorker.js"),
)
DOCUMENT_RUNTIME_REQUIRED_PATHS = (
    "vendor/pdfjs/build/pdf.mjs",
    "vendor/pdfjs/build/pdf.worker.mjs",
    "vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
    "vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap",
    "vendor/pdfjs/wasm/openjpeg.wasm",
    "vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc",
    "vendor/pdf-lib/dist/pdf-lib.esm.js",
    "vendor/pdf-fontkit/dist/fontkit.umd.js",
)


def hls_runtime_asset_manifest(root):
    """Verify and inventory the vendored ESM player and its native worker.

    VideoPlayer and the standalone guest use the same browser distribution.
    Its existing provenance supplies local byte pins; packaging never downloads
    an upstream archive or rebuilds third-party JavaScript.
    """
    root = Path(root).resolve()
    directory = root / "vendor/hls.js"
    names = ("hls.mjs", "hls.worker.js", "LICENSE", "distribution-metadata.json", "provenance.json")
    if any(path.is_symlink() for path in (root / "vendor", directory)):
        raise ValueError("HLS runtime distribution cannot contain linked directories")
    missing = [name for name in names if not (directory / name).is_file()]
    if missing:
        raise FileNotFoundError("Required HLS runtime assets are missing:\n  " + "\n  ".join(missing))
    for name in names:
        path = directory / name
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError(f"HLS runtime asset escapes its source root: {name}")
    provenance = _strict_json_file(directory / "provenance.json", "HLS provenance")
    metadata = _strict_json_file(directory / "distribution-metadata.json", "HLS distribution metadata")
    if (not isinstance(provenance, dict) or not isinstance(metadata, dict)
            or provenance.get("package") != "hls.js" or metadata.get("name") != "hls.js"
            or not isinstance(provenance.get("version"), str) or not provenance["version"]
            or provenance["version"] != metadata.get("version")
            or metadata.get("license") != "Apache-2.0"):
        raise ValueError("HLS distribution identity differs from its provenance")
    records = provenance.get("files")
    if not isinstance(records, list) or len(records) != len(names) - 1:
        raise ValueError("HLS provenance file inventory is incomplete")
    checked = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("HLS provenance file record must be an object")
        name = _safe_release_relative_path(record.get("path"), "HLS provenance").as_posix()
        if name not in names[:-1] or name in checked:
            raise ValueError(f"Unexpected or duplicate HLS provenance file: {name}")
        checked.add(name)
        path = directory / name
        if (type(record.get("byteLength")) is not int or record["byteLength"] < 1
                or path.stat().st_size != record["byteLength"]
                or record.get("sha256") != _sha256_path(path)):
            raise ValueError(f"HLS runtime bytes do not match provenance: {name}")
    return tuple((f"vendor/hls.js/{name}", f"vendor/hls.js/{name}") for name in names)


def document_runtime_asset_manifest(root):
    """Inventory native PDF/HLS modules and isolated pattern/document/cloth workers.

    These distributions retain their original modules, data files, licenses and
    provenance. Native dynamic imports and import.meta-relative worker URLs must
    not be folded into the classic bundle's private module registry.
    """
    from .graph import ModuleGraph
    root = Path(root).resolve()
    paths = set(DOCUMENT_RUNTIME_REQUIRED_PATHS)
    paths.update(source for source, _destination in hls_runtime_asset_manifest(root))
    # Owned workers import shared Engine helpers in their own realms. Follow
    # those real imports; archived pattern generators are not runtime assets.
    for label, entry in DOCUMENT_RUNTIME_WORKER_ENTRIES:
        graph = ModuleGraph(root)
        graph.walk(entry)
        if graph.errors:
            raise ValueError(f"Incomplete {label} worker closure: " + "; ".join(map(str, graph.errors)))
        for filename in graph.order:
            source = Path(filename).resolve()
            relative = source.relative_to(root).as_posix()
            imports, exports = parse_module(graph.modules[filename])
            specs = [item.spec for item in imports if item.spec]
            specs.extend(item.spec for item in exports if item.reexport and item.spec)
            if any(not spec.startswith((".", "/")) or spec.startswith("//") for spec in specs):
                raise ValueError(f"Nonlocal {label} worker dependency: {relative}")
            paths.add(relative)
    for relative_name in DOCUMENT_RUNTIME_ASSET_DIRECTORIES:
        directory = root / relative_name
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f"Document runtime directory is missing or linked: {directory}")
        for source in directory.rglob("*"):
            if source.is_symlink():
                raise ValueError(f"Document runtime assets cannot contain symlinks: {source}")
            if source.is_file():
                paths.add(source.relative_to(root).as_posix())
    missing = [name for name in sorted(paths) if not (root / name).is_file()]
    if missing:
        raise FileNotFoundError("Required document runtime assets are missing:\n  " + "\n  ".join(missing))
    return tuple((name, name) for name in sorted(paths))


def lay_down_document_runtime_assets(site_dir, root):
    """Ship and validate the same native runtime closure in both OS layouts."""
    started = time.perf_counter()
    print("[bundle][document-runtime][entry] inventory PDF, pattern, document analysis and cloth worker assets")
    copied = _copy_release_asset_manifest(site_dir, root, document_runtime_asset_manifest(root))
    checked = _validate_release_module_graph(
        site_dir,
        "webgpu-os/factory/apps/sewing",
        "document/pattern/OCR/cloth runtime",
        follow_imports=True,
        entry_relative_paths=tuple(entry for _label, entry in DOCUMENT_RUNTIME_WORKER_ENTRIES) + (
            "vendor/pdfjs/build/pdf.mjs",
            "vendor/pdfjs/build/pdf.worker.mjs",
            "vendor/pdf-lib/dist/pdf-lib.esm.js",
            "vendor/pdf-fontkit/dist/fontkit.umd.js",
        ),
    )
    print(
        f"[bundle][document-runtime][exit] files={copied} module_edges={checked} "
        f"duration_ms={(time.perf_counter() - started) * 1000:.3f}"
    )
    return copied


def _validate_realmforge_source_city_captures(os_root, *, catalog_source=None):
    """Verify deployed captures against the same literal pins used by the app."""
    catalog_relative = "apps/realmforge/virtual-realm/RealmSourceCityCaptureCatalog.js"
    catalog = Path(catalog_source) if catalog_source is not None else ROOT / "webgpu-os" / catalog_relative
    source = catalog.read_text(encoding="utf-8", errors="strict")
    match = re.search(
        r"export const REALM_SOURCE_CITY_CAPTURES = cloneRealmForgeJson\((\{[\s\S]*?\n\})\);",
        source,
    )
    if not match:
        raise ValueError("RealmForge source-city capture catalog must contain literal descriptors")
    literal = re.sub(r"(?m)^(\s*)([A-Za-z_$][\w$]*)\s*:", r"\1'\2':", match.group(1))
    try:
        tree = ast.parse(literal, mode="eval")
        for node in ast.walk(tree):
            if isinstance(node, ast.Dict):
                keys = [ast.literal_eval(key) for key in node.keys]
                if len(keys) != len(set(keys)):
                    raise ValueError("duplicate descriptor key")
        records = ast.literal_eval(tree)
        if not isinstance(records, dict) or not records:
            raise ValueError("empty capture catalog")
    except (SyntaxError, TypeError, ValueError) as error:
        raise ValueError(f"Invalid RealmForge source-city capture descriptors: {error}") from error
    paths = []
    for inventory, record in records.items():
        if not isinstance(record, dict):
            raise ValueError("RealmForge source-city capture descriptor must be an object")
        raw_path = record.get("path")
        relative = _safe_release_relative_path(
            raw_path.removeprefix("./") if isinstance(raw_path, str) else raw_path,
            "source-city capture",
        )
        name = (PurePosixPath("apps/realmforge/virtual-realm") / relative).as_posix()
        paths.append(name)
        path = Path(os_root) / name
        if not path.is_file():
            raise FileNotFoundError(f"Required RealmForge source-city capture is missing: {path}")
        if (type(record.get("byteLength")) is not int or record["byteLength"] < 1
                or path.stat().st_size != record["byteLength"]
                or record.get("sha256") != f"sha256:{_sha256_path(path)}"):
            raise ValueError(f"RealmForge source-city capture bytes do not match catalog pin: {name}")
        snapshot = _strict_json_file(path, "RealmForge source-city capture")
        if (record.get("inventory") != inventory
                or snapshot.get("inventoryId") != record.get("inventoryId")
                or snapshot.get("snapshotDigest") != record.get("sourceSnapshotDigest")
                or len(snapshot.get("files", [])) != record.get("fileCount")
                or len(snapshot.get("relations", [])) != record.get("relationCount")
                or snapshot.get("sourceTextIncluded") is not False):
            raise ValueError(f"RealmForge source-city capture identity differs from catalog: {name}")
    if len(paths) != len(set(paths)) or set(paths) != set(REALMFORGE_SOURCE_CITY_CAPTURE_PATHS):
        raise ValueError("RealmForge source-city capture catalog differs from deployed inventory")
    return len(paths)


def lay_down_webgpu_os_runtime_assets(os_src, os_dst):
    """Copy raw files that the compiled WebGPU OS still loads by URL.

    JSON is parsed during the build so a corrupt catalog cannot become a
    production-only HTML-fallback symptom. JavaScript files remain byte-for-byte
    source modules because the parser bootstrap and module workers cannot execute
    out of the classic OS bundle.
    """
    os_src = Path(os_src)
    os_dst = Path(os_dst)
    missing = []
    copied = 0
    for relative_name in WEBGPU_OS_RUNTIME_ASSET_PATHS:
        source = os_src / relative_name
        if not source.is_file():
            missing.append(str(source))
            continue
        if source.suffix == ".json":
            try:
                json.loads(source.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise ValueError(
                    f"Invalid WebGPU OS runtime JSON asset: {source}: {error}"
                ) from error
        destination = os_dst / relative_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied += 1
    if missing:
        raise FileNotFoundError(
            "Required WebGPU OS runtime assets are missing:\n  " + "\n  ".join(missing)
        )
    _validate_realmforge_source_city_captures(
        os_dst,
        catalog_source=os_src / "apps/realmforge/virtual-realm/RealmSourceCityCaptureCatalog.js",
    )
    copied += lay_down_watch_party_runtime_assets(os_src.parent, os_dst.parent)
    return copied


def watch_party_runtime_asset_manifest(root):
    """Return direct assets for the independent guest and its worker realms."""
    from .graph import ModuleGraph

    root = Path(root).resolve(strict=True)
    entries = [root / "webgpu-os/watch-party-boot.js"]
    entries.append(root / "engine/media/LiveAudioWorklet.js")
    # Worker URLs are runtime module realms, not ES import edges in the page.
    entries.extend(sorted((root / "engine/media/codecs").glob("*Worker.js")))
    graph = ModuleGraph(root)
    for entry in entries:
        graph.walk(entry)
    if graph.errors:
        raise RuntimeError("Watch Party dependency graph is incomplete:\n  " +
                           "\n  ".join(str(error) for error in graph.errors))
    manifest = [(Path(path).resolve().relative_to(root).as_posix(),
                 Path(path).resolve().relative_to(root).as_posix()) for path in graph.order]
    manifest.extend((f"webgpu-os/{name}", f"webgpu-os/{name}") for name in
                    ("watch-party.html", "watch-party.css"))
    # Native HLS imports may resolve from a computed, bundle-safe URL.
    manifest.extend(hls_runtime_asset_manifest(root))
    return manifest


def lay_down_watch_party_runtime_assets(root, site_dir):
    """Ship the independent guest entry and its precise engine/worker closure."""
    root = Path(root).resolve(strict=True)
    site_dir = Path(site_dir).resolve()
    manifest = watch_party_runtime_asset_manifest(root)
    copied = _copy_release_asset_manifest(site_dir, root, manifest)
    validate_watch_party_deployment(site_dir)
    return copied


def validate_watch_party_deployment(site_dir):
    """Validate the standalone guest and worker realms after staging a release."""
    site_dir = Path(site_dir)
    hls_runtime_asset_manifest(site_dir)
    required = ["webgpu-os/watch-party.html", "webgpu-os/watch-party.css"]
    missing = [str(site_dir / name) for name in required if not (site_dir / name).is_file()]
    if missing:
        raise FileNotFoundError("Watch Party deployment assets are missing:\n  " + "\n  ".join(missing))
    entries = ["webgpu-os/watch-party-boot.js", "engine/media/LiveAudioWorklet.js"]
    entries.extend(path.relative_to(site_dir).as_posix() for path in
                   sorted((site_dir / "engine/media/codecs").glob("*Worker.js")))
    if not any(name.endswith("/CodecWorker.js") for name in entries):
        raise FileNotFoundError("Watch Party codec worker is missing from the deployment")
    return _validate_release_module_graph(site_dir, ".", "Watch Party guest", follow_imports=True,
                                          entry_relative_paths=entries)


def lay_down_webgpu_os_pwa_assets(os_src, os_dst):
    """Copy the complete install, icon, recovery, and service-worker contract."""
    os_src = Path(os_src)
    os_dst = Path(os_dst)
    paths = (*_WEBGPU_OS_PWA_FIXED_ASSET_PATHS,
             *_webgpu_os_stable_bootstrap_asset_paths(os_src.parent))
    missing = []
    copied = 0
    for relative_name in paths:
        source = os_src / relative_name
        if not source.is_file():
            missing.append(str(source))
            continue
        destination = os_dst / relative_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied += 1
    if missing:
        raise FileNotFoundError(
            "Required WebGPU OS PWA assets are missing:\n  " + "\n  ".join(missing)
        )
    return copied


def lay_down_webgpu_os_stable_network_resources(root, site_dir):
    """Ship the exact physical ESM graph used by the stable Realm host.

    The same files may also exist inside an immutable replaceable release, but
    this physical copy is rooted outside ``__particle__/release`` so live Realm
    transports can remain owned by the stable top-level document.
    """
    root = Path(root).resolve(strict=True)
    site_dir = Path(site_dir)
    repository_paths = stable_network_resource_repository_paths(root)
    source_inventory = generate_stable_resource_inventory(
        root,
        repository_paths=repository_paths,
    )
    copied = 0
    for relative_name in (
        *repository_paths,
        STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH,
    ):
        source = source_inventory if relative_name == STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH else (
            root / relative_name
        )
        destination = site_dir / relative_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied += 1
    return copied


def lay_down_webgpu_os_host_metadata(os_src, site_dir):
    """Merge host routing and security metadata into the release root."""
    os_src = Path(os_src)
    site_dir = Path(site_dir)
    written = 0
    for name in ("_headers", "_redirects"):
        source = os_src / name
        if not source.is_file():
            raise FileNotFoundError(f"Required WebGPU OS host metadata is missing: {source}")
        incoming = source.read_text(encoding="utf-8").strip()
        destination = site_dir / name
        existing = destination.read_text(encoding="utf-8").strip() if destination.is_file() else ""
        if incoming and incoming not in existing:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(
                (existing + "\n\n" if existing else "") + incoming + "\n",
                encoding="utf-8",
            )
            written += 1
    return written


def lay_down_companion_privacy(os_src, os_dst):
    """Ship the Store-reviewed Companion privacy policy at its stable public URL."""
    os_src = Path(os_src)
    os_dst = Path(os_dst)
    source = os_src / "browser-extension-store" / "privacy.html"
    if not source.is_file():
        raise FileNotFoundError(
            f"Required WebGPU OS Companion privacy policy is missing: {source}"
        )
    destination = os_dst / "companion-privacy.html"
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return 1


def _read_webgpu_os_shell_resource_paths(service_worker_path):
    """Return the service worker's exact, normalized shell-precache paths."""
    service_worker_path = Path(service_worker_path)
    try:
        source = service_worker_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError(
            f"WebGPU OS service worker could not be read: {service_worker_path}: {error}"
        ) from error
    match = re.search(
        r"const\s+SHELL_RESOURCES\s*=\s*\[(.*?)\];",
        source,
        flags=re.DOTALL,
    )
    if match is None:
        raise ValueError(
            f"WebGPU OS service worker has no literal SHELL_RESOURCES registry: {service_worker_path}"
        )
    try:
        resources = ast.literal_eval(f"[{match.group(1)}]")
    except (SyntaxError, ValueError) as error:
        raise ValueError(
            f"WebGPU OS service worker has an invalid SHELL_RESOURCES registry: {service_worker_path}"
        ) from error
    if not resources or not all(isinstance(resource, str) for resource in resources):
        raise ValueError("WebGPU OS SHELL_RESOURCES must contain only path strings")
    if len(resources) != len(set(resources)):
        raise ValueError("WebGPU OS SHELL_RESOURCES contains duplicate paths")
    for resource in resources:
        normalized = PurePosixPath(resource)
        if (
            not resource
            or resource.startswith(("/", "\\"))
            or "\\" in resource
            or "?" in resource
            or "#" in resource
            or normalized.is_absolute()
            or ".." in normalized.parts
            or str(normalized) != resource
        ):
            raise ValueError(
                f"WebGPU OS SHELL_RESOURCES contains an unsafe path: {resource!r}"
            )
    return tuple(resources)


def validate_webgpu_os_deployment(os_dst):
    """Fail the build before a host can turn a missing OS file into HTML."""
    os_dst = Path(os_dst)
    bootstrap_paths = _webgpu_os_stable_bootstrap_asset_paths(ROOT)
    required_paths = (*WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS,
                      *(path for path in bootstrap_paths if path not in WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS))
    missing = [
        str(physical)
        for relative_name in required_paths
        for physical in transport_paths(os_dst / relative_name)
        if not physical.is_file()
    ]
    if missing:
        raise FileNotFoundError(
            "WebGPU OS deployment contract is incomplete:\n  " + "\n  ".join(missing)
        )

    shell_resources = _read_webgpu_os_shell_resource_paths(os_dst / "sw.js")
    canonical_os_src = ROOT / "webgpu-os"
    for relative_name in shell_resources:
        deployed_path = os_dst / relative_name
        if not deployed_path.is_file():
            raise FileNotFoundError(
                f"WebGPU OS shell precache resource is missing: {deployed_path}"
            )
        if relative_name == "index.html":
            # Release launchers intentionally rewrite the source index to boot
            # the verified compressed runtime; its presence is the authority.
            continue
        source_path = canonical_os_src / relative_name
        if not source_path.is_file():
            raise FileNotFoundError(
                f"WebGPU OS shell precache source is missing: {source_path}"
            )
        if deployed_path.read_bytes() != source_path.read_bytes():
            raise ValueError(
                f"WebGPU OS shell precache resource does not match source bytes: {deployed_path}"
            )

    for relative_name in (*bootstrap_paths, "app.html", "app-boot.js", "app.css"):
        if relative_name == "index.html":
            # Static production launchers replace the source launcher while
            # preserving the stable top-level document boundary.
            continue
        deployed_path = os_dst / relative_name
        source_path = canonical_os_src / relative_name
        if relative_name in {"runtime.html", "app.html"}:
            # Installed entry is the canonical source plus the same verified
            # configuration carried by the stable launcher's inert template.
            # Retain exact source checking for unconfigured development trees.
            launcher = (os_dst / "index.html").read_text(encoding="utf-8")
            templates = re.findall(
                rf'<template id="{_WEBGPU_OS_RUNTIME_LOADER_TEMPLATE_ID}">\s*'
                r'(<script\s[^>]*></script>)\s*</template>', launcher,
            )
            if _WEBGPU_OS_RUNTIME_LOADER_TEMPLATE_ID in launcher:
                if len(templates) != 1:
                    raise ValueError("Installed runtime entry requires one canonical loader template")
                expected = _render_webgpu_os_compiled_guest_entry(
                    source_path.read_text(encoding="utf-8"), templates[0],
                    boot_tag=_WEBGPU_OS_APP_BOOT_TAG if relative_name == "app.html" else _WEBGPU_OS_GUEST_BOOT_TAG,
                    stable_theme=relative_name == "runtime.html",
                    loader_template_id=_WEBGPU_OS_APP_LOADER_TEMPLATE_ID if relative_name == "app.html" else None,
                )
                if deployed_path.read_text(encoding="utf-8") != expected:
                    raise ValueError(
                        f"Installed runtime entry does not match canonical compiled configuration: {deployed_path}"
                    )
                continue
        if deployed_path.read_bytes() != source_path.read_bytes():
            raise ValueError(
                f"Stable WebGPU OS bootstrap asset does not match source bytes: {deployed_path}"
            )

    stable_network_paths = stable_network_resource_repository_paths(ROOT)
    expected_inventory = stable_resource_inventory_module_bytes(
        ROOT,
        repository_paths=stable_network_paths,
    )
    source_inventory = ROOT / STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH
    deployed_inventory = os_dst.parent / STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH
    if source_inventory.read_bytes() != expected_inventory:
        raise ValueError(
            "Stable WebGPU OS resource inventory is stale; run "
            "tools/generate_stable_bootstrap_inventory.py"
        )
    if deployed_inventory.read_bytes() != expected_inventory:
        raise ValueError(
            f"Deployed stable WebGPU OS resource inventory is stale: {deployed_inventory}"
        )
    for relative_name in required_paths:
        if not relative_name.endswith((".json", ".webmanifest")):
            continue
        path = os_dst / relative_name
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError(
                f"Invalid JSON in WebGPU OS deployment asset: {path}: {error}"
            ) from error
    _validate_realmforge_source_city_captures(os_dst)
    _validate_release_module_graph(
        os_dst.parent,
        ".",
        "WebGPU OS module workers",
        follow_imports=True,
        entry_relative_paths=RELEASE_MODULE_WORKER_ROOT_PATHS,
        expected_relative_paths=RELEASE_MODULE_WORKER_CLOSURE_PATHS,
    )
    _validate_release_module_graph(
        os_dst.parent,
        ".",
        "WebGPU OS service worker",
        follow_imports=True,
        entry_relative_paths=("webgpu-os/sw.js",),
    )
    validate_watch_party_deployment(os_dst.parent)
    for relative_name in stable_network_paths:
        source_path = ROOT / relative_name
        deployed_path = os_dst.parent / relative_name
        if not deployed_path.is_file():
            raise FileNotFoundError(
                f"Stable Realm host module is missing from the deployment: {deployed_path}"
            )
        if deployed_path.read_bytes() != source_path.read_bytes():
            raise ValueError(
                f"Stable Realm host module does not match source bytes: {deployed_path}"
            )
    engine_demo_root = os_dst / ENGINE_DEMO_RUNTIME_DEPLOYMENT_ROOT
    engine_demo_files = {
        deployed_name: engine_demo_root / deployed_name
        for _, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
    }
    engine_demo_files[ENGINE_DEMO_RUNTIME_KIT_MANIFEST] = (
        engine_demo_root / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
    )
    _validate_engine_demo_runtime_kit(
        engine_demo_files,
        ROOT / "engine" / "sim" / "physics" / "physx-pe.wasm",
    )
    _validate_engine_demo_starter_archive(
        os_dst / ENGINE_DEMO_STARTER_ARCHIVE_PATH,
        engine_demo_root,
    )
    return len(required_paths)


def lay_down_webgpu_os_shell_assets(site_dir, root):
    """Ship absolute and document-relative assets used by the static OS shell."""
    site_dir = Path(site_dir)
    root = Path(root)
    missing = [source for source, _ in WEBGPU_OS_SHELL_ASSET_COPIES if not (root / source).is_file()]
    if missing:
        raise FileNotFoundError("Required Plauna shell assets are missing:\n  " + "\n  ".join(sorted(set(missing))))
    for source, destination in WEBGPU_OS_SHELL_ASSET_COPIES:
        target = site_dir / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / source, target)
    return len(WEBGPU_OS_SHELL_ASSET_COPIES)


_WEBGPU_OS_RELEASE_BOOT_SOURCE = """// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Bind StableBootstrap's empty-registry path to the SRI-verified compiled
// runtime. The release intentionally does not ship the mutable raw kernel
// closure, while installed releases still retain the stable host boundary.
(() => {
  const configured = globalThis.__particleStableBootstrapOptions;
  const runtimeLoaderTemplate = document.getElementById('webgpu-os-compiled-runtime-loader');
  const shellStyleHref = new URL('./style.css', document.currentScript?.src || document.baseURI).href;
  let shellStyleLoad = null;
  let runtimeLoad = null;
  let compiledBoot = null;
  // The compiled override bypasses StableBootstrap's private legacy style
  // loader. Keep the same late ordering after the stable boot/recovery CSS.
  const loadShellStylesheet = () => {
    if (shellStyleLoad) return shellStyleLoad;
    if ([...document.styleSheets].some(sheet => sheet.href === shellStyleHref)) {
      shellStyleLoad = Promise.resolve();
      return shellStyleLoad;
    }
    shellStyleLoad = new Promise((resolve, reject) => {
      const existing = [...document.querySelectorAll('link[rel~="stylesheet"]')]
        .find(link => link.href === shellStyleHref);
      const link = existing || document.createElement('link');
      let timer = null;
      const finish = (error = null) => {
        clearTimeout(timer);
        link.removeEventListener('load', onLoad);
        link.removeEventListener('error', onError);
        if (error) reject(error);
        else resolve();
      };
      const onLoad = () => finish();
      const onError = () => finish(Object.assign(
        new Error(`Current OS stylesheet failed to load: ${shellStyleHref}`),
        { code: 'LEGACY_STYLE_FAILED' }
      ));
      link.addEventListener('load', onLoad, { once: true });
      link.addEventListener('error', onError, { once: true });
      timer = setTimeout(onError, 30_000);
      if (!existing) {
        link.rel = 'stylesheet';
        link.href = shellStyleHref;
        document.head.appendChild(link);
      }
    });
    return shellStyleLoad;
  };
  const loadCompiledRuntime = () => {
    if (runtimeLoad) return runtimeLoad;
    runtimeLoad = new Promise((resolve, reject) => {
      const configuredLoader = runtimeLoaderTemplate?.content?.querySelector('script');
      if (!configuredLoader) {
        reject(new Error('Verified compiled runtime loader configuration is unavailable'));
        return;
      }
      const loader = document.createElement('script');
      for (const attribute of configuredLoader.attributes) {
        loader.setAttribute(attribute.name, attribute.value);
      }
      loader.addEventListener('load', () => {
        const ready = globalThis.__PE_RUNTIME_READY;
        if (!ready?.then) {
          reject(new Error('Verified compiled runtime loader did not publish readiness'));
          return;
        }
        ready.then(resolve, reject);
      }, { once: true });
      loader.addEventListener('error', () => {
        reject(new Error(`Verified compiled runtime loader failed to load: ${loader.src}`));
      }, { once: true });
      document.head.appendChild(loader);
    });
    return runtimeLoad;
  };
  const bootCompiledRuntime = (logger = console, { echoAvatarRuntimeContext = null } = {}) => {
    if (compiledBoot) return compiledBoot;
    compiledBoot = (async () => {
      await loadShellStylesheet();
      const runtime = await loadCompiledRuntime();
      const api = runtime || globalThis.PE || globalThis.ParticleEngine;
      if (!api || typeof api.bootWebGpuOS !== 'function') {
        throw new Error('bootWebGpuOS missing from compiled bundle');
      }
      await api.bootWebGpuOS({ echoAvatarRuntimeContext });
      logger.info?.('[StableBootstrap] Empty install registry; verified compiled runtime started.');
    })().catch((error) => {
      document.documentElement.dataset.webgpuOsBoot = 'bundle-error';
      console.error('[WebGPU OS] compiled bundle boot failed:', error);
      throw error;
    });
    return compiledBoot;
  };
  globalThis.__particleStableBootstrapOptions = {
    ...(configured && typeof configured === 'object' ? configured : {}),
    legacyRuntimeLoader: bootCompiledRuntime
  };
})();
"""

_WEBGPU_OS_STABLE_BOOT_TAG = '<script type="module" src="bootstrap/boot.js"></script>'
_WEBGPU_OS_RUNTIME_LOADER_TEMPLATE_ID = "webgpu-os-compiled-runtime-loader"
_WEBGPU_OS_GUEST_LOADER_ID = "particle-compiled-runtime-entry-loader"
_WEBGPU_OS_GUEST_BOOT_TAG = '<script type="module" src="boot.js"></script>'
_WEBGPU_OS_APP_BOOT_TAG = '<script type="module" src="app-boot.js"></script>'
_WEBGPU_OS_APP_LOADER_TEMPLATE_ID = "particle-app-runtime-loader"


def _render_webgpu_os_compiled_guest_entry(
    html, runtime_loader, *, boot_tag=_WEBGPU_OS_GUEST_BOOT_TAG, stable_theme=True,
    loader_template_id=None,
):
    """Bind an OS guest or app launcher to the same verified runtime.

    The release builder maps runtime.html to a release-qualified logical
    webgpu-os/index.html. All loader bases remain relative to that document,
    never the Blob URL or the mutable physical /webgpu-os/ installation.
    Source runtime.html and app.html remain plain-ES-module entries. App pages
    place the loader in an inert template until their bootstrap chooses the
    isolated demo frame or the user's profile session.
    """
    if (html.count(boot_tag) != 1
            or 'data-particle-compiled-runtime-entry' in html
            or _WEBGPU_OS_GUEST_LOADER_ID in html
            or (loader_template_id and loader_template_id in html)):
        raise ValueError("Installed runtime entry must contain one unconfigured guest boot script")
    html, count = re.subn(
        r"<html(?=[\s>])",
        '<html data-particle-compiled-runtime-entry="verified-v1"',
        html, count=1, flags=re.IGNORECASE,
    )
    if count != 1:
        raise ValueError("Installed runtime entry has no HTML root")
    if not runtime_loader.startswith("<script ") or 'data-runtime-src=' not in runtime_loader:
        raise ValueError("Installed runtime entry requires a configured verified loader")
    # This preference bootstrap is owned by the stable physical installation
    # and deliberately excluded from the signed guest file inventory.
    if stable_theme:
        html = html.replace('<script src="boot-theme.js"></script>',
                            '<script src="/webgpu-os/boot-theme.js"></script>')
    loader = runtime_loader.replace("<script ", f'<script id="{_WEBGPU_OS_GUEST_LOADER_ID}" ', 1)
    if loader_template_id:
        # The app bootstrap selects an isolated demo frame or profile session
        # before activating the shared runtime; outer demo pages stay inert.
        loader = f'<template id="{loader_template_id}">\n{loader}\n</template>'
    return html.replace(boot_tag, loader + "\n    " + boot_tag)


def _write_webgpu_os_compiled_guest_entry(
    destination, runtime_loader, *, boot_tag=_WEBGPU_OS_GUEST_BOOT_TAG, stable_theme=True,
    loader_template_id=None,
):
    destination = Path(destination)
    if not destination.is_file():
        raise FileNotFoundError(f"Required installed runtime entry is missing: {destination}")
    html = _render_webgpu_os_compiled_guest_entry(
        destination.read_text(encoding="utf-8"), runtime_loader, boot_tag=boot_tag, stable_theme=stable_theme,
        loader_template_id=loader_template_id,
    )
    destination.write_text(html, encoding="utf-8")
    return 1


def _bind_compiled_runtime_to_stable_bootstrap(html, runtime_loader, os_build):
    """Install an inert runtime loader before the deferred stable module."""
    if _WEBGPU_OS_STABLE_BOOT_TAG not in html:
        raise ValueError("WebGPU OS compiled launcher requires bootstrap/boot.js")
    runtime_template = (
        f'<template id="{_WEBGPU_OS_RUNTIME_LOADER_TEMPLATE_ID}">\n'
        f"{runtime_loader}\n"
        "</template>"
    )
    compiled_boot = (
        f"{runtime_template}\n"
        f'<script src="./release-boot.js?v={os_build}"></script>\n'
        f"{_WEBGPU_OS_STABLE_BOOT_TAG}"
    )
    return html.replace(_WEBGPU_OS_STABLE_BOOT_TAG, compiled_boot, 1)


def _write_webgpu_os_release_boot(destination):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(_WEBGPU_OS_RELEASE_BOOT_SOURCE, encoding="utf-8")
    return destination


def _write_platform_os_launcher(site_dir, root, bundle_name):
    """Generate site/webgpu-os/index.html that boots the WebGPU OS from the
    compressed platform bundle (../assets/<bundle>.min.js.gz) via
    PE.bootWebGpuOS(),
    mirroring how the editor index.html is generated. Returns files written."""
    os_src = root / "webgpu-os"
    src_index = os_src / "index.html"
    if not src_index.is_file():
        return 0
    os_dst = site_dir / "webgpu-os"
    os_dst.mkdir(parents=True, exist_ok=True)
    written = 0

    # The platform bundle compiles the OS JavaScript, but several OS modules
    # still resolve data, the module worker, and PWA resources by URL. Keep
    # this launcher on the same deployment contract as the standalone OS site;
    # otherwise a static host's SPA fallback returns index.html for these URLs.
    written += lay_down_webgpu_os_stable_network_resources(root, site_dir)
    written += lay_down_webgpu_os_pwa_assets(os_src, os_dst)
    written += lay_down_webgpu_os_host_metadata(os_src, site_dir)
    written += lay_down_companion_privacy(os_src, os_dst)

    runtime_asset_count = lay_down_webgpu_os_runtime_assets(os_src, os_dst)
    written += runtime_asset_count
    written += lay_down_document_runtime_assets(site_dir, root)
    engine_demo_asset_count = lay_down_engine_demo_runtime_assets(root, os_dst)
    written += engine_demo_asset_count

    # Copy the OS shell stylesheet (sibling of index.html).
    css = os_src / "style.css"
    if css.is_file():
        shutil.copy2(css, os_dst / "style.css")
        written += 1

    # Copy the early theme bootstrap classic script. index.html references it via
    # <script src="boot-theme.js">; without shipping it the deployed page 404s and
    # the SPA fallback returns text/html (MIME-refused). Sibling of index.html.
    boot_theme = os_src / "boot-theme.js"
    if boot_theme.is_file():
        shutil.copy2(boot_theme, os_dst / "boot-theme.js")
        written += 1

    written += lay_down_webgpu_os_shell_assets(site_dir, root)

    html = src_index.read_text(encoding="utf-8", errors="replace")
    os_build = str(int(time.time()))
    runtime_sri_path = site_dir / "assets" / f"{bundle_name}.min.js.sri"
    if not runtime_sri_path.is_file():
        runtime_sri_path = root / "tests" / "assets" / f"{bundle_name}.min.js.sri"
    runtime_integrity = _read_bundle_sri(runtime_sri_path)
    runtime_source_path = root / "tests" / "assets" / f"{bundle_name}.min.js"
    if not runtime_source_path.is_file():
        raise FileNotFoundError(
            f"Required compiled platform runtime is missing: {runtime_source_path}"
        )
    runtime_bytes = runtime_source_path.stat().st_size
    runtime_assets = site_dir / "assets"
    runtime_manifest_path = runtime_assets / f"{bundle_name}.manifest.json"
    if not runtime_manifest_path.is_file():
        runtime_assets = root / "tests" / "assets"
        runtime_manifest_path = runtime_assets / f"{bundle_name}.manifest.json"
    runtime_manifest = _strict_json_file(runtime_manifest_path, "platform runtime manifest")
    runtime_parts = compressed_artifact_part_map(runtime_manifest).get(f"{bundle_name}.min.js.gz")
    runtime_payload = read_compressed_artifact(
        runtime_assets, f"{bundle_name}.min.js.gz", runtime_manifest,
        expected_bytes=runtime_manifest.get("browser_runtime_bytes"), prefer_full=False,
    )
    _verify_release_runtime_gzip(runtime_payload, runtime_integrity, runtime_bytes)
    if bundle_name == "particle-platform":
        engine_demo_runtime = (
            os_dst
            / ENGINE_DEMO_RUNTIME_DEPLOYMENT_ROOT
            / "particle-platform.min.js.gz"
        )
        if read_transport_file(engine_demo_runtime) != runtime_payload:
            raise ValueError(
                "Platform and engine-demo compressed runtime bytes are not identical"
            )
    runtime_compressed_bytes = len(runtime_payload)
    runtime_cache_token = _release_runtime_cache_token(runtime_payload, runtime_parts)
    runtime_loader = _release_runtime_loader_tag(
        "./assets/release-runtime-loader.js",
        f"../assets/{bundle_name}.min.js.gz",
        "../assets/",
        runtime_integrity,
        runtime_bytes,
        runtime_compressed_bytes,
        runtime_cache_token,
        os_base="./",
        runtime_parts=runtime_parts,
    )
    _write_release_runtime_loader(os_dst / "assets" / "release-runtime-loader.js")
    _write_webgpu_os_release_boot(os_dst / "release-boot.js")
    html = _bind_compiled_runtime_to_stable_bootstrap(html, runtime_loader, os_build)
    (os_dst / "index.html").write_text(html, encoding="utf-8")
    written += 3 + _write_webgpu_os_compiled_guest_entry(os_dst / "runtime.html", runtime_loader)
    written += _write_webgpu_os_compiled_guest_entry(
        os_dst / "app.html", runtime_loader, boot_tag=_WEBGPU_OS_APP_BOOT_TAG, stable_theme=False,
        loader_template_id=_WEBGPU_OS_APP_LOADER_TEMPLATE_ID,
    )
    validated_count = validate_webgpu_os_deployment(os_dst)
    print("[bundle] WebGPU OS: generated runtime-based index.html (boots from platform bundle)")
    print(
        f"[bundle]   WebGPU OS deployment contract: validated {validated_count} "
        "runtime-reachable file(s)"
    )
    print("[bundle]   Companion privacy: shipped /webgpu-os/companion-privacy.html")
    return written


def lay_down_webgpu_os(site_dir, root, graph, best_ext=".br", bundle_assets_dir=None):
    """Lay the WebGPU OS into an existing site/ directory (does NOT clean it).

    Reusable by both the standalone `webgpu-os` site profile and the `platform`
    site (which nests the OS alongside the editor). Returns files-copied count.

    Strategy (Approach B — apps/mods runtime-fetched):
      * The dev directory layout is PRESERVED so every relative import still
        resolves: site/webgpu-os/ holds the OS, and the exact engine/ + plauna/
        modules it imports (taken from the build's module graph) are copied as
        siblings so "../../engine/..." / "../../plauna/..." paths work.
      * apps/, mods/, packages/, drivers/ ship as raw files — discovered +
        fetched at runtime by AppRegistry/ModRegistry (NOT bundled).
      * WebGPU OS Companion is installed from its verified Chrome Web Store
        listing. Extension source, ZIPs, CRXs, and private signing material are
        never copied into the public WebGPU OS deployment.
      * The OS boots from the gzip-compressed compiled bundle
        (assets/particle-os.min.js.gz) instead of raw ES modules, so deploys do
        NOT depend on every engine/plauna file being individually fetchable.
        The deployed index.html is rewritten to verify, expand, and execute the
        bundle before calling bootWebGpuOS(). Missing or invalid bundles expose
        a visible deployment error; the intentionally incomplete raw tree is
        never booted.
    """
    copied = 0
    os_src = root / "webgpu-os"
    os_dst = site_dir / "webgpu-os"
    if os_dst.exists():
        shutil.rmtree(os_dst)
    shutil.copytree(os_src, os_dst, ignore=shutil.ignore_patterns(
        "*.pem", ".git", "__pycache__", ".pyc", "node_modules",
        ".logs", "tests", "tools", "release", ".trust-keys",
        ".bundled-", ".generated.", "*.min.js",
        # Compiled OS artifacts may exist in the source assets directory after
        # a local build. They are laid down below from tests/assets using the
        # manifest-declared full file or bounded multipart transport. Copying
        # them here would retain stale, oversized monoliths in the public tree.
        *WEBGPU_OS_GENERATED_RUNTIME_ASSET_PATTERNS,
        "kernel", "packages", "storage", "drivers", "factory", "system", "ui", "browser-extension*"
    ))
    copied += sum(1 for _ in os_dst.rglob("*") if _.is_file())
    stable_network_count = lay_down_webgpu_os_stable_network_resources(root, site_dir)
    copied += stable_network_count
    print(
        f"[bundle]   stable Realm host: shipped {stable_network_count} "
        "generated-inventory/module file(s)"
    )
    sidecar_count = lay_down_release_site_sidecar_assets(site_dir, root)
    copied += sidecar_count
    print(
        f"[bundle]   sidecars: shipped and byte-verified {sidecar_count} "
        "worker/JSON/CSS/WASM/image file(s)"
    )
    copied += lay_down_companion_privacy(os_src, os_dst)
    copied += lay_down_webgpu_os_host_metadata(os_src, site_dir)
    copied += lay_down_webgpu_os_shell_assets(site_dir, root)
    runtime_asset_count = lay_down_webgpu_os_runtime_assets(os_src, os_dst)
    copied += runtime_asset_count
    copied += lay_down_document_runtime_assets(site_dir, root)
    print(
        f"[bundle]   WebGPU OS runtime assets: shipped {runtime_asset_count} "
        "worker/catalog file(s)"
    )
    engine_demo_asset_count = lay_down_engine_demo_runtime_assets(root, os_dst)
    copied += engine_demo_asset_count
    print(
        f"[bundle]   Engine demo runtime: shipped {engine_demo_asset_count} "
        "verified platform-kit file(s)"
    )
    print("[bundle]   browser extension: Chrome Web Store distribution (no ZIP/CRX shipped)")
    print("[bundle]   Companion privacy: shipped /webgpu-os/companion-privacy.html")

    # Copy the engine/ + plauna/ modules the OS needs (present in the graph),
    # preserving relative paths as siblings of site/webgpu-os/.
    for filepath in graph.order:
        rel = str(Path(filepath).relative_to(root)).replace("\\", "/")
        if rel.startswith("engine/") or rel.startswith("plauna/"):
            dst = site_dir / rel
            if dst.exists():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(filepath, dst)
            copied += 1

    # Drop the compressed particle-os runtime into site/webgpu-os/assets/.
    # Keep the raw .min.js only in tests/assets as the build/SRI source; omitting
    # it from the public tree keeps every uploaded file below static-host caps.
    assets_dst = os_dst / "assets"
    assets_dst.mkdir(parents=True, exist_ok=True)
    # Production builds must deploy the artifacts created by the current build,
    # not whichever fixture or prior build happens to exist in tests/assets.
    # The default remains useful to focused site-layout tests that do not invoke
    # the compiler first.
    assets_src = Path(bundle_assets_dir) if bundle_assets_dir is not None else root / "tests" / "assets"
    bundle_min = assets_src / "particle-os.min.js"
    have_bundle = bundle_min.is_file()
    bundle_manifest = _strict_json_file(
        assets_src / "particle-os.manifest.json",
        "WebGPU OS bundle manifest",
    )
    verify_official_package_sidecars(bundle_manifest.get("officialPackageAssets", []), assets_src)
    provenance = bundle_manifest.get("provenance") if isinstance(bundle_manifest, dict) else None
    provenance_name = None
    if isinstance(provenance, dict):
        provenance_name = str(provenance.get("path") or "")
        if provenance_name != "particle-os.provenance.json":
            raise ValueError("WebGPU OS bundle manifest has an invalid provenance path")
    for compressed_name in dedupe_preserve_order([
        "particle-os.min.js.gz", f"particle-os.min.js{best_ext}",
    ]):
        copied += _copy_release_compressed_artifact(assets_src, assets_dst, bundle_manifest, compressed_name)
    for fname in dedupe_preserve_order([
        "particle-os.min.js.sri",
        "particle-os.manifest.json",
        *([provenance_name] if provenance_name else []),
        *[item["path"] for item in bundle_manifest.get("officialPackageAssets", [])],
    ]):
        src = assets_src / fname
        if src.is_file():
            (assets_dst / fname).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, assets_dst / fname)
            copied += 1
    verify_official_package_sidecars(bundle_manifest.get("officialPackageAssets", []), assets_dst)
    if provenance_name:
        expected_provenance_sha256 = str(provenance.get("sha256") or "")
        if (
            not re.fullmatch(r"[0-9a-f]{64}", expected_provenance_sha256)
            or _sha256_path(assets_dst / provenance_name) != expected_provenance_sha256
        ):
            raise ValueError("Deployed WebGPU OS provenance SHA-256 is invalid")

    # The raw kernel/factory closure is intentionally absent, so a missing bundle
    # cannot safely fall back to boot.js.
    if not have_bundle:
        raise FileNotFoundError(f"Required compiled WebGPU OS bundle is missing: {bundle_min}")
    runtime_bytes = bundle_min.stat().st_size
    runtime_payload = read_compressed_artifact(
        assets_dst, "particle-os.min.js.gz", bundle_manifest,
        expected_bytes=bundle_manifest.get("browser_runtime_bytes"), prefer_full=False,
    )
    runtime_compressed_bytes = len(runtime_payload)
    runtime_integrity = _read_bundle_sri(assets_dst / "particle-os.min.js.sri")
    _verify_release_runtime_gzip(
        runtime_payload,
        runtime_integrity,
        runtime_bytes,
    )
    _write_release_runtime_loader(assets_dst / "release-runtime-loader.js")
    copied += 1
    copied += _write_webgpu_os_bundle_index(
        os_dst / "index.html",
        runtime_integrity,
        runtime_bytes,
        runtime_compressed_bytes,
        f"sha256:{_sha256_path(bundle_min)}",
        runtime_manifest=bundle_manifest,
    )
    print("[bundle]   OS index.html: boots from verified gzip runtime (assets/particle-os.min.js.gz)")

    # Single-source docs for the OS DocsApp (its iframe resolves /MD/viewer/).
    md_count = _lay_down_md_docs(site_dir, root)
    copied += md_count
    if md_count:
        print(f"[bundle]   docs: shipped MD/ ({md_count} files) for the OS Docs app")

    schema_count = lay_down_morphfield_schemas(site_dir, root)
    copied += schema_count
    print(
        f"[bundle]   MorphField schemas: shipped {schema_count} canonical schema(s) "
        f"at /{MORPHFIELD_SCHEMA_DEPLOYMENT_ROOT.as_posix()}/"
    )

    validated_count = validate_webgpu_os_deployment(os_dst)
    print(
        f"[bundle]   WebGPU OS deployment contract: validated {validated_count} "
        "runtime-reachable file(s)"
    )
    return copied


def _write_webgpu_os_bundle_index(
    index_path,
    runtime_integrity,
    runtime_bytes,
    runtime_compressed_bytes,
    executor_source_hash,
    runtime_manifest=None,
):
    """Rewrite a deployed WebGPU OS index.html so it boots from the compiled
    particle-os bundle instead of raw ES modules (boot.js)."""
    if not index_path.is_file():
        return 0
    html = index_path.read_text(encoding="utf-8", errors="replace")
    os_build = str(int(time.time()))
    runtime_assets = index_path.parent / "assets"
    if runtime_manifest is None:
        manifest_path = runtime_assets / "particle-os.manifest.json"
        runtime_manifest = _strict_json_file(manifest_path, "WebGPU OS runtime manifest") if manifest_path.is_file() else {}
    runtime_parts = compressed_artifact_part_map(runtime_manifest).get("particle-os.min.js.gz")
    runtime_payload = read_compressed_artifact(
        runtime_assets, "particle-os.min.js.gz", runtime_manifest,
        expected_bytes=runtime_compressed_bytes, prefer_full=False,
    )
    _verify_release_runtime_gzip(runtime_payload, runtime_integrity, runtime_bytes)
    runtime_cache_token = _release_runtime_cache_token(runtime_payload, runtime_parts)
    runtime_loader = _release_runtime_loader_tag(
        "./assets/release-runtime-loader.js",
        "./assets/particle-os.min.js.gz",
        "./assets/",
        runtime_integrity,
        runtime_bytes,
        runtime_compressed_bytes,
        runtime_cache_token,
        os_base="./",
        executor_source_hash=executor_source_hash,
        runtime_parts=runtime_parts,
    )
    _write_webgpu_os_release_boot(index_path.parent / "release-boot.js")
    html = _bind_compiled_runtime_to_stable_bootstrap(html, runtime_loader, os_build)
    index_path.write_text(html, encoding="utf-8")
    written = 2 + _write_webgpu_os_compiled_guest_entry(index_path.parent / "runtime.html", runtime_loader)
    return written + _write_webgpu_os_compiled_guest_entry(
        index_path.parent / "app.html", runtime_loader, boot_tag=_WEBGPU_OS_APP_BOOT_TAG, stable_theme=False,
        loader_template_id=_WEBGPU_OS_APP_LOADER_TEMPLATE_ID,
    )


def copy_webgpu_os_site(
    root,
    release_dir,
    graph,
    bundle_name="particle-os",
    best_ext=".br",
    bundle_assets_dir=None,
):
    """Build a self-contained WebGPU OS deploy under release/site/ (cleans first)."""
    site_dir = release_dir / ".staging" / "site"
    if site_dir.exists():
        shutil.rmtree(site_dir)
    site_dir.mkdir(parents=True, exist_ok=True)
    copied = lay_down_webgpu_os(
        site_dir,
        root,
        graph,
        best_ext,
        bundle_assets_dir=bundle_assets_dir,
    )
    capped_file_count, largest_file_bytes = _validate_static_site_file_cap(site_dir)
    print(
        f"[bundle]   static-host cap: verified {capped_file_count} file(s); "
        f"largest {largest_file_bytes:,} bytes"
    )

    # Publish the staged site while retaining a recoverable previous version.
    final_dir = release_dir / "site"
    site_dir = _publish_staged_site(site_dir, final_dir)

    total = sum(f.stat().st_size for f in site_dir.rglob("*") if f.is_file())
    return copied, total


WEBGPU_OS_BARREL_REL = "webgpu-os/.bundled-os-content.generated.js"

def read_webgpu_os_indexed_manifests(root, kind="apps"):
    """Read canonical indexed app/mod manifests with the existing build checks."""
    root = Path(root).resolve()
    os_dir = root / "webgpu-os"
    if kind not in {"apps", "mods"}:
        raise ValueError(f"Unknown WebGPU OS content kind: {kind!r}")
    def _load_index(kind):
        container = os_dir / kind
        index_path = container / "index.json"
        if not index_path.is_file():
            raise FileNotFoundError(f"Required WebGPU OS {kind} index is missing: {index_path}")
        data = _strict_json_file(index_path, f"WebGPU OS {kind} index")
        if not isinstance(data, list):
            raise ValueError(f"WebGPU OS {kind} index must be a JSON array")
        folders = []
        seen_folders = set()
        for position, folder in enumerate(data):
            if not isinstance(folder, str) or not folder:
                raise ValueError(f"WebGPU OS {kind} index entry {position} must be a folder name")
            normalized = _safe_release_relative_path(folder, f"WebGPU OS {kind} folder")
            if len(normalized.parts) != 1:
                raise ValueError(f"WebGPU OS {kind} folder must be one path segment: {folder!r}")
            if folder in seen_folders:
                raise ValueError(f"WebGPU OS {kind} index repeats folder {folder!r}")
            seen_folders.add(folder)
            folders.append(folder)

        manifest_folders = {
            path.parent.name
            for path in container.glob("*/manifest.json")
            if path.is_file()
        }
        missing = sorted(set(folders) - manifest_folders)
        unindexed = sorted(manifest_folders - set(folders))
        if missing or unindexed:
            raise RuntimeError(
                f"WebGPU OS {kind} index/manifest mismatch: "
                f"missing={missing}, unindexed={unindexed}"
            )
        return folders

    id_field = "appId" if kind == "apps" else "modId"
    seen_ids = set()
    records = []
    for folder in _load_index(kind):
        manifest_path = os_dir / kind / folder / "manifest.json"
        manifest = _strict_json_file(manifest_path, f"WebGPU OS {kind}/{folder} manifest")
        if not isinstance(manifest, dict):
            raise ValueError(f"WebGPU OS {kind}/{folder} manifest must be an object")
        entry = manifest.get("entry")
        identity = manifest.get(id_field)
        if not isinstance(identity, str) or not identity:
            raise ValueError(
                f"WebGPU OS {kind}/{folder} manifest requires a non-empty {id_field}"
            )
        if identity in seen_ids:
            raise ValueError(f"WebGPU OS {kind} duplicate {id_field}: {identity!r}")
        seen_ids.add(identity)
        if not isinstance(entry, str) or not entry:
            raise ValueError(
                f"WebGPU OS {kind}/{folder} manifest requires a non-empty entry"
            )
        normalized_entry = entry[2:] if entry.startswith("./") else entry
        entry_path = _safe_release_relative_path(
            normalized_entry,
            f"WebGPU OS {kind}/{folder} entry",
        )
        if entry_path.suffix not in {".js", ".mjs"}:
            raise ValueError(
                f"WebGPU OS {kind}/{folder} entry must be JavaScript: {entry!r}"
            )
        folder_root = (os_dir / kind / folder).resolve()
        target = folder_root.joinpath(*entry_path.parts).resolve()
        try:
            target.relative_to(folder_root)
        except ValueError as error:
            raise ValueError(
                f"WebGPU OS {kind}/{folder} entry escapes its folder: {entry!r}"
            ) from error
        if not target.is_file():
            raise FileNotFoundError(
                f"WebGPU OS {kind}/{folder} manifest entry is stale: {entry!r}"
            )
        records.append((folder, manifest, entry_path))
    return records


def render_webgpu_os_app_barrel(root):
    """Render an in-memory barrel for every WebGPU OS app and mod.

    App entries use dynamic-import thunks. The graph still compiles their full
    dependency closures into the verified runtime, but boot evaluates none of
    those entry modules until AppRegistry resolves the first launch. Mods remain
    eager because their patches must be installed before the desktop mounts.
    Each manifest is inlined and registered onto globals the registries read at
    boot. The caller supplies the returned source to the dependency graph at
    ``WEBGPU_OS_BARREL_REL`` without creating a shared temporary file, so
    concurrent builds cannot delete one another's entry. Returns the source
    text or None if there is nothing to bundle.
    """
    root = Path(root).resolve()
    os_dir = root / "webgpu-os"

    imports, app_regs, mod_regs = [], [], []
    idx = 0
    for kind, registrations in (("apps", app_regs), ("mods", mod_regs)):
        for folder, manifest, entry_path in read_webgpu_os_indexed_manifests(root, kind):
            imp = f"./{kind}/{folder}/{entry_path.as_posix()}"
            if kind == "apps":
                registrations.append(
                    f"A[{json.dumps(folder)}] = {{ folder: {json.dumps(folder)}, "
                    f"manifest: {json.dumps(manifest)}, load: () => import({json.dumps(imp)}) }};"
                )
            else:
                var = f"__os_{kind[:-1]}_{idx}"
                idx += 1
                imports.append(f"import * as {var} from {json.dumps(imp)};")
                registrations.append(
                    f"M[{json.dumps(folder)}] = {{ folder: {json.dumps(folder)}, "
                    f"manifest: {json.dumps(manifest)}, module: {var} }};"
                )

    if not app_regs and not mod_regs:
        return None

    body = [
        "// AUTO-GENERATED by bundle_engine.py — DO NOT EDIT / COMMIT.",
        "// App graphs are compiled in but entry evaluation is deferred until launch.",
        "// Mod entries stay eager because their patches precede desktop mount.",
        "",
        *imports,
        "",
        "const A = (globalThis.__OS_BUNDLED_APPS__ = globalThis.__OS_BUNDLED_APPS__ || {});",
        *app_regs,
        "globalThis.__OS_BUNDLED_APPS_COMPLETE__ = true;",
        "const M = (globalThis.__OS_BUNDLED_MODS__ = globalThis.__OS_BUNDLED_MODS__ || {});",
        *mod_regs,
        "",
    ]
    source = "\n".join(body)
    print(
        f"[bundle]   compiled-in OS content: {len(app_regs)} lazy app entries, "
        f"{len(mod_regs)} eager mods"
    )
    return source


# ---- System Source Tree Barrel ----------------------------------------------

SYSTEM_SOURCE_BARREL_REL = "webgpu-os/.bundled-source-tree.generated.js"
SYSTEM_SOURCE_INCLUDE_DIRS = ["engine", "webgpu-os", "agi", "plauna", "editor"]
SYSTEM_SOURCE_EXTENSIONS  = {".js", ".json", ".wgsl", ".glsl", ".css", ".html", ".md"}
SYSTEM_SOURCE_SKIP        = ["node_modules", "__pycache__", ".git",
                              ".bundled-", ".generated.", ".min.js",
                              "release/", "tests/assets/",
                              ".trust-keys", ".pem"]  # never embed PRIVATE trust keys
SYSTEM_SOURCE_MAX_BYTES   = 200_000   # skip files larger than 200 KB


def generate_system_source_barrel(root, include_dirs=None):
    """Walk the OS source directories and return a self-contained JS IIFE
    string that assigns every source file into globalThis.__OS_SOURCE_FILES__.

    The caller splices this preamble DIRECTLY into the bundle text (before
    the module registry IIFE) so the global is set before ANY module runs,
    regardless of require() ordering.  No temp file is written and the content
    never passes through the import/export regex rewriter.

    Returns the JS preamble string, or None if no files were found.
    """
    dirs = include_dirs or SYSTEM_SOURCE_INCLUDE_DIRS
    file_entries = {}    # relPath -> text content

    for dir_name in dirs:
        dir_path = root / dir_name
        if not dir_path.is_dir():
            continue
        for fp in sorted(dir_path.rglob("*")):
            if not fp.is_file():
                continue
            if fp.suffix.lower() not in SYSTEM_SOURCE_EXTENSIONS:
                continue
            rel = str(fp.relative_to(root)).replace("\\", "/")
            if any(skip in rel for skip in SYSTEM_SOURCE_SKIP):
                continue
            try:
                size = fp.stat().st_size
                if size > SYSTEM_SOURCE_MAX_BYTES:
                    continue
                file_entries[rel] = fp.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass

    if not file_entries:
        return None

    lines = [
        "// OS source tree — AUTO-GENERATED by bundle_engine.py",
        "(function(){",
        "var __sf=(globalThis.__OS_SOURCE_FILES__={});",
    ]
    for path in sorted(file_entries):
        lines.append(f"__sf[{json.dumps(path)}]={json.dumps(file_entries[path])};")
    lines.append("}());")

    total_bytes = sum(len(v.encode("utf-8")) for v in file_entries.values())
    print(f"[bundle]   compiled-in source tree: {len(file_entries)} files ({total_bytes:,} bytes)")
    return "\n".join(lines)
