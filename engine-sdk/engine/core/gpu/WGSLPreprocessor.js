// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WGSL Preprocessor - #include, #define, #ifdef support for shader modularity
 */

export class WGSLPreprocessor {
    constructor() {
        this._includes = new Map();  // name -> source code
        this._globalDefines = new Map();  // name -> value
        this._includeStack = [];  // Prevent circular includes
    }

    /**
     * Register an include file
     * @param {string} name - Include name (e.g., 'common.wgsl', 'math')
     * @param {string} source - WGSL source code
     */
    registerInclude(name, source) {
        this._includes.set(name, source);
    }

    /**
     * Set a global define (applied to all processed shaders)
     */
    setGlobalDefine(name, value = 1) {
        this._globalDefines.set(name, value);
    }

    /**
     * Remove a global define
     */
    removeGlobalDefine(name) {
        this._globalDefines.delete(name);
    }

    /**
     * Process WGSL source code with preprocessor directives
     * @param {string} source - Raw WGSL with preprocessor directives
     * @param {Object} defines - Additional defines for this shader
     * @returns {string} Processed WGSL
     */
    process(source, defines = {}) {
        this._includeStack = [];
        const allDefines = new Map([...this._globalDefines, ...Object.entries(defines)]);
        return this._processSource(source, allDefines);
    }

    _processSource(source, defines) {
        const lines = source.split('\n');
        const output = [];
        const conditionStack = [true];  // Stack of condition states

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // #include directive
            if (trimmed.startsWith('#include')) {
                if (conditionStack[conditionStack.length - 1]) {
                    const includeName = this._parseInclude(trimmed);
                    if (includeName) {
                        const included = this._resolveInclude(includeName, defines);
                        output.push(`// BEGIN INCLUDE: ${includeName}`);
                        output.push(included);
                        output.push(`// END INCLUDE: ${includeName}`);
                    }
                }
                continue;
            }

            // #define directive
            if (trimmed.startsWith('#define')) {
                if (conditionStack[conditionStack.length - 1]) {
                    const match = trimmed.match(/#define\s+(\w+)(?:\s+(.+))?/);
                    if (match) {
                        const [, name, value] = match;
                        defines.set(name, value !== undefined ? this._evaluateValue(value, defines) : 1);
                    }
                }
                continue;
            }

            // #undef directive
            if (trimmed.startsWith('#undef')) {
                if (conditionStack[conditionStack.length - 1]) {
                    const match = trimmed.match(/#undef\s+(\w+)/);
                    if (match) {
                        defines.delete(match[1]);
                    }
                }
                continue;
            }

            // #ifdef directive
            if (trimmed.startsWith('#ifdef')) {
                const match = trimmed.match(/#ifdef\s+(\w+)/);
                if (match) {
                    const defined = defines.has(match[1]);
                    conditionStack.push(conditionStack[conditionStack.length - 1] && defined);
                }
                continue;
            }

            // #ifndef directive
            if (trimmed.startsWith('#ifndef')) {
                const match = trimmed.match(/#ifndef\s+(\w+)/);
                if (match) {
                    const notDefined = !defines.has(match[1]);
                    conditionStack.push(conditionStack[conditionStack.length - 1] && notDefined);
                }
                continue;
            }

            // #if directive (simple expression support)
            if (trimmed.startsWith('#if ')) {
                const expr = trimmed.slice(4).trim();
                const result = this._evaluateCondition(expr, defines);
                conditionStack.push(conditionStack[conditionStack.length - 1] && result);
                continue;
            }

            // #elif directive
            if (trimmed.startsWith('#elif')) {
                const currentState = conditionStack.pop();
                const parentState = conditionStack[conditionStack.length - 1];
                if (!currentState && parentState) {
                    const expr = trimmed.slice(5).trim();
                    const result = this._evaluateCondition(expr, defines);
                    conditionStack.push(result);
                } else {
                    conditionStack.push(false);
                }
                continue;
            }

            // #else directive
            if (trimmed === '#else') {
                const currentState = conditionStack.pop();
                const parentState = conditionStack[conditionStack.length - 1];
                conditionStack.push(parentState && !currentState);
                continue;
            }

            // #endif directive
            if (trimmed === '#endif') {
                conditionStack.pop();
                continue;
            }

            // Regular line - include if conditions are met
            if (conditionStack[conditionStack.length - 1]) {
                output.push(this._substituteDefines(line, defines));
            }
        }

        return output.join('\n');
    }

    _parseInclude(line) {
        // Support both #include "file" and #include <file>
        const match = line.match(/#include\s+["<]([^">]+)["'>]/);
        return match ? match[1] : null;
    }

    _resolveInclude(name, defines) {
        if (this._includeStack.includes(name)) {
            console.error(`[WGSLPreprocessor] Circular include detected: ${name}`);
            return `// ERROR: Circular include: ${name}`;
        }

        const source = this._includes.get(name);
        if (!source) {
            console.warn(`[WGSLPreprocessor] Include not found: ${name}`);
            return `// WARNING: Include not found: ${name}`;
        }

        this._includeStack.push(name);
        const processed = this._processSource(source, defines);
        this._includeStack.pop();
        return processed;
    }

    _substituteDefines(line, defines) {
        let result = line;
        for (const [name, value] of defines) {
            // Replace ${NAME} syntax
            result = result.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), String(value));
            // Replace standalone NAME with value (word boundary)
            if (typeof value === 'number' || typeof value === 'string') {
                result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), String(value));
            }
        }
        return result;
    }

    _evaluateValue(value, defines) {
        // Simple value evaluation
        const trimmed = value.trim();
        if (defines.has(trimmed)) {
            return defines.get(trimmed);
        }
        const num = parseFloat(trimmed);
        if (!isNaN(num)) return num;
        return trimmed;
    }

    _evaluateCondition(expr, defines) {
        // Support: defined(X), !defined(X), X == Y, X != Y, X > Y, etc.
        const definedMatch = expr.match(/defined\s*\(\s*(\w+)\s*\)/);
        if (definedMatch) {
            const isDefined = defines.has(definedMatch[1]);
            return expr.startsWith('!') ? !isDefined : isDefined;
        }

        // Comparison operators
        const compMatch = expr.match(/(\w+)\s*(==|!=|>=|<=|>|<)\s*(\w+)/);
        if (compMatch) {
            const [, left, op, right] = compMatch;
            const leftVal = defines.has(left) ? defines.get(left) : parseFloat(left) || 0;
            const rightVal = defines.has(right) ? defines.get(right) : parseFloat(right) || 0;
            switch (op) {
                case '==': return leftVal == rightVal;
                case '!=': return leftVal != rightVal;
                case '>': return leftVal > rightVal;
                case '<': return leftVal < rightVal;
                case '>=': return leftVal >= rightVal;
                case '<=': return leftVal <= rightVal;
            }
        }

        // Simple truthy check
        if (defines.has(expr)) {
            return !!defines.get(expr);
        }

        return false;
    }

    /**
     * Get all registered include names
     */
    getIncludeNames() {
        return Array.from(this._includes.keys());
    }

    /**
     * Clear all includes and defines
     */
    clear() {
        this._includes.clear();
        this._globalDefines.clear();
    }
}

// Common WGSL include snippets
export const WGSL_COMMON_INCLUDES = {
    'math': `
// Common math functions
fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn saturate3(v: vec3f) -> vec3f { return clamp(v, vec3f(0.0), vec3f(1.0)); }
fn saturate4(v: vec4f) -> vec4f { return clamp(v, vec4f(0.0), vec4f(1.0)); }
fn lerp(a: f32, b: f32, t: f32) -> f32 { return a + (b - a) * t; }
fn lerp3(a: vec3f, b: vec3f, t: f32) -> vec3f { return a + (b - a) * t; }
fn remap(value: f32, low1: f32, high1: f32, low2: f32, high2: f32) -> f32 {
    return low2 + (value - low1) * (high2 - low2) / (high1 - low1);
}
fn sq(x: f32) -> f32 { return x * x; }
const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;
const EPSILON: f32 = 0.0001;
`,

    'noise': `
// Hash and noise functions
fn hash11(p: f32) -> f32 {
    var p2 = fract(p * 0.1031);
    p2 += dot(p2, p2 + 33.33);
    return fract(p2 * p2);
}
fn hash21(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
    var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}
fn hash31(p: vec3f) -> f32 {
    var p2 = fract(p * 0.1031);
    p2 += dot(p2, p2.yzx + 33.33);
    return fract((p2.x + p2.y) * p2.z);
}
`,

    'color': `
// Color space conversions
fn linearToSRGB(c: vec3f) -> vec3f {
    return select(c * 12.92, 1.055 * pow(c, vec3f(1.0/2.4)) - 0.055, c > vec3f(0.0031308));
}
fn sRGBToLinear(c: vec3f) -> vec3f {
    return select(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), c > vec3f(0.04045));
}
fn rgbToHsv(c: vec3f) -> vec3f {
    let k = vec4f(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    let p = select(vec4f(c.bg, k.wz), vec4f(c.gb, k.xy), c.g < c.b);
    let q = select(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), c.r < p.x);
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn hsvToRgb(c: vec3f) -> vec3f {
    let k = vec4f(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
    return c.z * mix(k.xxx, clamp(p - k.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}
`,

    'transforms': `
// Transform utilities
fn rotateX(angle: f32) -> mat3x3f {
    let c = cos(angle); let s = sin(angle);
    return mat3x3f(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}
fn rotateY(angle: f32) -> mat3x3f {
    let c = cos(angle); let s = sin(angle);
    return mat3x3f(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}
fn rotateZ(angle: f32) -> mat3x3f {
    let c = cos(angle); let s = sin(angle);
    return mat3x3f(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}
fn worldToClip(worldPos: vec3f, viewProj: mat4x4f) -> vec4f {
    return viewProj * vec4f(worldPos, 1.0);
}
`,

    'sdf': `
// Signed distance functions
fn sdSphere(p: vec3f, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec3f, b: vec3f) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
    let pa = p - a; let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}
fn opUnion(d1: f32, d2: f32) -> f32 { return min(d1, d2); }
fn opSubtract(d1: f32, d2: f32) -> f32 { return max(-d1, d2); }
fn opIntersect(d1: f32, d2: f32) -> f32 { return max(d1, d2); }
fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}
`,
};

/**
 * Create a preprocessor with common includes registered
 */
export function createPreprocessor() {
    const pp = new WGSLPreprocessor();
    for (const [name, source] of Object.entries(WGSL_COMMON_INCLUDES)) {
        pp.registerInclude(name, source);
    }
    return pp;
}
