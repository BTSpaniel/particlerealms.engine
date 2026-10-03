// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ToolsImports: convenience barrel for engine tools (inspector, spawn, picking, camera, grab).

import {
  Inspector,
  Spawn,
  Ghost,
  Picking,
  ScreenRayCaster,
  CameraTools,
  Grab,
  PhysicsScenes,
} from "./EngineImports.js";
import { attachPhysicsSandboxInspector } from "./tools/inspector/PhysicsSandboxInspector.js";
import * as Rigging from "./tools/rigging/SkinWeightTransfer.js";
import * as AnimationTools from "./tools/animation/FBXAscii.js";

// Grouped namespaces
export const ToolsInspector = Inspector;
export const ToolsSpawn = Spawn;
export const ToolsGhost = Ghost;
export const ToolsPicking = Picking;
export const ToolsScreenRay = ScreenRayCaster;

export const ROOM_PICKING_LIMITS = Picking.ROOM_PICKING_LIMITS;
export const pickingRayReport = Picking.pickingRayReport;
export const roomPickingOptionsReport = Picking.roomPickingOptionsReport;
export const entityPickingOptionsReport = Picking.entityPickingOptionsReport;
export const SCREEN_RAY_LIMITS = ScreenRayCaster.SCREEN_RAY_LIMITS;
export const screenPickInputReport = ScreenRayCaster.screenPickInputReport;
export const screenCameraBasisReport = ScreenRayCaster.screenCameraBasisReport;
export const screenCameraStateReport = ScreenRayCaster.screenCameraStateReport;
export const ToolsCamera = CameraTools;
export const ToolsGrab = Grab;
export const ToolsPhysicsScenes = PhysicsScenes;
export const ToolsRigging = Rigging;
export const ToolsAnimation = AnimationTools;

// Flat helpers
export const attachInspectorPanel = Inspector.attachInspectorPanel;

export const spawnPhysicsObjectAtPosition =
  Spawn.spawnPhysicsObjectAtPosition;
export const getGhostPreviewInfo = Ghost.getGhostPreviewInfo;
export const createGhostSelectionState = Ghost.createGhostSelectionState;
export const addGhostToSelection = Ghost.addGhostToSelection;
export const setActiveGhostInSelection = Ghost.setActiveGhostInSelection;
export const setActiveGhostBasePosition = Ghost.setActiveGhostBasePosition;
export const setActiveGhostOffset = Ghost.setActiveGhostOffset;
export const getGhostWorldPosition = Ghost.getGhostWorldPosition;
export const getActiveGhost = Ghost.getActiveGhost;
export const getActiveGhostWorldPosition = Ghost.getActiveGhostWorldPosition;

export const pickRoomSurfaceFromRay = Picking.pickRoomSurfaceFromRay;
export const pickEntityFromRay = Picking.pickEntityFromRay;
export const getPickRayForCanvasFromScreen = ScreenRayCaster.getPickRayForCanvas;

export const updateStandardCamera = CameraTools.updateStandardCamera;
export const getStandardCameraEyeBasis = CameraTools.getStandardCameraEyeBasis;
export const STANDARD_CAMERA_LIMITS = CameraTools.STANDARD_CAMERA_LIMITS;
export const standardCameraStateReport = CameraTools.standardCameraStateReport;
export const standardCameraOptionsReport = CameraTools.standardCameraOptionsReport;
export const standardCameraUpdateReport = CameraTools.standardCameraUpdateReport;
export const standardCameraKeysReport = CameraTools.standardCameraKeysReport;
export const standardCameraMovementResponseReport = CameraTools.standardCameraMovementResponseReport;
export const standardCameraZoomReport = CameraTools.standardCameraZoomReport;
export const standardCameraBoomReport = CameraTools.standardCameraBoomReport;
export const standardCameraFocusReport = CameraTools.standardCameraFocusReport;
export const standardCameraFocusTransitionReport = CameraTools.standardCameraFocusTransitionReport;
export const standardCameraSphereFitReport = CameraTools.standardCameraSphereFitReport;
export const standardCameraBoundsReport = CameraTools.standardCameraBoundsReport;
export const standardCameraBoundsFocusReport = CameraTools.standardCameraBoundsFocusReport;
export const standardCameraMovementIntentReport = CameraTools.standardCameraMovementIntentReport;

export const createGrabState = Grab.createGrabState;
export const startGrabCandidate = Grab.startGrabCandidate;
export const cancelGrabCandidate = Grab.cancelGrabCandidate;
export const releaseGrabbed = Grab.releaseGrabbed;
export const configurePhysicsSandboxScene =
  PhysicsScenes.configurePhysicsSandboxScene;
export { attachPhysicsSandboxInspector };

export const buildSourceSurfaceBVH = Rigging.buildSourceSurfaceBVH;
export const estimateAlignmentICP = Rigging.estimateAlignmentICP;
export const transferSkinWeightsCPU = Rigging.transferSkinWeightsCPU;
export const transferSkinWeightsGPU = Rigging.transferSkinWeightsGPU;
export const SkinWeightTransferGPU = Rigging.SkinWeightTransferGPU;

export const parseFBXAscii = AnimationTools.parseFBXAscii;
export const buildMixamoSkeletonFromFBX = AnimationTools.buildMixamoSkeletonFromFBX;
export const sampleMixamoFBXAnimationClip = AnimationTools.sampleMixamoFBXAnimationClip;
export const loadMixamoFBXAscii = AnimationTools.loadMixamoFBXAscii;
export const findSkeletonJointIndexByName = AnimationTools.findSkeletonJointIndexByName;
export const computeClipLocalMatricesAtFrame = AnimationTools.computeClipLocalMatricesAtFrame;
export const computeClipGlobalMatricesAtFrame = AnimationTools.computeClipGlobalMatricesAtFrame;
export const extractRootTranslationTrack = AnimationTools.extractRootTranslationTrack;
export const extractRootMotion = AnimationTools.extractRootMotion;
export const buildTeacherJointPositionDataset = AnimationTools.buildTeacherJointPositionDataset;
