// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ActiveBodySystem — Motor-driven PBD active ragdoll for all NPCs.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   HIGH-LEVEL ARCHITECTURE  (for any AI or human reading this file)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The system is organized in FOUR stacked layers. Each has a specific role
 * and you should not confuse them when modifying. Read top-to-bottom before
 * making changes:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 1. STATE MACHINE (updateState)                                │
 *   │    idle → locomotion → stumble → fallen → getup → ko          │
 *   │    Transitions based on physics (pelvis Y, stillness, etc)    │
 *   │    Getup exit MUST be physics-based (pelvis.y > 1.5 AND       │
 *   │    |v| < 2), NOT based on target verticality — or body        │
 *   │    ping-pongs between fallen and getup forever.               │
 *   └──────────────────────────────────────────────────────────────┘
 *                             │
 *   ┌──────────────────────────▼───────────────────────────────────┐
 *   │ 2. POSE AUTHORITY (applyGetupController / applyStanding)     │
 *   │    Produces per-bone world-space TARGET positions.            │
 *   │                                                                │
 *   │    Getup uses VERTICALITY SCALE (0=flat, 50=standing).        │
 *   │    Poses tagged with verticality score (see BodyPoses.js):    │
 *   │      prone=0 → pushup=15 → quadruped=25 → kneel=35 →          │
 *   │      half_kneel=45 → stand=50                                  │
 *   │    Target verticality ramps at 15 units/sec; pose library     │
 *   │    blends the two adjacent ladder poses at each score.        │
 *   │    Continuous blend space instead of discrete phase timer.    │
 *   └──────────────────────────────────────────────────────────────┘
 *                             │
 *   ┌──────────────────────────▼───────────────────────────────────┐
 *   │ 3. NEURAL RESIDUAL (NN offsets from NeuralMotor.js)          │
 *   │    NN adds ±8cm position RESIDUALS to kinematic targets.      │
 *   │    Trained via AWR (Advantage-Weighted Regression).           │
 *   │    NN is *learned refinement*, NOT a replacement for the      │
 *   │    motor. Even at 100% "trust" it only nudges positions a     │
 *   │    few cm — the force that lifts the body still comes from    │
 *   │    the PD motor below. See NeuralMotor.js for full details.   │
 *   │                                                                │
 *   │    targets_final = targets_kinematic + NN_residual × trust    │
 *   └──────────────────────────────────────────────────────────────┘
 *                             │
 *   ┌──────────────────────────▼───────────────────────────────────┐
 *   │ 4. PHYSICS MOTOR (applyKinematicBlend in BodyPoses.js)       │
 *   │    4 stacked layers:                                          │
 *   │      a. Soft position nudge (kinematic lerp, small)           │
 *   │      b. Velocity-clamped pursuit (capped at muscleSpeed)      │
 *   │      c. Mass-scaled PD force: Kp=m·ω², Kd=2m·ω·ζ              │
 *   │      d. Muscle-tone gravity compensation (75% for posture)    │
 *   │    Per-bone force rise-rate filter (real muscle activation).  │
 *   │    Error-gated damping kills steady-state oscillation.        │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *   CRITICAL INVARIANTS — do not break these
 * ══════════════════════════════════════════════════════════════════════
 *
 *   • Kinematic motor ALWAYS runs at full force during getup. Scaling
 *     motor force by (1 - NN_trust) breaks the body because the NN
 *     can't generate force, only position offsets. This is the
 *     DeepMimic/DReCon "residual policy" — look it up.
 *
 *   • Force values are CALIBRATED to real human biomechanics:
 *       forcePerKg = 15 × g   (untrained adult, not Olympic)
 *       forceRiseRate = 1200 N/s  (normal RFD)
 *       Per-bone rise multipliers — legs slower than arms (EMG data)
 *     If you bump these to "fix" behavior you may be hiding a bug.
 *
 *   • Getup exit: pelvisY > 1.5 AND |v| < 2.0. Exiting based on target
 *     verticality fires while body is still on the floor.
 *
 *   • Spine ROTATION is locked via X-bracing constraints (computeHingeLimits).
 *     DO NOT loosen without understanding why it exists — without these
 *     the torso spins 360° during any impact.
 *
 *   • Brain seeds are deterministic from entity ID via FNV-1a hash.
 *     'player' always gets the same initial brain. Saved brains load
 *     back into the same NN exactly.
 *
 *   • Brain tiers: tiny(41KB) small(130KB) medium(1.2MB) large(6.6MB)
 *     huge(10MB). Player defaults to medium. 10MB per-brain cap enforced
 *     at serialize-time. Upgrades use Net2Net weight transplant —
 *     preserves learned behavior.
 *
 * ══════════════════════════════════════════════════════════════════════
 *
 * Based on the Active Ragdoll Integration Dossier:
 *   - PD joint drives with torque limits per bone (Harbo baselines)
 *   - COM-based balance tracking (Winter mass fractions)
 *   - State machine: IdleBalanced → Locomotion → Stumble → Fallen → GetUp → KO
 *   - Gravity always on — joints fight gravity with drive forces
 *   - Per-bone frequency/damping from Omniverse stability guide
 *
 * Drive formula (acceleration mode):
 *   k = ω²  where ω = 2π·frequencyHz
 *   c = 2·ζ·ω
 *   F = k·(target - pos) + c·(0 - vel), clamped to maxTorque
 */

import { PBDRagdoll, RagdollBone, RagdollState, DEFAULT_MEASUREMENTS } from '../../../sim/physics/PBDRagdoll.js'
import { PBDSolver } from '../../../sim/physics/PBDSolver.js'
import { loadBodyTemplate, assembleBody } from './BodyAssembler.js'
import {
  preloadStandardPoses,
  getCachedPose,
  getCachedSequence,
  getSequenceState,
  getPoseWorldTargets,
  getPoseWorldPoseTargets,
  getWalkCycleWorldTargets,
  getWalkCycleWorldPoseTargets,
  blendPositionTargetMaps,
  blendWorldPoseTargets,
  interpolatePoses,
  applyMotorToTargets,
  applyKinematicBlend,
  getPoseAtVerticality,
  getPoseTargetsAtVerticality,
  measureBodyVerticality,
} from './BodyPoses.js'
import {
  createNeuralMotor,
  buildObservation,
  neuralMotorForward,
  trainNeuralMotor,
  applyNeuralOffsets,
  computeTeacherSignal,
  computeReward,
  getNeuralInferenceBackendReport,
  getNeuralMotorDebugReport,
  STATE_INTENTS,
  serializeMotor,
  deserializeMotor,
  saveBrain,
  loadBrain,
  deleteBrain,
  listBrains,
  exportBrainAsJson,
  exportBrainAsCompressedJson,
  importBrainFromJson,
  importBrainFromJsonAsync,
  analyzeMotorStorage,
  upgradeBrain,
  getUpgradeOptions,
  BRAIN_TIERS,
  OBS_SIZE,
  ACTION_SIZE,
  BONE_ORDER,
  TIER_LADDER,
  INTELLIGENCE_TIERS,
  tierFromIntelligence,
  nextTier,
} from './NeuralMotor.js'
import {
  createRhythmState,
  stepRhythms,
  rhythmSample,
  RHYTHM,
} from './BodyRhythms.js'
import {
  createAniMotionPriorState,
  getAniMotionPriorReport,
  loadAniMotionPrior,
  mixAniMotionTeacher,
} from './MotionPriorTraining.js'
import {
  createDiaphragmState,
  stepDiaphragm,
  getDiaphragmReadback,
} from './anatomy/DiaphragmSystem.js'
import { getBreathingBodyCouplingReadback } from './anatomy/BreathingBodyCoupling.js'
import {
  createOrganState,
  getOrganReadback,
} from './anatomy/OrganSystem.js'
import {
  createVitalSignsState,
  stepVitalSigns,
  getVitalSignsReadback,
} from './anatomy/VitalSigns.js'
import {
  createBioelectricSignalState,
  stepBioelectricSignals,
  getBioelectricSignalReadback,
} from './anatomy/BioelectricSignals.js'
import {
  createSoftTissueState,
  stepSoftTissue,
  getSoftTissueReadback,
  sampleSoftTissueBoneMotion,
} from './anatomy/SoftTissueSystem.js'
import {
  createCirculatoryState,
  stepCirculation,
  getCirculatoryReadback,
  getCirculationGraphReadback,
} from './anatomy/CirculatorySystem.js'
import {
  createPBPKState,
  addPBPKDose,
  stepPBPK,
  getPBPKReadback,
} from './anatomy/PBPKSystem.js'
import {
  createOrganDamageState,
  applyOrganDamage,
  stepOrganDamage,
  getOrganDamageReadback,
} from './anatomy/OrganDamageSystem.js'
import {
  createNervousSystemState,
  stepNervousSystem,
  getNervousSystemReadback,
  getNerveGraphReadback,
} from './anatomy/NervousSystem.js'
import { applyNeuroJerks } from './NeuroModifiers.js'
import { getActiveBodyPerformanceBudgetReport } from './ActiveBodyPerformanceBudgets.js'
import { getActiveBodyFallbackReport } from './ActiveBodyFallbackReport.js'
import { buildActiveBodySimulationTierReport, estimateActiveBodyImportance } from './ActiveBodySimulationTiers.js'
import { DEFAULT_POSE_STATES, resolveRequestedPoseState } from '../../../sim/physics/rig/PoseStateGraph.js'

import {
  animalBoneRadius,
  animalVerticalScaleFor,
  cloneAnimalSkeleton,
  createAnimalAnatomySpec,
  createAnimalBrainProfile,
  createAnimalPbdRagdoll,
  isAnimalDebugTarget,
  logAnimalActiveBodyTrace,
  stepAnimalActiveBody,
} from './AnimalLocomotion.js'
import {
  FOOT_PARTICLE_CONTACT_HEIGHT,
  FOOT_PARTICLE_SOLE_HEIGHT,
  buildContactTelemetry,
  clampSurfaceFriction,
  copyContactTelemetry,
  copySensorAnchorTelemetry,
  enforceGroundContact,
  logContactTrace,
  makeContactOverlay,
  scaledAnimalContactWindow,
} from './ContactTelemetry.js'
import {
  copyMotorAuthorityMap,
  copyReflexState,
  copyRotationResidualSummary,
  copyRotationTargetSummary,
  getSupportFootBoneIds,
  makeComOverlay,
  makeFatigueOverlay,
  makeJointErrorOverlay,
  makeOrganStatusOverlay,
  makeOverlayToggleMap,
  makePoseTargetOverlay,
  makeSupportOverlay,
  resolveOverlayToggle,
} from './DebugOverlay.js'
import {
  computeBalance,
  copyBalanceState,
  makeBalanceState,
  updateState,
} from './BalanceMotor.js'
import {
  computeNeuralRotationResidualHints,
  dampIdleNeuralOffsets,
  extractRotationTargets,
} from './NeuralResidualController.js'
import {
  makeUniversalLegSchedulerReadback,
} from './UniversalLegScheduler.js'
import {
  boneNameForParticle,
  buildDirectionDiagnostics,
  dot2,
  normalize2,
  updateDirectionMotion,
} from './DirectionDiagnostics.js'
import {
  applyBodySpecMetadata,
  createHumanoidBrainProfile,
  ensureBrainLoaded,
  estimateNeuralMotorTrust,
  getAnatomyReadback,
  getBrainReadback,
} from './BrainProfile.js'
import {
  applyHingeLimits,
  buildWalkingSkeleton,
  computeHingeLimits,
  currentPelvisPosition,
  setRagdollPose,
} from './PhysicsMotor.js'
import {
  auditAllPoses,
  logFinalDirectionAudit,
  logLocomotionTargetTrace,
  logOrientationAudit,
} from './OrientationAudit.js'
import {
  applyGetupController,
  applyGroundedNoIntentSettleBrake,
  applyStandingController,
  buildMotorAuthorityMap,
  getBoneRadius,
  makePoseStateMeta,
  makeReflexState,
  resolveActivePoseState,
  stabilizeHeadNeckFrame,
  stabilizeLimbSideFrame,
  stabilizeShoulderGirdleFrame,
} from './PoseAuthority.js'

// Bone name → RagdollBone ID mapping for readback
const BONE_NAMES = [
  'pelvis', 'spine', 'spine1', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftForearm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightForearm', 'rightHand',
  'leftThigh', 'leftShin', 'leftFoot',
  'rightThigh', 'rightShin', 'rightFoot',
]


const DEFAULT_FUNCTIONAL_SENSOR_ANCHORS = Object.freeze([
  { id: 'leftHeel', role: 'heel', side: 'left', parent: 'leftFoot', driverBone: 'leftFoot', referenceBone: 'leftShin', scaleBy: 'footLength', localOffset: [0, 0, -0.42], source: 'approximateFromDriver' },
  { id: 'leftSole', role: 'sole', side: 'left', parent: 'leftFoot', driverBone: 'leftFoot', referenceBone: 'leftShin', scaleBy: 'footLength', localOffset: [0, 0, 0], source: 'approximateFromDriver' },
  { id: 'leftToeBase', role: 'toeBase', side: 'left', parent: 'leftFoot', driverBone: 'leftFoot', referenceBone: 'leftShin', scaleBy: 'footLength', localOffset: [0, 0, 0.28], source: 'approximateFromDriver' },
  { id: 'leftToeTip', role: 'toeTip', side: 'left', parent: 'leftFoot', driverBone: 'leftFoot', referenceBone: 'leftShin', scaleBy: 'footLength', localOffset: [0, 0, 0.58], source: 'approximateFromDriver' },
  { id: 'rightHeel', role: 'heel', side: 'right', parent: 'rightFoot', driverBone: 'rightFoot', referenceBone: 'rightShin', scaleBy: 'footLength', localOffset: [0, 0, -0.42], source: 'approximateFromDriver' },
  { id: 'rightSole', role: 'sole', side: 'right', parent: 'rightFoot', driverBone: 'rightFoot', referenceBone: 'rightShin', scaleBy: 'footLength', localOffset: [0, 0, 0], source: 'approximateFromDriver' },
  { id: 'rightToeBase', role: 'toeBase', side: 'right', parent: 'rightFoot', driverBone: 'rightFoot', referenceBone: 'rightShin', scaleBy: 'footLength', localOffset: [0, 0, 0.28], source: 'approximateFromDriver' },
  { id: 'rightToeTip', role: 'toeTip', side: 'right', parent: 'rightFoot', driverBone: 'rightFoot', referenceBone: 'rightShin', scaleBy: 'footLength', localOffset: [0, 0, 0.58], source: 'approximateFromDriver' },
  { id: 'leftPalm', role: 'palm', side: 'left', parent: 'leftHand', driverBone: 'leftHand', referenceBone: 'leftForearm', scaleBy: 'handLength', localOffset: [0, 0, 0], source: 'approximateFromDriver' },
  { id: 'leftThumbTip', role: 'thumbTip', side: 'left', parent: 'leftHand', driverBone: 'leftHand', referenceBone: 'leftForearm', scaleBy: 'handLength', localOffset: [-0.34, 0, 0.42], source: 'approximateFromDriver' },
  { id: 'leftIndexTip', role: 'fingerTip', side: 'left', parent: 'leftHand', driverBone: 'leftHand', referenceBone: 'leftForearm', scaleBy: 'handLength', localOffset: [-0.12, 0, 0.66], source: 'approximateFromDriver' },
  { id: 'leftMiddleTip', role: 'fingerTip', side: 'left', parent: 'leftHand', driverBone: 'leftHand', referenceBone: 'leftForearm', scaleBy: 'handLength', localOffset: [0.12, 0, 0.66], source: 'approximateFromDriver' },
  { id: 'rightPalm', role: 'palm', side: 'right', parent: 'rightHand', driverBone: 'rightHand', referenceBone: 'rightForearm', scaleBy: 'handLength', localOffset: [0, 0, 0], source: 'approximateFromDriver' },
  { id: 'rightThumbTip', role: 'thumbTip', side: 'right', parent: 'rightHand', driverBone: 'rightHand', referenceBone: 'rightForearm', scaleBy: 'handLength', localOffset: [0.34, 0, 0.42], source: 'approximateFromDriver' },
  { id: 'rightIndexTip', role: 'fingerTip', side: 'right', parent: 'rightHand', driverBone: 'rightHand', referenceBone: 'rightForearm', scaleBy: 'handLength', localOffset: [0.12, 0, 0.66], source: 'approximateFromDriver' },
  { id: 'rightMiddleTip', role: 'fingerTip', side: 'right', parent: 'rightHand', driverBone: 'rightHand', referenceBone: 'rightForearm', scaleBy: 'handLength', localOffset: [-0.12, 0, 0.66], source: 'approximateFromDriver' },
])

function resolveFunctionalSensorAnchors(bodySpec = null, fallback = null) {
  const source = (Array.isArray(fallback) && fallback.length > 0)
    ? fallback
    : (bodySpec?.sensorAnchors || bodySpec?.skeletonExtensions?.sensorAnchors || DEFAULT_FUNCTIONAL_SENSOR_ANCHORS)
  return source.map(copyFunctionalSensorAnchor)
}

function copyFunctionalSensorAnchor(anchor) {
  return {
    ...anchor,
    localOffset: Array.isArray(anchor.localOffset) ? [...anchor.localOffset] : [0, 0, 0],
  }
}












export class ActiveBodySystem {
  constructor() {
    this.status = 'ready'
    this._bodies = new Map()
    this.frameCount = 0
    this.groundY = 0
    this._bodySpec = null            // Cached ragdoll spec from BodyAssembler
    this._partCatalog = null
    this._aniMotionPrior = createAniMotionPriorState()
    // ─── PACER SENSORS (optional) ─────────────────────────────────────
    // External systems inject these so the NN can see terrain + crowd.
    // - heightAt(wx, wz) → ground Y (world-space meters). Used for the 4
    //   terrain observation dims. When null, obs[43..46] stay 0 (NN treats
    //   world as flat). GameSetup wires this to GameWorld.getTopSolid.
    // - nearestAgent(entityId, wx, wz) → { dx, dz, dvx, dvz } | null for
    //   the nearest OTHER active body within ~3m. When null, obs[47..50]
    //   stay 0 (NN treats space as empty).
    this._sensors = null
    this._debugOverlayToggles = makeOverlayToggleMap()
  }

  /**
   * Inject PACER sensors. See constructor for shape. Pass `null` to clear.
   * Called once at startup from GameSetup.
   */
  setSensors(sensors) {
    this._sensors = sensors || null
  }

  setDebugOverlayToggles(toggles = {}) {
    this._debugOverlayToggles = makeOverlayToggleMap(toggles, this._debugOverlayToggles)
    return this.getDebugOverlayToggles()
  }

  getDebugOverlayToggles() {
    return makeOverlayToggleMap(this._debugOverlayToggles)
  }

  /**
   * Build the per-frame sensors packet for one body: terrain heightAt(x,z)
   * closure + the nearest-agent lookup resolved NOW. Returns null when no
   * sensors are registered — NN obs will then default to "flat + empty".
   *
   * @private
   */
  _buildFrameSensors(entry) {
    const pel = entry.ragdoll?.bones?.[0]?.particle
    if (!pel) return null

    const heightAt = this._sensors?.heightAt
    const surfaceAt = this._sensors?.surfaceAt

    // Nearest-agent: linear scan over other bodies, keep closest within
    // SOCIAL_RADIUS. We read from ragdoll.bones[0] (pelvis) for each
    // candidate — world position is live, no caching needed at this scale.
    const SOCIAL_RADIUS = 3.0          // meters — matches PACER's perception range
    const SOCIAL_RADIUS_SQ = SOCIAL_RADIUS * SOCIAL_RADIUS
    let bestDSq = SOCIAL_RADIUS_SQ
    let best = null
    for (const [, other] of this._bodies) {
      if (other === entry) continue
      const op = other.ragdoll?.bones?.[0]?.particle
      if (!op) continue
      const dx = op.x - pel.x
      const dz = op.z - pel.z
      const dSq = dx * dx + dz * dz
      if (dSq < bestDSq) {
        bestDSq = dSq
        best = {
          dx, dz,
          dvx: (op.vx ?? 0) - (pel.vx ?? 0),
          dvz: (op.vz ?? 0) - (pel.vz ?? 0),
        }
      }
    }

    return {
      heightAt,
      surfaceAt,
      nearestAgent: best,
      contactTelemetry: copyContactTelemetry(entry.contactTelemetry),
      balanceState: copyBalanceState(entry.balanceState),
    }
  }

  /**
   * Initialize with a part catalog. Loads body template and assembles spec.
   * Call this once at startup, before adding bodies.
   * @param {object} partCatalog - From data/PartCatalog.loadPartCatalog()
   */
  async init(partCatalog = null) {
    this._partCatalog = partCatalog
    if (partCatalog) {
      try {
        const template = await loadBodyTemplate()
        this._bodySpec = assembleBody(template, partCatalog, { preset: 'HumanAverage' })
        for (const entry of this._bodies.values()) applyBodySpecMetadata(entry, this._bodySpec)
        console.info(`[ActiveBodySystem] body spec assembled: ${this._bodySpec.bones.length} bones, ${this._bodySpec.ignorePairs.size} ignore pairs`)
      } catch (err) {
        console.warn('[ActiveBodySystem] body spec failed to load:', err.message)
      }
    }
    // Preload pose library (stand, kneel, pushup) + getup sequence
    try {
      await preloadStandardPoses()
      console.info('[ActiveBodySystem] pose library loaded: stand, kneel, pushup, prone + getup sequences')
      // Audit each pose for directional consistency (knees bend forward,
      // elbows don't invert, toes point forward, belly points down for
      // prone/pushup, up for stand/kneel, etc.)
      auditAllPoses()
    } catch (err) {
      console.warn('[ActiveBodySystem] pose library failed to load:', err.message)
    }
    this.loadAniMotionPrior().then(report => {
      if (report.clips > 0) console.info(`[ActiveBodySystem] ani motion prior loaded: ${report.clips}/${report.totalFiles} clips`)
    }).catch(() => {})
    return true
  }

  /** Returns the assembled ragdoll spec (or null if init wasn't called with a catalog). */
  getBodySpec() { return this._bodySpec }

  loadAniMotionPrior(options = {}) {
    return loadAniMotionPrior(this._aniMotionPrior, options)
  }

  getAniMotionPriorReport() {
    return getAniMotionPriorReport(this._aniMotionPrior)
  }

  /**
   * Build collision filter options for PBDRagdoll._solveCollisions().
   * @param {boolean} activeMode - if true, applies group-level exclusions
   * @returns {object} filter options
   */
  _buildCollisionFilter(activeMode) {
    const spec = this._bodySpec
    if (!spec) return {}
    const ignoreGroupsActive = activeMode && spec.ignoreGroupsActive?.has('arm|leg')
      ? new Set([...spec.ignoreGroupsActive].filter(pair => pair !== 'arm|leg'))
      : spec.ignoreGroupsActive
    return {
      ignorePairs: spec.ignorePairs,
      ignoreGroupsActive,
      groupByBone: spec.groupByBone,
      activeMode: !!activeMode,
    }
  }

  // ─── ADD / REMOVE BODIES ────────────────────────────────────────────────

  _addAnimalBody(entityId, worldPosition = [0, 0, 0], options = {}) {
    const skeleton = cloneAnimalSkeleton(options.animalSkeleton)
    if (!skeleton?.bones?.length) return false
    const scale = options.scale || 1.0
    const verticalScale = animalVerticalScaleFor(skeleton, scale)
    const facing = options.facing ?? 0
    const ragdoll = createAnimalPbdRagdoll(skeleton, worldPosition, { scale, verticalScale, facing })
    const root = ragdoll.bones[0]?.particle
    const sensorAnchors = Array.isArray(skeleton.sensorAnchors)
      ? skeleton.sensorAnchors.map(copyFunctionalSensorAnchor)
      : []
    const anatomy = createAnimalAnatomySpec(skeleton)
    const brainProfile = createAnimalBrainProfile(skeleton, options, entityId)
    const neuralMotor = createNeuralMotor(brainProfile.tier, entityId)
    const entry = {
      entityId,
      bodyKind: 'animal',
      animalSkeleton: skeleton,
      ragdoll,
      measurements: {
        height: scale,
        footLength: scale * 0.16,
      },
      anchorPosition: [root?.x ?? worldPosition[0], worldPosition[1] || 0, root?.z ?? worldPosition[2]],
      navState: { velocity: [0, 0], walkPhase: 0, facing, speed: 0 },
      scale,
      verticalScale,
      state: 'idle',
      balanceError: 0,
      groundedFeet: 0,
      stateTimer: 0,
      fallenStillTime: 0,
      lastPelvisPos: [root?.x ?? worldPosition[0], root?.y ?? worldPosition[1] ?? 0, root?.z ?? worldPosition[2]],
      directionMotion: null,
      _directionLastPelvis: null,
      _directionMotionClock: 0,
      _directionMotionSamples: [],
      getupYaw: facing,
      getupFaceUp: false,
      getupAnchor: [...worldPosition],
      preset: options.preset || skeleton.profileId || 'animal',
      bodySpec: null,
      anatomy,
      anatomyAttachments: null,
      diaphragm: createDiaphragmState(anatomy),
      organs: createOrganState(anatomy, null),
      vitalSigns: createVitalSignsState(),
      bioelectricSignals: createBioelectricSignalState(),
      softTissue: createSoftTissueState(anatomy),
      circulation: createCirculatoryState(),
      pbpk: createPBPKState(),
      organDamage: createOrganDamageState(),
      nervousSystem: createNervousSystemState(),
      skeletonExtensions: { legDescriptors: skeleton.legDescriptors || [] },
      universalLegDescriptors: skeleton.legDescriptors || [],
      sensorAnchors,
      boneAliases: null,
      driveByBone: null,
      driveAxesByBone: null,
      jointLimitsByBone: null,
      muscleModel: null,
      balanceState: null,
      contactTelemetry: null,
      reflexState: makeReflexState(),
      motorAuthorityMap: null,
      poseState: makePoseStateMeta('idle'),
      rotationTargets: null,
      neuralRotationResiduals: null,
      hingeLimits: ragdoll.structuralLimits || [],
      brainProfile,
      neuralMotor,
      intelligence: brainProfile.intelligence,
      magical: options.magical ?? false,
      brainTier: brainProfile.tier,
      motorProfileKey: brainProfile.motorProfileKey,
      _brainLoadAttempted: false,
      _upgradeCheckTimer: 0,
      strength: options.strength ?? 0.5,
      strengthEMA: 0,
      rhythms: createRhythmState(neuralMotor.rng),
      animalLegState: Object.create(null),
      animalTailState: Object.create(null),
    }
    this._bodies.set(entityId, entry)
    return true
  }

  addBody(entityId, worldPosition = [0, 0, 0], options = {}) {
    if (this._bodies.has(entityId)) return true
    if (options.animalSkeleton?.bones?.length) return this._addAnimalBody(entityId, worldPosition, options)

    const scale = options.scale || 1.0
    const specMeasurements = this._bodySpec?.measurements || {}

    // Measurements MUST match buildWalkingSkeleton() distances exactly,
    // otherwise PBD distance constraints will fight the spawn pose and
    // launch the body across the world.
    // Values derived from data/parts/construction_volumes/*.json sockets:
    //   thigh length  = 0.68 (cylinder_thigh_01 length)
    //   shin length   = 0.62 (tapered_calf_01 height)
    //   foot length   = 0.22 (wedge_foot_01 height)
    //   torso length  = 0.86 (tapered_rib_block_01 height)
    //   neck length   = 0.24 (cylinder_neck_01 length)
    //   upper arm     = 0.64 (cylinder_upper_arm_01 length)
    //   forearm       = 0.56 (tapered_forearm_01 height)
    //   shoulder X    = 0.38 ⇒ shoulderWidth ≈ 0.76
    //   hip X         = 0.18 ⇒ hipWidth ≈ 0.36
    const measurements = {
      ...DEFAULT_MEASUREMENTS,
      height: (specMeasurements.height ?? 1.85) * scale,
      shoulderWidth: (specMeasurements.shoulderWidth ?? 0.76) * scale,
      hipWidth: (specMeasurements.hipWidth ?? 0.36) * scale,
      torsoLength: (specMeasurements.torsoLength ?? 0.86) * scale,
      neckLength: (specMeasurements.neckLength ?? 0.24) * scale,
      headRadius: (specMeasurements.headRadius ?? 0.13) * scale,
      upperArmLength: (specMeasurements.upperArmLength ?? 0.64) * scale,
      forearmLength: (specMeasurements.forearmLength ?? 0.56) * scale,
      handLength: (specMeasurements.handLength ?? 0.10) * scale,
      thighLength: (specMeasurements.thighLength ?? 0.68) * scale,
      shinLength: (specMeasurements.shinLength ?? 0.62) * scale,
      footLength: (specMeasurements.footLength ?? 0.22) * scale,
    }

    // ─── SOLVER CONFIG ─────────────────────────────────────────────────
    // Empirical choice for THIS ragdoll: 1 substep × 12 iterations.
    // Müller's "Small Steps" paper (SIGGRAPH 2019) generally recommends
    // many substeps × 1 iteration for stiff systems, but that paradigm
    // assumes per-substep constraint ordering stays stable. This codebase
    // runs `applyHingeLimits(…) × 8` passes OUTSIDE the solver per frame
    // (see update() below) plus a self-collision pass. With 8 substeps,
    // those post-solve corrections interact with partially-solved
    // constraints across substep boundaries, producing velocity
    // amplification that was measured empirically as worse than the
    // single-step path. If the hinge-limit / collision passes are ever
    // moved INSIDE the substep loop, switch to 8×1.
    //
    // maxVelocity: 15 m/s (in-solver clamp — faster than a sprint,
    // slower than a car). We ALSO clamp post-step in update() because
    // PBD re-derives velocity from position delta after constraint
    // projection, which can bypass the in-solver clamp on frames where
    // constraints are still resolving large errors.
    const ragdoll = new PBDRagdoll({
      measurements,
      gravity: [0, -9.8, 0],
      substeps: 1,
      iterations: 12,
      maxVelocity: 15.0,      // in-solver clamp (partial — see update())
      blendSpeed: options.blendSpeed ?? 5,
    })
    const specBoneById = new Map((this._bodySpec?.bones || []).map(b => [b.id, b]))

    // Disable PBDRagdoll's built-in angle constraints (singularity at 180°).
    for (const c of ragdoll.angleConstraints) {
      c.stiffness = 0
      c.minAngle = -1
      c.maxAngle = 100
    }

    // ─── COLLISION RADII — match VISUAL mesh sizes ───────────────────────────
    // Default PBDRagdoll radii (chest 0.15, pelvis 0.12, thigh 0.07) are
    // smaller than the rendered shirt/torso. Bump them so arms/legs/hands
    // physically can't pass through the visible body shell.
    const COLLISION_RADII = {
      pelvis: 0.20,        // visual pelvis ~0.19m wide
      chest: 0.22,         // visual chest/shirt ~0.21m wide
      head: measurements.headRadius * 1.05,
      leftUpperArm: 0.07,  rightUpperArm: 0.07,
      leftForearm: 0.06,   rightForearm: 0.06,
      leftHand: 0.05,      rightHand: 0.05,
      leftThigh: 0.11,     rightThigh: 0.11,   // visual thigh ~0.10m
      leftShin: 0.08,      rightShin: 0.08,
      leftFoot: 0.07,      rightFoot: 0.07,
    }
    for (const bone of ragdoll.bones) {
      if (!bone || !bone.collider) continue
      const specRadius = specBoneById.get(bone.name)?.collision?.radius
      const r = specRadius ?? COLLISION_RADII[bone.name]
      if (r != null) bone.collider.radius = r
    }

    // ─── ANATOMICAL MASS DISTRIBUTION (matches editor's PhysX ragdoll) ─────
    // Pelvis is heaviest, head is light (so body doesn't fall top-heavy).
    // From editor's _getBoneLimits() in EditorPhysics.js.
    const BONE_MASSES = {
      pelvis: 2.5, spine: 2.0, spine1: 2.0, chest: 2.0,
      neck: 0.5, head: 1.0,
      leftShoulder: 0.8, leftUpperArm: 1.5, leftForearm: 1.0, leftHand: 0.5,
      rightShoulder: 0.8, rightUpperArm: 1.5, rightForearm: 1.0, rightHand: 0.5,
      leftThigh: 1.8, leftShin: 1.2, leftFoot: 0.5,
      rightThigh: 1.8, rightShin: 1.2, rightFoot: 0.5,
    }
    for (const bone of ragdoll.bones) {
      if (!bone) continue
      const specMass = specBoneById.get(bone.name)?.mass
      const mass = specMass ?? BONE_MASSES[bone.name]
      if (mass) {
        bone.mass = mass
        bone.particle.invMass = 1 / mass
      }
    }

    // Velocity retention — 1.0 = no damping. Use the default 0.99 from the
    // solver. Higher than that causes the body to balance perfectly upright
    // for too long before tipping (looks like slow-mo).
    ragdoll.solver.damping = 0.99

    const initialState = options.initialState || (options.spawnMode === 'drop' || options.startFallen ? 'fallen' : 'idle')
    // Place skeleton at world position with slight pre-bent joints
    setRagdollPose(ragdoll, worldPosition, measurements, { mode: initialState === 'fallen' ? 'drop' : 'stand' })

    // Hinge limit specs computed once at spawn — applied per-frame in update().
    const hingeLimits = computeHingeLimits(ragdoll, measurements, this._bodySpec?.jointLimitsByBone)

    const debugSpawnAudit = !!options.debugSpawnAudit
      || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('activeBodySpawnAudit'))
    // ─── INIT TRACE: verify spawn pose matches constraints ───────────────
    if (debugSpawnAudit && this._bodies.size === 0) {
      // First body — log everything for verification
      console.group(`[ABS-INIT] ${entityId} spawn pose audit`)
      console.log('measurements:', { ...measurements })

      // Check distance constraints vs actual particle distances
      console.log('Distance constraint audit (rest_len → actual_len, error):')
      for (const c of ragdoll.distanceConstraints) {
        const a = c.particleA, b = c.particleB
        const actual = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
        const error = Math.abs(actual - c.restLength)
        const tag = error > 0.01 ? '❌' : '✓'
        const aName = ragdoll.bones.find(bone => bone?.particle === a)?.name || '?'
        const bName = ragdoll.bones.find(bone => bone?.particle === b)?.name || '?'
        console.log(`  ${tag} ${aName} → ${bName}: rest=${c.restLength.toFixed(3)} actual=${actual.toFixed(3)} err=${error.toFixed(4)}`)
      }

      // Check angle constraints
      console.log('Angle constraint audit (min/max → actual angle):')
      for (const c of ragdoll.angleConstraints) {
        const a = c.particleA, b = c.particleB, cP = c.particleC
        // Angle at b between (a→b) and (b→c)
        const v1x = a.x - b.x, v1y = a.y - b.y, v1z = a.z - b.z
        const v2x = cP.x - b.x, v2y = cP.y - b.y, v2z = cP.z - b.z
        const v1Len = Math.hypot(v1x, v1y, v1z)
        const v2Len = Math.hypot(v2x, v2y, v2z)
        const dot = (v1x * v2x + v1y * v2y + v1z * v2z) / (v1Len * v2Len)
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
        const inRange = angle >= c.minAngle && angle <= c.maxAngle
        const tag = inRange ? '✓' : '❌'
        const bName = ragdoll.bones.find(bone => bone?.particle === b)?.name || '?'
        console.log(`  ${tag} angle@${bName}: min=${c.minAngle.toFixed(2)} max=${c.maxAngle.toFixed(2)} actual=${angle.toFixed(3)} (${(angle * 180 / Math.PI).toFixed(1)}°)`)
      }

      // Particle positions
      console.log('Particle positions (Y-sorted):')
      const sorted = [...ragdoll.bones].filter(Boolean).sort((a, b) => b.particle.y - a.particle.y)
      for (const bone of sorted) {
        const p = bone.particle
        console.log(`  ${bone.name.padEnd(15)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`)
      }
      console.groupEnd()
    }

    const brainProfile = createHumanoidBrainProfile(entityId, options)
    const brainTier = brainProfile.tier
    const motorProfileKey = brainProfile.motorProfileKey
    const neuralMotor = createNeuralMotor(brainTier, entityId)

    const entry = {
      entityId,
      ragdoll,
      measurements,
      anchorPosition: [...worldPosition],
      navState: { velocity: [0, 0], walkPhase: 0, facing: 0, speed: 0 },
      scale,
      state: initialState,
      balanceError: 0,
      groundedFeet: 2,
      stateTimer: 0,
      fallenStillTime: 0,     // accumulator: how long body has been still while fallen
      lastPelvisPos: currentPelvisPosition(ragdoll), // position last frame, for position-based stillness
      directionMotion: null,
      _directionLastPelvis: null,
      _directionMotionClock: 0,
      _directionMotionSamples: [],
      getupYaw: 0,            // snapshot of body facing yaw when getup begins
      getupFaceUp: false,     // true if body is on its back (needs roll-over)
      getupAnchor: [0, 0, 0], // ground-space anchor for getup pose targets (separate from anchorPosition so renderer stays stable)
      preset: options.preset || 'HumanAverage',
      bodySpec: this._bodySpec,
      anatomy: this._bodySpec?.anatomy || null,
      anatomyAttachments: this._bodySpec?.attachments || null,
      diaphragm: createDiaphragmState(this._bodySpec?.anatomy || null),
      organs: createOrganState(this._bodySpec?.anatomy || null, this._bodySpec?.attachments || null),
      vitalSigns: createVitalSignsState(),
      bioelectricSignals: createBioelectricSignalState(),
      softTissue: createSoftTissueState(this._bodySpec?.anatomy || null),
      circulation: createCirculatoryState(),
      pbpk: createPBPKState(),
      organDamage: createOrganDamageState(),
      nervousSystem: createNervousSystemState(),
      skeletonExtensions: this._bodySpec?.skeletonExtensions || null,
      universalLegDescriptors: options.universalLegDescriptors || this._bodySpec?.skeletonExtensions?.legDescriptors || null,
      sensorAnchors: resolveFunctionalSensorAnchors(this._bodySpec),
      boneAliases: this._bodySpec?.boneAliases || null,
      driveByBone: this._bodySpec?.driveByBone || null,
      driveAxesByBone: this._bodySpec?.driveAxesByBone || null,
      jointLimitsByBone: this._bodySpec?.jointLimitsByBone || null,
      muscleModel: this._bodySpec?.muscleModel || null,
      balanceState: null,
      contactTelemetry: null,
      reflexState: makeReflexState(),
      motorAuthorityMap: null,
      poseState: makePoseStateMeta(initialState === 'fallen' ? 'getup' : 'idle_stand'),
      rotationTargets: null,
      neuralRotationResiduals: null,
      hingeLimits,            // [{ a, b, maxDist }, ...] for hyperextension prevention
      // ─── INTELLIGENCE-DRIVEN BRAIN SIZING ─────────────────────────────
      // Each body has an intelligence score (0–200) that maps to a brain
      // tier via INTELLIGENCE_TIERS. Player starts ~55 (medium), NPCs ~35
      // (small), animals/children could be lower. The score GROWS through
      // successful training and game events (see growIntelligence) and
      // brain tier auto-upgrades when the score passes the next threshold
      // AND the current brain is saturated. See maybeUpgradeBrain() below.
      //
      // magical=true unlocks supernatural tiers (genius → divine, IQ 100+).
      // Mortal characters cap at IQ 100 naturally and tier 'huge'. Magic,
      // divine ascension, or narrative events can flip the magical flag.
      brainProfile,
      intelligence: brainProfile.intelligence,
      magical: brainProfile.magical,
      neuralMotor,
      _brainLoadAttempted: false,
      // Current tier is derived from intelligence but stored explicitly so
      // upgrade events don't fire every frame. Initialized below from the
      // starting intelligence.
      brainTier,
      motorProfileKey,
      // Auto-upgrade cooldown timer — prevents rapid-fire upgrades.
      _upgradeCheckTimer: 0,
      // ─── STRENGTH DISCOVERY ──────────────────────────────────────────
      // Bodies START WEAK (50% of theoretical max) and must EARN strength
      // through practice — like real motor development. Strength grows
      // slowly with successful training (high reward frames) up to 120%
      // for experienced bodies. Models both infant motor learning AND
      // adult training effects (muscle hypertrophy from use).
      //
      // Updated in applyGetupController based on sustained reward signal.
      // Persists across spawns (saved with the brain in future extension).
      strength: options.strength ?? 0.5,   // 0.3 (frail) .. 1.5 (athletic)
      strengthEMA: 0,                      // rolling avg reward for growth calc
      // ─── FATIGUE ─────────────────────────────────────────────────────
      // Per-bone fatigue accumulator (0=fresh, 1=exhausted). Reduces force
      // output by up to 40% when fatigued. Stored per-particle because
      // fatigue is local to each muscle group. Recovers during rest.
      // Adrenaline hook (future): push past fatigue temporarily.
      //
      // ─── BODY RHYTHMS (Kuramoto CPG) ─────────────────────────────────
      // Coupled phase oscillators producing heart, breath, gait, arm-swing.
      // Synchronize via Kuramoto coupling — left/right antiphase, arms
      // counter-swing with legs, heart-breath weak coupling. Provides the
      // NN with an internal time-base so it can learn rhythmic actions.
      // Initialized with per-entity RNG for individual (non-identical) rhythms.
      rhythms: createRhythmState(neuralMotor.rng),
      _spawnMode: initialState === 'fallen' ? 'drop' : 'stand',
      _spawnGraceTime: initialState === 'fallen' ? 0 : 0.8,
    }

    this._bodies.set(entityId, entry)
    return true
  }

  removeBody(entityId) {
    this._bodies.delete(entityId)
  }

  // ─── NAV STATE (from NPCNavigation) ────────────────────────────────────

  setAnchor(entityId, worldPosition) {
    const entry = this._bodies.get(entityId)
    if (entry) entry.anchorPosition = [...worldPosition]
  }

  setNavState(entityId, state) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    if (state.velocity) { entry.navState.velocity = [...state.velocity] }
    if (state.walkPhase != null) entry.navState.walkPhase = state.walkPhase
    if (state.facing != null) entry.navState.facing = state.facing
    if (state.speed != null) entry.navState.speed = state.speed
  }

  // ─── PER-FRAME UPDATE ───────────────────────────────────────────────────

  update(dt) {
    // dt cap: 20 ms (= 1/50 s). Real humanoid skeletons are stiff systems
    // — a single frame with dt > 20ms can outrun the 8-substep solver,
    // producing one sub-step per ~2.5ms which is at the edge of stability
    // for 0.2m bone lengths. On tab-switch/resume dt can spike to hundreds
    // of ms; clamping to 20ms means the body effectively pauses during
    // those gaps instead of exploding when simulation resumes. Equivalent
    // to Bullet/PhysX "max sub-step" guard.
    const safeDt = Math.min(0.02, Math.max(0, dt))
    if (safeDt === 0) return
    this.frameCount++

    // Diagnostic: log every frame for the first 10 frames, then every 60
    const shouldLog = (this.frameCount <= 10 || this.frameCount % 60 === 0) && this._bodies.size > 0
    const debugEntry = shouldLog ? this._bodies.values().next().value : null

    for (const [, entry] of this._bodies) {
      const { ragdoll, anchorPosition, navState, measurements } = entry
      entry._aniMotionPrior = this._aniMotionPrior

      // ─── PACER SENSORS (per-body packet) ─────────────────────────────
      // Build the sensors object passed into buildObservation this frame.
      // heightAt comes straight from GameWorld; nearestAgent is resolved
      // here against the set of other registered bodies (O(n) neighbor
      // scan — fine for < ~50 bodies; upgrade to spatial grid if needed).
      entry._frameSensors = this._buildFrameSensors(entry)
      ensureBrainLoaded(entry)
      if (entry.bodyKind === 'animal') {
        stepAnimalActiveBody(entry, safeDt, this.groundY, entry._frameSensors)
        const physiology = stepActiveBodyInternalPhysiology(entry, safeDt)
        stepActiveBodyNervousSystem(entry, safeDt, physiology)
        if (physiology.needsBrainUpgrade) this._maybeUpgradeBrain(entry)
        updateDirectionMotion(entry, safeDt)
        if (shouldLog && isAnimalDebugTarget(entry)) logAnimalActiveBodyTrace(entry, this.frameCount, this.groundY)
        continue
      }
      const skeleton = buildWalkingSkeleton(anchorPosition, { ...navState, poseMode: 'stand' }, measurements)

      // Active ragdoll using PBD position-based approach (like ropes):
      // 1. Set target positions on particles (like rope attachment constraints)
      // 2. PBD solver resolves constraints (distance + angle keep bones attached)
      // 3. Blend result: bones are pulled toward targets but constrained to each other

      const isKO = entry.state === 'ko' || entry.state === 'fallen'
      const isGettingUp = entry.state === 'getup'

      // ─── WARMUP WINDOW (first 0.3 s of body life) ─────────────────────
      // Fresh bodies need a few frames of "just let the constraints
      // settle" before any controller forces or gravity resolution can
      // kick in. Without this, frame 1 sees particles spawn at pose
      // positions, frame 2 gets gravity integrated (ankles dip), and the
      // first solver pass has to fix ankle-foot-ground penetration all at
      // once, propagating a shock up the chain. With high damping and no
      // controller during warmup, gravity only slowly bleeds into
      // velocity so the initial constraint solve converges smoothly.
      //
      // Inspired by Bullet/PhysX "sleep-on-spawn" behavior and common
      // ragdoll advice (see Sergio Abreu's active-ragdoll tutorial +
      // r/unity threads on "Strategy for making ragdoll player").
      entry._ageFrames = (entry._ageFrames ?? 0) + 1
      const warmupSeconds = entry._spawnMode === 'drop' ? 0.3 : 0.05
      const inWarmup = (entry._ageFrames * safeDt) < warmupSeconds

      // Damping: warmup=0.80 to bleed off any spawn-jitter velocity fast,
      // fallen=0.85 for quick settle, getup=0.96 to preserve motor
      // momentum, active=0.99 for realistic fall / continuous sim.
      ragdoll.solver.damping = inWarmup ? 0.80
        : isKO ? 0.85
        : isGettingUp ? 0.96
        : 0.99

      // Gravity: 50% during warmup, full after. Light gravity while the
      // distance constraints are taking their first bite prevents the
      // classic "spawn → sink → snap back" oscillation.
      ragdoll.solver.gravity = inWarmup ? [0, -4.9, 0] : [0, -9.8, 0]

      // ─── ACTIVE MOTOR (BEFORE step) ───────────────────────────────────────
      // Apply PD forces to particles BEFORE the Verlet integration step so
      // they're integrated as accelerations alongside gravity. This is the
      // key to real active ragdoll: forces act like muscles, gravity still
      // pulls down, collisions provide ground reaction, distance constraints
      // transmit force through the skeleton.
      //
      // SKIPPED during warmup — no NN, no PD, no standing controller until
      // the body has settled. Prevents fighting between "I want to be in
      // the stand pose" and "I'm still resolving spawn penetration".
      entry.locomotionAssist = null
      entry._targetTraceFrame = entry === debugEntry ? this.frameCount : 0
      if (!inWarmup) {
        if (isGettingUp) {
          applyGetupController(ragdoll, entry, safeDt)
        } else if (entry.state === 'idle' || entry.state === 'locomotion' || entry.state === 'stumble') {
          // Continuous standing — motor holds the body in the stand pose
          // against gravity. Uses gravity compensation so the body doesn't
          // slowly sag under its own weight.
          applyStandingController(ragdoll, entry, safeDt)
        }
      }

      // ─── NEURO JERKS (drugs / seizures / tremors) ──────────────────────
      // Apply neuromodifier forces DIRECTLY to bones, regardless of state.
      // This makes seizures/tremors/drugs visible when standing, fallen,
      // KO — not just during getup. Runs as additional forces on top of
      // whatever controller already applied.
      if (entry.neuralMotor) {
        applyNeuroJerks(ragdoll, entry.neuralMotor, this.frameCount * safeDt, safeDt)
      }

      // ─── RHYTHMS ALWAYS RUN ─────────────────────────────────────────────
      // Heart keeps beating whether the body is standing, fallen, KO'd, or
      // getting up — only death stops it. Previously rhythms only advanced
      // inside the standing/getup controllers so fallen bodies "held their
      // breath". Now it's global.
      const fatigue = estimateAverageFatigue(entry)
      const motorActivity = estimateBioelectricMotorActivity(entry)
      if (entry.rhythms) {
        stepRhythms(entry.rhythms, safeDt, {
          walking: entry.state === 'locomotion',
          walkSpeed: cadenceForWalkSpeed(entry.navState?.speed ?? 0),
          adrenaline: entry.adrenaline ?? 0,
          fatigue,
        })
        stepDiaphragm(entry.diaphragm, entry.rhythms, safeDt)
        stepVitalSigns(entry.vitalSigns, {
          rhythms: entry.rhythms,
          diaphragm: entry.diaphragm,
          organs: entry.organs,
          fatigue,
          adrenaline: entry.adrenaline ?? 0,
        }, safeDt)
        stepCirculation(entry.circulation, {
          organs: entry.organs,
          vitalSigns: entry.vitalSigns,
          fatigue,
          adrenaline: entry.adrenaline ?? 0,
        }, safeDt)
        stepPBPK(entry.pbpk, {
          organs: entry.organs,
          circulation: entry.circulation,
        }, safeDt)
        stepOrganDamage(entry.organDamage, entry.organs, {
          circulation: entry.circulation,
        }, safeDt)
        stepBioelectricSignals(entry.bioelectricSignals, {
          rhythms: entry.rhythms,
          neuralMotor: entry.neuralMotor,
          vitalSigns: entry.vitalSigns,
          fatigue,
          adrenaline: entry.adrenaline ?? 0,
          motorActivity,
        }, safeDt)
        stepSoftTissue(entry.softTissue, {
          boneMotion: sampleSoftTissueBoneMotion(ragdoll),
          diaphragm: entry.diaphragm,
          motorActivity,
        }, safeDt)
      }

      // ─── NEUROPLASTICITY RECOVERY ──────────────────────────────────────
      // Real brains slowly heal from damage when given rest + practice.
      // Damage counter decays toward zero during healthy, stable play.
      // Rate: ~50% recovery in 5 minutes of stable use. Seizure damage is
      // still punishing in the short term but not permanent if you take
      // care of the character.
      const nm = entry.neuralMotor
      if (nm && (nm.brainDamage ?? 0) > 0) {
        const modSeverity = (nm.modifiers.dropout ?? 0)
                          + (nm.modifiers.seizureAmp ?? 0) * 0.4
        if (modSeverity < 0.05) {
          // Only recover when brain is HEALTHY — can't heal mid-event
          nm.brainDamage = Math.max(0, nm.brainDamage - 0.00004 * safeDt * 60)
        }
      }

      // ─── INTELLIGENCE GROWTH FROM SUCCESSFUL LEARNING ──────────────────
      // Brain gets smarter when it's actually learning (low loss, many
      // training steps). This creates the self-reinforcing loop:
      //   practice → loss drops → intelligence grows → tier auto-upgrades
      //     → bigger brain learns harder tasks → more practice.
      // Very slow rate: ~1 point per 60s of productive training. Reaching
      // 'large' tier (75 intelligence) from 'medium' (55) takes real time.
      // Mortals cap at IQ 100; magical characters can naturally reach 200.
      if (nm && nm.lossEMA < 0.06 && nm.framesTrained > 100) {
        const cap = entry.magical ? 200 : 100
        entry.intelligence = Math.min(cap,
          (entry.intelligence ?? 0) + safeDt * 0.0167
        )
      }

      // ─── AUTO BRAIN UPGRADE (rate-limited) ─────────────────────────────
      // Check every 5s if the character's intelligence has outgrown their
      // current brain tier. If so, upgrade via Net2Net (preserves learning).
      entry._upgradeCheckTimer = (entry._upgradeCheckTimer ?? 0) + safeDt
      if (entry._upgradeCheckTimer > 5) {
        entry._upgradeCheckTimer = 0
        this._maybeUpgradeBrain(entry)
      }

      // Integrate physics: velocity update (with accumulated forces),
      // position update, gravity, collisions, distance constraints.
      ragdoll.solver.step(safeDt)

      // Hinge + spine limits — iterate enough times for near-rigid spine to
      // hold (95-100% min/max requires more passes to converge with the
      // distance constraint chain).
      for (let pass = 0; pass < 8; pass++) {
        applyHingeLimits(entry.hingeLimits)
      }

      // Self-collision: ALWAYS ON. Different filter per state:
      //   fallen/getup: activeMode=false — full self-collision (limbs push
      //     each other apart, hands push against floor/torso).
      //   idle/locomotion: activeMode=true — still collides left↔right limbs
      //     (legs don't cross) but excludes arm↔core/head and other pairs
      //     that naturally overlap when the body is upright.
      const collisionActiveMode = entry.state === 'idle' || entry.state === 'locomotion'
      ragdoll._solveCollisions(this._buildCollisionFilter(collisionActiveMode))
      stabilizeLimbSideFrame(entry, ragdoll, safeDt)
      stabilizeShoulderGirdleFrame(entry, ragdoll)
      stabilizeHeadNeckFrame(entry, ragdoll, safeDt)
      applyGroundedNoIntentSettleBrake(entry, ragdoll, safeDt)

      // ─── POST-STEP VELOCITY CLAMP (catches PBD re-derivation blowups) ─
      // PBD computes velocity as (x - px) / dt AFTER constraint projection.
      // When constraints resolve a large error (e.g. spawn penetration,
      // hinge-limit overshoot, or inter-limb collision), this re-derivation
      // can yield very high velocities that bypass the in-solver clamp.
      // The debug logs showed |v_head|=73 m/s with maxVelocity=15 set on
      // the solver — proof the in-solver clamp alone is insufficient for
      // this body's coupled hinge + collision passes.
      //
      // Clamping here caps the position-delta-derived velocity to a sane
      // humanoid envelope (12 m/s horizontal, 20 m/s vertical — allows
      // fast falls but kills the 30-70 m/s explosions). We also clamp the
      // previous-position cache (p.px/py/pz) to match, so the NEXT frame's
      // Verlet integration doesn't re-introduce the huge velocity from
      // the stored position delta.
      const VMAX_H = 12.0
      const VMAX_V = 20.0
      for (const bone of ragdoll.bones) {
        const p = bone?.particle
        if (!p) continue
        // Horizontal clamp (xz magnitude)
        const vh2 = p.vx * p.vx + p.vz * p.vz
        if (vh2 > VMAX_H * VMAX_H) {
          const s2 = VMAX_H / Math.sqrt(vh2)
          p.vx *= s2
          p.vz *= s2
          // Resync prev-pos so Verlet computes the clamped velocity next frame
          p.px = p.x - p.vx * safeDt
          p.pz = p.z - p.vz * safeDt
        }
        // Vertical clamp (separate budget — gravity falls can exceed Vh)
        if (p.vy >  VMAX_V) { p.vy =  VMAX_V; p.py = p.y - p.vy * safeDt }
        if (p.vy < -VMAX_V) { p.vy = -VMAX_V; p.py = p.y - p.vy * safeDt }
      }

      // ─── STILLNESS TRACKER (drives fallen→getup auto-transition) ─────────
      // Use position delta instead of particle velocity — PBD constraint
      // corrections can cause high .vx/vy/vz values even when the body is
      // essentially pinned in place.
      if (isKO) {
        const pelvisP = ragdoll.bones[0]?.particle
        if (pelvisP) {
          const dx = pelvisP.x - entry.lastPelvisPos[0]
          const dy = pelvisP.y - entry.lastPelvisPos[1]
          const dz = pelvisP.z - entry.lastPelvisPos[2]
          const moved = Math.sqrt(dx * dx + dy * dy + dz * dz)
          // Body is "still" if pelvis moved <2cm this frame
          if (moved < 0.02) entry.fallenStillTime += safeDt
          else entry.fallenStillTime = 0
          entry.lastPelvisPos[0] = pelvisP.x
          entry.lastPelvisPos[1] = pelvisP.y
          entry.lastPelvisPos[2] = pelvisP.z
        }
      }

      // Diagnostic logging — first body only, every 60 frames
      if (shouldLog) {
        const e0 = this._bodies.values().next().value
        if (e0 === entry) {
          const pelvis = ragdoll.bones[0]?.particle
          const head = ragdoll.bones[5]?.particle
          const lFoot = ragdoll.bones[16]?.particle
          const rFoot = ragdoll.bones[19]?.particle
          if (pelvis && head && lFoot && rFoot) {
            const vPelvis = Math.hypot(pelvis.vx, pelvis.vy, pelvis.vz)
            const vHead = Math.hypot(head.vx, head.vy, head.vz)
            const headDist = Math.hypot(head.x - pelvis.x, head.y - pelvis.y, head.z - pelvis.z)
            const lFootDist = Math.hypot(lFoot.x - pelvis.x, lFoot.y - pelvis.y, lFoot.z - pelvis.z)
            const rFootDist = Math.hypot(rFoot.x - pelvis.x, rFoot.y - pelvis.y, rFoot.z - pelvis.z)

            // Check if body is exploding or stable
            const stable = vPelvis < 5 && vHead < 5 && headDist < 1.5 && lFootDist < 2.0 && rFootDist < 2.0
            const tag = stable ? 'OK' : 'UNSTABLE'

            console.log(
              `[ABS-${tag}] ${entry.entityId} state=${entry.state} ` +
              `pelvis=(${pelvis.x.toFixed(2)},${pelvis.y.toFixed(2)},${pelvis.z.toFixed(2)}) ` +
              `head=(${head.x.toFixed(2)},${head.y.toFixed(2)},${head.z.toFixed(2)}) ` +
              `|v_pelvis|=${vPelvis.toFixed(2)} |v_head|=${vHead.toFixed(2)} ` +
              `headΔ=${headDist.toFixed(2)} lFootΔ=${lFootDist.toFixed(2)} rFootΔ=${rFootDist.toFixed(2)} ` +
              `balance=${entry.balanceError.toFixed(3)} grounded=${entry.groundedFeet}`
            )
            // ─── ORIENTATION AUDIT ──────────────────────────────────────────
            // Reports directional consistency: does the body point the same
            // way as its knees bend, elbows bend, toes point, etc? A healthy
            // body should have all these aligned (body-forward = knee-bend-
            // forward = toe-forward). Mismatch = contortion.
            logOrientationAudit(entry, ragdoll)
          }
        }
      }

      // Ground contact (with Coulomb friction — feet stick, other parts slide)
      enforceGroundContact(ragdoll, anchorPosition[1] || 0, safeDt, entry._frameSensors)
      entry.contactTelemetry = buildContactTelemetry(entry, anchorPosition[1] || 0, entry._frameSensors)
      stepNervousSystem(entry.nervousSystem, {
        neuralMotor: entry.neuralMotor,
        vitalSigns: entry.vitalSigns,
        circulation: entry.circulation,
        bioelectricSignals: entry.bioelectricSignals,
        organDamage: entry.organDamage,
        contactTelemetry: entry.contactTelemetry,
        adrenaline: entry.adrenaline ?? 0,
        fatigue,
        motorActivity,
      }, safeDt)
      if (shouldLog && entry === debugEntry) logContactTrace(entry)

      // Balance check
      const balance = computeBalance(ragdoll)
      entry.balanceError = balance.error
      entry.groundedFeet = balance.groundedFeet

      // State machine
      updateState(entry, balance, safeDt)
      entry.balanceState = makeBalanceState(entry, balance)
      entry.poseState = resolveActivePoseState(entry)

      // Update colliders
      ragdoll._updateColliders()
      updateDirectionMotion(entry, safeDt)
      if (shouldLog) {
        const e0 = this._bodies.values().next().value
        if (e0 === entry) logFinalDirectionAudit(entry)
      }
    }
  }

  // ─── READBACK API ───────────────────────────────────────────────────────

  getBonePositions(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    const { ragdoll } = entry
    if (entry.bodyKind === 'animal') {
      return (ragdoll.bones || []).map(bone => {
        const p = bone?.particle
        return {
          id: bone.name,
          parentId: bone.parentId >= 0 ? ragdoll.bones[bone.parentId]?.name : null,
          role: bone.role || null,
          side: bone.side || null,
          position: p ? [p.x, p.y, p.z] : [0, 0, 0],
          velocity: p ? [p.vx, p.vy, p.vz] : [0, 0, 0],
          radius: p?.radius || animalBoneRadius(bone.source, entry.animalSkeleton, entry.scale),
        }
      })
    }
    const bones = []
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const pos = ragdoll.getBonePosition(i)
      const p = ragdoll.bones[i]?.particle
      const velocity = p ? [p.vx, p.vy, p.vz] : [0, 0, 0]
      bones.push({
        id: BONE_NAMES[i],
        position: pos,
        velocity,
        radius: getBoneRadius(i, entry.measurements),
      })
    }
    return bones
  }

  getReadback(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    const intent = entry.intent || {}
    const contactTelemetry = entry.contactTelemetry || buildContactTelemetry(entry, entry.anchorPosition?.[1] || 0, entry._frameSensors)
    const motorAuthorityMap = entry.motorAuthorityMap || buildMotorAuthorityMap(entry, contactTelemetry)
    return {
      entityId,
      bodyKind: entry.bodyKind || 'humanoid',
      animalSkeleton: entry.bodyKind === 'animal' ? entry.animalSkeleton : null,
      anatomy: getAnatomyReadback(entry),
      brain: getBrainReadback(entry),
      motionPrior: getAniMotionPriorReport(this._aniMotionPrior),
      anchorPosition: [...entry.anchorPosition],
      displayOffset: [0, 0, 0],
      bones: this.getBonePositions(entityId),
      state: entry.state,
      balanceError: entry.balanceError,
      groundedFeet: entry.groundedFeet,
      balanceState: this.getBalanceState(entityId),
      universalLegScheduler: makeUniversalLegSchedulerReadback(entry, contactTelemetry),
      poseState: { ...entry.poseState },
      rotationTargets: copyRotationTargetSummary(entry.rotationTargets),
      neuralRotationResiduals: copyRotationResidualSummary(entry.neuralRotationResiduals),
      reflexState: copyReflexState(entry.reflexState),
      motorAuthorityMap: copyMotorAuthorityMap(motorAuthorityMap),
      diaphragm: getDiaphragmReadback(entry.diaphragm),
      breathingBodyCoupling: getBreathingBodyCouplingReadback(entry.diaphragm, entry.rhythms),
      organs: getOrganReadback(entry.organs),
      vitalSigns: getVitalSignsReadback(entry.vitalSigns),
      bioelectricSignals: getBioelectricSignalReadback(entry.bioelectricSignals),
      softTissue: getSoftTissueReadback(entry.softTissue),
      contactTelemetry: copyContactTelemetry(contactTelemetry),
      sensorAnchors: copySensorAnchorTelemetry(contactTelemetry?.sensorAnchors),
      circulation: getCirculatoryReadback(entry.circulation),
      pbpk: getPBPKReadback(entry.pbpk),
      organDamage: getOrganDamageReadback(entry.organDamage),
      nervousSystem: getNervousSystemReadback(entry.nervousSystem),
      debugOverlay: this.getDebugOverlay(entityId),
      attachmentDiagnostics: this.getAttachmentDiagnostics(entityId),
      directionDiagnostics: this.getDirectionDiagnostics(entityId),
      facing: entry.navState?.facing ?? 0,
      facingTarget: entry.navState?.facingTarget ?? null,
      intentDir: (intent.targetDirX != null && intent.targetDirZ != null)
        ? [intent.targetDirX, 0, intent.targetDirZ]
        : null,
      intentType: intent.type ?? null,
    }
  }

  getBalanceState(entityId) {
    const entry = this._bodies.get(entityId)
    return copyBalanceState(entry?.balanceState)
  }

  /**
   * Live body yaw (smoothly slewed in the walking controller). Use this for
   * rendering equipment / fallback meshes / camera follow so visuals stay in
   * sync with the ragdoll's actual orientation instead of snapping to the
   * raw input direction.
   */
  getBodyYaw(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return entry.navState?.facing ?? 0
  }

  getBodyFacingVector(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    if (entry.intent?.type === 'walk' || entry.state === 'locomotion') {
      const rolling = entry.directionMotion?.rollingVelocity
      const rollingLen = Array.isArray(rolling) ? Math.hypot(rolling[0] || 0, rolling[1] || 0) : 0
      if (rollingLen > 0.12) {
        return { x: rolling[0] / rollingLen, z: rolling[1] / rollingLen, yaw: Math.atan2(rolling[0], rolling[1]) }
      }
      const pelvis = entry.ragdoll?.bones?.[0]?.particle
      const vx = pelvis?.vx || 0
      const vz = pelvis?.vz || 0
      const vLen = Math.hypot(vx, vz)
      if (vLen > 0.08) {
        return { x: vx / vLen, z: vz / vLen, yaw: Math.atan2(vx, vz) }
      }
    }
    const yaw = entry.navState?.facing ?? 0
    return { x: Math.sin(yaw), z: Math.cos(yaw), yaw }
  }

  /**
   * Request a facing target. The walking controller slews navState.facing
   * toward it at 5 rad/s. Useful when the body should turn-in-place before
   * moving (e.g. player pushed a direction but hasn't committed to walking).
   */
  setFacingTarget(entityId, yaw) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    if (!entry.navState) entry.navState = {}
    entry.navState.facingTarget = yaw
    return true
  }

  // ─── ACTIONS (for gameplay) ─────────────────────────────────────────────

  activateRagdoll(entityId, impulse = null) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    entry.ragdoll.activate(impulse)
  }

  deactivateRagdoll(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    entry.ragdoll.deactivate()
  }

  applyImpulse(entityId, boneId, impulse) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    entry.ragdoll.applyImpulse(boneId, impulse)
  }

  applyExplosion(entityId, origin, force, radius) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    entry.ragdoll.applyExplosion(origin, force, radius)
  }

  // ─── NEURO / DRUG / DISEASE API ─────────────────────────────────────────

  /** Apply a preset neuro profile to a body's brain. */
  applyNeuroEffect(entityId, profileName) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    if (!entry.neuralMotor) {
      console.warn(`[NEURO] ${entityId} has no neural motor yet`)
      return
    }
    import('./NeuroModifiers.js').then(m => m.applyNeuroProfile(entry.neuralMotor, profileName))
  }

  /** Ramp a neuro profile gradually (0..1). Useful for poison progression. */
  rampNeuroEffect(entityId, profileName, t) {
    const entry = this._bodies.get(entityId)
    if (!entry?.neuralMotor) return
    import('./NeuroModifiers.js').then(m => m.rampNeuroProfile(entry.neuralMotor, profileName, t))
  }

  /** Apply neuro effect to every body (for debug testing). */
  applyNeuroEffectToAll(profileName) {
    import('./NeuroModifiers.js').then(m => {
      for (const entry of this._bodies.values()) {
        if (entry.neuralMotor) m.applyNeuroProfile(entry.neuralMotor, profileName)
      }
    })
  }

  /** Get training stats for a body's brain. */
  getNeuralStats(entityId) {
    const entry = this._bodies.get(entityId)
    const nm = entry?.neuralMotor
    if (!nm) return null
    return {
      tier: nm.tier,
      seed: nm.seed,
      lossEMA: nm.lossEMA,
      framesTrained: nm.framesTrained,
      framesSkipped: nm.framesSkipped ?? 0,
      brainDamage: nm.brainDamage ?? 0,     // accumulated cortical thinning
      intelligence: entry.intelligence ?? 0,
      magical: entry.magical ?? false,
      nextTier: nextTier(nm.tier),
      nextThreshold: (() => {
        const nt = nextTier(nm.tier)
        return nt ? INTELLIGENCE_TIERS[nt] : null
      })(),
      layers: nm.layers.map(L => ({ in: L.inSize, out: L.outSize })),
      modifiers: { ...nm.modifiers },
      trust: entry._lastBrainTrust || estimateNeuralMotorTrust(nm),
      motionPrior: entry._lastAniMotionPrior || null,
      profileKey: entry.motorProfileKey || entityId,
      profileShared: String(entry.motorProfileKey || '').startsWith('shared:'),
    }
  }

  /**
   * Heal accumulated brain damage. Represents neuroplasticity / medical
   * treatment. Clears brainDamage but does NOT undo weight corruption —
   * the NN has to retrain through normal play to recover those specifically.
   */
  healBrainDamage(entityId) {
    const entry = this._bodies.get(entityId)
    const nm = entry?.neuralMotor
    if (!nm) return
    nm.brainDamage = 0
    console.info(`[BRAIN] healed damage counter for ${entityId}`)
  }

  // ─── INTELLIGENCE / BRAIN GROWTH ────────────────────────────────────────

  /**
   * Directly set intelligence (0-100). Triggers an immediate upgrade check.
   * Useful for character creation, narrative events (enlightenment, head
   * injury, potions), or debug.
   */
  setIntelligence(entityId, score) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    // Mortals cap at 100, magical characters can reach 200.
    const cap = entry.magical ? 200 : 100
    entry.intelligence = Math.max(0, Math.min(cap, score))
    entry._upgradeCheckTimer = 999   // force check next frame
    return true
  }

  /**
   * Grow intelligence by a delta. Called by gameplay systems when the
   * character learns (skill use, storylet resolution, reading, teacher
   * interaction). Small deltas (+0.1 to +1) are typical; +10 is a major
   * life event.
   */
  growIntelligence(entityId, delta) {
    const entry = this._bodies.get(entityId)
    if (!entry) return 0
    const before = entry.intelligence ?? 0
    const cap = entry.magical ? 200 : 100
    entry.intelligence = Math.max(0, Math.min(cap, before + delta))
    return entry.intelligence
  }

  /**
   * Flip the magical flag — unlocks supernatural tiers (genius through
   * divine, IQ 100–200). Use this for narrative events: divine ascension,
   * archmage initiation, demonic pact, transcendence. Setting to false
   * REMOVES magic — if their brain is already a magical tier it stays
   * (downgrade not supported) but future growth caps at huge / IQ 100.
   */
  setMagical(entityId, magical) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    entry.magical = !!magical
    entry._upgradeCheckTimer = 999
    if (magical) {
      console.info(`[BRAIN] ${entityId} now MAGICAL — can reach divine tier (IQ 195)`)
    } else {
      console.info(`[BRAIN] ${entityId} magic removed — capped at mortal tiers`)
    }
    return true
  }

  /**
   * Auto-upgrade check: if the character's intelligence has grown past the
   * next tier threshold AND their current brain has saturated (low loss,
   * enough training), grow the brain via Net2Net (preserves learning).
   *
   * Called every ~5s by the update loop. Saturation criteria:
   *   framesTrained > 3000 (enough data for the current capacity)
   *   lossEMA < 0.06       (mastered the task within current capacity)
   */
  _maybeUpgradeBrain(entry) {
    const nm = entry.neuralMotor
    if (!nm) return
    const intel = entry.intelligence ?? 0
    const targetTier = tierFromIntelligence(intel, entry.magical)
    const currentTier = nm.tier
    if (targetTier === currentTier) return

    // Current tier is already correct (target == current) — nothing to do.
    // If target is LOWER than current, we don't downgrade (can't shrink
    // a learned brain without data loss).
    const curIdx = TIER_LADDER.indexOf(currentTier)
    const tgtIdx = TIER_LADDER.indexOf(targetTier)
    if (tgtIdx <= curIdx) return

    // Require saturation before spending memory on a bigger brain. No point
    // in scaling up if the current one isn't learning yet.
    const saturated = nm.framesTrained > 3000 && nm.lossEMA < 0.06
    if (!saturated) return

    // Upgrade ONE step up the ladder (not directly to target) — smoother,
    // better Net2Net transfer.
    const step = TIER_LADDER[curIdx + 1]
    const ok = upgradeBrain(nm, step)
    if (ok) {
      entry.brainTier = step
      console.info(
        `[BRAIN] ${entry.entityId} grew ${currentTier} → ${step} ` +
        `(intelligence=${intel.toFixed(0)}, target=${targetTier})`
      )
      // Persist the upgraded brain immediately
      saveBrain(entry.motorProfileKey || entry.entityId, nm).catch(() => {})
    }
  }

  // ─── BRAIN STORAGE / EXPORT API ─────────────────────────────────────────

  /** Set the brain tier for an entity BEFORE its brain is first created. */
  setBrainTier(entityId, tier) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    if (!BRAIN_TIERS[tier]) {
      console.warn(`[BRAIN] Unknown tier: ${tier}. Available:`, Object.keys(BRAIN_TIERS))
      return false
    }
    entry.brainTier = tier
    // Force rebuild if a smaller brain already exists
    if (entry.neuralMotor && entry.neuralMotor.tier !== tier) {
      entry.neuralMotor = createNeuralMotor(tier, entityId)
      entry._brainLoadAttempted = false
    }
    return true
  }

  setMotorProfileKey(entityId, profileKey) {
    const entry = this._bodies.get(entityId)
    if (!entry || !profileKey) return false
    entry.motorProfileKey = profileKey
    entry._brainLoadAttempted = false
    return true
  }

  /** Save current brain to IndexedDB now. Returns size in bytes or null. */
  async saveBrain(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry?.neuralMotor) return null
    try {
      const key = entry.motorProfileKey || entityId
      const size = await saveBrain(key, entry.neuralMotor)
      console.info(`[BRAIN] saved ${entityId} → ${key} (${(size/1024).toFixed(1)} KB)`)
      return size
    } catch (err) {
      console.warn(`[BRAIN] save failed:`, err.message)
      return null
    }
  }

  /** Save to a named slot (e.g. player snapshots). */
  async saveBrainSlot(entityId, slotName) {
    const entry = this._bodies.get(entityId)
    if (!entry?.neuralMotor) return null
    try {
      const key = `${entityId}.slot.${slotName}`
      const size = await saveBrain(key, entry.neuralMotor)
      console.info(`[BRAIN] snapshot → ${key} (${(size/1024).toFixed(1)} KB)`)
      return size
    } catch (err) {
      console.warn(`[BRAIN] slot save failed:`, err.message)
      return null
    }
  }

  async backupBrain(entityId, backupName = 'backup') {
    return this.saveBrainSlot(entityId, backupName)
  }

  /** Load a saved brain into an entity (from id or slot name). */
  async loadBrain(entityId, sourceKey = null) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    const key = sourceKey || entry.motorProfileKey || entityId
    const data = await loadBrain(key)
    if (!data) {
      console.warn(`[BRAIN] No saved brain under '${key}'`)
      return false
    }
    if (!entry.neuralMotor) {
      entry.neuralMotor = createNeuralMotor(data.tier || 'tiny', entityId)
    }
    const ok = deserializeMotor(entry.neuralMotor, data)
    if (ok) console.info(`[BRAIN] loaded ${entityId} ← ${key}`)
    return ok
  }

  async restoreBrain(entityId, backupName = 'backup') {
    return this.loadBrain(entityId, `${entityId}.slot.${backupName}`)
  }

  /** Delete a saved brain (or slot). */
  async deleteSavedBrain(key) {
    await deleteBrain(key)
    console.info(`[BRAIN] deleted '${key}'`)
  }

  /** List all saved brains across IndexedDB. */
  async listSavedBrains() {
    const all = await listBrains()
    console.table(all.map(b => ({
      id: b.id,
      tier: b.tier,
      size: `${(b.byteSize/1024).toFixed(1)} KB`,
      steps: b.framesTrained,
      loss: b.lossEMA?.toFixed(4),
      saved: new Date(b.savedAt).toLocaleString(),
    })))
    return all
  }

  /** Export a body's brain as a JSON string (for download/share). */
  exportBrain(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry?.neuralMotor) return null
    return exportBrainAsJson(entry.neuralMotor)
  }

  async exportBrainCompressed(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry?.neuralMotor) return null
    return exportBrainAsCompressedJson(entry.neuralMotor)
  }

  /** Download a body's brain as a .brain.json file. */
  downloadBrain(entityId) {
    const json = this.exportBrain(entityId)
    if (!json) return false
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${entityId}.brain.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  }

  /** Import a JSON string into a body's brain. */
  importBrain(entityId, jsonStr) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    if (!entry.neuralMotor) entry.neuralMotor = createNeuralMotor(entry.brainTier || 'tiny', entityId)
    return importBrainFromJson(entry.neuralMotor, jsonStr)
  }

  async importBrainAsync(entityId, jsonStr) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    if (!entry.neuralMotor) entry.neuralMotor = createNeuralMotor(entry.brainTier || 'tiny', entityId)
    return importBrainFromJsonAsync(entry.neuralMotor, jsonStr)
  }

  getBrainOptimizationReport(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry?.neuralMotor) return null
    return analyzeMotorStorage(entry.neuralMotor)
  }

  getNeuralInferenceBackendReport(gpu = null) {
    return getNeuralInferenceBackendReport(this._bodies.size, gpu)
  }

  getPerformanceBudgetReport() {
    return getActiveBodyPerformanceBudgetReport(this._bodies.size, {
      averageBones: BONE_NAMES.length,
      physiologyModules: 9,
    })
  }

  getFallbackReport(gpu = null) {
    return getActiveBodyFallbackReport(gpu)
  }

  getSimulationTierReport(observer = {}) {
    const bodies = []
    for (const entry of this._bodies.values()) bodies.push(makeSimulationTierInput(entry))
    return buildActiveBodySimulationTierReport(bodies, observer)
  }

  getAttachmentDiagnostics(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return buildAttachmentDiagnostics(entry, this.groundY)
  }

  getDirectionDiagnostics(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return buildDirectionDiagnostics(entry)
  }

  getNeuralMotorDebugReport(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry?.neuralMotor) return null
    return getNeuralMotorDebugReport(entry.neuralMotor)
  }

  getDebugOverlay(entityId, overlayOptions = null) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    const intent = entry.intent || {}
    const contactTelemetry = entry.contactTelemetry || buildContactTelemetry(entry, entry.anchorPosition?.[1] || 0, entry._frameSensors)
    const motorAuthorityMap = entry.motorAuthorityMap || buildMotorAuthorityMap(entry, contactTelemetry)
    const overlayToggles = makeOverlayToggleMap(overlayOptions?.toggles || overlayOptions, this._debugOverlayToggles)
    return {
      entityId,
      overlayToggles,
      com: makeComOverlay(entry.balanceState),
      support: makeSupportOverlay(entry),
      contacts: overlayToggles.contacts ? makeContactOverlay(contactTelemetry) : null,
      nerves: overlayToggles.nerves ? getNerveGraphReadback(entry.nervousSystem) : null,
      circulationFlow: overlayToggles.blood ? getCirculationGraphReadback(entry.circulation) : null,
      fatigue: overlayToggles.fatigue ? makeFatigueOverlay(entry) : null,
      poseTargets: makePoseTargetOverlay(entry),
      jointError: makeJointErrorOverlay(entry),
      reflexes: copyReflexState(entry.reflexState),
      motorAuthorityMap: overlayToggles.motorAuthority ? copyMotorAuthorityMap(motorAuthorityMap) : null,
      organStatus: overlayToggles.organStatus ? makeOrganStatusOverlay(entry) : null,
      brainIntent: {
        type: intent.type ?? null,
        targetDir: (intent.targetDirX != null && intent.targetDirZ != null) ? [intent.targetDirX, 0, intent.targetDirZ] : null,
        waypoint: intent.waypoint ? [...intent.waypoint] : null,
        motorIntent: {
          guard: intent.guard ?? 0,
          brace: intent.brace ?? 0,
          attack: intent.attack ?? 0,
          recover: intent.recover ?? 0,
        },
        neuralMotor: entry.neuralMotor ? {
          tier: entry.neuralMotor.tier,
          lossEMA: entry.neuralMotor.lossEMA,
          rewardEMA: entry.neuralMotor.rewardEMA ?? null,
          brainDamage: entry.neuralMotor.brainDamage ?? 0,
        } : null,
      },
      vitalSigns: getVitalSignsReadback(entry.vitalSigns),
      breathingBodyCoupling: getBreathingBodyCouplingReadback(entry.diaphragm, entry.rhythms),
      attachmentDiagnostics: buildAttachmentDiagnostics(entry, this.groundY),
      directionDiagnostics: buildDirectionDiagnostics(entry),
    }
  }

  // ─── INTENT / GOAL API ──────────────────────────────────────────────────
  //
  // The NN receives an `intent` each frame that tells it what the body is
  // trying to achieve. Gameplay code sets this based on what the character
  // wants to do — walking toward a target, ducking, reaching, etc.

  /**
   * Set the body's current intent. The NN sees this in its observation
   * vector and the reward function uses it to shape what counts as success.
   *
   * TRACE integration: pass `waypoint` + optional `desiredSpeed` and the
   * body will auto-derive `targetDirX/Z` from (waypoint - pelvis). The NN
   * reward function rewards both proximity to the waypoint AND matching
   * the desired speed, so the character walks toward it at the right pace.
   * When the body reaches the waypoint (within WAYPOINT_REACH_RADIUS) the
   * caller should advance to the next waypoint — this API does NOT own
   * the waypoint queue; the planner does.
   *
   * @param {string} entityId
   * @param {object} intent
   *   { type: 'stand'|'walk'|'duck'|'act',
   *     targetVerticality?: number,    // 0..100, default by type
   *     targetDirX?: number,           // world-space direction (auto if waypoint set)
   *     targetDirZ?: number,
   *     waypoint?: [wx, wz],           // TRACE: world-space point to reach
   *     desiredSpeed?: number,         // TRACE: m/s, default 1.5
   *   }
   */
  setIntent(entityId, intent) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    if (!intent || !(intent.type in STATE_INTENTS)) {
      console.warn(`[INTENT] Invalid intent`, intent, 'valid:', Object.keys(STATE_INTENTS))
      return false
    }
    // Auto-derive targetDir from waypoint if not explicitly provided.
    // Planner only needs to give us the point — direction follows.
    const resolved = { ...(entry.intentMetadata || {}), ...intent }
    if (resolved.waypoint && resolved.targetDirX == null && resolved.targetDirZ == null) {
      const pel = entry.ragdoll?.bones?.[0]?.particle
      if (pel) {
        const dx = resolved.waypoint[0] - pel.x
        const dz = resolved.waypoint[1] - pel.z
        const len = Math.hypot(dx, dz)
        if (len > 0.001) {
          resolved.targetDirX = dx / len
          resolved.targetDirZ = dz / len
        }
      }
    }
    entry.intent = resolved
    entry.poseState = resolveActivePoseState(entry)
    return true
  }

  setIntentMetadata(entityId, metadata) {
    const entry = this._bodies.get(entityId)
    if (!entry || !metadata) return false
    entry.intentMetadata = { ...metadata }
    entry.intent = { ...(entry.intent || { type: 'stand' }), ...entry.intentMetadata }
    entry.poseState = resolveActivePoseState(entry)
    return true
  }

  /**
   * Get a body's current pelvis world position as {wx, wy, wz, vx, vz}.
   * Returns null if the body isn't registered or the ragdoll hasn't
   * initialized yet. Used by GameLoop to sync playerState from the
   * physics body (so camera, name tags, combat all follow the ragdoll).
   */
  getPelvisPosition(entityId) {
    const entry = this._bodies.get(entityId)
    const p = entry?.ragdoll?.bones?.[0]?.particle
    if (!p) return null
    return { wx: p.x, wy: p.y, wz: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 }
  }

  getDynamicAgentPositions() {
    const list = []
    for (const entry of this._bodies.values()) {
      const p = entry.ragdoll?.bones?.[0]?.particle
      if (p) list.push([p.x, p.z])
    }
    return list
  }

  /**
   * Distance from pelvis to current waypoint (intent.waypoint). Returns
   * Infinity when no waypoint is set. Planner uses this to decide when
   * to advance to the next waypoint.
   */
  distanceToWaypoint(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry?.intent?.waypoint) return Infinity
    const pel = entry.ragdoll?.bones?.[0]?.particle
    if (!pel) return Infinity
    const [wx, wz] = entry.intent.waypoint
    return Math.hypot(wx - pel.x, wz - pel.z)
  }

  /** Clear the body's intent (reverts to default 'stand'). */
  clearIntent(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    entry.intent = null
  }

  // ─── STRENGTH / FATIGUE / ADRENALINE API ────────────────────────────────
  //
  // Bodies discover their own strength through practice. API lets gameplay
  // override / trigger these for events (injury, training, panic, etc).

  /**
   * Directly set strength (0.3=frail, 1.0=normal, 1.5=athletic). Normally
   * grows automatically with practice. Use for gameplay events like
   * "character levels up" or "injury reduces strength".
   */
  setStrength(entityId, value) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    entry.strength = Math.max(0.3, Math.min(1.5, value))
    return true
  }

  /** Get current strength + avg fatigue for UI display. */
  getPhysicalStats(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    const bones = entry.ragdoll.bones
    let totFat = 0, nFat = 0
    for (const b of bones) {
      if (b?.particle?._fatigue != null) { totFat += b.particle._fatigue; nFat++ }
    }
    return {
      strength: entry.strength,
      avgFatigue: nFat > 0 ? totFat / nFat : 0,
      adrenaline: entry.adrenaline ?? 0,
    }
  }

  /**
   * Apply an adrenaline surge — temporary force boost that fades over 10s.
   * Use for panic/combat events ("I need to get out of here NOW").
   * Range: 0 (none) to 1 (full flight response, +50% force).
   */
  triggerAdrenaline(entityId, amount = 1.0, durationSec = 10) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    entry.adrenaline = Math.max(0, Math.min(1, amount))
    entry.adrenalineTimer = durationSec
  }

  /** Directly clear fatigue (for cheat/test scenarios). */
  clearFatigue(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return
    for (const b of entry.ragdoll.bones) {
      if (b?.particle) b.particle._fatigue = 0
    }
  }

  // ─── RHYTHM / CPG API ───────────────────────────────────────────────────

  /**
   * Get current rhythm state for UI/debug. Returns heart bpm, breath rate,
   * gait cadence, and Kuramoto order parameter (synchrony 0..1).
   */
  getRhythms(entityId) {
    const entry = this._bodies.get(entityId)
    const r = entry?.rhythms
    if (!r) return null
    return {
      heartBPM: r.heartBPM,
      breathRate: r.breathRate,
      gaitCadence: r.gaitCadence,
      coherence: r.coherence,
      phases: [...r.phases],
      diaphragm: getDiaphragmReadback(entry.diaphragm),
      breathingBodyCoupling: getBreathingBodyCouplingReadback(entry.diaphragm, entry.rhythms),
      vitalSigns: getVitalSignsReadback(entry.vitalSigns),
      bioelectricSignals: getBioelectricSignalReadback(entry.bioelectricSignals),
    }
  }

  getBreathingBodyCoupling(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getBreathingBodyCouplingReadback(entry.diaphragm, entry.rhythms)
  }

  getVitalSigns(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getVitalSignsReadback(entry.vitalSigns)
  }

  getBioelectricSignals(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getBioelectricSignalReadback(entry.bioelectricSignals)
  }

  getSoftTissue(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getSoftTissueReadback(entry.softTissue)
  }

  getCirculation(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getCirculatoryReadback(entry.circulation)
  }

  addSubstanceDose(entityId, substanceId, amount, options = {}) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return addPBPKDose(entry.pbpk, substanceId, amount, options)
  }

  getPBPK(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getPBPKReadback(entry.pbpk)
  }

  applyOrganDamage(entityId, target, amount, options = {}) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return applyOrganDamage(entry.organDamage, entry.organs, target, amount, options)
  }

  getOrganDamage(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getOrganDamageReadback(entry.organDamage)
  }

  getNervousSystem(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry) return null
    return getNervousSystemReadback(entry.nervousSystem)
  }

  /**
   * Disrupt the Kuramoto rhythms — simulates arrhythmia, panic breakdown,
   * shock, etc. Severity 0-1. High severity = major desync.
   */
  async shatterRhythm(entityId, severity = 0.5) {
    const entry = this._bodies.get(entityId)
    if (!entry?.rhythms) return
    const rhythmsMod = await import('./BodyRhythms.js')
    rhythmsMod.shatterRhythm(entry.rhythms, severity, entry.neuralMotor?.rng)
  }

  /** Restore healthy rhythm coupling after disruption. */
  async restoreRhythm(entityId) {
    const entry = this._bodies.get(entityId)
    if (!entry?.rhythms) return
    const rhythmsMod = await import('./BodyRhythms.js')
    rhythmsMod.restoreRhythm(entry.rhythms)
  }

  // ─── CHARACTER PROGRESSION / BRAIN EVOLUTION ────────────────────────────

  /**
   * Upgrade a body's brain to a larger tier. Preserves learned behavior
   * via Net2Net weight transplant. Use when the character levels up,
   * evolves, or gains a "motor cortex expansion" item.
   *
   * @param {string} entityId
   * @param {'tiny'|'small'|'medium'|'large'|'huge'} newTier
   * @returns {boolean} true if upgraded (tier was larger), false otherwise
   */
  upgradeBrain(entityId, newTier) {
    const entry = this._bodies.get(entityId)
    if (!entry) return false
    if (!entry.neuralMotor) {
      // No brain yet — just set the tier, creation will use it.
      entry.brainTier = newTier
      return true
    }
    const ok = upgradeBrain(entry.neuralMotor, newTier)
    if (ok) {
      entry.brainTier = newTier
      // Persist the upgraded brain immediately so the upgrade survives a reload.
      saveBrain(entry.motorProfileKey || entityId, entry.neuralMotor).catch(() => {})
    }
    return ok
  }

  /** List the tiers this entity could upgrade to. */
  getBrainUpgradeOptions(entityId) {
    const entry = this._bodies.get(entityId)
    const currentTier = entry?.neuralMotor?.tier || entry?.brainTier || 'tiny'
    return getUpgradeOptions(currentTier).map(tier => ({
      tier,
      hiddens: BRAIN_TIERS[tier],
      estimatedSize: this._estimateTierSize(tier),
    }))
  }

  _estimateTierSize(tier) {
    const h = BRAIN_TIERS[tier]
    if (!h) return 0
    let floats = 0
    let prev = OBS_SIZE
    for (const w of h) { floats += prev * w + w; prev = w }
    floats += prev * ACTION_SIZE + ACTION_SIZE
    return `${(floats * 4 / 1024).toFixed(1)} KB`
  }

  has(entityId) { return this._bodies.has(entityId) }
  get bodyCount() { return this._bodies.size }

  destroy() {
    this._bodies.clear()
    this.frameCount = 0
  }
}

// ─── WALKING SKELETON (built from data/parts socket positions) ───────────────
// All measurements derived from construction_volumes JSON:
//   rib_block: h=0.86, shoulders X±0.38 Y+0.28, neck Y+0.43, pelvis Y-0.43
//   pelvis: h=0.42, spine Y+0.21, hips X±0.18 Y-0.18
//   upper_arm: len=0.64 (shoulder Y+0.32, elbow Y-0.32)
//   forearm: h=0.56 (elbow Y+0.28, wrist Y-0.28)
//   thigh: len=0.68 (hip Y+0.34, knee Y-0.34)
//   calf: h=0.62 (knee Y+0.31, ankle Y-0.31)
//   foot: h=0.22, ankle Y+0.11
//   neck: len=0.24 (head Y+0.12)
//   head: h=0.62


// ─── INITIAL POSE (T-pose at world position) ────────────────────────────────




// ─── PELVIS ANCHOR (root balance) ────────────────────────────────────────────
// Strong soft-spring pulls the pelvis toward its target. This is what keeps
// the body upright — gravity pulls down, pelvis anchor pulls up.


// ─── JOINT TORQUE MOTORS ────────────────────────────────────────────────────
// For each bone with a parent, compute the angle error between current bone
// direction (parent→child) and target direction (parent_target→child_target).
// Apply torque (perpendicular force at child end) to rotate toward target.



// ─── HINGE LIMITS (directional joint constraints) ───────────────────────────
// PBD distance constraints maintain bone lengths. To make joints HINGE in
// only one direction (knees backward, elbows forward), we add max-distance
// constraints between non-adjacent bones along the chain.
//
// Example: knee bends backward → shin moves toward butt → pelvis-to-foot
// distance DECREASES. Knee hyperextends → shin goes through where it should
// not → pelvis-to-foot distance INCREASES past the limit. We cap that.
//
// Combined with the pre-bent spawn pose, the joint can only hinge in the
// pre-bent direction — the kinematic equivalent of a one-way hinge.








function stepActiveBodyInternalPhysiology(entry, dt) {
  const fatigue = estimateAverageFatigue(entry)
  const motorActivity = estimateBioelectricMotorActivity(entry)
  if (!entry.rhythms && entry.neuralMotor?.rng) entry.rhythms = createRhythmState(entry.neuralMotor.rng)
  if (entry.rhythms) {
    stepRhythms(entry.rhythms, dt, {
      walking: entry.state === 'locomotion',
      walkSpeed: cadenceForWalkSpeed(entry.navState?.speed ?? 0),
      adrenaline: entry.adrenaline ?? 0,
      fatigue,
    })
    stepDiaphragm(entry.diaphragm, entry.rhythms, dt)
    stepVitalSigns(entry.vitalSigns, {
      rhythms: entry.rhythms,
      diaphragm: entry.diaphragm,
      organs: entry.organs,
      fatigue,
      adrenaline: entry.adrenaline ?? 0,
    }, dt)
    stepCirculation(entry.circulation, {
      organs: entry.organs,
      vitalSigns: entry.vitalSigns,
      fatigue,
      adrenaline: entry.adrenaline ?? 0,
    }, dt)
    stepPBPK(entry.pbpk, {
      organs: entry.organs,
      circulation: entry.circulation,
    }, dt)
    stepOrganDamage(entry.organDamage, entry.organs, {
      circulation: entry.circulation,
    }, dt)
    stepBioelectricSignals(entry.bioelectricSignals, {
      rhythms: entry.rhythms,
      neuralMotor: entry.neuralMotor,
      vitalSigns: entry.vitalSigns,
      fatigue,
      adrenaline: entry.adrenaline ?? 0,
      motorActivity,
    }, dt)
    stepSoftTissue(entry.softTissue, {
      boneMotion: sampleSoftTissueBoneMotion(entry.ragdoll),
      diaphragm: entry.diaphragm,
      motorActivity,
    }, dt)
  }
  const nm = entry.neuralMotor
  if (nm && (nm.brainDamage ?? 0) > 0) {
    const modSeverity = (nm.modifiers.dropout ?? 0) + (nm.modifiers.seizureAmp ?? 0) * 0.4
    if (modSeverity < 0.05) nm.brainDamage = Math.max(0, nm.brainDamage - 0.00004 * dt * 60)
  }
  if (nm && nm.lossEMA < 0.06 && nm.framesTrained > 100) {
    const cap = entry.magical ? 200 : 100
    entry.intelligence = Math.min(cap, (entry.intelligence ?? 0) + dt * 0.0167)
  }
  entry._upgradeCheckTimer = (entry._upgradeCheckTimer ?? 0) + dt
  const needsBrainUpgrade = entry._upgradeCheckTimer > 5
  if (needsBrainUpgrade) entry._upgradeCheckTimer = 0
  return { fatigue, motorActivity, needsBrainUpgrade }
}

function stepActiveBodyNervousSystem(entry, dt, physiology = null) {
  stepNervousSystem(entry.nervousSystem, {
    neuralMotor: entry.neuralMotor,
    vitalSigns: entry.vitalSigns,
    circulation: entry.circulation,
    bioelectricSignals: entry.bioelectricSignals,
    organDamage: entry.organDamage,
    contactTelemetry: entry.contactTelemetry,
    adrenaline: entry.adrenaline ?? 0,
    fatigue: physiology?.fatigue ?? estimateAverageFatigue(entry),
    motorActivity: physiology?.motorActivity ?? estimateBioelectricMotorActivity(entry),
  }, dt)
}





























function radiansToDebugDegrees(value) {
  return (normalizeRadians(value) * 180 / Math.PI).toFixed(1)
}


function signedAngularDelta(a, b) {
  let delta = normalizeRadians(a - b)
  if (delta > Math.PI) delta -= Math.PI * 2
  return delta
}

















function percentSignal(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return clamp01(n / 100)
}

function unitSignal(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return clamp01(n)
}

function unitSignalDefault(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return clamp01(fallback)
  return clamp01(n)
}

function clampSigned(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(-1, Math.min(1, n))
}




















function groundYFromFoot(footTarget) {
  return Array.isArray(footTarget) ? footTarget[1] : 0
}










function slewRadians(current, target, amount) {
  const delta = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  return current + delta * Math.max(0, Math.min(1, amount))
}

// ─── GROUND CONTACT ─────────────────────────────────────────────────────────

























function clamp01(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}











function supportCenter(points) {
  if (points.length === 0) return null
  let x = 0
  let y = 0
  let z = 0
  for (const item of points) {
    x += item.point[0]
    y += item.point[1]
    z += item.point[2]
  }
  return [x / points.length, y / points.length, z / points.length]
}









function normalizeRadians(value) {
  const tau = Math.PI * 2
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return ((v % tau) + tau) % tau
}

function normalizePhase01(value) {
  return normalizeRadians(value) / (Math.PI * 2)
}





// ─── COM-BASED BALANCE (Winter mass fractions) ──────────────────────────────













function organStatusColor(organ) {
  const integrity = clamp01(organ?.integrity ?? 1)
  const perfusion = clamp01(organ?.perfusion ?? 1)
  if (organ?.status === 'failing' || integrity < 0.35 || perfusion < 0.35) return '#F44336'
  if (organ?.status !== 'normal' || integrity < 0.7 || perfusion < 0.7) return '#FFC107'
  return '#4CAF50'
}



function makeSimulationTierInput(entry) {
  const p = entry?.ragdoll?.bones?.[0]?.particle
  const organDamage = getOrganDamageReadback(entry?.organDamage)
  return {
    entityId: entry?.entityId,
    position: p ? [p.x, p.y, p.z] : null,
    state: entry?.state ?? null,
    balanceError: entry?.balanceError ?? 0,
    importance: estimateActiveBodyImportance({
      state: entry?.state ?? null,
      balanceError: entry?.balanceError ?? 0,
    }),
    injured: !!organDamage && ((organDamage.bleedingRate ?? 0) > 0 || (organDamage.wounds?.length ?? 0) > 0),
  }
}

function buildAttachmentDiagnostics(entry, groundY = 0) {
  const ragdoll = entry?.ragdoll
  if (!ragdoll) return null
  let maxDistanceError = 0
  let worstPair = null
  for (const c of ragdoll.distanceConstraints || []) {
    const a = c.particleA
    const b = c.particleB
    if (!a || !b) continue
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    const error = Math.abs(d - c.restLength)
    if (error > maxDistanceError) {
      maxDistanceError = error
      worstPair = {
        a: boneNameForParticle(ragdoll, a),
        b: boneNameForParticle(ragdoll, b),
        distance: round4(d),
        restLength: round4(c.restLength),
        error: round4(error),
      }
    }
  }
  const feet = getSupportFootBoneIds(entry).map(id => {
    const bone = ragdoll.boneMap?.get(id)
    const p = bone?.particle
    return p ? {
      id,
      height: round4(p.y - groundY),
      grounded: p.y - groundY < FOOT_PARTICLE_CONTACT_HEIGHT,
      speed: round4(Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0)),
    } : { id, missing: true }
  })
  return {
    maxDistanceError: round4(maxDistanceError),
    worstPair,
    groundedFeet: entry.groundedFeet ?? 0,
    feet,
    likelyIssues: [
      ...(maxDistanceError > 0.08 ? ['distance_constraint_stretch'] : []),
      ...((entry.groundedFeet ?? 0) === 0 ? ['no_grounded_feet'] : []),
    ],
  }
}








function estimateAverageFatigue(entry) {
  const bones = entry?.ragdoll?.bones || []
  let sum = 0
  let count = 0
  for (const bone of bones) {
    const fatigue = bone?.particle?._fatigue
    if (fatigue == null) continue
    sum += Math.max(0, Math.min(1, fatigue))
    count++
  }
  return count > 0 ? sum / count : 0
}

function round4(v) {
  return Math.round(v * 10000) / 10000
}










function setParticleVelocity(p, vx, vy, vz, dt) {
  p.vx = vx
  p.vy = vy
  p.vz = vz
  if (dt > 0) {
    p.px = p.x - p.vx * dt
    p.py = p.y - p.vy * dt
    p.pz = p.z - p.vz * dt
  }
}





function estimateBioelectricMotorActivity(entry) {
  const ragdoll = entry?.ragdoll
  if (!ragdoll?.bones) return 0
  let velocitySum = 0
  let fatigueSum = 0
  let count = 0
  for (const bone of ragdoll.bones) {
    const p = bone?.particle
    if (!p) continue
    velocitySum += Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0)
    fatigueSum += p._fatigue || 0
    count++
  }
  if (count === 0) return 0
  const avgVelocity = velocitySum / count
  const avgFatigue = fatigueSum / count
  const stateBoost = entry.state === 'locomotion' ? 0.25 : entry.state === 'getup' ? 0.4 : 0
  return Math.max(0, Math.min(1, avgVelocity / 6 + avgFatigue * 0.25 + stateBoost))
}

function cadenceForWalkSpeed(speed) {
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0
  if (s <= 0.05) return 0
  return Math.max(0.75, Math.min(1.85, 0.75 + s * 0.28))
}



















// ─── STATE MACHINE (from dossier) ───────────────────────────────────────────
// States: idle | locomotion | stumble | fallen | getup | ko



// ─── GETUP ORIENTATION ──────────────────────────────────────────────────────
//
// When the fallen body begins getup we freeze its current horizontal facing
// and up-axis orientation. This mirrors what Euphoria/DeepMimic-style active
// controllers do: pick the getup that requires the LEAST rotation from the
// body's current pose, so the ragdoll rises smoothly instead of twisting.
//
// Yaw  = angle between world-+Z and the pelvis→chest projection on XZ.
// FaceUp = true when the body's "belly-up" axis (chest cross pelvis->shoulders)
//           points in +Y (sky). In that case the pushup pose — which assumes
//           belly-down — won't work cleanly. For now we still try and let
//           physics resolve it; later we can chain a `roll_over` pose first.


// ─── ORIENTATION AUDIT ──────────────────────────────────────────────────────
//
// Prints the directional state of each major body part. A healthy, non-
// contorted body has all "forward" vectors pointing the SAME direction:
//   body_forward  = pelvis → chest projected on XZ (or shoulder-axis cross
//                                                    spine-axis)
//   knee_bend     = which way the shin bends relative to thigh (should match
//                   body_forward — knee bends forward so body can sit)
//   elbow_bend    = which way forearm bends relative to upper arm (usually
//                   same as body_forward too)
//   toe_dir       = where the foot/toe points
//
// If any of these point the wrong way we get "contortion" — knees backward,
// elbows inverted, etc.

function computeSignedAngleOnHorizontal(ax, az, bx, bz) {
  // Signed angle between vector A and B projected to XZ plane (Y=up).
  // Returns radians, positive = counterclockwise from A to B viewed from +Y.
  const dot = ax * bx + az * bz
  const cross = ax * bz - az * bx
  return Math.atan2(cross, dot)
}

function yawDeg(rad) {
  return (rad * 180 / Math.PI).toFixed(1)
}




// ─── POSE AUDIT (verify authored pose JSONs are internally consistent) ─────



// ─── STANDING CONTROLLER (continuous) ──────────────────────────────────────
//
// Maintains the `stand` pose whenever the body is idle or in locomotion.
// This is what makes the body STAY STANDING instead of falling back to a
// ragdoll after getup. Uses gravity compensation so there's no slow sag.
//
// The anchor (XZ ground center) follows the body's current pelvis position
// so the body can walk around freely — only the VERTICAL posture is
// enforced, plus per-bone offsets relative to the pelvis (arms at sides,
// legs straight, etc).


// ─── GETUP CONTROLLER (data-driven via pose sequence) ───────────────────────
//
// Runs the `getup` sequence loaded from /data/sequences/getup.json. Each
// phase targets a pose (pushup → kneel → stand) with its own duration and
// motor stiffness. Within a phase the system interpolates FROM the previous
// pose TO the current pose, so the body passes through a smooth chain of
// reference poses — like pulling muscle memory from a download.
//
// The physics remains fully active: bones obey distance/hinge/spine limits,
// self-collisions still resolve, gravity still acts. The motor just adds
// positional bias toward the target pose each frame, with strength =
// phase.stiffness * boneBias.

// Build a { boneName: boneObj } lookup. Cached per frame on the ragdoll
// so the NN observation build doesn't rescan the array every call.


// ─── BONE RADII ─────────────────────────────────────────────────────────────

// Collision radii must match the VISUAL mesh sizes from EntityMeshBuilder so
// arms/legs can't clip through the visible torso shell. Visual chest is
// ~0.21m wide (torsoSize.x*0.56), pelvis ~0.19m, thigh ~0.10m, etc.


// ─── SHARED WITH AnimalLocomotion.js / ContactTelemetry.js ─────────────────
// These are used by both the humanoid path in this file and the extracted
// modules (Phase 7, Ragdoll Stack Consolidation Roadmap) — kept here since
// they're also used by purely-humanoid code (balance, direction audit, small
// math/format utils), with the extracted modules importing them back.
export {
  BONE_NAMES,
  buildDirectionDiagnostics,
  clamp01,
  clampSigned,
  computeSignedAngleOnHorizontal,
  copyFunctionalSensorAnchor,
  estimateAverageFatigue,
  groundYFromFoot,
  makeBalanceState,
  normalizePhase01,
  normalizeRadians,
  organStatusColor,
  percentSignal,
  radiansToDebugDegrees,
  resolveFunctionalSensorAnchors,
  round4,
  setParticleVelocity,
  signedAngularDelta,
  slewRadians,
  supportCenter,
  unitSignal,
  unitSignalDefault,
  yawDeg,
}
