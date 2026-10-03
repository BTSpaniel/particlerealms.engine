// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { hashIdSecure } from '../state/util/canonical.js';
import {
  cloneAndFreezeStrictJson,
} from '../core/schema/StrictJsonValue.js';
import {
  createMatterInteraction,
  validateMatterDefinition,
  validateMatterState,
} from './contracts/MatterContracts.js';
import { EngineMatterCatalog } from './catalog/EngineMatterCatalog.js';
import { MatterBackendAdapterRegistry } from './adapters/MatterBackendAdapterRegistry.js';
import {
  createDefaultMatterModelRegistry,
  MatterModelRegistry,
} from './models/MatterModelRegistry.js';
import { applyMatterModelResult } from './models/MatterModelApplication.js';
import { buildMatterDependencyGraph } from './coupling/MatterDependencyGraph.js';
import { MatterStateStore } from './state/MatterStateStore.js';
import {
  assertMatterConservation,
  createMatterConservationLedger,
} from './state/MatterConservationLedger.js';

export const MATTER_PREVIEW_SCHEMA = 'engine.matter-preview';
export const MATTER_PREVIEW_VERSION = '1.0.0';

const INTERACTION_MODEL = Object.freeze({
  'external-impulse': 'engine.matter.model.external-impulse',
  'external-energy': 'engine.matter.model.thermal-capacity',
});
function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function loggerCall(logger, level, event, details) {
  const method = logger?.[level];
  if (typeof method === 'function') method.call(logger, `[MatterKernel] ${event}`, details);
}

function requireCatalog(value) {
  if (!value || typeof value.add !== 'function' || typeof value.get !== 'function') {
    throw new TypeError('MatterKernel requires a Matter catalog');
  }
  return value;
}

function requireStore(value) {
  if (!value || typeof value.get !== 'function' || typeof value.commit !== 'function') {
    throw new TypeError('MatterKernel requires a Matter state store');
  }
  return value;
}

function requireRegistry(value) {
  if (!(value instanceof MatterModelRegistry)) {
    throw new TypeError('MatterKernel requires a MatterModelRegistry');
  }
  return value;
}

function requireBackendRegistry(value) {
  if (!(value instanceof MatterBackendAdapterRegistry)) {
    throw new TypeError('MatterKernel requires a MatterBackendAdapterRegistry');
  }
  return value;
}

/**
 * Engine-level orchestrator. Definitions, model code, mutable state, durable
 * documents, and solver backends remain separate authorities.
 */
export class MatterKernel {
  #catalog;
  #store;
  #models;
  #backends;
  #logger;
  #issuedPreviews = new WeakSet();

  constructor({
    catalog = new EngineMatterCatalog(),
    store = new MatterStateStore(),
    models = createDefaultMatterModelRegistry(),
    backends = new MatterBackendAdapterRegistry(),
    logger = null,
  } = {}) {
    this.#catalog = requireCatalog(catalog);
    this.#store = requireStore(store);
    this.#models = requireRegistry(models);
    this.#backends = requireBackendRegistry(backends);
    this.#logger = logger;
  }

  get catalog() { return this.#catalog; }
  get states() { return this.#store; }
  get models() { return this.#models; }
  get backends() { return this.#backends; }

  dependencyGraph() {
    return buildMatterDependencyGraph(this.#models);
  }

  couplingPlan(changedPaths) {
    return this.dependencyGraph().plan(changedPaths);
  }

  async registerDefinition(definition, definitionHash) {
    const safeDefinition = cloneAndFreezeStrictJson(definition, '$.definition');
    validateMatterDefinition(safeDefinition, '$.definition');
    await this.#catalog.add({ definition: safeDefinition, definitionHash });
    loggerCall(this.#logger, 'info', 'definition-registered', {
      definitionId: safeDefinition.id,
      definitionHash,
    });
    return this;
  }

  registerState(state) {
    validateMatterState(state, '$.state');
    const entry = this.#catalog.get(state.definitionId);
    if (!entry) throw new TypeError(`Matter definition '${state.definitionId}' is not registered`);
    if (entry.definitionHash !== state.definitionHash) {
      throw new TypeError(`Matter state '${state.regionId}' definition hash does not match the catalog`);
    }
    this.#store.commit({
      transactionId: state.regionId,
      expectedRevisions: {},
      put: [state],
      remove: [],
    });
    loggerCall(this.#logger, 'info', 'state-registered', {
      regionId: state.regionId,
      definitionId: state.definitionId,
    });
    return this;
  }

  /** Evaluate one declared model against an immutable snapshot. */
  async previewInteraction({ interaction: interactionInput, modelId = null, modelVersion = 1 }) {
    const started = nowMilliseconds();
    let interaction;
    try {
      interaction = createMatterInteraction(interactionInput);
      if (interaction.targetRegionIds.length !== 1) {
        throw new TypeError('The synchronous Matter preview slice requires exactly one target region');
      }
      const resolvedModelId = modelId ?? INTERACTION_MODEL[interaction.kind] ?? null;
      if (resolvedModelId == null) throw new TypeError(`No Matter model was selected for '${interaction.kind}'`);
      const state = this.#store.get(interaction.targetRegionIds[0]);
      if (!state) throw new TypeError(`Matter region '${interaction.targetRegionIds[0]}' is unavailable`);
      const catalogEntry = this.#catalog.get(state.definitionId);
      if (!catalogEntry || catalogEntry.definitionHash !== state.definitionHash) {
        throw new TypeError(`Matter region '${state.regionId}' has an unavailable definition binding`);
      }
      const binding = catalogEntry.definition.modelBindings.find(candidate => (
        candidate.modelId === resolvedModelId && candidate.modelVersion === modelVersion
      ));
      if (!binding) {
        const missing = catalogEntry.definition.missingParameters.join(', ');
        const diagnostic = missing.length > 0
          ? `Definition '${state.definitionId}' does not bind ${resolvedModelId}@${modelVersion}; missing: ${missing}`
          : `Definition '${state.definitionId}' does not bind ${resolvedModelId}@${modelVersion}`;
        const ledger = createMatterConservationLedger({ beforeStates: [state], afterStates: [state] });
        const preview = cloneAndFreezeStrictJson({
          schema: MATTER_PREVIEW_SCHEMA,
          schemaVersion: MATTER_PREVIEW_VERSION,
          previewId: await hashIdSecure({ interaction, state, diagnostic }, {
            domain: 'engine.matter.preview.unsupported',
            schemaVersion: MATTER_PREVIEW_VERSION,
          }),
          status: 'unsupported',
          interaction,
          model: { modelId: resolvedModelId, modelVersion },
          beforeStates: [state],
          afterStates: [state],
          externalDelta: {},
          ledger,
          invalidatedPaths: [],
          diagnostics: [diagnostic],
        }, '$.matterPreview');
        this.#issuedPreviews.add(preview);
        return preview;
      }
      loggerCall(this.#logger, 'debug', 'preview-start', {
        eventId: interaction.eventId,
        regionId: state.regionId,
        modelId: resolvedModelId,
        modelVersion,
      });
      const modelResult = this.#models.evaluate(binding, {
        state,
        definition: catalogEntry.definition,
        interaction,
      });
      const nextState = applyMatterModelResult(state, modelResult);
      const ledger = createMatterConservationLedger({
        beforeStates: [state],
        afterStates: [nextState],
        externalDelta: modelResult.externalDelta,
      });
      assertMatterConservation(ledger);
      const previewCore = {
        schema: MATTER_PREVIEW_SCHEMA,
        schemaVersion: MATTER_PREVIEW_VERSION,
        status: modelResult.status,
        interaction,
        model: { modelId: resolvedModelId, modelVersion },
        beforeStates: [state],
        afterStates: [nextState],
        externalDelta: modelResult.externalDelta,
        ledger,
        invalidatedPaths: modelResult.invalidatedPaths,
        diagnostics: modelResult.diagnostics,
      };
      const previewId = await hashIdSecure(previewCore, {
        domain: 'engine.matter.preview',
        schemaVersion: MATTER_PREVIEW_VERSION,
      });
      const preview = cloneAndFreezeStrictJson({ ...previewCore, previewId }, '$.matterPreview');
      loggerCall(this.#logger, 'info', 'preview-complete', {
        previewId,
        status: preview.status,
        elapsedMilliseconds: nowMilliseconds() - started,
        balanced: ledger.balanced,
      });
      this.#issuedPreviews.add(preview);
      return preview;
    } catch (error) {
      loggerCall(this.#logger, 'error', 'preview-failed', {
        eventId: interaction?.eventId ?? null,
        elapsedMilliseconds: nowMilliseconds() - started,
        message: error?.message ?? String(error),
      });
      throw error;
    }
  }

  /** Commit an already verified preview with optimistic revision checks. */
  async commitPreview(preview, options = {}) {
    if (!this.#issuedPreviews.has(preview)) {
      throw new TypeError('Matter preview was not issued by this kernel or was already attempted');
    }
    this.#issuedPreviews.delete(preview);
    const safeOptions = cloneAndFreezeStrictJson(options, '$.commitOptions');
    if (!safeOptions || typeof safeOptions !== 'object' || Array.isArray(safeOptions)) {
      throw new TypeError('Matter preview commit options must be an object');
    }
    for (const key of Object.keys(safeOptions)) {
      if (key !== 'transactionId') throw new TypeError(`Matter preview commit option '${key}' is unsupported`);
    }
    const { transactionId } = safeOptions;
    const safePreview = cloneAndFreezeStrictJson(preview, '$.matterPreview');
    if (safePreview.schema !== MATTER_PREVIEW_SCHEMA || safePreview.schemaVersion !== MATTER_PREVIEW_VERSION) {
      throw new TypeError('Matter preview schema is unsupported');
    }
    if (safePreview.status !== 'applied') throw new TypeError('Only an applied Matter preview can be committed');
    const { previewId, ...previewCore } = safePreview;
    const expectedPreviewId = await hashIdSecure(previewCore, {
      domain: 'engine.matter.preview',
      schemaVersion: MATTER_PREVIEW_VERSION,
    });
    if (previewId !== expectedPreviewId) throw new TypeError('Matter preview content hash is invalid');
    const verifiedLedger = createMatterConservationLedger({
      beforeStates: safePreview.beforeStates,
      afterStates: safePreview.afterStates,
      externalDelta: safePreview.externalDelta,
      tolerance: safePreview.ledger.tolerance,
    });
    assertMatterConservation(verifiedLedger);
    const expectedRevisions = Object.fromEntries(safePreview.beforeStates.map(state => [state.regionId, state.revision]));
    const receipt = this.#store.commit({
      transactionId,
      expectedRevisions,
      put: safePreview.afterStates,
      remove: safePreview.beforeStates
        .map(state => state.regionId)
        .filter(regionId => !safePreview.afterStates.some(next => next.regionId === regionId)),
    });
    loggerCall(this.#logger, 'info', 'preview-committed', {
      previewId: safePreview.previewId,
      transactionId,
      regions: safePreview.afterStates.map(state => state.regionId),
    });
    return receipt;
  }
}
