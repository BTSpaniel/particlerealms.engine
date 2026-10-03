// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Exercise the real SceneRenderer through either source or compiled Engine APIs.
 * Each frame submits both draws together, then reads an offscreen color target.
 * The diagnostic shader puts translucent outlines behind the base plane so the
 * readback can distinguish the two uniform states independently of lighting.
 */
export async function runSelectionRegression(engine, device) {
    if (typeof engine?.renderEntities !== 'function' || !device?.queue) {
        throw new TypeError('Selection regression requires renderEntities and a WebGPU device');
    }
    const resources = [];
    const cases = [];
    const warnings = [];
    const cleanupErrors = [];
    const started = performance.now();
    let destroyed = 0;
    let failure = null;
    let readback = null;
    const own = resource => { resources.push(resource); return resource; };
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    device.pushErrorScope('validation');
    try {
        const size = 256;
        const color = own(device.createTexture({
            label: 'Selection regression color', size: [size, size], format: 'rgba8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        }));
        const depth = own(device.createTexture({
            label: 'Selection regression depth', size: [size, size], format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        }));
        readback = own(device.createBuffer({
            label: 'Selection regression readback', size: size * size * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }));
        const shader = device.createShaderModule({ label: 'Selection regression shader', code: `
struct Uniforms { model: mat4x4f, color: vec4f }
@group(0) @binding(0) var<uniform> scene: Uniforms;
@vertex fn vertex(@location(0) position: vec2f) -> @builtin(position) vec4f {
    let world = scene.model * vec4f(position, 0.0, 1.0);
    return vec4f(world.xy, select(0.3, 0.6, scene.color.a < 0.99), 1.0);
}
@fragment fn fragment() -> @location(0) vec4f { return vec4f(scene.color.rgb, 1.0); }
` });
        const pipeline = await device.createRenderPipelineAsync({
            label: 'Selection regression pipeline', layout: 'auto',
            vertex: { module: shader, entryPoint: 'vertex', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
            fragment: { module: shader, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
        });
        const resourceFor = label => {
            const uniformBuffer = own(device.createBuffer({ label, size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
            const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
            return { uniformBuffer, bindGroup };
        };
        const normal = [resourceFor('Selection regression entity 1'), resourceFor('Selection regression entity 2')];
        const selectionResources = resourceFor('Selection regression independent outline');
        const uniformBuffers = new Map(normal.map((resource, index) => [index + 1, resource.uniformBuffer]));
        const bindGroups = new Map(normal.map((resource, index) => [index + 1, resource.bindGroup]));
        const transforms = new Map([
            [1, { position: [-0.45, 0, 0], scale: [0.65, 0.65, 1] }],
            [2, { position: [0.45, 0, 0], scale: [0.65, 0.65, 1] }],
        ]);
        const entities = [
            { entityId: 1, type: 'plane', color: [0.2, 0.4, 0.6] },
            { entityId: 2, type: 'plane', color: [0.1, 0.8, 0.2] },
        ];
        const upload = (label, data, usage) => {
            const buffer = own(device.createBuffer({ label, size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST }));
            device.queue.writeBuffer(buffer, 0, data);
            return buffer;
        };
        const positions = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
        const indices = [0, 1, 2, 0, 2, 3];
        const indexed = {
            vertexBuffer: upload('Selection regression vertices', new Float32Array(positions), GPUBufferUsage.VERTEX),
            indexBuffer: upload('Selection regression indices', new Uint16Array(indices), GPUBufferUsage.INDEX),
            indexCount: 6, indexFormat: 'uint16',
        };
        const nonIndexed = {
            vertexBuffer: upload('Selection regression expanded vertices', new Float32Array(indices.flatMap(index => positions.slice(index * 2, index * 2 + 2))), GPUBufferUsage.VERTEX),
            vertexCount: 6,
        };
        const clustered = {
            ...indexed,
            indexedClusterCuller: {
                hasGeometry: () => true,
                dstIndicesBuffer: upload('Selection regression culled indices', new Uint32Array(indices), GPUBufferUsage.INDEX),
                indirectBuffer: upload('Selection regression indirect arguments', new Uint32Array([6, 1, 0, 0, 0]), GPUBufferUsage.INDIRECT),
            },
        };
        const updateUniforms = (buffer, matrix, baseColor, _lightCount, alpha = 1) => {
            const values = new Float32Array(20);
            values.set(matrix);
            values.set([...baseColor, alpha], 16);
            device.queue.writeBuffer(buffer, 0, values);
        };
        const render = async (name, mesh, selectedEntityId, suppliedSelection = selectionResources) => {
            const encoder = device.createCommandEncoder({ label: name });
            const pass = encoder.beginRenderPass({
                colorAttachments: [{ view: color.createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
                depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
            });
            pass.setPipeline(pipeline);
            const draws = { direct: 0, indexed: 0, indirect: 0 };
            // Instrument actual GPU commands, not a replacement renderer.
            const observedPass = {
                setVertexBuffer: (...args) => pass.setVertexBuffer(...args),
                setBindGroup: (...args) => pass.setBindGroup(...args),
                setIndexBuffer: (...args) => pass.setIndexBuffer(...args),
                draw: (...args) => { draws.direct++; pass.draw(...args); },
                drawIndexed: (...args) => { draws.indexed++; pass.drawIndexed(...args); },
                drawIndexedIndirect: (...args) => { draws.indirect++; pass.drawIndexedIndirect(...args); },
            };
            engine.renderEntities({
                renderPass: observedPass, entities, meshes: { plane: mesh }, uniformBuffers, bindGroups,
                getTransform: id => transforms.get(id), updateUniforms, lightCount: 0, selectedEntityId,
                selectionResources: suppliedSelection, logger: { warn: message => warnings.push(message) },
            });
            pass.end();
            encoder.copyTextureToBuffer({ texture: color }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]);
            device.queue.submit([encoder.finish()]);
            await readback.mapAsync(GPUMapMode.READ);
            const pixels = new Uint8Array(readback.getMappedRange()).slice();
            readback.unmap();
            const measurements = [];
            const expectPixel = (label, x, y, expected) => {
                const actual = [...pixels.slice((y * size + x) * 4, (y * size + x) * 4 + 3)];
                measurements.push({ label, x, y, actual, expected });
                assert(actual.every((value, index) => Math.abs(value - expected[index]) <= 2),
                    `${name}: ${label} pixel (${x}, ${y}) was ${actual}; expected ${expected}`);
            };
            const first = transforms.get(1);
            const second = transforms.get(2);
            const pixelX = value => Math.floor((1 + value) * size / 2);
            const pixelY = value => Math.floor((1 - value) * size / 2);
            expectPixel('base material 1', pixelX(first.position[0]), pixelY(first.position[1]), [51, 102, 153]);
            expectPixel('base material 2', pixelX(second.position[0]), pixelY(second.position[1]), [26, 204, 51]);
            const suppliedValid = suppliedSelection === selectionResources;
            expectPixel('left outline', pixelX(first.position[0] - first.scale[0] * 0.5 * 1.025), pixelY(first.position[1]), suppliedValid && selectedEntityId === 1 ? [255, 255, 204] : [0, 0, 0]);
            expectPixel('right outline', pixelX(second.position[0] + second.scale[0] * 0.5 * 1.025), pixelY(second.position[1]), suppliedValid && selectedEntityId === 2 ? [255, 255, 204] : [0, 0, 0]);
            expectPixel('outside transformed silhouette', 24, 128, [0, 0, 0]);
            const hasOutline = selectedEntityId != null && suppliedValid;
            if (mesh === clustered) {
                assert(draws.indirect === 2 && draws.indexed === Number(hasOutline), `${name}: cluster outline did not use the original full index buffer`);
            } else if (mesh === indexed) {
                assert(draws.indexed === 2 + Number(hasOutline), `${name}: indexed draw count changed`);
            } else {
                assert(draws.direct === 2 + Number(hasOutline), `${name}: non-indexed draw count changed`);
            }
            cases.push({ name, status: 'PASS', measurements, draws });
        };
        for (const [label, mesh] of [['indexed', indexed], ['non-indexed', nonIndexed], ['clustered', clustered]]) {
            await render(`${label}: select first entity`, mesh, 1);
            await render(`${label}: deselect`, mesh, null);
            await render(`${label}: select second entity`, mesh, 2);
            await render(`${label}: select first entity again`, mesh, 1);
            transforms.set(1, { position: [-0.3, 0.25, 0], scale: [0.7, 0.5, 1] });
            await render(`${label}: selected translation and scale update`, mesh, 1);
            transforms.set(1, { position: [-0.45, 0, 0], scale: [0.65, 0.65, 1] });
        }
        await render('missing selection resources retain base rendering', indexed, 1, null);
        await render('missing selection diagnostic is not repeated each frame', indexed, 1, null);
        assert(warnings.length === 1 && warnings[0].includes('missing selectionResources'), 'Missing selection resources must emit one actionable diagnostic');
        await render('selected entity buffer alias retains base rendering', indexed, 1, normal[0]);
        await render('other entity buffer alias retains base rendering', indexed, 1, normal[1]);
        assert(warnings.length === 2 && warnings[1].includes('aliased selectionResources'), 'Aliased selection resources must emit one actionable diagnostic');
        await render('valid selection recovers after configuration errors', indexed, 1);
    } catch (error) {
        failure = error;
    } finally {
        try { if (readback?.mapState === 'mapped') readback.unmap(); }
        catch (error) { cleanupErrors.push(error); }
        for (const resource of resources.reverse()) {
            try { resource.destroy(); destroyed++; }
            catch (error) { cleanupErrors.push(error); }
        }
        try {
            const validation = await device.popErrorScope();
            if (validation) cleanupErrors.push(new Error(`Selection regression GPU validation: ${validation.message}`));
        } catch (error) { cleanupErrors.push(error); }
    }
    const receipt = {
        suite: 'scene-renderer-selection', status: failure || cleanupErrors.length ? 'FAIL' : 'PASS',
        cases, warnings, elapsedMs: performance.now() - started,
        cleanup: { allocated: resources.length, destroyed, errors: cleanupErrors.map(error => String(error?.message ?? error)) },
    };
    if (failure || cleanupErrors.length) {
        const error = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Selection rendering regression failed');
        error.receipt = receipt;
        throw error;
    }
    return receipt;
}
