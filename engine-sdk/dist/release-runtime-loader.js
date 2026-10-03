// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
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
            /[\s\\]/.test(src) || src.includes('#') || /%(?:0[0-9a-f]|1[0-9a-f]|7f|2f|5c|25)/i.test(src)) {
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
