// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TransformGizmo - Visual handles for manipulating entity transforms
 * Now powered by vGPU driver
 */

import { raySphere, sdfCapsule } from '../../core/math/MathGeometry.js';
import { quatConjugate, quatNormalize } from '../../core/math/MathQuat.js';
import { vec3TransformQuat } from '../../core/math/MathVec3.js';
import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { destroyBuffers } from '../../core/gpu/GpuBuffer.js';

// Reusable buffers for hot render path (reduce/reuse/recycle)
const _ringModelMatrix = new Float32Array(16);
const _axisModelMatrix = new Float32Array(16);
const GIZMO_MODES = new Set(['combined', 'translate', 'rotate', 'scale']);

function normalizedGizmoMode(value) {
    return GIZMO_MODES.has(value) ? value : 'combined';
}

function normalizedGizmoOrientation(value) {
    if (value == null) return null;
    if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length < 4) return null;
    const quaternion = [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])];
    return quaternion.every(Number.isFinite) ? quatNormalize(quaternion) : null;
}

function orientModelBasis(matrix, orientation) {
    if (!orientation) return matrix;
    for (let column = 0; column < 3; column += 1) {
        const offset = column * 4;
        const rotated = vec3TransformQuat([
            matrix[offset],
            matrix[offset + 1],
            matrix[offset + 2],
        ], orientation);
        matrix[offset] = rotated[0];
        matrix[offset + 1] = rotated[1];
        matrix[offset + 2] = rotated[2];
    }
    return matrix;
}

const GIZMO_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
    model: mat4x4<f32>,
    color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) worldPos: vec3<f32>,
    @location(2) localPos: vec3<f32>,
}

// Hash for procedural noise
fn gizmoHash(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Smooth 3D noise
fn gizmoNoise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(mix(gizmoHash(i), gizmoHash(i + vec3(1.0, 0.0, 0.0)), u.x),
            mix(gizmoHash(i + vec3(0.0, 1.0, 0.0)), gizmoHash(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(gizmoHash(i + vec3(0.0, 0.0, 1.0)), gizmoHash(i + vec3(1.0, 0.0, 1.0)), u.x),
            mix(gizmoHash(i + vec3(0.0, 1.0, 1.0)), gizmoHash(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
        u.z
    );
}

// FBM for detail
fn gizmoFBM(p: vec3<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var pp = p;
    for (var i = 0; i < 3; i = i + 1) {
        value = value + amplitude * gizmoNoise(pp);
        pp = pp * 2.0;
        amplitude = amplitude * 0.5;
    }
    return value;
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let worldPos = uniforms.model * vec4<f32>(input.position, 1.0);
    output.position = uniforms.viewProj * worldPos;
    output.color = uniforms.color;
    output.worldPos = worldPos.xyz;
    output.localPos = input.position;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let pos = normalize(input.localPos);
    
    // Diffuse lighting
    let lightDir = normalize(vec3<f32>(0.5, 0.8, 0.3));
    let diffuse = max(dot(pos, lightDir), 0.0) * 0.4 + 0.6;
    
    // Procedural detail using smooth FBM noise
    // Use local position for consistent texturing on all geometry sizes
    let noiseScale = 8.0;
    let detail = gizmoFBM(input.localPos * noiseScale + input.worldPos * 0.5);
    let colorVariation = 0.85 + detail * 0.3;
    
    // Fresnel rim glow
    let fresnel = pow(1.0 - abs(dot(pos, normalize(input.worldPos))), 2.0);
    let rimGlow = fresnel * 0.15;
    
    // Combine effects
    var finalColor = input.color.rgb * diffuse * colorVariation;
    finalColor = min(vec3<f32>(1.0), finalColor + rimGlow);
    
    return vec4<f32>(finalColor, input.color.a);
}
`;

export class TransformGizmo {
    constructor(device, options = {}) {
        const injectedVgpu = options?.vgpu ?? null;
        if (injectedVgpu != null && (
            typeof injectedVgpu !== 'object'
            || injectedVgpu.device !== device
            || injectedVgpu.queue !== device?.queue
            || typeof injectedVgpu.buffer?.create !== 'function'
            || typeof injectedVgpu.bindings?.defineLayout !== 'function'
            || typeof injectedVgpu.bindings?.createGroup !== 'function'
            || typeof injectedVgpu.shader?.compile !== 'function'
            || typeof injectedVgpu.pipeline?.render !== 'function'
        )) {
            throw new TypeError('TransformGizmo injected vGPU must target the same device and provide the required driver interfaces');
        }
        this.vgpu = injectedVgpu ?? initVGPU(device);
        this.device = device;
        // Combined preserves the shared editor/RealmForge contract. Consumers
        // that expose separate tools assign translate, rotate, or scale.
        this.mode = 'combined';
        
        this.pipeline = null;
        this.linePipeline = null; // For rotation rings (line-strip)
        this.arrowGeometry = null;
        this.centerGeometry = null; // Center ball for free movement
        this.ringGeometryX = null;  // Rotation ring around X axis
        this.ringGeometryY = null;  // Rotation ring around Y axis
        this.ringGeometryZ = null;  // Rotation ring around Z axis
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        
        // Bind groups for each axis + center
        this.bindGroupX = null;
        this.bindGroupY = null;
        this.bindGroupZ = null;
        this.bindGroupCenter = null;
        
        // Bind groups for rotation rings
        this.bindGroupRingX = null;
        this.bindGroupRingY = null;
        this.bindGroupRingZ = null;
        this.uniformBufferRingX = null;
        this.uniformBufferRingY = null;
        this.uniformBufferRingZ = null;
        
        this.uniformData = new Float32Array(36); // 16 (viewProj) + 16 (model) + 4 (color)
        
        // Interaction state
        this.hoveredAxis = null; // 0=X, 1=Y, 2=Z, 3=center, 4=ringX, 5=ringY, 6=ringZ
        this.draggedAxis = null;
        this.dragStartPos = null;
        
        // Axis constraint: null = free, 0 = X only, 1 = Y only, 2 = Z only
        this.axisConstraint = null;
        
        // Animation state
        this.animTime = 0;
        this.centerPulsePhase = 0;
        
        // Current rotation angle for visual feedback (set by Viewport during drag)
        this.currentRotationAngle = 0;
        this.displayRotationAngle = 0; // Interpolated display angle
        
        // Tween state for smooth ring animation
        this.tweenStartAngle = 0;
        this.tweenTargetAngle = 0;
        this.tweenProgress = 1; // 0-1, 1 = complete
        this.tweenDuration = 0.12; // seconds
        this.tweenStartTime = 0;
        
        // Arrow tween state - smooth extension when dragging
        this.arrowExtension = 0; // Current extension amount
        this.arrowExtensionTarget = 0; // Target extension
        this.arrowExtensionVelocity = 0; // For spring physics
        this.arrowDragOffset = [0, 0, 0]; // Accumulated drag offset for visual
        this.arrowDisplayOffset = [0, 0, 0]; // Interpolated display offset
        
        // Center ball tween state
        this.centerScale = 1.0; // Current scale
        this.centerScaleTarget = 1.0; // Target scale
        this.centerScaleVelocity = 0; // For spring physics
        this.centerDragOffset = [0, 0, 0]; // Drag offset for visual
        this.centerDisplayOffset = [0, 0, 0]; // Interpolated display offset
    }
    
    async initialize(format) {
        // Create shader using vGPU
        const shaderModule = this.vgpu.shader.compile('transformGizmo', GIZMO_SHADER);
        
        // Create arrow geometry (cone + cylinder)
        this.arrowGeometry = this.createArrowGeometry();
        
        // Create center ball geometry
        this.centerGeometry = this.createCenterBallGeometry();
        
        // Create rotation ring geometries
        this.ringGeometryX = this.createRingGeometry('x');
        this.ringGeometryY = this.createRingGeometry('y');
        this.ringGeometryZ = this.createRingGeometry('z');
        
        // WebGPU requires 256-byte alignment for uniform buffer offsets
        const uniformSize = 256;
        
        // Create uniform buffers using vGPU (10 total: 6 arrows + center + 3 rings)
        this.uniformBufferXPos = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoXPos' }).buffer;
        this.uniformBufferXNeg = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoXNeg' }).buffer;
        this.uniformBufferYPos = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoYPos' }).buffer;
        this.uniformBufferYNeg = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoYNeg' }).buffer;
        this.uniformBufferZPos = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoZPos' }).buffer;
        this.uniformBufferZNeg = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoZNeg' }).buffer;
        this.uniformBufferCenter = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoCenter' }).buffer;
        this.uniformBufferRingX = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoRingX' }).buffer;
        this.uniformBufferRingY = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoRingY' }).buffer;
        this.uniformBufferRingZ = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'GizmoRingZ' }).buffer;
        
        // Create bind group layout using vGPU
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('transformGizmo', [{
            binding: 0, type: 'uniform', visibility: 'vertex|fragment'
        }]);
        
        // Create bind groups using vGPU (auto-cached)
        this.bindGroupXPos = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferXPos }]);
        this.bindGroupXNeg = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferXNeg }]);
        this.bindGroupYPos = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferYPos }]);
        this.bindGroupYNeg = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferYNeg }]);
        this.bindGroupZPos = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferZPos }]);
        this.bindGroupZNeg = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferZNeg }]);
        this.bindGroupCenter = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferCenter }]);
        this.bindGroupRingX = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferRingX }]);
        this.bindGroupRingY = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferRingY }]);
        this.bindGroupRingZ = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferRingZ }]);
        
        // Create pipelines using vGPU
        const vertexLayout = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }];
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            vertexLayout,
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            blend: 'alpha',
            cullMode: 'none',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'always',
            label: 'GizmoPipeline'
        });
        
        // Line pipeline for rotation rings
        this.linePipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            vertexLayout,
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            topology: 'line-strip',
            cullMode: 'none',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'always',
            label: 'GizmoLinePipeline'
        });
    }
    
    createArrowGeometry() {
        const vertices = [];
        
        // Cylinder shaft (0.0 to 0.8) - THICKER for better visibility
        const shaftRadius = 0.035;
        const shaftLength = 0.85;
        const segments = 12;
        
        for (let i = 0; i < segments; i++) {
            const angle1 = (i / segments) * Math.PI * 2;
            const angle2 = ((i + 1) / segments) * Math.PI * 2;
            
            const x1 = Math.cos(angle1) * shaftRadius;
            const z1 = Math.sin(angle1) * shaftRadius;
            const x2 = Math.cos(angle2) * shaftRadius;
            const z2 = Math.sin(angle2) * shaftRadius;
            
            // Bottom triangle
            vertices.push(0, 0, 0);
            vertices.push(x2, 0, z2);
            vertices.push(x1, 0, z1);
            
            // Side quad (2 triangles)
            vertices.push(x1, 0, z1);
            vertices.push(x2, 0, z2);
            vertices.push(x1, shaftLength, z1);
            
            vertices.push(x2, 0, z2);
            vertices.push(x2, shaftLength, z2);
            vertices.push(x1, shaftLength, z1);
        }
        
        // Cone head - BIGGER and more prominent
        const coneBase = 0.85;
        const coneRadius = 0.10;
        const coneHeight = 0.25;
        
        for (let i = 0; i < segments; i++) {
            const angle1 = (i / segments) * Math.PI * 2;
            const angle2 = ((i + 1) / segments) * Math.PI * 2;
            
            const x1 = Math.cos(angle1) * coneRadius;
            const z1 = Math.sin(angle1) * coneRadius;
            const x2 = Math.cos(angle2) * coneRadius;
            const z2 = Math.sin(angle2) * coneRadius;
            
            // Base triangle
            vertices.push(0, coneBase, 0);
            vertices.push(x1, coneBase, z1);
            vertices.push(x2, coneBase, z2);
            
            // Side triangle
            vertices.push(x1, coneBase, z1);
            vertices.push(0, coneBase + coneHeight, 0);
            vertices.push(x2, coneBase, z2);
        }
        
        const vertexData = new Float32Array(vertices);
        const { buffer: vertexBuffer } = this.vgpu.buffer.create({ size: vertexData.byteLength, usage: 'vertex', data: vertexData });
        
        return { buffer: vertexBuffer, vertexCount: vertices.length / 3 };
    }
    
    createCenterBallGeometry() {
        const vertices = [];
        const radius = 0.18;  // MUCH BIGGER - 2x+ for easy clicking
        const segments = 16;  // More segments for smoother sphere
        const rings = 12;
        
        // Create UV sphere
        for (let ring = 0; ring < rings; ring++) {
            const theta1 = (ring / rings) * Math.PI;
            const theta2 = ((ring + 1) / rings) * Math.PI;
            
            for (let seg = 0; seg < segments; seg++) {
                const phi1 = (seg / segments) * Math.PI * 2;
                const phi2 = ((seg + 1) / segments) * Math.PI * 2;
                
                // First triangle
                vertices.push(
                    radius * Math.sin(theta1) * Math.cos(phi1),
                    radius * Math.cos(theta1),
                    radius * Math.sin(theta1) * Math.sin(phi1)
                );
                vertices.push(
                    radius * Math.sin(theta2) * Math.cos(phi1),
                    radius * Math.cos(theta2),
                    radius * Math.sin(theta2) * Math.sin(phi1)
                );
                vertices.push(
                    radius * Math.sin(theta2) * Math.cos(phi2),
                    radius * Math.cos(theta2),
                    radius * Math.sin(theta2) * Math.sin(phi2)
                );
                
                // Second triangle
                vertices.push(
                    radius * Math.sin(theta1) * Math.cos(phi1),
                    radius * Math.cos(theta1),
                    radius * Math.sin(theta1) * Math.sin(phi1)
                );
                vertices.push(
                    radius * Math.sin(theta2) * Math.cos(phi2),
                    radius * Math.cos(theta2),
                    radius * Math.sin(theta2) * Math.sin(phi2)
                );
                vertices.push(
                    radius * Math.sin(theta1) * Math.cos(phi2),
                    radius * Math.cos(theta1),
                    radius * Math.sin(theta1) * Math.sin(phi2)
                );
            }
        }
        
        const vertexData = new Float32Array(vertices);
        const { buffer: vertexBuffer } = this.vgpu.buffer.create({ size: vertexData.byteLength, usage: 'vertex', data: vertexData });
        
        return { buffer: vertexBuffer, vertexCount: vertices.length / 3 };
    }
    
    createRingGeometry(axis) {
        const vertices = [];
        const ringRadius = 1.0; // Bigger ring radius
        const tubeRadius = 0.04; // Thickness of the tube
        const notchRadius = 0.08; // Uniform notch thickness (2x base)
        const ringSegments = 72; // Divisible by 24 for clean 15° intervals
        const tubeSegments = 8; // Cross-section smoothness
        
        // Create torus (tube ring) geometry
        for (let i = 0; i < ringSegments; i++) {
            const angle1 = (i / ringSegments) * Math.PI * 2;
            const angle2 = ((i + 1) / ringSegments) * Math.PI * 2;
            
            // Each segment is 5° (360/72). Notch every 15° = every 3rd segment
            const isNotch = (i % 3) === 0;
            const segmentRadius = isNotch ? notchRadius : tubeRadius;
            
            for (let j = 0; j < tubeSegments; j++) {
                const tubeAngle1 = (j / tubeSegments) * Math.PI * 2;
                const tubeAngle2 = ((j + 1) / tubeSegments) * Math.PI * 2;
                
                // Get vertex for this quad on the torus surface
                const getVertex = (ringAngle, tubeAngle, radius) => {
                    const cosR = Math.cos(ringAngle);
                    const sinR = Math.sin(ringAngle);
                    const cosT = Math.cos(tubeAngle);
                    const sinT = Math.sin(tubeAngle);
                    
                    const r = ringRadius + radius * cosT;
                    
                    if (axis === 'x') {
                        return [radius * sinT, r * cosR, r * sinR];
                    } else if (axis === 'y') {
                        return [r * cosR, radius * sinT, r * sinR];
                    } else {
                        return [r * cosR, r * sinR, radius * sinT];
                    }
                };
                
                // Use same radius for all 4 vertices of this segment quad
                const v1 = getVertex(angle1, tubeAngle1, segmentRadius);
                const v2 = getVertex(angle2, tubeAngle1, segmentRadius);
                const v3 = getVertex(angle2, tubeAngle2, segmentRadius);
                const v4 = getVertex(angle1, tubeAngle2, segmentRadius);
                
                // Two triangles for this quad
                vertices.push(...v1, ...v2, ...v3);
                vertices.push(...v1, ...v3, ...v4);
            }
        }
        
        const vertexData = new Float32Array(vertices);
        const { buffer: vertexBuffer } = this.vgpu.buffer.create({ size: vertexData.byteLength, usage: 'vertex', data: vertexData });
        
        return { buffer: vertexBuffer, vertexCount: vertices.length / 3, isTriangles: true };
    }
    
    render(passEncoder, viewProjMatrix, entityPosition, entityOrientation = null) {
        if (!this.pipeline || !this.arrowGeometry) return;
        const mode = normalizedGizmoMode(this.mode);
        const orientation = normalizedGizmoOrientation(entityOrientation);
        
        // Update animation time
        this.animTime = performance.now() * 0.001;
        
        // Tween-based smooth animation with easing
        if (this.currentRotationAngle !== this.tweenTargetAngle) {
            // Start new tween when target changes
            this.tweenStartAngle = this.displayRotationAngle;
            this.tweenTargetAngle = this.currentRotationAngle;
            this.tweenStartTime = this.animTime;
            this.tweenProgress = 0;
        }
        
        if (this.tweenProgress < 1) {
            // Update tween progress
            const elapsed = this.animTime - this.tweenStartTime;
            this.tweenProgress = Math.min(1, elapsed / this.tweenDuration);
            
            // Ease-out cubic: 1 - (1-t)^3
            const eased = 1 - Math.pow(1 - this.tweenProgress, 3);
            
            // Interpolate with easing
            this.displayRotationAngle = this.tweenStartAngle + (this.tweenTargetAngle - this.tweenStartAngle) * eased;
        }
        
        // Snap to zero if very close and target is zero
        if (Math.abs(this.displayRotationAngle) < 0.001 && this.tweenTargetAngle === 0) {
            this.displayRotationAngle = 0;
        }
        
        // Arrow extension tween (spring physics for bouncy feel)
        const arrowSpringStiffness = 25;
        const arrowDamping = 8;
        const dt = 0.016; // Approx 60fps
        
        // Spring force toward target
        const arrowDelta = this.arrowExtensionTarget - this.arrowExtension;
        const springForce = arrowDelta * arrowSpringStiffness;
        this.arrowExtensionVelocity += springForce * dt;
        this.arrowExtensionVelocity *= Math.exp(-arrowDamping * dt); // Damping
        this.arrowExtension += this.arrowExtensionVelocity * dt;
        
        // Snap to zero when close
        if (Math.abs(this.arrowExtension) < 0.001 && this.arrowExtensionTarget === 0) {
            this.arrowExtension = 0;
            this.arrowExtensionVelocity = 0;
        }
        
        // Lerp arrow display offset toward target
        const offsetLerp = 0.15;
        this.arrowDisplayOffset[0] += (this.arrowDragOffset[0] - this.arrowDisplayOffset[0]) * offsetLerp;
        this.arrowDisplayOffset[1] += (this.arrowDragOffset[1] - this.arrowDisplayOffset[1]) * offsetLerp;
        this.arrowDisplayOffset[2] += (this.arrowDragOffset[2] - this.arrowDisplayOffset[2]) * offsetLerp;
        
        // Center ball spring physics
        const centerDelta = this.centerScaleTarget - this.centerScale;
        const centerSpringForce = centerDelta * arrowSpringStiffness;
        this.centerScaleVelocity += centerSpringForce * dt;
        this.centerScaleVelocity *= Math.exp(-arrowDamping * dt);
        this.centerScale += this.centerScaleVelocity * dt;
        
        // Snap center scale
        if (Math.abs(this.centerScale - 1.0) < 0.001 && this.centerScaleTarget === 1.0) {
            this.centerScale = 1.0;
            this.centerScaleVelocity = 0;
        }
        
        // Lerp center display offset
        this.centerDisplayOffset[0] += (this.centerDragOffset[0] - this.centerDisplayOffset[0]) * offsetLerp;
        this.centerDisplayOffset[1] += (this.centerDragOffset[1] - this.centerDisplayOffset[1]) * offsetLerp;
        this.centerDisplayOffset[2] += (this.centerDragOffset[2] - this.centerDisplayOffset[2]) * offsetLerp;
        
        passEncoder.setPipeline(this.pipeline);
        
        // Translation and scale both expose their center handle. Rotation does not.
        if (mode !== 'rotate' && this.centerGeometry) {
            passEncoder.setVertexBuffer(0, this.centerGeometry.buffer);
            this.renderCenterBall(passEncoder, viewProjMatrix, entityPosition);
        }

        if (mode !== 'rotate') {
            passEncoder.setVertexBuffer(0, this.arrowGeometry.buffer);
            this.renderAxis(passEncoder, viewProjMatrix, entityPosition, [1, 0, 0, 0], [1, 0, 0, 0.7], this.bindGroupXPos, this.uniformBufferXPos, 0, orientation);
            this.renderAxis(passEncoder, viewProjMatrix, entityPosition, [0, 1, 0, 0], [0, 1, 0, 0.7], this.bindGroupYPos, this.uniformBufferYPos, 1, orientation);
            this.renderAxis(passEncoder, viewProjMatrix, entityPosition, [0, 0, 1, 0], [0, 0, 1, 0.7], this.bindGroupZPos, this.uniformBufferZPos, 2, orientation);
            if (mode === 'translate' || mode === 'combined') {
                this.renderAxis(passEncoder, viewProjMatrix, entityPosition, [-1, 0, 0, 0], [0.8, 0.2, 0.2, 0.7], this.bindGroupXNeg, this.uniformBufferXNeg, 0, orientation);
                this.renderAxis(passEncoder, viewProjMatrix, entityPosition, [0, -1, 0, 0], [0.2, 0.8, 0.2, 0.7], this.bindGroupYNeg, this.uniformBufferYNeg, 1, orientation);
                this.renderAxis(passEncoder, viewProjMatrix, entityPosition, [0, 0, -1, 0], [0.2, 0.2, 0.8, 0.7], this.bindGroupZNeg, this.uniformBufferZNeg, 2, orientation);
            }
        }

        // Rotation owns the three rings exclusively, so every visible handle is actionable.
        if ((mode === 'rotate' || mode === 'combined') && this.ringGeometryX) {
            // Use main triangle pipeline for solid rings
            passEncoder.setPipeline(this.pipeline);
            
            // X ring (vibrant red-orange) - rotates around X axis
            this.renderRing(passEncoder, viewProjMatrix, entityPosition, this.ringGeometryX, [1.0, 0.4, 0.2, 0.5], this.bindGroupRingX, this.uniformBufferRingX, 4, orientation);
            
            // Y ring (vibrant green-cyan) - rotates around Y axis
            this.renderRing(passEncoder, viewProjMatrix, entityPosition, this.ringGeometryY, [0.2, 1.0, 0.5, 0.5], this.bindGroupRingY, this.uniformBufferRingY, 5, orientation);
            
            // Z ring (vibrant blue-purple) - rotates around Z axis
            this.renderRing(passEncoder, viewProjMatrix, entityPosition, this.ringGeometryZ, [0.3, 0.5, 1.0, 0.5], this.bindGroupRingZ, this.uniformBufferRingZ, 6, orientation);
        }
    }
    
    renderRing(passEncoder, viewProjMatrix, position, ringGeometry, color, bindGroup, buffer, axisIndex, orientation = null) {
        const isHovered = this.hoveredAxis === axisIndex;
        const isDragged = this.draggedAxis === axisIndex;
        const isActive = isHovered || isDragged;
        
        // Use interpolated display angle for smooth visual rotation (only for dragged ring)
        // An oriented consumer already supplies the current local frame. Keep
        // the legacy ring tween only for position-only/world-space callers so
        // the active delta is never composed twice.
        const angle = isDragged && !orientation ? this.displayRotationAngle : 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        // Build model matrix with animated rotation around the ring's axis
        const modelMatrix = _ringModelMatrix;
        modelMatrix.fill(0); // Clear previous values
        
        if (axisIndex === 4) {
            // X ring - rotate around X axis
            modelMatrix[0] = 1;
            modelMatrix[5] = cos;
            modelMatrix[6] = sin;
            modelMatrix[9] = -sin;
            modelMatrix[10] = cos;
        } else if (axisIndex === 5) {
            // Y ring - rotate around Y axis
            modelMatrix[0] = cos;
            modelMatrix[2] = -sin;
            modelMatrix[5] = 1;
            modelMatrix[8] = sin;
            modelMatrix[10] = cos;
        } else {
            // Z ring - rotate around Z axis
            modelMatrix[0] = cos;
            modelMatrix[1] = sin;
            modelMatrix[4] = -sin;
            modelMatrix[5] = cos;
            modelMatrix[10] = 1;
        }
        
        modelMatrix[15] = 1;
        orientModelBasis(modelMatrix, orientation);
        modelMatrix[12] = position[0];
        modelMatrix[13] = position[1];
        modelMatrix[14] = position[2];
        
        // ViewProj matrix
        this.uniformData.set(viewProjMatrix, 0);
        
        // Model matrix
        this.uniformData.set(modelMatrix, 16);
        
        // Color brightness - only pulse when dragging
        const brightness = isDragged ? (1.3 + 0.2 * Math.sin(this.animTime * 5.0)) : (isHovered ? 1.2 : 1.0);
        
        // Subtle color shift only when dragging
        const hueShift = isDragged ? Math.sin(this.animTime * 5.0) * 0.15 : 0;
        this.uniformData[32] = Math.min(1.0, color[0] * brightness + (color[0] < 0.5 ? hueShift : 0));
        this.uniformData[33] = Math.min(1.0, color[1] * brightness + (color[1] < 0.5 ? hueShift : 0));
        this.uniformData[34] = Math.min(1.0, color[2] * brightness + (color[2] < 0.5 ? hueShift : 0));
        this.uniformData[35] = isActive ? 1.0 : color[3];
        
        this.device.queue.writeBuffer(buffer, 0, this.uniformData);
        
        passEncoder.setVertexBuffer(0, ringGeometry.buffer);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(ringGeometry.vertexCount, 1, 0, 0);
    }
    
    renderCenterBall(passEncoder, viewProjMatrix, position) {
        const isHovered = this.hoveredAxis === 3;
        const isDragged = this.draggedAxis === 3;
        const isActive = isHovered || isDragged;
        
        // Pulse animation for scale when hovered/dragged
        const pulseSpeed = isDragged ? 8.0 : 4.0;
        const pulseAmount = isDragged ? 0.3 : 0.15;
        const pulse = isActive ? 1.0 + Math.sin(this.animTime * pulseSpeed) * pulseAmount : 1.0;
        
        // Apply spring scale for tween effect
        const springScale = isDragged ? this.centerScale : 1.0;
        const totalScale = pulse * springScale;
        
        // Calculate position with tween offset
        const offsetPos = isDragged ? [
            position[0] + this.centerDisplayOffset[0] * 0.1,
            position[1] + this.centerDisplayOffset[1] * 0.1,
            position[2] + this.centerDisplayOffset[2] * 0.1
        ] : position;
        
        // Build model matrix with animated scale - reuse buffer
        const modelMatrix = _axisModelMatrix;
        modelMatrix.fill(0);
        modelMatrix[0] = totalScale;
        modelMatrix[5] = totalScale;
        modelMatrix[10] = totalScale;
        modelMatrix[15] = 1;
        modelMatrix[12] = offsetPos[0];
        modelMatrix[13] = offsetPos[1];
        modelMatrix[14] = offsetPos[2];
        
        // ViewProj matrix
        this.uniformData.set(viewProjMatrix, 0);
        
        // Model matrix
        this.uniformData.set(modelMatrix, 16);
        
        // Color - bright yellow/white when active, pulsing glow
        const glowPulse = isActive ? 0.5 + Math.sin(this.animTime * 6.0) * 0.5 : 0;
        if (isDragged) {
            // Bright glowing yellow when dragging
            this.uniformData[32] = 1.0;
            this.uniformData[33] = 1.0;
            this.uniformData[34] = 0.2 + glowPulse * 0.3;
        } else if (isHovered) {
            // Bright yellow when hovered
            this.uniformData[32] = 1.0;
            this.uniformData[33] = 0.95;
            this.uniformData[34] = 0.3;
        } else {
            // Neutral gray/white
            this.uniformData[32] = 0.85;
            this.uniformData[33] = 0.85;
            this.uniformData[34] = 0.75;
        }
        this.uniformData[35] = 0.6; // More transparent
        
        this.device.queue.writeBuffer(this.uniformBufferCenter, 0, this.uniformData);
        
        passEncoder.setBindGroup(0, this.bindGroupCenter);
        passEncoder.draw(this.centerGeometry.vertexCount, 1, 0, 0);
    }
    
    renderAxis(passEncoder, viewProjMatrix, position, axis, color, bindGroup, buffer, axisIndex, orientation = null) {
        const isHovered = this.hoveredAxis === axisIndex;
        const isDragged = this.draggedAxis === axisIndex;
        const isActive = isHovered || isDragged;
        
        // Scale animation when active (with spring extension)
        const baseScale = isActive ? 1.15 : 1.0;
        const extensionScale = isDragged ? 1.0 + this.arrowExtension * 0.3 : 1.0;
        const scaleBoost = baseScale * extensionScale;
        
        // Calculate position offset for dragged arrow
        let offsetPos = position;
        if (isDragged) {
            offsetPos = [
                position[0] + this.arrowDisplayOffset[0] * 0.1,
                position[1] + this.arrowDisplayOffset[1] * 0.1,
                position[2] + this.arrowDisplayOffset[2] * 0.1
            ];
        }
        
        // Build model matrix for this axis with scale
        const baseMatrix = this.createAxisMatrix(offsetPos, axis);
        // Apply scale to the arrow
        for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
            baseMatrix[index] *= scaleBoost;
        }
        orientModelBasis(baseMatrix, orientation);
        
        // ViewProj matrix (16 floats)
        this.uniformData.set(viewProjMatrix, 0);
        
        // Model matrix (16 floats)
        this.uniformData.set(baseMatrix, 16);
        
        // Animated glow effect
        const glowPulse = isDragged ? 0.5 + Math.sin(this.animTime * 8.0) * 0.5 : 0;
        const hoverBright = isHovered ? 1.8 : 1.0;
        const dragBright = isDragged ? 2.2 + glowPulse * 0.5 : 1.0;
        const brightness = Math.max(hoverBright, dragBright);
        
        // Color (4 floats) - glow effect
        this.uniformData[32] = Math.min(1.0, color[0] * brightness);
        this.uniformData[33] = Math.min(1.0, color[1] * brightness);
        this.uniformData[34] = Math.min(1.0, color[2] * brightness);
        this.uniformData[35] = color[3];
        
        // Add white glow when dragged (makes it look more glowy)
        if (isDragged) {
            const white = 0.3 + glowPulse * 0.2;
            this.uniformData[32] = Math.min(1.0, this.uniformData[32] + white);
            this.uniformData[33] = Math.min(1.0, this.uniformData[33] + white);
            this.uniformData[34] = Math.min(1.0, this.uniformData[34] + white);
        }
        
        // Write to the provided buffer
        this.device.queue.writeBuffer(buffer, 0, this.uniformData);
        
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(this.arrowGeometry.vertexCount, 1, 0, 0);
    }
    
    createAxisMatrix(position, axis) {
        const mat = _axisModelMatrix; // Reuse buffer
        mat.fill(0);
        
        // Start with identity
        mat[0] = 1; mat[5] = 1; mat[10] = 1; mat[15] = 1;
        
        // Translation
        mat[12] = position[0];
        mat[13] = position[1];
        mat[14] = position[2];
        
        // Arrow geometry points along +Y axis
        // Rotate to point along the desired axis direction
        const ax = axis[0], ay = axis[1], az = axis[2];
        
        if (ax > 0.5) {
            // +X - rotate 90° around Z (Y becomes X)
            mat[0] = 0;  mat[4] = -1; mat[8] = 0;
            mat[1] = 1;  mat[5] = 0;  mat[9] = 0;
            mat[2] = 0;  mat[6] = 0;  mat[10] = 1;
        } else if (ax < -0.5) {
            // -X - rotate -90° around Z (Y becomes -X)
            mat[0] = 0;  mat[4] = 1;  mat[8] = 0;
            mat[1] = -1; mat[5] = 0;  mat[9] = 0;
            mat[2] = 0;  mat[6] = 0;  mat[10] = 1;
        } else if (ay < -0.5) {
            // -Y - rotate 180° (flip upside down)
            mat[0] = 1;  mat[4] = 0;  mat[8] = 0;
            mat[1] = 0;  mat[5] = -1; mat[9] = 0;
            mat[2] = 0;  mat[6] = 0;  mat[10] = -1;
        } else if (az > 0.5) {
            // +Z - rotate -90° around X (Y becomes Z)
            mat[0] = 1;  mat[4] = 0;  mat[8] = 0;
            mat[1] = 0;  mat[5] = 0;  mat[9] = 1;
            mat[2] = 0;  mat[6] = -1; mat[10] = 0;
        } else if (az < -0.5) {
            // -Z - rotate 90° around X (Y becomes -Z)
            mat[0] = 1;  mat[4] = 0;  mat[8] = 0;
            mat[1] = 0;  mat[5] = 0;  mat[9] = -1;
            mat[2] = 0;  mat[6] = 1;  mat[10] = 0;
        }
        // +Y is default (no rotation needed)
        
        return mat;
    }
    
    // Hit test - returns axis index (0=X, 1=Y, 2=Z, 3=center) or null
    hitTest(rayOrigin, rayDir, gizmoPosition, entityOrientation = null) {
        const mode = normalizedGizmoMode(this.mode);
        const orientation = normalizedGizmoOrientation(entityOrientation);
        const inverseOrientation = orientation ? quatConjugate(orientation) : null;
        const origin = inverseOrientation
            ? vec3TransformQuat([
                rayOrigin[0] - gizmoPosition[0],
                rayOrigin[1] - gizmoPosition[1],
                rayOrigin[2] - gizmoPosition[2],
            ], inverseOrientation)
            : rayOrigin;
        const direction = inverseOrientation ? vec3TransformQuat(rayDir, inverseOrientation) : rayDir;
        const position = inverseOrientation ? [0, 0, 0] : gizmoPosition;
        const centerRadius = 0.45;  // Hitbox for center ball - BIG for easy clicking
        const arrowLength = 1.1;   // Slightly longer to match new visuals
        const arrowRadius = 0.28;  // Hitbox for arrows - bigger for easier clicking
        
        if (mode !== 'rotate') {
            const centerHit = raySphere(origin, direction, position, centerRadius);
            if (centerHit !== null && centerHit.t > 0) {
                return 3;
            }
        }
        
        const positiveArrows = [
            { dir: [1, 0, 0], axis: 0 },   // +X
            { dir: [0, 1, 0], axis: 1 },   // +Y
            { dir: [0, 0, 1], axis: 2 },   // +Z
        ];
        const negativeArrows = [
            { dir: [-1, 0, 0], axis: 0 },  // -X
            { dir: [0, -1, 0], axis: 1 },  // -Y
            { dir: [0, 0, -1], axis: 2 },  // -Z
        ];
        const arrows = mode === 'rotate'
            ? []
            : mode === 'scale' ? positiveArrows : [...positiveArrows, ...negativeArrows];
        
        let closestAxis = null;
        let closestDist = Infinity;
        
        // Calculate distance from ray origin to gizmo for adaptive sampling
        const toGizmo = [
            position[0] - origin[0],
            position[1] - origin[1],
            position[2] - origin[2]
        ];
        const distToGizmo = Math.sqrt(toGizmo[0]*toGizmo[0] + toGizmo[1]*toGizmo[1] + toGizmo[2]*toGizmo[2]);
        
        // Sample range: from slightly before gizmo to slightly after
        const tStart = Math.max(0, distToGizmo - 2);
        const tEnd = distToGizmo + 2;
        const tStep = 0.05; // Finer step for better accuracy
        
        // Sample points along the ray and check capsule SDF for each arrow
        for (const arrow of arrows) {
            const dir = arrow.dir;
            // Arrow endpoints - from center to tip
            const a = position;
            const b = [
                position[0] + dir[0] * arrowLength,
                position[1] + dir[1] * arrowLength,
                position[2] + dir[2] * arrowLength
            ];
            
            // Check multiple points along ray for capsule intersection
            for (let t = tStart; t < tEnd; t += tStep) {
                const p = [
                    origin[0] + direction[0] * t,
                    origin[1] + direction[1] * t,
                    origin[2] + direction[2] * t
                ];
                const dist = sdfCapsule(p, a, b, arrowRadius);
                if (dist < 0 && t < closestDist) {
                    closestDist = t;
                    closestAxis = arrow.axis;
                    break;
                }
            }
        }
        
        if (mode !== 'rotate' && mode !== 'combined') return closestAxis;

        // Test rotation rings (4=ringX, 5=ringY, 6=ringZ)
        const ringRadius = 1.0; // Match the bigger ring
        const ringThickness = 0.15; // Hit tolerance for the thicker ring
        
        for (let t = tStart; t < tEnd; t += tStep) {
            const p = [
                origin[0] + direction[0] * t - position[0],
                origin[1] + direction[1] * t - position[1],
                origin[2] + direction[2] * t - position[2]
            ];
            
            // X ring (YZ plane) - distance from ring
            const distYZ = Math.sqrt(p[1] * p[1] + p[2] * p[2]);
            const xRingDist = Math.abs(distYZ - ringRadius) + Math.abs(p[0]) * 2;
            if (xRingDist < ringThickness && t < closestDist) {
                closestDist = t;
                closestAxis = 4; // ringX
            }
            
            // Y ring (XZ plane) - distance from ring
            const distXZ = Math.sqrt(p[0] * p[0] + p[2] * p[2]);
            const yRingDist = Math.abs(distXZ - ringRadius) + Math.abs(p[1]) * 2;
            if (yRingDist < ringThickness && t < closestDist) {
                closestDist = t;
                closestAxis = 5; // ringY
            }
            
            // Z ring (XY plane) - distance from ring
            const distXY = Math.sqrt(p[0] * p[0] + p[1] * p[1]);
            const zRingDist = Math.abs(distXY - ringRadius) + Math.abs(p[2]) * 2;
            if (zRingDist < ringThickness && t < closestDist) {
                closestDist = t;
                closestAxis = 6; // ringZ
            }
        }
        
        return closestAxis;
    }
    
    destroy() {
        const buffers = [];
        const seenBuffers = new Set();
        const errors = [];
        const retainForDestruction = (buffer) => {
            if (buffer && !seenBuffers.has(buffer)) {
                seenBuffers.add(buffer);
                buffers.push(buffer);
            }
        };

        for (const field of [
            'arrowGeometry',
            'centerGeometry',
            'ringGeometryX',
            'ringGeometryY',
            'ringGeometryZ',
        ]) {
            const geometry = this[field];
            this[field] = null;
            try {
                retainForDestruction(geometry?.buffer);
            } catch (error) {
                errors.push(error);
            }
        }

        for (const field of [
            'uniformBuffer',
            'uniformBufferXPos',
            'uniformBufferXNeg',
            'uniformBufferYPos',
            'uniformBufferYNeg',
            'uniformBufferZPos',
            'uniformBufferZNeg',
            'uniformBufferCenter',
            'uniformBufferRingX',
            'uniformBufferRingY',
            'uniformBufferRingZ',
        ]) {
            const buffer = this[field];
            this[field] = null;
            retainForDestruction(buffer);
        }

        for (const field of [
            'pipeline',
            'linePipeline',
            'bindGroupLayout',
            'bindGroupX',
            'bindGroupY',
            'bindGroupZ',
            'bindGroupXPos',
            'bindGroupXNeg',
            'bindGroupYPos',
            'bindGroupYNeg',
            'bindGroupZPos',
            'bindGroupZNeg',
            'bindGroupCenter',
            'bindGroupRingX',
            'bindGroupRingY',
            'bindGroupRingZ',
        ]) {
            this[field] = null;
        }

        try {
            destroyBuffers(buffers);
        } catch (error) {
            if (error instanceof AggregateError) {
                errors.push(...error.errors);
            } else {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            throw new AggregateError(errors, 'TransformGizmo teardown completed with cleanup failures');
        }
    }
}
