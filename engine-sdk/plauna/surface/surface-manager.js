// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlaunaSurfaceManager - Manages GPU surfaces and rendering
 * Integrates with existing VGPU patterns
 */

let _surfaceSequence = 0;

const DEFAULT_SURFACE_BOUNDS = Object.freeze({
    x: 0,
    y: 0,
    width: 512,
    height: 512
});

const SURFACE_UPDATE_KEYS = new Set([
    'kind',
    'source',
    'shape',
    'warp',
    'interactive',
    'visible',
    'bounds',
    'dimensions',
    'x',
    'y',
    'width',
    'height',
    'zIndex',
    'zOrder',
    'cornerRadius',
    'borderRadius',
    'radius',
    'radiusX',
    'radiusY',
    'metadata'
]);

const _hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function _newSurfaceId(prefix) {
    return `${prefix}_${Date.now()}_${++_surfaceSequence}`;
}

function _isRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function _assertRecord(value, label) {
    if (!_isRecord(value)) {
        throw new TypeError(`${label} must be a plain object`);
    }
}

function _finiteNumber(value, label, minimum = -Infinity) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        const range = minimum === -Infinity ? 'finite' : `at least ${minimum}`;
        throw new RangeError(`${label} must be a ${range} number`);
    }
    return value;
}

function _firstOwn(source, keys) {
    if (!source) {
        return undefined;
    }

    for (const key of keys) {
        if (_hasOwn(source, key)) {
            return source[key];
        }
    }

    return undefined;
}

function _mergeBoundsSource(target, source, label, includePosition) {
    if (!source) {
        return;
    }

    if (includePosition) {
        const x = _firstOwn(source, ['x', 'left']);
        const y = _firstOwn(source, ['y', 'top']);
        if (x !== undefined) target.x = _finiteNumber(x, `${label}.x`);
        if (y !== undefined) target.y = _finiteNumber(y, `${label}.y`);
    }

    const width = _firstOwn(source, ['width', 'w']);
    const height = _firstOwn(source, ['height', 'h']);
    if (width !== undefined) target.width = _finiteNumber(width, `${label}.width`, Number.EPSILON);
    if (height !== undefined) target.height = _finiteNumber(height, `${label}.height`, Number.EPSILON);
}

function _resolveSurfaceBounds(input, fallback = DEFAULT_SURFACE_BOUNDS) {
    const bounds = { ...fallback };

    if (_hasOwn(input, 'dimensions')) {
        const dimensions = input.dimensions;
        if (Array.isArray(dimensions)) {
            if (dimensions.length < 2) {
                throw new RangeError('surface dimensions must contain width and height');
            }
            _mergeBoundsSource(bounds, { width: dimensions[0], height: dimensions[1] }, 'surface dimensions', false);
        } else {
            _assertRecord(dimensions, 'surface dimensions');
            _mergeBoundsSource(bounds, dimensions, 'surface dimensions', false);
        }
    }

    if (_hasOwn(input, 'bounds')) {
        _assertRecord(input.bounds, 'surface bounds');
        _mergeBoundsSource(bounds, input.bounds, 'surface bounds', true);
    }

    _mergeBoundsSource(bounds, input, 'surface', true);
    return bounds;
}

function _optionalMetric(value, label) {
    if (value === undefined || value === null) {
        return null;
    }
    return _finiteNumber(value, label, 0);
}

function _safeRecordCopy(value, label) {
    if (value === undefined || value === null) {
        return {};
    }

    _assertRecord(value, label);
    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
            throw new TypeError(`${label} contains a forbidden key: ${key}`);
        }
        copy[key] = entry;
    }
    return copy;
}

function _surfaceMetric(surface, keys) {
    const shape = _isRecord(surface.shape) ? surface.shape : null;
    for (const source of [surface, shape, surface.bounds]) {
        if (!source) {
            continue;
        }
        for (const key of keys) {
            if (!_hasOwn(source, key)) {
                continue;
            }
            const value = source[key];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                return value;
            }
        }
    }
    return null;
}

function _surfaceShape(surface) {
    const value = _isRecord(surface.shape) ? surface.shape.type : surface.shape;
    return String(value || 'rect').trim().toLowerCase();
}

function _surfaceZIndex(surface) {
    const value = surface.zIndex ?? surface.zOrder ?? 0;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function _pointHitsSurface(surface, x, y, bounds) {
    const localX = x - bounds.x;
    const localY = y - bounds.y;
    if (localX < 0 || localY < 0 || localX > bounds.width || localY > bounds.height) {
        return false;
    }

    switch (_surfaceShape(surface)) {
        case 'rect':
        case 'rectangle':
            return true;

        case 'rounded-rect':
        case 'rounded_rect':
        case 'roundedrect': {
            const requestedRadius = _surfaceMetric(surface, ['cornerRadius', 'borderRadius', 'radius']);
            const radius = Math.min(
                requestedRadius ?? Math.min(bounds.width, bounds.height) / 8,
                bounds.width / 2,
                bounds.height / 2
            );
            if (radius === 0) {
                return true;
            }

            const closestX = Math.max(radius, Math.min(bounds.width - radius, localX));
            const closestY = Math.max(radius, Math.min(bounds.height - radius, localY));
            const dx = localX - closestX;
            const dy = localY - closestY;
            return dx * dx + dy * dy <= radius * radius;
        }

        case 'circle': {
            const radius = Math.min(
                _surfaceMetric(surface, ['radius']) ?? Math.min(bounds.width, bounds.height) / 2,
                bounds.width / 2,
                bounds.height / 2
            );
            const dx = localX - bounds.width / 2;
            const dy = localY - bounds.height / 2;
            return dx * dx + dy * dy <= radius * radius;
        }

        case 'ellipse': {
            const radiusX = Math.min(
                _surfaceMetric(surface, ['radiusX', 'rx']) ?? bounds.width / 2,
                bounds.width / 2
            );
            const radiusY = Math.min(
                _surfaceMetric(surface, ['radiusY', 'ry']) ?? bounds.height / 2,
                bounds.height / 2
            );
            if (radiusX === 0 || radiusY === 0) {
                return false;
            }

            const dx = (localX - bounds.width / 2) / radiusX;
            const dy = (localY - bounds.height / 2) / radiusY;
            return dx * dx + dy * dy <= 1;
        }

        default:
            return false;
    }
}

function _destroySafely(resource, label) {
    if (!resource || typeof resource.destroy !== 'function') {
        return;
    }

    try {
        resource.destroy();
    } catch (error) {
        console.error(`[Plauna] Failed to destroy ${label}`, error);
    }
}

function _nextSurfaceState(surface, updates) {
    _assertRecord(updates, 'surface updates');

    for (const key of Object.keys(updates)) {
        if (!SURFACE_UPDATE_KEYS.has(key)) {
            throw new TypeError(`Surface property cannot be updated: ${key}`);
        }
    }

    const bounds = _resolveSurfaceBounds(updates, surface.bounds);
    const zIndexUpdate = _hasOwn(updates, 'zIndex') ? updates.zIndex : updates.zOrder;
    const nextZIndex = zIndexUpdate === undefined
        ? surface.zIndex
        : _finiteNumber(zIndexUpdate, 'surface zIndex');

    const nextMetadata = _hasOwn(updates, 'metadata')
        ? { ...surface.metadata, ..._safeRecordCopy(updates.metadata, 'surface metadata') }
        : surface.metadata;

    return {
        kind: _hasOwn(updates, 'kind') ? updates.kind : surface.kind,
        source: _hasOwn(updates, 'source') ? updates.source : surface.source,
        shape: _hasOwn(updates, 'shape') ? updates.shape : surface.shape,
        warp: _hasOwn(updates, 'warp') ? updates.warp : surface.warp,
        interactive: _hasOwn(updates, 'interactive') ? Boolean(updates.interactive) : surface.interactive,
        visible: _hasOwn(updates, 'visible') ? Boolean(updates.visible) : surface.visible,
        bounds,
        dimensions: { width: bounds.width, height: bounds.height },
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: nextZIndex,
        cornerRadius: _hasOwn(updates, 'cornerRadius')
            ? _optionalMetric(updates.cornerRadius, 'surface cornerRadius')
            : (_hasOwn(updates, 'borderRadius')
                ? _optionalMetric(updates.borderRadius, 'surface borderRadius')
                : surface.cornerRadius),
        radius: _hasOwn(updates, 'radius')
            ? _optionalMetric(updates.radius, 'surface radius')
            : surface.radius,
        radiusX: _hasOwn(updates, 'radiusX')
            ? _optionalMetric(updates.radiusX, 'surface radiusX')
            : surface.radiusX,
        radiusY: _hasOwn(updates, 'radiusY')
            ? _optionalMetric(updates.radiusY, 'surface radiusY')
            : surface.radiusY,
        metadata: nextMetadata
    };
}

export class PlaunaSurfaceManager {
    constructor(options = {}) {
        this.gpuBridge = options.gpuBridge;
        this.registry = options.registry;
        this.surfaces = new Map();
        this.renderers = new Map();
        this.initialized = false;
        this.destroying = false;
    }

    async initialize() {
        if (!this.gpuBridge) {
            console.log('[Plauna] Surface manager running in DOM-only mode');
            this.initialized = true;
            return;
        }

        console.log('[Plauna] Initializing surface manager...');
        this.initialized = true;
    }

    create(config) {
        if (!this.initialized) {
            throw new Error('Surface manager not initialized');
        }

        _assertRecord(config, 'surface config');
        if (_hasOwn(config, 'id') && config.id !== undefined && config.id !== null &&
            config.id !== '' && typeof config.id !== 'string') {
            throw new TypeError('Surface id must be a string');
        }

        const bounds = _resolveSurfaceBounds(config);
        const zIndexInput = _hasOwn(config, 'zIndex') ? config.zIndex : config.zOrder;
        const zIndex = zIndexInput === undefined ? 0 : _finiteNumber(zIndexInput, 'surface zIndex');
        const shapeConfig = _isRecord(config.shape) ? config.shape : null;

        const surface = {
            id: config.id || _newSurfaceId('surface'),
            kind: config.kind || 'viewport',
            source: config.source,
            shape: config.shape || 'rect',
            warp: config.warp || 'none',
            interactive: config.interactive !== false,
            visible: config.visible !== false,
            bounds,
            dimensions: { width: bounds.width, height: bounds.height },
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            zIndex,
            cornerRadius: _optionalMetric(
                config.cornerRadius ?? config.borderRadius ?? shapeConfig?.cornerRadius ?? config.bounds?.cornerRadius,
                'surface cornerRadius'
            ),
            radius: _optionalMetric(config.radius ?? shapeConfig?.radius, 'surface radius'),
            radiusX: _optionalMetric(config.radiusX ?? shapeConfig?.radiusX ?? shapeConfig?.rx, 'surface radiusX'),
            radiusY: _optionalMetric(config.radiusY ?? shapeConfig?.radiusY ?? shapeConfig?.ry, 'surface radiusY'),
            metadata: _safeRecordCopy(config.metadata, 'surface metadata'),
            resources: null,
            renderer: null,
            destroyed: false
        };

        while (!config.id && this.surfaces.has(surface.id)) {
            surface.id = _newSurfaceId('surface');
        }
        if (this.surfaces.has(surface.id)) {
            throw new Error(`Surface already exists: ${surface.id}`);
        }

        // Create GPU resources
        if (this.gpuBridge) {
            try {
                if (typeof this.gpuBridge.createSurfaceResources !== 'function') {
                    throw new TypeError('GPU bridge does not support surface resources');
                }
                surface.resources = this.gpuBridge.createSurfaceResources(surface);
                if (typeof this.gpuBridge.createSurfaceRenderer === 'function') {
                    surface.renderer = this.gpuBridge.createSurfaceRenderer(surface);
                }
            } catch (error) {
                if (surface.resources && typeof this.gpuBridge.destroySurfaceResources === 'function') {
                    try {
                        this.gpuBridge.destroySurfaceResources(surface);
                    } catch (cleanupError) {
                        console.error(`[Plauna] Failed to roll back surface resources: ${surface.id}`, cleanupError);
                    }
                }
                _destroySafely(surface.renderer, `surface renderer: ${surface.id}`);
                surface.resources = null;
                surface.renderer = null;
                throw error;
            }
        }

        this.surfaces.set(surface.id, surface);
        console.log(`[Plauna] Created surface: ${surface.id} (${surface.kind})`);
        
        return surface;
    }

    createRenderer(vgpu) {
        if (!vgpu) {
            throw new Error('VGPU instance required for surface renderer');
        }

        const renderer = new PlaunaSurfaceRenderer(vgpu, this);
        this.renderers.set(_newSurfaceId('renderer'), renderer);
        return renderer;
    }

    updateSurface(surfaceId, updates) {
        const surface = this.surfaces.get(surfaceId);
        if (!surface) {
            throw new Error(`Surface not found: ${surfaceId}`);
        }

        const nextState = _nextSurfaceState(surface, updates);
        let resources = surface.resources;

        // Stage resource work against the validated next state so a failed
        // update cannot leave the public descriptor half-mutated.
        if (this.gpuBridge && surface.resources &&
            typeof this.gpuBridge.updateSurfaceResources === 'function') {
            const updatedResources = this.gpuBridge.updateSurfaceResources({
                ...surface,
                ...nextState
            });
            if (updatedResources !== undefined && updatedResources !== null) {
                resources = updatedResources;
            }
        }

        for (const [key, value] of Object.entries(nextState)) {
            surface[key] = value;
        }
        surface.resources = resources;
        console.log(`[Plauna] Updated surface: ${surfaceId}`);
        return surface;
    }

    destroySurface(surfaceId) {
        const surface = this.surfaces.get(surfaceId);
        if (!surface) {
            return false;
        }

        // Remove ownership first so recursive or repeated teardown cannot
        // reach the same surface twice.
        this.surfaces.delete(surfaceId);
        surface.destroyed = true;
        surface.visible = false;
        surface.interactive = false;

        for (const renderer of this.renderers.values()) {
            try {
                if (typeof renderer.removeSurface === 'function') {
                    renderer.removeSurface(surface);
                }
            } catch (error) {
                console.error(`[Plauna] Failed to detach surface from renderer: ${surfaceId}`, error);
            }
        }

        // Destroy GPU resources
        if (this.gpuBridge && surface.resources) {
            try {
                this.gpuBridge.destroySurfaceResources(surface);
            } catch (error) {
                console.error(`[Plauna] Failed to destroy surface resources: ${surfaceId}`, error);
            }
        }
        surface.resources = null;

        // Destroy renderer
        const renderer = surface.renderer;
        surface.renderer = null;
        if (renderer) {
            this._releaseRenderer(renderer);
            _destroySafely(renderer, `surface renderer: ${surfaceId}`);
        }

        console.log(`[Plauna] Destroyed surface: ${surfaceId}`);
        return true;
    }

    getSurface(surfaceId) {
        return this.surfaces.get(surfaceId);
    }

    getAllSurfaces() {
        return Array.from(this.surfaces.values());
    }

    setVisible(surfaceId, visible) {
        return this.updateSurface(surfaceId, { visible });
    }

    setInteractive(surfaceId, interactive) {
        return this.updateSurface(surfaceId, { interactive });
    }

    hitTest(surfaceIdOrX, xOrY, optionalY) {
        const targeted = arguments.length >= 3 && surfaceIdOrX !== null && surfaceIdOrX !== undefined;
        const x = arguments.length >= 3 ? xOrY : surfaceIdOrX;
        const y = arguments.length >= 3 ? optionalY : xOrY;
        if (typeof x !== 'number' || !Number.isFinite(x) ||
            typeof y !== 'number' || !Number.isFinite(y)) {
            return null;
        }

        if (targeted) {
            return this._hitSurface(this.surfaces.get(surfaceIdOrX), x, y);
        }

        let topHit = null;
        let topZIndex = -Infinity;
        for (const surface of this.surfaces.values()) {
            const hit = this._hitSurface(surface, x, y);
            if (!hit) {
                continue;
            }

            const zIndex = _surfaceZIndex(surface);
            if (!topHit || zIndex >= topZIndex) {
                topHit = hit;
                topZIndex = zIndex;
            }
        }

        return topHit;
    }

    _hitSurface(surface, x, y) {
        if (!surface || surface.destroyed || !surface.visible || !surface.interactive) {
            return null;
        }

        const bounds = this.getSurfaceBounds(surface);
        if (!_pointHitsSurface(surface, x, y, bounds)) {
            return null;
        }

        return { surface, point: { x: x - bounds.x, y: y - bounds.y } };
    }

    getSurfaceBounds(surface) {
        const resolvedSurface = typeof surface === 'string' ? this.surfaces.get(surface) : surface;
        if (!resolvedSurface) {
            throw new Error('Surface is required to resolve bounds');
        }
        return _resolveSurfaceBounds(resolvedSurface);
    }

    _releaseRenderer(renderer) {
        for (const [rendererId, registeredRenderer] of this.renderers) {
            if (registeredRenderer === renderer) {
                this.renderers.delete(rendererId);
            }
        }
    }

    destroy() {
        if (this.destroying ||
            (!this.initialized && this.surfaces.size === 0 && this.renderers.size === 0)) {
            return;
        }
        this.destroying = true;
        this.initialized = false;
        console.log('[Plauna] Destroying surface manager...');

        try {
            // Snapshot IDs because destroySurface mutates the map.
            for (const surfaceId of [...this.surfaces.keys()]) {
                this.destroySurface(surfaceId);
            }

            // Clear manager ownership before invoking renderer callbacks so
            // renderer-side deregistration remains harmless and idempotent.
            const renderers = new Set(this.renderers.values());
            this.renderers.clear();
            for (const renderer of renderers) {
                _destroySafely(renderer, 'surface renderer');
            }
        } finally {
            this.destroying = false;
        }
    }
}

/**
 * PlaunaSurfaceRenderer - Renders surfaces using VGPU
 */
class PlaunaSurfaceRenderer {
    constructor(vgpu, surfaceManager) {
        this.vgpu = vgpu;
        this.surfaceManager = surfaceManager;
        this.surfaces = [];
        this.pipeline = null;
        this.bindGroup = null;
        this.sampler = null;
        this.initialized = false;
        this.destroyed = false;
    }

    async initialize() {
        if (this.destroyed) {
            throw new Error('Surface renderer has been destroyed');
        }
        if (this.initialized) {
            return;
        }

        console.log('[Plauna] Initializing surface renderer...');

        try {
            // Create rendering pipeline
            await this.createPipeline();
            this.initialized = true;
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    async createPipeline() {
        // Create simple quad rendering pipeline
        const vertexShader = `
            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) uv: vec2f,
            }
            
            @vertex
            fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var output: VertexOutput;
                
                // Fullscreen triangle
                let positions = array<vec2f, 3>(
                    vec2f(-1.0, -1.0),
                    vec2f(3.0, -1.0),
                    vec2f(-1.0, 3.0)
                );
                let uvs = array<vec2f, 3>(
                    vec2f(0.0, 1.0),
                    vec2f(2.0, 1.0),
                    vec2f(0.0, -1.0)
                );
                
                output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
                output.uv = uvs[vertexIndex];
                
                return output;
            }
        `;

        const fragmentShader = `
            @group(0) @binding(0) var textureSampler: sampler;
            @group(0) @binding(1) var surfaceTexture: texture_external;
            
            @fragment
            fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
                return textureSampleBaseClampToEdge(surfaceTexture, textureSampler, uv);
            }
        `;

        // Create pipeline using VGPU
        this.pipeline = this.vgpu.pipeline.render({
            vertex: vertexShader,
            fragment: fragmentShader,
            targets: [{ format: 'bgra8unorm' }],
            primitive: { topology: 'triangle-list' }
        });

        // Create bind group layout
        const bindGroupLayout = this.vgpu.bindings.defineLayout('surface', [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, type: 'sampler' },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, type: 'external_texture' }
        ]);

        // Create sampler
        this.sampler = this.vgpu.sampler.create({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp',
            addressModeV: 'clamp'
        });

        // Create bind group
        this.bindGroup = this.vgpu.bindings.create(bindGroupLayout, [
            this.sampler,
            null // Surface texture will be bound per surface
        ]);
    }

    addSurface(surface) {
        if (this.destroyed) {
            throw new Error('Surface renderer has been destroyed');
        }
        if (!this.initialized) {
            throw new Error('Renderer not initialized');
        }

        if (!this.surfaces.includes(surface)) {
            this.surfaces.push(surface);
        }
        return surface;
    }

    removeSurface(surface) {
        this.surfaces = this.surfaces.filter(candidate => candidate !== surface);
    }

    render(passEncoder, viewport) {
        if (!this.initialized || this.surfaces.length === 0) {
            return;
        }

        // Set pipeline and bind group
        passEncoder.setPipeline(this.pipeline.gpuPipeline);
        passEncoder.setBindGroup(0, this.bindGroup.gpuBindGroup);

        // Draw lower z-index surfaces first so input and presentation agree on
        // which overlapping surface is topmost.
        const orderedSurfaces = this.surfaces
            .map((surface, index) => ({ surface, index }))
            .sort((a, b) => _surfaceZIndex(a.surface) - _surfaceZIndex(b.surface) || a.index - b.index);

        // Render each surface
        for (const { surface } of orderedSurfaces) {
            if (!surface.visible || !surface.resources) {
                continue;
            }

            // Update bind group with surface texture
            // TODO: Implement per-surface texture binding
            
            // Set viewport for surface
            const bounds = this.surfaceManager.getSurfaceBounds(surface);
            passEncoder.setViewport(
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                0.0,
                1.0
            );

            // Draw surface
            passEncoder.draw(3); // Fullscreen triangle
        }
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.initialized = false;
        this.surfaceManager?._releaseRenderer(this);
        console.log('[Plauna] Destroying surface renderer...');

        // Clear references before invoking callbacks so reentrant cleanup is safe.
        const pipeline = this.pipeline;
        const bindGroup = this.bindGroup;
        const sampler = this.sampler;
        this.pipeline = null;
        this.bindGroup = null;
        this.sampler = null;

        _destroySafely(bindGroup, 'surface renderer bind group');
        _destroySafely(pipeline, 'surface renderer pipeline');
        _destroySafely(sampler, 'surface renderer sampler');

        this.surfaces = [];
        this.surfaceManager = null;
        this.vgpu = null;
    }
}
