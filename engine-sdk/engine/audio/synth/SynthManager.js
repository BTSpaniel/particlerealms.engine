// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SynthManager.js - Main-Thread Synthesis Orchestrator
 * 
 * Manages AudioWorklet registration, patch instance lifecycle,
 * parameter updates via MessagePort and SharedArrayBuffer.
 */

import { compilePatch } from './PatchCompiler.js';

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a synth manager.
 * @param {AudioContext} context
 * @param {AudioNode} destination - Node to connect synth output to
 * @returns {Object}
 */
export function createSynthManager(context, destination) {
  if (!context || !destination) return null;
  return {
    context,
    destination,
    workletReady: false,
    instances: new Map(), // instanceId → { node, plan, sharedBuffer, gainNode }
    _nextInstanceId: 1,
    patchLibrary: new Map(), // patchId → compiled plan
  };
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the synth manager — register the AudioWorklet.
 * @param {Object} manager
 * @param {string} workletUrl - URL to PatchRunner.worklet.js
 * @returns {Promise<boolean>}
 */
export async function initSynthManager(manager, workletUrl) {
  if (!manager || !manager.context) return false;

  try {
    await manager.context.audioWorklet.addModule(workletUrl);
    manager.workletReady = true;
    console.log('[SynthManager] AudioWorklet registered');
    return true;
  } catch (err) {
    console.warn('[SynthManager] AudioWorklet registration failed:', err.message);
    return false;
  }
}

// ============================================================================
// PATCH LIBRARY
// ============================================================================

/**
 * Register a patch in the library (compile and cache).
 * @param {Object} manager
 * @param {Object} patchJson - Raw patch JSON
 * @returns {boolean} true if compiled successfully
 */
export function registerPatch(manager, patchJson) {
  if (!manager || !patchJson) return false;

  const result = compilePatch(patchJson);
  if (!result.ok) {
    console.warn(`[SynthManager] Patch compile error: ${result.error}`);
    return false;
  }

  manager.patchLibrary.set(result.plan.id, result.plan);
  return true;
}

/**
 * Get a compiled patch plan.
 * @param {Object} manager
 * @param {string} patchId
 * @returns {Object|null}
 */
export function getPatch(manager, patchId) {
  if (!manager) return null;
  return manager.patchLibrary.get(patchId) || null;
}

// ============================================================================
// INSTANCES
// ============================================================================

/**
 * Create and start a patch instance (a playing synth voice).
 * @param {Object} manager
 * @param {string} patchId - ID of registered patch
 * @param {Object} options
 * @param {number} options.volume - Output volume (default 1.0)
 * @param {AudioNode} options.destination - Override destination node
 * @returns {number|null} Instance ID
 */
export function createPatchInstance(manager, patchId, options = {}) {
  if (!manager || !manager.workletReady) return null;

  const plan = manager.patchLibrary.get(patchId);
  if (!plan) {
    console.warn(`[SynthManager] Patch not found: ${patchId}`);
    return null;
  }

  try {
    const node = new AudioWorkletNode(manager.context, 'patch-runner', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Gain node for volume control
    const gainNode = manager.context.createGain();
    gainNode.gain.value = options.volume ?? 1.0;
    node.connect(gainNode);
    gainNode.connect(options.destination || manager.destination);

    // SharedArrayBuffer for game params
    const exposedCount = plan.exposed ? plan.exposed.length : 0;
    let sharedBuffer = null;
    if (exposedCount > 0 && typeof SharedArrayBuffer !== 'undefined') {
      sharedBuffer = new SharedArrayBuffer(exposedCount * 4); // Float32
      node.port.postMessage({ type: 'setSharedBuffer', buffer: sharedBuffer });
    }

    // Send plan to worklet
    node.port.postMessage({ type: 'loadPlan', plan });

    const id = manager._nextInstanceId++;
    manager.instances.set(id, {
      node,
      plan,
      gainNode,
      sharedBuffer,
      sharedView: sharedBuffer ? new Float32Array(sharedBuffer) : null,
      patchId,
    });

    return id;
  } catch (err) {
    console.warn('[SynthManager] Failed to create patch instance:', err.message);
    return null;
  }
}

/**
 * Set an exposed parameter on a running instance.
 * @param {Object} manager
 * @param {number} instanceId
 * @param {string} paramName - Exposed parameter name
 * @param {number} value
 */
export function setInstanceParam(manager, instanceId, paramName, value) {
  if (!manager) return;
  const inst = manager.instances.get(instanceId);
  if (!inst) return;

  // Try SharedArrayBuffer first (zero-latency)
  if (inst.sharedView && inst.plan.exposed) {
    for (let i = 0; i < inst.plan.exposed.length; i++) {
      if (inst.plan.exposed[i].name === paramName) {
        inst.sharedView[i] = value;
        return;
      }
    }
  }

  // Fallback to MessagePort
  const [nodeId, pName] = _resolveExposedParam(inst.plan, paramName);
  if (nodeId) {
    inst.node.port.postMessage({ type: 'setParam', nodeId, paramName: pName, value });
  }
}

/**
 * Set volume on a running instance.
 * @param {Object} manager
 * @param {number} instanceId
 * @param {number} volume
 */
export function setInstanceVolume(manager, instanceId, volume) {
  if (!manager) return;
  const inst = manager.instances.get(instanceId);
  if (!inst) return;
  inst.gainNode.gain.setTargetAtTime(Math.max(0, Math.min(2, volume)), manager.context.currentTime, 0.02);
}

/**
 * Stop and destroy a patch instance.
 * @param {Object} manager
 * @param {number} instanceId
 * @param {number} fadeOut - Seconds (default 0.05)
 */
export function destroyPatchInstance(manager, instanceId, fadeOut = 0.05) {
  if (!manager) return;
  const inst = manager.instances.get(instanceId);
  if (!inst) return;

  const now = manager.context.currentTime;
  inst.gainNode.gain.setTargetAtTime(0, now, fadeOut * 0.3);

  // Schedule cleanup
  setTimeout(() => {
    try {
      inst.node.port.postMessage({ type: 'stop' });
      inst.node.disconnect();
      inst.gainNode.disconnect();
    } catch (_) {}
  }, fadeOut * 1000 + 50);

  manager.instances.delete(instanceId);
}

/**
 * Stop all instances.
 * @param {Object} manager
 */
export function destroyAllInstances(manager) {
  if (!manager) return;
  for (const id of [...manager.instances.keys()]) {
    destroyPatchInstance(manager, id, 0.02);
  }
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy the synth manager.
 * @param {Object} manager
 */
export function destroySynthManager(manager) {
  if (!manager) return;
  destroyAllInstances(manager);
  manager.patchLibrary.clear();
  manager.context = null;
  manager.destination = null;
}

// ============================================================================
// INTERNAL
// ============================================================================

function _resolveExposedParam(plan, paramName) {
  if (!plan.exposed) return [null, null];
  for (const exp of plan.exposed) {
    if (exp.name === paramName) {
      const parts = exp.param.split('.');
      return [parts[0], parts[1]];
    }
  }
  return [null, null];
}
