// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Execute an inventoried Markdown example and check its real public behavior. */
export async function runSdkDocSnippet(record, { rootUrl } = {}) {
    const expected = {
        'engine-source': ['source', 'engine'],
        'engine-compiled': ['compiled', 'engine'],
        'plauna-source': ['source', 'plauna'],
    }[record?.id];
    if (!expected || record.mode !== expected[0] || record.kind !== expected[1]) {
        throw new Error('Unknown SDK documentation example');
    }
    const root = new URL(rootUrl);
    if (root.origin !== location.origin || !root.pathname.endsWith('/') || root.search || root.hash) {
        throw new Error('Documentation examples require a same-origin SDK directory URL');
    }
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.code)))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== record.sha256) throw new Error('Documentation example bytes do not match their receipt');
    const report = { name: record.id, mode: record.mode, status: 'RUNNING', checks: [],
        source: { path: record.path, line: record.line, sha256: hash } };
    const check = (name, passed, detail = null) => {
        report.checks.push({ name, passed: !!passed, detail });
        if (!passed) throw new Error(name);
    };
    const base = document.createElement('base');
    base.href = root.href;
    document.head.prepend(base);
    const names = record.kind === 'engine' ? 'Engine, world, entity, cleanup' : 'app, root, menu, label, button, cleanup';
    const url = URL.createObjectURL(new Blob([record.code, `\nexport { ${names} };\n`], { type: 'text/javascript' }));
    let example;
    console.info('[SDK docs] start', record.id, hash);
    try {
        example = await import(url);
        if (record.kind === 'engine') {
            const position = example.Engine.getEntityComponent(example.world, example.entity, 'Transform')?.position;
            check('Public ECS API retains the authored transform', position?.length === 3 && position[0] === 0 && position[1] === 2 && position[2] === 0);
        } else {
            const button = example.app.domRenderer.getDOMElement(example.button);
            const label = example.app.domRenderer.getDOMElement(example.label);
            check('Retained Panel contains labeled Text and a real Button', example.root.contains(button)
                && example.root.contains(label) && button instanceof HTMLButtonElement && label.textContent === 'Particle Realms');
            button.scrollIntoView({ block: 'center', inline: 'nearest' });
            await new Promise(requestAnimationFrame);
            const bounds = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            check('Rendered Button is visible and at least 24 pixels high', bounds.height >= 24 && bounds.width >= 24
                && style.visibility === 'visible' && Number(style.opacity) > 0
                && (hit === button || button.contains(hit)), { width: bounds.width, height: bounds.height });
            button.click();
            check('Native click updates Plauna state and visible content', example.app.stateStore.get('clicks') === 1 && button.textContent === 'Count: 1');
        }
    } catch (error) {
        report.error = String(error?.stack || error);
    } finally {
        if (example) {
            try {
                await example.cleanup();
                await example.cleanup();
                if (record.kind === 'engine') {
                    check('Repeated cleanup removes the entity component', example.Engine.getEntityComponent(example.world, example.entity, 'Transform') === null);
                } else {
                    check('Repeated cleanup releases the owned app, tree and DOM', !example.app.initialized
                        && example.app.stateStore.destroyed && !example.app.visualTree.root && !example.root.isConnected);
                }
                report.cleanup = { status: 'passed', idempotent: true };
            } catch (error) {
                report.cleanup = { status: 'failed', error: String(error?.stack || error) };
                report.error ||= report.cleanup.error;
            }
        } else {
            report.cleanup = { status: 'not_run', reason: 'The documentation module did not finish initialization' };
        }
        URL.revokeObjectURL(url);
        base.remove();
    }
    report.status = report.error ? 'FAIL' : 'PASS';
    console.info('[SDK docs] complete', record.id, report.status);
    return report;
}

globalThis.runSdkDocSnippet = runSdkDocSnippet;
