// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const PAGE_TRANSITION_SCHEMA_VERSION = 1;
export const PAGE_TRANSITION_INTENT_SCHEMA = 'plauna.page-transition-intent.v1';
export const PAGE_TRANSITION_RESOLVED_SCHEMA = 'plauna.page-transition-resolved.v1';

export class UnsupportedPageTransitionVersionError extends Error {
  constructor(kind, version) {
    super(`Unsupported page transition ${kind} schema version: ${version}`);
    this.name = 'UnsupportedPageTransitionVersionError';
    this.version = version;
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function assertEnvelope(input, schema, kind) {
  if (input.schema !== undefined && input.schema !== schema) {
    throw new Error(`Unsupported page transition ${kind} schema: ${input.schema}`);
  }
  const version = input.schemaVersion ?? PAGE_TRANSITION_SCHEMA_VERSION;
  if (version !== PAGE_TRANSITION_SCHEMA_VERSION) throw new UnsupportedPageTransitionVersionError(kind, version);
}

function optionalString(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string or null`);
  return value;
}

export function preparePageTransitionIntent(input) {
  assertRecord(input, 'Page transition intent');
  assertEnvelope(input, PAGE_TRANSITION_INTENT_SCHEMA, 'intent');
  return {
    schema: PAGE_TRANSITION_INTENT_SCHEMA,
    schemaVersion: PAGE_TRANSITION_SCHEMA_VERSION,
    preset: optionalString(input.preset, 'Transition preset'),
    direction: optionalString(input.direction, 'Transition direction'),
    morph: optionalString(input.morph, 'Transition morph'),
    duration: optionalString(input.duration, 'Transition duration'),
    easing: optionalString(input.easing, 'Transition easing'),
    class: optionalString(input.class, 'Transition class'),
    focus: optionalString(input.focus, 'Transition focus selector'),
  };
}

export function preparePageTransitionResolved(input) {
  assertRecord(input, 'Resolved page transition');
  assertEnvelope(input, PAGE_TRANSITION_RESOLVED_SCHEMA, 'resolved metadata');
  const duration = input.duration === null || input.duration === undefined ? null : Number(input.duration);
  if (duration !== null && (!Number.isFinite(duration) || duration < 0)) {
    throw new TypeError('Resolved page transition duration must be a non-negative finite number');
  }
  return {
    schema: PAGE_TRANSITION_RESOLVED_SCHEMA,
    schemaVersion: PAGE_TRANSITION_SCHEMA_VERSION,
    type: optionalString(input.type, 'Resolved transition type'),
    morphId: optionalString(input.morphId, 'Resolved transition morph id'),
    duration,
    easing: optionalString(input.easing, 'Resolved transition easing'),
    class: optionalString(input.class, 'Resolved transition class'),
    focus: optionalString(input.focus, 'Resolved transition focus selector'),
  };
}
