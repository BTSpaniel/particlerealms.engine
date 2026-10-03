// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const MORPHFIELD_JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const SCHEMA_ROOT = 'https://particlerealms.online/schemas/morphfield/v2';

export const MORPHFIELD_SCHEMA_IDS = Object.freeze({
  common: `${SCHEMA_ROOT}/common.schema.json`,
  source: `${SCHEMA_ROOT}/source.schema.json`,
  nexel: `${SCHEMA_ROOT}/nexel.schema.json`,
  scene: `${SCHEMA_ROOT}/scene.schema.json`,
  patch: `${SCHEMA_ROOT}/patch.schema.json`,
  capabilityProfile: `${SCHEMA_ROOT}/nexel-capabilities.schema.json`,
  capabilityReport: `${SCHEMA_ROOT}/nexel-capability-report.schema.json`,
  particleChainSimulation: `${SCHEMA_ROOT}/particle-chain-simulation.schema.json`,
  benchmarkReceipt: `${SCHEMA_ROOT}/benchmark-receipt.schema.json`,
  validationReport: `${SCHEMA_ROOT}/validation-report.schema.json`,
  provenance: `${SCHEMA_ROOT}/provenance.schema.json`,
  bundle: `${SCHEMA_ROOT}/bundle.schema.json`,
});

export const MORPHFIELD_SCHEMA_FILES = Object.freeze({
  common: 'common.schema.json',
  source: 'source.schema.json',
  nexel: 'nexel.schema.json',
  scene: 'scene.schema.json',
  patch: 'patch.schema.json',
  capabilityProfile: 'nexel-capabilities.schema.json',
  capabilityReport: 'nexel-capability-report.schema.json',
  particleChainSimulation: 'particle-chain-simulation.schema.json',
  benchmarkReceipt: 'benchmark-receipt.schema.json',
  validationReport: 'validation-report.schema.json',
  provenance: 'provenance.schema.json',
  bundle: 'bundle.schema.json',
});
