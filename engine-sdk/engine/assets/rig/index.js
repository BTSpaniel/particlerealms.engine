// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as JointLimitsModule from './JointLimits.js';
import * as RagdollBuilderModule from './RagdollBuilder.js';
import * as RagdollSimModule from './RagdollSim.js';
import * as RagdollSkinningModule from './RagdollSkinning.js';
import * as CharacterPhysicsAssetModule from './CharacterPhysicsAsset.js';
import * as BodyTemplateExportModule from './BodyTemplateExport.js';

export {
  JOINT_TYPE,
  hingeAxis,
  deriveBendDirection,
  deriveJointType,
  deriveSwingCone,
  deriveHingeLimit,
  deriveTwistLimit,
  mirrorLeftRightLimits,
  inferDriveType,
  deriveHumanoidJointLimits,
  deriveSkeletonJointLimits,
  buildJointLimits,
  countTypes,
  validJointTypeSet,
  validateBoneTopology,
} from './JointLimits.js';
export {
  buildRagdoll,
  buildHumanoidRagdoll,
  buildGenericRagdoll,
  radiusRatio,
} from './RagdollBuilder.js';
export { createRagdollSim } from './RagdollSim.js';
export {
  buildSkinnedRagdoll,
  ragdollBoneFrames,
  skinPrimitiveInterleaved,
  logSkinnedRagdoll,
  ragdollDebugStats,
} from './RagdollSkinning.js';
export {
  CHARACTER_PHYSICS_ASSET_SCHEMA_VERSION,
  createCharacterPhysicsAsset,
  validateCharacterPhysicsAsset,
  computeSkeletonFingerprint,
} from './CharacterPhysicsAsset.js';
export { characterPhysicsAssetToBodyTemplate } from './BodyTemplateExport.js';

/**
 * Stable public rig surface for raw modules, Engine.Rig, and bundled PE.Rig.
 * The named groups preserve each source module's boundary while the flat
 * functions keep the existing engine/assets API available without adapters.
 */
export const JointLimits = Object.freeze({ ...JointLimitsModule });
export const RagdollBuilder = Object.freeze({ ...RagdollBuilderModule });
export const RagdollSim = Object.freeze({ ...RagdollSimModule });
export const RagdollSkinning = Object.freeze({ ...RagdollSkinningModule });
export const CharacterPhysicsAsset = Object.freeze({ ...CharacterPhysicsAssetModule });
export const BodyTemplateExport = Object.freeze({ ...BodyTemplateExportModule });

export const Rig = Object.freeze({
  ...JointLimits,
  ...RagdollBuilder,
  ...RagdollSim,
  ...RagdollSkinning,
  ...CharacterPhysicsAsset,
  ...BodyTemplateExport,
  JointLimits,
  RagdollBuilder,
  RagdollSim,
  RagdollSkinning,
  CharacterPhysicsAsset,
  BodyTemplateExport,
});

export default Rig;
