// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GridRenderer - Infinite grid for 3D viewport
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const GRID_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    gridSize: f32,
    gridColor: vec4<f32>,
    axisColorX: vec4<f32>,
    axisColorZ: vec4<f32>,
    sunDir: vec3<f32>,
    sunIntensity: f32,
    sunColor: vec3<f32>,
    ambientIntensity: f32,
    ambientColor: vec3<f32>,
    groundOpacity: f32,
    backgroundColor: vec4<f32>,
    minorColor: vec4<f32>,
    majorColor: vec4<f32>,
    paletteOptions: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) nearPoint: vec3<f32>,
    @location(2) farPoint: vec3<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Full-screen quad
    let x = f32((vertexIndex & 1u) << 1u) - 1.0;
    let y = f32(vertexIndex & 2u) - 1.0;
    
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    
    // Unproject near and far points
    let invViewProj = uniforms.viewProj; // Will be inverted on CPU
    let nearPoint = unproject(vec3<f32>(x, y, 0.0), invViewProj);
    let farPoint = unproject(vec3<f32>(x, y, 1.0), invViewProj);
    
    output.nearPoint = nearPoint;
    output.farPoint = farPoint;
    output.worldPos = nearPoint;
    
    return output;
}

fn unproject(screenPos: vec3<f32>, invViewProj: mat4x4<f32>) -> vec3<f32> {
    let pos = invViewProj * vec4<f32>(screenPos, 1.0);
    return pos.xyz / pos.w;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Ray from near to far
    let ray = input.farPoint - input.nearPoint;
    let t = -input.nearPoint.y / ray.y;
    
    // Discard if no intersection with y=0 plane
    if (t < 0.0) {
        discard;
    }
    
    let worldPos = input.nearPoint + ray * t;
    
    // Distance fade + atmospheric fog
    let distFromCamera = length(worldPos - uniforms.cameraPos);
    let fade = 1.0 - clamp(distFromCamera / 500.0, 0.0, 1.0);
    let fadeSq = fade * fade;
    let fogFactor = exp(-distFromCamera * 0.002); // subtle exponential distance fog
    
    // Ground plane lighting (normal is always up)
    let groundNormal = vec3<f32>(0.0, 1.0, 0.0);
    let toSun = normalize(-uniforms.sunDir);
    let sunDot = max(dot(groundNormal, toSun), 0.0);
    let ambient = uniforms.ambientColor * uniforms.ambientIntensity;
    let sun = uniforms.sunColor * uniforms.sunIntensity * sunDot;
    let lighting = ambient + sun;
    
    // Sky color for fog and reflections
    let skyBase = uniforms.ambientColor * uniforms.ambientIntensity * 0.6
               + uniforms.sunColor * uniforms.sunIntensity * 0.08;
    let legacySkyColor = vec3<f32>(0.12, 0.13, 0.18) + skyBase;
    let paletteMix = uniforms.paletteOptions.x;
    let skyColor = mix(legacySkyColor, uniforms.backgroundColor.rgb, paletteMix);
    
    // Subtle Fresnel reflection — very faint sky sheen at grazing angles
    let viewDir = normalize(uniforms.cameraPos - worldPos);
    let NdV = max(dot(groundNormal, viewDir), 0.0);
    let fresnel = 0.04 + (1.0 - 0.04) * pow(1.0 - NdV, 5.0);
    let reflDir = reflect(-viewDir, groundNormal);
    let reflSky = skyColor + uniforms.sunColor * uniforms.sunIntensity * 0.06 * max(reflDir.y, 0.0);
    
    // Specular highlight from sun (tight, subtle)
    let halfVec = normalize(toSun + viewDir);
    let NdH = max(dot(groundNormal, halfVec), 0.0);
    let specPow = pow(NdH, 128.0);
    let specular = uniforms.sunColor * uniforms.sunIntensity * specPow * 0.1 * sunDot;
    
    // Checkerboard pattern — warm neutral grey-blue (Blender/Unity style)
    let scale = uniforms.gridSize;
    let chk = step(0.5, fract(floor(worldPos.x / scale) * 0.5 + floor(worldPos.z / scale) * 0.5));
    let darkTile  = vec3<f32>(0.22, 0.22, 0.24);
    let lightTile = vec3<f32>(0.28, 0.28, 0.30);
    let legacyCheckerColor = mix(darkTile, lightTile, chk);
    let neutralDarkTile = uniforms.backgroundColor.rgb * 0.94;
    let neutralLightTile = uniforms.backgroundColor.rgb * 0.98;
    let neutralCheckerColor = mix(neutralDarkTile, neutralLightTile, chk);
    let checkerColor = mix(legacyCheckerColor, neutralCheckerColor, paletteMix);
    let litChecker = checkerColor * lighting + specular;
    
    // Very subtle reflection (0.12 = faint sheen, not wet mirror)
    let reflectedColor = mix(litChecker, reflSky, fresnel * 0.12);
    
    // Axis lines on top of checker (thin, anti-aliased)
    let coord = worldPos.xz / scale;
    let grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    let line = min(grid.x, grid.y);
    let legacyLineStrength = (1.0 - min(line, 1.0)) * 0.25;

    let majorScale = scale * max(uniforms.paletteOptions.y, 1.0);
    let majorCoord = worldPos.xz / majorScale;
    let majorGrid = abs(fract(majorCoord - 0.5) - 0.5) / fwidth(majorCoord);
    let majorLine = min(majorGrid.x, majorGrid.y);
    let minorStrength = (1.0 - min(line, 1.0)) * uniforms.minorColor.a;
    let majorStrength = (1.0 - min(majorLine, 1.0)) * uniforms.majorColor.a;
    let configuredLineStrength = max(minorStrength, majorStrength);
    var lineStrength = mix(legacyLineStrength, configuredLineStrength, paletteMix);
    
    let configuredLineColor = select(
        uniforms.minorColor.rgb,
        uniforms.majorColor.rgb,
        majorStrength > minorStrength
    );
    var lineColor = mix(uniforms.gridColor.rgb, configuredLineColor, paletteMix);
    let axisThreshold = 0.05;
    if (abs(worldPos.x) < axisThreshold) {
        lineColor = mix(lineColor, uniforms.axisColorZ.rgb, 0.9);
        lineStrength = max(lineStrength, mix(0.6, uniforms.axisColorZ.a * 0.6, paletteMix));
    }
    if (abs(worldPos.z) < axisThreshold) {
        lineColor = mix(lineColor, uniforms.axisColorX.rgb, 0.9);
        lineStrength = max(lineStrength, mix(0.6, uniforms.axisColorX.a * 0.6, paletteMix));
    }
    
    let litLineColor = lineColor * lighting;
    var finalColor = mix(reflectedColor, litLineColor, lineStrength * fadeSq);
    
    // Distance fog — blend toward sky color at far distances
    finalColor = mix(skyColor, finalColor, fogFactor);
    
    let finalAlpha = max(uniforms.groundOpacity * fadeSq, lineStrength * fadeSq);
    
    if (finalAlpha < 0.01) {
        discard;
    }
    
    return vec4<f32>(finalColor, finalAlpha);
}
`;

export class GridRenderer {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroup = null;
        this.uniformData = new Float32Array(60);
        
        this.gridSize = 1.0;
        this.gridColor = [0.35, 0.35, 0.38, 0.5];  // neutral grey grid lines
        this.axisColorX = [0.9, 0.3, 0.3, 1.0];
        this.axisColorZ = [0.3, 0.4, 1.0, 1.0];
        this.solidFloor = false;

        // Disabled by default so every existing viewport retains its exact
        // appearance. Construct opts into the neutral palette explicitly.
        this._paletteMix = 0;
        this._backgroundColor = [0.12, 0.13, 0.18, 1.0];
        this._minorColor = [...this.gridColor];
        this._majorColor = [...this.gridColor];
        this._majorEvery = 10;
        this._groundOpacity = null;
    }
    
    async initialize(format) {
        // Create shader using vGPU
        const shaderModule = this.vgpu.shader.compile('grid', GRID_SHADER);
        
        // Create uniform buffer using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({
            size: this.uniformData.byteLength,
            usage: 'uniform',
            label: 'GridUniforms'
        }).buffer;
        
        // Create bind group layout using vGPU
        const bindGroupLayout = this.vgpu.bindings.defineLayout('grid', [{
            binding: 0, type: 'uniform', visibility: 'vertex|fragment'
        }]);
        
        // Create bind group using vGPU
        this.bindGroup = this.vgpu.bindings.createGroup(bindGroupLayout, [{
            binding: 0, buffer: this.uniformBuffer
        }]);
        
        // Create pipeline using vGPU
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            layouts: [bindGroupLayout],
            colorFormat: format,
            blend: 'alpha',
            topology: 'triangle-strip',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'less',
            label: 'GridPipeline'
        });
    }
    
    render(passEncoder, viewProjMatrix, cameraPos) {
        if (!this.pipeline) return;
        
        // Update uniforms
        // ViewProj matrix (16 floats)
        this.uniformData.set(viewProjMatrix, 0);
        
        // Camera position + grid size (4 floats)
        this.uniformData[16] = cameraPos[0];
        this.uniformData[17] = cameraPos[1];
        this.uniformData[18] = cameraPos[2];
        this.uniformData[19] = this.gridSize;
        
        const paletteOpacity = this._groundOpacity ?? 1;
        const scaledPaletteColor = color => [color[0], color[1], color[2], color[3] * paletteOpacity];

        // Grid color (4 floats)
        this.uniformData.set(this._paletteMix ? scaledPaletteColor(this.gridColor) : this.gridColor, 20);

        // Axis colors (8 floats)
        this.uniformData.set(this._paletteMix ? scaledPaletteColor(this.axisColorX) : this.axisColorX, 24);
        this.uniformData.set(this._paletteMix ? scaledPaletteColor(this.axisColorZ) : this.axisColorZ, 28);
        
        // Lighting data (offsets 32-43)
        // sunDir (3) + sunIntensity (1) + sunColor (3) + ambientIntensity (1) + ambientColor (3) + pad (1)
        this.uniformData[32] = this._sunDir?.[0] ?? 0.2;
        this.uniformData[33] = this._sunDir?.[1] ?? -1.0;
        this.uniformData[34] = this._sunDir?.[2] ?? 0.1;
        this.uniformData[35] = this._sunIntensity ?? 1.0;
        this.uniformData[36] = this._sunColor?.[0] ?? 1.0;
        this.uniformData[37] = this._sunColor?.[1] ?? 0.95;
        this.uniformData[38] = this._sunColor?.[2] ?? 0.85;
        this.uniformData[39] = this._ambientIntensity ?? 0.3;
        this.uniformData[40] = this._ambientColor?.[0] ?? 0.15;
        this.uniformData[41] = this._ambientColor?.[1] ?? 0.15;
        this.uniformData[42] = this._ambientColor?.[2] ?? 0.2;
        this.uniformData[43] = this.solidFloor ? 0.97 : 0.95;

        // Optional neutral-workspace palette (offsets 44-59).
        this.uniformData.set(this._backgroundColor, 44);
        this.uniformData.set(this._paletteMix ? scaledPaletteColor(this._minorColor) : this._minorColor, 48);
        this.uniformData.set(this._paletteMix ? scaledPaletteColor(this._majorColor) : this._majorColor, 52);
        this.uniformData[56] = this._paletteMix;
        this.uniformData[57] = this._majorEvery;
        this.uniformData[58] = 0;
        this.uniformData[59] = 0;
        if (this._groundOpacity !== null) {
            this.uniformData[43] = this._groundOpacity;
        }
        
        // Write to buffer
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
        
        // Draw
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.draw(4, 1, 0, 0);
    }
    
    /**
     * Update lighting parameters from LightManager
     */
    setLighting(lightManager) {
        if (!lightManager) return;
        this._sunDir = lightManager.sunDirection;
        this._sunColor = lightManager.sunColor;
        this._sunIntensity = lightManager.enableSun ? lightManager.sunIntensity : 0;
        this._ambientColor = lightManager.ambientColor;
        this._ambientIntensity = lightManager.ambientIntensity;
    }

    /**
     * Opt this renderer into a configurable neutral-workspace palette.
     * Existing callers are unaffected until they invoke this method.
     */
    setPalette({
        background,
        minor,
        major,
        axisX,
        axisZ,
        opacity,
        majorEvery
    } = {}) {
        const nextBackground = validateColor(background, 'background');
        const nextMinor = validateColor(minor, 'minor');
        const nextMajor = validateColor(major, 'major');
        const nextAxisX = validateColor(axisX, 'axisX');
        const nextAxisZ = validateColor(axisZ, 'axisZ');
        const nextOpacity = validateUnitInterval(opacity, 'opacity');
        const nextMajorEvery = validateMajorEvery(majorEvery);

        this._backgroundColor = nextBackground;
        this._minorColor = nextMinor;
        this._majorColor = nextMajor;
        this.axisColorX = nextAxisX;
        this.axisColorZ = nextAxisZ;
        this.gridColor = nextMinor;
        this._groundOpacity = nextOpacity;
        this._majorEvery = nextMajorEvery;
        this._paletteMix = 1;
    }
    
    destroy() {
        if (this.uniformBuffer) {
            this.uniformBuffer.destroy();
        }
    }
}

function validateColor(value, name) {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
        throw new TypeError(`Grid palette ${name} must be an RGBA array`);
    }
    if (value.length !== 4) {
        throw new RangeError(`Grid palette ${name} must contain exactly four channels`);
    }

    const color = Array.from(value, Number);
    if (color.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1)) {
        throw new RangeError(`Grid palette ${name} channels must be finite values from 0 to 1`);
    }
    return color;
}

function validateUnitInterval(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
        throw new RangeError(`Grid palette ${name} must be a finite value from 0 to 1`);
    }
    return number;
}

function validateMajorEvery(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > 1024) {
        throw new RangeError('Grid palette majorEvery must be an integer from 1 to 1024');
    }
    return number;
}
