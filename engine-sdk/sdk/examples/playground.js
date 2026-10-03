// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** A complete SDK application. Scene JSON uses the public Engine serializer. */
export async function runPlayground({ engine, plauna }, context) {
    const { stage, check, own, gpu, until, reportError } = context;
    const storageKey = 'particle-sdk-physics-playground-v1';
    const physics = engine.particlePhysXPhysicsWorld;
    const world = engine.createWorld({ name: 'SDK physics playground' });
    const simulation = physics.createPhysicsWorld({ gravity: [0, -9.81, 0] });
    own('Playground native world', () => {
        physics.destroyPhysicsWorld(simulation);
        if (!simulation.destroyed || simulation.bodies.size) throw new Error('Playground native world retained bodies');
    });
    await until(() => simulation.ready, 'playground native physics');
    physics.createBody(simulation, { simMode: 'static', position: [0, -.25, 0], collider: { shape: 'box', halfExtents: [5, .25, 5] } });
    const { device, adapter } = await gpu();
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    canvas.setAttribute('aria-label', 'Physics playground with selected cube outlined in gold');
    const uiRoot = document.createElement('div');
    uiRoot.className = 'playground-controls';
    const status = document.createElement('p');
    status.className = 'playground-status';
    status.setAttribute('role', 'status');
    stage.append(uiRoot, canvas, status);
    own('Playground DOM', () => { uiRoot.remove(); canvas.remove(); status.remove(); });
    const surface = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    surface.configure({ device, format, alphaMode: 'opaque' });
    own('Playground canvas', () => surface.unconfigure());
    const depth = device.createTexture({ label: 'Playground depth', size: [960, 540], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    own('Playground depth', () => depth.destroy());
    const mesh = engine.createUnitCubeMesh(device);
    own('Playground cube mesh', () => mesh.destroy());
    const shader = device.createShaderModule({ label: 'Playground model and color', code: `
struct Scene { model: mat4x4f, color: vec4f }
@group(0) @binding(0) var<uniform> scene: Scene;
struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f }
@vertex fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f) -> Vertex {
    let world = scene.model * vec4f(position, 1.0);
    var output: Vertex;
    output.position = vec4f(world.x * .22 + world.z * .08, world.y * .30 - .70 + world.z * .07, .5 - world.z * .03 - world.y * .005 + select(0.0, 0.1, scene.color.a < .99), 1.0);
    output.color = scene.color.rgb * (.65 + .35 * abs(normal.y));
    return output;
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4f { return vec4f(input.color, 1.0); }
` });
    const { slot, ...layout } = engine.getVertexBufferLayoutForMesh(mesh);
    const pipeline = await device.createRenderPipelineAsync({ label: 'Playground cubes', layout: 'auto', vertex: { module: shader, entryPoint: 'vertex', buffers: [layout] }, fragment: { module: shader, entryPoint: 'fragment', targets: [{ format }] }, primitive: { topology: mesh.topology, cullMode: 'back' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
    const uniformBuffers = new Map();
    const bindGroups = new Map();
    const bodies = new Map();
    const entities = [];
    let selected = null;
    let disposed = false;
    let animation = null;
    let frames = 0;
    let previousTime = null;
    const frameTimes = [];
    let maximumBodies = 0;
    const allocate = label => {
        const uniformBuffer = device.createBuffer({ label, size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        try {
            const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
            return { uniformBuffer, bindGroup };
        } catch (error) { uniformBuffer.destroy(); throw error; }
    };
    const selectionResources = allocate('Playground selection only');
    own('Playground selection buffer', () => selectionResources.uniformBuffer.destroy());
    const assertActive = () => { if (disposed) throw new Error('Playground is disposed'); };
    const updateStatus = message => { status.textContent = `${entities.length} cubes · selected ${selected ?? 'none'}${message ? ' · ' + message : ''}`; };
    const clear = () => {
        for (const entry of entities.splice(0)) {
            const id = entry.entityId;
            physics.removeBody(simulation, bodies.get(id).handle);
            engine.destroyEntity(world, id);
            if (engine.getEntityComponent(world, id, 'Transform') !== null || engine.getEntityComponent(world, id, 'PhysicsBody') !== null) throw new Error('Destroyed playground entity retained components');
            uniformBuffers.get(id).destroy();
        }
        bodies.clear(); uniformBuffers.clear(); bindGroups.clear(); selected = null;
        updateStatus();
    };
    own('Playground entities and buffers', () => {
        clear();
        if (simulation.bodies.size !== 1 || bodies.size || uniformBuffers.size || bindGroups.size) throw new Error('Playground entities survived cleanup');
    });
    const spawn = ({ position, spawnerProps = {}, type = 'cube' } = {}) => {
        assertActive();
        if (entities.length >= 32) throw new Error('Playground supports up to 32 cubes; reset before adding more');
        const index = entities.length;
        const pose = { position: position || [(index % 5 - 2) * 1.1, 2 + Math.floor(index / 5), 0], rotation: spawnerProps.rotation || [0, 0, 0, 1], scale: spawnerProps.scale || [.45, .45, .45] };
        const resources = allocate('Playground entity');
        let id = null;
        let body = null;
        const simMode = spawnerProps.simMode || 'dynamic';
        try {
            id = engine.createEntity(world);
            engine.setEntityComponent(world, id, 'Transform', engine.createTransform(pose));
            engine.setEntityComponent(world, id, 'PhysicsBody', { simMode });
            body = physics.createBody(simulation, { entityId: id, simMode, mass: 1, position: pose.position, rotation: pose.rotation, collider: { shape: 'box', halfExtents: pose.scale } });
            if (!body) throw new Error('Native body allocation failed');
        } catch (error) {
            resources.uniformBuffer.destroy();
            if (body) physics.removeBody(simulation, body.handle);
            if (id !== null) engine.destroyEntity(world, id);
            throw error;
        }
        uniformBuffers.set(id, resources.uniformBuffer); bindGroups.set(id, resources.bindGroup);
        bodies.set(id, body);
        entities.push({ entityId: id, type, color: spawnerProps.color || [.2 + index % 3 * .2, .65, .95] });
        selected = id;
        maximumBodies = Math.max(maximumBodies, bodies.size);
        updateStatus();
        return id;
    };
    const snapshot = () => engine.serializeScene({ entities, ecsWorld: world, physicsState: { enabled: true, baseGravity: [0, -9.81, 0] } });
    const save = () => {
        assertActive();
        const json = engine.exportSceneToJson({ entities, ecsWorld: world, physicsState: { enabled: true, baseGravity: [0, -9.81, 0] } });
        localStorage.setItem(storageKey, json);
        updateStatus('saved in this browser');
        return JSON.parse(json);
    };
    const reload = () => {
        assertActive();
        const json = localStorage.getItem(storageKey);
        if (!json) { updateStatus('save a scene first'); return null; }
        const data = engine.parseSceneJson(json);
        const vector = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
        if (!data || data.version !== 1 || !Array.isArray(data.entities) || data.entities.length > 32 || data.entities.some(entry => entry.type !== 'cube' || !vector(entry.position, 3) || !vector(entry.rotation, 4) || !vector(entry.scale, 3) || !vector(entry.color, 3) || entry.scale.some(value => value <= 0) || !['dynamic', 'static', 'kinematic'].includes(entry.simMode))) throw new Error('Saved playground scene is invalid');
        const result = engine.loadSceneFromJson({ json, spawnEntity: spawn, clearScene: clear });
        updateStatus('reloaded saved scene');
        return result;
    };
    const reset = () => { assertActive(); clear(); spawn(); spawn(); spawn(); };
    const select = () => {
        assertActive();
        const index = entities.findIndex(entry => entry.entityId === selected);
        selected = entities.length ? entities[(index + 1) % entities.length].entityId : null;
        updateStatus(); return selected;
    };
    const app = await plauna.createPlaunaApp({ root: uiRoot, useCSS: true, enableModuleTester: false, enableDeveloperTools: false, enableSmartContextMenu: false, enableHotReload: false });
    own('Playground Plauna app', () => {
        app.destroy(); app.visualTree.destroy();
        if (app.initialized || !app.stateStore.destroyed || app.visualTree.root) throw new Error('Playground Plauna retained resources');
    });
    const panel = new plauna.Panel('playground-controls', { closable: false, resizable: false });
    panel.setStyles({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '10px', minHeight: '44px', minWidth: '0', padding: '12px', backgroundColor: '#142131', border: '1px solid #38516e', borderRadius: '12px', boxShadow: 'none', overflow: 'visible', boxSizing: 'border-box' });
    for (const [label, action] of [['Spawn', spawn], ['Select next', select], ['Reset', reset], ['Save', save], ['Reload', reload]]) {
        const button = new plauna.Button(`playground-${label.toLowerCase().replaceAll(' ', '-')}`, { text: label });
        button.setContent(''); button.textContent = label;
        // Pretext consumes line height in pixels; use a measured text row and
        // padding so the retained button remains a visible 44px touch target.
        button.setStyles({ fontSize: '15px', lineHeight: '22px', padding: '10px 16px', minHeight: '44px', minWidth: '92px', flex: '0 0 auto', color: '#e8edf5', backgroundColor: label === 'Spawn' ? '#1d6da7' : '#1b2c40', border: '1px solid #385776', borderRadius: '8px', boxShadow: 'none', outline: null });
        button.addEventListener('click', () => { try { action(); } catch (error) { reportError(error); } });
        panel.appendChild(button);
    }
    app.visualTree.setRoot(panel); app.domRenderer.render(app.visualTree);
    if (localStorage.getItem(storageKey)) reload(); else reset();
    const updateUniforms = (buffer, matrix, color, lightCount, alpha = 1) => {
        const values = new Float32Array(20); values.set(matrix); values.set([...color, alpha], 16);
        device.queue.writeBuffer(buffer, 0, values);
    };
    const draw = time => {
        if (disposed) return;
        try {
            const elapsed = previousTime === null ? 1000 / 60 : time - previousTime;
            previousTime = time;
            if (frames && frameTimes.length < 100000) frameTimes.push(elapsed);
            physics.stepPhysicsWorld(simulation, Math.min(.05, Math.max(.001, elapsed / 1000)));
            for (const [id, body] of bodies) {
                if (![...body.position, ...body.rotation].every(Number.isFinite)) throw new Error('Non-finite playground physics pose');
                const transform = engine.getEntityComponent(world, id, 'Transform');
                engine.setEntityComponent(world, id, 'Transform', engine.createTransform({ position: body.position, rotation: body.rotation, scale: transform.scale }));
            }
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.getCurrentTexture().createView(), clearValue: [.035, .05, .08, 1], loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
            pass.setPipeline(pipeline);
            engine.renderEntities({ renderPass: pass, entities, meshes: { cube: mesh }, uniformBuffers, bindGroups, selectionResources, selectedEntityId: selected, getTransform: id => engine.getEntityComponent(world, id, 'Transform'), updateUniforms, lightCount: 0 });
            pass.end(); device.queue.submit([encoder.finish()]); frames++;
            animation = requestAnimationFrame(draw);
        } catch (error) { reportError(error); }
    };
    own('Playground animation and controls', () => { disposed = true; cancelAnimationFrame(animation); delete globalThis.__SDK_PLAYGROUND__; });
    const inspect = () => {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const percentile = value => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] : null;
        return { entities: entities.length, bodies: bodies.size, nativeBodies: simulation.bodies.size, uniformBuffers: uniformBuffers.size, bindGroups: bindGroups.size, selected, frames, maximumBodies, finite: [...bodies.values()].every(body => [...body.position, ...body.rotation].every(Number.isFinite)), frameTimeMs: { samples: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }, memory: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, scope: 'Chromium JavaScript heap estimate; excludes GPU and native allocations' } : null, adapter: { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, device: adapter.info?.device, description: adapter.info?.description } };
    };
    globalThis.__SDK_PLAYGROUND__ = { spawn, select, reset, save, reload, clear, snapshot, inspect, storageKey };
    draw(performance.now());
    await device.queue.onSubmittedWorkDone();
    check('Playground renders native physics through Engine with Plauna controls', frames > 0 && uiRoot.querySelectorAll('button').length === 5 && bodies.size === entities.length, inspect());
}
