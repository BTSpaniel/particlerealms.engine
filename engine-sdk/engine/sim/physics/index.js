/**
 * engine/sim/physics/index.js - Physics Systems Barrel Export
 */

// Physics Schema (unified type definitions)
export {
  SIM_MODES,
  COLLIDER_SHAPES,
  JOINT_TYPES,
  D6_MOTION,
  D6_AXES,
  D6_DRIVES,
  COLLISION_LAYERS,
  PHYSICS_MATERIALS,
  PHYSICS_BODY_SCHEMA,
  COLLIDER_SCHEMA,
  JOINT_SCHEMA,
  PHYSICS_WORLD_SCHEMA,
  STANDARD_COLLIDER_MESHES,
  getSimModeId,
  getSimModeName,
  getColliderShapeId,
  getColliderShapeName,
  getCollisionMask,
  layersCollide,
  validatePhysicsBody,
  validateCollider,
  validatePhysicsMaterial,
  createDefaultPhysicsBody,
  createDefaultCollider,
  createDefaultJoint,
  createDefaultPhysicsWorld,
  getPhysicsMaterial,
} from './PhysicsSchema.js';

export * from './rig/index.js';

// Position-Based Dynamics
export {
    DEFAULT_ITERATIONS as PBD_DEFAULT_ITERATIONS,
    DEFAULT_SUBSTEPS as PBD_DEFAULT_SUBSTEPS,
    ConstraintType,
    ParticleFlags,
    PBDParticle,
    PBDConstraint,
    DistanceConstraint,
    AngleConstraint,
    AttachmentConstraint,
    colorConstraints,
    groupByColor,
    PBDSolver,
} from './PBDSolver.js';

// Ragdoll
export {
    RagdollBone,
    JointType,
    RagdollState,
    DEFAULT_MEASUREMENTS,
    JOINT_LIMITS,
    CapsuleCollider,
    RagdollBoneData,
    PBDRagdoll,
} from './PBDRagdoll.js';

// MLS-MPM Soft Body
export {
    CELL_SIZE as MPM_CELL_SIZE,
    DEFAULT_GRID_SIZE as MPM_DEFAULT_GRID_SIZE,
    SPLINE_RADIUS,
    ConstitutiveModel,
    MaterialPresets,
    MPMParticle,
    GridCell,
    quadraticBSpline,
    quadraticBSplineGrad,
    computeWeight,
    MLSMPMSolver,
} from './MLSMPMSolver.js';

// Fracture & Damage
export { MeshCutter, MeshFragment, Triangle, Vertex, Plane } from './MeshCutter.js';
export { VoronoiFracture, FRACTURE_PATTERNS } from './VoronoiFracture.js';
export { FragmentManager, PhysicsFragment, StructuralConnection } from './FragmentPhysics.js';
export { FragmentManager as FragmentPhysics } from './FragmentPhysics.js';
export { UnifiedDamageSystem } from './UnifiedDamageSystem.js';

// Structural
export { StructuralIntegritySolver, ANCHOR_TYPE } from './StructuralIntegrity.js';
export { SpatialIntegritySystem } from './SpatialIntegritySystem.js';

// Connectivity
export {
    MAX_ITERATIONS as CONNECTIVITY_MAX_ITERATIONS,
    WORKGROUP_SIZE as CONNECTIVITY_WORKGROUP_SIZE,
    ANCHOR_COMPONENT_ID,
    EMPTY_COMPONENT_ID,
    ConnectivityCompute,
    indexTo3D,
    positionToIndex,
} from './ConnectivityCompute.js';

// Mesh processing
export {
    DEFAULT_GRID_SIZE as DECIMATION_GRID_SIZE,
    DEFAULT_TARGET_RATIO,
    MAX_QEM_ITERATIONS,
    Vertex as DecimationVertex,
    Triangle as DecimationTriangle,
    Quadric,
    Edge as DecimationEdge,
    decimateGrid,
    decimateQEM,
    MeshDecimator,
} from './MeshDecimation.js';

// Seismic
export {
    WaveType,
    WAVE_SPEEDS,
    MagnitudeScale,
    DEFAULT_PARAMS as SEISMIC_PARAMS,
    FaultLine,
    SeismicWave,
    Earthquake,
    SeismicSystem,
} from './SeismicSystem.js';

// Tree physics
export { TreePhysicsSystem, TreeVoxelBody, TreePhysicsSystem as TreePhysics } from './TreePhysics.js';

// Mesh particles
export { MeshParticles } from './MeshParticles.js';

// PhysX (existing)
export { PhysXPhysicsWorld, createPhysicsWorld, createBody, getBody, setBodyKinematic, removeBody, stepPhysicsWorld, destroyPhysicsWorld, updateWorldMaterial, raycastWorld, registerConvexMesh, registerTriangleMesh } from './PhysXPhysicsWorld.js';
export { getPhysXJointCapabilities, createD6Joint, createRevoluteJoint, createSphericalJoint, createDistanceJoint } from './PhysXJoints.js';
export { PhysXMeshCooking } from './PhysXMeshCooking.js';
export { StandardColliderMeshes } from './StandardColliderMeshes.js';

// PhysX Articulations (ropes, ragdolls, chains)
export {
    createArticulation,
    createRootLink,
    createChildLink,
    addArticulationToScene,
    createRope,
    getArticulationLinkTransforms,
    destroyArticulation,
} from './PhysXArticulations.js';

// Convex Decomposition (V-HACD style)
export {
    DECOMPOSITION_DEFAULTS,
    voxelizeMesh,
    decomposeMesh,
    hullsToCompoundCollider,
    createDecomposedCollider,
} from './ConvexDecomposition.js';

// GPU Cloth (with small substeps)
export {
    GPU_CLOTH_DEFAULT_SUBSTEPS,
    GPU_CLOTH_DEFAULT_ITERATIONS,
    GPUClothSolver,
} from './GPUClothSolver.js';

// GPU Spatial Hash (GPU Gems 3, Chapter 32)
export {
    morton3D,
    hashCell,
    SpatialHashGrid,
    GPUSpatialHashGrid,
    createSpatialHashFromVGPU,
} from './GPUSpatialHash.js';

// SDF Collision (GPU Gems 3, Chapter 34 + PhysX 5.x)
export {
    SDFPrimitives,
    SDFOperations,
    SDFGrid,
    createSDFFromMesh,
} from './SDFCollision.js';

// Shock Propagation (Guendelman et al., SIGGRAPH 2003)
export {
    ShockPropagationSolver,
    applyShockPropagation,
} from './ShockPropagation.js';

// Speculative Contacts (Bullet Physics / PhysX)
export {
    expandAABBByVelocity,
    timeOfClosestApproach,
    SpeculativeContactsSolver,
    enablePhysXSpeculativeCCD,
} from './SpeculativeContacts.js';

// OGC Contact Model (Chen et al., SIGGRAPH 2025)
// Offset Geometric Contact for penetration-free simulation
export {
    DEFAULT_CONTACT_RADIUS,
    BARRIER_ACTIVATION_RATIO,
    MIN_DISTANCE as OGC_MIN_DISTANCE,
    FIXED_SCALE as OGC_FIXED_SCALE,
    barrierEnergy,
    barrierForce,
    normalizedBarrierEnergy,
    conservativeDisplacementBound,
    distanceToOffsetSphere,
    distanceToOffsetPlane,
    distanceToOffsetCapsule,
    distanceToOffsetEdge,
    distanceToOffsetTriangle,
    applyOGCForce,
    applyOGCPositionCorrection,
    OGCContactManager,
    OGC_BARRIER_WGSL,
    OGC_DISTANCE_WGSL,
    OGC_SOLVE_WGSL,
    OGC_WGSL_MODULE,
} from './OGCContact.js';
