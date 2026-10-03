// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export {
    FABRIK_ROPE_BREAK_RECEIPT_SCHEMA,
    FABRIK_ROPE_BREAK_RECEIPT_VERSION,
    FABRIK_ROPE_DEFINITION_SCHEMA,
    FABRIK_ROPE_DEFINITION_VERSION,
    FABRIK_ROPE_LIMITS,
    FABRIK_ROPE_SNAPSHOT_SCHEMA,
    FABRIK_ROPE_SNAPSHOT_VERSION,
    FABRIK_ROPE_SOLVER_VERSION,
    RopeContractError,
    assertLiveFabrikRopeDefinition,
    compileFabrikRope,
    normalizeFabrikRopeAnchors,
    normalizeFabrikRopeDefinition,
    normalizeFabrikRopePositions,
} from './RopeContracts.js';

export {
    EMPTY_ROPE_COLLIDER_SET,
    ROPE_COLLIDER_KINDS,
    ROPE_COLLIDER_SET_SCHEMA,
    ROPE_COLLIDER_SET_VERSION,
    RopeCollisionError,
    assertSupportedRopeColliderKind,
    compileRopeColliderSet,
    createRopeCollisionProjector,
    projectRopePointCollisions,
    projectRopePointCollisionsInPlace,
    selectRopeColliderSet,
} from './RopeCollisionContracts.js';

export {
    FABRIK_ROPE_STATE_SCHEMA,
    FABRIK_ROPE_STATE_VERSION,
    FABRIK_ROPE_TELEMETRY_SCHEMA,
    FABRIK_ROPE_TELEMETRY_VERSION,
    FabrikRopeSolver,
    createFabrikRopeSolver,
    createFabrikRopeState,
    stepFabrikRope,
} from './FabrikRopeSolver.js';

export {
    FABRIK_ROPE_RUNTIME_TELEMETRY_SCHEMA,
    FABRIK_ROPE_RUNTIME_TELEMETRY_VERSION,
    FABRIK_ROPE_VIEW_SCHEMA,
    FABRIK_ROPE_VIEW_VERSION,
    FabrikRopeRuntime,
    createFabrikRopeRuntime,
    validateFabrikRopeSnapshot,
} from './RopeRuntime.js';

export {
    ROPE_SPOOL_DEFINITION_SCHEMA,
    ROPE_SPOOL_DEFINITION_VERSION,
    ROPE_SPOOL_WINDING_DIRECTIONS,
    normalizeRopeSpoolDefinition,
    ropeFreeLengthFromSpool,
    ropeShaftLoadFromTension,
    spoolAngleFromRopeFreeLength,
} from './RopeSpoolCoupling.js';
