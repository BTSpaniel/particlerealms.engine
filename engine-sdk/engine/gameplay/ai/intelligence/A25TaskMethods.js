// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { BUILTIN_METHODS, actorTaskError, copyActorTaskData, createRegisteredMethods,
    freezeActorTaskData, requireActorTaskIdentifier, requireActorTaskRevision } from './RegisteredMethods.js';
import { normalizeActorNeeds } from './ActorNeeds.js';

/** Source identities are provenance, not runtime imports or permission to act. */
export const A25_TASK_SOURCES = freezeActorTaskData({
    frontier: { catalogId: 'a25-source-source-frontier-js', sha256: 'c9a5d97a35e573ca423e800556720b8d066c7b08cf01282a7bbaa147ae5b8106' },
    scene: { catalogId: 'A25/scene.json', sha256: '851c6fced29bc308475040ae4ffdcb8a25345eb4cb692103eb3cf0bd0a59f9c8' },
    activityOwner: { catalogId: 'retained-python/market_core.py', sha256: '1f06b6c75ea06ae2473d61d85f4e2be10ed1a936d1ceb17397517d6b1054c41a' },
});

const ref = path => ({ $ref: path });
const goal = name => ref(`intent.goal.${name}`);
const move = (id, name) => ({ id, operation: 'move', payload: { targetRef: goal(name) } });
const action = (id, operation, payload) => ({ id, operation: `a25.${operation}`, payload });
const method = (id, steps) => ({ id: `a25.${id}`, version: 1, steps });
const submethod = (id, name) => ({ id, methodId: `a25.${name}`, methodVersion: 1 });
const facility = (activity, duration) => method(activity, [move('approach', 'siteRef'),
    action('start', 'activity_start', { site: goal('siteRef'), activity }),
    ...Array.from({ length: duration }, (_, progress) => action(`work-${progress}`, 'activity_work', {
        activity: ref('results.1.result.id'), progress,
    })),
]);
const readPage = (id, page) => [move(`${id}-approach`, 'bookSiteRef'),
    action(`${id}-read`, 'book_read', { book: goal('bookRef'), page, revision: goal('bookRevision') })];
const repair = stage => method(`repair-bow-stage-${stage}`, [move('approach', 'workshopRef'),
    ...Array.from({ length: 3 - stage }, (_, offset) => action(`stage-${stage + offset}`, 'maintenance_work', {
        target: goal('targetRef'), stage: stage + offset, book: goal('bookRef'),
    })),
]);
const delivery = operation => action(operation, operation, { job: goal('jobRef') });

/**
 * Exact bounded sequences derived from later A24/A25. Domain names after `a25.`
 * map to the original owner operations and payloads. The actions provider owns
 * their real implementation, permission, current revisions and durable receipts.
 * The runtime projects each move payload.targetRef into navigation context.targetRef.
 * No provider is installed by importing or registering these data definitions.
 * Drink/rest are top-level recipes: their activity result reference is absolute.
 */
export const A25_TASK_METHODS = freezeActorTaskData([
    facility('drink', 2), facility('rest', 6),
    method('meal', [move('approach', 'homeRef'), action('consume', 'consume', {
        target: goal('foodRef'), revision: goal('foodRevision'), required_home: goal('homeRef'),
    })]),
    method('read-page', readPage('page', ref('intent.quantities.page'))),
    method('read-maintenance-manual', [...readPage('part-1', 1), ...readPage('part-2', 2)]),
    method('equip-maintenance-tool', [move('approach', 'toolSiteRef'), action('equip', 'equip_tool', { target: goal('toolRef') })]),
    repair(0), repair(1), repair(2),
    method('learn-and-repair', [submethod('read', 'read-maintenance-manual'),
        submethod('equip', 'equip-maintenance-tool'), submethod('repair', 'repair-bow-stage-0')]),
    method('courier-new', [move('depot', 'depotRef'), delivery('delivery_claim'), move('source', 'sourceRef'),
        delivery('delivery_take'), move('destination', 'destinationRef'), delivery('delivery_drop')]),
    method('courier-claimed', [move('source', 'sourceRef'), delivery('delivery_take'),
        move('destination', 'destinationRef'), delivery('delivery_drop')]),
    method('courier-carried', [move('destination', 'destinationRef'), delivery('delivery_drop')]),
    method('plant', [move('approach', 'farmRef'), action('plant', 'plant', { target: goal('seedRef') })]),
    method('water', [move('approach', 'farmRef'), action('water', 'water', {})]),
    method('harvest', [move('approach', 'farmRef'), action('harvest', 'harvest', {})]),
]);

const need = (predicate, parameters = {}) => ({ predicate, parameters });
const common = [need('actor-current-available-authorized'), need('source-context-current'), need('owner-operations-registered')];
const repairNeeds = [need('actor-action-and-skill', { action: 'repair', minimumLevel: 10 }),
    need('current-acquired-procedure', { kind: 'repair', output: 'maintained_bow', outputQuantity: 1,
        toolRole: 'maintenance_tool', toolWork: 3, station: 'workshop',
        stages: [{ operation: 'inspect', work: 1 }, { operation: 'patch', work: 1 }, { operation: 'secure', work: 1 }] }),
    need('target-owned-equipped', { kind: 'hunting bow' }), need('maintenance-tool-equipped-with-durability')];
const contracts = A25_TASK_METHODS.map(definition => ({ methodId: definition.id, methodVersion: 1,
    source: A25_TASK_SOURCES.frontier, prerequisites: [...common], standaloneOnly: false,
    completion: { evidence: 'authoritative-operation-receipts' }, liveBinding: 'UNBOUND' }));
const amend = (name, fields) => Object.assign(contracts.find(value => value.methodId === `a25.${name}`), fields);
for (const [name, duration, needName] of [['drink', 2, 'thirst'], ['rest', 6, 'fatigue']]) {
    amend(name, { standaloneOnly: true, prerequisites: [...common,
        need('facility-definition-current', { activity: name, duration, relief: 60, need: needName, supplies: {}, wage: 0 }),
        need('facility-access-and-timing')], completion: { evidence: 'final-activity-work-DONE', need: needName, instructionDeficitBelow: 65 } });
}
amend('meal', { prerequisites: [...common, need('food-owned-at-required-home-current-revision'),
    need('food-consumable-unreserved')], completion: { evidence: 'identified-food-consumed' } });
for (const name of ['read-page', 'read-maintenance-manual']) amend(name, {
    prerequisites: [...common, need('book-observed-or-public-catalog'), need('book-page-revision-access-language-current'),
        ...(name === 'read-maintenance-manual' ? [need('maintenance-manual-two-parts', { pages: [1, 2], procedure: 'field-bow-repair' })] : [])],
    completion: { evidence: 'individual-READ-page-records', acquiredBasis: 'HOST_TEXT_NOT_OCR', sharedAutomatically: false },
});
amend('equip-maintenance-tool', { prerequisites: [...common, need('tool-observed-owned-available'), need('carried-mass-within-capacity')] });
for (let stage = 0; stage < 3; stage++) amend(`repair-bow-stage-${stage}`, {
    prerequisites: [...common, ...repairNeeds, need('repair-stage-equals', { stage }),
        ...(stage === 0 ? [need('nearby-owned-material', { kind: 'repair patch', quantity: 1, unit: 'item' })] : [])],
    completion: { evidence: 'target-repaired-with-source', durability: 32, samePhysicalIdentity: true },
});
amend('learn-and-repair', { prerequisites: [...common, need('maintenance-manual-two-parts', { pages: [1, 2], procedure: 'field-bow-repair' }),
    need('book-page-revision-access-language-current'), need('both-maintenance-pages-not-yet-acquired'),
    need('tool-observed-owned-not-equipped'), need('actor-action-and-skill', { action: 'repair', minimumLevel: 10 }),
    need('target-owned-equipped', { kind: 'hunting bow' }), need('repair-stage-equals', { stage: 0 }),
    need('nearby-owned-material', { kind: 'repair patch', quantity: 1, unit: 'item' })],
    completion: { evidence: 'individual-READ-pages-and-same-target-repaired', durability: 32, sharedAutomatically: false },
});
for (const [name, phase] of [['courier-new', 'OPEN'], ['courier-claimed', 'CLAIMED'], ['courier-carried', 'CLAIMED']]) amend(name, {
    prerequisites: [...common, need('actor-role', { role: 'courier' }), need('delivery-phase', { phase }),
        need('delivery-recipient-ownership-and-assignment'), need('destination-authorized-capacity'),
        need('employer-existing-funds'), ...(name === 'courier-carried' ? [need('assigned-target-physically-carried-by-actor')]
            : [need('source-item-present-hands-free-mass-within-capacity')])],
    completion: { evidence: 'same-item-at-authorized-recipient-home-and-existing-wage-transferred', ownershipTransfer: false },
});
for (const [name, phase] of [['plant', 'EMPTY'], ['water', 'PLANTED'], ['harvest', 'RIPE']]) amend(name, {
    prerequisites: [...common, need('actor-role', { role: 'farmer' }), need('farm-enabled-owned-equipment-at-farm'),
        need('crop-phase', { phase }), ...(name === 'plant' ? [need('seed-owned-in-original-basket'), need('owner-demand-plan-headroom')]
            : name === 'water' ? [need('water-source-enabled')] : [need('captured-yield-and-empty-original-basket'), need('owner-harvest-capacity-and-day')])],
    completion: { evidence: name === 'plant' ? 'seed-consumed-and-yield-bound-once' : name === 'water' ? 'growth-ready-time-established' : 'captured-yield-created-once',
        quantityOwner: 'accepted-crop-plan', plannerAloneAuthorizes: false },
});
export const A25_TASK_CONTRACTS = freezeActorTaskData(contracts);

export const A25_CARE_INTERRUPTION = freezeActorTaskData({
    source: A25_TASK_SOURCES.frontier, policySource: A25_TASK_SOURCES.scene,
    urgentDeficit: 75, resumeDeficit: 55, order: ['thirst', 'hunger-with-home-food', 'fatigue'],
    suspendOnlyWithout: ['pending-effect', 'active-facility', 'existing-suspension', 'actor-detained', 'actor-unavailable', 'actor-asleep'],
    excludedMethods: ['drink', 'meal', 'rest', 'wash', 'sleep', 'wake', 'leisure'],
    retain: ['task-identity', 'first-uncommitted-step', 'committed-results', 'physical-cargo', 'interruption-anchor'],
    resumeCareBlockers: [{ need: 'thirst', deficitAtLeast: 55 },
        { need: 'hunger', deficitAtLeast: 55, requiresKnownHomeFood: true }, { need: 'fatigue', deficitAtLeast: 55 }],
    resumeRequires: ['reconcile-unknown-effects', 'no-actionable-care-at-resume-threshold', 'actor-context-current', 'current-item-access',
        'next-interaction-available', 'return-to-interruption-anchor'],
    automaticSchedulingInstalled: false,
});

export const A25_TASK_ALTERNATIVES = freezeActorTaskData({
    care: ['a25.drink', 'a25.meal', 'a25.rest'],
    delivery: ['a25.courier-carried', 'a25.courier-claimed', 'a25.courier-new'],
    farming: ['a25.plant', 'a25.water', 'a25.harvest'],
    bowRepair: ['a25.repair-bow-stage-2', 'a25.repair-bow-stage-1', 'a25.repair-bow-stage-0', 'a25.learn-and-repair'],
    pageRead: ['a25.read-page'], manualRead: ['a25.read-maintenance-manual'], equipTool: ['a25.equip-maintenance-tool'],
});

export function createA25TaskMethods({ includeBuiltins = true } = {}) {
    if (typeof includeBuiltins !== 'boolean') throw new TypeError('includeBuiltins must be boolean');
    const registry = createRegisteredMethods({ methods: [...(includeBuiltins ? BUILTIN_METHODS : []), ...A25_TASK_METHODS] });
    return Object.freeze({ list: registry.list, expand: registry.expand, register: raw => {
        const value = copyActorTaskData(raw);
        requireActorTaskIdentifier(value?.id, 'method ID');
        if (value.id.startsWith('a25.')) throw actorTaskError('A25_METHOD_RESERVED', 'The source-derived A25 namespace is immutable');
        if (value.steps?.some(step => ['a25.drink', 'a25.rest'].includes(step.methodId))) {
            throw actorTaskError('A25_METHOD_STANDALONE', 'Drink and rest bind absolute top-level activity result indices');
        }
        return registry.register(value);
    } });
}

async function validateHostCandidate(request, validateCandidate) {
    const reply = copyActorTaskData(await validateCandidate(freezeActorTaskData(request)));
    if (!reply || reply.actorId !== request.actorId || reply.methodId !== request.methodId || reply.methodVersion !== 1
        || reply.revision !== request.expectedRevision || typeof reply.eligible !== 'boolean') {
        throw actorTaskError('A25_METHOD_VALIDATION', 'Owner validation must match the exact actor, method and revision');
    }
    if ((Object.hasOwn(reply, 'available') && reply.available !== true)
        || (Object.hasOwn(reply, 'supported') && reply.supported !== true)
        || (Object.hasOwn(reply, 'status') && !['validated', 'eligible', 'ineligible', 'available', 'ready'].includes(reply.status))
        || (reply.status === 'eligible' && !reply.eligible) || (reply.status === 'ineligible' && reply.eligible)) {
        throw actorTaskError('A25_METHOD_VALIDATION', 'Unavailable or uncertain validation is not a definite eligibility result');
    }
    return reply;
}

/**
 * Ask the current owner to validate finite source-derived alternatives in order.
 * Positive validation is scoped to actor, method version and owner revision.
 * This is proposal selection only; ActorTaskRuntime admission and each effect
 * must revalidate. No raw prose, dictionary membership or missing answer is legal.
 */
export async function selectA25TaskAlternative({ purpose, actorId, expectedRevision, validateCandidate } = {}) {
    requireActorTaskIdentifier(actorId, 'actor'); requireActorTaskRevision(expectedRevision);
    if (typeof purpose !== 'string' || !Object.hasOwn(A25_TASK_ALTERNATIVES, purpose) || typeof validateCandidate !== 'function') {
        throw actorTaskError('A25_METHOD_SELECTION', 'A known purpose and explicit host validator are required');
    }
    const checked = [];
    for (const methodId of A25_TASK_ALTERNATIVES[purpose]) {
        const contract = A25_TASK_CONTRACTS.find(value => value.methodId === methodId);
        const request = freezeActorTaskData({ purpose, actorId, methodId, methodVersion: 1, expectedRevision, contract });
        const reply = await validateHostCandidate(request, validateCandidate);
        checked.push({ methodId, eligible: reply.eligible });
        if (reply.eligible) return freezeActorTaskData({ status: 'proposed', actorId, methodId, methodVersion: 1,
            expectedRevision, contract, checked, grantsAuthority: false });
    }
    return freezeActorTaskData({ status: 'unavailable', actorId, expectedRevision, checked, grantsAuthority: false });
}

const CARE_NEEDS = ['thirst', 'hunger', 'fatigue'];
const CARE_SCALES = freezeActorTaskData(CARE_NEEDS.map(id => ({ id, sourceKey: id, minimum: 0, maximum: 100, polarity: 'deficit' })));
const CARE_FLAGS = ['available', 'detained', 'sleeping', 'pendingEffect', 'activeFacility',
    'careActive', 'hasSuspended', 'homeFoodAvailable'];

/**
 * Source-exact bounded care choice over explicit owner observations. This is not
 * a scheduler and never pauses, starts or resumes tasks. It reuses the existing
 * need normalization but preserves A25's ordered policy rather than utility
 * ranking. Missing/unknown host facts are rejected. A denied first care choice
 * remains blocked; selecting a lower-priority alternative would change A25.
 *
 * resume-ready means only that no source-defined actionable care remains. The
 * host must still reconcile effects, validate identity/context/access, and return
 * to the retained anchor before resuming the first uncommitted work step.
 */
export async function selectA25CareInterruption({ snapshot, phase = 'interrupt',
    thresholds = { urgentDeficit: 75, resumeDeficit: 55 }, validateCandidate } = {}) {
    const value = copyActorTaskData(snapshot), policy = copyActorTaskData(thresholds);
    const snapshotKeys = ['actorId', 'revision', 'needs', 'currentMethodId', ...CARE_FLAGS];
    if (!value || Array.isArray(value) || Object.keys(value).length !== snapshotKeys.length
        || snapshotKeys.some(key => !Object.hasOwn(value, key))
        || CARE_FLAGS.some(key => typeof value[key] !== 'boolean')
        || !['interrupt', 'resume'].includes(phase) || typeof validateCandidate !== 'function') {
        throw actorTaskError('A25_CARE_SNAPSHOT', 'Care choice requires explicit owner facts, phase and host validation');
    }
    requireActorTaskIdentifier(value.actorId, 'actor'); requireActorTaskRevision(value.revision);
    if (value.currentMethodId !== null) requireActorTaskIdentifier(value.currentMethodId, 'current method');
    if (!policy || Array.isArray(policy) || Object.keys(policy).length !== 2
        || !Number.isSafeInteger(policy.urgentDeficit) || policy.urgentDeficit < 65 || policy.urgentDeficit > 95
        || !Number.isSafeInteger(policy.resumeDeficit) || policy.resumeDeficit < 30 || policy.resumeDeficit > 64) {
        throw actorTaskError('A25_CARE_POLICY', 'Thresholds must match the bounded A25 urgent/resume policy');
    }
    if (!value.needs || Array.isArray(value.needs) || Object.keys(value.needs).length !== 3
        || CARE_NEEDS.some(key => !Object.hasOwn(value.needs, key))) {
        throw actorTaskError('A25_CARE_SNAPSHOT', 'Declare exact thirst, hunger and fatigue observations');
    }
    const normalizedNeeds = normalizeActorNeeds({ values: value.needs, scales: CARE_SCALES });
    const threshold = phase === 'interrupt' ? policy.urgentDeficit : policy.resumeDeficit;
    const normalizedThreshold = normalizeActorNeeds({ values: Object.fromEntries(CARE_NEEDS.map(key => [key, threshold])), scales: CARE_SCALES });
    const finish = (status, reason, extra = {}) => freezeActorTaskData({ status, reason, actorId: value.actorId,
        expectedRevision: value.revision, phase, threshold, normalizedNeeds, grantsAuthority: false, ...extra });
    if (value.pendingEffect) return finish('blocked', 'reconcile-pending-effect');
    if (!value.available || value.detained || value.sleeping) return finish('blocked', 'actor-unavailable-for-care');
    if (phase === 'interrupt') {
        if (value.currentMethodId === null) return finish('not-required', 'no-task-to-interrupt');
        const name = value.currentMethodId.startsWith('a25.') ? value.currentMethodId.slice(4) : value.currentMethodId;
        if (value.activeFacility || value.careActive || value.hasSuspended || A25_CARE_INTERRUPTION.excludedMethods.includes(name)) {
            return finish('blocked', 'current-task-cannot-be-interrupted-for-care');
        }
    } else if (!value.hasSuspended || value.currentMethodId !== null || value.activeFacility) {
        return finish('blocked', 'suspended-work-not-ready-for-care-review');
    }
    const needName = CARE_NEEDS.find(name => normalizedNeeds[name] <= normalizedThreshold[name]
        && (name !== 'hunger' || value.homeFoodAvailable));
    if (!needName) return finish(phase === 'resume' ? 'resume-ready' : 'not-required', 'no-actionable-care');
    const methodId = `a25.${{ thirst: 'drink', hunger: 'meal', fatigue: 'rest' }[needName]}`;
    const contract = A25_TASK_CONTRACTS.find(candidate => candidate.methodId === methodId);
    const reply = await validateHostCandidate({ purpose: 'care', actorId: value.actorId, methodId, methodVersion: 1,
        expectedRevision: value.revision, contract,
        care: { phase, need: needName, threshold, normalizedNeeds, homeFoodAvailable: value.homeFoodAvailable } }, validateCandidate);
    return finish(reply.eligible ? 'proposed' : 'blocked', reply.eligible ? 'source-care-choice' : 'host-care-ineligible',
        { methodId, methodVersion: 1, need: needName, contract });
}
