// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { normalizeTerrainHeightfield, sampleTerrainHeightfield } from '../../../../../engine/world/generation/TerrainHeightfield.js';
import { normalizeTerrainBakeConfig } from '../../../../../engine/world/generation/TerrainBake.js';
import { terrainSpatialField } from '../AmbientTerrainAuthoring.js';
import { FACTORY_ENGINE_TERRAIN } from '../AmbientTerrainFactory.js';
import { SPATIAL_TREE_SPECIES, spatialTreeStructure } from './SpatialTree.js';
import { resampleTerrainHeightfield } from '../../../../../engine/world/generation/TerrainHeightfield.js';
import { spatialTerrainTriangleSampler } from './SpatialTerrainSculpt.js';
import { spatialLakeMeshDimensions, spatialGeometryWorldTransform, spatialLakeTriangles, spatialRenderedBedClipper } from './SpatialWaterSurface.js';
import { createWaterFieldRecipe, normalizeWaterFieldRecipe } from '../../../../../engine/render/water/WaterFieldRecipe.js';
import { OCEAN_SPECTRUM_TYPES_WGSL } from '../../../../../engine/render/water/OceanSpectrum.js';
import { assertAmbientNativeAppearanceFunctions } from '../../../../kernel/schema/AmbientNativeAppearance.js';
import { SPATIAL_WATER_FOAM_SOURCE, normalizeSpatialWaterFoamSource, SPATIAL_WATER_RESPONSE_SOURCE, normalizeSpatialWaterResponseSource } from './SpatialWaterFoamSource.js';

/** Saved finite-water code uses the existing bounded native function policy.
 * Analytic caches may carry exactly the engine's value-only sample struct;
 * validation strips that trusted declaration from a copy, never saved source. */
export function normalizeSpatialWaterFieldRecipe(value) {
    const recipe = normalizeWaterFieldRecipe(value);
    const functions = recipe.model === 'analytic-cache-v2' ? recipe.sourceWGSL.replace(OCEAN_SPECTRUM_TYPES_WGSL, '') : recipe.sourceWGSL;
    assertAmbientNativeAppearanceFunctions(functions);
    return structuredClone(recipe);
}

const number = (id, label, value, min, max, step = .01) => ({ id, label, type: 'number', default: value, min, max, step });
const color = (id, label, value) => ({ id, label, type: 'color', default: value });
const common = [number('seed', 'Seed', 7314, 0, 4294967295, 1), number('density', 'Sample density', 1, 0, 2),
    number('x', 'Position X', 0, -20, 20), number('y', 'Position Y', 0, -20, 20), number('z', 'Position Z', 0, -20, 20),
    number('yaw', 'Rotation Y', 0, -180, 180, 1), number('scale', 'Scale', 1, .02, 10), number('opacity', 'Opacity', .96, 0, 1),
    { ...number('detail', 'Surface profile · 0 legacy / 1 sculpted', 0, 0, 1, 1), optional: true }];
const peaks = [[-1.25, 1.35, 1.9, .39], [-.67, 2, 2.8, .40], [.12, 2.35, 2, .44], [1.05, 1.4, 1.6, .43], [1.64, 2.6, 1.9, .52], [-1.83, 2.55, 1.7, .51]];
const specs = [
    ['terrain', 'Eroded terrain', [number('baseHeight', 'Base height', -.71, -5, 5), number('erosion', 'Rock erosion', 1, 0, 3),
        { id: 'surfaceMesh', label: 'Opaque terrain triangle surface', type: 'boolean', default: false, optional: true },
        { ...number('lightAzimuth', 'Terrain sunlight azimuth', -123, -180, 180, 1), optional: true },
        { ...number('lightElevation', 'Terrain sunlight elevation', 46, 0, 90, 1), optional: true },
        { ...number('normalRadius', 'Measured shading radius · cells', 1.5, .05, 4, .05), optional: true },
        { ...number('baseLevel', 'Closed terrain base elevation', -.85, -20, 20), optional: true },
        { id: 'terraces', label: 'Terraces [X, Z, half width, half depth, height, blend]', type: 'json', optional: true },
        { id: 'channels', label: 'Authored stream channels · control points, smoothing 0–1, halfWidth, bankWidth, bedLevel, bedRelief, flowInfluence', type: 'json', optional: true },
        { ...number('surfaceSampling', 'Surface sampling · 0 original / 1 area balanced', 0, 0, 1, 1), optional: true },
        { ...number('surfelWidth', 'Surface Gaussian width', .68, .35, 1.5), optional: true },
        { id: 'heightfield', label: 'Saved engine terrain and river flow', type: 'json', optional: true },
        { id: 'materialProfile', label: 'Ground material distribution', type: 'select', options: ['rocky', 'forest'], default: 'rocky', optional: true },
        { ...number('groundCover', 'Ground vegetation fraction', .7, 0, 1), optional: true },
        { ...number('materialScale', 'Ground material patch frequency', 1, .05, 4), optional: true },
        { id: 'bakeConfig', label: 'Terrain generation settings · apply with Regenerate terrain', type: 'json', optional: true },
        { id: 'peaks', label: 'Peaks [X, Z, height, width]', type: 'json', default: peaks }, color('rockColor', 'Rock', '#17242b'), color('foliageColor', 'Ground vegetation', '#122e21')]],
    ['water', 'Water surface', [number('level', 'Water level', -.655, -5, 5), number('waveHeight', 'Wave height', .004, 0, .2), number('glint', 'Reflected light', 1, 0, 3), color('color', 'Water', '#06181f'),
        ...spatialFoamParameters(),
        { ...number('surfaceVersion', 'Saved water interface version', 2, 2, 2, 1), optional: true },
        { ...number('waterOperationsVersion', 'Connected water owners version', 1, 1, 1, 1), optional: true },
        { id: 'waterOpticsEnabled', label: 'Connected optics contribution', type: 'boolean', default: true, optional: true },
        { id: 'waterFieldEnabled', label: 'Connected field contribution', type: 'boolean', default: true, optional: true },
        { id: 'surfaceDomain', label: 'Finite water domain', type: 'select', options: ['lake', 'river'], default: 'lake', optional: true },
        { ...number('surfaceSegments', 'Longest patch edge subdivisions', 32, 2, 96, 1), optional: true },
        { ...number('foamStrength', 'Breaking crest foam coverage', .35, 0, 1), optional: true },
        { ...number('choppiness', 'Horizontal wave displacement', .25, 0, 1), optional: true },
        { id: 'waterField', label: 'Saved shared water field · editable WGSL recipe', type: 'json', optional: true },
        { id: 'surfaceProfile', label: 'Water optics', type: 'select', options: ['plain', 'depth'], default: 'plain', optional: true },
        { ...number('roughness', 'Water reflection roughness', .22, .03, .8), optional: true },
        { ...color('shallowColor', 'Shallow water pigment', '#716b44'), optional: true },
        { ...number('depthFade', 'Pigment depth transition · scene units', .6, .05, 8), optional: true },
        { id: 'surfaceMesh', label: 'Opaque reflective stream surface', type: 'boolean', default: false, optional: true },
        { ...number('channelIndex', 'Linked terrain channel index', 0, 0, 7, 1), optional: true },
        { ...number('channelSteps', 'Surface subdivisions per channel segment', 16, 2, 32, 1), optional: true },
        { ...number('acrossSegments', 'Surface subdivisions across channel', 4, 1, 12, 1), optional: true },
        { ...number('waveFrequency', 'Water waves · cycles per metre', .6, .05, 8), optional: true },
        { ...number('waveSpeed', 'Water wave speed · metres per second', .12, 0, 3), optional: true },
        { ...number('waveDirection', 'Water wave direction · degrees', 35, -180, 180, 1), optional: true },
        { id: 'bounds', label: 'Water extent [minimum X, Z, maximum X, Z]', type: 'json', optional: true }]],
    ['rock', 'Grounded rock', [number('width', 'Rock width · metres', .6, .02, 3), number('height', 'Rock height · metres', .35, .02, 3), number('depth', 'Rock depth · metres', .45, .02, 3),
        { id: 'surfaceProfile', label: 'Rock surface', type: 'select', options: ['plain', 'stone'], default: 'plain', optional: true },
        number('roughness', 'Geological deformation', .25, 0, .45), number('radialSegments', 'Rock radial segments', 8, 4, 12, 1), number('heightSegments', 'Rock height segments', 5, 3, 10, 1),
        number('moss', 'Upper-surface moss coverage', .3, 0, 1), color('color', 'Stone material', '#606156'), color('mossColor', 'Moss material', '#485437')]],
    ['groundcover', 'Ground vegetation and leaf litter', [number('count', 'Rooted plant / litter instances', 240, 0, 800, 1),
        { id: 'species', label: 'Ground cover', type: 'select', options: ['grass', 'litter'], default: 'grass' },
        number('width', 'Patch width · metres', 6, .1, 40), number('depth', 'Patch depth · metres', 8, .1, 40),
        number('height', 'Blade height / litter length · metres', .22, .02, .8), number('bladeWidth', 'Blade width / litter width · metres', .014, .002, .2),
        number('blades', 'Blades per rooted plant', 5, 1, 8, 1), number('curvature', 'Leaf curvature', .12, 0, .4),
        number('windStrength', 'Primary wind sway · radians', .08, 0, .5), number('windFrequency', 'Wind frequency', .9, .05, 4),
        number('windDirection', 'Wind direction · degrees', 65, -180, 180, 1),
        { id: 'omitPlants', label: 'Removed plant / litter indices', type: 'json', default: [] },
        { ...number('minElevation', 'Minimum rooted elevation · metres', 0, -5, 20), optional: true },
        color('color', 'Vegetation / litter material', '#506535'), color('tipColor', 'Dry tips / varied litter', '#867946')]],
    ['foliage', 'Pine scatter', [number('count', 'Tree instances', 95, 0, 300, 1), number('height', 'Base height', .10, .01, 2), number('variation', 'Height variation', .24, 0, 2),
        number('minElevation', 'Minimum ground height', -.61, -5, 5), number('maxElevation', 'Maximum ground height', 1.2, -5, 5),
        { id: 'omit', label: 'Omitted tree indices', type: 'json', default: [] }, color('color', 'Pine', '#0e2b21'), color('warmColor', 'Warm foliage', '#663617'),
        { ...number('slopeLimit', 'Maximum rooted ground slope', 2.4, .1, 8), optional: true },
        { ...number('placementAttempts', 'Ground placement attempts', 1, 1, 128, 1), optional: true },
        { ...color('trunkColor', 'Pine bark', '#49382a'), optional: true }]],
    ['tree', 'Complete tree · engine growth', [number('generatorVersion', 'Saved tree generator version', 1, 1, 1, 1),
        { id: 'species', label: 'Species', type: 'select', options: SPATIAL_TREE_SPECIES, default: 'oak' },
        number('height', 'Tree height · metres', 8, .25, 30), number('trunkRadius', 'Trunk radius · metres', .16, .01, 1.5),
        number('crownWidth', 'Crown width · metres', 5, .25, 20), number('generations', 'Branch generations', 3, 1, 4, 1),
        number('branchAngle', 'Branch spread · degrees', 38, 8, 85, 1), number('radiusDecay', 'Branch taper', .78, .45, .95),
        number('jitter', 'Natural branch variation', .065, 0, .25), number('leafSize', 'Leaf / needle cluster width · metres', .055, .005, .25),
        number('leafDensity', 'Foliage sample density', 1, 0, 2), number('radialSegments', 'Branch radial surface segments', 7, 4, 12, 1),
        { id: 'foliageSurface', label: 'Foliage surface', type: 'select', options: ['gaussian', 'hybrid', 'mesh'], default: 'gaussian', optional: true },
        { ...number('leafMeshFraction', 'Solid leaf fraction in hybrid foliage', .15, 0, 1), optional: true },
        { id: 'leafProfile', label: 'Leaf footprint · legacy width / finite full length', type: 'select', options: ['legacy', 'lamina'], default: 'legacy', optional: true },
        { ...number('leafCurvature', 'Natural leaf curvature', .10, 0, .4), optional: true },
        { ...number('trunkLean', 'Seeded whole-tree curvature · height fraction', .025, 0, .12), optional: true },
        { ...number('crownTwist', 'Crown twist over tree height · degrees', 0, -90, 90, 1), optional: true },
        { ...number('crownDepthScale', 'Crown depth proportion', 1, .4, 1.5), optional: true },
        { ...number('foliageShoots', 'Attached broadleaf shoots per foliage group', 0, 0, 4, 1), optional: true },
        { ...number('foliageShootSpread', 'Broadleaf shoot spread', .5, 0, 1), optional: true },
        { id: 'pineSprigs', label: 'Paired needles on terminal woody sprigs', type: 'boolean', default: false, optional: true },
        number('autumn', 'Autumn foliage blend', 0, 0, 1), color('barkColor', 'Bark material', '#514337'),
        color('leafColor', 'Leaf material', '#355b31'), color('autumnColor', 'Autumn material', '#b37d35'),
        number('lightAzimuth', 'Sunlight azimuth', -123, -180, 180, 1), number('lightElevation', 'Sunlight elevation', 32, 0, 90, 1),
        number('windStrength', 'Primary wind sway · radians', .045, 0, .5), number('windFrequency', 'Wind frequency', .7, .05, 4),
        number('windDirection', 'Wind direction · degrees', 65, -180, 180, 1),
        { id: 'omitBranches', label: 'Pruned branch IDs · descendants also removed', type: 'json', default: [] },
        { id: 'omitLeaves', label: 'Removed foliage IDs', type: 'json', default: [] },
        { id: 'branchOverrides', label: 'Branch overrides · ID, lengthScale, radiusScale, offset', type: 'json', default: [] }]],
    ['roof', 'Pavilion roof', [number('width', 'Roof width', .40, .02, 4), number('depth', 'Roof depth', .29, .02, 4), number('height', 'Roof height above ground', .34, -2, 5),
        number('crown', 'Roof crown', .08, 0, 1), number('eave', 'Raised eave', .035, 0, 1), color('color', 'Roof', '#8c451a'),
        { ...number('thickness', 'Solid slab / fascia thickness', 0, 0, .5), optional: true },
        { ...number('groundX', 'Foundation ground X', 0, -20, 20), optional: true }, { ...number('groundZ', 'Foundation ground Z', 0, -20, 20), optional: true }]],
    ['column', 'Pavilion column', [number('height', 'Column height', .28, .01, 5), number('radius', 'Column radius', .008, .001, .3), number('baseHeight', 'Base above ground', .09, -2, 3), color('color', 'Wood', '#753817'),
        { ...number('groundX', 'Foundation ground X', 0, -20, 20), optional: true }, { ...number('groundZ', 'Foundation ground Z', 0, -20, 20), optional: true }]],
    ['waterfall', 'Waterfall', [number('height', 'Fall height', 2.12, .01, 8), number('radius', 'Fall radius', .075, .001, 1), color('color', 'Waterfall', '#5ca6a8'),
        ...spatialFoamParameters(),
        { ...number('surfaceVersion', 'Saved falling sheet version', 2, 2, 2, 1), optional: true },
        { ...number('fallSegments', 'Falling sheet drop subdivisions', 32, 2, 96, 1), optional: true },
        { ...number('acrossSegments', 'Falling sheet width subdivisions', 8, 1, 24, 1), optional: true },
        { ...number('waveHeight', 'Sheet thickness variation', .006, 0, .1), optional: true },
        { ...number('waveFrequency', 'Sheet waves · cycles per metre', 8, .05, 24), optional: true },
        { ...number('waveSpeed', 'Falling flow · metres per second', 1.2, 0, 8), optional: true },
        { ...number('waveDirection', 'Local sheet wave direction · degrees', 90, -180, 180, 1), optional: true },
        { ...number('roughness', 'Sheet reflection roughness', .15, .03, .8), optional: true },
        { ...number('glint', 'Sheet reflected light', .55, 0, 3), optional: true },
        { ...number('foamStrength', 'Sheet whitewater coverage', .45, 0, 1), optional: true },
        { ...number('sprayCount', 'Owned impact spray samples', 96, 0, 256, 1), optional: true },
        { ...number('waterOperationsVersion', 'Connected water owners version', 1, 1, 1, 1), optional: true },
        { id: 'waterFieldEnabled', label: 'Connected field contribution', type: 'boolean', default: true, optional: true },
        { id: 'impactWaterId', label: 'Receiving water node ID', type: 'json', optional: true },
        { id: 'waterField', label: 'Saved shared water field · editable WGSL recipe', type: 'json', optional: true },
        { id: 'grounded', label: 'Start at linked terrain surface', type: 'boolean', default: false, optional: true },
        { ...number('endLevel', 'Waterfall end elevation', -.655, -20, 20), optional: true }]],
];
export const SPATIAL_GEOMETRY_DEFINITIONS = Object.freeze(specs.map(([kind, label, fields]) => Object.freeze({ kind, type: `geometry.${kind}`, label,
    params: Object.freeze([...common.map(value => ['tree', 'groundcover'].includes(kind) && ['x', 'z'].includes(value.id) ? { ...value, min: -100, max: 100 } : value), ...fields].map(value => Object.freeze(value))) })));
export function spatialGeometryDefinition(type) { return SPATIAL_GEOMETRY_DEFINITIONS.find(item => item.type === type || item.kind === type) ?? null; }
function spatialFoamParameters() {
    return [
        { ...number('waterStateVersion', 'Saved retained water state', 1, 1, 1, 1), optional: true },
        { ...number('foamVersion', 'Retained foam interface', 1, 1, 1, 1), optional: true },
        { id: 'foamSourceWGSL', label: 'Saved foam production, transport, decay and impacts', type: 'json', default: SPATIAL_WATER_FOAM_SOURCE, optional: true },
        { ...number('foamProduction', 'Qualified crest production per second', 1, 0, 8), optional: true },
        { ...number('foamThreshold', 'Crest compression threshold', .12, .01, .9), optional: true },
        { ...number('foamLifetime', 'Foam lifetime · seconds', 2.5, .05, 30), optional: true },
        { ...number('foamDriftX', 'Foam current X · metres per second', 0, -8, 8), optional: true },
        { ...number('foamDriftZ', 'Foam current Z · metres per second', .025, -8, 8), optional: true },
        { ...number('foamImpactGain', 'Recorded impact deposit strength', .5, 0, 4), optional: true },
        { ...number('waterResponseVersion', 'Saved water contact response', 1, 1, 1, 1), optional: true },
        { id: 'waterResponseSourceWGSL', label: 'Saved pointer and click water response', type: 'json', default: SPATIAL_WATER_RESPONSE_SOURCE, optional: true },
        { ...number('waterClickGain', 'Water click deposit', 1, 0, 4), optional: true },
        { ...number('waterClickRadius', 'Water contact radius · metres', .08, .005, 2), optional: true },
        { ...number('waterPointerGain', 'Held pointer deposit per second', 0, 0, 4), optional: true },
    ];
}
export function normalizeSpatialGeometryParameter(type, id, value) {
    const spec = spatialGeometryDefinition(type)?.params.find(item => item.id === id);
    if (!spec) throw new TypeError(`Unknown geometry parameter ${type}.${id}`);
    if (spec.type === 'number') {
        if (!Number.isFinite(value) || value < spec.min || value > spec.max || spec.step === 1 && !Number.isInteger(value)) throw new TypeError(`${id} must be ${spec.step === 1 ? 'an integer' : 'a number'} in [${spec.min}, ${spec.max}]`);
    } else if (spec.type === 'boolean') {
        if (typeof value !== 'boolean') throw new TypeError(`${id} must be boolean`);
    } else if (spec.type === 'select') {
        if (!spec.options.includes(value)) throw new TypeError(`${id} must be one of ${spec.options.join(', ')}`);
    } else if (spec.type === 'color') {
        if (typeof value !== 'string' || !/^#[a-f0-9]{6}$/i.test(value)) throw new TypeError(`${id} must be a hex color`);
        return value.toLowerCase();
    } else if (id === 'foamSourceWGSL') return normalizeSpatialWaterFoamSource(value);
    else if (id === 'waterResponseSourceWGSL') return normalizeSpatialWaterResponseSource(value);
    else if (id === 'heightfield') return normalizeTerrainHeightfield(value);
    else if (id === 'waterField') return normalizeSpatialWaterFieldRecipe(value);
    else if (id === 'bakeConfig') return normalizeTerrainBakeConfig(value);
    else if (id === 'terraces') {
        if (!Array.isArray(value) || value.length > 8 || Array.from(value).some(row => !Array.isArray(row) || row.length !== 6 || Array.from(row).some(v => !Number.isFinite(v)) || Math.abs(row[0]) > 20 || Math.abs(row[1]) > 20 || row[2] < .01 || row[2] > 10 || row[3] < .01 || row[3] > 10 || row[4] < 0 || row[4] > 10000 || row[5] < .001 || row[5] > 10)) throw new TypeError('Terraces must contain at most eight finite bounded [X, Z, half width, half depth, height, blend] rows');
    }
    else if (id === 'peaks') {
        if (!Array.isArray(value) || value.length > 24 || value.some(row => !Array.isArray(row) || row.length !== 4 || row.some(v => !Number.isFinite(v)) || Math.abs(row[0]) > 20 || Math.abs(row[1]) > 20 || row[2] < 0 || row[2] > 8 || row[3] < .02 || row[3] > 10)) throw new TypeError('Peaks must contain at most 24 bounded [X, Z, height, width] rows');
    } else if (id === 'channels') {
        const keys = ['id', 'points', 'smoothing', 'halfWidth', 'bankWidth', 'bedLevel', 'bedRelief', 'flowInfluence'];
        if (!Array.isArray(value) || value.length > 8 || new Set(value.map(row => row?.id)).size !== value.length || value.some(row => !row || Object.keys(row).some(key => !keys.includes(key)) || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(row.id)
            || !Array.isArray(row.points) || row.points.length < 2 || row.points.length > 24 || row.points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value) || Math.abs(value) > 100))
            || row.points.some((point, index) => index > 0 && Math.hypot(point[0] - row.points[index - 1][0], point[1] - row.points[index - 1][1]) < .05)
            || Object.hasOwn(row, 'smoothing') && (!Number.isFinite(row.smoothing) || row.smoothing < 0 || row.smoothing > 1)
            || !Number.isFinite(row.halfWidth) || row.halfWidth < .2 || row.halfWidth > 5 || !Number.isFinite(row.bankWidth) || row.bankWidth < .1 || row.bankWidth > 5
            || !Number.isFinite(row.bedLevel) || row.bedLevel < 0 || row.bedLevel > 20 || !Number.isFinite(row.bedRelief) || row.bedRelief < 0 || row.bedRelief > 1 || !Number.isFinite(row.flowInfluence) || row.flowInfluence < 0 || row.flowInfluence > 1)) throw new TypeError('Invalid bounded saved stream-channel grading');
    } else if (id === 'omit' && (!Array.isArray(value) || value.length > 300 || value.some(index => !Number.isInteger(index) || index < 0 || index >= 300))) throw new TypeError('Omitted trees must be indices in [0, 299]');
    else if (id === 'omitPlants' && (!Array.isArray(value) || value.length > 1600 || new Set(value).size !== value.length || value.some(index => !Number.isInteger(index) || index < 0 || index >= 1600))) throw new TypeError('Removed ground plants must be unique indices in [0, 1599]');
    else if (id === 'omitBranches' || id === 'omitLeaves') {
        if (!Array.isArray(value) || value.length > 2048 || new Set(value).size !== value.length || value.some(item => typeof item !== 'string' || !/^growth\.(?:branch|leaf)\.[a-f0-9]{16}$/.test(item))) throw new TypeError('Tree omissions must be unique canonical growth entity IDs');
    } else if (id === 'branchOverrides') {
        const allowed = ['id', 'lengthScale', 'radiusScale', 'offset'];
        if (!Array.isArray(value) || value.length > 512 || new Set(value.map(row => row?.id)).size !== value.length || value.some(row => !row || Object.keys(row).some(key => !allowed.includes(key)) || !/^growth\.branch\.[a-f0-9]{16}$/.test(row.id)
            || ['lengthScale', 'radiusScale'].some(key => row[key] != null && (!Number.isFinite(row[key]) || row[key] < .05 || row[key] > 4))
            || row.offset != null && (!Array.isArray(row.offset) || row.offset.length !== 3 || row.offset.some(number => !Number.isFinite(number) || Math.abs(number) > 3)))) throw new TypeError('Invalid bounded canonical tree branch overrides');
    } else if (id === 'bounds') {
        if (!Array.isArray(value) || value.length !== 4 || value.some(number => !Number.isFinite(number) || Math.abs(number) > 100) || value[2] <= value[0] || value[3] <= value[1]) throw new TypeError('Invalid bounded water surface extent');
    } else if (id === 'impactWaterId') {
        if (value !== null && (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value))) throw new TypeError('Waterfall impact requires a saved receiving water node ID or an inactive null receiver');
    }
    return structuredClone(value);
}
export function normalizeSpatialGeometryParams(type, value = {}) {
    const def = spatialGeometryDefinition(type);
    if (!def) throw new TypeError(`Unknown geometry type ${type}`);
    for (const key of Object.keys(value)) if (!def.params.some(item => item.id === key)) throw new TypeError(`Unknown geometry parameter ${key}`);
    // Optional surface detail must not enter receipts for pre-existing geometry.
    // Saved nodes opt into the revised generator; absent data keeps exact output.
    const params = Object.fromEntries(def.params.filter(spec => !spec.optional || Object.hasOwn(value, spec.id)).map(spec => [spec.id, normalizeSpatialGeometryParameter(type, spec.id, spec.id === 'impactWaterId' && value[spec.id] === null ? null : value[spec.id] ?? spec.default)]));
    if (def.kind === 'terrain' && params.surfaceMesh === true && !params.heightfield) throw new TypeError('Triangle terrain requires a saved engine heightfield');
    if (def.kind === 'water' && params.surfaceProfile === 'depth' && params.surfaceMesh !== true) throw new TypeError('Depth water optics require an authored mesh stream surface');
    if (def.kind === 'water' && params.surfaceVersion === 2 && params.surfaceMesh !== true) throw new TypeError('Version 2 finite water requires an authored mesh interface');
    if (Object.hasOwn(params, 'baseLevel') && params.heightfield && params.baseLevel > params.baseHeight + Math.min(...params.heightfield.heights, ...(params.terraces ?? []).map(row => row[4]), ...(params.channels ?? []).map(channel => Math.max(0, channel.bedLevel - channel.flowInfluence)))) throw new TypeError('Closed terrain base must be below every authored surface height');
    return params;
}
/** One bounded tessellation choice shared by source admission, generation and
 * grounding. A mesh vertex occupies the existing6-float frame buffer format. */
export function spatialTerrainMeshDimensions(params) {
    const density = Math.min(1, Math.sqrt(params.density / 2));
    return { columns: Math.max(2, Math.round(Math.min(96, params.heightfield.width) * density)), rows: Math.max(2, Math.round(Math.min(96, params.heightfield.height) * density)) };
}
/** Count the optional closed sides and bottom as well as the height surface. */
export function spatialTerrainMeshVertexCount(params) {
    const { columns, rows } = spatialTerrainMeshDimensions(params);
    return (columns - 1) * (rows - 1) * 6 + (Object.hasOwn(params, 'baseLevel') ? 18 * (columns + rows - 2) : 0);
}
export function spatialWaterMeshVertexCount(params, terrain) {
    if (params.surfaceVersion === 2 && (params.surfaceDomain ?? 'lake') === 'lake') {
        if (terrain?.surfaceMesh === true && terrain.heightfield) { const { columns, rows } = spatialTerrainMeshDimensions(terrain), clip = spatialRenderedBedClipper(terrain, columns, rows); return spatialLakeTriangles(params, spatialGeometryWorldTransform(params), () => 0, null, clip).length * 3; }
        const { columns, rows } = spatialLakeMeshDimensions(params); return columns * rows * 12;
    }
    const channel = terrain?.channels?.[params.channelIndex ?? 0];
    return channel ? (channel.points.length - 1) * (params.channelSteps ?? 16) * (params.acrossSegments ?? 4) * 12 : 0;
}
export function normalizeSpatialGeometryScene(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.parts) || value.parts.length > 128 || Object.keys(value).some(key => !['version', 'parts', 'frame', 'waterField'].includes(key))) throw new TypeError('Invalid spatial geometry scene');
    const frame = value.frame ?? { origin: [0, .62, 1.1], span: 4.55 };
    if (!Array.isArray(frame.origin) || frame.origin.length !== 3 || frame.origin.some(v => !Number.isFinite(v) || Math.abs(v) > 100) || !Number.isFinite(frame.span) || frame.span < .01 || frame.span > 100 || Object.keys(frame).some(key => !['origin', 'span'].includes(key))) throw new TypeError('Invalid fixed geometry framing');
    const ids = new Set();
    const parts = value.parts.map(part => {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(part.id) || ids.has(part.id) || Object.keys(part).some(key => !['id', 'kind', 'params', 'terrainId', 'visible'].includes(key))) throw new TypeError('Invalid or duplicate geometry node ID');
        ids.add(part.id);
        if (part.visible != null && typeof part.visible !== 'boolean') throw new TypeError('Geometry visibility must be boolean');
        return { id: part.id, kind: spatialGeometryDefinition(part.kind)?.kind ?? part.kind, params: normalizeSpatialGeometryParams(part.kind, part.params), terrainId: part.terrainId ?? null, visible: part.visible !== false };
    }).sort((a, b) => a.id.localeCompare(b.id));
    for (const part of parts) if (part.terrainId && (part.terrainId === part.id || !parts.some(candidate => candidate.id === part.terrainId && candidate.kind === 'terrain'))) throw new TypeError('Geometry grounding requires a terrain node');
    for (const part of parts) if (part.kind === 'water' && part.params.surfaceMesh === true && (part.params.surfaceVersion !== 2 || part.params.surfaceDomain === 'river') && !parts.find(candidate => candidate.id === part.terrainId)?.params.channels?.[part.params.channelIndex ?? 0]) throw new TypeError('A mesh stream surface requires an authored channel on its linked terrain');
    let meshVertices = 0;
    for (const part of parts) if (part.visible && part.kind === 'terrain' && part.params.surfaceMesh === true && part.params.density > 0 && part.params.opacity > 0) {
        meshVertices += spatialTerrainMeshVertexCount(part.params);
    }
    for (const part of parts) if (part.visible && part.kind === 'tree' && part.params.density > 0 && part.params.opacity > 0) {
        meshVertices += spatialTreeStructure(part.params).branches.length * part.params.radialSegments * 9;
    }
    for (const part of parts) if (part.visible && part.kind === 'rock' && part.params.density > 0 && part.params.opacity > 0) meshVertices += part.params.radialSegments * part.params.heightSegments * 6;
    for (const part of parts) if (part.visible && part.kind === 'groundcover' && part.params.density > 0 && part.params.opacity > 0) meshVertices += Math.floor(part.params.count * part.params.density) * (part.params.species === 'grass' ? part.params.blades * 12 : 24);
    for (const part of parts) if (part.visible && part.kind === 'water' && part.params.surfaceMesh === true && part.params.density > 0 && part.params.opacity > 0) meshVertices += spatialWaterMeshVertexCount(part.params, parts.find(candidate => candidate.id === part.terrainId)?.params);
    for (const part of parts) if (part.visible && part.kind === 'waterfall' && part.params.surfaceVersion === 2 && part.params.density > 0 && part.params.opacity > 0) meshVertices += (part.params.fallSegments ?? 32) * (part.params.acrossSegments ?? 8) * 6 + (part.params.sprayCount ?? 96);
    if (meshVertices > 200000) throw new TypeError('Geometry nodes exceed the 200,000 sample/triangle vertex budget. Reduce mesh density or terrain nodes.');
    const recipes = parts.filter(part => part.visible && part.params.waterField).map(part => part.params.waterField);
    if (recipes.length > 1 && recipes.some(recipe => JSON.stringify(recipe) !== JSON.stringify(recipes[0]))) throw new TypeError('Finite water nodes in one scene must share one saved water field recipe');
    const field = recipes[0] ?? value.waterField;
    if (parts.some(part => part.visible && part.params.surfaceVersion === 2 && !(part.params.waterOperationsVersion === 1 && part.params.waterFieldEnabled === false)) && !field) throw new TypeError('Version2 finite water requires a saved editable water field recipe');
    return { version: 1, frame: { origin: [...frame.origin], span: frame.span }, parts, ...(field ? { waterField: normalizeSpatialWaterFieldRecipe(field) } : {}) };
}
/** Factory authority is saved in a visible water node and the scene source.
 * Playback consumes this recipe verbatim and never manufactures source WGSL. */
export function createSpatialFiniteWaterField(seed = 7314) {
    return structuredClone(createWaterFieldRecipe({ seed, parameters: { significantWaveHeight: .1, maximumWavelength: 8, minimumWavelength: .15, choppiness: .8 } }));
}
export function createSpatialDioramaParts(seed = 7314) {
    const make = (id, kind, patch = {}, terrainId = null) => ({ id, kind, params: normalizeSpatialGeometryParams(kind, { seed, detail: 1, ...patch }), terrainId, visible: true });
    const foundation = { groundX: .78, groundZ: .82 };
    const heightfield = terrainSpatialField(FACTORY_ENGINE_TERRAIN), terraceHeight = sampleTerrainHeightfield(heightfield, foundation.groundX, foundation.groundZ);
    return [make('terrain', 'terrain', { density: 2, erosion: .82, surfaceMesh: true, lightAzimuth: -123, lightElevation: 46, normalRadius: 1.5, baseLevel: -.85, terraces: [[foundation.groundX, foundation.groundZ, .34, .27, terraceHeight, .12]], heightfield, bakeConfig: normalizeTerrainBakeConfig(FACTORY_ENGINE_TERRAIN.provenance.config), surfaceSampling: 1, surfelWidth: .68, rockColor: '#4c635d', foliageColor: '#264b35' }),
        make('water', 'water', { density: 2, level: -.54, color: '#23515b', glint: .35, surfaceVersion: 2, surfaceDomain: 'lake', waterField: createSpatialFiniteWaterField(seed), surfaceMesh: true, surfaceProfile: 'depth', roughness: .16, depthFade: .6, shallowColor: '#496f67', bounds: [-2.2, -1, 2.2, 2.8], surfaceSegments: 48, waveFrequency: .6, waveSpeed: .12, waveDirection: 35, foamStrength: .22, choppiness: .2 }, 'terrain'),
        make('pine-scatter', 'foliage', { density: 2, count: 56, height: .20, variation: .32, minElevation: -.51, maxElevation: .9, slopeLimit: 2.4, placementAttempts: 64, color: '#294d35', warmColor: '#95632c', trunkColor: '#49382a' }, 'terrain'),
        make('pavilion-foundation', 'roof', { ...foundation, x: .78, z: .82, width: .64, depth: .49, height: .075, crown: 0, eave: 0, thickness: .10, color: '#62746c' }, 'terrain'),
        make('pavilion-front-step', 'roof', { ...foundation, x: .78, z: .47, width: .45, depth: .20, height: .025, crown: 0, eave: 0, thickness: .055, color: '#55665d' }, 'terrain'),
        make('pavilion-lower-roof', 'roof', { ...foundation, x: .78, z: .82, width: .50, depth: .38, height: .43, crown: .12, eave: .055, thickness: .03, color: '#4c6059' }, 'terrain'),
        make('pavilion-upper-roof', 'roof', { ...foundation, x: .78, z: .82, width: .34, depth: .27, height: .64, crown: .09, eave: .045, thickness: .025, color: '#61746b' }, 'terrain'),
        ...Array.from({ length: 4 }, (_, i) => make(`pavilion-column-${i + 1}`, 'column', { ...foundation, x: .78 + (i % 2 ? 1 : -1) * .18, z: .82 + (i < 2 ? 1 : -1) * .13, baseHeight: .07, height: .42, density: 2, radius: .018, color: '#603a23' }, 'terrain')),
        ...Array.from({ length: 4 }, (_, i) => make(`pavilion-upper-support-${i + 1}`, 'column', { ...foundation, x: .78 + (i % 2 ? 1 : -1) * .07, z: .82 + (i < 2 ? 1 : -1) * .05, baseHeight: .46, height: .22, density: 2, radius: .011, color: '#603a23' }, 'terrain')),
        ...Array.from({ length: 2 }, (_, i) => make(`pavilion-crossbeam-${i + 1}`, 'roof', { ...foundation, x: .78, z: .82 + (i ? 1 : -1) * .13, width: .39, depth: .03, height: .42, crown: 0, eave: 0, thickness: .045, density: .45, color: '#70482b' }, 'terrain')),
        make('waterfall', 'waterfall', { x: .455, y: 0, z: -.9, grounded: true, endLevel: -.54, density: 2, radius: .075, color: '#93b9b2', surfaceVersion: 2, impactWaterId: 'water', sprayCount: 96, fallSegments: 32, acrossSegments: 8, waveHeight: .004, waveFrequency: 8, waveSpeed: 1.2, waveDirection: 90, foamStrength: .45, glint: .55, roughness: .15 }, 'terrain')];
}

export function createSpatialDioramaScene(seed = 7314) {
    return normalizeSpatialGeometryScene({ version: 1, frame: { origin: [0, .62, 1.1], span: 4.55 }, parts: createSpatialDioramaParts(seed) });
}

/** Full-scale generated forest. Saved engine erosion/flow samples own its ground;
 * an open surface continues well past the eye-level route without tile walls. */
export function createSpatialForestParts(seed = 41771) {
    const field = resampleTerrainHeightfield(terrainSpatialField(FACTORY_ENGINE_TERRAIN, { bounds: [-28, -16, 28, 84], minHeight: 0, maxHeight: 4.8 }), { width: 80, height: 80 });
    const make = (id, kind, patch = {}, terrainId = null) => ({ id, kind, params: normalizeSpatialGeometryParams(kind, { seed, ...patch }), terrainId, visible: true });
    const trees = [
        ['foreground-oak', -3.1, 2.8, 'oak', 9.2, 6.6], ['foreground-birch', 4.5, 5.5, 'birch', 10.5, 4.7],
        ['left-pine', -6.5, 8, 'pine', 11, 3.2], ['right-pine', 7.8, 10, 'pine', 12, 3.4],
        ['mid-oak', -2.2, 12, 'oak', 11, 7], ['mid-birch', 4, 15, 'birch', 12, 4.4],
        ['far-birch-a', -10, 19, 'birch', 13, 4.5], ['far-birch-b', 9.5, 19.2, 'birch', 12, 4.2],
        ['far-oak-a', -6.8, 17, 'oak', 10.8, 6.8], ['far-oak-b', 1.1, 20, 'oak', 13, 7],
        ['side-birch-a', -9.5, 1, 'birch', 9.4, 4.3], ['side-oak-b', 10, 3, 'oak', 10.4, 6.2],
        ['rear-oak-a', -4.6, -6, 'oak', 9.0, 6.4], ['rear-birch-b', 5.2, -5, 'birch', 10.8, 4.6],
    ];
    return [make('forest-ground', 'terrain', { density: 1.55, detail: 1, baseHeight: 0, surfaceMesh: true, heightfield: field, materialProfile: 'forest', groundCover: .50, materialScale: .2,
        channels: [{ id: 'forest-streambed', points: [[-7, -8], [-5, -3], [-1, 1], [1.2, 6], [-.2, 12], [3, 21], [1.5, 33]], smoothing: 1, halfWidth: 1.3, bankWidth: 2.6, bedLevel: .65, bedRelief: .20, flowInfluence: .10 }],
        bakeConfig: normalizeTerrainBakeConfig(FACTORY_ENGINE_TERRAIN.provenance.config), lightAzimuth: -123, lightElevation: 32, normalRadius: .65,
        rockColor: '#594936', foliageColor: '#45543a' }),
        make('forest-stream', 'water', { density: 1, detail: 1, level: 1.38, waveHeight: .002, glint: .65, color: '#253b32', surfaceVersion: 2, surfaceDomain: 'river', waterField: createSpatialFiniteWaterField(seed), foamStrength: .12, choppiness: .12, surfaceProfile: 'depth', roughness: .45, shallowColor: '#716b44', depthFade: .6, surfaceMesh: true, channelIndex: 0, channelSteps: 16, acrossSegments: 4, waveFrequency: .23, waveSpeed: .16, waveDirection: 35 }, 'forest-ground'),
        ...trees.map(([id, x, z, species, height, crownWidth], index) => make(id, 'tree', { seed: (seed + index * 104729) >>> 0, x, z, species, height, crownWidth,
            yaw: Math.round((index * 137.5) % 360 - 180), trunkRadius: species === 'birch' ? .17 : .26 + (index % 3) * .025, density: species === 'pine' ? 2 : index < 2 ? 1.7 : 1,
            branchAngle: species === 'birch' ? 34 : 43, generations: index >= 6 ? 2 : 3, radialSegments: index < 2 ? 7 : 4, leafSize: species === 'pine' ? .16 : species === 'birch' ? .13 : .18, leafDensity: species === 'pine' ? 2 : index < 2 ? 1.4 : 1.05, jitter: .14,
            ...(species === 'pine' ? { pineSprigs: true } : {}),
            leafProfile: 'lamina', leafCurvature: .10, trunkLean: .025 + index % 3 * .012,
            crownTwist: (index % 2 ? -1 : 1) * (18 + index % 4 * 9), crownDepthScale: .72 + index % 4 * .12,
            ...(index < 2 ? { foliageSurface: 'hybrid', leafMeshFraction: .025, foliageShoots: 2, foliageShootSpread: .65 } : {}),
            barkColor: species === 'birch' ? '#b9b8a3' : '#584534', leafColor: species === 'pine' ? '#294536' : '#47613b', autumn: .07,
            windStrength: .035, windFrequency: .55 + (index % 4) * .08, opacity: .97 }, 'forest-ground')),
        ...Array.from({ length: 6 }, (_, index) => make(`distant-grove-${index + 1}`, 'tree', { seed: (seed + (index + 14) * 104729) >>> 0,
            x: -19 + (index % 5) * 9 + (index % 2) * 1.7, z: 30 + Math.floor(index / 5) * 19 + index % 3 * 2.2, density: .5,
            species: index % 4 === 0 ? 'birch' : 'oak', height: 11 + index % 4 * 2.1, crownWidth: 8.4 + index % 3,
            trunkRadius: .25, generations: 2, radialSegments: 4, leafSize: .22, leafDensity: 1.3, jitter: .13, leafProfile: 'lamina', trunkLean: .035,
            crownTwist: (index % 2 ? -1 : 1) * (24 + index % 3 * 11), crownDepthScale: .75 + index % 3 * .14, foliageShoots: 1, foliageShootSpread: .6,
            barkColor: '#615447', leafColor: '#436347', windStrength: .025, opacity: .97 }, 'forest-ground')),
        ...Array.from({ length: 10 }, (_, index) => make(`understory-${index + 1}`, 'tree', { seed: (seed + (index + 24) * 104729) >>> 0,
            x: (index % 2 ? 1 : -1) * (1.65 + (index % 4) * 1.3), z: -1 + Math.floor(index / 2) * 3.1, density: .05,
            species: 'oak', height: .52 + index % 3 * .24, crownWidth: .85 + index % 3 * .32, trunkRadius: .012,
            generations: 1, radialSegments: 4, leafSize: .11, leafDensity: .25, foliageSurface: 'mesh', leafProfile: 'lamina', leafCurvature: .16, trunkLean: .055, jitter: .15,
            barkColor: '#544430', leafColor: '#537d3b', windStrength: .018, opacity: .96 }, 'forest-ground')),
        ...[[-1.3, .8, .55], [2.1, 2.5, .48], [-3.4, 6.3, .78], [3.8, 8.5, .68], [-.9, 12, .38], [1.4, -1, .36], [-2.9, -2.2, .62], [4.7, 14, .80]].map(([x, z, width], index) =>
            make(`forest-rock-${index + 1}`, 'rock', { x, z, seed: (seed + (index + 34) * 104729) >>> 0, yaw: index * 41 - 145,
                width, height: width * .42, depth: width * .83, density: 2, radialSegments: 10, heightSegments: 6, roughness: .31, moss: .62, surfaceProfile: 'stone', color: '#6d6b5a', mossColor: '#435435' }, 'forest-ground')),
        make('near-ground-grass-left', 'groundcover', { seed: seed + 51, x: -4.2, z: 2.5, width: 2.6, depth: 2.6, count: 70, blades: 2, height: .26, bladeWidth: .022, minElevation: 1.42, color: '#4c6434', tipColor: '#928048' }, 'forest-ground'),
        make('near-ground-grass-right', 'groundcover', { seed: seed + 52, x: 2.7, z: -.9, width: 2.6, depth: 2.6, count: 70, blades: 2, height: .20, bladeWidth: .018, minElevation: 1.42, color: '#435e31', tipColor: '#887941' }, 'forest-ground'),
        make('oak-root-grass', 'groundcover', { seed: seed + 54, x: -3.6, z: 4.7, width: 2.8, depth: 2.4, count: 70, blades: 2, height: .22, bladeWidth: .024, minElevation: 1.42, color: '#4c6434', tipColor: '#928048' }, 'forest-ground'),
        make('birch-root-grass', 'groundcover', { seed: seed + 55, x: 4.6, z: 5.3, width: 2.4, depth: 2.6, count: 70, blades: 2, height: .18, bladeWidth: .019, minElevation: 1.42, color: '#435e31', tipColor: '#887941' }, 'forest-ground'),
        make('forest-leaf-litter', 'groundcover', { seed: seed + 53, x: .8, z: -2.4, width: 4, depth: 2.8, count: 100, species: 'litter', height: .12, bladeWidth: .065, curvature: .09, windStrength: 0, minElevation: 1.42, color: '#5b4a2e', tipColor: '#94663b' }, 'forest-ground')];
}

export function createSpatialForestScene(seed = 41771) {
    return normalizeSpatialGeometryScene({ version: 1, frame: { origin: [0, 0, 0], span: 2.8 }, parts: createSpatialForestParts(seed) });
}

/** Coordinates are raw metres, before any legacy fixed-framing transform. */
export function spatialForestCamera(seed = 41771) {
    const scene = createSpatialForestScene(seed), terrain = scene.parts.find(part => part.id === 'forest-ground').params, { columns, rows } = spatialTerrainMeshDimensions(terrain);
    const ground = terrain.baseHeight + spatialTerrainTriangleSampler(terrain, columns, rows).sample(0, -3.5);
    return { position: [0, ground + 1.65, -3.5], target: [0, ground + 4.7, 12], eyeHeight: 1.65,
        bounds: { min: [-1.4, ground + .8, -5.5], max: [1.4, ground + 2.3, -.7] }, groundHeight: ground };
}
