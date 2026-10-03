// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Run as a classic script before source modules, including in the OS frame.
// Anchor to this delivered helper so application paths cannot move the SDK root.
(() => {
    const sdkRoot = new URL('../', document.currentScript.src);
    const imports = Object.fromEntries(['engine', 'editor', 'plauna', 'agi', 'webgpu-os']
        .map(name => [`/${name}/`, new URL(`${name}/`, sdkRoot).href]));
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports });
    document.currentScript.after(map);
    console.debug('[SDK source imports] Canonical namespaces:', sdkRoot.href);
})();
