// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RopeMeshRenderer.js - GPU Rope Mesh Rendering with Anisotropic Fiber Shading
 * 
 * Renders rope simulations as smooth tube meshes with Marschner hair shading model.
 * Supports twist, color blending, and material properties for realistic fiber appearance.
 */

const ROPE_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    _pad0: f32,
    lightDir: vec3<f32>,
    _pad1: f32,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec4<f32>,
    @location(4) tangent: vec3<f32>,
    @location(5) materialParams: vec4<f32>,  // x=anisotropy, y=sheenStrength, z=roughness, w=twistAngle
    @location(6) secondaryColor: vec4<f32>,
    @location(7) styleParams: vec4<f32>,     // x=blendRatio, y=blendNoiseScale, z=enableBlend, w=unused
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) worldPos: vec3<f32>,
    @location(4) tangent: vec3<f32>,
    @location(5) materialParams: vec4<f32>,
    @location(6) secondaryColor: vec4<f32>,
    @location(7) styleParams: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = uniforms.viewProj * vec4<f32>(input.position, 1.0);
    output.worldPos = input.position;
    output.normal = input.normal;
    output.uv = input.uv;
    output.color = input.color;
    output.tangent = input.tangent;
    output.materialParams = input.materialParams;
    output.secondaryColor = input.secondaryColor;
    output.styleParams = input.styleParams;
    return output;
}

// Simplex noise for color blending
fn mod289(x: vec3<f32>) -> vec3<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_4(x: vec4<f32>) -> vec4<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute(x: vec4<f32>) -> vec4<f32> { return mod289_4(((x * 34.0) + 1.0) * x); }
fn taylorInvSqrt(r: vec4<f32>) -> vec4<f32> { return 1.79284291400159 - 0.85373472095314 * r; }

fn snoise(v: vec3<f32>) -> f32 {
    let C = vec2<f32>(1.0/6.0, 1.0/3.0);
    let D = vec4<f32>(0.0, 0.5, 1.0, 2.0);
    var i = floor(v + dot(v, vec3<f32>(C.y, C.y, C.y)));
    let x0 = v - i + dot(i, vec3<f32>(C.x, C.x, C.x));
    let g = step(x0.yzx, x0.xyz);
    let l = 1.0 - g;
    let i1 = min(g.xyz, l.zxy);
    let i2 = max(g.xyz, l.zxy);
    let x1 = x0 - i1 + C.x;
    let x2 = x0 - i2 + C.y;
    let x3 = x0 - D.yyy;
    i = mod289(i);
    let p = permute(permute(permute(
        i.z + vec4<f32>(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4<f32>(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4<f32>(0.0, i1.x, i2.x, 1.0));
    let n_ = 0.142857142857;
    let ns = n_ * D.wyz - D.xzx;
    let j = p - 49.0 * floor(p * ns.z * ns.z);
    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);
    let x = x_ * ns.x + ns.yyyy.x;
    let y = y_ * ns.x + ns.yyyy.x;
    let h = 1.0 - abs(x) - abs(y);
    let b0 = vec4<f32>(x.xy, y.xy);
    let b1 = vec4<f32>(x.zw, y.zw);
    let s0 = floor(b0) * 2.0 + 1.0;
    let s1 = floor(b1) * 2.0 + 1.0;
    let sh = -step(h, vec4<f32>(0.0, 0.0, 0.0, 0.0));
    let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    let a1 = b1.xzyw + s1.xzyw * sh.zzww;
    var p0 = vec3<f32>(a0.xy, h.x);
    var p1 = vec3<f32>(a0.zw, h.y);
    var p2 = vec3<f32>(a1.xy, h.z);
    var p3 = vec3<f32>(a1.zw, h.w);
    let norm = taylorInvSqrt(vec4<f32>(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    var m = max(0.6 - vec4<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4<f32>(0.0));
    m = m * m;
    return 42.0 * dot(m * m, vec4<f32>(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Marschner R-path: Primary specular (white highlight shifted towards root)
fn marschnerR(TdotH: f32, roughness: f32) -> f32 {
    let alpha = 0.1;
    let sinTH = TdotH;
    let M = exp(-pow(asin(clamp(sinTH, -1.0, 1.0)) - alpha, 2.0) / (2.0 * roughness * roughness + 0.001));
    return M * 0.25;
}

// Marschner TRT-path: Internal reflection (colored sparkle)
fn marschnerTRT(TdotH: f32, roughness: f32, baseColor: vec3<f32>) -> vec3<f32> {
    let alpha = -0.1;
    let sinTH = TdotH;
    let M = exp(-pow(asin(clamp(sinTH, -1.0, 1.0)) - alpha, 2.0) / (2.0 * roughness * roughness * 4.0 + 0.001));
    let absorption = vec3<f32>(1.0) - baseColor;
    let absorbed = exp(-absorption * 2.0);
    return absorbed * M * 0.5;
}

// Anisotropic specular (Kajiya-Kay inspired)
fn anisotropicSpec(L: vec3<f32>, V: vec3<f32>, T: vec3<f32>, roughness: f32, anisotropy: f32) -> f32 {
    let H = normalize(L + V);
    let TdotH = dot(T, H);
    let sinTH = sqrt(max(1.0 - TdotH * TdotH, 0.0));
    let spec = pow(sinTH, 1.0 / (roughness * anisotropy + 0.001));
    return spec;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let N = normalize(input.normal);
    let T = normalize(input.tangent);
    let V = normalize(uniforms.cameraPos - input.worldPos);
    let L = normalize(uniforms.lightDir);
    let H = normalize(L + V);
    
    // Unpack material parameters
    let anisotropy = input.materialParams.x;
    let sheenStrength = input.materialParams.y;
    let roughness = input.materialParams.z;
    let twistAngle = input.materialParams.w;
    
    // Unpack style parameters
    let blendRatio = input.styleParams.x;
    let blendNoiseScale = input.styleParams.y;
    let enableBlend = input.styleParams.z > 0.5;
    
    // Rotate tangent by twist angle that varies along the rope length (uv.y = 0 to 1)
    // twistAngle is twists-per-meter * length, so multiply by uv.y and 2π for full rotation
    let twistAtPoint = twistAngle * input.uv.y * 6.283185; // 2π
    let cosA = cos(twistAtPoint);
    let sinA = sin(twistAtPoint);
    let twistedT = T * cosA + cross(N, T) * sinA;
    
    // Base color with optional marled blending
    var baseColor = input.color.rgb;
    if (enableBlend) {
        let noiseCoord = input.worldPos * blendNoiseScale + vec3<f32>(input.uv.y * twistAngle, 0.0, 0.0);
        let noise = snoise(noiseCoord) * 0.5 + 0.5;
        baseColor = mix(input.color.rgb, input.secondaryColor.rgb, smoothstep(0.3, 0.7, noise) * blendRatio);
    }
    
    // Kajiya-Kay diffuse (fiber-aware)
    let TdotL = dot(twistedT, L);
    let diffuse = sqrt(max(1.0 - TdotL * TdotL, 0.0));
    
    // Standard NdotL for fill
    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    
    // Marschner R-path (white primary highlight)
    let TdotH = dot(twistedT, H);
    let rPath = marschnerR(TdotH, roughness);
    
    // Marschner TRT-path (colored secondary highlight)
    let trtPath = marschnerTRT(TdotH, roughness, baseColor);
    
    // Anisotropic specular
    let anisoSpec = anisotropicSpec(L, V, twistedT, roughness, anisotropy);
    
    // Sheen (fuzz/backlight for wool, cotton)
    let sheen = sheenStrength * pow(1.0 - NdotV, 3.0);
    
    // Combine lighting
    var color = baseColor * mix(NdotL, diffuse, anisotropy) * 0.6;
    color += vec3<f32>(1.0) * rPath * 0.3;
    color += baseColor * trtPath;
    color += vec3<f32>(1.0) * sheen;
    color += baseColor * anisoSpec * anisotropy * 0.2;
    
    // Ambient
    color += baseColor * 0.15;
    
    return vec4<f32>(color, input.color.a);
}
`;

const _TAU = Math.PI * 2;

function _finiteNumber(value, path, { minimum = -Infinity, maximum = Infinity } = {}) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new TypeError(`${path} must be finite and within [${minimum}, ${maximum}]`);
    }
    return value;
}

function _stableId(value, path) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256
        || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError(`${path} must be a nonempty control-free stable ID`);
    }
    return value;
}

function _finitePoint(point, path) {
    if (!point || typeof point !== 'object') throw new TypeError(`${path} must be a 3D point`);
    const x = point.x !== undefined ? point.x : point[0];
    const y = point.y !== undefined ? point.y : point[1];
    const z = point.z !== undefined ? point.z : point[2];
    _finiteNumber(x, `${path}.x`);
    _finiteNumber(y, `${path}.y`);
    _finiteNumber(z, `${path}.z`);
    return point;
}

function _rgba(value, fallback, path) {
    if (value == null) return fallback;
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
        throw new TypeError(`${path} must be an RGBA array`);
    }
    if (value.length !== 4) throw new TypeError(`${path} must contain exactly four channels`);
    for (let index = 0; index < 4; index++) {
        _finiteNumber(value[index], `${path}[${index}]`, { minimum: 0, maximum: 1 });
    }
    return value;
}

function _polylineLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index++) {
        const previous = points[index - 1];
        const current = points[index];
        const px = previous.x !== undefined ? previous.x : previous[0];
        const py = previous.y !== undefined ? previous.y : previous[1];
        const pz = previous.z !== undefined ? previous.z : previous[2];
        const cx = current.x !== undefined ? current.x : current[0];
        const cy = current.y !== undefined ? current.y : current[1];
        const cz = current.z !== undefined ? current.z : current[2];
        total += _len(cx - px, cy - py, cz - pz);
    }
    return total;
}

function _len(x, y, z) {
    return Math.sqrt(x * x + y * y + z * z);
}

// Read x,y,z from a point in either {x,y,z} or [x,y,z] format into flat buffer
function _readPt(p, buf, off) {
    if (!p) { buf[off] = 0; buf[off+1] = 0; buf[off+2] = 0; return; }
    if (p.x !== undefined) { buf[off] = p.x; buf[off+1] = p.y; buf[off+2] = p.z; return; }
    buf[off] = p[0] || 0; buf[off+1] = p[1] || 0; buf[off+2] = p[2] || 0;
}

/**
 * Resample points with Catmull-Rom into renderer-owned flat storage.
 * @param {RopeMeshRenderer} owner - Renderer that owns the CPU point pool
 * @param {Array} points - Input ({x,y,z} objects or [x,y,z] arrays)
 * @param {number} subdiv - Subdivisions per segment
 * @param {number} flatOff - Write offset in the renderer point pool (floats)
 * @returns {number} Number of output points
 */
function _resampleFlat(owner, points, subdiv, flatOff) {
    const n = points.length;
    if (n < 2) return 0;

    const outCount = subdiv <= 1 ? n : (n - 1) * subdiv + 1;
    const needed = flatOff + outCount * 3;
    let flatPoints = owner._flatPoints;
    if (flatPoints.length < needed) {
        const next = new Float32Array(Math.max(needed, Math.max(4096, flatPoints.length * 2)));
        next.set(flatPoints);
        owner._flatPoints = next;
        flatPoints = next;
    }

    if (subdiv <= 1) {
        for (let i = 0; i < n; i++) _readPt(points[i], flatPoints, flatOff + i * 3);
        return n;
    }

    let oi = 0;
    for (let i = 0; i < n - 1; i++) {
        const q0 = points[Math.max(0, i - 1)], q1 = points[i];
        const q2 = points[i + 1], q3 = points[Math.min(n - 1, i + 2)];
        const ax = q0.x !== undefined ? q0.x : (q0[0]||0), ay = q0.y !== undefined ? q0.y : (q0[1]||0), az = q0.z !== undefined ? q0.z : (q0[2]||0);
        const bx = q1.x !== undefined ? q1.x : (q1[0]||0), by = q1.y !== undefined ? q1.y : (q1[1]||0), bz = q1.z !== undefined ? q1.z : (q1[2]||0);
        const cx = q2.x !== undefined ? q2.x : (q2[0]||0), cy = q2.y !== undefined ? q2.y : (q2[1]||0), cz = q2.z !== undefined ? q2.z : (q2[2]||0);
        const dx = q3.x !== undefined ? q3.x : (q3[0]||0), dy = q3.y !== undefined ? q3.y : (q3[1]||0), dz = q3.z !== undefined ? q3.z : (q3[2]||0);
        for (let s = 0; s < subdiv; s++) {
            const t = s / subdiv, t2 = t*t, t3 = t2*t;
            const o = flatOff + oi * 3;
            flatPoints[o]   = 0.5*((2*bx) + (-ax+cx)*t + (2*ax-5*bx+4*cx-dx)*t2 + (-ax+3*bx-3*cx+dx)*t3);
            flatPoints[o+1] = 0.5*((2*by) + (-ay+cy)*t + (2*ay-5*by+4*cy-dy)*t2 + (-ay+3*by-3*cy+dy)*t3);
            flatPoints[o+2] = 0.5*((2*bz) + (-az+cz)*t + (2*az-5*bz+4*cz-dz)*t2 + (-az+3*bz-3*cz+dz)*t3);
            oi++;
        }
    }
    _readPt(points[n - 1], flatPoints, flatOff + oi * 3);
    oi++;
    return oi;
}

export class RopeMeshRenderer {
    constructor(device) {
        this.device = device;
        this.initialized = false;
        this._disposed = false;

        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;

        this.maxVertices = 65536;
        this.maxIndices = 393216;

        // Vertex format: pos(3) + normal(3) + uv(2) + color(4) + tangent(3) + materialParams(4) + secondaryColor(4) + styleParams(4) = 27 floats
        this.floatsPerVertex = 27;
        this._vertexData = new Float32Array(this.maxVertices * this.floatsPerVertex);
        this._indexData = new Uint32Array(this.maxIndices);
        this._flatPoints = new Float32Array(4096);

        this.vertexCount = 0;
        this.indexCount = 0;

        this.sides = 16;
        this.subdivisions = 2;
        
        // Pooled rope entry objects (eliminates ~20 small allocs/frame)
        this._ropeEntryPool = [];
        this._ropeEntryCount = 0;
        this._defaultColor = [0.6, 0.4, 0.2, 1];
        this._defaultSecColor = [0.9, 0.85, 0.8, 1.0];
        this._activeRopeIds = Object.freeze([]);
        this._activeSegmentIds = Object.freeze([]);
    }
    
    _getPooledEntry(idx) {
        if (idx < this._ropeEntryPool.length) return this._ropeEntryPool[idx];
        const entry = {
            ptsOffset: 0, ringCount: 0, radius: 0.05,
            color: null, materialParams: [0,0,0,0], secondaryColor: null, styleParams: [0,0,0,0]
        };
        this._ropeEntryPool.push(entry);
        return entry;
    }

    async init(renderFormat = 'bgra8unorm', depthFormat = 'depth24plus', { reverseZ = false } = {}) {
        if (typeof reverseZ !== 'boolean') throw new TypeError('Rope mesh renderer reverseZ must be boolean');
        if (this.initialized) return;
        this._disposed = false;

        if (!(this._vertexData instanceof Float32Array)
            || this._vertexData.length !== this.maxVertices * this.floatsPerVertex) {
            this._vertexData = new Float32Array(this.maxVertices * this.floatsPerVertex);
        }
        if (!(this._indexData instanceof Uint32Array) || this._indexData.length !== this.maxIndices) {
            this._indexData = new Uint32Array(this.maxIndices);
        }
        if (!(this._flatPoints instanceof Float32Array) || this._flatPoints.length < 4096) {
            this._flatPoints = new Float32Array(4096);
        }

        this.vertexBuffer = this.device.createBuffer({
            label: 'RopeMesh.vertices',
            size: this._vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this.indexBuffer = this.device.createBuffer({
            label: 'RopeMesh.indices',
            size: this._indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });

        // Uniforms: viewProj(64) + cameraPos(12) + pad(4) + lightDir(12) + pad(4) = 96 bytes
        this.uniformBuffer = this.device.createBuffer({
            label: 'RopeMesh.uniforms',
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const shaderModule = this.device.createShaderModule({
            label: 'RopeMesh.shader',
            code: ROPE_SHADER,
        });

        this.pipeline = this.device.createRenderPipeline({
            label: 'RopeMesh.pipeline',
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 27 * 4, // 27 floats per vertex
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
                        { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
                        { shaderLocation: 2, offset: 24, format: 'float32x2' },  // uv
                        { shaderLocation: 3, offset: 32, format: 'float32x4' },  // color
                        { shaderLocation: 4, offset: 48, format: 'float32x3' },  // tangent
                        { shaderLocation: 5, offset: 60, format: 'float32x4' },  // materialParams
                        { shaderLocation: 6, offset: 76, format: 'float32x4' },  // secondaryColor
                        { shaderLocation: 7, offset: 92, format: 'float32x4' },  // styleParams
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
                cullMode: 'none',
            },
            depthStencil: {
                format: depthFormat,
                depthWriteEnabled: true,
                depthCompare: reverseZ ? 'greater' : 'less',
            },
        });

        this.bindGroup = this.device.createBindGroup({
            label: 'RopeMesh.bindGroup',
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
            ],
        });

        // Shadow depth pipeline: reuses vertex/index buffers, reads only position
        const shadowShaderCode = `
struct ShadowUniforms {
  lightViewProj: mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> uShadow: ShadowUniforms;

@vertex
fn vs_shadow(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return uShadow.lightViewProj * vec4<f32>(position, 1.0);
}
@fragment fn fs_shadow() { }
`;
        const shadowModule = this.device.createShaderModule({ label: 'RopeMesh.shadow', code: shadowShaderCode });

        this._shadowUniformBuffer = this.device.createBuffer({
            label: 'RopeMesh.shadowUniforms',
            size: 64, // mat4x4<f32>
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const shadowBindGroupLayout = this.device.createBindGroupLayout({
            label: 'RopeMesh.shadowLayout',
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
        });

        this._shadowPipeline = this.device.createRenderPipeline({
            label: 'RopeMesh.shadowPipeline',
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [shadowBindGroupLayout] }),
            vertex: {
                module: shadowModule,
                entryPoint: 'vs_shadow',
                buffers: [{
                    arrayStride: 27 * 4, // same stride as visual pipeline
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position only
                    ],
                }],
            },
            fragment: {
                module: shadowModule,
                entryPoint: 'fs_shadow',
                targets: [],
            },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
        });

        this._shadowBindGroup = this.device.createBindGroup({
            label: 'RopeMesh.shadowBindGroup',
            layout: shadowBindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: this._shadowUniformBuffer } }],
        });

        this.initialized = true;
    }

    flushShadowDepth(pass, lightViewProj) {
        if (!this.initialized || this.indexCount === 0 || !lightViewProj) return;
        this.device.queue.writeBuffer(this._shadowUniformBuffer, 0, lightViewProj);
        pass.setPipeline(this._shadowPipeline);
        pass.setBindGroup(0, this._shadowBindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        pass.drawIndexed(this.indexCount);
    }

    _grow(requiredVertices, requiredIndices) {
        if (requiredVertices > this.maxVertices) {
            while (this.maxVertices < requiredVertices) this.maxVertices *= 2;
            this._vertexData = new Float32Array(this.maxVertices * this.floatsPerVertex);
            if (this.vertexBuffer) this.vertexBuffer.destroy();
            this.vertexBuffer = this.device.createBuffer({
                label: 'RopeMesh.vertices',
                size: this._vertexData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
        }
        if (requiredIndices > this.maxIndices) {
            while (this.maxIndices < requiredIndices) this.maxIndices *= 2;
            this._indexData = new Uint32Array(this.maxIndices);
            if (this.indexBuffer) this.indexBuffer.destroy();
            this.indexBuffer = this.device.createBuffer({
                label: 'RopeMesh.indices',
                size: this._indexData.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
        }
    }

    /**
     * Update from Engine-generic authoritative rope views.
     *
     * Each view owns a stable rope ID, authored-order stable segment IDs,
     * positions, a metric radius, optional stable break IDs, and resolved
     * presentation material facets. The entire input is validated before the
     * currently published mesh counts and stable-ID views are replaced.
     *
     * @param {Array<Object>} views
     */
    updateFromRopeViews(views) {
        if (!Array.isArray(views)) throw new TypeError('rope views must be an array');

        const orderedViews = views.map((view, index) => {
            if (!view || typeof view !== 'object' || Array.isArray(view)) {
                throw new TypeError(`rope views[${index}] must be a plain object`);
            }
            return { view, index, ropeId: _stableId(view.ropeId, `rope views[${index}].ropeId`) };
        }).sort((left, right) => left.ropeId.localeCompare(right.ropeId));

        const seenRopes = new Set();
        const seenSegments = new Set();
        const activeRopeIds = [];
        const activeSegmentIds = [];
        const prepared = [];

        for (const { view, index, ropeId } of orderedViews) {
            const path = `rope views[${index}]`;
            if (seenRopes.has(ropeId)) throw new TypeError(`${path}.ropeId is duplicated`);
            seenRopes.add(ropeId);

            if (!Array.isArray(view.positions) || view.positions.length < 2) {
                throw new TypeError(`${path}.positions must contain at least two points`);
            }
            view.positions.forEach((point, pointIndex) => _finitePoint(point, `${path}.positions[${pointIndex}]`));
            if (!Array.isArray(view.segmentIds) || view.segmentIds.length !== view.positions.length - 1) {
                throw new TypeError(`${path}.segmentIds must contain one stable ID per adjacent point pair`);
            }

            const localSegments = new Set();
            const segmentIds = view.segmentIds.map((segmentId, segmentIndex) => {
                const id = _stableId(segmentId, `${path}.segmentIds[${segmentIndex}]`);
                if (localSegments.has(id) || seenSegments.has(id)) {
                    throw new TypeError(`${path}.segmentIds[${segmentIndex}] is duplicated`);
                }
                localSegments.add(id);
                seenSegments.add(id);
                return id;
            });

            const brokenValues = view.brokenSegmentIds == null
                ? []
                : (view.brokenSegmentIds instanceof Set
                    ? [...view.brokenSegmentIds]
                    : view.brokenSegmentIds);
            if (!Array.isArray(brokenValues)) throw new TypeError(`${path}.brokenSegmentIds must be an array or Set`);
            const broken = new Set();
            for (let brokenIndex = 0; brokenIndex < brokenValues.length; brokenIndex++) {
                const id = _stableId(brokenValues[brokenIndex], `${path}.brokenSegmentIds[${brokenIndex}]`);
                if (!localSegments.has(id)) throw new TypeError(`${path}.brokenSegmentIds contains unknown segment ${id}`);
                if (broken.has(id)) throw new TypeError(`${path}.brokenSegmentIds contains duplicate segment ${id}`);
                broken.add(id);
            }

            const radius = _finiteNumber(view.radiusMeters, `${path}.radiusMeters`, {
                minimum: Number.MIN_VALUE,
                maximum: 1_000,
            });
            const material = view.material?.presentation ?? view.presentation ?? view.material ?? {};
            if (!material || typeof material !== 'object' || Array.isArray(material)) {
                throw new TypeError(`${path}.material presentation facets must be a plain object`);
            }
            const color = _rgba(material.baseColorRgba ?? material.color, this._defaultColor, `${path}.material.baseColorRgba`);
            const secondaryColor = _rgba(
                material.secondaryColorRgba ?? material.secondaryColor,
                this._defaultSecColor,
                `${path}.material.secondaryColorRgba`,
            );
            const anisotropy = _finiteNumber(material.anisotropy ?? 0.5, `${path}.material.anisotropy`, { minimum: 0, maximum: 1 });
            const sheenStrength = _finiteNumber(material.sheenStrength ?? 0.3, `${path}.material.sheenStrength`, { minimum: 0, maximum: 4 });
            const roughness = _finiteNumber(material.roughness ?? 0.6, `${path}.material.roughness`, { minimum: 0.001, maximum: 1 });
            const twistRate = _finiteNumber(material.twistRatePerMeter ?? material.twistRate ?? 2, `${path}.material.twistRatePerMeter`, { minimum: -10_000, maximum: 10_000 });
            const ropeLength = view.lengthMeters == null
                ? _polylineLength(view.positions)
                : _finiteNumber(view.lengthMeters, `${path}.lengthMeters`, { minimum: 0, maximum: 1_000_000 });
            const blendRatio = _finiteNumber(material.blendRatio ?? 0.5, `${path}.material.blendRatio`, { minimum: 0, maximum: 1 });
            const blendNoiseScale = _finiteNumber(material.blendNoiseScale ?? 5, `${path}.material.blendNoiseScale`, { minimum: 0, maximum: 100_000 });

            prepared.push(Object.freeze({
                ropeId,
                positions: view.positions,
                segmentIds,
                broken,
                radius,
                color,
                secondaryColor,
                anisotropy,
                sheenStrength,
                roughness,
                twistAngle: twistRate * ropeLength,
                blendRatio,
                blendNoiseScale,
                enableBlend: material.enableColorBlend === true ? 1 : 0,
            }));
            activeRopeIds.push(ropeId);
            activeSegmentIds.push(...segmentIds);
        }

        const sides = this.sides;
        const subdiv = Math.max(1, this.subdivisions | 0);
        let entryIdx = 0;
        let totalVertices = 0;
        let totalIndices = 0;
        let flatOffset = 0;

        const addSpan = (rope, startPoint, endPoint) => {
            if (endPoint - startPoint < 1) return;
            const span = rope.positions.slice(startPoint, endPoint + 1);
            const ringCount = _resampleFlat(this, span, subdiv, flatOffset);
            if (ringCount < 2) return;
            const entry = this._getPooledEntry(entryIdx++);
            entry.ropeId = rope.ropeId;
            entry.segmentIds = rope.segmentIds.slice(startPoint, endPoint);
            entry.ptsOffset = flatOffset;
            entry.ringCount = ringCount;
            entry.radius = rope.radius;
            entry.color = rope.color;
            entry.secondaryColor = rope.secondaryColor;
            entry.materialParams[0] = rope.anisotropy;
            entry.materialParams[1] = rope.sheenStrength;
            entry.materialParams[2] = rope.roughness;
            entry.materialParams[3] = rope.twistAngle;
            entry.styleParams[0] = rope.blendRatio;
            entry.styleParams[1] = rope.blendNoiseScale;
            entry.styleParams[2] = rope.enableBlend;
            entry.styleParams[3] = 0;
            flatOffset += ringCount * 3;
            totalVertices += ringCount * sides;
            totalIndices += (ringCount - 1) * sides * 6;
        };

        for (const rope of prepared) {
            let spanStart = 0;
            for (let segmentIndex = 0; segmentIndex < rope.segmentIds.length; segmentIndex++) {
                if (!rope.broken.has(rope.segmentIds[segmentIndex])) continue;
                addSpan(rope, spanStart, segmentIndex);
                spanStart = segmentIndex + 1;
            }
            addSpan(rope, spanStart, rope.positions.length - 1);
        }

        if (entryIdx === 0) {
            this._ropeEntryCount = 0;
            this.vertexCount = 0;
            this.indexCount = 0;
        } else {
            this._buildTubeMeshes(this._ropeEntryPool, totalVertices, totalIndices, entryIdx);
            this._ropeEntryCount = entryIdx;
        }
        this._activeRopeIds = Object.freeze(activeRopeIds);
        this._activeSegmentIds = Object.freeze(activeSegmentIds);
        return Object.freeze({
            ropeIds: this._activeRopeIds,
            segmentIds: this._activeSegmentIds,
            vertexCount: this.vertexCount,
            indexCount: this.indexCount,
        });
    }

    get activeRopeIds() { return this._activeRopeIds; }
    get activeSegmentIds() { return this._activeSegmentIds; }

    /**
     * Update rope meshes from ECS components
     * Reads PhysicsChain components from entities
     * @param {Object} editor - Editor instance with ecsWorld and scene
     */
    updateFromComponents(editor) {
        if (!editor?.ecsWorld || !editor?.scene?.entities) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }
        
        const sides = this.sides;
        const subdiv = Math.max(1, this.subdivisions | 0);
        let entryIdx = 0;
        let totalVertices = 0;
        let totalIndices = 0;
        let flatOffset = 0;
        
        // Import getEntityComponent - use the one from engine
        const { getEntityComponent } = window.ECSStorage || {};
        if (!getEntityComponent) {
            // Fallback: try to import directly
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }
        
        // Iterate all scene entities and check for PhysicsChain component
        for (const [entityId, meta] of editor.scene.entities) {
            // Quick filter by spawnId for performance
            const spawnId = (meta.spawnId || '').toLowerCase();
            if (!spawnId.includes('rope') && !spawnId.includes('chain')) continue;
            
            const comp = getEntityComponent(editor.ecsWorld, entityId, 'PhysicsChain');
            if (!comp?.particles || comp.particles.length < 2) continue;
            
            // For multi-thread rope, use bundleRadius; for single-strand, use radius
            const threadCount = editor.physicsSimulations?.get(entityId)?.threadCount ?? comp.threadCount ?? 1;
            const radius = threadCount > 1
                ? (Number.isFinite(comp.threadRadius) ? comp.threadRadius : 0.002)
                : (Number.isFinite(comp.radius) ? comp.radius : 0.05);
            const color = Array.isArray(comp.color) ? comp.color : this._defaultColor;
            
            const anisotropy = comp.anisotropy ?? 0.5;
            const sheenStrength = comp.sheenStrength ?? 0.3;
            const roughness = comp.roughness ?? 0.6;
            const ropeLength = comp.length ?? 2.0;
            const twistAngle = (comp.twistRate ?? 2.0) * ropeLength;
            const secondaryColor = Array.isArray(comp.secondaryColor) ? comp.secondaryColor : this._defaultSecColor;
            const enableBlend = comp.enableColorBlend ? 1.0 : 0.0;
            const blendRatio = comp.blendRatio ?? 0.5;
            const blendNoiseScale = comp.blendNoiseScale ?? 5.0;
            
            // Tearing support: if the rope has tear indices, split into separate segments
            // Each segment is rendered as its own tube mesh with a visible gap at the tear
            const boundaries = new Set(comp.tearIndices ?? []);
            if (threadCount > 1) {
                const perThread = Math.floor(comp.particles.length / threadCount);
                for (let t = 1; t < threadCount; t++) boundaries.add(t * perThread - 1);
            }
            const tears = [...boundaries].sort((a, b) => a - b);
            if (tears && tears.length > 0) {
                // Build segment boundaries: [0, tear0+1, tear1+1, ...] and [tear0+1, tear1+1, ..., n]
                const pts = comp.particles;
                const n = pts.length;
                let segStart = 0;
                for (let ti = 0; ti <= tears.length; ti++) {
                    const segEnd = ti < tears.length ? tears[ti] + 1 : n;
                    if (segEnd - segStart < 2) { segStart = segEnd; continue; }
                    const segPts = pts.slice(segStart, segEnd);
                    const ringCount = _resampleFlat(this, segPts, subdiv, flatOffset);
                    if (ringCount >= 2) {
                        const e = this._getPooledEntry(entryIdx++);
                        e.ptsOffset = flatOffset; e.ringCount = ringCount; e.radius = radius;
                        e.color = color; e.secondaryColor = secondaryColor;
                        e.materialParams[0] = anisotropy; e.materialParams[1] = sheenStrength; e.materialParams[2] = roughness; e.materialParams[3] = twistAngle;
                        e.styleParams[0] = blendRatio; e.styleParams[1] = blendNoiseScale; e.styleParams[2] = enableBlend; e.styleParams[3] = 0;
                        flatOffset += ringCount * 3;
                        totalVertices += ringCount * sides;
                        totalIndices += (ringCount - 1) * sides * 6;
                    }
                    segStart = segEnd;
                }
            } else {
                // No tears — render as single continuous rope
                const ringCount = _resampleFlat(this, comp.particles, subdiv, flatOffset);
                if (ringCount < 2) continue;
                
                const e = this._getPooledEntry(entryIdx++);
                e.ptsOffset = flatOffset; e.ringCount = ringCount; e.radius = radius;
                e.color = color; e.secondaryColor = secondaryColor;
                e.materialParams[0] = anisotropy; e.materialParams[1] = sheenStrength; e.materialParams[2] = roughness; e.materialParams[3] = twistAngle;
                e.styleParams[0] = blendRatio; e.styleParams[1] = blendNoiseScale; e.styleParams[2] = enableBlend; e.styleParams[3] = 0;
                flatOffset += ringCount * 3;
                totalVertices += ringCount * sides;
                totalIndices += (ringCount - 1) * sides * 6;
            }
        }
        
        this._ropeEntryCount = entryIdx;
        if (entryIdx === 0) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }
        
        this._buildTubeMeshes(this._ropeEntryPool, totalVertices, totalIndices, entryIdx);
    }

    /**
     * Update rope meshes from unified particle system (Phase 3)
     * Reads rope particle positions from ropeChains metadata
     * @param {Object} particleWorld - Particle world with ropeChains
     * @param {Array} particles - Optional pre-extracted particle positions per rope
     */
    updateFromRopeChains(particleWorld, particles = null) {
        const ropeChains = particleWorld?.ropeChains;
        if (!ropeChains || ropeChains.length === 0) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }

        const sides = this.sides;
        const subdiv = Math.max(1, this.subdivisions | 0);

        let entryIdx = 0;
        let totalVertices = 0;
        let totalIndices = 0;
        let flatOffset = 0;

        for (let i = 0; i < ropeChains.length; i++) {
            const rope = ropeChains[i];
            if (!rope || rope.particleCount < 2) continue;

            const radius = Number.isFinite(rope.radius) ? rope.radius : 0.05;
            const color = Array.isArray(rope.color) ? rope.color : this._defaultColor;
            
            const anisotropy = rope.anisotropy ?? 0.5;
            const sheenStrength = rope.sheenStrength ?? 0.3;
            const roughness = rope.roughness ?? 0.6;
            const ropeLength = rope.length ?? 2.0;
            const twistAngle = (rope.twistRate ?? 2.0) * ropeLength;
            const secondaryColor = Array.isArray(rope.secondaryColor) ? rope.secondaryColor : this._defaultSecColor;
            const enableBlend = rope.enableColorBlend ? 1.0 : 0.0;
            const blendRatio = rope.blendRatio ?? 0.5;
            const blendNoiseScale = rope.blendNoiseScale ?? 5.0;

            // Get particles for this rope
            let ropeParticles;
            if (particles && particles[i]) {
                ropeParticles = particles[i];
            } else if (rope.particles) {
                ropeParticles = rope.particles;
            } else {
                continue;
            }

            if (ropeParticles.length < 2) continue;

            const ringCount = _resampleFlat(this, ropeParticles, subdiv, flatOffset);
            if (ringCount < 2) continue;

            const e = this._getPooledEntry(entryIdx++);
            e.ptsOffset = flatOffset; e.ringCount = ringCount; e.radius = radius;
            e.color = color; e.secondaryColor = secondaryColor;
            e.materialParams[0] = anisotropy; e.materialParams[1] = sheenStrength; e.materialParams[2] = roughness; e.materialParams[3] = twistAngle;
            e.styleParams[0] = blendRatio; e.styleParams[1] = blendNoiseScale; e.styleParams[2] = enableBlend; e.styleParams[3] = 0;
            flatOffset += ringCount * 3;
            totalVertices += ringCount * sides;
            totalIndices += (ringCount - 1) * sides * 6;
        }

        this._ropeEntryCount = entryIdx;
        if (entryIdx === 0) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }

        this._buildTubeMeshes(this._ropeEntryPool, totalVertices, totalIndices, entryIdx);
    }

    /**
     * Legacy method - update from editor.physicsSimulations Map
     */
    updateFromSimulations(simulations) {
        if (!simulations || simulations.size === 0) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }

        const sides = this.sides;
        const subdiv = Math.max(1, this.subdivisions | 0);

        let entryIdx = 0;
        let totalVertices = 0;
        let totalIndices = 0;
        let flatOffset = 0;

        for (const [entityId, sim] of simulations) {
            if (sim?.type !== 'rope') continue;
            
            if (!sim.particles || sim.particles.length < 2) continue;

            const opts = sim.opts || {};
            const color = Array.isArray(opts.color) ? opts.color : this._defaultColor;
            const threadCount = sim.threadCount ?? 1;
            
            // Extract material properties for anisotropic shading
            const anisotropy = opts.anisotropy ?? 0.5;
            const sheenStrength = opts.sheenStrength ?? 0.3;
            const roughness = opts.roughness ?? 0.6;
            const twistRate = opts.twistRate ?? 2.0;
            const ropeLength = opts.length ?? sim.ropeLength ?? 2.0;
            const twistAngle = twistRate * ropeLength;
            const secondaryColor = Array.isArray(opts.secondaryColor) ? opts.secondaryColor : this._defaultSecColor;
            const enableBlend = opts.enableColorBlend ? 1.0 : 0.0;
            const blendRatio = opts.blendRatio ?? 0.5;
            const blendNoiseScale = opts.blendNoiseScale ?? 5.0;
            
            // Multi-thread rope: render each thread as a separate tube
            if (threadCount > 1 && sim.threadParticles && sim.threadParticles.length > 1) {
                const threadRadius = Number.isFinite(opts.threadRadius) ? opts.threadRadius : 0.002;
                
                for (const threadArr of sim.threadParticles) {
                    if (!threadArr || threadArr.length < 2) continue;
                    
                    const ringCount = _resampleFlat(this, threadArr, subdiv, flatOffset);
                    if (ringCount < 2) continue;
                    
                    const e = this._getPooledEntry(entryIdx++);
                    e.ptsOffset = flatOffset; e.ringCount = ringCount; e.radius = threadRadius;
                    e.color = color; e.secondaryColor = secondaryColor;
                    e.materialParams[0] = anisotropy; e.materialParams[1] = sheenStrength; e.materialParams[2] = roughness; e.materialParams[3] = twistAngle;
                    e.styleParams[0] = blendRatio; e.styleParams[1] = blendNoiseScale; e.styleParams[2] = enableBlend; e.styleParams[3] = 0;
                    flatOffset += ringCount * 3;
                    totalVertices += ringCount * sides;
                    totalIndices += (ringCount - 1) * sides * 6;
                }
            } else {
                // Single-thread rope: render as single tube
                const radius = Number.isFinite(opts.radius) ? opts.radius : 0.05;

                const ringCount = _resampleFlat(this, sim.particles, subdiv, flatOffset);
                if (ringCount < 2) continue;

                const e = this._getPooledEntry(entryIdx++);
                e.ptsOffset = flatOffset; e.ringCount = ringCount; e.radius = radius;
                e.color = color; e.secondaryColor = secondaryColor;
                e.materialParams[0] = anisotropy; e.materialParams[1] = sheenStrength; e.materialParams[2] = roughness; e.materialParams[3] = twistAngle;
                e.styleParams[0] = blendRatio; e.styleParams[1] = blendNoiseScale; e.styleParams[2] = enableBlend; e.styleParams[3] = 0;
                flatOffset += ringCount * 3;
                totalVertices += ringCount * sides;
                totalIndices += (ringCount - 1) * sides * 6;
            }
        }

        this._ropeEntryCount = entryIdx;
        if (entryIdx === 0) {
            this.vertexCount = 0;
            this.indexCount = 0;
            return;
        }

        this._buildTubeMeshes(this._ropeEntryPool, totalVertices, totalIndices, entryIdx);
    }

    /**
     * Build tube meshes from rope entries (shared by both update methods)
     * Each entry: { pts, ringCount, radius, color, materialParams, secondaryColor, styleParams }
     */
    _buildTubeMeshes(ropeEntries, totalVertices, totalIndices, entryCount) {
        const sides = this.sides;
        if (entryCount === undefined) entryCount = ropeEntries.length;
        
        this._grow(totalVertices, totalIndices);

        const vData = this._vertexData;
        const iData = this._indexData;
        const flatPoints = this._flatPoints;

        let vi = 0;
        let ii = 0;
        let vBase = 0;

        for (let ei = 0; ei < entryCount; ei++) {
            const entry = ropeEntries[ei];
            const pOff = entry.ptsOffset;
            const ringCount = entry.ringCount;
            const radius = entry.radius;
            const color = entry.color;
            
            // Material params: [anisotropy, sheenStrength, roughness, twistAngle]
            const matParams = entry.materialParams || [0.5, 0.3, 0.6, 0.0];
            // Secondary color for marled blending
            const secColor = entry.secondaryColor || [0.9, 0.85, 0.8, 1.0];
            // Style params: [blendRatio, blendNoiseScale, enableBlend, unused]
            const styleParams = entry.styleParams || [0.0, 5.0, 0.0, 0.0];

            // Use scalar variables for frame vectors (avoids ~5 array allocations per ring)
            let upx = 0, upy = 1, upz = 0;
            let dist = 0;

            for (let r = 0; r < ringCount; r++) {
                // Read current, previous, next points from flat buffer
                const rOff = pOff + r * 3;
                const px = flatPoints[rOff], py = flatPoints[rOff+1], pz = flatPoints[rOff+2];
                const prevR = Math.max(0, r - 1), nextR = Math.min(ringCount - 1, r + 1);
                const prOff = pOff + prevR * 3, nrOff = pOff + nextR * 3;
                const prevX = flatPoints[prOff], prevY = flatPoints[prOff+1], prevZ = flatPoints[prOff+2];
                const nextX = flatPoints[nrOff], nextY = flatPoints[nrOff+1], nextZ = flatPoints[nrOff+2];

                if (r > 0) {
                    dist += _len(px - prevX, py - prevY, pz - prevZ);
                }

                // Tangent direction (inline normalize — avoids array allocation)
                const ddx = nextX - prevX, ddy = nextY - prevY, ddz = nextZ - prevZ;
                const dl = Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz) || 1;
                const tx = ddx/dl, ty = ddy/dl, tz = ddz/dl;

                // Right = cross(tangent, up) — inline
                let rx = ty*upz - tz*upy, ry = tz*upx - tx*upz, rz = tx*upy - ty*upx;
                let rl = Math.sqrt(rx*rx + ry*ry + rz*rz);
                if (rl < 1e-4) {
                    upx = 1; upy = 0; upz = 0;
                    rx = ty*upz - tz*upy; ry = tz*upx - tx*upz; rz = tx*upy - ty*upx;
                    rl = Math.sqrt(rx*rx + ry*ry + rz*rz);
                }
                const invRl = 1 / (rl || 1);
                rx *= invRl; ry *= invRl; rz *= invRl;

                // Binormal = cross(right, tangent), normalized — inline
                const bx = ry*tz - rz*ty, by = rz*tx - rx*tz, bz = rx*ty - ry*tx;
                const bl = Math.sqrt(bx*bx + by*by + bz*bz) || 1;
                upx = bx/bl; upy = by/bl; upz = bz/bl;

                for (let s = 0; s < sides; s++) {
                    const a = (s / sides) * _TAU;
                    const cx = Math.cos(a);
                    const sx = Math.sin(a);

                    const ox = (rx * cx + upx * sx) * radius;
                    const oy = (ry * cx + upy * sx) * radius;
                    const oz = (rz * cx + upz * sx) * radius;

                    const nl = Math.sqrt(ox*ox + oy*oy + oz*oz) || 1;

                    // Position (3)
                    vData[vi++] = px + ox;
                    vData[vi++] = py + oy;
                    vData[vi++] = pz + oz;

                    // Normal (3)
                    vData[vi++] = ox / nl;
                    vData[vi++] = oy / nl;
                    vData[vi++] = oz / nl;

                    // UV (2)
                    vData[vi++] = s / sides;
                    vData[vi++] = dist;

                    // Color (4)
                    vData[vi++] = color[0];
                    vData[vi++] = color[1];
                    vData[vi++] = color[2];
                    vData[vi++] = color[3];
                    
                    // Tangent (3)
                    vData[vi++] = tx;
                    vData[vi++] = ty;
                    vData[vi++] = tz;
                    
                    // Material params (4): anisotropy, sheenStrength, roughness, twistAngle
                    vData[vi++] = matParams[0];
                    vData[vi++] = matParams[1];
                    vData[vi++] = matParams[2];
                    vData[vi++] = matParams[3];
                    
                    // Secondary color (4)
                    vData[vi++] = secColor[0];
                    vData[vi++] = secColor[1];
                    vData[vi++] = secColor[2];
                    vData[vi++] = secColor[3];
                    
                    // Style params (4): blendRatio, blendNoiseScale, enableBlend, unused
                    vData[vi++] = styleParams[0];
                    vData[vi++] = styleParams[1];
                    vData[vi++] = styleParams[2];
                    vData[vi++] = styleParams[3];
                }
            }

            for (let r = 0; r < ringCount - 1; r++) {
                const ring0 = vBase + r * sides;
                const ring1 = vBase + (r + 1) * sides;
                for (let s = 0; s < sides; s++) {
                    const s1 = (s + 1) % sides;
                    const a = ring0 + s;
                    const b = ring0 + s1;
                    const c = ring1 + s;
                    const d = ring1 + s1;

                    iData[ii++] = a;
                    iData[ii++] = c;
                    iData[ii++] = b;

                    iData[ii++] = b;
                    iData[ii++] = c;
                    iData[ii++] = d;
                }
            }

            vBase += ringCount * sides;
        }

        this.vertexCount = vi / this.floatsPerVertex;
        this.indexCount = ii;

        if (this.vertexCount > 0 && this.indexCount > 0) {
            this.device.queue.writeBuffer(this.vertexBuffer, 0, this._vertexData.buffer, 0, vi * 4);
            this.device.queue.writeBuffer(this.indexBuffer, 0, this._indexData.buffer, 0, ii * 4);
        }
    }

    render(pass, viewProjMatrix, cameraPos = [0, 0, 5], lightDir = [0.5, 1.0, 0.3]) {
        if (!this.initialized || this.indexCount === 0) return;

        // Uniforms: viewProj(64) + cameraPos(12) + pad(4) + lightDir(12) + pad(4) = 96 bytes
        if (!this._uniformData) this._uniformData = new Float32Array(24);
        const u = this._uniformData;
        u.set(viewProjMatrix, 0);    // 0-15: viewProj (mat4)
        u[16] = cameraPos[0];        // 16-18: cameraPos
        u[17] = cameraPos[1];
        u[18] = cameraPos[2];
        u[19] = 0;                   // 19: padding
        u[20] = lightDir[0];         // 20-22: lightDir
        u[21] = lightDir[1];
        u[22] = lightDir[2];
        u[23] = 0;                   // 23: padding
        this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, 'uint32');
        pass.drawIndexed(this.indexCount);
    }

    destroy() {
        if (this._disposed) return false;
        if (this.vertexBuffer) this.vertexBuffer.destroy();
        if (this.indexBuffer) this.indexBuffer.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        if (this._shadowUniformBuffer) this._shadowUniformBuffer.destroy();
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.uniformBuffer = null;
        this._shadowUniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
        this._shadowPipeline = null;
        this._shadowBindGroup = null;
        this._uniformData = null;
        this._vertexData = new Float32Array(0);
        this._indexData = new Uint32Array(0);
        this._flatPoints = new Float32Array(0);
        this._ropeEntryPool = [];
        this._ropeEntryCount = 0;
        this._activeRopeIds = Object.freeze([]);
        this._activeSegmentIds = Object.freeze([]);
        this.vertexCount = 0;
        this.indexCount = 0;
        this.initialized = false;
        this._disposed = true;
        return true;
    }
}
