// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AMBIENT_WALLPAPER_V2_CATALOG, AMBIENT_WALLPAPER_COLLECTION_PRESETS, createAmbientWallpaperV2Project } from './AmbientWallpaperV2Catalog.js';
import { AMBIENT_SPATIAL_PRESETS, createAmbientSpatialProject } from './AmbientSpatialProject.js';
import { normalizeAmbientProjectV2 } from './AmbientProjectV2.js';
import { createAmbientClassicProject } from './AmbientClassicProject.js';
import { createAmbientParticlePresetProject, normalizeAmbientParticleProject } from './AmbientParticleProject.js';
import { createAmbientShaderWorkbenchProject } from './AmbientShaderWorkbench.js';

/** Captured production plans and the exact preview assets shipped with this collection. */
export const AMBIENT_COLLECTION_PREVIEW_MANIFEST = new URL('./assets/collection/rendered/manifest.json', import.meta.url).href;

const FEATURED = Object.freeze(['pearlescent-silk', 'aurora-glass', 'liquid-metal', 'mineral-ink', 'moonlit-water', 'rainlit-study', 'sky-garden', 'orbital-observatory', 'ocean-daylight']);
const CLASSICS = [
    ['nebula', 'Nebula', ['#070919', '#504c91']], ['mesh', 'Mesh', ['#07141b', '#257b89']],
    ['gradient', 'Gradient', ['#17172b', '#50477c']], ['aurora', 'Aurora', ['#06191d', '#308b80']],
    ['solid', 'Dark', ['#090d15', '#090d15']], ['abyss', 'Abyss', ['#01040a', '#143540']],
    ['webgpu', 'Live 3D World', ['#07090f', '#25a8a2']],
];
const spatialDescriptions = {
    'spatial-vista': 'A Gaussian surface template with depth, orbit controls and bounded ripple interaction.',
    'spatial-flow': 'Source-textured Gaussians move through a current while staying attached to their original structure.',
    'spatial-shatter': 'Scatter source fragments in three dimensions and restore their canonical positions.',
    'spatial-echo': 'A spatial template for source-frame cohorts and velocity-shaped Gaussian trails.',
    'spatial-fabric': 'A depth-aware surface whose nearby structure responds together to a local grab.',
    'spatial-cloud': 'Explore procedural Gaussian geometry or import a supported Gaussian scene asset.',
    'spatial-forest': 'Walk into a metre-scale forest with complete branch and foliage geometry, wind, eroded ground and an editable eye-level camera route.',
    'media-flow': 'Import an image or video and stir its textured surface into a bounded particle flow.',
    'media-shatter': 'Import media, scatter its attached fragments and let the source image rebuild.',
    'media-echo': 'Import video and explore temporal source-frame cohorts with a controlled trailing response.',
    'media-fabric': 'Import media and stretch a local patch of its attached particle surface.',
};

const nativeEntries = [...AMBIENT_WALLPAPER_V2_CATALOG, ...AMBIENT_WALLPAPER_COLLECTION_PRESETS].map(preset => {
    const sourceId = preset.collectionCategory ? (preset.sourceId ?? preset.id) : null;
    const colors = preset.palette.colors ?? [preset.palette.background, preset.palette.accentExample];
    return catalogEntry({ id: preset.id, label: preset.name, category: preset.collectionCategory ?? (preset.family === 'sci-fi' ? 'Cosmic' : 'Signature'), kind: preset.runtimeRecipeId ? 'variant' : 'preset',
        description: preset.logline ?? preset.description, tags: preset.capabilities, featured: FEATURED.includes(preset.id), sourceId, runtime: 'ambient-v3',
        runtimeRecipeId: preset.runtimeRecipeId ?? preset.id, palette: colors, capabilities: preset.capabilities, performance: preset.performance.arithmeticTier,
        thumbnail: thumbnail(preset.id),
    });
});
const spatialEntries = AMBIENT_SPATIAL_PRESETS.map(preset => catalogEntry({
    id: preset.id, label: preset.name, category: preset.id.startsWith('media-') ? 'Media templates' : 'Spatial templates', kind: 'template',
    description: spatialDescriptions[preset.id], tags: preset.id === 'spatial-forest' ? ['forest', 'terrain', 'trees', 'wind', 'generated', '3d'] : ['depth', 'interactive', 'import'], featured: false, sourceId: preset.id,
    runtime: 'spatial', mode: preset.mode, capabilities: preset.id === 'spatial-forest' ? ['depth', 'pointer', 'camera-3d', 'terrain', 'trees', 'wind'] : ['depth', 'pointer', 'camera-3d', 'media'],
    palette: preset.id === 'spatial-forest' ? ['#293d31', '#47613b', '#829d96', '#b7b9a1'] : ['#122b35', '#3e9398', '#e3b85b', '#fff1c4'], thumbnail: thumbnail(preset.id),
}));
const classicEntries = CLASSICS.map(([id, label, palette]) => catalogEntry({ id, label, category: 'Classics', kind: 'classic',
    description: id === 'webgpu' ? 'The original native compute-driven particle world.' : 'The existing desktop wallpaper, with its original identity and behavior.',
    tags: id === 'webgpu' ? ['particles', 'interactive'] : ['classic'], featured: false, sourceId: id === 'webgpu' ? null : id,
    runtime: 'classic', palette, thumbnail: thumbnail(id), capabilities: id === 'webgpu' ? ['particles', 'pointer'] : [],
}));
const templates = [
    catalogEntry({ id: 'custom-shader', label: 'Shader workbench', category: 'Authoring', kind: 'template', description: 'Start with an executable native WGSL sky and edit its shader in the existing code workspace.', tags: ['WGSL', 'authoring'], featured: false, sourceId: 'custom-shader', runtime: 'shader', palette: ['#060a18', '#6989ff', '#45dfc5', '#e9ccff'], capabilities: ['shader'], thumbnail: thumbnail('custom-shader') }),
    catalogEntry({ id: 'image-studio', label: 'Your artwork', category: 'Your artwork', kind: 'template', description: 'Import your image or video, then add source-preserving depth and bounded surface motion.', tags: ['import', 'depth', 'media'], featured: false, sourceId: 'image-studio', runtime: 'spatial', mode: 'ripple', palette: ['#131e2d', '#8faebd', '#e8cda2', '#e6ece9'], capabilities: ['depth', 'pointer', 'camera-3d', 'media'], thumbnail: thumbnail('image-studio') }),
];

const ENTRIES = deepFreeze([...nativeEntries, ...spatialEntries, ...templates, ...classicEntries]);
const BY_ID = new Map(ENTRIES.map(entry => [entry.id, entry]));

/** One immutable source of truth for the desktop chooser and authoring library. */
export function getAmbientCollectionEntries() { return ENTRIES; }

/** Every library identity has an editable project; ThemeEngine retains direct classic activation. */
export function createAmbientCollectionProject(id, options = {}) {
    const entry = BY_ID.get(String(id ?? '').trim().toLowerCase());
    if (!entry) throw new RangeError(`Unknown Ambient collection entry '${String(id ?? '')}'.`);
    if (entry.id === 'webgpu') {
        const project = createAmbientParticlePresetProject('live-3d-world');
        const background = options.backgroundColor ?? '#04060e';
        return normalizeAmbientParticleProject({ ...project,
            graph: { ...project.graph, nodes: project.graph.nodes.map(node => node.type === 'renderer.substances' ? { ...node, params: { ...node.params, clearColor: background } } : node) },
            accessibility: { ...project.accessibility, staticFallback: { ...project.accessibility.staticFallback, color: background } },
            metadata: { ...project.metadata, id: options.projectId ?? entry.id, name: options.name ?? entry.label, description: options.description ?? entry.description },
        });
    }
    if (entry.kind === 'classic') return createAmbientClassicProject(entry.id, { ...options, name: options.name ?? entry.label, description: options.description ?? entry.description });
    if (entry.runtime === 'shader') {
        return createAmbientShaderWorkbenchProject({ ...options, projectId: options.projectId ?? entry.id, name: options.name ?? entry.label, description: options.description ?? entry.description });
    }
    const project = entry.runtime === 'spatial'
        ? createAmbientSpatialProject(entry.id, { ...options, name: options.name ?? entry.label, description: options.description ?? entry.description, settings: { mode: entry.mode, ...options.settings } })
        : createAmbientWallpaperV2Project(entry.id, options);
    return normalizeAmbientProjectV2({ ...project, extensions: { ...project.extensions, ambientCollection: { version: 1, entryId: entry.id, sourceId: entry.sourceId, kind: entry.kind } } });
}

/** The source namespace is deliberately separate from existing native IDs. */
export function ambientCollectionIdForLegacyWorld(sourceId) {
    return ENTRIES.find(entry => entry.sourceId === String(sourceId ?? ''))?.id ?? null;
}

function thumbnail(id) { return new URL(`./assets/collection/rendered/${id}.jpg`, import.meta.url).href; }
function catalogEntry(value) { return { ...value, preview: `linear-gradient(145deg, ${value.palette[0]}, ${value.palette[1] ?? value.palette[0]})` }; }
function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}
