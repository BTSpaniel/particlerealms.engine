// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Signed publish/inspect/enter/leave history with exact branch-aware returns. */

import { canonicalize } from '../../../state/util/canonical.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  createRealmId,
} from '../addressing/RealmIds.js';
import {
  signBranchRecord,
  verifyBranchRecord,
} from '../branches/RealmBranchCrypto.js';
import { deepFreeze } from '../capsule/RealmCapsuleSchema.js';
import {
  boundedInteger,
  boundedToken,
} from '../governance/GovernanceCrypto.js';

export const REALM_JOURNEY_EVENT_V1_FORMAT = 'realm-journey-event-v1';
export const REALM_JOURNEY_SNAPSHOT_V1_FORMAT = 'realm-journey-snapshot-v1';

export const REALM_JOURNEY_ACTION = Object.freeze({
  PUBLISH: 'publish',
  INSPECT: 'inspect',
  ENTER: 'enter',
  LEAVE: 'leave',
  RETURN: 'return',
});

const ACTIONS = new Set(Object.values(REALM_JOURNEY_ACTION));
const CONTENT_ID = /^sha256:[0-9a-f]{64}$/;
const HASH_ID = /^sha256:256:[0-9a-f]{64}$/;
const EVENT_FIELDS = new Set([
  'format', 'schemaVersion', 'journalId', 'sequence', 'previousEventId', 'actorId',
  'action', 'location', 'visitId', 'returnTarget', 'publicationId', 'occurredAt',
  'signer', 'eventId', 'signatureHex',
]);

function assertKnownFields(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name} contains unknown field ${key}`);
  }
}

function normalizeContentId(value, name) {
  const result = String(value ?? '').toLowerCase();
  if (!CONTENT_ID.test(result)) throw new TypeError(`${name} must be a SHA-256 content ID`);
  return result;
}

export function normalizeRealmLocation(value, name = 'Realm location') {
  assertKnownFields(value, new Set(['realmId', 'branchId', 'capsuleRoot']), name);
  return deepFreeze({
    realmId: assertRealmId(value.realmId, REALM_ID_TYPE.REALM, `${name} Realm ID`),
    branchId: assertRealmId(value.branchId, REALM_ID_TYPE.BRANCH, `${name} branch ID`),
    capsuleRoot: normalizeContentId(value.capsuleRoot, `${name} Capsule root`),
  });
}

function sameLocation(left, right) {
  return left != null && right != null && canonicalize(left) === canonicalize(right);
}

function nullablePublicationId(value, name) {
  return value == null ? null : assertRealmId(value, REALM_ID_TYPE.PUBLICATION, name);
}

function normalizeJourneyEventBody(input) {
  if (input.format !== REALM_JOURNEY_EVENT_V1_FORMAT || input.schemaVersion !== 1) {
    throw new TypeError('Journey event format or schema version is invalid');
  }
  const action = boundedToken(input.action, 'Journey action', 32);
  if (!ACTIONS.has(action)) throw new TypeError(`Unsupported journey action: ${action}`);
  const sequence = boundedInteger(input.sequence, 'Journey sequence', 1);
  const previousEventId = input.previousEventId == null ? null : String(input.previousEventId);
  if ((sequence === 1) !== (previousEventId === null)) {
    throw new Error('Journey first event and previous-event link are inconsistent');
  }
  if (previousEventId !== null && !HASH_ID.test(previousEventId)) throw new TypeError('Journey previous event ID is invalid');
  const location = normalizeRealmLocation(input.location);
  const visitId = nullablePublicationId(input.visitId, 'Journey visit ID');
  const publicationId = nullablePublicationId(input.publicationId, 'Journey publication ID');
  const returnTarget = input.returnTarget == null ? null : normalizeRealmLocation(input.returnTarget, 'Journey return target');

  if (action === REALM_JOURNEY_ACTION.PUBLISH) {
    if (!publicationId || visitId || returnTarget) throw new Error('Publish events require only a publication ID');
  } else if (action === REALM_JOURNEY_ACTION.INSPECT) {
    if (publicationId || visitId || returnTarget) throw new Error('Inspect events cannot alter publication or visit state');
  } else {
    if (!visitId || !returnTarget || publicationId) throw new Error(`${action} events require a visit and return target`);
    if (action === REALM_JOURNEY_ACTION.RETURN && !sameLocation(location, returnTarget)) {
      throw new Error('Return event location must exactly match its branch-aware return target');
    }
  }
  return deepFreeze({
    format: REALM_JOURNEY_EVENT_V1_FORMAT,
    schemaVersion: 1,
    journalId: assertRealmId(input.journalId, REALM_ID_TYPE.PUBLICATION, 'Journey journal ID'),
    sequence,
    previousEventId,
    actorId: assertRealmId(input.actorId, null, 'Journey actor ID'),
    action,
    location,
    visitId,
    returnTarget,
    publicationId,
    occurredAt: boundedInteger(input.occurredAt, 'Journey occurredAt'),
  });
}

export async function createJourneyEvent(input, signer) {
  return signBranchRecord(normalizeJourneyEventBody(input), {
    idField: 'eventId',
    format: REALM_JOURNEY_EVENT_V1_FORMAT,
  }, signer);
}

export async function verifyJourneyEvent(record, options = {}) {
  try {
    assertKnownFields(record, EVENT_FIELDS, 'Journey event');
    const verified = await verifyBranchRecord(record, {
      idField: 'eventId',
      format: REALM_JOURNEY_EVENT_V1_FORMAT,
    });
    if (!verified.valid) return verified;
    const event = normalizeJourneyEventBody(record);
    if (event.action === REALM_JOURNEY_ACTION.PUBLISH) {
      const expectedPublicationId = await createRealmId(REALM_ID_TYPE.PUBLICATION, {
        kind: 'realm-publication',
        realmId: event.location.realmId,
        branchId: event.location.branchId,
        capsuleRoot: event.location.capsuleRoot,
      });
      if (event.publicationId !== expectedPublicationId) {
        return Object.freeze({ valid: false, reason: 'journey-publication-id-mismatch' });
      }
    }
    if (event.action === REALM_JOURNEY_ACTION.ENTER) {
      const expectedVisitId = await createRealmId(REALM_ID_TYPE.PUBLICATION, {
        kind: 'realm-visit',
        journalId: event.journalId,
        actorId: event.actorId,
        sequence: event.sequence,
        target: event.location,
        returnTarget: event.returnTarget,
      });
      if (event.visitId !== expectedVisitId) {
        return Object.freeze({ valid: false, reason: 'journey-visit-id-mismatch' });
      }
    }
    for (const [field, expected] of [
      ['journalId', options.expectedJournalId],
      ['actorId', options.expectedActorId],
      ['sequence', options.expectedSequence],
      ['previousEventId', options.expectedPreviousEventId],
    ]) {
      if (expected !== undefined && event[field] !== expected) {
        return Object.freeze({ valid: false, reason: `journey-${field}-mismatch` });
      }
    }
    if (typeof options.authorizeEvent === 'function'
      && !(await options.authorizeEvent(event, record.signer.fingerprint, record))) {
      return Object.freeze({ valid: false, reason: 'journey-event-unauthorized' });
    }
    return Object.freeze({ ...verified, valid: true, event });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'journey-event-invalid' });
  }
}

/**
 * An append-only signed journal. Entry transitions are replayed locally; no
 * network or storage side effects occur until a caller persists its snapshot.
 */
export class RealmJourneyJournal {
  constructor({
    journalId,
    actorId,
    initialLocation,
    signer = null,
    authorizeEvent = null,
    now = () => Date.now(),
    diagnostic = null,
  } = {}) {
    this.journalId = assertRealmId(journalId, REALM_ID_TYPE.PUBLICATION, 'Journey journal ID');
    this.actorId = assertRealmId(actorId, null, 'Journey actor ID');
    this._initialLocation = normalizeRealmLocation(initialLocation, 'Journey initial location');
    this._location = this._initialLocation;
    this._signer = signer;
    this._authorizeEvent = authorizeEvent;
    this._now = now;
    this._diagnostic = typeof diagnostic === 'function' ? diagnostic : null;
    this._events = [];
    this._recordsById = new Map();
    this._visits = new Map();
    this._activeVisitId = null;
    this._controllerFingerprint = null;
  }

  get size() { return this._events.length; }
  get currentLocation() { return this._location; }
  get activeVisitId() { return this._activeVisitId; }
  events() { return Object.freeze([...this._events]); }
  returnJournal() { return deepFreeze([...this._visits.values()].map(visit => ({ ...visit }))); }

  async appendPublish({ location = this._location, occurredAt = this._now() } = {}) {
    const target = normalizeRealmLocation(location, 'Publish location');
    const publicationId = await createRealmId(REALM_ID_TYPE.PUBLICATION, {
      kind: 'realm-publication',
      realmId: target.realmId,
      branchId: target.branchId,
      capsuleRoot: target.capsuleRoot,
    });
    return this._append({
      action: REALM_JOURNEY_ACTION.PUBLISH,
      location: target,
      visitId: null,
      returnTarget: null,
      publicationId,
      occurredAt,
    });
  }

  async appendInspect({ location, occurredAt = this._now() } = {}) {
    return this._append({
      action: REALM_JOURNEY_ACTION.INSPECT,
      location: normalizeRealmLocation(location, 'Inspect location'),
      visitId: null,
      returnTarget: null,
      publicationId: null,
      occurredAt,
    });
  }

  async appendEnter({ location, occurredAt = this._now() } = {}) {
    if (this._activeVisitId) throw new Error('Cannot enter another Realm while a visit is active');
    if (!this._location) throw new Error('Cannot enter without a branch-aware return location');
    const target = normalizeRealmLocation(location, 'Entry location');
    if (sameLocation(target, this._location)) throw new Error('Entry target must differ from the return location');
    const visitId = await createRealmId(REALM_ID_TYPE.PUBLICATION, {
      kind: 'realm-visit',
      journalId: this.journalId,
      actorId: this.actorId,
      sequence: this._events.length + 1,
      target,
      returnTarget: this._location,
    });
    return this._append({
      action: REALM_JOURNEY_ACTION.ENTER,
      location: target,
      visitId,
      returnTarget: this._location,
      publicationId: null,
      occurredAt,
    });
  }

  async appendLeave({ occurredAt = this._now() } = {}) {
    const visit = this._visits.get(this._activeVisitId);
    if (!visit || visit.status !== 'entered') throw new Error('No entered Realm visit can be left');
    return this._append({
      action: REALM_JOURNEY_ACTION.LEAVE,
      location: visit.location,
      visitId: visit.visitId,
      returnTarget: visit.returnTarget,
      publicationId: null,
      occurredAt,
    });
  }

  async appendReturn({ occurredAt = this._now() } = {}) {
    const visit = this._visits.get(this._activeVisitId);
    if (!visit || visit.status !== 'left') throw new Error('A Realm visit must be left before it can return');
    return this._append({
      action: REALM_JOURNEY_ACTION.RETURN,
      location: visit.returnTarget,
      visitId: visit.visitId,
      returnTarget: visit.returnTarget,
      publicationId: null,
      occurredAt,
    });
  }

  async accept(record) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const expectedSequence = this._events.length + 1;
    const expectedPreviousEventId = this._events.at(-1)?.eventId ?? null;
    const known = this._recordsById.get(record?.eventId);
    if (known) {
      if (canonicalize(known) !== canonicalize(record)) {
        return Object.freeze({ accepted: false, duplicate: false, reason: 'journey-event-id-conflict' });
      }
      return Object.freeze({ accepted: false, duplicate: true, reason: 'journey-event-replay' });
    }
    const verified = await verifyJourneyEvent(record, {
      expectedJournalId: this.journalId,
      expectedActorId: this.actorId,
      expectedSequence,
      expectedPreviousEventId,
    });
    if (!verified.valid) return Object.freeze({ accepted: false, reason: verified.reason });
    if (typeof this._authorizeEvent === 'function') {
      if (!(await this._authorizeEvent(verified.event, record.signer.fingerprint, record))) {
        return Object.freeze({ accepted: false, reason: 'journey-signer-unauthorized' });
      }
    } else if (this._controllerFingerprint && record.signer.fingerprint !== this._controllerFingerprint) {
      return Object.freeze({ accepted: false, reason: 'journey-signer-unauthorized' });
    }
    const previous = this._events.at(-1);
    if (previous && verified.event.occurredAt < previous.occurredAt) {
      return Object.freeze({ accepted: false, reason: 'journey-time-regressed' });
    }
    try {
      this._validateTransition(verified.event);
    } catch (error) {
      return Object.freeze({ accepted: false, reason: error?.message ?? 'journey-transition-invalid' });
    }
    this._controllerFingerprint ??= record.signer.fingerprint;
    this._applyTransition({ ...verified.event, eventId: record.eventId });
    this._events.push(record);
    this._recordsById.set(record.eventId, record);
    this._emit('journey.event-accepted', {
      eventId: record.eventId,
      action: record.action,
      sequence: record.sequence,
      elapsedMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
    });
    return Object.freeze({ accepted: true, eventId: record.eventId, event: record });
  }

  snapshot() {
    return deepFreeze({
      format: REALM_JOURNEY_SNAPSHOT_V1_FORMAT,
      journalId: this.journalId,
      actorId: this.actorId,
      initialLocation: this._initialLocation,
      currentLocation: this._location,
      activeVisitId: this._activeVisitId,
      events: this._events,
      returns: this.returnJournal(),
    });
  }

  async _append(fields) {
    if (!this._signer) throw new Error('Journey journal is read-only without a signer');
    const record = await createJourneyEvent({
      format: REALM_JOURNEY_EVENT_V1_FORMAT,
      schemaVersion: 1,
      journalId: this.journalId,
      sequence: this._events.length + 1,
      previousEventId: this._events.at(-1)?.eventId ?? null,
      actorId: this.actorId,
      ...fields,
    }, this._signer);
    const accepted = await this.accept(record);
    if (!accepted.accepted) throw new Error(`Locally-created journey event was rejected: ${accepted.reason}`);
    return record;
  }

  _validateTransition(event) {
    if (event.action === REALM_JOURNEY_ACTION.PUBLISH) {
      if (!sameLocation(event.location, this._location)) throw new Error('publication-location-not-current');
      return;
    }
    if (event.action === REALM_JOURNEY_ACTION.INSPECT) return;
    if (event.action === REALM_JOURNEY_ACTION.ENTER) {
      if (this._activeVisitId) throw new Error('journey-visit-already-active');
      if (!sameLocation(event.returnTarget, this._location)) throw new Error('journey-return-target-not-current');
      if (sameLocation(event.location, event.returnTarget)) throw new Error('journey-entry-target-is-origin');
      if (this._visits.has(event.visitId)) throw new Error('journey-visit-replay');
      return;
    }
    const visit = this._visits.get(event.visitId);
    if (!visit || this._activeVisitId !== event.visitId) throw new Error('journey-visit-unknown-or-inactive');
    if (!sameLocation(event.returnTarget, visit.returnTarget)) throw new Error('journey-return-target-changed');
    if (event.action === REALM_JOURNEY_ACTION.LEAVE) {
      if (visit.status !== 'entered' || !sameLocation(event.location, visit.location)
        || !sameLocation(this._location, visit.location)) throw new Error('journey-leave-state-invalid');
      return;
    }
    if (event.action === REALM_JOURNEY_ACTION.RETURN) {
      if (visit.status !== 'left' || this._location !== null || !sameLocation(event.location, visit.returnTarget)) {
        throw new Error('journey-return-state-invalid');
      }
    }
  }

  _applyTransition(event) {
    if (event.action === REALM_JOURNEY_ACTION.ENTER) {
      this._visits.set(event.visitId, deepFreeze({
        visitId: event.visitId,
        location: event.location,
        returnTarget: event.returnTarget,
        enteredEventId: event.eventId ?? null,
        leftEventId: null,
        returnedEventId: null,
        status: 'entered',
      }));
      this._activeVisitId = event.visitId;
      this._location = event.location;
    } else if (event.action === REALM_JOURNEY_ACTION.LEAVE) {
      const visit = this._visits.get(event.visitId);
      this._visits.set(event.visitId, deepFreeze({ ...visit, leftEventId: event.eventId ?? null, status: 'left' }));
      this._location = null;
    } else if (event.action === REALM_JOURNEY_ACTION.RETURN) {
      const visit = this._visits.get(event.visitId);
      this._visits.set(event.visitId, deepFreeze({ ...visit, returnedEventId: event.eventId ?? null, status: 'returned' }));
      this._location = event.location;
      this._activeVisitId = null;
    }
  }

  _emit(type, detail) {
    if (!this._diagnostic) return;
    try { this._diagnostic(Object.freeze({ type, at: this._now(), journalId: this.journalId, ...detail })); }
    catch (_) { /* Diagnostics cannot alter journal state. */ }
  }
}

export async function verifyJourneyJournal(events, options = {}) {
  if (!Array.isArray(events) || events.length === 0) {
    return Object.freeze({ valid: false, reason: 'journey-events-required' });
  }
  try {
    const journal = new RealmJourneyJournal({
      journalId: options.journalId ?? events[0].journalId,
      actorId: options.actorId ?? events[0].actorId,
      initialLocation: options.initialLocation,
      authorizeEvent: options.authorizeEvent,
      now: options.now,
    });
    for (const event of events) {
      const result = await journal.accept(event);
      if (!result.accepted) return Object.freeze({ valid: false, reason: result.reason, sequence: event.sequence });
    }
    return Object.freeze({ valid: true, snapshot: journal.snapshot() });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'journey-journal-invalid' });
  }
}

export const RealmJourneyJournalV1 = Object.freeze({
  format: REALM_JOURNEY_EVENT_V1_FORMAT,
  schemaVersion: 1,
  actions: REALM_JOURNEY_ACTION,
  createEvent: createJourneyEvent,
  verifyEvent: verifyJourneyEvent,
  verifyJournal: verifyJourneyJournal,
});
