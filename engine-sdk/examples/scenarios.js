// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export async function runEngine({ engine }, { stage, check, own, gpu, until, reportError }) {
    const world = engine.createWorld({ name: 'SDK example' });
    const entity = engine.createEntity(world);
    engine.setEntityComponent(world, entity, 'Transform', engine.createTransform({ position: [0, 2, 0], scale: [.45, .45, .45] }));
    own('ECS entity', () => {
        engine.destroyEntity(world, entity);
        if (engine.getEntityComponent(world, entity, 'Transform') !== null) throw new Error('Destroyed entity retained a Transform');
    });
    const physics = engine.particlePhysXPhysicsWorld;
    if (typeof physics?.createPhysicsWorld !== 'function') throw new Error('Native PhysX public namespace is unavailable');
    const simulation = physics.createPhysicsWorld({ gravity: [0, -9.81, 0] });
    own('Native PhysX world', () => {
        physics.destroyPhysicsWorld(simulation);
        if (!simulation.destroyed || simulation.bodies.size) throw new Error('Native physics cleanup failed');
    });
    await until(() => simulation.ready, 'native PhysX world startup');
    physics.createBody(simulation, { simMode: 'static', position: [0, -.5, 0], collider: { shape: 'box', halfExtents: [3, .5, 3] } });
    const body = physics.createBody(simulation, { entityId: entity, simMode: 'dynamic', mass: 1, position: [0, 2, 0], collider: { shape: 'box', halfExtents: [.45, .45, .45] } });
    for (let tick = 0; tick < 60; tick++) physics.stepPhysicsWorld(simulation, 1 / 60);
    check('Native gravity and floor contact', body.position.every(Number.isFinite) && body.position[1] < 1.8 && body.position[1] > .25, { positionM: [...body.position], steps: 60 });
    engine.setEntityComponent(world, entity, 'Transform', engine.createTransform({ position: body.position, rotation: body.rotation, scale: [.45, .45, .45] }));
    check('ECS Transform retains physics pose', Math.abs(engine.getEntityComponent(world, entity, 'Transform').position[1] - body.position[1]) < 1e-6);

    const { device } = await gpu();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Engine cube at native physics pose');
    stage.append(canvas);
    const surface = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    surface.configure({ device, format, alphaMode: 'opaque' });
    own('WebGPU canvas surface', () => surface.unconfigure());
    const mesh = engine.createUnitCubeMesh(device);
    own('Engine cube mesh', () => mesh.destroy());
    const uniform = device.createBuffer({ label: 'SDK ECS model matrix', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    own('Entity model uniform', () => uniform.destroy());
    const shader = device.createShaderModule({ label: 'SDK cube', code: `
struct Scene { model: mat4x4f }
@group(0) @binding(0) var<uniform> scene: Scene;
struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f }
@vertex fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f) -> Vertex {
    let world = scene.model * vec4f(position, 1.0);
    var result: Vertex;
    result.position = vec4f(world.x * .9 + world.z * .35, world.y * .9 - .45 + world.z * .2, .5 + world.z * .2, 1.0);
    result.color = vec3f(.25, .65, .95) * (.5 + .5 * abs(normal.y + normal.z * .5));
    return result;
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4f { return vec4f(input.color, 1.0); }
` });
    const { slot, ...layout } = engine.getVertexBufferLayoutForMesh(mesh);
    const pipeline = await device.createRenderPipelineAsync({ label: 'SDK Engine mesh', layout: 'auto', vertex: { module: shader, entryPoint: 'vertex', buffers: [layout] }, fragment: { module: shader, entryPoint: 'fragment', targets: [{ format }] }, primitive: { topology: mesh.topology } });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
    let animation = null;
    let frames = 0;
    const resize = () => {
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2)));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2)));
    };
    resize();
    window.addEventListener('resize', resize);
    own('Render loop and resize listener', () => { cancelAnimationFrame(animation); window.removeEventListener('resize', resize); });
    const draw = () => {
        try {
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: surface.getCurrentTexture().createView(), clearValue: [.035, .05, .08, 1], loadOp: 'clear', storeOp: 'store' }] });
            pass.setPipeline(pipeline);
            engine.renderEntities({ renderPass: pass, entities: [{ entityId: entity, type: 'cube', color: [.25, .65, .95] }], meshes: { cube: mesh }, uniformBuffers: new Map([[entity, uniform]]), bindGroups: new Map([[entity, bindGroup]]), getTransform: id => engine.getEntityComponent(world, id, 'Transform'), updateUniforms: (buffer, matrix) => device.queue.writeBuffer(buffer, 0, matrix), lightCount: 0 });
            pass.end();
            device.queue.submit([encoder.finish()]);
            frames++;
            animation = requestAnimationFrame(draw);
        } catch (error) {
            cancelAnimationFrame(animation);
            reportError(error);
        }
    };
    draw();
    await device.queue.onSubmittedWorkDone();
    check('Engine renderEntities submits an indexed cube', frames > 0 && mesh.indexCount === 36, { renderedFrames: frames, triangles: mesh.indexCount / 3 });
}

export async function runWorker({ engine }, { stage, check, own, gpu }) {
    const api = engine.SurfaceFields;
    if (typeof api?.createSurfaceFieldWorker !== 'function') throw new Error('Surface Fields public namespace is unavailable');
    const { device } = await gpu();
    const topology = api.createSurfaceFieldTopology({ n: 4, seams: false, closed: true, domains: [{ id: 'sdk-metal', material: 'metal', center: [0, 0, 0], size: [1, 1], substrateDepthM: .003 }] });
    const materials = await api.loadSurfaceFieldMaterials();
    const transport = await api.createSurfaceFieldGpuRuntime({ device, topology });
    own('Surface Field GPU buffers', () => { transport.dispose(); if (transport.bytes !== 0) throw new Error('Surface GPU buffers remain allocated'); });
    const worker = await api.createSurfaceFieldWorker({ topology, materials, transport: request => transport.transport(request), logger: (message, detail) => console.debug('[SDK worker]', message, detail) });
    own('Surface Field module worker', async () => {
        await worker.dispose();
        let rejected = false;
        try { await worker.snapshot(); } catch { rejected = true; }
        if (!rejected) throw new Error('Disposed worker still accepts operations');
    });
    const affected = await worker.applyBrush({ domain: 'sdk-metal', x: 0, z: 0, radius: .5, tool: 'water', strength: 1, duration: .2 });
    check('Worker water brush edits real cells', affected > 0, { cells: affected });
    await worker.step(1 / 60, { flow: 1, rain: 0 });
    const saved = await worker.snapshot();
    await worker.restore(saved);
    const stats = worker.stats();
    check('Worker executes GPU water transport', transport.steps > 0 && worker.steps === 1, { gpuSteps: transport.steps, workerSteps: worker.steps });
    check('Checkpoint preserves bounded water mass', saved.schema === 'engine.surface-fields' && stats.waterM3 > 0 && Number.isFinite(stats.waterResidualKg) && Math.abs(stats.waterResidualKg) < 1e-5, { waterM3: stats.waterM3, waterResidualKg: stats.waterResidualKg });
    const text = document.createElement('p');
    text.textContent = `Worker transported ${stats.waterM3.toExponential(4)} m³ of water across ${topology.count} cells. GPU buffers: ${transport.bytes} bytes.`;
    stage.append(text);
}

export async function runPlauna({ plauna }, { stage, check, own }) {
    if (typeof plauna?.createPlaunaApp !== 'function') throw new Error('Plauna public namespace is unavailable');
    const root = document.createElement('div');
    stage.append(root);
    const app = await plauna.createPlaunaApp({ root, useCSS: true, enableModuleTester: false, enableDeveloperTools: false, enableSmartContextMenu: false, enableHotReload: false, initialState: { clicks: 0 } });
    own('Plauna app and retained tree', () => {
        app.destroy();
        app.visualTree.destroy();
        root.remove();
        if (app.initialized || app.workspaces.size || !app.stateStore.destroyed || app.visualTree.root) throw new Error('Plauna retains owned state after destroy');
    });
    const button = new plauna.Button('sdk-plauna-counter', { text: 'Count: 0' });
    // DOMRenderer renders a node's textContent. Button's optional child-content
    // layout is separate, so use one text-bearing retained button in this demo.
    button.setContent('');
    button.textContent = 'Count: 0';
    button.addEventListener('click', () => {
        const count = app.stateStore.get('clicks') + 1;
        app.stateStore.set('clicks', count);
        button.textContent = `Count: ${count}`;
        app.domRenderer.updateNode(button);
    });
    app.visualTree.setRoot(button);
    app.domRenderer.render(app.visualTree);
    const rendered = app.domRenderer.getDOMElement(button);
    check('Plauna renders a retained Button', rendered instanceof HTMLButtonElement && root.contains(rendered));
    rendered.click();
    check('DOM click updates StateStore and retained UI', app.stateStore.get('clicks') === 1 && rendered.textContent.includes('Count: 1'), { clicks: app.stateStore.get('clicks') });
}

export async function runEditor({ editor }, { stage, check, own }) {
    if (typeof editor?.saveProject !== 'function') throw new Error('Editor public project storage API is unavailable');
    const previous = localStorage.getItem('currentProject');
    const project = editor.createProject('SDK persistence example');
    own('Example Editor project', async () => {
        await editor.deleteProject(project.uuid);
        if ((await editor.listProjects()).includes(project.uuid)) throw new Error('Example project remained in IndexedDB');
        if (localStorage.getItem('currentProject') === project.uuid) {
            if (previous === null) localStorage.removeItem('currentProject');
            else localStorage.setItem('currentProject', previous);
        }
    });
    project.settings.physics.gravity = [0, -9.81, 0];
    await editor.saveProject(project);
    const reopened = await editor.loadProject(project.uuid);
    check('Editor saves and reopens the project', reopened.uuid === project.uuid && reopened.name === project.name && reopened.schemaVersion === project.schemaVersion, { uuid: project.uuid, schemaVersion: reopened.schemaVersion });
    reopened.name = 'SDK persistence example reopened';
    await editor.saveProject(reopened);
    const second = await editor.loadProject(project.uuid);
    check('Reopened edits survive another save', second.name === reopened.name && second.settings.physics.gravity[1] === -9.81);
    const text = document.createElement('p');
    text.textContent = `${second.name}. The Release resources button removes this example project and restores the previous current-project preference.`;
    stage.append(text);
}

export async function runAGI({ agi }, { stage, check, own, gpu }) {
    if (typeof agi?.ComputeGraph !== 'function') throw new Error('AGI ComputeGraph public export is unavailable');
    const { device } = await gpu();
    const graph = new agi.ComputeGraph();
    own('AGI ComputeGraph', () => { graph.reset(); if (graph.getNodes().length || graph.executionOrder.length) throw new Error('Graph retains operations after reset'); });
    const buffers = [];
    own('AGI computation buffers', () => { for (const buffer of buffers.splice(0)) buffer.destroy(); });
    const allocate = (data, usage, label) => {
        const buffer = device.createBuffer({ size: 16, usage, label, mappedAtCreation: !!data });
        if (data) { new Float32Array(buffer.getMappedRange()).set(data); buffer.unmap(); }
        buffers.push(buffer);
        return buffer;
    };
    const add = async (left, right) => {
        const first = allocate(left, GPUBufferUsage.STORAGE, 'SDK graph left');
        const second = allocate(right, GPUBufferUsage.STORAGE, 'SDK graph right');
        const output = allocate(null, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'SDK graph output');
        const readback = allocate(null, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'SDK graph readback');
        const module = device.createShaderModule({ code: '@group(0) @binding(0) var<storage,read> a:array<f32>; @group(0) @binding(1) var<storage,read> b:array<f32>; @group(0) @binding(2) var<storage,read_write> sum:array<f32>; @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x<4u){sum[id.x]=a[id.x]+b[id.x];}}' });
        const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
        const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [first, second, output].map((buffer, binding) => ({ binding, resource: { buffer } })) });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(1); pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, 16);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        try { return new Float32Array(readback.getMappedRange().slice(0)); }
        finally { readback.unmap(); }
    };
    graph.addNode('sum', add, ['left', 'right']);
    graph.addNode('scaled', (input, { factor }) => Float32Array.from(input, value => value * factor), ['sum'], { factor: 2 });
    const results = await graph.execute({ left: new Float32Array([1, 2, 3, 4]), right: new Float32Array([10, 20, 30, 40]) });
    check('GPU ComputeGraph addition matches the vector oracle', results.get('sum').every((value, index) => value === [11, 22, 33, 44][index]), { sum: [...results.get('sum')] });
    check('ComputeGraph executes dependent scaling', results.get('scaled').every((value, index) => value === [22, 44, 66, 88][index]) && graph.getNodes().every(node => node.executed), { result: [...results.get('scaled')], order: [...graph.executionOrder] });
    const text = document.createElement('p');
    text.textContent = `2 × ([1,2,3,4] + [10,20,30,40]) = [${[...results.get('scaled')]}]. Addition ran on WebGPU; scaling followed as a dependent graph node.`;
    stage.append(text);
}

export async function runOS({ os }, { stage, sdkRoot, check, own, until, unsupported }) {
    if (typeof os?.bootWebGpuOS !== 'function') throw new Error('WebGPU OS public boot API is unavailable');
    if (window.credentialless !== true) throw new Error('The OS demo must run in the credentialless child frame');
    if (!navigator.gpu) unsupported('WebGPU is unavailable in this credentialless frame.');
    globalThis.__PE_OS_BASE__ = new URL('webgpu-os/', sdkRoot).href;
    const shell = document.createElement('div');
    shell.className = 'os-shell';
    shell.innerHTML = '<canvas id="os-gpu-canvas" aria-label="OS compositor"></canvas><div id="os-desktop"></div><div id="os-taskbar"></div><div id="os-boot-loader"><p id="os-boot-status" role="status">Booting local app…</p></div>';
    stage.append(shell);
    const module = await import('./os-local-app.js');
    const appId = 'sdk.local-app';
    const manifest = { appId, name: 'SDK local app', entry: new URL('./os-local-app.js', document.baseURI).href, version: '1.0.0', surface: 'window', category: 'utility', permissions: [], defaultWidth: 440, defaultHeight: 320, singleton: true };
    os.appRegistry.registerExternal(manifest, module, 'raw');
    own('SDK app registry entry', () => os.appRegistry.unregister(appId));
    let application = null;
    let mountState = null;
    own('WebGPU OS lifetime', async () => {
        if (application) {
            await application.desktop.shutdownRuntimeHandoff('sdk-example-cleanup');
            await application.kernel.stop();
            if ([...application.kernel.processTable.liveEntries()].length) throw new Error('OS process table retains the example app');
        }
        shell.remove();
    });
    application = await os.bootWebGpuOS({ singleAppId: appId, session: 'demo', onAppState: detail => { mountState = detail; }, logger: console });
    await until(() => application.kernel.processTable.get(appId)?.appReady, 'local OS app mount', 60000);
    const entry = application.kernel.processTable.get(appId);
    check('Explicit OS boot returns real kernel and desktop', !!application.kernel && !!application.desktop && application.session === 'demo');
    const button = shell.querySelector('[data-sdk-counter="increment"]');
    check('Strict local manifest mounts the app', entry.appReady === true && !!button && entry.manifest.appId === appId, { appId, temporarySession: true, mountState: mountState?.state ?? null });
    button.click();
    check('Local OS app interaction executes', shell.querySelector('[data-sdk-counter-value]').textContent === '1');
}
