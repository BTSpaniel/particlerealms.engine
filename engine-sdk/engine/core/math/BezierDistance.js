// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BezierDistance.js - Distance Field from Bezier Curves
 * 
 * Computing exact distance to a Bezier curve is expensive (quintic polynomial).
 * This module provides fast approximations suitable for real-time voxelization:
 * 
 * Methods:
 * 1. Capsule Approximation: Subdivide into line segments, union of capsules
 * 2. Newton-Raphson Refinement: Iteratively find closest point on curve
 * 3. Hybrid: Capsules for initial guess, Newton for refinement
 * 
 * Performance Targets:
 * - Capsule (16 segments): ~20 GPU cycles per query
 * - Newton refinement (8 iterations): ~50 GPU cycles
 * - Hybrid: ~35 GPU cycles with better accuracy
 */

import { CubicBezier } from './BezierCurves.js';
import { vec3Add, vec3Dot, vec3Length, vec3Scale, vec3Sub } from './MathVec3.js';

// ============================================================================
// CAPSULE (LINE SEGMENT) DISTANCE
// ============================================================================

/**
 * Signed distance to a capsule (line segment with radius)
 * @param {number[]} p - Query point
 * @param {number[]} a - Segment start
 * @param {number[]} b - Segment end
 * @param {number} r - Radius
 * @returns {number} Signed distance (negative inside)
 */
export function sdCapsule(p, a, b, r) {
    const pa = vec3Sub(p, a);
    const ba = vec3Sub(b, a);
    
    const baba = vec3Dot(ba, ba);
    const paba = vec3Dot(pa, ba);
    
    // Clamp projection to segment
    const h = Math.max(0, Math.min(1, paba / baba));
    
    // Distance from p to closest point on segment
    const closest = [
        a[0] + h * ba[0],
        a[1] + h * ba[1],
        a[2] + h * ba[2],
    ];
    
    return vec3Length(vec3Sub(p, closest)) - r;
}

/**
 * Find closest point parameter on capsule
 * @param {number[]} p 
 * @param {number[]} a 
 * @param {number[]} b 
 * @returns {number} t in [0, 1]
 */
export function capsuleClosestT(p, a, b) {
    const pa = vec3Sub(p, a);
    const ba = vec3Sub(b, a);
    const baba = vec3Dot(ba, ba);
    const paba = vec3Dot(pa, ba);
    return Math.max(0, Math.min(1, paba / baba));
}

// ============================================================================
// BEZIER DISTANCE - CAPSULE APPROXIMATION
// ============================================================================

/**
 * Distance to Bezier using capsule chain approximation
 * Fast but may miss fine details for highly curved sections
 * 
 * @param {number[]} p - Query point
 * @param {CubicBezier} curve - Bezier curve
 * @param {number} segments - Number of capsule segments (16 typical)
 * @returns {{ distance: number, t: number }} Distance and closest t
 */
export function bezierDistanceCapsule(p, curve, segments = 16) {
    let minDist = Infinity;
    let bestT = 0;
    
    const dt = 1.0 / segments;
    let prev = curve.evaluate(0);
    
    for (let i = 1; i <= segments; i++) {
        const t = i * dt;
        const curr = curve.evaluate(t);
        
        const dist = sdCapsule(p, prev, curr, curve.radius);
        
        if (dist < minDist) {
            minDist = dist;
            // Estimate t within segment
            const localT = capsuleClosestT(p, prev, curr);
            bestT = (i - 1 + localT) * dt;
        }
        
        prev = curr;
    }
    
    return { distance: minDist, t: bestT };
}

/**
 * Batch distance query for multiple points
 * @param {number[][]} points 
 * @param {CubicBezier} curve 
 * @param {number} segments 
 * @returns {number[]} Distances
 */
export function bezierDistanceBatch(points, curve, segments = 16) {
    // Pre-sample curve
    const samples = [];
    const dt = 1.0 / segments;
    for (let i = 0; i <= segments; i++) {
        samples.push(curve.evaluate(i * dt));
    }
    
    return points.map(p => {
        let minDist = Infinity;
        for (let i = 0; i < segments; i++) {
            const dist = sdCapsule(p, samples[i], samples[i + 1], curve.radius);
            if (dist < minDist) minDist = dist;
        }
        return minDist;
    });
}

// ============================================================================
// BEZIER DISTANCE - NEWTON-RAPHSON REFINEMENT
// ============================================================================

/**
 * Find closest point on Bezier using Newton-Raphson iteration
 * Minimizes |B(t) - p|² by finding roots of d/dt|B(t)-p|²
 * 
 * @param {number[]} p - Query point
 * @param {CubicBezier} curve 
 * @param {number} initialT - Starting guess for t
 * @param {number} iterations - Max iterations (8 typical)
 * @returns {{ t: number, point: number[], distance: number }}
 */
export function bezierClosestNewton(p, curve, initialT = 0.5, iterations = 8) {
    let t = initialT;
    
    for (let i = 0; i < iterations; i++) {
        const B = curve.evaluate(t);
        const dB = curve.derivative(t);
        const ddB = curve.secondDerivative(t);
        
        // f(t) = (B - p) · B' (should be zero at minimum)
        const diff = vec3Sub(B, p);
        const f = vec3Dot(diff, dB);
        
        // f'(t) = B' · B' + (B - p) · B''
        const df = vec3Dot(dB, dB) + vec3Dot(diff, ddB);
        
        if (Math.abs(df) < 0.0001) break;
        
        // Newton step
        t = t - f / df;
        
        // Clamp to [0, 1]
        t = Math.max(0, Math.min(1, t));
    }
    
    const point = curve.evaluate(t);
    const distance = vec3Length(vec3Sub(p, point)) - curve.radius;
    
    return { t, point, distance };
}

/**
 * Hybrid: Capsule for initial guess, Newton for refinement
 * Best balance of speed and accuracy
 * 
 * @param {number[]} p 
 * @param {CubicBezier} curve 
 * @param {number} capsuleSegments 
 * @param {number} newtonIterations 
 * @returns {{ distance: number, t: number, point: number[] }}
 */
export function bezierDistanceHybrid(p, curve, capsuleSegments = 8, newtonIterations = 4) {
    // Get initial guess from capsule approximation
    const capsuleResult = bezierDistanceCapsule(p, curve, capsuleSegments);
    
    // Refine with Newton
    const refined = bezierClosestNewton(p, curve, capsuleResult.t, newtonIterations);
    
    return refined;
}

// ============================================================================
// MULTI-CURVE DISTANCE
// ============================================================================

/**
 * Distance to multiple Bezier curves (smooth union)
 * @param {number[]} p 
 * @param {CubicBezier[]} curves 
 * @param {number} segments 
 * @returns {number}
 */
export function multiCurveDistance(p, curves, segments = 16) {
    let minDist = Infinity;
    
    for (const curve of curves) {
        const { distance } = bezierDistanceCapsule(p, curve, segments);
        if (distance < minDist) {
            minDist = distance;
        }
    }
    
    return minDist;
}

/**
 * Smooth minimum of two distances (for blending)
 * @param {number} a 
 * @param {number} b 
 * @param {number} k - Smoothness factor
 * @returns {number}
 */
export function smin(a, b, k = 0.1) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Distance to curves with smooth blending
 * @param {number[]} p 
 * @param {CubicBezier[]} curves 
 * @param {number} smoothness 
 * @returns {number}
 */
export function multiCurveDistanceSmooth(p, curves, smoothness = 0.5) {
    if (curves.length === 0) return Infinity;
    
    let result = bezierDistanceCapsule(p, curves[0], 16).distance;
    
    for (let i = 1; i < curves.length; i++) {
        const dist = bezierDistanceCapsule(p, curves[i], 16).distance;
        result = smin(result, dist, smoothness);
    }
    
    return result;
}

// ============================================================================
// GPU DATA PREPARATION
// ============================================================================

/**
 * Prepare curve data for GPU upload
 * Format: 4 vec4s per curve = 64 bytes
 * [p0.xyz, 0] [p1.xyz, 0] [p2.xyz, 0] [p3.xyz, radius]
 * 
 * @param {CubicBezier[]} curves 
 * @returns {Float32Array}
 */
export function curvesToGPUBuffer(curves) {
    const data = new Float32Array(curves.length * 16);
    
    for (let i = 0; i < curves.length; i++) {
        const c = curves[i];
        const offset = i * 16;
        
        // P0
        data[offset + 0] = c.p0[0];
        data[offset + 1] = c.p0[1];
        data[offset + 2] = c.p0[2];
        data[offset + 3] = 0;
        
        // P1
        data[offset + 4] = c.p1[0];
        data[offset + 5] = c.p1[1];
        data[offset + 6] = c.p1[2];
        data[offset + 7] = 0;
        
        // P2
        data[offset + 8] = c.p2[0];
        data[offset + 9] = c.p2[1];
        data[offset + 10] = c.p2[2];
        data[offset + 11] = 0;
        
        // P3 + radius
        data[offset + 12] = c.p3[0];
        data[offset + 13] = c.p3[1];
        data[offset + 14] = c.p3[2];
        data[offset + 15] = c.radius;
    }
    
    return data;
}

/**
 * Pre-sample curves into line segments for GPU
 * More efficient for many queries
 * 
 * @param {CubicBezier[]} curves 
 * @param {number} segmentsPerCurve 
 * @returns {{ vertices: Float32Array, radii: Float32Array, segmentCount: number }}
 */
export function curvesToSegments(curves, segmentsPerCurve = 8) {
    const totalSegments = curves.length * segmentsPerCurve;
    const vertices = new Float32Array(totalSegments * 6); // 2 endpoints per segment
    const radii = new Float32Array(totalSegments);
    
    let segIdx = 0;
    for (const curve of curves) {
        const dt = 1.0 / segmentsPerCurve;
        let prev = curve.evaluate(0);
        
        for (let i = 1; i <= segmentsPerCurve; i++) {
            const curr = curve.evaluate(i * dt);
            const offset = segIdx * 6;
            
            vertices[offset + 0] = prev[0];
            vertices[offset + 1] = prev[1];
            vertices[offset + 2] = prev[2];
            vertices[offset + 3] = curr[0];
            vertices[offset + 4] = curr[1];
            vertices[offset + 5] = curr[2];
            
            radii[segIdx] = curve.radius;
            
            prev = curr;
            segIdx++;
        }
    }
    
    return { vertices, radii, segmentCount: totalSegments };
}

// ============================================================================
// BEZIER DISTANCE COMPUTE CLASS
// ============================================================================

/**
 * GPU-accelerated Bezier distance field computation
 */
export class BezierDistanceCompute {
    /**
     * @param {GPUDevice} device 
     */
    constructor(device) {
        this.device = device;
        this.initialized = false;
        
        this.curveBuffer = null;
        this.segmentBuffer = null;
        this.outputBuffer = null;
        this.uniformBuffer = null;
        
        this.pipeline = null;
        this.bindGroup = null;
    }
    
    /**
     * Initialize with curves
     * @param {CubicBezier[]} curves 
     * @param {number} segmentsPerCurve 
     */
    async init(curves, segmentsPerCurve = 16) {
        const { vertices, radii, segmentCount } = curvesToSegments(curves, segmentsPerCurve);
        
        // Segment buffer (vec3 start, vec3 end per segment)
        this.segmentBuffer = this.device.createBuffer({
            label: 'Bezier Segments',
            size: vertices.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.segmentBuffer, 0, vertices);
        
        // Radii buffer
        this.radiiBuffer = this.device.createBuffer({
            label: 'Segment Radii',
            size: radii.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.radiiBuffer, 0, radii);
        
        // Uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            label: 'Bezier Uniforms',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        const uniformData = new Uint32Array([segmentCount, 0, 0, 0]);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        
        this.segmentCount = segmentCount;
        this.initialized = true;
    }
    
    /**
     * Compute distance at a single point (CPU fallback)
     * @param {number[]} point 
     * @param {CubicBezier[]} curves 
     * @returns {number}
     */
    distanceAt(point, curves) {
        return multiCurveDistance(point, curves, 16);
    }
    
    destroy() {
        this.segmentBuffer?.destroy();
        this.radiiBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default {
    sdCapsule,
    bezierDistanceCapsule,
    bezierClosestNewton,
    bezierDistanceHybrid,
    multiCurveDistance,
    smin,
    curvesToGPUBuffer,
    curvesToSegments,
    BezierDistanceCompute,
};
