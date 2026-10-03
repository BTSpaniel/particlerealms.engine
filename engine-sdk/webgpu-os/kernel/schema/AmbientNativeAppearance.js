// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Read-only, graph-authored functions for retained native render pipelines.
 * Resource declarations, entry-point signatures and simulation stay host-owned. */
function maskedSource(source) {
    let depth = 0, line = false, result = '';
    for (let i = 0; i < source.length; i++) {
        const pair = source.slice(i, i + 2), char = source[i];
        if (line) { if (char === '\n') line = false; result += char === '\n' ? '\n' : ' '; }
        else if (pair === '/*') { depth++; result += '  '; i++; }
        else if (depth && pair === '*/') { depth--; result += '  '; i++; }
        else if (depth) result += char === '\n' ? '\n' : ' ';
        else if (pair === '//') { line = true; result += '  '; i++; }
        else result += char;
    }
    if (depth) throw new TypeError('Unterminated WGSL block comment.');
    return result;
}

export function extractAmbientWgslFunctions(source) {
    const clean = maskedSource(String(source)), functions = [], pattern = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    for (let match; (match = pattern.exec(clean));) {
        const open = clean.indexOf('{', match.index);
        if (open < 0) throw new TypeError(`Function '${match[1]}' has no body.`);
        let depth = 1, end = open + 1;
        while (end < clean.length && depth) { if (clean[end] === '{') depth++; else if (clean[end] === '}') depth--; end++; }
        if (depth) throw new TypeError(`Function '${match[1]}' has an unclosed body.`);
        functions.push({ name: match[1], start: match.index, open, end, signature: source.slice(match.index, open), body: source.slice(open + 1, end - 1), source: source.slice(match.index, end) });
        pattern.lastIndex = end;
    }
    return functions;
}

const signatureKey = source => source.replace(/@(?:builtin|location|interpolate|invariant)\s*(?:\([^)]*\))?/g, '').replace(/\s+/g, '');

export function assertAmbientNativeAppearanceFunctions(source) {
    if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 96 * 1024) throw new TypeError('Native appearance functions must fit within 96 KiB.');
    const clean = maskedSource(source), functions = extractAmbientWgslFunctions(source);
    let remainder = '', end = 0;
    const names = new Set();
    for (const fn of functions) {
        remainder += clean.slice(end, fn.start); end = fn.end;
        if (names.has(fn.name) || /^(?:artTime|artDelta|ambientV3Grade)$/.test(fn.name)) throw new TypeError(`Duplicate or reserved appearance function '${fn.name}'.`);
        names.add(fn.name);
    }
    remainder += clean.slice(end);
    if (remainder.trim()) throw new TypeError('Native appearance accepts function declarations only.');
    if (/@|\b(?:loop|while|textureStore|atomic\w*|workgroupBarrier|storageBarrier|enable|requires|override)\b|\bvar\s*</.test(clean)) throw new TypeError('Native appearance cannot change bindings, GPU state, or declare unbounded loops.');
    const loops = [...clean.matchAll(/\bfor\s*\(\s*var\s+(\w+)\s*=\s*(\d+)u?\s*;\s*\1\s*<\s*(\d+)u?\s*;\s*(?:\1\s*\+=\s*(\d+)u?|\1\+\+)\s*\)/g)];
    if (loops.length !== (clean.match(/\bfor\s*\(/g) ?? []).length || loops.some(loop => Number(loop[4] ?? 1) <= 0 || Math.ceil((Number(loop[3]) - Number(loop[2])) / Number(loop[4] ?? 1)) > 128)) throw new TypeError('Native appearance loops require literal increasing bounds of at most 128 iterations.');
    return functions;
}

export function applyAmbientNativeAppearance(base, authored) {
    if (authored === undefined) return base;
    const functions = assertAmbientNativeAppearanceFunctions(authored), originals = extractAmbientWgslFunctions(base), edits = [], additions = [];
    for (const fn of functions) {
        const original = originals.find(candidate => candidate.name === fn.name);
        if (!original) additions.push(fn.source);
        else {
            if (signatureKey(original.signature) !== signatureKey(fn.signature)) throw new TypeError(`Native appearance changes the signature of '${fn.name}'.`);
            edits.push({ start: original.open + 1, end: original.end - 1, body: fn.body });
        }
    }
    let source = base;
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.body + source.slice(edit.end);
    return source + '\n' + additions.join('\n');
}

/** Interaction code receives value arguments and returns local state. Unlike
 * appearance functions, it cannot name any host resource or frame global. */
export const AMBIENT_NATIVE_INTERACTION_SIGNATURES = Object.freeze({
    'flowing-ink': Object.freeze([
        'fn ambientInkInteraction(uv:vec2f,state:vec4f,dt:f32,pointer:vec4f,pointerState:vec4f,clickActivity:vec4f,effects:vec4f,pigmentLoad:f32)->vec4f',
    ]),
    'liquid-chrome': Object.freeze([
        'fn ambientChromeInteraction(position:vec2f,initialVelocity:vec2f,dt:f32,pointer:vec4f,pointerState:vec4f,effects:vec4f)->vec3f',
    ]),
    'ripple-horizon': Object.freeze([
        'fn ambientRippleInteraction(x:f32,initialVelocity:f32,dt:f32,pointer:vec4f,pointerState:vec4f,clickActivity:vec4f,effects:vec4f,rippleStrength:f32)->f32',
    ]),
    'quantum-probability-field': Object.freeze([
        'fn ambientQuantumDwell(pointer:vec4f,pointerState:vec4f)->f32',
        'fn ambientQuantumInteraction(uv:vec2f,initialAmplitude:vec2f,dt:f32,pointer:vec4f,pointerState:vec4f,clickActivity:vec4f,effects:vec4f)->vec2f',
    ]),
});
const INTERACTION_TYPES = '(?:f32|i32|u32|bool|vec[234][fiu])';
// Optional newer Chrome entry preserves previously saved six-argument helpers.
// Values describing the rendered body are still supplied by the one GPU owner.
export const AMBIENT_NATIVE_CHROME_RESPONSE_SIGNATURE = 'fn ambientInteractionChromeResponse(position:vec2f,initialVelocity:vec2f,phase:f32,bodyIndex:u32,dt:f32,viewport:vec2f,pointer:vec4f,pointerState:vec4f,clickActivity:vec4f,effects:vec4f)->vec3f';
const INTERACTION_BUILTINS = new Set(('abs acos acosh all any asin asinh atan atanh atan2 ceil clamp cos cosh countLeadingZeros countOneBits countTrailingZeros cross degrees distance dot exp exp2 extractBits faceForward firstLeadingBit firstTrailingBit floor fma fract frexp inverseSqrt ldexp length log log2 max min mix normalize pow radians reflect refract reverseBits round saturate select sign sin sinh smoothstep sqrt step tan tanh transpose trunc f32 i32 u32 bool vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u').split(' '));
const INTERACTION_KEYWORDS = new Set('let var const return if else for break continue true false'.split(' '));

export function assertAmbientNativeInteractionFunctions(source, recipeId) {
    const expected = AMBIENT_NATIVE_INTERACTION_SIGNATURES[recipeId];
    if (!expected) throw new TypeError('This recipe does not expose retained interaction functions.');
    const functions = assertAmbientNativeAppearanceFunctions(source);
    if (functions.length > 32) throw new TypeError('Interaction code permits at most 32 pure functions.');
    const names = new Set(functions.map(fn => fn.name)), calls = new Map();
    const signaturePattern = new RegExp(`^fn\\s+([A-Za-z_]\\w*)\\s*\\(([^()]*)\\)\\s*->\\s*${INTERACTION_TYPES}\\s*$`);
    const argumentPattern = new RegExp(`^([A-Za-z_]\\w*)\\s*:\\s*${INTERACTION_TYPES}$`);
    const expectedNames = new Set(expected.map(signature => /^fn (\w+)/.exec(signature)[1]));
    const chromeResponse = functions.find(fn => fn.name === 'ambientInteractionChromeResponse');
    if (chromeResponse && (recipeId !== 'liquid-chrome' || signatureKey(chromeResponse.signature) !== signatureKey(AMBIENT_NATIVE_CHROME_RESPONSE_SIGNATURE))) throw new TypeError('Chrome screen response requires its fixed value signature.');
    for (const signature of expected) {
        const name = /^fn (\w+)/.exec(signature)[1], actual = functions.find(fn => fn.name === name);
        if (!actual || signatureKey(actual.signature) !== signatureKey(signature)) throw new TypeError(`Interaction requires its fixed '${name}' value signature.`);
    }
    for (const fn of functions) {
        if (!expectedNames.has(fn.name) && !/^(?:ambientInteraction|nativeComponent\d+_)/.test(fn.name)) throw new TypeError(`Interaction helper '${fn.name}' must use its authored namespace.`);
        const signature = maskedSource(fn.signature).trim().match(signaturePattern);
        if (!signature) throw new TypeError(`Interaction '${fn.name}' must accept and return scalar or vector values.`);
        const locals = new Set();
        for (const argument of signature[2].split(',').filter(value => value.trim())) {
            const parameter = argument.trim().match(argumentPattern);
            if (!parameter || locals.has(parameter[1])) throw new TypeError(`Interaction '${fn.name}' has invalid value arguments.`);
            locals.add(parameter[1]);
        }
        const clean = maskedSource(fn.body);
        for (const match of clean.matchAll(/\b(?:let|var|const)\s+([A-Za-z_]\w*)/g)) locals.add(match[1]);
        // Strip numeric literals before scanning names, including scientific
        // notation. Only local values, closed function calls and math remain.
        const tokens = clean.replace(/\b(?:0x[0-9a-f]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)[fhiu]?\b|\.\d+(?:[eE][+-]?\d+)?[fh]?/gi, ' ');
        for (const match of tokens.matchAll(/[A-Za-z_]\w*/g)) {
            const name = match[0], previous = tokens.slice(0, match.index).trimEnd().at(-1);
            if (previous === '.') {
                if (!/^(?:[xyzw]{1,4}|[rgba]{1,4})$/.test(name)) throw new TypeError('Interaction code permits vector swizzles only.');
            } else if (!locals.has(name) && !names.has(name) && !INTERACTION_BUILTINS.has(name) && !INTERACTION_KEYWORDS.has(name)) throw new TypeError(`Interaction code cannot access '${name}'.`);
        }
        calls.set(fn.name, [...clean.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]).filter(name => names.has(name)));
    }
    const visiting = new Set(), visited = new Set();
    const visit = name => {
        if (visiting.has(name)) throw new TypeError('Interaction function calls must not recurse.');
        if (visited.has(name)) return;
        visiting.add(name); for (const child of calls.get(name) ?? []) visit(child);
        visiting.delete(name); visited.add(name);
    };
    for (const name of names) visit(name);
    return functions;
}

export function applyAmbientNativeInteraction(base, authored, recipeId) {
    if (authored === undefined) return base;
    assertAmbientNativeInteractionFunctions(authored, recipeId);
    // All required signatures were checked above. The authored library replaces
    // the pure default library, so deleted helper code cannot remain active.
    return authored;
}
