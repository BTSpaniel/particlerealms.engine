// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';
const {
  PARTICLE_COHORT_PLAN_SCHEMA,
  PARTICLE_COHORT_PRESENTATION_QUEUES,
  computeParticleCohortMoments,
  createParticleCohortKernelDescriptor,
  createParticleCohortPlanner,
  normalizeParticleBranchFieldDescriptor,
  reconstructParticleBranchFieldSample,
} = await resolveModule("engine/render/morphfield/systems/ParticleCohortPlanner.js", ["PARTICLE_COHORT_PLAN_SCHEMA", "PARTICLE_COHORT_PRESENTATION_QUEUES", "computeParticleCohortMoments", "createParticleCohortKernelDescriptor", "createParticleCohortPlanner", "normalizeParticleBranchFieldDescriptor", "reconstructParticleBranchFieldSample"]);
const {
  EXECUTION_FAMILY,
  OrientedKernelSet,
  ParticleCohortPlanner,
} = await resolveModule("engine/render/morphfield/systems/index.js", ["EXECUTION_FAMILY", "OrientedKernelSet", "ParticleCohortPlanner"]);

const output = document.querySelector('#results');
const cases = [];
const passes = [];
const failures = [];

function test(name, operation) {
  cases.push({ name, operation });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  assert(left === right, `${message}: expected ${right}, received ${left}`);
}

function near(actual, expected, message, tolerance = 1e-9) {
  assert(Number.isFinite(actual), `${message}: received non-finite ${actual}`);
  assert(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`);
}

function throws(operation, pattern, message) {
  let error = null;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${message}: did not throw`);
  assert(pattern.test(error.message), `${message}: unexpected error '${error.message}'`);
}

const branchField = Object.freeze({
  id: 'storm.branch.page',
  originM: [0, 0, 0],
  axis: [0, 1, 0],
  basisX: [1, 0, 0],
  meanVelocityMPerS: [0.2, 0, 0],
  axialVelocityMPerS: 0.1,
  branchCount: 4,
  samplesPerBranch: 8,
  seed: 17,
  epochSeconds: 10,
  baseRadiusM: 2,
  minimumRadiusM: 0.5,
  maximumRadiusM: 4,
  radialGrowthPerUnit: 0.4,
  maxAbsLogRadius: 2,
  pitchMPerUnit: 3,
  maximumAxialOffsetM: 4,
  angularVelocityRadPerS: 1.5,
  twistRadPerUnit: 2,
  phaseRad: 0.25,
  phaseJitterRad: 0,
  radialJitterFraction: 0,
  axialJitterM: 0,
  maximumResidualM: 0.25,
  maximumTimeOffsetSeconds: 8,
});

function certifiedPage(id, preferredQueue = 'automatic', overrides = {}) {
  return {
    id,
    sourceRevision: 1,
    representationRevision: 2,
    simulationAuthority: 'particle-storm',
    preferredQueue,
    capabilities: {
      packed: true,
      moment: false,
      procedural: false,
      field: false,
      sleeping: false,
      ...overrides.capabilities,
    },
    certificates: {
      packed: true,
      moment: false,
      procedural: false,
      field: false,
      hasCoarseResidentFieldLevel: false,
      ...overrides.certificates,
    },
    errors: {
      packedPositionM: 0.005,
      packedVelocityMPerS: 0.05,
      momentDensityFraction: 0.02,
      proceduralPositionM: 0.02,
      proceduralVelocityMPerS: 0.1,
      fieldMassFraction: 0.001,
      fieldDivergence: 0.01,
      ...overrides.errors,
    },
    activity: {
      stableFrames: 200,
      speedMPerS: 0.001,
      ...overrides.activity,
    },
    presentation: {
      visible: true,
      projectedRadiusPx: 3,
      screenCoverage: 0.1,
      coherence: 0.98,
      volumetric: false,
      ...overrides.presentation,
    },
    branchField: overrides.branchField,
  };
}

test('systems barrel exports the reusable planner and stable six-queue catalog', () => {
  assert(ParticleCohortPlanner === createParticleCohortPlanner().constructor,
    'systems barrel did not export ParticleCohortPlanner');
  equal(PARTICLE_COHORT_PRESENTATION_QUEUES,
    ['raw', 'packed', 'moment', 'procedural', 'field', 'sleeping'],
    'presentation queue order');
  assert(Object.isFrozen(PARTICLE_COHORT_PRESENTATION_QUEUES), 'queue catalog must be immutable');
});

test('mass-weighted moments conserve translation rotation and covariance', () => {
  const moments = computeParticleCohortMoments([
    { positionM: [-1, 0, 0], velocityMPerS: [0, -1, 0], massKg: 1 },
    { positionM: [1, 0, 0], velocityMPerS: [0, 1, 0], massKg: 1 },
  ]);
  equal(moments.centroidM, [0, 0, 0], 'centroid');
  equal(moments.meanVelocityMPerS, [0, 0, 0], 'mean velocity');
  equal(moments.linearMomentumKgMPerS, [0, 0, 0], 'linear momentum');
  near(moments.positionCovarianceM2[0], 1, 'x covariance');
  near(moments.positionCovarianceM2[4], 0, 'y covariance');
  near(moments.rmsRadiusM, 1, 'RMS radius');
  near(moments.angularMomentumAboutCentroidKgM2PerS[2], 2, 'centered angular momentum');
  near(moments.kineticEnergyJ, 1, 'kinetic energy');
  equal(moments.boundsM, [-1, 0, 0, 1, 0, 0], 'bounds');
  assert(Object.isFrozen(moments) && Object.isFrozen(moments.positionCovarianceM2),
    'moment result must be deeply immutable');
});

test('weighted covariance uses total mass and ignores zero-mass influence', () => {
  const moments = computeParticleCohortMoments([
    { positionM: [0, 0, 0], velocityMPerS: [1, 0, 0], massKg: 1 },
    { positionM: [2, 0, 0], velocityMPerS: [3, 0, 0], massKg: 3 },
    { positionM: [999, 0, 0], velocityMPerS: [999, 0, 0], massKg: 0 },
  ]);
  near(moments.totalMassKg, 4, 'total mass');
  near(moments.centroidM[0], 1.5, 'weighted centroid');
  near(moments.meanVelocityMPerS[0], 2.5, 'weighted velocity');
  near(moments.linearMomentumKgMPerS[0], 10, 'weighted momentum');
  near(moments.positionCovarianceM2[0], 0.75, 'weighted covariance');
  equal(moments.boundsM, [0, 0, 0, 2, 0, 0], 'zero-mass sample bounds');
  assert(moments.sampleCount === 3 && moments.contributingSamples === 2,
    'sample contribution counts are not explicit');
});

test('aggregate moments project into the existing oriented-kernel contract', () => {
  const moments = computeParticleCohortMoments([
    { positionM: [-2, -0.5, 0], velocityMPerS: [1, 0, 0], massKg: 1 },
    { positionM: [2, 0.5, 0], velocityMPerS: [1, 0, 0], massKg: 1 },
  ]);
  const kernel = createParticleCohortKernelDescriptor(moments, {
    id: 'storm.kernel.1',
    sigmaScale: 2,
    minimumRadiusM: 0.01,
    color: [0.2, 0.5, 1],
    opacity: 0.7,
  });
  near(Math.hypot(...kernel.orientation), 1, 'kernel quaternion normalization');
  assert(kernel.radius[0] > kernel.radius[1] && kernel.radius.every(value => value >= 0.01),
    'kernel radii did not follow principal variance');
  const set = new OrientedKernelSet([kernel], { cellSize: 8 });
  assert(set.evaluate(kernel.center).density > 0, 'existing OrientedKernelSet rejected aggregate kernel');
  assert(kernel.aggregate.massKg === 2 && kernel.aggregate.sampleCount === 2,
    'aggregate provenance was not retained');
});

test('oriented kernels rotate both their evaluator and spatial-bin bounds', () => {
  const halfTurn = Math.sqrt(0.5);
  const set = new OrientedKernelSet([{
    id: 'rotated-anisotropic-kernel',
    center: [0, 0, 0],
    radius: [3, 0.25, 0.25],
    orientation: [0, 0, halfTurn, halfTurn],
    color: [1, 1, 1],
    opacity: 1,
  }], { cellSize: 0.5 });
  const alongRotatedMajorAxis = set.evaluate([0, 2, 0]);
  const acrossRotatedMinorAxis = set.evaluate([2, 0, 0]);
  assert(alongRotatedMajorAxis.count === 1 && alongRotatedMajorAxis.density > 0.75,
    'rotated major axis was either absent from its bin or evaluated without orientation');
  assert(acrossRotatedMinorAxis.density < 1e-10,
    'rotated minor axis incorrectly retained the unrotated major-axis density');
  throws(() => new OrientedKernelSet([{
    center: [0, 0, 0], radius: [1, 1, 1], orientation: [0, 0, 0, 0],
  }]), /cannot be zero/, 'zero quaternion admission');
});

test('branch-field reconstruction is deterministic separated and presentation-only', () => {
  const simple = normalizeParticleBranchFieldDescriptor({
    id: 'simple.branch',
    branchCount: 4,
    samplesPerBranch: 1,
    originM: [0, 0, 0],
    axis: [0, 1, 0],
    basisX: [1, 0, 0],
    baseRadiusM: 2,
    maximumRadiusM: 2,
    maximumAxialOffsetM: 0,
    maximumTimeOffsetSeconds: 2,
  });
  const samples = [0, 1, 2, 3].map(sampleIndex => (
    reconstructParticleBranchFieldSample(simple, { sampleIndex, timeSeconds: 0 })
  ));
  const repeat = reconstructParticleBranchFieldSample(simple, { sampleIndex: 1, timeSeconds: 0 });
  equal(samples[1], repeat, 'branch reconstruction determinism');
  for (const sample of samples) near(Math.hypot(sample.positionM[0], sample.positionM[2]), 2,
    `branch ${sample.branchIndex} radius`);
  near(samples[0].positionM[0], -samples[2].positionM[0], 'opposed branch X');
  near(samples[1].positionM[2], -samples[3].positionM[2], 'opposed branch Z');
  assert(samples.every(sample => sample.authority.canonical === false
      && sample.authority.writesSimulationState === false),
  'procedural descendants claimed canonical state');
});

test('branch-field bounds clamp extrapolation exponent radius axial motion and residual', () => {
  const bounded = reconstructParticleBranchFieldSample({
    ...branchField,
    radialGrowthPerUnit: 32,
    maxAbsLogRadius: 0.1,
    maximumRadiusM: 2.1,
    maximumAxialOffsetM: 0.5,
    maximumResidualM: 0.1,
    maximumTimeOffsetSeconds: 1,
  }, {
    sampleIndex: 31,
    timeSeconds: 10_000,
    residualM: [5, 0, 0],
  });
  assert(bounded.bounded, 'bounded reconstruction did not report a clamp');
  assert(bounded.bounds.time && bounded.bounds.logRadius && bounded.bounds.radius
      && bounded.bounds.axial && bounded.bounds.residual,
  'not every finite reconstruction bound was reported');
  assert(bounded.radiusM <= 2.1 && Math.abs(bounded.axialOffsetM) <= 0.5,
    'bounded reconstruction escaped descriptor limits');
  near(Math.hypot(...bounded.residualM), 0.1, 'residual norm clamp');
});

test('planner assigns each page to exactly one exclusive presentation queue', () => {
  const planner = createParticleCohortPlanner({
    minimumResidencyFrames: 0,
    promotionFrames: 1,
    lateralSwitchFrames: 1,
    sleepingStableFrames: 10,
  });
  const pages = [
    certifiedPage('page.raw', 'raw', { activity: { requiresExplicitState: true } }),
    certifiedPage('page.packed', 'packed'),
    certifiedPage('page.moment', 'moment', {
      capabilities: { moment: true }, certificates: { moment: true },
    }),
    certifiedPage('page.procedural', 'procedural', {
      capabilities: { moment: true, procedural: true },
      certificates: { moment: true, procedural: true },
      branchField,
    }),
    certifiedPage('page.field', 'field', {
      capabilities: { moment: true, field: true },
      certificates: { moment: true, field: true, hasCoarseResidentFieldLevel: true },
    }),
    certifiedPage('page.sleeping', 'sleeping', {
      capabilities: { sleeping: true },
      presentation: { visible: false },
    }),
  ];
  const original = structuredClone(pages);
  const plan = planner.plan(pages, { frameIndex: 0 });
  assert(plan.schema === PARTICLE_COHORT_PLAN_SCHEMA, 'plan schema');
  assert(plan.invariants.exclusive && plan.invariants.assignmentCount === pages.length,
    'queue assignment is incomplete or overlapping');
  for (const queue of PARTICLE_COHORT_PRESENTATION_QUEUES) {
    assert(plan.counts[queue] === 1, `${queue} did not receive exactly one page`);
  }
  assert(new Set(Object.values(plan.queues).flat()).size === pages.length,
    'a page appears in more than one presentation queue');
  assert(plan.decisions.every(decision => (decision.queueBit & (decision.queueBit - 1)) === 0),
    'queue flag is not one-hot');
  assert(plan.decisions.every(decision => decision.authority.simulation === 'particle-storm'
      && decision.authority.canonicalSimulationUnchanged
      && !decision.authority.writesSimulationState
      && !decision.authority.simulationSleeps),
  'presentation plan altered simulation authority');
  assert(plan.decisions.find(decision => decision.queue === 'moment').executionFamily
      === EXECUTION_FAMILY.ORIENTED_KERNEL,
  'moment queue did not reuse the MorphField oriented-kernel family');
  assert(plan.decisions.find(decision => decision.queue === 'field').executionFamily
      === EXECUTION_FAMILY.SPARSE_RESIDUAL,
  'field queue did not reuse the MorphField sparse-residual family');
  assert(plan.decisions.find(decision => decision.queue === 'sleeping').emitsPresentationWork === false,
    'sleeping presentation page still emits render work');
  equal(pages, original, 'planner mutated caller pages');
  assert(Object.isFrozen(plan) && Object.isFrozen(plan.queues.raw), 'plan must be deeply immutable');
});

test('automatic policy selects bounded procedural volumetric moment packed and sleep paths', () => {
  const planner = createParticleCohortPlanner({
    minimumResidencyFrames: 0,
    promotionFrames: 1,
    sleepingStableFrames: 10,
  });
  const plan = planner.plan([
    certifiedPage('auto.raw', 'auto', { activity: { selected: true } }),
    certifiedPage('auto.packed'),
    certifiedPage('auto.moment', 'auto', {
      capabilities: { moment: true }, certificates: { moment: true },
    }),
    certifiedPage('auto.procedural', 'auto', {
      capabilities: { moment: true, procedural: true },
      certificates: { moment: true, procedural: true }, branchField,
    }),
    certifiedPage('auto.field', 'auto', {
      capabilities: { field: true, procedural: true },
      certificates: { field: true, procedural: true, hasCoarseResidentFieldLevel: true },
      presentation: { volumetric: true, screenCoverage: 0.8 }, branchField,
    }),
    certifiedPage('auto.sleep', 'auto', {
      capabilities: { sleeping: true }, presentation: { visible: false },
    }),
  ], { frameIndex: 0 });
  const byId = Object.fromEntries(plan.decisions.map(decision => [decision.pageId, decision.queue]));
  equal(byId, {
    'auto.field': 'field',
    'auto.moment': 'moment',
    'auto.packed': 'packed',
    'auto.procedural': 'procedural',
    'auto.raw': 'raw',
    'auto.sleep': 'sleeping',
  }, 'automatic queue decisions');
});

test('failed approximation certificates fall through to conservative eligible queues', () => {
  const planner = createParticleCohortPlanner({ minimumResidencyFrames: 0, promotionFrames: 1 });
  const plan = planner.plan([
    certifiedPage('bad.procedural', 'procedural', {
      capabilities: { moment: true, procedural: true },
      certificates: { moment: false, procedural: true },
      errors: { proceduralPositionM: 1 },
      branchField,
    }),
    certifiedPage('bad.field', 'field', {
      capabilities: { moment: true, field: true },
      certificates: { moment: true, field: true, hasCoarseResidentFieldLevel: false },
    }),
  ], { frameIndex: 0 });
  const byId = Object.fromEntries(plan.decisions.map(decision => [decision.pageId, decision.queue]));
  assert(byId['bad.procedural'] === 'packed', 'failed procedural gate did not fall through to packed');
  assert(byId['bad.field'] === 'moment', 'uncertified field did not fall through to moment');
});

test('promotion hysteresis is idempotent per frame while error failures demote immediately', () => {
  const planner = createParticleCohortPlanner({
    minimumResidencyFrames: 2,
    promotionFrames: 3,
  });
  const procedural = certifiedPage('hysteresis.page', 'procedural', {
    capabilities: { procedural: true }, certificates: { procedural: true }, branchField,
  });
  let plan = planner.plan([procedural], { frameIndex: 0 });
  assert(plan.decisions[0].queue === 'raw' && plan.decisions[0].candidateFrames === 1,
    'first promotion sample did not remain raw');
  plan = planner.plan([procedural], { frameIndex: 0 });
  assert(plan.decisions[0].candidateFrames === 1, 'same frame counted twice toward hysteresis');
  plan = planner.plan([procedural], { frameIndex: 1 });
  assert(plan.decisions[0].queue === 'raw' && plan.decisions[0].candidateFrames === 2,
    'second promotion sample switched early');
  plan = planner.plan([procedural], { frameIndex: 2 });
  assert(plan.decisions[0].queue === 'procedural' && plan.decisions[0].transition?.to === 'procedural',
    'stable procedural candidate did not promote');
  const invalidProcedural = certifiedPage('hysteresis.page', 'procedural', {
    capabilities: { procedural: true }, certificates: { procedural: true },
    errors: { proceduralPositionM: 1 }, branchField,
  });
  plan = planner.plan([invalidProcedural], { frameIndex: 3 });
  assert(plan.decisions[0].queue === 'packed'
      && plan.decisions[0].transition?.reason.includes('error gate failed'),
  'procedural error did not trigger immediate conservative fallback');
  const interactive = certifiedPage('hysteresis.page', 'procedural', {
    capabilities: { procedural: true }, certificates: { procedural: true },
    activity: { contactCount: 1 }, branchField,
  });
  plan = planner.plan([interactive], { frameIndex: 4 });
  assert(plan.decisions[0].queue === 'raw', 'interaction did not immediately require raw presentation');
  assert(plan.metrics.immediateFallbacks === 2, 'immediate fallback telemetry is inaccurate');
});

test('an invalid current queue cannot bypass promotion gates into a denser approximation', () => {
  const planner = createParticleCohortPlanner({ minimumResidencyFrames: 0, promotionFrames: 1 });
  const moment = certifiedPage('safe.fallback', 'moment', {
    capabilities: { moment: true }, certificates: { moment: true },
  });
  assert(planner.plan([moment], { frameIndex: 0 }).decisions[0].queue === 'moment',
    'test page did not enter moment queue');
  const changed = certifiedPage('safe.fallback', 'procedural', {
    capabilities: { moment: true, procedural: true },
    certificates: { moment: true, procedural: true },
    errors: { momentDensityFraction: 1 },
    branchField,
  });
  const decision = planner.plan([changed], { frameIndex: 1 }).decisions[0];
  assert(decision.requestedQueue === 'procedural' && decision.queue === 'packed',
    'failed Moment jumped directly into a more compressed Procedural queue');
  assert(decision.transition?.reason.includes('error gate failed'),
    'safe fallback did not retain its error-gate reason');
});

test('source revision invalidates compressed history before another promotion', () => {
  const planner = createParticleCohortPlanner({ minimumResidencyFrames: 0, promotionFrames: 1 });
  const procedural = certifiedPage('revision.page', 'procedural', {
    capabilities: { procedural: true }, certificates: { procedural: true }, branchField,
  });
  assert(planner.plan([procedural], { frameIndex: 0 }).decisions[0].queue === 'procedural',
    'initial page did not enter procedural queue');
  const revised = { ...procedural, sourceRevision: 2 };
  const decision = planner.plan([revised], { frameIndex: 1 }).decisions[0];
  assert(decision.queue === 'raw' && decision.revisionReset,
    'source revision did not reset compressed presentation to raw');
  assert(decision.authority.simulation === 'particle-storm',
    'revision reset replaced simulation authority');
});

test('canonical page ordering and retirement telemetry are deterministic', () => {
  const options = { minimumResidencyFrames: 0, promotionFrames: 1 };
  const pages = [
    certifiedPage('z.page', 'packed'),
    certifiedPage('a.page', 'packed'),
    certifiedPage('m.page', 'raw'),
  ];
  const firstPlanner = createParticleCohortPlanner(options);
  const secondPlanner = createParticleCohortPlanner(options);
  const first = firstPlanner.plan(pages, { frameIndex: 0 });
  const second = secondPlanner.plan([...pages].reverse(), { frameIndex: 0 });
  equal(first.decisions, second.decisions, 'canonical decisions depend on caller order');
  equal(first.queues, second.queues, 'queue work lists depend on caller order');
  const afterRetire = firstPlanner.plan([pages[0]], { frameIndex: 1 });
  assert(afterRetire.metrics.retiredPages === 2 && firstPlanner.getTelemetry().activePages === 1,
    'retired planner state leaked');
});

test('invalid descriptors duplicate pages and backwards frames fail closed', () => {
  throws(() => normalizeParticleBranchFieldDescriptor({
    id: 'bad.branch', axis: [0, 0, 0], branchCount: 1, samplesPerBranch: 1,
  }), /axis cannot be zero/, 'zero branch axis');
  throws(() => reconstructParticleBranchFieldSample(branchField, {
    sampleIndex: 99, timeSeconds: 0,
  }), /safe integer/, 'out-of-range branch sample');
  const planner = createParticleCohortPlanner();
  throws(() => planner.plan([
    certifiedPage('duplicate.page'), certifiedPage('duplicate.page'),
  ], { frameIndex: 0 }), /Duplicate particle cohort page/, 'duplicate pages');
  planner.plan([], { frameIndex: 4 });
  throws(() => planner.plan([], { frameIndex: 3 }), /cannot move backwards/, 'backwards frame');
  throws(() => computeParticleCohortMoments([
    { positionM: [0, 0, 0], massKg: 0 },
  ]), /positive total mass/, 'zero total mass');
});


const rows = [];
for (const entry of cases) {
 try { await entry.operation(); rows.push({name:entry.name, passed:true}); }
 catch (error) { rows.push({name:entry.name, passed:false, error:String(error?.stack || error)}); }
}
export const suiteResult = finishSuite('particle-cohorts', rows);
