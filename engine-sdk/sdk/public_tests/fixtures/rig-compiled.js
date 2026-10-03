// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite, compiledRuntime } from '../resolver.js';
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

await test('compiled PE exposes the namespaced rig surface without flat pollution', () => {
  assert(PE && typeof PE === 'object', 'compiled bundle did not create window.PE');
  assert(PE.Rig === PE.particleRig, 'PE.Rig and PE.particleRig changed identity');
  assert(PE.Engine?.Rig === PE.Rig, 'PE.Engine.Rig changed identity');
  assert(PE.Assets?.Rig === PE.Rig, 'legacy PE.Assets.Rig changed identity');
  assert(PE.Assets?.createRagdollSim === PE.Rig.createRagdollSim,
    'legacy PE.Assets flat rig API changed identity');
  assert(!Object.prototype.hasOwnProperty.call(PE, 'createRagdollSim'),
    'createRagdollSim polluted the top-level compiled PE surface');

  for (const [family, api] of [
    ['JointLimits', 'buildJointLimits'],
    ['RagdollBuilder', 'buildRagdoll'],
    ['RagdollSim', 'createRagdollSim'],
    ['RagdollSkinning', 'buildSkinnedRagdoll'],
  ]) {
    assert(typeof PE.Rig[family]?.[api] === 'function', `PE.Rig.${family}.${api} is missing`);
    assert(PE.Rig[family][api] === PE.Rig[api], `PE.Rig.${family}.${api} changed flat identity`);
  }
});

await test('compiled PE.Rig RagdollSim steps deterministically', () => {
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
  const first = PE.Rig.RagdollSim.createRagdollSim(ragdoll, options);
  const second = PE.Assets.createRagdollSim(ragdoll, options);

  for (const dt of [1 / 60, 1 / 120, 0.01]) {
    first.step(dt);
    second.step(dt);
  }

  equal(first.positions(), second.positions(), 'compiled rig entry points diverged');
  equal(first.stats(), second.stats(), 'compiled deterministic telemetry diverged');
  assert(first.positions().flat().every(Number.isFinite), 'compiled simulation emitted a non-finite coordinate');
  assert(first.positions()[0][1] < ragdoll.bones[0].position[1], 'compiled simulation did not advance');
  assert(first.stats().substeps > 0 && first.stats().nanRecoveries === 0,
    'compiled simulation reported invalid telemetry');
});


export const suiteResult = finishSuite('rig-public', rows);
