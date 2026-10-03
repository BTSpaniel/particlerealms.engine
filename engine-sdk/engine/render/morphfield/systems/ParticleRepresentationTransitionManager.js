// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { PARTICLE_REPRESENTATION_KINDS } from './ParticleStateLayout.js';
import {
  deepFreezeParticleContract,
  particleEnum,
  particleIdentifier,
  particleInteger,
  particleRecord,
  particleRevision,
} from './ParticleRepresentationContracts.js';

export const PARTICLE_REPRESENTATION_TRANSITION_SCHEMA = 'engine.morphfield.particle-representation-transition';
export const PARTICLE_REPRESENTATION_TRANSITION_VERSION = '1.0.0';

function normalizeRepresentation(input, path, { canonical = false } = {}) {
  const source = particleRecord(input, path);
  const representation = particleEnum(
    source.representation ?? (canonical ? 'raw' : null),
    PARTICLE_REPRESENTATION_KINDS,
    `${path}.representation`,
  );
  return {
    id: particleIdentifier(source.id, `${path}.id`),
    sourceRevision: particleRevision(source.sourceRevision, `${path}.sourceRevision`),
    representationRevision: particleRevision(
      source.representationRevision ?? 0,
      `${path}.representationRevision`,
    ),
    representation,
    payload: source.payload,
    canonical,
  };
}

function publicRepresentation(value) {
  if (!value) return null;
  return deepFreezeParticleContract({
    id: value.id,
    sourceRevision: value.sourceRevision,
    representationRevision: value.representationRevision,
    representation: value.representation,
    canonical: value.canonical === true,
  });
}

function publicPending(value) {
  if (!value) return null;
  return deepFreezeParticleContract({
    id: value.id,
    phase: value.phase,
    candidate: publicRepresentation(value.candidate),
    sourceRevision: value.sourceRevision,
    requestedAtFrame: value.requestedAtFrame,
    reasonCode: value.reasonCode,
  });
}

function isOwnedParticlePayload(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function particlePayloadsAlias(left, right) {
  return isOwnedParticlePayload(left) && left === right;
}

function emit(logger, event, detail) {
  try {
    if (typeof logger === 'function') logger(event, detail);
    else if (typeof logger?.debug === 'function') {
      logger.debug(`[ParticleRepresentationTransition] ${event}`, detail);
    }
  } catch {
    // Diagnostics must never change representation ownership or settlement.
  }
}

/**
 * Dependency-free validation-before-promotion transaction manager. It never
 * mutates canonical state. Async validation only marks a candidate ready;
 * promotion occurs synchronously when settleAtFrameBoundary() is called.
 */
export class ParticleRepresentationTransitionManager {
  constructor({
    id = 'particle-representation-transition-manager',
    canonical,
    validate,
    promote = null,
    dispose = null,
    logger = null,
  } = {}) {
    this.id = particleIdentifier(id, 'options.id');
    this._canonical = normalizeRepresentation(canonical, 'options.canonical', { canonical: true });
    this._active = this._canonical;
    if (typeof validate !== 'function') throw new TypeError('options.validate must be a function');
    if (promote != null && typeof promote !== 'function') {
      throw new TypeError('options.promote must be a function');
    }
    if (dispose != null && typeof dispose !== 'function') {
      throw new TypeError('options.dispose must be a function');
    }
    this._validate = validate;
    this._promote = promote;
    this._dispose = dispose;
    this._logger = logger;
    this._pending = null;
    this._serial = 0;
    this._lastFrameIndex = -1;
    this._destroyed = false;
    this._metrics = {
      requested: 0,
      validated: 0,
      promoted: 0,
      rejected: 0,
      cancelled: 0,
      stale: 0,
      commitFailures: 0,
      restoredCanonical: 0,
      disposed: 0,
    };
  }

  _disposeRepresentation(value, reasonCode) {
    if (!value || value.canonical || typeof this._dispose !== 'function') return;
    this._metrics.disposed += 1;
    try {
      const result = this._dispose(value.payload, {
        representation: publicRepresentation(value),
        reasonCode,
      });
      if (result && typeof result.then === 'function') {
        result.catch(error => emit(this._logger, 'dispose-failed', {
          representationId: value.id,
          reasonCode,
          error: error?.message ?? String(error),
        }));
      }
    } catch (error) {
      emit(this._logger, 'dispose-failed', {
        representationId: value.id,
        reasonCode,
        error: error?.message ?? String(error),
      });
    }
  }

  _cancelPending(reasonCode) {
    const pending = this._pending;
    if (!pending) return null;
    this._pending = null;
    pending.phase = 'cancelled';
    pending.reasonCode = reasonCode;
    pending.controller.abort(reasonCode);
    this._metrics.cancelled += 1;
    this._disposeRepresentation(pending.candidate, reasonCode);
    emit(this._logger, 'candidate-cancelled', {
      transitionId: pending.id,
      candidateId: pending.candidate.id,
      reasonCode,
    });
    return publicPending(pending);
  }

  begin(candidateInput, {
    frameIndex = Math.max(0, this._lastFrameIndex),
    context = null,
    validate = null,
  } = {}) {
    if (this._destroyed) throw new Error('Particle representation transition manager is destroyed');
    const frame = particleInteger(frameIndex, 'options.frameIndex');
    const candidate = normalizeRepresentation(candidateInput, 'candidate');
    if (candidate.sourceRevision !== this._canonical.sourceRevision) {
      throw new Error('Candidate source revision is not the current canonical revision');
    }
    if (candidate.canonical) throw new Error('A transition candidate cannot claim canonical authority');
    if (particlePayloadsAlias(candidate.payload, this._canonical.payload)
        || particlePayloadsAlias(candidate.payload, this._active.payload)
        || particlePayloadsAlias(candidate.payload, this._pending?.candidate?.payload)) {
      throw new Error('Transition candidate payload must have independent ownership');
    }
    const validator = validate ?? this._validate;
    if (typeof validator !== 'function') throw new TypeError('validate must be a function');
    this._cancelPending('superseded');
    const id = `${this.id}.transition.${++this._serial}`;
    const controller = new AbortController();
    const pending = {
      id,
      phase: 'validating',
      reasonCode: null,
      sourceRevision: candidate.sourceRevision,
      requestedAtFrame: frame,
      candidate,
      controller,
      validationEvidence: null,
      validationPromise: null,
    };
    this._pending = pending;
    this._metrics.requested += 1;
    emit(this._logger, 'candidate-requested', {
      transitionId: id,
      candidateId: candidate.id,
      sourceRevision: candidate.sourceRevision,
      representation: candidate.representation,
    });
    pending.validationPromise = Promise.resolve().then(() => {
      if (controller.signal.aborted || this._pending !== pending) return null;
      return validator({
        transitionId: id,
        canonical: publicRepresentation(this._canonical),
        active: publicRepresentation(this._active),
        candidate: publicRepresentation(candidate),
        payload: candidate.payload,
        context,
        signal: controller.signal,
      });
    }).then(result => {
      if (this._pending !== pending || controller.signal.aborted) return publicPending(pending);
      if (!result || typeof result !== 'object' || result.accepted !== true) {
        pending.phase = 'rejected';
        pending.reasonCode = result?.reasonCodes?.[0] ?? result?.reasonCode ?? 'validation-rejected';
        pending.validationEvidence = result ?? null;
        this._metrics.rejected += 1;
      } else if (result.sourceRevision != null
          && result.sourceRevision !== pending.sourceRevision) {
        pending.phase = 'rejected';
        pending.reasonCode = 'validation-source-revision-mismatch';
        pending.validationEvidence = result;
        this._metrics.rejected += 1;
        this._metrics.stale += 1;
      } else {
        pending.phase = 'ready';
        pending.validationEvidence = result;
        this._metrics.validated += 1;
      }
      emit(this._logger, 'validation-complete', {
        transitionId: id,
        candidateId: candidate.id,
        phase: pending.phase,
        reasonCode: pending.reasonCode,
      });
      return publicPending(pending);
    }).catch(error => {
      if (this._pending !== pending || controller.signal.aborted) return publicPending(pending);
      pending.phase = 'rejected';
      pending.reasonCode = 'validation-error';
      pending.validationEvidence = {
        accepted: false,
        error: error?.message ?? String(error),
      };
      this._metrics.rejected += 1;
      emit(this._logger, 'validation-error', {
        transitionId: id,
        candidateId: candidate.id,
        error: error?.message ?? String(error),
      });
      return publicPending(pending);
    });
    return Object.freeze({
      id,
      candidate: publicRepresentation(candidate),
      validation: pending.validationPromise,
    });
  }

  waitForValidation(transitionId = null) {
    const pending = this._pending;
    if (!pending || (transitionId != null && pending.id !== transitionId)) {
      return Promise.resolve(null);
    }
    return pending.validationPromise;
  }

  settleAtFrameBoundary({ frameIndex } = {}) {
    if (this._destroyed) throw new Error('Particle representation transition manager is destroyed');
    const frame = particleInteger(frameIndex, 'options.frameIndex');
    if (frame < this._lastFrameIndex) throw new RangeError('frameIndex cannot move backwards');
    this._lastFrameIndex = frame;
    const pending = this._pending;
    if (!pending) return this.snapshot('idle');
    if (pending.phase === 'validating') return this.snapshot('validation-pending');
    this._pending = null;
    if (pending.phase !== 'ready') {
      this._disposeRepresentation(pending.candidate, pending.reasonCode ?? 'validation-rejected');
      return this.snapshot(pending.reasonCode ?? 'validation-rejected');
    }
    if (pending.sourceRevision !== this._canonical.sourceRevision) {
      this._metrics.stale += 1;
      this._disposeRepresentation(pending.candidate, 'canonical-revision-changed');
      return this.snapshot('canonical-revision-changed');
    }
    const previous = this._active;
    try {
      const promotion = this._promote?.({
        transitionId: pending.id,
        canonical: publicRepresentation(this._canonical),
        previous: publicRepresentation(previous),
        candidate: publicRepresentation(pending.candidate),
        payload: pending.candidate.payload,
        validationEvidence: pending.validationEvidence,
        frameIndex: frame,
      });
      if (promotion && typeof promotion.then === 'function') {
        throw new Error('Promotion must be synchronous at a frame boundary');
      }
      this._active = pending.candidate;
      this._metrics.promoted += 1;
      if (!previous.canonical) {
        this._disposeRepresentation(previous, 'replaced-after-promotion');
      }
      emit(this._logger, 'candidate-promoted', {
        transitionId: pending.id,
        candidateId: pending.candidate.id,
        frameIndex: frame,
      });
      return this.snapshot('promoted');
    } catch (error) {
      this._metrics.commitFailures += 1;
      this._disposeRepresentation(pending.candidate, 'promotion-failed');
      emit(this._logger, 'promotion-failed', {
        transitionId: pending.id,
        candidateId: pending.candidate.id,
        error: error?.message ?? String(error),
      });
      return this.snapshot('promotion-failed', error?.message ?? String(error));
    }
  }

  updateCanonical(canonicalInput) {
    if (this._destroyed) throw new Error('Particle representation transition manager is destroyed');
    const next = normalizeRepresentation(canonicalInput, 'canonical', { canonical: true });
    if ((!this._active.canonical && particlePayloadsAlias(next.payload, this._active.payload))
        || particlePayloadsAlias(next.payload, this._pending?.candidate?.payload)) {
      throw new Error('Canonical payload must not alias a disposable representation payload');
    }
    const revisionChanged = next.sourceRevision !== this._canonical.sourceRevision;
    this._canonical = next;
    if (revisionChanged) {
      this._cancelPending('canonical-revision-changed');
      if (!this._active.canonical) this._disposeRepresentation(this._active, 'canonical-revision-changed');
      this._active = next;
      emit(this._logger, 'canonical-revision-changed', {
        sourceRevision: next.sourceRevision,
      });
    } else if (this._active.canonical) {
      this._active = next;
    }
    return this.snapshot(revisionChanged ? 'canonical-revision-changed' : 'canonical-refreshed');
  }

  cancel(reasonCode = 'cancelled') {
    particleIdentifier(reasonCode, 'reasonCode');
    this._cancelPending(reasonCode);
    return this.snapshot(reasonCode);
  }

  restoreCanonical(reasonCode = 'canonical-restored') {
    if (this._destroyed) throw new Error('Particle representation transition manager is destroyed');
    const reason = particleIdentifier(reasonCode, 'reasonCode');
    this._cancelPending(reason);
    const previous = this._active;
    this._active = this._canonical;
    if (!previous.canonical) {
      this._disposeRepresentation(previous, reason);
      this._metrics.restoredCanonical += 1;
      emit(this._logger, 'canonical-restored', {
        previousRepresentationId: previous.id,
        sourceRevision: this._canonical.sourceRevision,
        reasonCode: reason,
      });
    }
    return this.snapshot(reason);
  }

  snapshot(status = 'current', detail = null) {
    return deepFreezeParticleContract({
      schema: PARTICLE_REPRESENTATION_TRANSITION_SCHEMA,
      schemaVersion: PARTICLE_REPRESENTATION_TRANSITION_VERSION,
      id: this.id,
      status,
      detail,
      canonical: publicRepresentation(this._canonical),
      active: publicRepresentation(this._active),
      pending: publicPending(this._pending),
      frameIndex: this._lastFrameIndex,
      metrics: { ...this._metrics },
      invariants: {
        canonicalAuthorityPreserved: true,
        activeSourceMatchesCanonical: this._active.sourceRevision === this._canonical.sourceRevision,
        asyncValidationCannotPromote: true,
        promotionRequiresFrameBoundary: true,
      },
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._cancelPending('manager-destroyed');
    if (!this._active.canonical) this._disposeRepresentation(this._active, 'manager-destroyed');
    this._active = this._canonical;
    this._destroyed = true;
    emit(this._logger, 'destroyed', { managerId: this.id });
  }
}

export function createParticleRepresentationTransitionManager(options) {
  return new ParticleRepresentationTransitionManager(options);
}

export default ParticleRepresentationTransitionManager;
