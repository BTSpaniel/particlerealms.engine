// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * NodeRegistry.js — Unified Node Type Registry
 * 
 * Single source of truth for mapping node type names to their
 * Web Audio factory functions and worklet processor names.
 * 
 * Usage:
 *   import { getNodeFactory, getRegisteredTypes } from './NodeRegistry.js';
 *   const factory = getNodeFactory('Waveguide');
 *   const node = factory(ctx, params, pitchRatio);
 */

import { createWebAudioNode } from './WebAudioNodeFactory.js';

// ============================================================================
// REGISTRY
// ============================================================================

/**
 * Node category definitions for organization/UI.
 */
export const NODE_CATEGORIES = {
  generators: ['Oscillator', 'NoiseGenerator', 'Impulse'],
  processors: ['Filter', 'Gain', 'Delay', 'Reverb', 'Compressor', 'Waveshaper', 'CombFilter', 'Envelope'],
  modulators: ['LFO', 'GameParam', 'MathOp', 'RandomWalk'],
  synthesis: ['Waveguide', 'ModalBank', 'KarplusStrong', 'FMOperator', 'FormantFilter', 'GrainCloud', 'SoundBlender'],
  atoms: ['CrackleAtom', 'HissAtom', 'WhooshAtom', 'DropAtom', 'RumbleAtom'],
  physics: ['CombustionModel', 'FluidModel', 'WindModel', 'WeatherModel', 'ModalImpactModel'],
  output: ['Output'],
};

/**
 * All registered node type names (flat list).
 */
export const ALL_NODE_TYPES = Object.values(NODE_CATEGORIES).flat();

/**
 * Get the Web Audio factory function for a node type.
 * Returns a function: (ctx, nodeDefinition, pitchRatio) => { output, input, sources }
 * 
 * @param {string} type - Node type name
 * @returns {Function}
 */
export function getNodeFactory(type) {
  // All types route through the unified factory
  return (ctx, nodeDefinition, pitchRatio) => createWebAudioNode(ctx, nodeDefinition, pitchRatio);
}

/**
 * Get all registered type names.
 * @returns {string[]}
 */
export function getRegisteredTypes() {
  return [...ALL_NODE_TYPES];
}

/**
 * Get the category for a node type.
 * @param {string} type
 * @returns {string|null}
 */
export function getNodeCategory(type) {
  for (const [category, types] of Object.entries(NODE_CATEGORIES)) {
    if (types.includes(type)) return category;
  }
  return null;
}

/**
 * Check if a node type has a worklet processor.
 * These types have sample-level DSP in PatchRunner.worklet.js.
 */
const WORKLET_TYPES = new Set([
  'Oscillator', 'NoiseGenerator', 'Impulse',
  'Filter', 'Gain', 'Envelope', 'LFO', 'GameParam', 'MathOp',
  'Delay', 'Reverb', 'Compressor', 'Waveshaper', 'CombFilter',
  'Waveguide', 'ModalBank', 'KarplusStrong', 'FMOperator', 'FormantFilter',
  'GrainCloud', 'SoundBlender', 'RandomWalk', 'Output',
]);

/**
 * Check if a type has a worklet processor implementation.
 * @param {string} type
 * @returns {boolean}
 */
export function hasWorkletProcessor(type) {
  return WORKLET_TYPES.has(type);
}
