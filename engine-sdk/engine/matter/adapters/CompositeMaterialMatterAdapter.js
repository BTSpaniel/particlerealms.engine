// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { validateEngineCompositeMaterialResource } from '../../assets/material/composite/CompositeMaterialContracts.js';
import { hashIdSecure } from '../../state/util/canonical.js';
import { cloneAndFreezeStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
  createMatterDefinition,
  MATTER_DEFINITION_SCHEMA,
  MATTER_DEFINITION_VERSION,
} from '../contracts/MatterContracts.js';

function parameterSources(resource, fieldPath) {
  return [...(resource.fieldSources?.[fieldPath] ?? [])];
}

function constituentInventory(resource) {
  const composition = resource.facets?.chemistry?.compositionMassFraction;
  if (composition == null) {
    // The exact composite material identity is tracked as one constituent.
    // This does not claim a molecular or elemental composition.
    return [{ speciesId: resource.id, massFraction: 1 }];
  }
  return Object.entries(composition)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([speciesId, massFraction]) => ({ speciesId, massFraction }));
}

/**
 * Bind an existing immutable composite resource into the Matter platform.
 * The composite catalog remains the definition evidence authority.
 */
export async function createMatterDefinitionFromCompositeMaterial(resource, {
  definitionId = `matter.definition.${resource?.id ?? 'unknown'}`,
} = {}) {
  validateEngineCompositeMaterialResource(resource, '$.compositeMaterial');
  const sourceHash = await hashIdSecure(resource, {
    domain: 'engine.matter.composite-material-source',
    schemaVersion: resource.schemaVersion,
  });
  const modelBindings = [{
    modelId: 'engine.matter.model.external-impulse',
    modelVersion: 1,
    parameters: {},
    parameterSources: {},
  }];
  const specificHeat = resource.facets?.thermal?.specificHeatJPerKgK;
  if (specificHeat != null) {
    modelBindings.push({
      modelId: 'engine.matter.model.thermal-capacity',
      modelVersion: 1,
      parameters: { specificHeatJPerKgK: specificHeat },
      parameterSources: {
        specificHeatJPerKgK: parameterSources(resource, 'thermal.specificHeatJPerKgK'),
      },
    });
  }
  const missingParameters = new Set(resource.missingFields ?? []);
  if (specificHeat == null) missingParameters.add('thermal.specificHeatJPerKgK');
  const definition = createMatterDefinition({
    schema: MATTER_DEFINITION_SCHEMA,
    schemaVersion: MATTER_DEFINITION_VERSION,
    id: definitionId,
    label: resource.name,
    source: {
      resourceId: resource.id,
      resourceHash: sourceHash,
      resourceSchema: resource.schema,
      resourceSchemaVersion: resource.schemaVersion,
    },
    constituents: constituentInventory(resource),
    modelBindings,
    missingParameters: [...missingParameters].sort(),
  });
  const definitionHash = await hashIdSecure(definition, {
    domain: 'engine.matter.definition',
    schemaVersion: definition.schemaVersion,
  });
  return cloneAndFreezeStrictJson({ definition, definitionHash }, '$.matterDefinitionBinding');
}
