// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BezierCurves.js - Bezier Curve Evaluation and Manipulation
 * 
 * Provides cubic Bezier curve operations for procedural generation:
 * - Tree branches, roots, vines
 * - Cave tunnels, worm paths
 * - Structural beams, supports
 * - River/road networks
 * 
 * Key Algorithms:
 * - De Casteljau: Numerically stable curve evaluation
 * - Derivatives: Tangent and curvature calculation
 * - Subdivision: Split curves for LOD/approximation
 * - Arc Length: For uniform parameterization
 * 
 * Curve Types:
 * - Quadratic (3 control points): Simple, fast
 * - Cubic (4 control points): Standard, flexible
 * - Higher order: Via recursive De Casteljau
 */

// ============================================================================
import { vec3Add, vec3Cross, vec3Dot, vec3Length, vec3Lerp, vec3Scale, vec3Sub } from './MathVec3.js';

// VECTOR HELPERS (inline for performance)
// ============================================================================

function vec3Normalize(v) {
    const len = vec3Length(v);
    if (len < 0.0001) return [0, 1, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

// CUBIC BEZIER CURVE CLASS
// ============================================================================

/**
 * Cubic Bezier curve defined by 4 control points
 */
export class CubicBezier {
    /**
     * @param {number[]} p0 - Start point [x, y, z]
     * @param {number[]} p1 - Control point 1
     * @param {number[]} p2 - Control point 2
     * @param {number[]} p3 - End point
     * @param {number} radius - Tube radius (for distance field)
     */
    constructor(p0, p1, p2, p3, radius = 1.0) {
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.p3 = p3;
        this.radius = radius;
        
        // Cached coefficients for polynomial form
        this._coeffs = null;
        this._arcLengthLUT = null;
    }
    
    /**
     * Evaluate curve at parameter t using De Casteljau's algorithm
     * Numerically stable, works for any degree
     * @param {number} t - Parameter [0, 1]
     * @returns {number[]} Point on curve
     */
    evaluate(t) {
        // De Casteljau: recursive linear interpolation
        const a = vec3Lerp(this.p0, this.p1, t);
        const b = vec3Lerp(this.p1, this.p2, t);
        const c = vec3Lerp(this.p2, this.p3, t);
        
        const d = vec3Lerp(a, b, t);
        const e = vec3Lerp(b, c, t);
        
        return vec3Lerp(d, e, t);
    }
    
    /**
     * Evaluate using polynomial form (faster for many evaluations)
     * B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
     * @param {number} t 
     * @returns {number[]}
     */
    evaluatePoly(t) {
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        
        const c0 = mt3;
        const c1 = 3 * mt2 * t;
        const c2 = 3 * mt * t2;
        const c3 = t3;
        
        return [
            c0 * this.p0[0] + c1 * this.p1[0] + c2 * this.p2[0] + c3 * this.p3[0],
            c0 * this.p0[1] + c1 * this.p1[1] + c2 * this.p2[1] + c3 * this.p3[1],
            c0 * this.p0[2] + c1 * this.p1[2] + c2 * this.p2[2] + c3 * this.p3[2],
        ];
    }
    
    /**
     * First derivative (tangent direction, not normalized)
     * B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
     * @param {number} t 
     * @returns {number[]}
     */
    derivative(t) {
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;
        
        const c0 = 3 * mt2;
        const c1 = 6 * mt * t;
        const c2 = 3 * t2;
        
        const d0 = vec3Sub(this.p1, this.p0);
        const d1 = vec3Sub(this.p2, this.p1);
        const d2 = vec3Sub(this.p3, this.p2);
        
        return [
            c0 * d0[0] + c1 * d1[0] + c2 * d2[0],
            c0 * d0[1] + c1 * d1[1] + c2 * d2[1],
            c0 * d0[2] + c1 * d1[2] + c2 * d2[2],
        ];
    }
    
    /**
     * Second derivative (for curvature)
     * B''(t) = 6(1-t)(P2-2P1+P0) + 6t(P3-2P2+P1)
     * @param {number} t 
     * @returns {number[]}
     */
    secondDerivative(t) {
        const mt = 1 - t;
        
        const a = vec3Add(vec3Sub(this.p2, vec3Scale(this.p1, 2)), this.p0);
        const b = vec3Add(vec3Sub(this.p3, vec3Scale(this.p2, 2)), this.p1);
        
        return vec3Add(vec3Scale(a, 6 * mt), vec3Scale(b, 6 * t));
    }
    
    /**
     * Get normalized tangent at t
     * @param {number} t 
     * @returns {number[]}
     */
    tangent(t) {
        return vec3Normalize(this.derivative(t));
    }
    
    /**
     * Get normal vector at t (perpendicular to tangent)
     * @param {number} t 
     * @param {number[]} up - Reference up vector
     * @returns {number[]}
     */
    normal(t, up = [0, 1, 0]) {
        const tan = this.tangent(t);
        const binormal = vec3Normalize(vec3Cross(tan, up));
        return vec3Cross(binormal, tan);
    }
    
    /**
     * Get curvature at t
     * κ = |B' × B''| / |B'|³
     * @param {number} t 
     * @returns {number}
     */
    curvature(t) {
        const d1 = this.derivative(t);
        const d2 = this.secondDerivative(t);
        
        const cross = vec3Cross(d1, d2);
        const crossLen = vec3Length(cross);
        const d1Len = vec3Length(d1);
        
        if (d1Len < 0.0001) return 0;
        return crossLen / (d1Len * d1Len * d1Len);
    }
    
    /**
     * Subdivide curve at t into two curves
     * @param {number} t 
     * @returns {[CubicBezier, CubicBezier]}
     */
    subdivide(t = 0.5) {
        const a = vec3Lerp(this.p0, this.p1, t);
        const b = vec3Lerp(this.p1, this.p2, t);
        const c = vec3Lerp(this.p2, this.p3, t);
        
        const d = vec3Lerp(a, b, t);
        const e = vec3Lerp(b, c, t);
        
        const mid = vec3Lerp(d, e, t);
        
        // Interpolate radius
        const r1 = this.radius;
        const r2 = this.radius; // Could vary along curve
        
        return [
            new CubicBezier(this.p0, a, d, mid, r1),
            new CubicBezier(mid, e, c, this.p3, r2),
        ];
    }
    
    /**
     * Approximate arc length using Gaussian quadrature
     * @param {number} samples 
     * @returns {number}
     */
    arcLength(samples = 16) {
        let length = 0;
        const dt = 1.0 / samples;
        
        for (let i = 0; i < samples; i++) {
            const t = (i + 0.5) * dt;
            const deriv = this.derivative(t);
            length += vec3Length(deriv) * dt;
        }
        
        return length;
    }
    
    /**
     * Build arc-length lookup table for uniform parameterization
     * @param {number} segments 
     */
    buildArcLengthLUT(segments = 32) {
        this._arcLengthLUT = new Float32Array(segments + 1);
        this._arcLengthLUT[0] = 0;
        
        let totalLength = 0;
        const dt = 1.0 / segments;
        
        for (let i = 1; i <= segments; i++) {
            const t = i * dt;
            const deriv = this.derivative(t - dt * 0.5);
            totalLength += vec3Length(deriv) * dt;
            this._arcLengthLUT[i] = totalLength;
        }
        
        // Normalize to [0, 1]
        for (let i = 1; i <= segments; i++) {
            this._arcLengthLUT[i] /= totalLength;
        }
        
        return totalLength;
    }
    
    /**
     * Convert arc-length parameter to curve parameter
     * @param {number} s - Arc-length parameter [0, 1]
     * @returns {number} - Curve parameter t
     */
    arcLengthToT(s) {
        if (!this._arcLengthLUT) {
            this.buildArcLengthLUT();
        }
        
        const lut = this._arcLengthLUT;
        const n = lut.length - 1;
        
        // Binary search
        let low = 0;
        let high = n;
        
        while (low < high) {
            const mid = (low + high) >> 1;
            if (lut[mid] < s) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        
        // Interpolate
        if (low === 0) return 0;
        if (low === n) return 1;
        
        const s0 = lut[low - 1];
        const s1 = lut[low];
        const t0 = (low - 1) / n;
        const t1 = low / n;
        
        const frac = (s - s0) / (s1 - s0);
        return t0 + frac * (t1 - t0);
    }
    
    /**
     * Sample curve uniformly by arc length
     * @param {number} count 
     * @returns {number[][]}
     */
    sampleUniform(count) {
        const points = [];
        for (let i = 0; i < count; i++) {
            const s = i / (count - 1);
            const t = this.arcLengthToT(s);
            points.push(this.evaluate(t));
        }
        return points;
    }
    
    /**
     * Get bounding box
     * @returns {{ min: number[], max: number[] }}
     */
    getBoundingBox() {
        // Conservative: use control point bounds
        const min = [
            Math.min(this.p0[0], this.p1[0], this.p2[0], this.p3[0]) - this.radius,
            Math.min(this.p0[1], this.p1[1], this.p2[1], this.p3[1]) - this.radius,
            Math.min(this.p0[2], this.p1[2], this.p2[2], this.p3[2]) - this.radius,
        ];
        const max = [
            Math.max(this.p0[0], this.p1[0], this.p2[0], this.p3[0]) + this.radius,
            Math.max(this.p0[1], this.p1[1], this.p2[1], this.p3[1]) + this.radius,
            Math.max(this.p0[2], this.p1[2], this.p2[2], this.p3[2]) + this.radius,
        ];
        return { min, max };
    }
    
    /**
     * Serialize to flat array for GPU upload
     * @returns {Float32Array}
     */
    toGPUData() {
        return new Float32Array([
            ...this.p0, 0,
            ...this.p1, 0,
            ...this.p2, 0,
            ...this.p3, this.radius,
        ]);
    }
    
    /**
     * Create from flat array
     * @param {Float32Array} data 
     * @returns {CubicBezier}
     */
    static fromGPUData(data) {
        return new CubicBezier(
            [data[0], data[1], data[2]],
            [data[4], data[5], data[6]],
            [data[8], data[9], data[10]],
            [data[12], data[13], data[14]],
            data[15]
        );
    }
}

// ============================================================================
// QUADRATIC BEZIER (Simpler, faster)
// ============================================================================

export class QuadraticBezier {
    constructor(p0, p1, p2, radius = 1.0) {
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.radius = radius;
    }
    
    evaluate(t) {
        const mt = 1 - t;
        const a = vec3Lerp(this.p0, this.p1, t);
        const b = vec3Lerp(this.p1, this.p2, t);
        return vec3Lerp(a, b, t);
    }
    
    derivative(t) {
        const d0 = vec3Sub(this.p1, this.p0);
        const d1 = vec3Sub(this.p2, this.p1);
        return vec3Add(vec3Scale(d0, 2 * (1 - t)), vec3Scale(d1, 2 * t));
    }
    
    tangent(t) {
        return vec3Normalize(this.derivative(t));
    }
    
    /**
     * Elevate to cubic (exact conversion)
     * @returns {CubicBezier}
     */
    toCubic() {
        const cp1 = vec3Add(vec3Scale(this.p0, 1/3), vec3Scale(this.p1, 2/3));
        const cp2 = vec3Add(vec3Scale(this.p1, 2/3), vec3Scale(this.p2, 1/3));
        return new CubicBezier(this.p0, cp1, cp2, this.p2, this.radius);
    }
}

// ============================================================================
// BEZIER SPLINE (Multiple connected curves)
// ============================================================================

export class BezierSpline {
    constructor() {
        this.curves = [];
    }
    
    /**
     * Add a curve segment
     * @param {CubicBezier} curve 
     */
    addCurve(curve) {
        this.curves.push(curve);
    }
    
    /**
     * Create smooth spline through points (Catmull-Rom style)
     * @param {number[][]} points 
     * @param {number} tension - 0 = sharp, 1 = smooth
     * @param {number} radius 
     */
    static throughPoints(points, tension = 0.5, radius = 1.0) {
        const spline = new BezierSpline();
        const n = points.length;
        
        if (n < 2) return spline;
        
        for (let i = 0; i < n - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(n - 1, i + 2)];
            
            // Catmull-Rom to Bezier conversion
            const t = tension / 3;
            const cp1 = vec3Add(p1, vec3Scale(vec3Sub(p2, p0), t));
            const cp2 = vec3Sub(p2, vec3Scale(vec3Sub(p3, p1), t));
            
            spline.addCurve(new CubicBezier(p1, cp1, cp2, p2, radius));
        }
        
        return spline;
    }
    
    /**
     * Evaluate spline at global parameter [0, numCurves]
     * @param {number} t 
     * @returns {number[]}
     */
    evaluate(t) {
        const n = this.curves.length;
        if (n === 0) return [0, 0, 0];
        
        const curveIdx = Math.min(Math.floor(t), n - 1);
        const localT = t - curveIdx;
        
        return this.curves[curveIdx].evaluate(Math.min(localT, 1));
    }
    
    /**
     * Get total number of curves
     * @returns {number}
     */
    get length() {
        return this.curves.length;
    }
    
    /**
     * Sample entire spline
     * @param {number} samplesPerCurve 
     * @returns {number[][]}
     */
    sample(samplesPerCurve = 8) {
        const points = [];
        
        for (let i = 0; i < this.curves.length; i++) {
            const curve = this.curves[i];
            const samples = i === this.curves.length - 1 ? samplesPerCurve : samplesPerCurve - 1;
            
            for (let j = 0; j <= samples; j++) {
                const t = j / samplesPerCurve;
                points.push(curve.evaluate(t));
            }
        }
        
        return points;
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a straight line as a degenerate Bezier
 * @param {number[]} start 
 * @param {number[]} end 
 * @param {number} radius 
 * @returns {CubicBezier}
 */
export function straightLine(start, end, radius = 1.0) {
    const third = vec3Scale(vec3Sub(end, start), 1/3);
    const p1 = vec3Add(start, third);
    const p2 = vec3Add(p1, third);
    return new CubicBezier(start, p1, p2, end, radius);
}

/**
 * Create an arc approximation using Bezier
 * @param {number[]} center 
 * @param {number} radius 
 * @param {number} startAngle 
 * @param {number} endAngle 
 * @param {number} tubeRadius 
 * @returns {CubicBezier}
 */
export function arc(center, radius, startAngle, endAngle, tubeRadius = 1.0) {
    const angle = endAngle - startAngle;
    const k = 4 / 3 * Math.tan(angle / 4);
    
    const cos0 = Math.cos(startAngle);
    const sin0 = Math.sin(startAngle);
    const cos1 = Math.cos(endAngle);
    const sin1 = Math.sin(endAngle);
    
    const p0 = [center[0] + radius * cos0, center[1], center[2] + radius * sin0];
    const p3 = [center[0] + radius * cos1, center[1], center[2] + radius * sin1];
    
    const p1 = [
        p0[0] - k * radius * sin0,
        center[1],
        p0[2] + k * radius * cos0,
    ];
    const p2 = [
        p3[0] + k * radius * sin1,
        center[1],
        p3[2] - k * radius * cos1,
    ];
    
    return new CubicBezier(p0, p1, p2, p3, tubeRadius);
}

export default CubicBezier;
