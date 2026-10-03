// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ClothMeshRenderer.js - GPU Cloth Mesh Rendering
 * 
 * Renders cloth simulations as triangle meshes with proper shading.
 * Reads particle positions from GPU buffer and generates mesh on the fly.
 */

// ============================================================================
// SHADERS
// ============================================================================

import { computeVertexNormals } from '../../kaolin/ops/mesh/MeshOps.js';
import { FIBER_MATERIALS, normalizeWovenAppearance } from '../../sim/cloth/FiberMaterials.js';

const VERTEX_FLOATS = 28;
const VERTEX_BYTES = VERTEX_FLOATS * 4;
const WEAVE_CODE = Object.freeze({ plain: 1, twill: 2, satin: 3 });

const CLOTH_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
    lightDir: vec3<f32>,
    padding: f32,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec4<f32>,
    @location(4) woven: vec4<f32>,
    @location(5) warpColor: vec4<f32>,
    @location(6) weftColor: vec4<f32>,
    @location(7) fiber: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) worldPos: vec3<f32>,
    @location(4) woven: vec4<f32>,
    @location(5) warpColor: vec4<f32>,
    @location(6) weftColor: vec4<f32>,
    @location(7) fiber: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = uniforms.viewProj * vec4<f32>(input.position, 1.0);
    output.normal = input.normal;
    output.uv = input.uv;
    output.color = input.color;
    output.worldPos = input.position;
    output.woven = input.woven;
    output.warpColor = input.warpColor;
    output.weftColor = input.weftColor;
    output.fiber = input.fiber;
    return output;
}

fn positiveMod(value: i32, divisor: i32) -> i32 {
    let remainder = value % divisor;
    return select(remainder + divisor, remainder, remainder >= 0);
}

fn strandCoverage(phase: f32, footprint: f32) -> f32 {
    let distance = abs(fract(phase) - 0.5);
    let halfWidth = 0.38;
    let antialias = clamp(footprint * 0.65, 0.015, 0.5);
    return 1.0 - smoothstep(halfWidth - antialias, halfWidth + antialias, distance);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Optional ordered coverage for retained transparent sheets. Discarded pixels
    // do not write depth, so a front layer cannot hide all of its lining.
    if (uniforms.padding > 0.5) {
        let x = u32(input.position.x) & 3u;
        let y = u32(input.position.y) & 3u;
        let bayer = array<f32, 16>(0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
        if (input.color.a <= (bayer[y * 4u + x] + 0.5) / 16.0) { discard; }
    }
    let normal = normalize(input.normal);
    
    // Two-sided lighting
    let lightDir = normalize(uniforms.lightDir);
    let ndotl = abs(dot(normal, lightDir));
    let diffuse = max(ndotl, 0.2);
    
    // Simple ambient + diffuse
    let ambient = 0.3;
    let lighting = ambient + (1.0 - ambient) * diffuse;
    let alpha = select(input.color.a, 1.0, uniforms.padding > 0.5);
    // Derivatives stay in uniform control flow. Solid meshes then return before
    // any weave, crossing, fiber or color work.
    let materialDx = dpdx(input.uv);
    let materialDy = dpdy(input.uv);
    if (input.woven.x < 0.5) { return vec4<f32>(input.color.rgb * lighting, alpha); }
    let angle = input.fiber.w;
    let alongGrain = vec2<f32>(cos(angle), sin(angle));
    let acrossGrain = vec2<f32>(-alongGrain.y, alongGrain.x);
    let materialPoint = vec2<f32>(dot(input.uv, acrossGrain), dot(input.uv, alongGrain));
    let gradientX = vec2<f32>(dot(materialDx, acrossGrain), dot(materialDx, alongGrain)) * input.woven.zw;
    let gradientY = vec2<f32>(dot(materialDy, acrossGrain), dot(materialDy, alongGrain)) * input.woven.zw;
    let phase = materialPoint * input.woven.zw;
    let footprints = abs(gradientX) + abs(gradientY);
    let footprint = max(footprints.x, footprints.y);
    let resolved = 1.0 - smoothstep(0.45, 1.15, footprint);
    let warp = strandCoverage(phase.x, footprints.x);
    let weft = strandCoverage(phase.y, footprints.y);
    let x = i32(floor(phase.x));
    let y = i32(floor(phase.y));
    var warpOver = positiveMod(x + y, 2) == 0;
    if (input.woven.y > 1.5 && input.woven.y < 2.5) { warpOver = positiveMod(x + y, 4) < 2; }
    if (input.woven.y >= 2.5) { warpOver = positiveMod(x + 2 * y, 5) < 4; }
    let overlap = warp * weft;
    let warpWeight = warp * (1.0 - weft) + overlap * select(0.30, 1.0, warpOver);
    let weftWeight = weft * (1.0 - warp) + overlap * select(1.0, 0.30, warpOver);
    let threadCoverage = clamp(warpWeight + weftWeight, 0.0, 1.0);
    let threadColor = (input.warpColor.rgb * warpWeight + input.weftColor.rgb * weftWeight)
        / max(warpWeight + weftWeight, 0.0001);
    let cavity = input.color.rgb * (0.48 + 0.18 * input.fiber.x);
    let sheen = (0.08 + 0.20 * input.fiber.z) * pow(max(ndotl, 0.0), mix(8.0, 2.0, input.fiber.y));
    let wovenColor = mix(cavity, threadColor * (lighting + sheen), threadCoverage);
    return vec4<f32>(mix(input.color.rgb * lighting, wovenColor, resolved), alpha);
}
`;

// ============================================================================
// CLOTH MESH RENDERER
// ============================================================================

export class ClothMeshRenderer {
    constructor(device, { maxVertices = 10000, maxTriangles = 20000 } = {}) {
        if (!Number.isSafeInteger(maxVertices) || maxVertices < 3 || maxVertices > 20000 || !Number.isSafeInteger(maxTriangles) || maxTriangles < 1 || maxTriangles > 40000) throw new RangeError('Cloth rendering supports at most 20000 vertices and 40000 triangles');
        this.device = device;
        this.initialized = false;
        
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
        
        this.maxVertices = maxVertices;
        this.maxIndices = maxTriangles * 3;
        
        this._vertexData = null;
        this._indexData = null;
        this.vertexCount = 0;
        this.indexCount = 0;
        this._uniformData = new Float32Array(20);
        this._coverage = false;
        this.meshRanges = [];
    }
    
    async init(renderFormat = 'bgra8unorm', depthFormat = 'depth24plus') {
        if (this.initialized) return;
        
        // Vertex layout: geometry(12) + woven parameters/colors/fiber(16).
        // A disabled woven flag preserves the original solid-color path.
        this._vertexData = new Float32Array(this.maxVertices * VERTEX_FLOATS);
        this._indexData = new Uint32Array(this.maxIndices);
        
        this.vertexBuffer = this.device.createBuffer({
            label: 'ClothMesh.vertices',
            size: this._vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        
        this.indexBuffer = this.device.createBuffer({
            label: 'ClothMesh.indices',
            size: this._indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        
        this.uniformBuffer = this.device.createBuffer({
            label: 'ClothMesh.uniforms',
            size: 80, // mat4(64) + vec3(12) + padding(4)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        const shaderModule = this.device.createShaderModule({
            label: 'ClothMesh.shader',
            code: CLOTH_SHADER,
        });
        
        const bindGroupLayout = this.device.createBindGroupLayout({
            label: 'ClothMesh.bindGroupLayout',
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
        });
        const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        const descriptor = {
            label: 'ClothMesh.pipeline',
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: VERTEX_BYTES,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
                        { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
                        { shaderLocation: 2, offset: 24, format: 'float32x2' },  // uv
                        { shaderLocation: 3, offset: 32, format: 'float32x4' },  // color
                        { shaderLocation: 4, offset: 48, format: 'float32x4' },  // enabled, weave, warp density, weft density
                        { shaderLocation: 5, offset: 64, format: 'float32x4' },  // warp color
                        { shaderLocation: 6, offset: 80, format: 'float32x4' },  // weft color
                        { shaderLocation: 7, offset: 96, format: 'float32x4' },  // roughness, anisotropy, sheen, grain angle
                    ],
                }],
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: renderFormat }],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'none', // Double-sided cloth
            },
            depthStencil: {
                format: depthFormat,
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        };
        this.pipeline = this.device.createRenderPipeline(descriptor);
        
        this.bindGroup = this.device.createBindGroup({
            label: 'ClothMesh.bindGroup',
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
            ],
        });
        
        this.initialized = true;
        console.log('[ClothMeshRenderer] Initialized');
    }
    
    /**
     * Update cloth mesh from simulation data
     * @param {object} clothSim - Cloth simulation with particles grid
     */
    updateFromClothSimulation(clothSim) {
        this._coverage = false;
        this.meshRanges = [];
        if (!clothSim || !clothSim.opts) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }
        
        const opts = clothSim.opts;
        const resX = opts.resolutionX + 1;
        const resY = opts.resolutionY + 1;
        const color = opts.color || [0.8, 0.2, 0.3, 1];
        
        // Get particle positions (either from solver or component)
        let positions;
        if (clothSim.solver?.getPositions) {
            positions = clothSim.solver.getPositions();
        } else if (clothSim.particles) {
            positions = clothSim.particles;
        } else {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }
        
        const vData = this._vertexData;
        const iData = this._indexData;
        let vi = 0;
        let ii = 0;
        
        // Generate vertices with normals
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                const idx = y * resX + x;
                const p = positions[idx];
                if (!p) continue;
                
                // Position
                vData[vi++] = p.x ?? p[0] ?? 0;
                vData[vi++] = p.y ?? p[1] ?? 0;
                vData[vi++] = p.z ?? p[2] ?? 0;
                
                // Calculate normal from neighbors
                let nx = 0, ny = 1, nz = 0;
                if (x > 0 && x < resX - 1 && y > 0 && y < resY - 1) {
                    const pL = positions[idx - 1];
                    const pR = positions[idx + 1];
                    const pU = positions[idx - resX];
                    const pD = positions[idx + resX];
                    
                    if (pL && pR && pU && pD) {
                        // Cross product of tangent vectors
                        const tx = (pR.x ?? pR[0]) - (pL.x ?? pL[0]);
                        const ty = (pR.y ?? pR[1]) - (pL.y ?? pL[1]);
                        const tz = (pR.z ?? pR[2]) - (pL.z ?? pL[2]);
                        
                        const bx = (pD.x ?? pD[0]) - (pU.x ?? pU[0]);
                        const by = (pD.y ?? pD[1]) - (pU.y ?? pU[1]);
                        const bz = (pD.z ?? pD[2]) - (pU.z ?? pU[2]);
                        
                        nx = ty * bz - tz * by;
                        ny = tz * bx - tx * bz;
                        nz = tx * by - ty * bx;
                        
                        const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
                        nx /= len;
                        ny /= len;
                        nz /= len;
                    }
                }
                
                vData[vi++] = nx;
                vData[vi++] = ny;
                vData[vi++] = nz;
                
                // UV
                vData[vi++] = x / (resX - 1);
                vData[vi++] = y / (resY - 1);
                
                // Color
                vData[vi++] = color[0];
                vData[vi++] = color[1];
                vData[vi++] = color[2];
                vData[vi++] = color[3];

                // No retained material appearance on the legacy grid path.
                vData.fill(0, vi, vi + 16);
                vi += 16;
            }
        }
        
        // Generate indices for triangle mesh
        for (let y = 0; y < resY - 1; y++) {
            for (let x = 0; x < resX - 1; x++) {
                const idx = y * resX + x;
                
                // Two triangles per quad
                iData[ii++] = idx;
                iData[ii++] = idx + 1;
                iData[ii++] = idx + resX;
                
                iData[ii++] = idx + 1;
                iData[ii++] = idx + resX + 1;
                iData[ii++] = idx + resX;
            }
        }
        
        this.vertexCount = vi / VERTEX_FLOATS;
        this.indexCount = ii;
        
        if (this.vertexCount > 0) {
            this.device.queue.writeBuffer(this.vertexBuffer, 0, vData.buffer, 0, vi * 4);
            this.device.queue.writeBuffer(this.indexBuffer, 0, iData.buffer, 0, ii * 4);
        }
    }

    /** Upload arbitrary retained triangular panels, preserving the caller's coordinate unit.
     * Normals use the same shared area-weighted implementation as other Engine meshes.
     * Validation completes before either GPU buffer changes; the original grid API remains available.
     */
    updateFromTriangleMeshes(meshes, { selectedId = null, selectionColor = [.31, .74, .69], coverage = true } = {}) {
        if (!this.initialized) throw new Error('Initialize the cloth renderer before uploading triangles');
        if (!Array.isArray(meshes) || meshes.length > 2000 || !Array.isArray(selectionColor) || selectionColor.length !== 3 || selectionColor.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new TypeError('Invalid retained cloth scene or selection color');
        const finite = value => (Array.isArray(value) || ArrayBuffer.isView(value)) && Array.from(value).every(v => Number.isFinite(v) && Math.abs(v) <= 1e12);
        const ids = new Set(), prepared = []; let vertices = 0, indices = 0;
        for (const mesh of meshes) {
            const count = mesh?.positions?.length / 3;
            if (typeof mesh?.id !== 'string' || !mesh.id || ids.has(mesh.id) || !finite(mesh.positions) || !Number.isSafeInteger(count) || count < 3 || !finite(mesh.triangles) || !mesh.triangles.length || mesh.triangles.length % 3 || Array.from(mesh.triangles).some(i => !Number.isSafeInteger(i) || i < 0 || i >= count)) throw new TypeError('Retained cloth meshes require unique IDs, finite positions and valid triangle indices');
            ids.add(mesh.id); vertices += count; indices += mesh.triangles.length;
            if (vertices > this.maxVertices || indices > this.maxIndices) throw new RangeError('Retained cloth scene exceeds its vertex or triangle budget');
            if (mesh.uvs != null && (!finite(mesh.uvs) || mesh.uvs.length !== count * 2)) throw new TypeError('Cloth UVs must correspond to every vertex');
            if (mesh.materialCoordinatesMm != null && (!finite(mesh.materialCoordinatesMm) || mesh.materialCoordinatesMm.length !== count * 2)) throw new TypeError('Physical material coordinates must correspond to every vertex');
            if (mesh.color != null && (!finite(mesh.color) || mesh.color.length !== 4 || Array.from(mesh.color).some(v => v < 0 || v > 1))) throw new TypeError('Cloth colors require four values from zero to one');
            const materialAppearance = mesh.materialAppearance == null ? null : normalizeWovenAppearance(mesh.materialAppearance);
            if (materialAppearance && mesh.materialCoordinatesMm == null) throw new TypeError('Woven cloth appearance requires physical millimetre material coordinates');
            prepared.push({ mesh, materialAppearance });
        }
        let vertex = 0, index = 0; const ranges = [];
        for (const { mesh, materialAppearance } of prepared) {
            if (mesh.visible === false) continue;
            const normals = computeVertexNormals(mesh.positions, mesh.triangles), color = mesh.color ?? [.7, .64, .51, 1], firstVertex = vertex, firstIndex = index;
            const selected = mesh.id === selectedId;
            const tint = value => selected ? value.map((channel, index) => index < 3 ? .76 * channel + .24 * selectionColor[index] : channel) : [...value];
            const warpColor = materialAppearance ? tint(materialAppearance.warpColor) : [0, 0, 0, 0];
            const weftColor = materialAppearance ? tint(materialAppearance.weftColor) : [0, 0, 0, 0];
            const fiber = materialAppearance ? FIBER_MATERIALS[materialAppearance.fiber] : null;
            for (let i = 0; i < mesh.positions.length / 3; i++, vertex++) {
                const at = vertex * VERTEX_FLOATS, p = i * 3;
                this._vertexData.set(mesh.positions.slice(p, p + 3), at);
                const validNormal = Math.hypot(normals[p], normals[p + 1], normals[p + 2]) > 1e-8;
                this._vertexData.set(validNormal ? normals.subarray(p, p + 3) : [0, 0, 1], at + 3);
                const materialCoordinates = materialAppearance ? mesh.materialCoordinatesMm : mesh.uvs;
                this._vertexData[at + 6] = materialCoordinates?.[i * 2] ?? 0; this._vertexData[at + 7] = materialCoordinates?.[i * 2 + 1] ?? 0;
                for (let channel = 0; channel < 3; channel++) this._vertexData[at + 8 + channel] = selected ? .76 * color[channel] + .24 * selectionColor[channel] : color[channel];
                this._vertexData[at + 11] = color[3];
                if (materialAppearance) {
                    this._vertexData.set([1, WEAVE_CODE[materialAppearance.weave], materialAppearance.warpThreadsPerMm, materialAppearance.weftThreadsPerMm], at + 12);
                    this._vertexData.set(warpColor, at + 16);
                    this._vertexData.set(weftColor, at + 20);
                    this._vertexData.set([fiber.roughness, fiber.anisotropy, fiber.sheenStrength, materialAppearance.grainDegrees * Math.PI / 180], at + 24);
                } else this._vertexData.fill(0, at + 12, at + VERTEX_FLOATS);
            }
            for (const local of mesh.triangles) this._indexData[index++] = firstVertex + local;
            ranges.push({ id: mesh.id, firstVertex, vertexCount: vertex - firstVertex, firstIndex, indexCount: index - firstIndex,
                materialAppearance: materialAppearance ? { kind: 'woven', weave: materialAppearance.weave, fiber: materialAppearance.fiber, provenance: materialAppearance.provenance } : null });
        }
        if (vertex) this.device.queue.writeBuffer(this.vertexBuffer, 0, this._vertexData.buffer, 0, vertex * VERTEX_BYTES);
        if (index) this.device.queue.writeBuffer(this.indexBuffer, 0, this._indexData.buffer, 0, index * 4);
        this.vertexCount = vertex; this.indexCount = index; this.meshRanges = ranges; this._coverage = coverage === true;
        return { vertexCount: vertex, triangleCount: index / 3, meshCount: ranges.length,
            wovenMeshCount: ranges.filter(range => range.materialAppearance?.kind === 'woven').length };
    }
    
    /**
     * Update from all cloth simulations
     */
    updateFromSimulations(simulations) {
        if (!simulations) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }
        
        // Find first cloth simulation (for now, only render one)
        for (const [entityId, sim] of simulations) {
            if (sim.type === 'cloth') {
                this.updateFromClothSimulation(sim);
                return;
            }
        }
        
        this.vertexCount = 0;
        this.indexCount = 0;
    }
    
    /**
     * Render cloth mesh
     */
    render(pass, viewProjMatrix, lightDir = [0.5, 1.0, 0.3]) {
        if (!this.initialized || this.indexCount === 0) return;
        
        this._uniformData.set(viewProjMatrix, 0);
        this._uniformData[16] = lightDir[0];
        this._uniformData[17] = lightDir[1];
        this._uniformData[18] = lightDir[2];
        this._uniformData[19] = this._coverage ? 1 : 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
        
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        pass.setPipeline(this.pipeline);
        pass.drawIndexed(this.indexCount);
    }
    
    destroy() {
        if (this.vertexBuffer) this.vertexBuffer.destroy();
        if (this.indexBuffer) this.indexBuffer.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        this.vertexBuffer = this.indexBuffer = this.uniformBuffer = null;
        this.pipeline = this.bindGroup = null;
        this.vertexCount = this.indexCount = 0;
        this.meshRanges = [];
        this.initialized = false;
    }
}

export default ClothMeshRenderer;
