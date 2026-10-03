// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Opaque, single-use evidence that one mixed-resolution shadow step completed. */

import {
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import { hashIdSecure } from '../../state/util/canonical.js';

export const MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_SCHEMA =
    'engine.matter.mixed-resolution-fluid-execution-certificate';
export const MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_VERSION = '1.0.0';
export const MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_MODE = 'shadow-only';

export const MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES = Object.freeze({
    AUTHORITY_ESCALATION: 'AUTHORITY_ESCALATION',
    BINDING_MISMATCH: 'BINDING_MISMATCH',
    FORGED_CERTIFICATE: 'FORGED_CERTIFICATE',
    INVALID_INPUT: 'INVALID_INPUT',
    PLAN_DIGEST_MISMATCH: 'PLAN_DIGEST_MISMATCH',
    REPLAYED_CERTIFICATE: 'REPLAYED_CERTIFICATE',
    SERIALIZATION_FORBIDDEN: 'SERIALIZATION_FORBIDDEN',
    STALE_DEVICE_GENERATION: 'STALE_DEVICE_GENERATION',
});

const PLAN_DIGEST_DOMAIN = 'engine.matter.mixed-resolution-fluid-execution-plan';
const COMPLETION_DIGEST_DOMAIN =
    'engine.matter.mixed-resolution-fluid-execution-completion';
const SHA256_ID = /^sha256:256:[0-9a-f]{64}$/;
const AUTHORITY_OPTION_KEYS = new Set(['deviceGeneration']);
const ISSUE_KEYS = new Set([
    'plan', 'planDigest', 'frame', 'sourceRevision', 'targetRevision',
    'deviceGeneration', 'completionEvidence',
]);
const EXPECTED_KEYS = new Set([
    'plan', 'planDigest', 'frame', 'sourceRevision', 'targetRevision',
    'deviceGeneration',
]);
const FORBIDDEN_AUTHORITY_CLAIMS = new Set([
    'canonicalOwnershipAuthority',
    'gpuExecutionAuthority',
    'liveSimulationMutation',
    'physicalAuthority',
    'physicalAuthorityGranted',
    'physicalHandoff',
    'physicalMutationAuthority',
    'simulationMutationAuthority',
]);

export class MixedResolutionFluidExecutionCertificateError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'MixedResolutionFluidExecutionCertificateError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new MixedResolutionFluidExecutionCertificateError(code, message);
}

function integer(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            `${path}: must be a non-negative safe integer`,
        );
    }
    return value;
}

function exactRecord(value, allowedKeys, requiredKeys, path) {
    let snapshot;
    try {
        snapshot = cloneStrictJson(value, path);
    } catch (error) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            `${path}: ${error.message}`,
        );
    }
    if (!isPlainJsonObject(snapshot)) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            `${path}: must be a plain data object`,
        );
    }
    for (const key of Object.keys(snapshot)) {
        if (!allowedKeys.has(key)) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
                `${path}.${key}: unknown field`,
            );
        }
    }
    for (const key of requiredKeys) {
        if (!Object.hasOwn(snapshot, key)) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
                `${path}.${key}: required field is missing`,
            );
        }
    }
    return snapshot;
}

function assertNoAuthorityClaim(value, path) {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertNoAuthorityClaim(entry, `${path}[${index}]`));
        return;
    }
    if (!isPlainJsonObject(value)) return;
    for (const [key, entry] of Object.entries(value)) {
        if (FORBIDDEN_AUTHORITY_CLAIMS.has(key) && entry !== false) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.AUTHORITY_ESCALATION,
                `${path}.${key}: a shadow execution certificate cannot grant physical authority`,
            );
        }
        assertNoAuthorityClaim(entry, `${path}.${key}`);
    }
}

function dataObject(value, path) {
    if (!isPlainJsonObject(value) || Object.keys(value).length === 0) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            `${path}: must be a non-empty plain data object`,
        );
    }
    assertNoAuthorityClaim(value, path);
    return deepFreezeJson(value, path);
}

function digest(value, domain) {
    return hashIdSecure(value, {
        domain,
        schemaVersion: MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_VERSION,
    });
}

function planDigest(snapshot) {
    return digest(snapshot, PLAN_DIGEST_DOMAIN);
}

function completionDigest(snapshot) {
    return digest(snapshot, COMPLETION_DIGEST_DOMAIN);
}

function claimedDigest(value, path) {
    if (typeof value !== 'string' || !SHA256_ID.test(value)) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            `${path}: must be a tagged lowercase SHA-256 digest`,
        );
    }
    return value;
}

function assertDeclaredBinding(record, names, expected, path) {
    for (const name of names) {
        if (Object.hasOwn(record, name) && record[name] !== expected) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.BINDING_MISMATCH,
                `${path}.${name}: contradicts the execution-certificate binding`,
            );
        }
    }
}

function normalizePlanBinding(plan, binding, path) {
    const snapshot = dataObject(plan, path);
    assertDeclaredBinding(snapshot, ['frame', 'frameIndex'], binding.frame, path);
    assertDeclaredBinding(snapshot, ['sourceRevision'], binding.sourceRevision, path);
    assertDeclaredBinding(snapshot, ['targetRevision'], binding.targetRevision, path);
    assertDeclaredBinding(snapshot, ['deviceGeneration'], binding.deviceGeneration, path);
    return snapshot;
}

function normalizeIssue(input) {
    const snapshot = exactRecord(input, ISSUE_KEYS, ISSUE_KEYS, '$.certificateBinding');
    const frame = integer(snapshot.frame, '$.certificateBinding.frame');
    const sourceRevision = integer(
        snapshot.sourceRevision,
        '$.certificateBinding.sourceRevision',
    );
    const targetRevision = integer(
        snapshot.targetRevision,
        '$.certificateBinding.targetRevision',
    );
    if (targetRevision < sourceRevision) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            '$.certificateBinding.targetRevision: cannot precede sourceRevision',
        );
    }
    const deviceGeneration = integer(
        snapshot.deviceGeneration,
        '$.certificateBinding.deviceGeneration',
    );
    const binding = { frame, sourceRevision, targetRevision, deviceGeneration };
    const plan = normalizePlanBinding(snapshot.plan, binding, '$.certificateBinding.plan');
    const completionEvidence = dataObject(
        snapshot.completionEvidence,
        '$.certificateBinding.completionEvidence',
    );
    if (completionEvidence.completed !== true) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            '$.certificateBinding.completionEvidence.completed: must be true',
        );
    }
    assertDeclaredBinding(
        completionEvidence,
        ['frame', 'frameIndex'],
        frame,
        '$.certificateBinding.completionEvidence',
    );
    assertDeclaredBinding(
        completionEvidence,
        ['sourceRevision'],
        sourceRevision,
        '$.certificateBinding.completionEvidence',
    );
    assertDeclaredBinding(
        completionEvidence,
        ['targetRevision'],
        targetRevision,
        '$.certificateBinding.completionEvidence',
    );
    assertDeclaredBinding(
        completionEvidence,
        ['deviceGeneration'],
        deviceGeneration,
        '$.certificateBinding.completionEvidence',
    );
    return Object.freeze({
        ...binding,
        plan,
        planDigest: claimedDigest(snapshot.planDigest, '$.certificateBinding.planDigest'),
        completionEvidence,
    });
}

function normalizeExpected(input) {
    const snapshot = exactRecord(input, EXPECTED_KEYS, EXPECTED_KEYS, '$.expectedBinding');
    const binding = {
        frame: integer(snapshot.frame, '$.expectedBinding.frame'),
        sourceRevision: integer(snapshot.sourceRevision, '$.expectedBinding.sourceRevision'),
        targetRevision: integer(snapshot.targetRevision, '$.expectedBinding.targetRevision'),
        deviceGeneration: integer(
            snapshot.deviceGeneration,
            '$.expectedBinding.deviceGeneration',
        ),
    };
    if (binding.targetRevision < binding.sourceRevision) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            '$.expectedBinding.targetRevision: cannot precede sourceRevision',
        );
    }
    return Object.freeze({
        ...binding,
        plan: normalizePlanBinding(snapshot.plan, binding, '$.expectedBinding.plan'),
        planDigest: claimedDigest(snapshot.planDigest, '$.expectedBinding.planDigest'),
    });
}

function opaqueCertificate() {
    const target = Object.freeze(Object.create(null));
    return new Proxy(target, {
        get(_target, property) {
            if (property === 'schema') return MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_SCHEMA;
            if (property === 'schemaVersion') {
                return MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_VERSION;
            }
            if (property === 'mode') return MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_MODE;
            if (property === 'physicalAuthorityGranted') return false;
            if (property === Symbol.toStringTag) {
                return 'MixedResolutionFluidExecutionCertificate';
            }
            if (property === 'toJSON') {
                return () => fail(
                    MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                        .SERIALIZATION_FORBIDDEN,
                    'Mixed-resolution fluid execution certificates are live opaque capabilities',
                );
            }
            return undefined;
        },
    });
}

function failure(error, fallbackCode) {
    return Object.freeze({
        ok: false,
        code: error?.code ?? fallbackCode,
        reason: error?.message ?? 'Mixed-resolution fluid execution certificate rejected',
        mode: MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_MODE,
        physicalAuthorityGranted: false,
    });
}

function success(record, consumed) {
    return Object.freeze({
        ok: true,
        code: consumed
            ? 'CONSUMED_SHADOW_EXECUTION_CERTIFICATE'
            : 'VERIFIED_SHADOW_EXECUTION_CERTIFICATE',
        schema: MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_SCHEMA,
        schemaVersion: MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_VERSION,
        mode: MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_MODE,
        planDigest: record.planDigest,
        frame: record.frame,
        sourceRevision: record.sourceRevision,
        targetRevision: record.targetRevision,
        deviceGeneration: record.deviceGeneration,
        completionEvidenceDigest: record.completionEvidenceDigest,
        completionEvidence: record.completionEvidence,
        consumed,
        physicalAuthorityGranted: false,
    });
}

/** Derive the canonical, domain-separated SHA-256 address for a strict JSON plan. */
export async function canonicalMixedResolutionFluidPlanDigest(plan) {
    let snapshot;
    try {
        snapshot = cloneStrictJson(plan, '$.plan');
    } catch (error) {
        fail(
            MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            `$.plan: ${error.message}`,
        );
    }
    return planDigest(dataObject(snapshot, '$.plan'));
}

/**
 * Create one trust domain for live, non-transferable completion capabilities.
 * Tokens issued by a different authority instance are always forgeries here.
 */
export function createMixedResolutionFluidExecutionCertificateAuthority(optionsInput = {}) {
    const options = exactRecord(
        optionsInput,
        AUTHORITY_OPTION_KEYS,
        new Set(),
        '$.certificateAuthorityOptions',
    );
    let currentDeviceGeneration = integer(
        options.deviceGeneration ?? 0,
        '$.certificateAuthorityOptions.deviceGeneration',
    );
    const certificates = new WeakMap();

    async function issue(input) {
        const binding = normalizeIssue(input);
        if (binding.deviceGeneration !== currentDeviceGeneration) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                    .STALE_DEVICE_GENERATION,
                `Cannot issue generation ${binding.deviceGeneration}; current generation is ${currentDeviceGeneration}`,
            );
        }
        const issuingGeneration = currentDeviceGeneration;
        const [computedPlanDigest, computedCompletionDigest] = await Promise.all([
            planDigest(binding.plan),
            completionDigest(binding.completionEvidence),
        ]);
        if (issuingGeneration !== currentDeviceGeneration) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                    .STALE_DEVICE_GENERATION,
                'Device generation changed while certificate evidence was being hashed',
            );
        }
        if (binding.planDigest !== computedPlanDigest) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.PLAN_DIGEST_MISMATCH,
                'Claimed plan digest does not match the canonical execution plan',
            );
        }
        const certificate = opaqueCertificate();
        certificates.set(certificate, {
            state: 'issued',
            planDigest: computedPlanDigest,
            frame: binding.frame,
            sourceRevision: binding.sourceRevision,
            targetRevision: binding.targetRevision,
            deviceGeneration: binding.deviceGeneration,
            completionEvidenceDigest: computedCompletionDigest,
            completionEvidence: binding.completionEvidence,
        });
        return certificate;
    }

    async function evaluate(certificate, expectedInput, consume) {
        const record = certificates.get(certificate);
        if (!record) {
            return failure(
                null,
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.FORGED_CERTIFICATE,
            );
        }
        if (record.state !== 'issued') {
            return failure(
                null,
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.REPLAYED_CERTIFICATE,
            );
        }
        if (record.deviceGeneration !== currentDeviceGeneration) {
            return failure(
                null,
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                    .STALE_DEVICE_GENERATION,
            );
        }
        // Consumption is reserved before validation or hashing so concurrent or
        // failed consume attempts can never race the same capability twice.
        if (consume) record.state = 'consumed';
        try {
            const expected = normalizeExpected(expectedInput);
            if (expected.deviceGeneration !== currentDeviceGeneration) {
                fail(
                    MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                        .STALE_DEVICE_GENERATION,
                    'Expected device generation is stale',
                );
            }
            const computedPlanDigest = await planDigest(expected.plan);
            if (record.deviceGeneration !== currentDeviceGeneration) {
                fail(
                    MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                        .STALE_DEVICE_GENERATION,
                    'Device generation changed while certificate binding was verified',
                );
            }
            if (computedPlanDigest !== expected.planDigest) {
                fail(
                    MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                        .PLAN_DIGEST_MISMATCH,
                    'Expected plan digest does not match the canonical execution plan',
                );
            }
            for (const key of [
                'planDigest', 'frame', 'sourceRevision', 'targetRevision', 'deviceGeneration',
            ]) {
                if (expected[key] !== record[key]) {
                    fail(
                        MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                            .BINDING_MISMATCH,
                        `Expected ${key} does not match the issued certificate`,
                    );
                }
            }
            return success(record, consume);
        } catch (error) {
            return failure(
                error,
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES.INVALID_INPUT,
            );
        }
    }

    function setDeviceGeneration(nextInput) {
        const next = integer(nextInput, '$.deviceGeneration');
        if (next < currentDeviceGeneration) {
            fail(
                MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_ERROR_CODES
                    .STALE_DEVICE_GENERATION,
                'Device generation cannot move backwards',
            );
        }
        currentDeviceGeneration = next;
        return currentDeviceGeneration;
    }

    return Object.freeze({
        issue,
        verify: (certificate, expected) => evaluate(certificate, expected, false),
        consume: (certificate, expected) => evaluate(certificate, expected, true),
        setDeviceGeneration,
        get deviceGeneration() {
            return currentDeviceGeneration;
        },
    });
}
