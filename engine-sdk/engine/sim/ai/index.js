// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AI Module Index - NPC Aiming, Combat, and Navigation
 * 
 * ⚠️ MULTIPLAYER: All AI uses deterministic RNG from AIRandom.js
 * Call setAIRngContext(worldSeed, tick) at start of each game tick!
 * 
 * Usage:
 *   import { createAIAimingSystem, setAIRngContext, aiRng } from "engine/sim/ai";
 * 
 * Modules:
 * - AISchema.js       - Unified type definitions for AI systems (NEW)
 * - AIRandom.js       - Deterministic RNG for multiplayer sync
 * - AIAiming.js       - Ray casting, predictive aim, accuracy, threat scoring
 * - AIHitDetection.js - Swept collision, damage falloff, spatial hashing
 * - AIMelee.js        - Arc collision, attack phases, combos
 * - AIWeapons.js      - Hitscan, projectile, AoE, beam, grenade weapons
 * - SpatialHash.js    - O(1) spatial queries, object pooling
 * - AIAimingSystem.js - Full NPC combat controller with LOD updates
 * - AIRaycastGPU.js   - WebGPU batch ray casting (500+ rays)
 * - Blackboard.js     - Key-value storage for behavior trees
 * - NavGrid.js        - 2D walkability grid
 * - NavWorld.js       - Multi-layer navigation container
 * - Pathfinder.js     - A* pathfinding
 */

// AI Schema (unified type definitions)
export {
  NODE_STATUS as SCHEMA_NODE_STATUS,
  NODE_TYPES,
  AWARENESS_STATES,
  SENSE_TYPES,
  STEERING_BEHAVIORS,
  DIPLOMATIC_STANCES,
  REPUTATION_LEVELS,
  PERSONALITY_TRAITS,
  PERCEPTION_SCHEMA,
  STEERING_AGENT_SCHEMA,
  FACTION_SCHEMA,
  PERSONALITY_SCHEMA,
  NPC_AI_SCHEMA,
  getNodeTypeId,
  getAwarenessStateId,
  getAwarenessStateName,
  getReputationLevel,
  validatePerception,
  validateSteeringAgent,
  validatePersonality,
  createDefaultPerception,
  createDefaultSteeringAgent,
  createDefaultPersonality,
  createDefaultFaction,
  PERSONALITY_PRESETS,
} from './AISchema.js';

// Deterministic RNG for multiplayer (MUST be seeded each tick!)
export {
  setAIRngContext,
  aiRng,
  createEntityRng,
  createPositionRng,
  getEntityRngState,
  getPositionRngState,
  getInteractionRngState,
  pcgHash,
} from './AIRandom.js';

// Core aiming
export {
  // Ray casting
  createRay,
  rayAABBIntersect,
  raySphereIntersect,
  hasLineOfSight,
  hasLineOfSightSpheres,

  // Predictive aiming
  predictiveAim,
  predictiveAimWithAcceleration,

  // Accuracy
  gaussianRandom,
  applyAccuracySpread2D,
  applyAccuracySpread3D,
  calculateAccuracyModifier,
  SKILL_LEVELS,

  // Target selection
  calculateThreatScore,
  selectTarget,
  DEFAULT_THREAT_WEIGHTS,
  TARGET_SWITCH_THRESHOLD,

  // Target memory
  createTargetMemory,
  updateTargetMemory,
  getAimPointFromMemory,
  TARGET_MEMORY_DURATION_MS,

  // Utilities
  degToRad,
  radToDeg,
  distance,
  distanceSquared,
  isWithinRange,
} from "./AIAiming.js";

// Melee combat
export {
  ATTACK_PHASE,
  DEFAULT_PHASE_DURATIONS,
  createMeleeArc,
  isInMeleeArc,
  isInMeleeArc3D,
  createMeleeAttackState,
  startMeleeAttack,
  updateMeleeAttack,
  interruptMeleeAttack,
  checkMeleeHits,
  chainComboAttack,
  getComboMultiplier,
  sweepMeleeArc,
  getPhaseTimeRemaining,
  getPhaseProgress,
} from "./AIMelee.js";

// Weapons
export {
  WEAPON_TYPE,
  WEAPON_PRESETS,
  fireHitscan,
  fireShotgun,
  calculateDamageFalloff,
  createProjectile,
  updateProjectile,
  getProjectilePositionAtTime,
  checkProjectileCollision,
  isInCircularAoE,
  calculateAoEDamage,
  resolveCircularAoE,
  isInConeAoE,
  resolveConeAoE,
  createBeamWeapon,
  updateBeamTracking,
  fireBeam,
  createGrenade,
  updateGrenade,
  calculateGrenadeLaunchVelocity,
  createWeaponController,
  addWeapon,
  selectBestWeapon,
  canFireWeapon,
  recordWeaponFire,
} from "./AIWeapons.js";

// Spatial hash & pooling
export {
  createSpatialHash,
  spatialHashInsert,
  spatialHashRemove,
  spatialHashUpdate,
  spatialHashQueryRadius,
  spatialHashQueryRadius2D,
  spatialHashQueryAABB,
  spatialHashKNearest,
  spatialHashClear,
  spatialHashCount,
  spatialHashRebuild,
  createObjectPool,
  poolAcquire,
  poolRelease,
  poolReleaseAll,
  poolStats,
} from "./SpatialHash.js";

// High-level system
export {
  COMBAT_STATE,
  LOD_UPDATE_INTERVALS,
  createNPCCombatController,
  initNPCWeapons,
  initNPCMelee,
  createAIAimingSystem,
  registerNPC,
  unregisterNPC,
  updatePlayerPosition,
  updateAIAimingSystem,
  npcFireWeapon,
  npcMeleeAttack,
  applyDamageToNPC,
  decayDamageMemory,
  getBatchRays,
  applyBatchRayResults,
} from "./AIAimingSystem.js";

// GPU raycast (optional, for 500+ rays)
export {
  createGPURaycastSystem,
  uploadRays,
  uploadAABBTargets,
  uploadSphereTargets,
  dispatchAABBRaycast,
  dispatchSphereRaycast,
  copyResultsToReadback,
  readbackResults,
  batchRaycast,
  destroyGPURaycastSystem,
  shouldUseGPURaycast,
  benchmarkRaycast,
} from "./AIRaycastGPU.js";

// Cover system
export {
  COVER_QUALITY,
  COVER_ACTION,
  createCoverPoint,
  computePeekPositions,
  detectCoverPoints,
  scoreCoverPoint,
  findBestCover,
  createCoverState,
  enterCover,
  exitCover,
  startPeek,
  updateCoverState,
  getCoverShootPosition,
  canShootFromCover,
  applySuppression,
  isSuppressed,
  damageCover,
  findFlankingPositions,
  findRetreatCover,
} from "./AICover.js";

// Squad coordination
export {
  SQUAD_ROLE,
  BARK_TYPE,
  createSquadManager,
  createSquad,
  addToSquad,
  removeFromSquad,
  disbandSquad,
  updateSquadFormations,
  assignSquadRoles,
  calculateAttackPositions,
  planSuppressionManeuver,
  queueBark,
  processBarkQueue,
  getBarkText,
  updateSquadTactics,
  getSquadForNPC,
  getTeammates,
} from "./AISquad.js";

// Evasion/dodge
export {
  EVASION_TYPE,
  DEFAULT_EVASION_PARAMS,
  createEvasionState,
  startDodge,
  updateEvasion,
  isEvading,
  canDodge,
  updateStrafe,
  setStrafeDirection,
  reactToThreat,
  checkProjectileThreats,
  checkGrenadeThreats,
  generateCombatMovement,
  circleStrafe,
  getEvasionParamsForSkill,
} from "./AIEvasion.js";

// Perception system
export {
  AWARENESS_STATE,
  SENSE_TYPE,
  DEFAULT_PERCEPTION_PARAMS,
  createPerceptionState,
  checkVision,
  calculateDetectionRate,
  createNoiseEvent,
  checkHearing,
  processVisualDetection,
  processNoiseEvent,
  processDamage,
  shareTeamInfo,
  getLastKnownPosition,
  getMostThreateningEntity,
  decayAwareness,
  checkInvestigationComplete,
  updatePerception,
} from "./AIPerception.js";

// Behavior trees
export {
  NODE_STATUS,
  createSelector,
  createSequence,
  createParallel,
  createRandomSelector,
  createInverter,
  createRepeater,
  createUntilFail,
  createUntilSuccess,
  createSucceeder,
  createFailer,
  createCooldown,
  createConditionGuard,
  createAction,
  createCondition,
  createWait,
  createLog,
  tickNode,
  resetNode,
  createTreeRunner,
  tickTree,
  createCombatTree,
} from "./AIBehaviorTree.js";

// Utility AI
export {
  linearCurve,
  inverseLinearCurve,
  quadraticCurve,
  exponentialCurve,
  logisticCurve,
  smoothstepCurve,
  stepCurve,
  bellCurve,
  customCurve,
  createConsideration,
  evaluateConsideration,
  createUtilityAction,
  scoreAction,
  selectBestAction,
  selectActionWeighted,
  selectActionBucketed,
  createUtilityBrain,
  updateUtilityBrain,
  executeCurrentAction,
  createHealthConsideration,
  createDistanceConsideration,
  createAmmoConsideration,
  createThreatConsideration,
  createCoverConsideration,
  createLOSConsideration,
  createCombatActions,
} from "./AIUtility.js";

// Influence maps
export {
  createInfluenceLayer,
  createInfluenceMap,
  worldToInfluenceCell,
  influenceCellToWorld,
  getInfluenceAt,
  setInfluenceAt,
  addInfluenceAt,
  stampInfluence,
  propagateInfluence,
  decayInfluence,
  clearInfluence,
  findLowestInfluence,
  findHighestInfluence,
  sampleCombinedInfluence,
  findChokePoints,
  updateThreatInfluence,
  updateAllyInfluence,
  reservePath,
  clearPathReservations,
} from "./AIInfluenceMap.js";

// Steering behaviors
export {
  createSteeringAgent,
  applyForce,
  updateSteering,
  seek,
  flee,
  arrive,
  pursue,
  evade,
  wander,
  avoidObstacles,
  avoidWalls,
  separation,
  alignment,
  cohesion,
  flock,
  followPath,
  createFlowField,
  setFlowDirection,
  getFlowDirection,
  followFlowField,
  generateFlowFieldToTarget,
} from "./AISteering.js";

// Smart objects
export {
  OBJECT_CATEGORY,
  INTERACTION_STATE,
  createSmartObject,
  getSlotWorldPosition,
  findAvailableSlot,
  reserveSlot,
  releaseSlot,
  checkPrerequisites,
  createInteraction,
  updateInteraction,
  completeInteraction,
  createSmartObjectRegistry,
  registerSmartObject,
  findByCategory,
  findByTag,
  findNearestUsable,
  createHealthStation,
  createAmmoCrate,
  createDoor,
} from "./AISmartObjects.js";

// Morale system
export {
  MORALE_STATE,
  DEFAULT_MORALE_PARAMS,
  createMoraleState,
  changeMorale,
  applySuppression as applyMoraleSuppression,
  processDamageMorale,
  processAllyDeath,
  processEnemyDeath,
  rally,
  updateMorale,
  updateMoraleContext,
  getMoraleAccuracyMod,
  getMoraleSpeedMod,
  getMoraleReactionMod,
  shouldFlee,
  shouldSurrender,
  shouldSeekCover,
  shouldBeAggressive,
  moraleCheck,
  getGroupMorale,
  isGroupRouting,
  groupRally,
} from "./AIMorale.js";

// Memory system
export {
  MEMORY_TYPE,
  IMPORTANCE,
  createWorkingMemory,
  workingMemoryPush,
  setFocus,
  getWorkingMemoryByType,
  clearWorkingMemory,
  createEpisodicMemory,
  createEpisode,
  storeEpisode,
  recallEpisodesWithEntity,
  recallEpisodesWithEmotion,
  recallRecentEpisodes,
  searchEpisodes,
  createSemanticMemory,
  storeFact,
  getFact,
  storeRelationship,
  queryRelationships,
  storeBelief,
  challengeBelief,
  createProceduralMemory,
  practiceSkill,
  getSkillProficiency,
  formHabit,
  getHabitualResponse,
  createMemorySystem,
  consolidateMemories,
  getEntityImpression,
} from "./AIMemory.js";

// Personality and emotions
export {
  TRAIT,
  EMOTION,
  COMPLEX_EMOTION,
  RELATIONSHIP_TYPE,
  createPersonality,
  createPersonalityFromArchetype,
  getPersonalityBehaviorMod,
  createEmotionalState,
  applyEmotionalStimulus,
  decayEmotions,
  hasComplexEmotion,
  createRelationshipTracker,
  getRelationship,
  recordInteraction,
  getDisposition,
  willHelp,
  createCharacterState,
  updateCharacterState,
} from "./AIPersonality.js";

// Scheduler and needs
export {
  NEED,
  URGENCY,
  JOB_TYPE,
  createNeedsState,
  updateNeeds,
  satisfyNeed,
  getMostUrgentNeed,
  getCriticalNeeds,
  calculateWellbeing as calculateNeedsWellbeing,
  createActivity,
  scoreActivity,
  selectActivity,
  createSchedule,
  addScheduleEntry,
  getScheduledActivity,
  createJob,
  isWorkTime,
  createNPCScheduler,
  updateScheduler,
  PRESET_ACTIVITIES,
} from "./AIScheduler.js";

// Factions and diplomacy
export {
  DIPLOMATIC_STANCE,
  REPUTATION_LEVEL,
  TREATY_TYPE,
  createFaction,
  createFactionManager,
  registerFaction,
  getEntityFaction,
  addToFaction,
  setDiplomaticStance,
  getDiplomaticStance,
  areFactionsHostile,
  areFactionsAllied,
  areEntitiesHostile,
  modifyPlayerReputation,
  getPlayerReputationLevel,
  canAccessFactionService,
  createTreaty,
  proposeTreaty,
  declareWar,
  claimTerritory,
  getTerritoryOwner,
  calculateFactionPower,
} from "./AIFaction.js";

// Formations
export {
  FORMATION_TYPE,
  createFormation,
  generateFormationSlots,
  createFormationManager,
  assignToFormation,
  removeFromFormation,
  getFormationPosition,
  moveFormation,
  updateFormationMovement,
  changeFormation,
  getAllFormationPositions,
  isFormationComplete,
  PRESET_FORMATIONS,
} from "./AIFormation.js";

// Dialogue system
export {
  NODE_TYPE,
  createDialogueTree,
  createDialogueNode,
  addDialogueNode,
  createDialogueState,
  addDialogueTree,
  setDialogueFlag,
  getDialogueFlag,
  startConversation,
  selectChoice,
  continueDialogue,
  dialogueBuilder,
} from "./AIDialogue.js";

// Ecology/Wildlife
export {
  SPECIES_ROLE,
  CREATURE_STATE,
  createSpecies,
  createCreature,
  createEcosystem,
  registerSpecies,
  spawnCreature,
  removeCreature,
  createFoodSource,
  consumeFood,
  createPack,
  addToPack,
  updateCreature,
  updateEcosystem,
  getEcosystemStats,
} from "./AIEcology.js";

// Economy
export {
  RESOURCE_CATEGORY,
  MARKET_TREND,
  createResource,
  createMarket,
  initMarketResource,
  calculatePrice,
  updateMarketPrices,
  buyFromMarket,
  sellToMarket,
  createInventory,
  addToInventory,
  removeFromInventory,
  createRecipe,
  canCraft,
  craft,
  createProductionBuilding,
  updateProductionBuilding,
  createEconomyManager,
  registerResource,
  registerRecipe,
  updateEconomy,
  PRESET_RESOURCES,
} from "./AIEconomy.js";

// World simulation
export {
  SEASON,
  DAY_OF_WEEK,
  MONTH,
  WEATHER_TYPE,
  EVENT_TYPE,
  createWorldTime,
  advanceTime,
  getSeason,
  getDayPhase,
  formatTime,
  formatDate,
  createWeatherSystem,
  updateWeather,
  getWeatherEffects,
  createWorldEvent,
  createEventManager,
  scheduleEvent,
  updateEvents,
  createWorldState,
  updateWorldState,
} from "./AIWorld.js";

// AI Director (L4D style)
export {
  PACING_STATE,
  INTENSITY_LEVEL,
  createPlayerState,
  updatePlayerState,
  createPacingController,
  updatePacing,
  createSpawnDirector,
  registerSpawnType,
  addSpawnPoint,
  updateSpawnDirector,
  reportSpawnKilled,
  createDifficultyScaler,
  updateDifficulty,
  createAIDirector,
  updateAIDirector,
} from "./AIDirector.js";

// Knowledge/Rumors
export {
  INFO_TYPE,
  RELIABILITY,
  createKnowledge,
  distortKnowledge,
  createKnowledgeBase,
  addKnowledge,
  queryKnowledge,
  hasKnowledgeOf,
  shareKnowledge,
  spreadKnowledge,
  createWorldKnowledgeManager,
  registerNPCKnowledge,
  connectNPCs,
  announcePublicKnowledge,
  updateKnowledgePropagation,
} from "./AIKnowledge.js";

// Vehicle/Traffic
export {
  DRIVE_MODE,
  TRAFFIC_LIGHT,
  createVehicleType,
  createVehicle,
  updateVehiclePhysics,
  updateVehicleAI,
  setVehiclePath,
  createTrafficSystem,
  updateTrafficSystem,
  PRESET_VEHICLES,
} from "./AIVehicle.js";

// Crowd simulation
export {
  CROWD_BEHAVIOR,
  AGENT_STATE,
  calculateSocialForce,
  createCrowdAgent,
  createCrowdSystem,
  addCrowdAgent,
  removeCrowdAgent,
  addCrowdWall,
  addAttractor,
  triggerPanic,
  triggerEvacuation,
  updateCrowd,
  getCrowdStats,
} from "./AICrowd.js";

// Quest system
export {
  QUEST_TYPE,
  QUEST_STATUS,
  QUEST_PRIORITY,
  createObjective,
  updateObjectiveProgress,
  createQuest,
  canAcceptQuest,
  acceptQuest,
  checkQuestComplete,
  turnInQuest,
  failQuest,
  createQuestManager,
  registerQuest,
  updateAvailableQuests,
  reportQuestEvent,
  generateQuest,
  generateDailyQuests,
} from "./AIQuest.js";

// Sound propagation
export {
  SOUND_CATEGORY,
  SURFACE_TYPE,
  SOUND_PRIORITY,
  createSoundEvent,
  createSoundSystem,
  registerListener,
  updateListenerPosition,
  addSoundOccluder,
  emitSound,
  calculateSoundIntensity,
  updateSoundSystem,
  getRecentDetections,
  getHighestPriorityDetection,
  emitFootstep,
  emitGunshot,
  emitExplosion,
} from "./AISound.js";

// Terrain analysis
export {
  TERRAIN_TYPE,
  createTerrainGrid,
  setTerrainType,
  getTerrainType,
  setTerrainHeight,
  getTerrainHeight,
  worldToTerrainCell,
  terrainCellToWorld,
  getTerrainPropertiesAt,
  calculateMovementCost,
  getStealthModifier,
  getNoiseModifier,
  calculateHeightAdvantage,
  findHighGround,
  findConcealment,
  detectChokepoints,
  evaluateTacticalPosition,
} from "./AITerrain.js";

// Loot system
export {
  RARITY,
  RARITY_COLORS,
  ITEM_CATEGORY,
  createItemDef,
  createItemInstance,
  createAffix,
  applyAffix,
  generateItemName,
  createLootEntry,
  createLootTable,
  rollLootTable,
  rollRarity,
  createLootManager,
  registerItemDef,
  registerAffix,
  registerLootTable,
  dropLoot,
  cleanupDrops,
} from "./AILoot.js";

// Advanced hit detection (swept collision, damage falloff, spatial optimization)
export {
  // Swept collision (prevents tunneling)
  sweptSphereSphere,
  sweptSphereSphereMoving,
  capsuleSphereIntersect,
  
  // Damage falloff
  calculateDamageFalloff as calculateHitDamageFalloff,
  FALLOFF_TYPE,
  
  // AoE detection
  getAoETargets,
  getConeTargets,
  
  // Spatial optimization
  SpatialHash,
  
  // Complete systems
  checkProjectileHit,
  checkBeamHit,
  
  // Types
  HITBOX_TYPE,
} from "./AIHitDetection.js";

// Advanced senses (scent, vibration, danger)
export {
  SCENT_TYPE,
  createScentParticle,
  createScentTrail,
  addTrailParticle,
  createScentSystem,
  updateScentSystem,
  smellAt,
  followScentTrail,
  createVibration,
  createTremorSense,
  emitVibration,
  senseVibrations,
  createDangerSense,
  registerThreat,
  removeThreat,
  senseDanger,
  createEnvironmentSensor,
  updateEnvironmentReadings,
  getEnvironmentalComfort,
  detectEnvironmentTrend,
} from "./AISenses.js";

// Values, Beliefs, Dreams, Motivations (Dwarf Fortress inspired)
export {
  VALUE,
  VALUE_LEVEL,
  GOAL_TYPE,
  GOAL_STATUS,
  PSYCH_NEED,
  PREF_CATEGORY,
  createValueSystem,
  createLifeGoal,
  getValue,
  setValue,
  modifyValue,
  valuesPositively,
  getTopValues,
  satisfyPsychNeed,
  decayPsychNeeds,
  getMostDeprivedNeed,
  calculateWellbeing,

  calculateWellbeing as calculateValuesWellbeing,
  addLifeGoal,
  updateGoalProgress,
  pursueGoal,
  getActiveGoals,
  getUnfulfilledDreams,
  scoreActionByValues,
  wouldDoAction,
  VALUE_PRESETS,
  createFromPreset,
} from "./AIValues.js";

// Blackboard
export {
  createBlackboard,
  getBlackboardValue,
  setBlackboardValue,
  removeBlackboardValue,
  clearBlackboard,
  exportBlackboard,
  createBlackboardRegistry,
} from "./Blackboard.js";

// Navigation
export {
  createNavGrid,
  destroyNavGrid,
  worldToGrid,
  gridToWorld,
  isCellWalkable,
  setCellWalkable,
  bakeNavGridFromWorldSim,
} from "./NavGrid.js";

export {
  createNavWorld,
  destroyNavWorld,
  addGridLayer,
  getGridLayer,
  removeGridLayer,
} from "./NavWorld.js";

export {
  findPathOnGrid,
  findPathInNavWorld,
} from "./Pathfinder.js";
