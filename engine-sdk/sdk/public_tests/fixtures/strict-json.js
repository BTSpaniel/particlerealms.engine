// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';
const current = await resolveModule("engine/core/schema/StrictJsonValue.js");

const assert = (value, message) => { if (!value) throw new Error(message); };
const errorOf = operation => {
    try { operation(); return null; }
    catch (error) { return { name: error.name, message: error.message }; }
};
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const objectWith = (key, descriptor) => Object.defineProperty({}, key, descriptor);

/** CPU-only boundary checks; optionally compare an independently preserved
 * module's values and exact rejection paths against the current module. */
export function runStrictJsonValueChecks(baseline = null) {
    const rows = [];
    const check = (name, operation) => {
        try { rows.push({ name, status: 'PASS', detail: operation() }); }
        catch (error) { rows.push({ name, status: 'FAIL', error: error.stack || error.message }); }
    };
    check('Certified descendants still produce fresh independent mutable and frozen clones', () => {
        const child = current.cloneAndFreezeStrictJson({ vector: [1, -0, Number.MAX_VALUE], nested: { x: true } });
        const source = { first: child, second: child };
        for (let i = 0; i < 4; i++) {
            const mutable = current.cloneStrictJson(source), frozen = current.cloneAndFreezeStrictJson(source);
            for (const copy of [mutable, frozen]) {
                assert(copy.first !== child && copy.first !== copy.second, 'DAG descendants were shared');
                assert(copy.first.vector !== child.vector && copy.first.vector !== copy.second.vector, 'Array descendants were shared');
                assert(Object.is(copy.first.vector[1], -0), 'Negative zero changed');
                assert(equal(copy, source), 'Clone values changed');
            }
            mutable.first.vector[0] = 9; mutable.first.nested.x = false;
            assert(child.vector[0] === 1 && child.nested.x && mutable.second.vector[0] === 1, 'Mutable clone retained ownership');
            assert(!Object.isFrozen(mutable.first) && !Object.isFrozen(mutable.first.vector), 'Mutable clone was frozen');
            assert(Object.isFrozen(frozen.first) && Object.isFrozen(frozen.first.vector), 'Frozen clone retained a mutable descendant');
        }
    });
    check('Array descriptor results remain detached wrappers with exact frozen flags', () => {
        const source = current.cloneAndFreezeStrictJson([{ x: 1 }, 2]);
        current.cloneStrictJson(source);
        const first = current.strictJsonArrayDescriptors(source);
        first[0].value = 42; first[0].writable = true; first.push({ value: 99 });
        const second = current.strictJsonArrayDescriptors(source);
        assert(second.length === 2 && second[0].value === source[0], 'Caller mutated retained descriptor metadata');
        assert(equal(second, [Object.getOwnPropertyDescriptor(source, '0'), Object.getOwnPropertyDescriptor(source, '1')]), 'Descriptor flags or values changed');
    });
    check('Raw and manually frozen hostile inputs retain exact rejection and accessor behavior', () => {
        let reads = 0;
        const getter = { enumerable: true, get() { reads++; return 1; } };
        const factories = [
            () => NaN, () => Infinity, () => undefined, () => 1n, () => Symbol('value'), () => () => 1,
            () => new Date(0), () => new Map(), () => new Float32Array([1]), () => new Number(1),
            () => Object.freeze({ value: NaN }), () => Object.freeze(objectWith('value', getter)),
            () => objectWith('hidden', { value: 1, enumerable: false }),
            () => objectWith(Symbol('key'), { value: 1, enumerable: true }),
            ...['__proto__', 'prototype', 'constructor'].map(key => () => objectWith(key, { value: 1, enumerable: true })),
            () => new Array(3), () => { const value = []; value.length = 0xffffffff; return value; },
            () => { const value = [1]; value.extra = 2; return value; },
            () => { const value = [1]; value[Symbol('key')] = 2; return value; },
            () => Object.defineProperty([1], '0', getter),
            () => Object.defineProperty([1], '0', { value: 1, enumerable: false }),
            () => { const value = {}; value.self = value; return value; },
            () => { const value = []; value.push(value); return Object.freeze(value); },
        ];
        for (const [index, make] of factories.entries()) for (const method of ['cloneStrictJson', 'cloneAndFreezeStrictJson', 'deepFreezeJson']) {
            const received = errorOf(() => current[method](make(), '$.hostile'));
            assert(received, `Accepted hostile case ${index} with ${method}`);
            if (baseline) assert(equal(received, errorOf(() => baseline[method](make(), '$.hostile'))), `Rejection changed for case ${index}, ${method}`);
        }
        assert(reads === 0, 'A hostile accessor executed');
        return { cases: factories.length, operations: 3, accessorCalls: reads, baselineCompared: !!baseline };
    });
    check('Raw containers with certified children still reject late invalid fields and cycles', () => {
        const child = current.cloneAndFreezeStrictJson({ values: [1, 2] });
        current.cloneStrictJson(child); current.cloneStrictJson(child);
        let reads = 0;
        const source = { child };
        Object.defineProperty(source, 'late', { enumerable: true, get() { reads++; return 4; } });
        assert(errorOf(() => current.cloneAndFreezeStrictJson(source))?.message === '$.late: accessors are not supported', 'Late raw accessor bypassed validation');
        assert(reads === 0, 'Late raw accessor executed');
        const cycle = { child }; cycle.back = cycle;
        assert(errorOf(() => current.cloneAndFreezeStrictJson(cycle))?.message === '$.back: cycles are not supported', 'Raw cycle bypassed validation');
    });
    check('Proxy wrappers and in-place frozen inputs cannot forge copy provenance', () => {
        for (const api of baseline ? [current, baseline] : [current]) {
            const trusted = api.cloneAndFreezeStrictJson({ child: [1] });
            api.cloneStrictJson(trusted); api.cloneStrictJson(trusted);
            let traps = 0;
            const wrapped = new Proxy(trusted, { ownKeys() { traps++; throw new Error('wrapper inspected'); } });
            assert(errorOf(() => api.cloneStrictJson(wrapped))?.message === 'wrapper inspected' && traps === 1, 'Proxy wrapper acquired target provenance');
            const revocable = Proxy.revocable({ x: 1 }, {});
            api.deepFreezeJson(revocable.proxy); revocable.revoke();
            assert(errorOf(() => api.cloneAndFreezeStrictJson(revocable.proxy)), 'Revoked in-place frozen Proxy bypassed validation');
        }
    });
    check('Replaced freezing functions cannot certify still-mutable private copies', () => {
        const originalFreeze = Object.freeze, originalIsFrozen = Object.isFrozen;
        try {
            for (const api of baseline ? [current, baseline] : [current]) {
                Object.freeze = value => value;
                Object.isFrozen = () => true;
                const copy = api.cloneAndFreezeStrictJson({ child: [1], scalar: 2 });
                Object.freeze = originalFreeze; Object.isFrozen = originalIsFrozen;
                assert(!originalIsFrozen(copy) && !originalIsFrozen(copy.child), 'Fixture unexpectedly froze');
                api.cloneStrictJson(copy); api.cloneStrictJson(copy);
                copy.scalar = 3; copy.child[0] = 4;
                const changed = api.cloneStrictJson(copy);
                assert(changed.scalar === 3 && changed.child[0] === 4, 'Still-mutable private copy retained stale cached values');
                copy.child[0] = NaN;
                assert(errorOf(() => api.cloneStrictJson(copy))?.message === '$.child[0]: numbers must be finite', 'Forged freeze allowed invalid later data');
            }
        } finally { Object.freeze = originalFreeze; Object.isFrozen = originalIsFrozen; }
    });
    check('Private copies polluted through inherited setters still receive descriptor validation', () => {
        const key = 'strictJsonInheritedSetterProbe';
        const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
        let getterReads = 0;
        try {
            Object.defineProperty(Object.prototype, key, { configurable: true, set() {
                Object.defineProperty(this, key, { enumerable: true, configurable: true, get() { getterReads++; return 5; } });
            } });
            for (const api of baseline ? [current, baseline] : [current]) {
                const copied = api.cloneAndFreezeStrictJson({ [key]: 1 });
                for (let i = 0; i < 3; i++) assert(errorOf(() => api.cloneStrictJson(copied))?.message === `$.${key}: accessors are not supported`, 'Private copy with an accessor acquired unchecked provenance');
            }
            assert(getterReads === 0, 'Polluted copy accessor executed');
        } finally {
            if (previous) Object.defineProperty(Object.prototype, key, previous); else delete Object.prototype[key];
        }
    });
    check('Cached parent values never certify mutable descendants injected through an inherited setter', () => {
        const key = 'strictJsonMutableChildProbe', previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
        try {
            for (const api of baseline ? [current, baseline] : [current]) {
                const external = { n: 1 };
                Object.defineProperty(Object.prototype, key, { configurable: true, set() {
                    Object.defineProperty(this, key, { value: external, enumerable: true, configurable: true, writable: true });
                } });
                const copied = api.cloneAndFreezeStrictJson({ [key]: 0 });
                delete Object.prototype[key];
                api.cloneStrictJson(copied); api.cloneStrictJson(copied);
                external.n = NaN;
                assert(errorOf(() => api.cloneStrictJson(copied))?.message === `$.${key}.n: numbers must be finite`, 'Cached parent bypassed mutable descendant validation');
            }
        } finally {
            if (previous) Object.defineProperty(Object.prototype, key, previous); else delete Object.prototype[key];
        }
    });
    check('Null prototypes, key order, repeated copies and descriptor results match baseline', () => {
        const source = Object.assign(Object.create(null), { beta: [3, { n: -0 }], alpha: null, '12': 1, '2': 2 });
        const APIs = baseline ? [current, baseline] : [current];
        const outputs = APIs.map(api => {
            let value = api.cloneAndFreezeStrictJson(source);
            const result = [];
            for (let i = 0; i < 6; i++) {
                result.push({ text: JSON.stringify(value), keys: Reflect.ownKeys(value), plain: Object.getPrototypeOf(value) === Object.prototype,
                    descriptors: api.strictJsonArrayDescriptors(value.beta) });
                value = api.cloneAndFreezeStrictJson(value);
            }
            return result;
        });
        assert(outputs[0].every(value => value.plain), 'Null prototype normalization changed');
        if (baseline) assert(equal(outputs[0], outputs[1]), 'Value, order or descriptor parity changed');
    });
    return { status: rows.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL', rows };
}

export function benchmarkStrictJsonValues(baseline, iterations = 20000) {
    const sample = { speciesMassKg: { 'species:H2O': 2, 'species:HCl': .3 }, momentumKgMPerS: [0, 0, 0], internalEnergyJ: 140000, electricChargeC: 0 };
    const modules = { before: baseline, after: current }, timings = { repeated: { before: [], after: [] }, changing: { before: [], after: [] } };
    let checksum = 0;
    for (let trial = 0; trial < 6; trial++) for (const label of trial % 2 ? ['after', 'before'] : ['before', 'after']) {
        const api = modules[label], retained = api.cloneAndFreezeStrictJson(sample);
        for (let i = 0; i < 1000; i++) api.cloneAndFreezeStrictJson(retained);
        let started = performance.now();
        for (let i = 0; i < iterations; i++) checksum += api.cloneAndFreezeStrictJson(retained).internalEnergyJ;
        timings.repeated[label].push((performance.now() - started) / iterations);
        let previous = retained;
        started = performance.now();
        for (let i = 0; i < iterations; i++) {
            previous = api.cloneAndFreezeStrictJson({ ...previous, speciesMassKg: { ...previous.speciesMassKg }, internalEnergyJ: 140000 + i });
            checksum += previous.internalEnergyJ;
        }
        timings.changing[label].push((performance.now() - started) / iterations);
    }
    return { iterations, trials: 6, timings, checksum, scope: 'CPU clone microbenchmark; repeated immutable input and changing material-style inventory; no FPS claim' };
}

const result = runStrictJsonValueChecks();
export const suiteResult = finishSuite('strict-json', result.rows.map(row => ({name:row.name, passed:row.status==='PASS', error:row.error, detail:row.detail})));
