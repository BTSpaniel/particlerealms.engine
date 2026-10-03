// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Canonical Particle Realms / WebGPU OS brand mark.
 *
 * This module intentionally has no imports. Any system surface can use the
 * complete animated mark through the shallow /webgpu-os/BrandMark.js module.
 *
 * The adjacent stylesheet is installed automatically when a consumer does not
 * already link it. Static browser/PWA surfaces use the matching assets under
 * webgpu-os/assets/.
 */

export const PARTICLE_REALMS_MARK_VERSION = 1;
export const PARTICLE_REALMS_MARK_DEFAULT_PROGRESS = 72;

const MARK_STYLE_ATTRIBUTE = 'data-particle-realms-mark-styles';
const MARK_SELECTOR = '[data-particle-realms-mark]';
const MARK_STAGE_WIDTH = 112;
const MARK_STAGE_HEIGHT = 104;
const MARK_OUTCOMES = new Set([
    'working',
    'initialized',
    'verified',
    'degraded',
    'complete',
    'failed',
]);

export const PARTICLE_REALMS_SPIRIT_VECTORS = Object.freeze([
    [-72, -31, -1.8, 2.9], [66, -37, -0.9, 3.2], [-86, 7, -2.4, 3.6], [82, 18, -1.3, 3.1],
    [-61, 52, -0.4, 3.4], [54, 59, -2.0, 2.8], [-28, -75, -1.1, 3.7], [19, -81, -2.7, 3.3],
    [-97, -48, -1.6, 4.0], [101, -16, -0.6, 3.5], [-102, 43, -2.2, 3.8], [95, 59, -1.0, 3.0],
    [-42, 88, -2.8, 4.1], [36, 93, -1.5, 3.6], [-118, 3, -0.8, 4.2], [116, 26, -2.5, 3.9],
    [-8, -103, -1.9, 3.4], [7, 108, -0.3, 4.0],
]);

export const PARTICLE_REALMS_CUBE_FACES = Object.freeze([
    'front',
    'back',
    'right',
    'left',
    'top',
    'bottom',
]);

/** Ensure the canonical stylesheet exists in the requested document. */
export function ensureParticleRealmsMarkStyles(documentValue = globalThis.document) {
    const documentObject = requireDocument(documentValue);
    const stylesheetUrl = new URL('./BrandMark.css', import.meta.url).href;
    const existing = documentObject.querySelector?.(`[${MARK_STYLE_ATTRIBUTE}]`)
        ?? [...(documentObject.querySelectorAll?.('link[rel="stylesheet"]') ?? [])]
            .find(link => {
                try { return new URL(link.href, documentObject.baseURI).href === stylesheetUrl; }
                catch { return false; }
            });
    if (existing) return existing;

    const link = documentObject.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheetUrl;
    link.setAttribute(MARK_STYLE_ATTRIBUTE, '');
    (documentObject.head ?? documentObject.documentElement)?.append(link);
    return link;
}

/** Create a fully initialized canonical mark. */
export function createParticleRealmsMark({
    documentValue = globalThis.document,
    size = MARK_STAGE_WIDTH,
    progress = PARTICLE_REALMS_MARK_DEFAULT_PROGRESS,
    outcome = 'working',
    animated = true,
    decorative = true,
    label = 'Particle Realms WebGPU OS',
    className = '',
} = {}) {
    const documentObject = requireDocument(documentValue);
    ensureParticleRealmsMarkStyles(documentObject);
    const mark = documentObject.createElement('span');
    mark.className = ['particle-realms-mark', className].filter(Boolean).join(' ');
    return hydrateParticleRealmsMark(mark, {
        size,
        progress,
        outcome,
        animated,
        decorative,
        label,
    });
}

/**
 * Mount the mark in a target without introducing another component wrapper.
 * Set `adopt` when the target itself is the semantic logo container.
 */
export function mountParticleRealmsMark(target, {
    documentValue = target?.ownerDocument ?? globalThis.document,
    adopt = false,
    replace = true,
    ...options
} = {}) {
    const documentObject = requireDocument(documentValue);
    const targetElement = typeof target === 'string'
        ? documentObject.querySelector(target)
        : target;
    if (!targetElement?.append) {
        throw new TypeError('Particle Realms mark target must be an Element or a matching selector');
    }
    if (adopt) {
        targetElement.classList.add('particle-realms-mark');
        return hydrateParticleRealmsMark(targetElement, options);
    }
    const mark = createParticleRealmsMark({ documentValue: documentObject, ...options });
    if (replace) targetElement.replaceChildren(mark);
    else targetElement.append(mark);
    return mark;
}

/** Rebuild an existing mark container without replacing its outer element. */
export function hydrateParticleRealmsMark(mark, {
    size = null,
    progress = PARTICLE_REALMS_MARK_DEFAULT_PROGRESS,
    outcome = 'working',
    animated = true,
    decorative = true,
    label = 'Particle Realms WebGPU OS',
} = {}) {
    if (!mark?.ownerDocument?.createElement) {
        throw new TypeError('Particle Realms mark must be a DOM Element');
    }
    ensureParticleRealmsMarkStyles(mark.ownerDocument);
    mark.classList.add('particle-realms-mark');
    mark.setAttribute('data-particle-realms-mark', '');
    mark.dataset.markVersion = String(PARTICLE_REALMS_MARK_VERSION);
    mark.dataset.markAnimated = animated ? 'true' : 'false';
    if (decorative) {
        mark.setAttribute('aria-hidden', 'true');
        mark.removeAttribute('role');
        mark.removeAttribute('aria-label');
    } else {
        mark.removeAttribute('aria-hidden');
        mark.setAttribute('role', 'img');
        mark.setAttribute('aria-label', normalizeLabel(label));
    }

    const stage = mark.ownerDocument.createElement('span');
    stage.className = 'particle-realms-mark__stage';
    stage.setAttribute('aria-hidden', 'true');
    const scene = mark.ownerDocument.createElement('span');
    scene.className = 'particle-realms-mark__scene';

    const aura = mark.ownerDocument.createElement('span');
    aura.className = 'particle-realms-mark__aura boot-aura';
    const orbit = mark.ownerDocument.createElement('span');
    orbit.className = 'particle-realms-mark__orbit boot-orbit';
    const spiritField = mark.ownerDocument.createElement('span');
    spiritField.className = 'particle-realms-mark__spirits boot-spirit-field';
    spiritField.append(...PARTICLE_REALMS_SPIRIT_VECTORS.map(([x, y, delay, duration], index) => {
        const spirit = mark.ownerDocument.createElement('i');
        spirit.className = 'particle-realms-mark__spirit boot-spirit';
        spirit.style.setProperty('--particle-realms-spirit-x', `${x}px`);
        spirit.style.setProperty('--particle-realms-spirit-y', `${y}px`);
        spirit.style.setProperty('--particle-realms-spirit-delay', `${delay}s`);
        spirit.style.setProperty('--particle-realms-spirit-duration', `${duration}s`);
        spirit.dataset.spirit = String(index + 1);
        return spirit;
    }));

    const core = mark.ownerDocument.createElement('span');
    core.className = 'particle-realms-mark__core boot-mark';
    const cube = mark.ownerDocument.createElement('span');
    cube.className = 'particle-realms-mark__cube boot-cube';
    cube.append(...PARTICLE_REALMS_CUBE_FACES.map(faceName => {
        const face = mark.ownerDocument.createElement('span');
        face.className = `particle-realms-mark__cube-face particle-realms-mark__cube-face--${faceName} `
            + `boot-cube-face boot-cube-face--${faceName}`;
        face.dataset.cubeFace = faceName;
        return face;
    }));
    core.append(cube);
    scene.append(aura, orbit, spiritField, core);
    stage.append(scene);
    mark.replaceChildren(stage);

    setParticleRealmsMarkSize(mark, size);
    setParticleRealmsMarkProgress(mark, progress, { outcome });
    return mark;
}

/** Scale the complete mark while preserving its designed 112:104 geometry. */
export function setParticleRealmsMarkSize(mark, size) {
    requireMark(mark);
    if (size == null || size === 'fit') {
        mark.style.removeProperty('width');
        mark.style.removeProperty('height');
        mark.style.removeProperty('--particle-realms-mark-scale');
        return mark;
    }
    const width = Number(size);
    if (!Number.isFinite(width) || width < 16 || width > 512) {
        throw new RangeError('Particle Realms mark size must be between 16 and 512 pixels');
    }
    mark.style.width = `${width}px`;
    mark.style.height = `${(width * MARK_STAGE_HEIGHT / MARK_STAGE_WIDTH).toFixed(4)}px`;
    mark.style.setProperty('--particle-realms-mark-scale', (width / MARK_STAGE_WIDTH).toFixed(6));
    return mark;
}

/** Drive particles, bloom, and cube energy from real bounded progress. */
export function setParticleRealmsMarkProgress(mark, progress, { outcome = mark?.dataset?.markOutcome ?? 'working' } = {}) {
    requireMark(mark);
    const state = particleRealmsMarkProgressState(progress);
    const normalizedOutcome = normalizeOutcome(outcome);
    for (const [property, value] of Object.entries(state.variables)) {
        mark.style.setProperty(property, value);
    }
    mark.dataset.markProgress = state.progress.toFixed(2);
    mark.dataset.markEnergy = String(state.level);
    mark.dataset.markOutcome = normalizedOutcome;
    mark.classList.toggle('is-complete', normalizedOutcome === 'complete');
    mark.classList.toggle('is-failed', normalizedOutcome === 'failed');
    const spirits = [...mark.querySelectorAll('.particle-realms-mark__spirit')];
    spirits.forEach((spirit, index) => spirit.classList.toggle('is-awake', index < state.awakeSpirits));
    return state;
}

/** Return the canonical visual state for a progress percentage. */
export function particleRealmsMarkProgressState(progress) {
    const boundedProgress = clamp(Number(progress), 0, 100, 'Particle Realms mark progress');
    const ratio = boundedProgress / 100;
    const energy = 0.16 + (ratio * 0.84);
    const bloom = 0.12 + (ratio * 0.88);
    const level = boundedProgress >= 100 ? 5
        : boundedProgress >= 90 ? 4
            : boundedProgress >= 65 ? 3
                : boundedProgress >= 40 ? 2
                    : boundedProgress >= 20 ? 1 : 0;
    const variables = Object.freeze({
        '--particle-realms-mark-energy': energy.toFixed(4),
        '--particle-realms-mark-bloom': bloom.toFixed(4),
        '--particle-realms-mark-aura-opacity': (0.13 + (bloom * 0.68)).toFixed(4),
        '--particle-realms-mark-aura-scale': (0.74 + (energy * 0.34)).toFixed(4),
        '--particle-realms-mark-orbit-opacity': (0.22 + (energy * 0.64)).toFixed(4),
        '--particle-realms-mark-spirit-mid-opacity': (0.14 + (energy * 0.42)).toFixed(4),
        '--particle-realms-mark-spirit-peak-opacity': (0.26 + (energy * 0.56)).toFixed(4),
        '--particle-realms-mark-reduced-spirit-opacity': (0.2 + (energy * 0.38)).toFixed(4),
        '--particle-realms-mark-core-halo-alpha': (0.18 + (bloom * 0.38)).toFixed(4),
        '--particle-realms-mark-core-bloom-alpha': (0.08 + (bloom * 0.2)).toFixed(4),
        '--particle-realms-mark-core-flare-alpha': (0.02 + (bloom * 0.06)).toFixed(4),
        '--particle-realms-mark-core-glow-alpha': (0.36 + (bloom * 0.46)).toFixed(4),
        '--particle-realms-mark-core-far-glow-alpha': (0.18 + (bloom * 0.32)).toFixed(4),
        '--particle-realms-mark-core-flare-glow-alpha': (0.04 + (bloom * 0.12)).toFixed(4),
        '--particle-realms-mark-core-scale': (0.78 + (energy * 0.28)).toFixed(4),
        '--particle-realms-mark-cube-face-alpha': (0.12 + (bloom * 0.2)).toFixed(4),
        '--particle-realms-mark-cube-edge-alpha': (0.48 + (energy * 0.42)).toFixed(4),
        '--particle-realms-mark-cube-shine-alpha': (0.1 + (bloom * 0.22)).toFixed(4),
        '--particle-realms-mark-cube-glow-alpha': (0.18 + (bloom * 0.44)).toFixed(4),
        '--particle-realms-mark-cube-scale': (0.84 + (energy * 0.16)).toFixed(4),
    });
    return Object.freeze({
        progress: boundedProgress,
        ratio,
        energy,
        bloom,
        level,
        awakeSpirits: Math.min(
            PARTICLE_REALMS_SPIRIT_VECTORS.length,
            4 + Math.floor(ratio * (PARTICLE_REALMS_SPIRIT_VECTORS.length - 4)),
        ),
        variables,
    });
}

/** Trigger the same bounded checkpoint ring used during startup. */
export function pulseParticleRealmsMark(mark, { duration = 720 } = {}) {
    requireMark(mark);
    mark.classList.remove('is-checkpoint');
    void mark.offsetWidth;
    mark.classList.add('is-checkpoint');
    const timeout = clamp(Number(duration), 120, 4_000, 'Particle Realms mark pulse duration');
    return globalThis.setTimeout?.(() => mark.classList.remove('is-checkpoint'), timeout) ?? 0;
}

export function isParticleRealmsMark(value) {
    return Boolean(value?.matches?.(MARK_SELECTOR));
}

function normalizeOutcome(outcome) {
    const value = String(outcome ?? 'working').trim().toLowerCase();
    if (!MARK_OUTCOMES.has(value)) {
        throw new TypeError(`Unsupported Particle Realms mark outcome: ${value || '(empty)'}`);
    }
    return value;
}

function normalizeLabel(value) {
    const label = String(value ?? '').trim();
    if (!label || label.length > 120) {
        throw new TypeError('Particle Realms mark label must contain 1 to 120 characters');
    }
    return label;
}

function clamp(value, minimum, maximum, label) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return Math.min(maximum, Math.max(minimum, value));
}

function requireDocument(documentValue) {
    if (!documentValue?.createElement) {
        throw new TypeError('Particle Realms mark requires a DOM document');
    }
    return documentValue;
}

function requireMark(mark) {
    if (!isParticleRealmsMark(mark)) {
        throw new TypeError('Expected a Particle Realms brand mark element');
    }
    return mark;
}
