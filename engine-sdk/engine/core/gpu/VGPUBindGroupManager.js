// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Automatic Bind Group Manager - Material system that auto-generates bind groups from shader
 */

import { getShaderReflection } from './VGPUShaderReflection.js';
import { legacyStringHash32 } from '../math/ChecksumMath.js';

function lifecycleError(scope, operation) {
    const error = new Error(`${scope} is destroyed; cannot ${operation}`);
    error.code = 'VGPU_BIND_GROUP_MANAGER_DESTROYED';
    return error;
}

function destroyBuffer(buffer) {
    if (!buffer) return;
    let destroy = null;
    try { destroy = buffer.destroy; } catch (_) { return; }
    if (typeof destroy !== 'function') return;
    try { Reflect.apply(destroy, buffer, []); } catch (_) {}
}

export class VGPUBindGroupManager {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        this.reflection = getShaderReflection();

        this._layouts = new Map();
        this._bindGroups = new Map();
        this._materials = new Map();
        this._destroyed = false;
        this._generation = 0;
    }

    _assertActive(operation = 'perform work') {
        if (this._destroyed || !this.device || !this.reflection) {
            throw lifecycleError('Bind group manager', operation);
        }
        return this._generation;
    }

    _isGeneration(generation) {
        return !this._destroyed && generation === this._generation;
    }

    _assertGeneration(generation, operation) {
        if (!this._isGeneration(generation)) {
            throw lifecycleError('Bind group manager', operation);
        }
    }

    _readExternalMember(receiver, key, assertCurrent, operation) {
        assertCurrent();
        let value;
        try {
            value = receiver?.[key];
        } finally {
            assertCurrent();
        }
        return value;
    }

    _captureExternalCallable(receiver, key, assertCurrent, operation) {
        const callable = this._readExternalMember(receiver, key, assertCurrent, operation);
        if (typeof callable !== 'function') {
            throw new TypeError(`[BindGroupManager] ${String(key)} is not callable`);
        }
        assertCurrent();
        return { receiver, callable };
    }

    _silenceExternalPromise(value) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
        try {
            Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]);
        } catch (_) {}
    }

    _invokeCapturedExternal(captured, args, assertCurrent, operation, retireResult = null) {
        assertCurrent();
        let result;
        let callError = null;
        try {
            result = Reflect.apply(captured.callable, captured.receiver, args);
        } catch (error) {
            callError = error;
        }
        try {
            assertCurrent();
        } catch (error) {
            this._silenceExternalPromise(result);
            if (retireResult && result) {
                try { retireResult(result); } catch (_) {}
            }
            throw error;
        }
        if (callError) throw callError;
        return result;
    }

    _callExternal(receiver, key, args, assertCurrent, operation, retireResult = null) {
        const captured = this._captureExternalCallable(receiver, key, assertCurrent, operation);
        return this._invokeCapturedExternal(
            captured, args, assertCurrent, operation, retireResult,
        );
    }

    _snapshotString(value, assertCurrent, operation) {
        let normalized;
        try {
            normalized = String(value);
        } finally {
            assertCurrent();
        }
        return normalized;
    }

    _snapshotNumber(value, assertCurrent, operation) {
        let normalized;
        try {
            normalized = Number(value);
        } finally {
            assertCurrent();
        }
        return normalized;
    }

    _snapshotIterable(iterable, assertCurrent, operation) {
        const iteratorFactory = this._captureExternalCallable(
            iterable, Symbol.iterator, assertCurrent, `${operation} iterator`,
        );
        const iterator = this._invokeCapturedExternal(
            iteratorFactory, [], assertCurrent, `${operation} iterator`,
        );
        const next = this._captureExternalCallable(
            iterator, 'next', assertCurrent, `${operation} next`,
        );
        const values = [];
        while (true) {
            const step = this._invokeCapturedExternal(
                next, [], assertCurrent, `${operation} next`,
            );
            const done = this._readExternalMember(
                step, 'done', assertCurrent, `${operation} done`,
            );
            if (done) break;
            values.push(this._readExternalMember(
                step, 'value', assertCurrent, `${operation} value`,
            ));
        }
        return values;
    }

    _snapshotRecord(record, assertCurrent, operation, deep = false) {
        if (record === null || (typeof record !== 'object' && typeof record !== 'function')) {
            return record;
        }
        let keys;
        try {
            keys = Object.keys(record);
        } finally {
            assertCurrent();
        }
        const snapshot = {};
        for (const key of keys) {
            const value = this._readExternalMember(
                record, key, assertCurrent, `${operation}.${key}`,
            );
            snapshot[key] = deep ? this._snapshotDescriptorValue(
                value, assertCurrent, `${operation}.${key}`,
            ) : value;
        }
        return snapshot;
    }

    _snapshotDescriptorValue(value, assertCurrent, operation) {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
            return value;
        }
        if (Array.isArray(value)) {
            const items = this._snapshotIterable(value, assertCurrent, operation);
            return items.map((item, index) => this._snapshotDescriptorValue(
                item, assertCurrent, `${operation}[${index}]`,
            ));
        }
        return this._snapshotRecord(value, assertCurrent, operation, true);
    }

    createLayoutFromShader(layoutId, shaderSource, group = 0) {
        const generation = this._assertActive('create a bind group layout');
        const assertCurrent = () => this._assertGeneration(generation, 'create a bind group layout');
        const normalizedLayoutId = this._snapshotString(
            layoutId, assertCurrent, 'normalize a layout identifier',
        );
        const normalizedShaderSource = this._snapshotString(
            shaderSource, assertCurrent, 'normalize shader source',
        );
        const normalizedGroup = this._snapshotNumber(group, assertCurrent, 'normalize bind group index');
        if (this._layouts.has(normalizedLayoutId)) return this._layouts.get(normalizedLayoutId);

        const rawEntries = this._callExternal(
            this.reflection, 'getBindGroupLayoutEntries',
            [normalizedShaderSource, normalizedGroup], assertCurrent,
            'reflect bind group layout entries',
        );
        const entries = this._snapshotDescriptorValue(
            rawEntries, assertCurrent, 'snapshot bind group layout entries',
        );
        const layout = this._callExternal(
            this.device, 'createBindGroupLayout',
            [{ entries, label: normalizedLayoutId }], assertCurrent,
            'create a bind group layout',
        );
        this._assertGeneration(generation, 'publish a bind group layout');

        if (this._layouts.has(normalizedLayoutId)) return this._layouts.get(normalizedLayoutId);
        this._layouts.set(normalizedLayoutId, layout);
        return layout;
    }

    createBindGroupFromShader(shaderSource, resources, group = 0) {
        const generation = this._assertActive('create a bind group');
        const assertCurrent = () => this._assertGeneration(generation, 'create a bind group');
        const normalizedShaderSource = this._snapshotString(
            shaderSource, assertCurrent, 'normalize shader source',
        );
        const normalizedGroup = this._snapshotNumber(group, assertCurrent, 'normalize bind group index');
        const reflection = this._callExternal(
            this.reflection, 'reflect', [normalizedShaderSource], assertCurrent,
            'reflect bind group shader',
        );
        const rawBindings = this._readExternalMember(
            reflection, 'bindings', assertCurrent, 'read reflected bindings',
        );
        const bindings = this._snapshotIterable(
            rawBindings, assertCurrent, 'snapshot reflected bindings',
        ).filter(binding => {
            const bindingGroup = this._readExternalMember(
                binding, 'group', assertCurrent, 'read reflected binding group',
            );
            return bindingGroup === normalizedGroup;
        });

        const entries = [];
        for (const binding of bindings) {
            const bindingName = this._snapshotString(
                this._readExternalMember(binding, 'name', assertCurrent, 'read binding name'),
                assertCurrent, 'normalize binding name',
            );
            const bindingIndex = this._snapshotNumber(
                this._readExternalMember(binding, 'binding', assertCurrent, 'read binding index'),
                assertCurrent, 'normalize binding index',
            );
            const resource = this._readExternalMember(
                resources, bindingName, assertCurrent, 'read a bind group resource',
            );
            if (!resource) {
                console.warn(`[BindGroupManager] Missing resource for binding: ${bindingName}`);
                continue;
            }
            entries.push({
                binding: bindingIndex,
                resource: this._resolveResource(resource, binding, generation),
            });
        }

        const layoutId = `auto_${this._hashSource(normalizedShaderSource)}_g${normalizedGroup}`;
        const layout = Reflect.apply(VGPUBindGroupManager.prototype.createLayoutFromShader, this, [
            layoutId, normalizedShaderSource, normalizedGroup,
        ]);
        this._assertGeneration(generation, 'create a bind group');
        const bindGroup = this._callExternal(this.device, 'createBindGroup', [{
            layout,
            entries,
            label: `BindGroup_${layoutId}`,
        }], assertCurrent, 'create a bind group');
        return bindGroup;
    }

    createMaterial(name, shaderSource, defaults = {}) {
        const generation = this._assertActive('create a material');
        const assertCurrent = () => this._assertGeneration(generation, 'create a material');
        const normalizedName = this._snapshotString(
            name, assertCurrent, 'normalize a material name',
        );
        const normalizedShaderSource = this._snapshotString(
            shaderSource, assertCurrent, 'normalize material shader source',
        );
        const defaultsSnapshot = this._snapshotRecord(
            defaults ?? {}, assertCurrent, 'snapshot material defaults',
        );
        if (this._materials.has(normalizedName)) return this._materials.get(normalizedName);

        const reflection = this._callExternal(
            this.reflection, 'reflect', [normalizedShaderSource], assertCurrent,
            'reflect material shader',
        );
        if (this._materials.has(normalizedName)) return this._materials.get(normalizedName);

        let material = null;
        try {
            material = new Material(
                this,
                normalizedName,
                normalizedShaderSource,
                reflection,
                defaultsSnapshot,
                generation,
            );
            this._assertGeneration(generation, 'publish a material');
            if (this._materials.has(normalizedName)) {
                material._destroyFromParent();
                return this._materials.get(normalizedName);
            }
            this._materials.set(normalizedName, material);
            return material;
        } catch (error) {
            material?._destroyFromParent();
            throw error;
        }
    }

    getMaterial(name) {
        if (this._destroyed || !this._materials) return undefined;
        return this._materials.get(name);
    }

    createMaterialInstance(materialName, instanceResources = {}) {
        const generation = this._assertActive('create a material instance');
        const assertCurrent = () => this._assertGeneration(generation, 'create a material instance');
        const normalizedName = this._snapshotString(
            materialName, assertCurrent, 'normalize a material name',
        );
        const material = this._materials.get(normalizedName);
        if (!material) throw new Error(`Material not found: ${normalizedName}`);
        return Reflect.apply(Material.prototype.createInstance, material, [instanceResources]);
    }

    _resolveResource(resource, _binding, generation) {
        const assertCurrent = () => this._assertGeneration(
            generation, 'resolve a bind group resource',
        );
        const buffer = this._readExternalMember(
            resource, 'buffer', assertCurrent, 'read a bind group buffer resource',
        );
        if (buffer) {
            const offset = this._readExternalMember(
                resource, 'offset', assertCurrent, 'read a bind group buffer offset',
            );
            const size = this._readExternalMember(
                resource, 'size', assertCurrent, 'read a bind group buffer size',
            );
            const resolved = {
                buffer,
                offset: offset || 0,
                size,
            };
            this._assertGeneration(generation, 'resolve a bind group resource');
            return resolved;
        }
        if (typeof GPUBuffer !== 'undefined' && resource instanceof GPUBuffer) {
            return { buffer: resource };
        }
        if (typeof GPUTextureView !== 'undefined' && resource instanceof GPUTextureView) {
            assertCurrent();
            return resource;
        }
        if (typeof GPUTexture !== 'undefined' && resource instanceof GPUTexture) {
            assertCurrent();
            return this._callExternal(
                resource, 'createView', [], assertCurrent, 'resolve a texture view',
            );
        }
        if (typeof GPUSampler !== 'undefined' && resource instanceof GPUSampler) {
            assertCurrent();
            return resource;
        }
        this._assertGeneration(generation, 'resolve a bind group resource');
        return resource;
    }

    _hashSource(source) {
        return Math.abs(legacyStringHash32(source.slice(0, 500))).toString(36);
    }

    clear() {
        this._assertActive('clear caches');
        this._layouts.clear();
        this._bindGroups.clear();
        return true;
    }

    _releaseMaterial(material) {
        if (this._materials?.get(material.name) === material) {
            this._materials.delete(material.name);
        }
    }

    destroy() {
        if (this._destroyed) return false;
        const materials = this._materials ? Array.from(this._materials.values()) : [];

        this._destroyed = true;
        this._generation++;
        this._layouts?.clear();
        this._bindGroups?.clear();
        this._materials?.clear();
        this._layouts = null;
        this._bindGroups = null;
        this._materials = null;
        this.reflection = null;
        this.device = null;
        this.vgpu = null;

        for (const material of materials) material._destroyFromParent();
        return true;
    }

    dispose() {
        return this.destroy();
    }
}

class Material {
    constructor(manager, name, shaderSource, reflection, defaults, managerGeneration) {
        this.manager = manager;
        this.name = name;
        this.shaderSource = shaderSource;
        this.reflection = reflection;
        this.defaults = defaults;
        this._managerGeneration = managerGeneration;
        this._generation = 0;
        this._destroyed = false;
        this._layouts = new Map();
        this._uniformBuffers = new Map();
        this._uniformData = new Map();
        this._instances = new Set();

        try {
            this._init();
        } catch (error) {
            this._destroyFromParent();
            throw error;
        }
    }

    _assertActive(operation = 'perform material work') {
        const manager = this.manager;
        if (
            this._destroyed
            || !manager
            || !manager._isGeneration(this._managerGeneration)
        ) {
            throw lifecycleError(`Material ${this.name ?? '<released>'}`, operation);
        }
        return this._generation;
    }

    _isGeneration(generation) {
        if (this._destroyed || generation !== this._generation) return false;
        const manager = this.manager;
        return Boolean(manager && manager._isGeneration(this._managerGeneration));
    }

    _assertGeneration(generation, operation) {
        if (!this._isGeneration(generation)) {
            throw lifecycleError(`Material ${this.name ?? '<released>'}`, operation);
        }
    }

    _init() {
        const generation = this._assertActive('initialize');
        const manager = this.manager;
        const assertCurrent = () => this._assertGeneration(generation, 'initialize material');
        const rawGroups = manager._callExternal(
            manager.reflection, 'getBindGroups', [this.shaderSource], assertCurrent,
            'reflect material bind groups',
        );
        const groups = manager._snapshotIterable(
            rawGroups, assertCurrent, 'snapshot material bind groups',
        );
        for (const groupEntry of groups) {
            const groupIndex = manager._snapshotNumber(
                manager._readExternalMember(
                    groupEntry, 0, assertCurrent, 'read a material bind group index',
                ),
                assertCurrent,
                'normalize a material bind group index',
            );
            const layoutId = `${this.name}_g${groupIndex}`;
            const layout = Reflect.apply(
                VGPUBindGroupManager.prototype.createLayoutFromShader,
                manager,
                [layoutId, this.shaderSource, groupIndex],
            );
            this._assertGeneration(generation, 'publish a material layout');
            this._layouts.set(groupIndex, layout);
        }

        const rawBindings = manager._readExternalMember(
            this.reflection, 'bindings', assertCurrent, 'read material bindings',
        );
        const bindings = manager._snapshotIterable(
            rawBindings, assertCurrent, 'snapshot material bindings',
        );
        const rawStructs = manager._readExternalMember(
            this.reflection, 'structs', assertCurrent, 'read material structs',
        );
        const structs = manager._snapshotIterable(
            rawStructs, assertCurrent, 'snapshot material structs',
        );
        for (const binding of bindings) {
            const kind = manager._readExternalMember(
                binding, 'kind', assertCurrent, 'read material binding kind',
            );
            if (kind !== 'uniform') continue;
            const bindingType = manager._readExternalMember(
                binding, 'type', assertCurrent, 'read material binding type',
            );
            let struct = null;
            for (const candidate of structs) {
                const candidateName = manager._readExternalMember(
                    candidate, 'name', assertCurrent, 'read material struct name',
                );
                if (candidateName === bindingType) {
                    struct = candidate;
                    break;
                }
            }
            if (!struct) continue;

            const bindingName = manager._snapshotString(
                manager._readExternalMember(
                    binding, 'name', assertCurrent, 'read uniform binding name',
                ),
                assertCurrent,
                'normalize uniform binding name',
            );
            const structSize = manager._snapshotNumber(
                manager._readExternalMember(
                    struct, 'size', assertCurrent, 'read uniform struct size',
                ),
                assertCurrent,
                'normalize uniform struct size',
            );
            const device = manager.device;
            let buffer = null;
            try {
                buffer = manager._callExternal(device, 'createBuffer', [{
                    size: structSize,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    label: `${this.name}_${bindingName}`,
                }], assertCurrent, 'create a material uniform buffer', destroyBuffer);
            } catch (error) {
                destroyBuffer(buffer);
                throw error;
            }
            this._uniformBuffers.set(bindingName, { buffer, struct });
            this._uniformData.set(bindingName, new ArrayBuffer(structSize));
        }
    }

    getLayout(group = 0) {
        if (this._destroyed || !this._layouts) return undefined;
        return this._layouts.get(group);
    }

    getLayouts() {
        if (this._destroyed || !this._layouts) return [];
        return Array.from(this._layouts.values());
    }

    setUniform(bindingName, memberName, value) {
        this._assertActive('set a uniform');
        const info = this._uniformBuffers.get(bindingName);
        if (!info) return false;
        const member = info.struct.members.find(candidate => candidate.name === memberName);
        if (!member) return false;
        const data = this._uniformData.get(bindingName);
        this._writeValue(new DataView(data), member.offset, member.type, value);
        return true;
    }

    setUniforms(bindingName, values) {
        const generation = this._assertActive('set uniforms');
        for (const [name, value] of Object.entries(values)) {
            this._assertGeneration(generation, 'set uniforms');
            this.setUniform(bindingName, name, value);
        }
        return true;
    }

    uploadUniforms() {
        const generation = this._assertActive('upload uniforms');
        const manager = this.manager;
        const assertCurrent = () => this._assertGeneration(generation, 'upload uniforms');
        const queue = manager._readExternalMember(
            manager.vgpu, 'queue', assertCurrent, 'resolve the uniform upload queue',
        );
        const writeBuffer = manager._captureExternalCallable(
            queue, 'writeBuffer', assertCurrent, 'resolve uniform buffer upload',
        );
        for (const [name, info] of this._uniformBuffers) {
            const data = this._uniformData.get(name);
            manager._invokeCapturedExternal(
                writeBuffer, [info.buffer, 0, data], assertCurrent,
                'upload a material uniform buffer',
            );
        }
        return true;
    }

    createInstance(resources = {}) {
        const generation = this._assertActive('create an instance');
        const manager = this.manager;
        const assertCurrent = () => this._assertGeneration(generation, 'create an instance');
        const defaultsSnapshot = manager._snapshotRecord(
            this.defaults ?? {}, assertCurrent, 'snapshot material defaults',
        );
        const resourcesSnapshot = manager._snapshotRecord(
            resources ?? {}, assertCurrent, 'snapshot instance resources',
        );
        const mergedResources = { ...defaultsSnapshot, ...resourcesSnapshot };
        const instance = new MaterialInstance(this, mergedResources, generation);
        if (!this._isGeneration(generation)) {
            instance._destroyFromParent();
            this._assertGeneration(generation, 'publish an instance');
        }
        this._instances.add(instance);
        return instance;
    }

    _releaseInstance(instance) {
        this._instances?.delete(instance);
    }

    _writeValue(view, offset, type, value) {
        if (type === 'f32') {
            view.setFloat32(offset, value, true);
        } else if (type === 'i32') {
            view.setInt32(offset, value, true);
        } else if (type === 'u32') {
            view.setUint32(offset, value, true);
        } else if (type.startsWith('vec2')) {
            view.setFloat32(offset, value[0], true);
            view.setFloat32(offset + 4, value[1], true);
        } else if (type.startsWith('vec3')) {
            view.setFloat32(offset, value[0], true);
            view.setFloat32(offset + 4, value[1], true);
            view.setFloat32(offset + 8, value[2], true);
        } else if (type.startsWith('vec4')) {
            view.setFloat32(offset, value[0], true);
            view.setFloat32(offset + 4, value[1], true);
            view.setFloat32(offset + 8, value[2], true);
            view.setFloat32(offset + 12, value[3], true);
        } else if (type.startsWith('mat4x4')) {
            for (let index = 0; index < 16; index++) {
                view.setFloat32(offset + index * 4, value[index], true);
            }
        } else if (type.startsWith('mat3x3')) {
            for (let column = 0; column < 3; column++) {
                for (let row = 0; row < 3; row++) {
                    view.setFloat32(offset + column * 16 + row * 4, value[column * 3 + row], true);
                }
            }
        }
    }

    getUniformBuffer(name) {
        if (this._destroyed || !this._uniformBuffers) return undefined;
        return this._uniformBuffers.get(name)?.buffer;
    }

    _destroyFromParent() {
        if (this._destroyed) return false;
        const manager = this.manager;
        const instances = this._instances ? Array.from(this._instances) : [];
        const uniformBuffers = this._uniformBuffers
            ? Array.from(this._uniformBuffers.values(), info => info.buffer)
            : [];

        this._destroyed = true;
        this._generation++;
        manager?._releaseMaterial(this);
        this._layouts?.clear();
        this._uniformBuffers?.clear();
        this._uniformData?.clear();
        this._instances?.clear();
        this._layouts = null;
        this._uniformBuffers = null;
        this._uniformData = null;
        this._instances = null;
        this.manager = null;
        this.reflection = null;
        this.defaults = null;
        this.shaderSource = null;

        for (const instance of instances) instance._destroyFromParent();
        for (const buffer of uniformBuffers) destroyBuffer(buffer);
        return true;
    }

    destroy() {
        return this._destroyFromParent();
    }

    dispose() {
        return this.destroy();
    }
}

class MaterialInstance {
    constructor(material, resources, materialGeneration) {
        this.material = material;
        this.resources = resources;
        this._materialGeneration = materialGeneration;
        this._bindGroups = new Map();
        this._dirty = true;
        this._destroyed = false;
    }

    _assertActive(operation = 'perform instance work') {
        if (
            this._destroyed
            || !this.material
            || !this.material._isGeneration(this._materialGeneration)
        ) {
            throw lifecycleError('Material instance', operation);
        }
        return this._materialGeneration;
    }

    setResource(name, resource) {
        this._assertActive('set a resource');
        const material = this.material;
        const manager = material.manager;
        const assertCurrent = () => this._assertActive('set a resource');
        const normalizedName = manager._snapshotString(
            name, assertCurrent, 'normalize an instance resource name',
        );
        this.resources[normalizedName] = resource;
        this._assertActive('publish an instance resource');
        this._dirty = true;
        return true;
    }

    getBindGroup(group = 0) {
        const generation = this._assertActive('get a bind group');
        if (this._dirty) this._rebuildBindGroups(generation);
        this._assertActive('return a bind group');
        return this._bindGroups.get(group);
    }

    _rebuildBindGroups(generation) {
        this._assertActive('rebuild bind groups');
        const material = this.material;
        const manager = material.manager;
        const assertCurrent = () => this._assertActive('rebuild bind groups');
        const reflection = material.reflection;
        const rawBindings = manager._readExternalMember(
            reflection, 'bindings', assertCurrent, 'read instance bindings',
        );
        const bindingsSnapshot = manager._snapshotIterable(
            rawBindings, assertCurrent, 'snapshot instance bindings',
        );
        const groups = new Map();
        for (const binding of bindingsSnapshot) {
            const bindingGroup = manager._snapshotNumber(
                manager._readExternalMember(
                    binding, 'group', assertCurrent, 'read instance binding group',
                ),
                assertCurrent,
                'normalize instance binding group',
            );
            if (!groups.has(bindingGroup)) groups.set(bindingGroup, []);
            groups.get(bindingGroup).push(binding);
        }

        const nextBindGroups = new Map();
        for (const [groupIndex, bindings] of groups) {
            const entries = [];
            for (const binding of bindings) {
                const bindingName = manager._snapshotString(
                    manager._readExternalMember(
                        binding, 'name', assertCurrent, 'read instance binding name',
                    ),
                    assertCurrent,
                    'normalize instance binding name',
                );
                const bindingKind = manager._readExternalMember(
                    binding, 'kind', assertCurrent, 'read instance binding kind',
                );
                const bindingIndex = manager._snapshotNumber(
                    manager._readExternalMember(
                        binding, 'binding', assertCurrent, 'read instance binding index',
                    ),
                    assertCurrent,
                    'normalize instance binding index',
                );
                let resource = manager._readExternalMember(
                    this.resources, bindingName, assertCurrent, 'read an instance resource',
                );
                if (!resource && bindingKind === 'uniform') {
                    resource = Reflect.apply(
                        Material.prototype.getUniformBuffer, material, [bindingName],
                    );
                    assertCurrent();
                }
                if (!resource) {
                    console.warn(`[MaterialInstance] Missing resource: ${bindingName}`);
                    continue;
                }
                entries.push({
                    binding: bindingIndex,
                    resource: this._resolveResource(resource, generation),
                });
            }

            const layout = Reflect.apply(Material.prototype.getLayout, material, [groupIndex]);
            assertCurrent();
            const bindGroup = manager._callExternal(manager.device, 'createBindGroup', [{
                layout,
                entries,
                label: `${material.name}_instance_g${groupIndex}`,
            }], assertCurrent, 'create an instance bind group');
            nextBindGroups.set(groupIndex, bindGroup);
        }

        this._assertActive('publish instance bind groups');
        this._bindGroups = nextBindGroups;
        this._dirty = false;
    }

    _resolveResource(resource, generation) {
        this._assertActive('resolve an instance resource');
        const material = this.material;
        const manager = material.manager;
        const assertCurrent = () => {
            if (generation !== this._materialGeneration) {
                throw lifecycleError('Material instance', 'resolve an instance resource');
            }
            this._assertActive('resolve an instance resource');
        };
        let resolved = resource;
        if (typeof GPUBuffer !== 'undefined' && resource instanceof GPUBuffer) {
            assertCurrent();
            resolved = { buffer: resource };
        } else if (typeof GPUTextureView !== 'undefined' && resource instanceof GPUTextureView) {
            assertCurrent();
            resolved = resource;
        } else if (typeof GPUTexture !== 'undefined' && resource instanceof GPUTexture) {
            assertCurrent();
            resolved = manager._callExternal(
                resource, 'createView', [], assertCurrent, 'create an instance texture view',
            );
        } else if (typeof GPUSampler !== 'undefined' && resource instanceof GPUSampler) {
            assertCurrent();
            resolved = resource;
        } else {
            const buffer = manager._readExternalMember(
                resource, 'buffer', assertCurrent, 'read an instance buffer resource',
            );
            if (buffer) {
                const offset = manager._readExternalMember(
                    resource, 'offset', assertCurrent, 'read an instance buffer offset',
                );
                const size = manager._readExternalMember(
                    resource, 'size', assertCurrent, 'read an instance buffer size',
                );
            resolved = {
                    buffer,
                    offset: offset || 0,
                    size,
            };
            }
        }
        assertCurrent();
        return resolved;
    }

    invalidate() {
        this._assertActive('invalidate bind groups');
        this._dirty = true;
        return true;
    }

    _destroyFromParent() {
        if (this._destroyed) return false;
        const material = this.material;
        this._destroyed = true;
        material?._releaseInstance(this);
        this._bindGroups?.clear();
        this._bindGroups = null;
        this.resources = null;
        this.material = null;
        this._dirty = false;
        return true;
    }

    destroy() {
        return this._destroyFromParent();
    }

    dispose() {
        return this.destroy();
    }
}

export { Material, MaterialInstance };
