// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * probe-scanner.js — statically detect what a guest app uses.
 *
 * Combines the parsed DOM model with a regex scan of all script source to infer
 * the `uses`, `dom`, and `gpu` sections of a compatibility profile. This is a
 * heuristic pass (static, no execution) — the healing + interposition layers
 * refine it at runtime and the profile cache promotes it once it boots.
 */

/**
 * @param {object} model — from parseHTML()
 * @param {Map<string,string|Uint8Array>} [files] — bundled file map. When given,
 *   the static scan also reads bundled JS/TS modules (not just inline scripts),
 *   so multi-file apps get an accurate `uses`/`gpu`/permissions profile.
 * @returns {{ uses:object, dom:object, gpu:object }}
 */
export function scanSource(model, files = null) {
    const parts = (model?.scripts ?? []).map(s => s.code || '');
    if (files && typeof files.forEach === 'function') {
        for (const [rel, content] of files) {
            if (!/\.(m?js|jsx|ts|tsx|wgsl|glsl)$/i.test(rel)) continue;
            parts.push(typeof content === 'string' ? content : _decode(content));
        }
    }
    const code = parts.join('\n');

    const has = (re) => re.test(code);

    const uses = {
        webgpu:         has(/navigator\.gpu|requestAdapter|getContext\(\s*["'`]webgpu/),
        canvas2d:       has(/getContext\(\s*["'`]2d/),
        webgl:          has(/getContext\(\s*["'`]webgl/),
        raf:            has(/requestAnimationFrame/),
        keyboard:       has(/addEventListener\(\s*["'`](keydown|keyup|keypress)/),
        pointer:        has(/addEventListener\(\s*["'`](pointer|mouse|click|wheel|touch)/),
        fileImport:     has(/type\s*=\s*["'`]file["'`]|\.files\b|FileReader|showOpenFilePicker|drop\b/),
        fileExport:     has(/createObjectURL|download\b|showSaveFilePicker|toBlob|toDataURL/),
        localStorage:   has(/localStorage|sessionStorage/),
        indexedDB:      has(/indexedDB/),
        workers:        has(/new\s+Worker|new\s+SharedWorker/),
        wasm:           has(/WebAssembly|\.wasm\b/),
        dynamicImports: has(/\bimport\s*\(/),
        fetch:          has(/\bfetch\s*\(|XMLHttpRequest/),
        audio:          has(/AudioContext|webkitAudioContext/),
        webrtc:         has(/RTCPeerConnection|getUserMedia/),
        getUserMedia:   has(/getUserMedia|getDisplayMedia/),
        screenCapture:  has(/getDisplayMedia/),
        geolocation:    has(/navigator\.geolocation|geolocation\.(getCurrentPosition|watchPosition)/),
        clipboard:      has(/navigator\.clipboard|ClipboardItem|execCommand\(\s*["'`](copy|cut|paste)/),
        notifications:  has(/new\s+Notification\b|Notification\.requestPermission/),
        modules:        (model?.scripts ?? []).some(s => s.module),
        // JS-driven navigation: window.open popups + programmatic redirects.
        // (target=_blank anchors are handled by the DOM click-capture, no shim.)
        windowOpen:     has(/window\.open\s*\(|window\.location\s*=|\blocation\.(href\s*=|assign\s*\(|replace\s*\()/),
        webgl2:         has(/getContext\(\s*["'`]webgl2/),
        offscreenCanvas: has(/OffscreenCanvas|transferControlToOffscreen/),
        websocket:      has(/new\s+WebSocket|EventSource/),
        worklet:        has(/audioWorklet|\.addModule\s*\(|registerProcessor/),
        // FX bridge: app drives the desktop ambient glow via os.fx.publish(...).
        fxPublish:      has(/\bos\.fx\b|fx\.publish\s*\(/),
        // Relative/bundled imports that need blob-URL linking (multi-file ESM).
        bundledImports: has(/\b(?:import|export)\b[^;]*?from\s*["'`]\.{0,2}\//) || has(/\bimport\s*\(\s*["'`]\.{0,2}\//),
    };

    const requiredElements = (model?.canvases ?? [])
        .filter(c => c.id)
        .map(c => ({ tag: 'canvas', id: c.id, width: c.width ?? undefined, height: c.height ?? undefined }));
    // Also capture ids referenced via getElementById that are present in the DOM.
    const refIds = new Set();
    for (const m of code.matchAll(/getElementById\(\s*["'`]([\w-]+)["'`]/g)) refIds.add(m[1]);
    for (const m of code.matchAll(/querySelector\(\s*["'`]#([\w-]+)["'`]/g)) refIds.add(m[1]);
    for (const id of refIds) {
        if (requiredElements.some(e => e.id === id)) continue;
        const el = model?.doc?.getElementById?.(id);
        if (el) requiredElements.push({ tag: el.tagName.toLowerCase(), id });
    }

    const gpu = {
        requestsDevice:      has(/requestDevice/),
        usesCompute:         has(/createComputePipeline|computePass|dispatchWorkgroups/),
        usesRenderPipelines: has(/createRenderPipeline|beginRenderPass/),
        usesStorageBuffers:  has(/GPUBufferUsage\.STORAGE|usage:\s*[^,\n]*STORAGE|var<storage/),
        usesCopySrc:         has(/COPY_SRC|copyTextureToBuffer|copyBufferToBuffer/),
        usesTimestamp:       has(/timestamp-query|writeTimestamp/),
        presentation:        uses.webgpu ? 'webgpu-canvas' : (uses.canvas2d ? 'canvas-2d' : 'none'),
    };

    return {
        uses,
        dom: { requiredElements },
        gpu,
    };
}

function _decode(bytes) {
    try { return new TextDecoder().decode(bytes); } catch { return ''; }
}
