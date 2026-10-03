// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  deepFreezeParticleContract,
  particleIdentifier,
  particleInteger,
} from './ParticleRepresentationContracts.js';
import {
  createParticleRepresentationTransitionManager,
} from './ParticleRepresentationTransitionManager.js';
import {
  missingParticleVisualLiveContextFields,
  validateParticleVisualContinuityCertificate,
} from './ParticleVisualContinuityCertificate.js';

export const PARTICLE_PRESENTATION_COMPOSITION_SCHEMA =
  'engine.morphfield.particle-presentation-composition';
export const PARTICLE_PRESENTATION_COMPOSITION_VERSION = '1.0.0';

function revisionKey(value) {
  return `${typeof value}:${String(value)}`;
}

function emit(logger, event, detail) {
  try {
    if (typeof logger === 'function') logger(event, detail);
    else if (typeof logger?.debug === 'function') {
      logger.debug(`[ParticlePresentationTransitionCompositor] ${event}`, detail);
    }
  } catch {
    // Diagnostics must never split compositor and transition-manager state.
  }
}

function transitionWeight(progress) {
  const bounded = Math.max(0, Math.min(1, progress));
  return 0.5 - 0.5 * Math.cos(Math.PI * bounded);
}

/**
 * Presentation-only layer over ParticleRepresentationTransitionManager.
 * The manager remains the sole owner of asynchronous validation, cancellation,
 * frame-boundary promotion, and payload disposal. This class only converts a
 * promoted, pixel-certified representation into conserved render weights and
 * can hide it immediately without transferring simulation authority.
 */
export class ParticlePresentationTransitionCompositor {
  constructor({
    id = 'particle-presentation-transition-compositor',
    canonical,
    transitionFrames = 8,
    validateCandidate = null,
    promote = null,
    dispose = null,
    logger = null,
  } = {}) {
    this.id = particleIdentifier(id, 'options.id');
    this.transitionFrames = particleInteger(
      transitionFrames,
      'options.transitionFrames',
      { minimum: 0, maximum: 10_000 },
    );
    if (validateCandidate != null && typeof validateCandidate !== 'function') {
      throw new TypeError('options.validateCandidate must be a function');
    }
    if (promote != null && typeof promote !== 'function') {
      throw new TypeError('options.promote must be a function');
    }
    this._validateCandidate = validateCandidate;
    this._promote = promote;
    this._logger = logger;
    this._activeCertificate = null;
    this._activeCandidateId = null;
    this._pendingCertificate = null;
    this._transition = null;
    this._forcedCanonicalReason = 'candidate-not-promoted';
    this._lastCompositionFrame = -1;
    this._destroyed = false;
    this._manager = createParticleRepresentationTransitionManager({
      id: `${this.id}.lifecycle`,
      canonical,
      validate: request => this._validate(request),
      promote: receipt => this._commitPresentation(receipt),
      dispose,
      logger,
    });
  }

  async _validate(request) {
    const visualCertificate = request.context?.visualCertificate
      ?? request.payload?.visualCertificate
      ?? null;
    const validationContext = request.context?.validationContext ?? {};
    const missingContext = missingParticleVisualLiveContextFields(validationContext);
    if (missingContext.length > 0) {
      return {
        accepted: false,
        reasonCodes: ['live-visual-context-incomplete'],
        missingContext,
        sourceRevision: request.candidate.sourceRevision,
      };
    }
    const visualValidation = validateParticleVisualContinuityCertificate(
      visualCertificate,
      validationContext,
    );
    if (!visualValidation.valid) {
      return {
        accepted: false,
        reasonCodes: visualValidation.reasonCodes,
        sourceRevision: request.candidate.sourceRevision,
        visualValidation,
      };
    }
    if (revisionKey(request.candidate.sourceRevision)
        !== revisionKey(visualCertificate.sourceStamp.topologyRevision)) {
      return {
        accepted: false,
        reasonCodes: ['representation-topology-revision-mismatch'],
        sourceRevision: request.candidate.sourceRevision,
        visualValidation,
      };
    }
    if (revisionKey(request.canonical.representationRevision)
          !== revisionKey(visualCertificate.binding.referenceRepresentationRevision)
        || revisionKey(request.candidate.representationRevision)
          !== revisionKey(visualCertificate.binding.candidateRepresentationRevision)) {
      return {
        accepted: false,
        reasonCodes: ['representation-revision-mismatch'],
        sourceRevision: request.candidate.sourceRevision,
        visualValidation,
      };
    }
    let supplemental = null;
    if (this._validateCandidate) {
      supplemental = await this._validateCandidate({
        ...request,
        visualCertificate,
        visualValidation,
      });
      if (!supplemental || supplemental.accepted !== true) {
        return {
          accepted: false,
          reasonCodes: supplemental?.reasonCodes
            ?? [supplemental?.reasonCode ?? 'supplemental-validation-rejected'],
          sourceRevision: request.candidate.sourceRevision,
          visualValidation,
          supplemental,
        };
      }
    }
    return {
      accepted: true,
      sourceRevision: request.candidate.sourceRevision,
      visualCertificate,
      visualValidation,
      supplemental,
    };
  }

  _commitPresentation(receipt) {
    const visualCertificate = receipt.validationEvidence?.visualCertificate;
    if (!visualCertificate) throw new Error('Promotion is missing visual continuity evidence');
    const externalResult = this._promote?.({ ...receipt, visualCertificate });
    if (externalResult && typeof externalResult.then === 'function') {
      throw new Error('Presentation promotion callback must be synchronous');
    }
    this._activeCertificate = visualCertificate;
    this._activeCandidateId = receipt.candidate.id;
    this._pendingCertificate = null;
    this._transition = {
      candidateId: receipt.candidate.id,
      startedAtFrame: receipt.frameIndex,
      completesAtFrame: receipt.frameIndex + this.transitionFrames,
    };
    this._forcedCanonicalReason = null;
    emit(this._logger, 'presentation-transition-started', {
      candidateId: receipt.candidate.id,
      frameIndex: receipt.frameIndex,
      transitionFrames: this.transitionFrames,
    });
    return externalResult;
  }

  beginCandidate(candidate, {
    frameIndex = 0,
    visualCertificate = null,
    validationContext = {},
    context = null,
  } = {}) {
    if (this._destroyed) throw new Error('Particle presentation compositor is destroyed');
    const frame = particleInteger(frameIndex, 'options.frameIndex');
    if (frame < this._lastCompositionFrame) {
      throw new RangeError('frameIndex cannot move backwards');
    }
    const transition = this._manager.begin(candidate, {
      frameIndex: frame,
      context: {
        ...(context && typeof context === 'object' ? context : {}),
        visualCertificate,
        validationContext,
      },
    });
    this._pendingCertificate = {
      transitionId: transition.id,
      visualCertificate,
    };
    return transition;
  }

  waitForValidation(transitionId = null) {
    return this._manager.waitForValidation(transitionId);
  }

  settleAtFrameBoundary({ frameIndex, validationContext = {} } = {}) {
    if (this._destroyed) throw new Error('Particle presentation compositor is destroyed');
    const frame = particleInteger(frameIndex, 'options.frameIndex');
    if (frame < this._lastCompositionFrame) {
      throw new RangeError('frameIndex cannot move backwards');
    }
    const pending = this._manager.snapshot().pending;
    if (pending && this._pendingCertificate?.transitionId === pending.id) {
      const missingContext = missingParticleVisualLiveContextFields(validationContext);
      const validation = missingContext.length > 0
        ? { valid: false, reasonCodes: ['live-visual-context-incomplete'] }
        : validateParticleVisualContinuityCertificate(
          this._pendingCertificate.visualCertificate,
          validationContext,
        );
      if (!validation.valid) {
        const reasonCode = validation.reasonCodes[0] ?? 'visual-certificate-invalid';
        this._manager.cancel(reasonCode);
        if (!this._activeCertificate) this._forcedCanonicalReason = reasonCode;
        this._pendingCertificate = null;
      }
    }
    const lifecycle = this._manager.settleAtFrameBoundary({ frameIndex: frame });
    if (!lifecycle.pending) this._pendingCertificate = null;
    return deepFreezeParticleContract({
      lifecycle,
      composition: this.compositionAtFrame({ frameIndex: frame, validationContext }),
    });
  }

  compositionAtFrame({ frameIndex, validationContext = {} } = {}) {
    if (this._destroyed) throw new Error('Particle presentation compositor is destroyed');
    const frame = particleInteger(frameIndex, 'options.frameIndex');
    if (frame < this._lastCompositionFrame) {
      throw new RangeError('frameIndex cannot move backwards');
    }
    this._lastCompositionFrame = frame;
    if (!this._forcedCanonicalReason && this._activeCertificate) {
      const missingContext = missingParticleVisualLiveContextFields(validationContext);
      if (missingContext.length > 0) {
        this.fallbackToCanonical('live-visual-context-incomplete');
      } else {
        const validation = validateParticleVisualContinuityCertificate(
          this._activeCertificate,
          validationContext,
        );
        if (!validation.valid) {
          this.fallbackToCanonical(validation.reasonCodes[0] ?? 'visual-certificate-invalid');
        }
      }
    }
    const lifecycle = this._manager.snapshot();
    const canonical = lifecycle.canonical;
    const forcedCanonical = this._forcedCanonicalReason != null
      || !this._activeCertificate
      || !this._activeCandidateId;
    let candidateWeight = 0;
    if (!forcedCanonical) {
      const progress = !this._transition || this.transitionFrames === 0
        ? 1
        : (frame - this._transition.startedAtFrame) / this.transitionFrames;
      candidateWeight = transitionWeight(progress);
      if (candidateWeight >= 1) this._transition = null;
    }
    const canonicalWeight = 1 - candidateWeight;
    const transitionActive = !forcedCanonical && candidateWeight > 0 && candidateWeight < 1;
    return deepFreezeParticleContract({
      schema: PARTICLE_PRESENTATION_COMPOSITION_SCHEMA,
      schemaVersion: PARTICLE_PRESENTATION_COMPOSITION_VERSION,
      id: this.id,
      frameIndex: frame,
      status: forcedCanonical
        ? 'canonical-fallback'
        : transitionActive ? 'transitioning' : 'candidate-visible',
      reasonCode: this._forcedCanonicalReason,
      blendMode: 'conserved-linear-energy',
      canonical: {
        representationId: canonical.id,
        weight: canonicalWeight,
        resident: true,
        simulationAuthority: true,
      },
      candidate: {
        representationId: forcedCanonical ? null : this._activeCandidateId,
        weight: candidateWeight,
        simulationAuthority: false,
        certificateId: forcedCanonical ? null : this._activeCertificate.id,
      },
      ownership: {
        totalPresentationWeight: canonicalWeight + candidateWeight,
        canonicalSimulationAuthorityPreserved: true,
        candidateWritesSimulationState: false,
        exclusiveCanonicalFallback: forcedCanonical,
        lifecycleDelegatedToTransitionManager: true,
      },
    });
  }

  fallbackToCanonical(reasonCode = 'visual-certificate-invalid') {
    if (this._destroyed) throw new Error('Particle presentation compositor is destroyed');
    const reason = particleIdentifier(reasonCode, 'reasonCode');
    const previousCandidateId = this._activeCandidateId;
    this._manager.restoreCanonical(reason);
    this._forcedCanonicalReason = reason;
    this._activeCertificate = null;
    this._activeCandidateId = null;
    this._pendingCertificate = null;
    this._transition = null;
    emit(this._logger, 'canonical-fallback', {
      reasonCode: reason,
      candidateId: previousCandidateId,
    });
    return this.snapshot();
  }

  updateCanonical(canonical) {
    if (this._destroyed) throw new Error('Particle presentation compositor is destroyed');
    const lifecycle = this._manager.updateCanonical(canonical);
    if (lifecycle.status === 'canonical-revision-changed') {
      this._activeCertificate = null;
      this._activeCandidateId = null;
      this._pendingCertificate = null;
      this._transition = null;
      this._forcedCanonicalReason = 'canonical-revision-changed';
    }
    return this.snapshot();
  }

  cancelCandidate(reasonCode = 'cancelled') {
    this._manager.cancel(reasonCode);
    this._pendingCertificate = null;
    return this.snapshot();
  }

  snapshot() {
    return deepFreezeParticleContract({
      id: this.id,
      lifecycle: this._manager.snapshot(),
      activeCandidateId: this._activeCandidateId,
      activeCertificateId: this._activeCertificate?.id ?? null,
      forcedCanonicalReason: this._forcedCanonicalReason,
      transition: this._transition ? { ...this._transition } : null,
      frameIndex: this._lastCompositionFrame,
      invariants: {
        canonicalRemainsResident: true,
        candidateNeverOwnsSimulation: true,
        invalidEvidenceFailsClosed: true,
        lifecycleDelegatedToTransitionManager: true,
      },
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._manager.destroy();
    this._activeCertificate = null;
    this._activeCandidateId = null;
    this._pendingCertificate = null;
    this._transition = null;
    this._forcedCanonicalReason = 'compositor-destroyed';
    this._destroyed = true;
    emit(this._logger, 'destroyed', { compositorId: this.id });
  }
}

export function createParticlePresentationTransitionCompositor(options) {
  return new ParticlePresentationTransitionCompositor(options);
}

export default ParticlePresentationTransitionCompositor;
