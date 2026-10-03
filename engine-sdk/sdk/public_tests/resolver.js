// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Resolve test modules through one explicitly selected public runtime contract. */
export const sdkRoot = new URL('../../', import.meta.url);
const mode = new URL(location.href).searchParams.get('mode');
if (!['source', 'compiled'].includes(mode)) throw new Error('An explicit source or compiled test mode is required');
let readiness;

export function sourceUrl(path) {
    if (typeof path !== 'string' || !/^(engine|plauna)\/[\w./-]+\.js$/.test(path)
        || path.split('/').includes('..')) throw new Error('Unsafe SDK module identity: ' + path);
    return new URL(path, sdkRoot).href;
}

export async function compiledRuntime() {
    if (mode !== 'compiled') throw new Error('A source test attempted to load the compiled runtime');
    if (!readiness) readiness = (async () => {
        const response = await fetch(new URL('manifest.json', sdkRoot));
        if (!response.ok) throw new Error('SDK receipt unavailable');
        const receipt = await response.json();
        const bundle = receipt.bundle;
        if (receipt.profile !== 'engine' || bundle.include_plauna !== true)
            throw new Error('The CPU test profile requires the Engine + Plauna runtime');
        // Reuse the publisher's exact transport contract, including real cache
        // tokens, multipart metadata and executor identity. This avoids a second
        // independently maintained loader-tag generator in the test harness.
        const pageUrl = new URL('examples/compiled.html', sdkRoot);
        const htmlResponse = await fetch(pageUrl);
        if (!htmlResponse.ok) throw new Error('Declared compiled SDK page unavailable');
        const html = new DOMParser().parseFromString(await htmlResponse.text(), 'text/html');
        const tags = html.querySelectorAll('script[data-runtime-src]');
        if (tags.length !== 1) throw new Error('Declared compiled SDK loader is ambiguous');
        const declared = tags[0];
        if (declared.dataset.integrity !== bundle.browser_runtime_integrity
            || Number(declared.dataset.runtimeBytes) !== bundle.browser_runtime_decoded_bytes
            || Number(declared.dataset.runtimeCompressedBytes) !== bundle.browser_runtime_bytes)
            throw new Error('Declared loader differs from the SDK runtime receipt');
        const script = document.createElement('script');
        script.src = new URL(declared.getAttribute('src'), pageUrl).href;
        Object.assign(script.dataset, declared.dataset);
        for (const key of ['runtimeSrc', 'assetBase', 'runtimeBase', 'osBase'])
            if (script.dataset[key]) script.dataset[key] = new URL(script.dataset[key], pageUrl).href;
        if (script.dataset.runtimeParts) script.dataset.runtimeParts = JSON.stringify(
            JSON.parse(script.dataset.runtimeParts).map(part => ({...part, src:new URL(part.src, pageUrl).href})));
        if (!script.src.startsWith(new URL('dist/', sdkRoot).href)
            || !script.dataset.runtimeSrc.startsWith(new URL('dist/', sdkRoot).href))
            throw new Error('Declared runtime transport escapes the SDK dist directory');
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => reject(new Error('Verified SDK loader did not load'));
            document.head.append(script);
        });
        const api = await globalThis.__PE_RUNTIME_READY;
        if (!api || api !== globalThis.PE || typeof api.requireModule !== 'function')
            throw new Error('Compiled PE.requireModule contract is missing');
        return api;
    })();
    return readiness;
}

export function validateCompiledExports(exports, path, expected = []) {
    if (!exports || typeof exports !== 'object') throw new Error('Missing compiled SDK module: ' + path);
    for (const name of expected) if (!Object.hasOwn(exports, name) || exports[name] === undefined)
        throw new Error('Missing compiled SDK export: ' + path + ':' + name);
    return exports;
}

export async function resolveModule(path, expected = []) {
    const url = sourceUrl(path);
    if (mode === 'source') return import(url);
    const api = await compiledRuntime();
    const exports = api.requireModule(path);
    return validateCompiledExports(exports, path, expected);
}

export function finishSuite(identity, rows) {
    const cases = rows.map(row => ({ id: identity + ':' + row.name, name: row.name,
        status: row.status ?? (row.passed === true ? 'PASS' : 'FAIL'), error: row.error ?? null,
        evidence: row.evidence ?? 'CPU/DOM assertions', detail: row.detail ?? null,
        checks: row.status === 'NOT_RUN' ? [] : [{ name: 'Existing assertion body completed', passed: row.passed === true }] }));
    const passed = cases.length > 0 && cases.every(row => row.status === 'PASS');
    return { id: identity, mode, status: passed ? 'PASS' : 'FAIL', cases,
        cleanup: { status: passed ? 'passed' : 'not_confirmed',
            scope: 'Existing teardown assertions completed; browser context disposal is checked separately' } };
}
