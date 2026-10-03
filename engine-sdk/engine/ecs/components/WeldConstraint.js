// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { WELD_CONSTRAINT_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(WELD_CONSTRAINT_SCHEMA);

function normalize(input) {
  return normalizeBySchema(WELD_CONSTRAINT_SCHEMA, input);
}

function validate(value) {
  // Validate required fields
  const normalized = normalize(value);
  
  if (normalized.parentEntityId == null) {
    console.warn('[WeldConstraint] Missing required field: parentEntityId');
  }
  if (normalized.childEntityId == null) {
    console.warn('[WeldConstraint] Missing required field: childEntityId');
  }
  if (normalized.parentEntityId === normalized.childEntityId) {
    console.warn('[WeldConstraint] parentEntityId cannot equal childEntityId');
  }
  
  return normalized;
}

export const WeldConstraintDefinition = defineComponentType({
  name: "WeldConstraint",
  version: 1,
  schema: WELD_CONSTRAINT_SCHEMA,
  defaults,
  normalize,
  validate,
});

/**
 * Create a new WeldConstraint component
 * @param {Object} initial - Initial values
 * @returns {Object} WeldConstraint component data
 */
export function createWeldConstraint(initial) {
  return WeldConstraintDefinition.create(initial);
}

/**
 * Create a weld constraint between two entities
 * @param {number} parentEntityId - Entity that will receive shapes
 * @param {number} childEntityId - Entity whose shapes will be transferred
 * @param {Object} options - Additional options
 * @returns {Object} WeldConstraint component data
 */
export function createWeld(parentEntityId, childEntityId, options = {}) {
  return createWeldConstraint({
    parentEntityId,
    childEntityId,
    weldType: options.weldType || 'shapeTransfer',
    offset: options.offset || [0, 0, 0],
    relativeRotation: options.relativeRotation || [0, 0, 0, 1],
    breakable: options.breakable || false,
    breakForce: options.breakForce || 0,
    breakTorque: options.breakTorque || 0,
    createdAt: Date.now(),
  });
}

/**
 * Check if a weld constraint is valid
 * @param {Object} weld - WeldConstraint component data
 * @returns {boolean} True if valid
 */
export function isValidWeld(weld) {
  if (!weld) return false;
  if (weld.parentEntityId == null) return false;
  if (weld.childEntityId == null) return false;
  if (weld.parentEntityId === weld.childEntityId) return false;
  if (weld.isBroken) return false;
  return true;
}

/**
 * Mark a weld as broken
 * @param {Object} weld - WeldConstraint component data
 * @returns {Object} Updated weld data
 */
export function breakWeld(weld) {
  return {
    ...weld,
    isBroken: true,
  };
}
