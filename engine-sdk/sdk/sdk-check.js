// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const profile = document.documentElement.dataset.sdkProfile;
const element = document.querySelector('#sdk-check');
const receipt = globalThis.__SDK_CHECK_RESULT__ = { status: 'running', profile, checks: [] };
try {
    const response = await fetch(new URL('manifest.json', document.baseURI));
    if (!response.ok) throw new Error(`SDK receipt HTTP ${response.status}`);
    const manifest = await response.json();
    if (!manifest.files || !manifest.bundle) throw new Error('SDK inventory is unavailable');
    const namespaces = (manifest.bundle.public_namespaces || []).map(name => name.replace(/^PE\./, ''));
    for (const item of document.querySelectorAll('[data-sdk-requires]')) {
        item.hidden = !namespaces.includes(item.dataset.sdkRequires);
    }
    receipt.checks.push({ name: 'Package inventory', passed: true, detail: { files: Object.keys(manifest.files).length } });
    if (!globalThis.__PE_RUNTIME_READY) throw new Error('Verified runtime loader did not publish its ready promise');
    const runtime = await globalThis.__PE_RUNTIME_READY;
    const required = ['createWorld', 'createEntity', 'renderEntities', 'createUnitCubeMesh'];
    for (const name of required) {
        if (typeof runtime[name] !== 'function') throw new Error(`Missing public Engine export: ${name}`);
    }
    receipt.checks.push({ name: 'Public Engine runtime exports', passed: true, detail: required });
    if (namespaces.length) {
        for (const name of namespaces) {
            if (!runtime[name] || typeof runtime[name] !== 'object') throw new Error(`Missing SDK public namespace: ${name}`);
        }
        receipt.checks.push({ name: 'Public SDK namespaces', passed: true, detail: namespaces });
    }
    if (namespaces.includes('Plauna')) {
        const requiredUI = ['createPlaunaApp', 'Button'];
        for (const name of requiredUI) {
            if (typeof runtime.Plauna[name] !== 'function') throw new Error(`Missing public Plauna export: ${name}`);
        }
        receipt.checks.push({ name: 'Public Plauna UI exports', passed: true, detail: requiredUI });
    }
    receipt.status = 'passed';
} catch (error) {
    receipt.status = 'failed';
    receipt.error = { name: error.name, message: error.message };
    element.setAttribute('role', 'alert');
    console.error('[SDK check]', error);
}
element.textContent = JSON.stringify(receipt, null, 2);
