// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { resolveModule } from './resolver.js';

globalThis.runPublicSdkSuite = async suite => {
    if (!suite.eligible || !Array.isArray(suite.requiredModules) || !suite.requiredModules.length)
        throw new Error('A required SDK suite has no admitted module inventory');
    for (const path of suite.requiredModules) await resolveModule(path);
    const mode = new URL(location.href).searchParams.get('mode');
    const fixture = suite.fixture.replace('{mode}', mode);
    if (!/^fixtures\/[\w-]+\.js$/.test(fixture)) throw new Error('Invalid fixture identity');
    console.info('[SDK CPU tests] start', suite.id, mode);
    const before = document.querySelector('#root').childElementCount;
    const previousShaderStage = globalThis.GPUShaderStage;
    const previousBufferUsage = globalThis.GPUBufferUsage;
    try {
        const module = await import(new URL(fixture, import.meta.url));
        if (suite.id === 'plauna-button') return { status: 'READY' };
        const result = module.suiteResult;
        if (!result) throw new Error('SDK test fixture produced no structured cases');
        if (document.querySelector('#root').childElementCount !== before)
            throw new Error('SDK suite retained owned DOM nodes');
        console.info('[SDK CPU tests] complete', suite.id, result.status);
        return result;
    } finally {
        if (previousShaderStage === undefined) delete globalThis.GPUShaderStage;
        if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage;
    }
};
