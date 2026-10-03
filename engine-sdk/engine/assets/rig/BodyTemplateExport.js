// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/BodyTemplateExport.js — turn a generated `CharacterPhysicsAsset`
// into a starting-point `life.body.v1`-shaped body template JSON (the schema
// `Life/data/bodies/*.json` + `engine/assets/rig/active-body/BodyAssembler.js` consume).
//
// This mirrors how every mainstream engine handles the generated-vs-hand-authored
// split (Unreal's Physics Asset auto-generate, Unity's Ragdoll Wizard, Godot's
// "Create Physical Skeleton"): the generator produces a complete, valid
// STARTING POINT for skeleton/joint/collision structure — never silently
// re-applied over hand-tuned data afterward. A dev generates this once for a
// new creature/character variant, saves it as a plain JSON file, and hand-tunes
// gameplay-only concerns on top (anatomy/organs, ligaments, muscle model,
// strength/mass presets) that have no generator and are intentionally
// hand-authored. This is the "easy for devs to achieve anything" on-ramp:
// zero-authoring skeleton for a new body, full hand-tuning power afterward.

// Generic per-joint-type defaults — the same conservative values already
// established in Life/data/bodies/humanoid_default.json's `joints`/`drives`
// blocks, reused here so a freshly generated template matches the house style
// a dev can then override per-bone via `bones[i].limits`.
const DEFAULT_JOINT_TYPE_LIMITS = {
  ball: { semantics: 'cone_swing_with_limited_twist', axes: ['swing1', 'swing2', 'twist'], swingDeg: 60, twistDeg: 30, compliance: 0.0001 },
  hinge: { semantics: 'single_axis_flexion_extension', axes: ['twist'], swingDeg: 0, twistDeg: 140, compliance: 0.0001 },
  saddle: { semantics: 'two_axis_swing_with_small_twist', axes: ['swing1', 'swing2'], swingDeg: 30, twistDeg: 20, compliance: 0.0002 },
  twist: { semantics: 'spinal_axial_twist_with_small_swing', axes: ['twist', 'swing1', 'swing2'], swingDeg: 15, twistDeg: 25, compliance: 0.0003 },
};

const DEFAULT_JOINT_TYPE_DRIVES = {
  ball: { driveMode: 'force', stiffness: 350, damping: 20, maxForce: 75 },
  hinge: { driveMode: 'force', stiffness: 400, damping: 25, maxForce: 60 },
  saddle: { driveMode: 'force', stiffness: 200, damping: 15, maxForce: 40 },
  twist: { driveMode: 'force', stiffness: 300, damping: 20, maxForce: 50 },
};

function sideOf(slotOrId) {
  if (/^left/.test(slotOrId)) return 'left';
  if (/^right/.test(slotOrId)) return 'right';
  return null;
}

/**
 * Convert a `CharacterPhysicsAsset` (from `createCharacterPhysicsAsset()`) into
 * a `life.body.v1` body template — a ready-to-save JSON starting point for a
 * new creature/character variant. Only the skeleton/joint/collision structure
 * is generated; `anatomy`/`ligaments`/`muscleModel`/`presets` are left as
 * explicit, clearly-commented empty stubs since no generator authors those —
 * every mainstream engine's ragdoll generator stops at the same boundary.
 * @param {object} asset CharacterPhysicsAsset (createCharacterPhysicsAsset output)
 * @param {object} [opts]
 * @param {string} [opts.id] template id (default: derived from asset.source)
 * @param {string} [opts.name] display name
 * @param {string} [opts.description]
 * @returns {object} life.body.v1-shaped body template
 */
export function characterPhysicsAssetToBodyTemplate(asset, opts = {}) {
  const bodyDefs = Array.isArray(asset?.bodyDefs) ? asset.bodyDefs : [];
  const jointByChildIndex = new Map((asset?.jointDefs || []).map((j) => [j.childIndex, j]));

  const bones = bodyDefs.map((bone) => {
    const slotOrId = bone.slot || bone.id;
    const parent = bone.parentIndex >= 0 ? (bodyDefs[bone.parentIndex].slot || bodyDefs[bone.parentIndex].id) : null;
    const joint = jointByChildIndex.get(bone.index);
    const out = {
      id: slotOrId,
      parent,
      part: null, // no visual-mesh part catalog entry — dev assigns one, or leaves collision synthesized
      side: sideOf(slotOrId),
      joint: joint ? joint.jointType : 'root',
      collisionGroup: bone.collisionGroup || null,
    };
    if (joint) {
      out.limits = {
        swingDeg: joint.swingDeg,
        twistDeg: joint.twistDeg,
        compliance: DEFAULT_JOINT_TYPE_LIMITS[joint.jointType]?.compliance ?? 0.0001,
      };
    }
    return out;
  });

  const collisionRules = {
    description: 'Self-collision exclusion. Adjacent bones never collide (handled by parent-child rule). Generated pairs below come from RagdollBuilder\'s default policy (direct parent/child capsules overlap at the joint) — add more as needed.',
    ignorePairs: (asset?.collisionFilters || []).map(([a, b]) => [a, b]),
    ignoreGroupsActive: {
      description: 'Group pairs that don\'t collide while the body is in active mode. Re-enabled in ragdoll/KO state. Empty by default — a generated skeleton has no collision groups assigned beyond per-bone collisionGroup.',
      pairs: [],
    },
  };

  return {
    schema: 'life.body.v1',
    id: opts.id || `generated_${asset?.source || 'body'}`,
    name: opts.name || 'Generated Body (starting point)',
    description: opts.description || 'Auto-generated from CharacterPhysicsAsset via characterPhysicsAssetToBodyTemplate() — skeleton/joint/collision structure only. Hand-tune anatomy, ligaments, muscleModel, and presets below before shipping.',

    bones,

    // No generator authors these — hand-tune per creature. See
    // Life/data/bodies/humanoid_default.json for a fully hand-tuned reference.
    anatomy: { thorax: {}, organs: {}, collisionShells: {} },
    skeletonExtensions: { mode: 'none', spineSegments: [], structuralBones: [], legDescriptors: [], sensorAnchors: [] },
    boneAliases: {},

    collisionRules,

    joints: { ...DEFAULT_JOINT_TYPE_LIMITS },
    drives: { ...DEFAULT_JOINT_TYPE_DRIVES },
    ligaments: {
      description: 'Passive soft-stop metadata for future ligament fatigue and compliance models.',
      default: { passiveStiffness: 0.35, fatigueRate: 0.02, recoveryRate: 0.01 },
    },
    muscleModel: null,
    presets: { HumanAverage: { strengthMul: 1, massMul: 1 } },
  };
}
