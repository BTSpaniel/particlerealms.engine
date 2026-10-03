// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite, compiledRuntime } from '../resolver.js';
const Bootstrap = await resolveModule("engine/EngineBootstrap.js");
const { Rig: EngineRig } = await resolveModule("engine/EngineImports.js", ["Rig"]);
const Assets = await resolveModule("engine/assets/index.js");
const RigModule = await resolveModule("engine/assets/rig/index.js");

const results = document.querySelector('#results');
const passes = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  assert(left === right, `${message}: expected ${right}, received ${left}`);
}

const rows = [];
async function test(name, operation) {
 try { await operation(); rows.push({name, passed:true}); }
 catch (error) { rows.push({name, passed:false, error:String(error?.stack || error)}); }
}

await test('native modules share one public Rig identity and preserve Assets', () => {
  assert(Bootstrap.Rig === RigModule.Rig, 'EngineBootstrap.Rig is not the native rig barrel identity');
  assert(Bootstrap.particleRig === RigModule.Rig, 'EngineBootstrap.particleRig changed identity');
  assert(Bootstrap.Engine.Rig === RigModule.Rig, 'Engine.Rig changed identity');
  assert(Bootstrap.Assets === Assets, 'EngineBootstrap.Assets is not the assets barrel identity');
  assert(EngineRig === RigModule.Rig, 'EngineImports.Rig is not the native rig barrel identity');
  assert(Assets.Rig === RigModule.Rig, 'legacy Assets.Rig is missing or wrapped');
  assert(!Object.hasOwn(Bootstrap, 'createRagdollSim'), 'rig API polluted the PE root surface');

  for (const [family, api] of [
    ['JointLimits', 'buildJointLimits'],
    ['RagdollBuilder', 'buildRagdoll'],
    ['RagdollSim', 'createRagdollSim'],
    ['RagdollSkinning', 'buildSkinnedRagdoll'],
  ]) {
    assert(typeof RigModule.Rig[family]?.[api] === 'function', `Rig.${family}.${api} is missing`);
    assert(RigModule.Rig[family][api] === RigModule[api], `Rig.${family}.${api} is not the flat API identity`);
    assert(RigModule.Rig[api] === RigModule[api], `Rig.${api} flat compatibility surface is missing`);
  }
});

await test('public RagdollSim produces a deterministic finite step', () => {
  const ragdoll = {
    bones: [
      { name: 'root', position: [0, 2, 0], parentIndex: -1 },
      { name: 'child', position: [1, 2, 0], parentIndex: 0 },
    ],
  };
  const options = {
    gravity: [0, -9.8, 0],
    ground: null,
    damping: 0.995,
    iterations: 3,
    substeps: 2,
    maxSubDt: 1 / 240,
    maxFrameDt: 0.05,
    warmupTime: 0,
    selfCollision: false,
  };
  const first = EngineRig.RagdollSim.createRagdollSim(ragdoll, options);
  const second = RigModule.createRagdollSim(ragdoll, options);

  for (const dt of [1 / 60, 1 / 120, 0.01]) {
    first.step(dt);
    second.step(dt);
  }

  equal(first.positions(), second.positions(), 'identical public entry points diverged');
  equal(first.stats(), second.stats(), 'deterministic step telemetry diverged');
  assert(first.positions().flat().every(Number.isFinite), 'simulation emitted a non-finite coordinate');
  assert(first.positions()[0][1] < ragdoll.bones[0].position[1], 'gravity did not advance the rig');
  assert(first.stats().substeps > 0 && first.stats().nanRecoveries === 0,
    'deterministic step reported invalid telemetry');
});


export const suiteResult = finishSuite('rig-public', rows);
