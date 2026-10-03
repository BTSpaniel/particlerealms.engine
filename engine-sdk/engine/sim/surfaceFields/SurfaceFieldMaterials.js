// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { loadEngineConstructionCompositeMaterialCatalog, EngineCompositeMaterialCatalog } from '../../assets/material/composite/EngineCompositeMaterialCatalog.js';
import { validateEngineCompositeMaterialResource } from '../../assets/material/composite/CompositeMaterialContracts.js';
import { PINE_FIRE_MATERIAL } from '../combustion/WoodFireMaterial.js';

export const SURFACE_MATERIAL_IDS = Object.freeze({ wood: 'builtin.material.organic.spruce-pine-fir',
    metal: 'builtin.material.element.copper', stone: 'builtin.material.ceramic.fired-clay-brick', calcite: 'builtin.material.mineral.calcite' });

/** Selected calcite evidence, not an acid-reactivity alias for generic stone. */
export const SURFACE_CALCITE_MATERIAL_RESOURCE = Object.freeze({
    schema: 'engine.composite-material', schemaVersion: '1.0.0', copyright: 'Copyright (c) 2026 Jake Wehmeier (BTSpaniel)',
    license: 'LicenseRef-ParticleRealms-Alpha', id: SURFACE_MATERIAL_IDS.calcite, logicalPath: 'material/mineral/calcite.json',
    name: 'Calcite (calcium carbonate)', category: 'mineral',
    facets: { identity: { kind: 'calcite', phaseAt293K: 'solid', description: 'Selected CaCO3 calcite substrate; the surface reaction owner tracks finite mineral mass.' },
        physical: { densityKgPerM3: 2710 }, render: { workflow: 'metallicRoughness', baseColorFactor: [.84, .80, .70, 1], metallicFactor: 0, roughnessFactor: .82 } },
    missingFacets: ['chemistry', 'contact', 'mechanical', 'thermal', 'electrical', 'substance', 'fabrication', 'fiber', 'audio'], notApplicableFacets: [],
    sources: [{ id: 'nist-srm-915c', kind: 'primary', uri: 'https://www.govinfo.gov/content/pkg/GOVPUB-C13-0dd1458c29aace6b60ecba3311f8a195/pdf/GOVPUB-C13-0dd1458c29aace6b60ecba3311f8a195.pdf', citation: 'NIST SRM 915c calcium carbonate report', note: 'Calcite density evidence; no missing heat capacity or conductivity is inferred.' },
        { id: 'surface-authored-appearance', kind: 'repository', uri: 'engine/sim/surfaceFields/SurfaceFieldMaterials.js', citation: 'Authored surface-lab calcite appearance', note: 'Appearance only; no physical property evidence.' }],
    fieldSources: { 'identity.kind': ['nist-srm-915c'], 'identity.phaseAt293K': ['nist-srm-915c'], 'identity.description': ['nist-srm-915c'], 'physical.densityKgPerM3': ['nist-srm-915c'],
        'render.workflow': ['surface-authored-appearance'], 'render.baseColorFactor': ['surface-authored-appearance'], 'render.metallicFactor': ['surface-authored-appearance'], 'render.roughnessFactor': ['surface-authored-appearance'] },
});

/** Resolve existing catalog evidence without filling missing physical fields. */
export function resolveSurfaceFieldMaterials(catalog) {
    if (!catalog || typeof catalog.get !== 'function') throw new TypeError('Surface materials require an engine composite catalog');
    return Object.freeze(['wood', 'metal', 'stone', 'calcite'].map(kind => {
        const resource = catalog.get(SURFACE_MATERIAL_IDS[kind]) ?? (kind === 'calcite' ? SURFACE_CALCITE_MATERIAL_RESOURCE : null);
        if (!resource) throw new RangeError(`Surface material unavailable: ${SURFACE_MATERIAL_IDS[kind]}`);
        validateEngineCompositeMaterialResource(resource);
        const densityKgPerM3 = kind === 'wood' ? PINE_FIRE_MATERIAL.dryDensityKgM3 : resource.facets.physical?.densityKgPerM3 ?? null;
        const specificHeatJPerKgK = kind === 'wood' ? PINE_FIRE_MATERIAL.wood.heatCapacity[0] : resource.facets.thermal?.specificHeatJPerKgK ?? null;
        const thermalConductivityWPerMK = kind === 'wood' ? PINE_FIRE_MATERIAL.wood.conductivity[0] : resource.facets.thermal?.thermalConductivityWPerMK ?? null;
        const missingProperties = [];
        for (const [key, value] of Object.entries({ densityKgPerM3, specificHeatJPerKgK, thermalConductivityWPerMK })) if (value === null) missingProperties.push(key);
        return Object.freeze({ kind, id: resource.id, name: kind === 'wood' ? 'FDS pine (SPF catalog appearance)' : resource.name,
            resource, densityKgPerM3, specificHeatJPerKgK, thermalConductivityWPerMK, missingProperties: Object.freeze(missingProperties),
            thermalAvailable: missingProperties.length === 0, combustible: kind === 'wood',
            baseColor: Object.freeze([...(resource.facets.render?.baseColorFactor ?? [ .5, .5, .5, 1 ])]),
            roughness: resource.facets.render?.roughnessFactor ?? 1, metallic: resource.facets.render?.metallicFactor ?? 0,
            combustionMaterialId: kind === 'wood' ? PINE_FIRE_MATERIAL.id : null });
    }));
}

export async function loadSurfaceFieldMaterials(options = {}) {
    const catalog = await loadEngineConstructionCompositeMaterialCatalog(options);
    return resolveSurfaceFieldMaterials(new EngineCompositeMaterialCatalog([...catalog.list(), SURFACE_CALCITE_MATERIAL_RESOURCE]));
}
