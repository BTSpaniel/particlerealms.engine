// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Optional renderer controls. Missing fields never migrate an older document. */
export const SPATIAL_RENDER_PARAMETER_SPECS = Object.freeze([
    { id: 'renderVersion', label: 'Spatial renderer version', type: 'number', min: 1, max: 1, step: 1, default: 1 },
    { id: 'renderProfile', label: 'Captured appearance', type: 'select', options: ['artistic', 'faithful'], default: 'artistic' },
    { id: 'mediaProjection', label: 'Media projection', type: 'select', options: ['perspective', 'equirectangular', 'cubemap-atlas'], default: 'perspective' },
    { id: 'mediaFilter', label: 'Media minification filter', type: 'number', min: 0, max: 1, step: .01, default: 1 },
    { id: 'visibilityBackend', label: 'Visibility and sorting', type: 'select', options: ['cpu', 'gpu'], default: 'cpu' },
    { id: 'lodPixelRadius', label: 'Subpixel round-splat threshold', type: 'number', min: 0, max: 1, step: .01, default: .18 },
    { id: 'localVisibility', label: 'Tile-local visibility ordering (CPU)', type: 'boolean', default: false },
    { id: 'fogMode', label: 'Atmosphere distance model', type: 'select', options: ['artistic', 'distance'], default: 'artistic' },
    { id: 'fogDensity', label: 'Distance fog density', type: 'number', min: 0, max: 2, step: .005, default: .025 },
    { id: 'fogHeight', label: 'Height fog falloff (zero disables)', type: 'number', min: 0, max: 4, step: .01, default: 0 },
    { id: 'meshLighting', label: 'Generated surface lighting', type: 'number', min: 0, max: 1, step: .01, default: .65 },
    { id: 'skyMode', label: 'Generated sky', type: 'select', options: ['none', 'procedural'], default: 'none' },
    { id: 'skyZenith', label: 'Sky zenith', type: 'color', default: '#5883ad' },
    { id: 'skyHorizon', label: 'Sky horizon', type: 'color', default: '#d6dfd7' },
    { id: 'skySunColor', label: 'Sun color', type: 'color', default: '#fff0cf' },
    { id: 'skyIntensity', label: 'Sky illumination', type: 'number', min: 0, max: 4, step: .01, default: 1 },
    { id: 'skyHaze', label: 'Horizon haze and sun halo', type: 'number', min: 0, max: 1, step: .01, default: .25 },
    { id: 'skySunRadius', label: 'Sun angular radius (radians)', type: 'number', min: .001, max: .1, step: .001, default: .007 },
    { id: 'skySunIntensity', label: 'Sun radiance', type: 'number', min: 0, max: 16, step: .1, default: 3 },
    { id: 'skyCloudCoverage', label: 'Sky cloud coverage', type: 'number', min: 0, max: 1, step: .01, default: .35 },
    { id: 'skyCloudScale', label: 'Sky cloud scale', type: 'number', min: .05, max: 4, step: .05, default: .6 },
    { id: 'skyCloudSpeed', label: 'Sky cloud advection', type: 'number', min: 0, max: .2, step: .005, default: .015 },
    { id: 'surfaceDetail', label: 'Generated bark and ground detail', type: 'number', min: 0, max: 1, step: .01, default: 0 },
    ...['ground', 'bark', 'stone'].flatMap(material => [
        { id: `${material}DetailScale`, label: `${material} texture frequency multiplier`, type: 'number', min: .25, max: 8, step: .05, default: 1 },
        { id: `${material}DetailAmount`, label: `${material} texture amount multiplier`, type: 'number', min: 0, max: 2, step: .01, default: 1 },
        { id: `${material}RoughnessScale`, label: `${material} roughness multiplier`, type: 'number', min: .2, max: 2, step: .01, default: 1 },
        { id: `${material}HighlightScale`, label: `${material} highlight multiplier`, type: 'number', min: 0, max: 2, step: .01, default: 1 },
    ]),
    { id: 'surfaceBumpStrength', label: 'Generated surface relief multiplier', type: 'number', min: 0, max: 2, step: .01, default: 1 },
    { id: 'meshRoughness', label: 'Generated surface roughness', type: 'number', min: .15, max: 1, step: .01, default: .82 },
    { id: 'meshSpecular', label: 'Generated surface highlights', type: 'number', min: 0, max: 1, step: .01, default: 0 },
    { id: 'leafTransmission', label: 'Generated thin-leaf backlighting', type: 'number', min: 0, max: 1, step: .01, default: .18 },
    { id: 'meshShadowStrength', label: 'Opaque geometry sun shadows', type: 'number', min: 0, max: .85, step: .01, default: 0 },
    { id: 'meshShadowMapSize', label: 'Geometry shadow resolution', type: 'select', options: ['256', '512', '1024', '2048'], default: '1024' },
    { id: 'meshShadowBias', label: 'Geometry shadow depth bias', type: 'number', min: .00001, max: .02, step: .0001, default: .0015 },
]);
// Authoring recipes copy concrete controls into the appearance node. Playback
// never consults a look ID, and every setting remains independently editable.
const neutralSurfaceFactors = Object.freeze(Object.fromEntries(SPATIAL_RENDER_PARAMETER_SPECS.filter(spec => /^(ground|bark|stone)/.test(spec.id) || spec.id === 'surfaceBumpStrength').map(spec => [spec.id, spec.default])));
export const SPATIAL_SURFACE_LOOKS = Object.freeze({
    natural: Object.freeze({ label: 'Natural surfaces', settings: Object.freeze({ renderVersion: 1, ...neutralSurfaceFactors, surfaceDetail: .55, meshLighting: 1, meshRoughness: .82, meshSpecular: .18, leafTransmission: .18 }) }),
    painted: Object.freeze({ label: 'Soft painted', settings: Object.freeze({ renderVersion: 1, ...neutralSurfaceFactors, surfaceDetail: .3, surfaceBumpStrength: 0, meshLighting: 0, meshRoughness: .95, meshSpecular: 0, leafTransmission: 0 }) }),
    satin: Object.freeze({ label: 'Satin surfaces', settings: Object.freeze({ renderVersion: 1, ...neutralSurfaceFactors, surfaceDetail: .4, surfaceBumpStrength: .45, meshLighting: 1, meshRoughness: .48, meshSpecular: .38, leafTransmission: .18, groundRoughnessScale: 1.4, barkRoughnessScale: 1.2, stoneRoughnessScale: .8 }) }),
});
export const SPATIAL_RENDER_FIELDS = Object.freeze(SPATIAL_RENDER_PARAMETER_SPECS.map(spec => spec.id));
export function createSpatialRenderingOptions(profile = 'artistic') {
    if (!['artistic', 'faithful'].includes(profile)) throw new TypeError('Unknown spatial render profile');
    return { ...Object.fromEntries(SPATIAL_RENDER_PARAMETER_SPECS.map(spec => [spec.id, spec.default])), renderProfile: profile };
}
export function normalizeSpatialRenderingOptions(raw = {}) {
    const result = {};
    for (const spec of SPATIAL_RENDER_PARAMETER_SPECS) {
        if (!Object.hasOwn(raw, spec.id)) continue;
        const value = raw[spec.id];
        if (spec.type === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max) throw new TypeError(`Invalid spatial ${spec.id}`);
        } else if (spec.type === 'color') {
            if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new TypeError(`Invalid spatial ${spec.id}`);
        } else if (spec.type === 'boolean') {
            if (typeof value !== 'boolean') throw new TypeError(`Invalid spatial ${spec.id}`);
        } else if (!spec.options.includes(value)) throw new TypeError(`Unsupported spatial ${spec.id}`);
        result[spec.id] = value;
    }
    if (result.renderVersion !== undefined && result.renderVersion !== 1) throw new TypeError('Unsupported spatial renderer version');
    if (Object.keys(result).some(key => key !== 'renderVersion') && result.renderVersion !== 1) throw new TypeError('Author renderVersion 1 before immersive renderer controls');
    if (result.visibilityBackend === 'gpu' && result.localVisibility === true) throw new TypeError('Tile-local ordering requires CPU visibility; GPU visibility uses stable global ordering');
    return result;
}
