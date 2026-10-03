// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class ProceduralMaterialBaker {
    constructor() {
        this.device = null;
        this.initialized = false;

        this.pipeline = null;
        this.bindGroupLayout = null;
        this.bindGroup = null;
        this.uniformBuffer = null;

        this._uniformData = new ArrayBuffer(64);
        this._uniformView = new DataView(this._uniformData);

        this._baseColorTex = null;
        this._normalTex = null;
        this._ormTex = null;
        this._heightTex = null;

        this._baseColorView = null;
        this._normalView = null;
        this._ormView = null;
        this._heightView = null;

        this._width = 0;
        this._height = 0;
    }

    async init(device, targets, width, height) {
        this.device = device;

        this._baseColorTex = targets.baseColor;
        this._normalTex = targets.normal;
        this._ormTex = targets.orm;
        this._heightTex = targets.height;

        this._width = width;
        this._height = height;

        const shaderCode = /* wgsl */ `
struct BakeParams {
    size: vec2<u32>,
    layer: u32,
    seed: u32,
    scale: f32,
    _pad: vec3<f32>,
    baseColor: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: BakeParams;
@group(0) @binding(1) var outBaseColor: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(2) var outNormal: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var outOrm: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(4) var outHeight: texture_storage_2d_array<rgba16float, write>;

fn hash22(p: vec2<f32>) -> vec2<f32> {
    var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

fn perlinNoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    
    // Quintic interpolation (smoother than cubic)
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    
    // Generate gradients at grid corners
    let ga = hash22(i + vec2<f32>(0.0, 0.0)) * 2.0 - 1.0;
    let gb = hash22(i + vec2<f32>(1.0, 0.0)) * 2.0 - 1.0;
    let gc = hash22(i + vec2<f32>(0.0, 1.0)) * 2.0 - 1.0;
    let gd = hash22(i + vec2<f32>(1.0, 1.0)) * 2.0 - 1.0;
    
    // Compute dot products with distance vectors
    let va = dot(ga, f - vec2<f32>(0.0, 0.0));
    let vb = dot(gb, f - vec2<f32>(1.0, 0.0));
    let vc = dot(gc, f - vec2<f32>(0.0, 1.0));
    let vd = dot(gd, f - vec2<f32>(1.0, 1.0));
    
    // Bilinear interpolation
    return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 0.5 + 0.5;
}

fn fbm(p: vec2<f32>) -> f32 {
    var sum = 0.0;
    var amp = 0.5;
    var freq = 1.0;

    for (var i = 0; i < 5; i++) {
        sum += perlinNoise(p * freq) * amp;
        freq *= 2.0;
        amp *= 0.5;
    }

    return sum;
}

fn heightField(uv: vec2<f32>, seedF: f32, scale: f32) -> f32 {
    let p = uv * scale + vec2<f32>(seedF, seedF * 1.37);
    return fbm(p);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.size.x || gid.y >= params.size.y) {
        return;
    }

    let uv = (vec2<f32>(f32(gid.x) + 0.5, f32(gid.y) + 0.5) / vec2<f32>(f32(params.size.x), f32(params.size.y)));

    let seedF = f32(params.seed) * 0.001;

    let h = heightField(uv, seedF, params.scale);
    h = clamp(h, 0.0, 1.0);

    let eps = 1.0 / f32(max(params.size.x, params.size.y));
    let hx = heightField(uv + vec2<f32>(eps, 0.0), seedF, params.scale);
    let hy = heightField(uv + vec2<f32>(0.0, eps), seedF, params.scale);

    // Height -> normal (tangent space)
    let strength = 2.0;
    let dx = (hx - h) * strength;
    let dy = (hy - h) * strength;
    let nxy = normalize(vec3<f32>(-dx, -dy, 1.0));

    // BaseColor: subtle shading modulation from height
    let shade = 0.85 + 0.3 * h;
    let rgb = clamp(params.baseColor.rgb * shade, vec3<f32>(0.0), vec3<f32>(1.0));
    textureStore(outBaseColor, vec2<i32>(gid.xy), i32(params.layer), vec4<f32>(rgb, params.baseColor.a));

    // Normal: store XY in RG of rgba16float
    textureStore(outNormal, vec2<i32>(gid.xy), i32(params.layer), vec4<f32>(nxy.xy, 0.0, 0.0));

    // ORM (occlusion, roughness, metallic, heightPacked)
    let ao = 1.0 - (h * 0.15);
    let roughness = clamp(0.35 + h * 0.45, 0.04, 1.0);
    let metallic = 0.0;
    textureStore(outOrm, vec2<i32>(gid.xy), i32(params.layer), vec4<f32>(ao, roughness, metallic, h));

    // Height (stored in R of rgba16float)
    textureStore(outHeight, vec2<i32>(gid.xy), i32(params.layer), vec4<f32>(h, 0.0, 0.0, 1.0));
}
`;

        const module = device.createShaderModule({
            label: 'ProceduralMaterialBaker',
            code: shaderCode,
        });

        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'ProceduralMaterialBakerLayout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d-array' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d-array' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
            ],
        });

        this.uniformBuffer = device.createBuffer({
            label: 'ProceduralMaterialBakerParams',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this._baseColorView = this._baseColorTex.createView({
            dimension: '2d-array',
            baseMipLevel: 0,
            mipLevelCount: 1,
        });

        this._normalView = this._normalTex.createView({
            dimension: '2d-array',
            baseMipLevel: 0,
            mipLevelCount: 1,
        });

        this._ormView = this._ormTex.createView({
            dimension: '2d-array',
            baseMipLevel: 0,
            mipLevelCount: 1,
        });

        this._heightView = this._heightTex.createView({
            dimension: '2d-array',
            baseMipLevel: 0,
            mipLevelCount: 1,
        });

        this.bindGroup = device.createBindGroup({
            label: 'ProceduralMaterialBakerBindGroup',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this._baseColorView },
                { binding: 2, resource: this._normalView },
                { binding: 3, resource: this._ormView },
                { binding: 4, resource: this._heightView },
            ],
        });

        this.pipeline = device.createComputePipeline({
            label: 'ProceduralMaterialBakerPipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
            compute: { module, entryPoint: 'main' },
        });

        this.initialized = true;
    }

    bakeLayer(options = {}) {
        if (!this.initialized) return;

        const layer = options.layer >>> 0;
        const seed = (options.seed ?? layer) >>> 0;
        const scale = Number(options.scale ?? 8.0);
        const baseColor = Array.isArray(options.baseColor) ? options.baseColor : [1, 1, 1, 1];

        this._uniformView.setUint32(0, this._width >>> 0, true);
        this._uniformView.setUint32(4, this._height >>> 0, true);
        this._uniformView.setUint32(8, layer, true);
        this._uniformView.setUint32(12, seed, true);
        this._uniformView.setFloat32(16, scale, true);

        const bcOffset = 32;
        this._uniformView.setFloat32(bcOffset + 0, Number(baseColor[0] ?? 1), true);
        this._uniformView.setFloat32(bcOffset + 4, Number(baseColor[1] ?? 1), true);
        this._uniformView.setFloat32(bcOffset + 8, Number(baseColor[2] ?? 1), true);
        this._uniformView.setFloat32(bcOffset + 12, Number(baseColor[3] ?? 1), true);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);

        const encoder = this.device.createCommandEncoder({ label: 'ProceduralMaterialBakerEncoder' });
        const pass = encoder.beginComputePass({ label: 'ProceduralMaterialBakerPass' });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(this._width / 8), Math.ceil(this._height / 8), 1);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
    }

    bakeAll(layers, getLayerParams) {
        if (!this.initialized) return;
        const count = layers >>> 0;

        for (let layer = 0; layer < count; layer++) {
            const params = typeof getLayerParams === 'function' ? (getLayerParams(layer) || {}) : {};
            this.bakeLayer({
                layer,
                seed: params.seed ?? layer,
                scale: params.scale,
                baseColor: params.baseColor,
            });
        }
    }
}

export default ProceduralMaterialBaker;
