// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { isPlainJsonObject } from './StrictJsonValue.js';
import { JSON_SCHEMA_PROFILE } from './JsonSchemaProfile.generated.js';

// Deliberately a tested Draft 2020-12 subset, not a complete implementation.
// References come only from the schema document or a synchronous host resolver.
const TYPES = new Set(JSON_SCHEMA_PROFILE.types);
const ANNOTATIONS = new Set(JSON_SCHEMA_PROFILE.annotations);
const KEYWORDS = new Set(JSON_SCHEMA_PROFILE.keywords);
const SINGLES = ['additionalProperties', 'not', 'if', 'then', 'else'];
const ARRAYS = ['prefixItems', 'oneOf', 'anyOf', 'allOf'];
const COUNTS = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'];
const NUMBERS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
const DEFAULTS = Object.freeze({ maxDepth: 64, maxEvaluationDepth: 256, maxNodes: 100000, maxErrors: 64, maxSteps: 200000, maxBytes: 8 * 1024 * 1024 });
const own = (value, key) => Object.hasOwn(value, key);
const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

export class SchemaValidationError extends Error {
    constructor(context, errors) {
        super(`[${context}] Schema validation failed:\n` + errors.map(error => '  • ' + error).join('\n'));
        this.name = 'SchemaValidationError'; this.context = context; this.errors = errors;
    }
}

function configuration(options) {
    const settings = { ...DEFAULTS, dialect: '2020-12', ...options };
    if (!['2020-12', 'legacy'].includes(settings.dialect)) throw new TypeError('Unsupported JSON Schema dialect');
    for (const key of Object.keys(DEFAULTS)) {
        if (!Number.isSafeInteger(settings[key]) || settings[key] <= 0 || settings[key] > DEFAULTS[key])
            throw new TypeError(`Invalid bounded schema option ${key}`);
    }
    return settings;
}

function failure(path, message) { throw new Error(`${String(path).slice(0, 512)}: ${message}`); }

// Snapshot own data descriptors, never getters, before recursive validation.
// Unlike cloning with JSON.stringify, this preserves own keys such as __proto__.
function snapshot(value, settings, legacy = false, state = { nodes: 0, bytes: 0 }) {
    const ancestors = new Set();
    const visit = (item, depth, path) => {
        if (++state.nodes > settings.maxNodes || depth > settings.maxDepth) failure(path, 'JSON traversal limit exceeded');
        state.bytes += typeof item === 'string' ? item.length * 2 + 16 : 32;
        if (state.bytes > settings.maxBytes) failure(path, 'JSON byte limit exceeded');
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number') {
            if (!Number.isFinite(item)) failure(path, 'JSON numbers must be finite');
            return item;
        }
        if (item === undefined && legacy) return item;
        if (!Array.isArray(item) && !isPlainJsonObject(item)) failure(path, 'Expected JSON data with a plain object prototype');
        if (ancestors.has(item)) failure(path, 'Cyclic JSON values are not supported');
        ancestors.add(item);
        const array = Array.isArray(item), keys = Reflect.ownKeys(item);
        if (keys.length > settings.maxNodes || array && (item.length > settings.maxNodes || keys.length !== item.length + 1))
            failure(path, 'Object or array traversal limit exceeded, or sparse array');
        const copy = array ? [] : Object.create(null);
        for (const key of keys) {
            if (array && key === 'length') continue;
            if (typeof key !== 'string' || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))
                failure(path, 'Symbols and custom array fields are not JSON');
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            if (!descriptor?.enumerable || !own(descriptor, 'value')) failure(path, 'Accessors and non-enumerable fields are not JSON');
            state.bytes += key.length * 2;
            copy[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
        }
        ancestors.delete(item);
        return copy;
    };
    return visit(value, 0, '(root)');
}

function budget(settings, maximumDepth = settings.maxDepth) {
    let steps = 0;
    return depth => { if (++steps > settings.maxSteps || depth > maximumDepth) failure('(root)', 'Schema evaluation limit exceeded'); };
}

function equal(left, right, step, depth = 0) {
    step(depth);
    if (left === right) return true; // JSON treats -0 and 0 as the same number.
    if (kind(left) !== kind(right) || left === null || typeof left !== 'object') return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => own(right, key) && equal(left[key], right[key], step, depth + 1));
}

function isMultiple(value, divisor) {
    // Compare the finite JSON numbers' decimal representations exactly. A
    // quotient tolerance can accept odd large integers as multiples of two.
    const parts = number => {
        const [mantissa, power = '0'] = Math.abs(number).toString().split('e');
        const point = mantissa.indexOf('.');
        return { coefficient: BigInt(mantissa.replace('.', '')), exponent: Number(power) - (point < 0 ? 0 : mantissa.length - point - 1) };
    };
    const left = parts(value), right = parts(divisor), shift = left.exponent - right.exponent;
    return shift >= 0 ? left.coefficient * 10n ** BigInt(shift) % right.coefficient === 0n
        : left.coefficient % (right.coefficient * 10n ** BigInt(-shift)) === 0n;
}

function pointer(document, fragment) {
    if (!fragment || fragment === '#') return document;
    let text;
    try { text = decodeURIComponent(fragment.slice(1)); } catch { failure('$ref', 'Invalid reference encoding'); }
    if (!text.startsWith('/')) failure('$ref', 'Only JSON Pointer fragments are supported');
    let value = document;
    for (const encoded of text.slice(1).split('/')) {
        if (/~(?:[^01]|$)/.test(encoded)) failure('$ref', 'Invalid JSON Pointer escape');
        const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!value || typeof value !== 'object' || !own(value, key)) failure('$ref', 'Unresolved local JSON Pointer');
        value = value[key];
    }
    return value;
}

function prepare(schema, settings, resolver) {
    const snapshotState = { nodes: 0, bytes: 0 };
    const capture = value => snapshot(value, settings, settings.dialect === 'legacy', snapshotState);
    const root = capture(schema);
    const documents = new Map(), resolved = new Map(), inspected = new Set(), step = budget(settings);
    const reference = (ref, document) => {
        if (ref.startsWith('#')) return { schema: pointer(document, ref), root: document };
        if (resolved.has(ref)) return resolved.get(ref);
        const hash = ref.indexOf('#'), name = hash < 0 ? ref : ref.slice(0, hash), fragment = hash < 0 ? '' : ref.slice(hash);
        // The original OS resolver receives the complete reference name. Keep
        // that contract, falling back to document + pointer when it is absent.
        if (hash >= 0) {
            const supplied = resolver?.(ref);
            if (supplied != null) {
                const external = capture(supplied);
                const result = { schema: external, root: external }; resolved.set(ref, result); return result;
            }
        }
        let external = documents.get(name);
        if (!documents.has(name)) {
            const supplied = resolver?.(name);
            if (supplied == null || typeof supplied?.then === 'function') failure('$ref', `Unknown reference ${name.slice(0, 256)}`);
            external = capture(supplied);
            documents.set(name, external);
        }
        const result = { schema: pointer(external, fragment), root: external };
        resolved.set(ref, result);
        return result;
    };
    const inspect = (node, document, depth = 0) => {
        step(depth);
        if (typeof node === 'boolean') return;
        if (!isPlainJsonObject(node)) failure('schema', 'A schema must be an object or boolean');
        if (inspected.has(node)) return;
        inspected.add(node);
        const legacy = settings.dialect === 'legacy';
        for (const key of Object.keys(node)) {
            if (!legacy && !KEYWORDS.has(key) && !ANNOTATIONS.has(key) && !key.startsWith('x-'))
                failure('schema', `Unsupported keyword ${key.slice(0, 128)}`);
        }
        if (own(node, '$schema') && !legacy && node.$schema !== JSON_SCHEMA_PROFILE.dialect)
            failure('schema', 'Only the Draft 2020-12 profile is supported');
        if (!legacy) {
            for (const key of ['$id', '$comment', 'title', 'description', 'format'])
                if (own(node, key) && typeof node[key] !== 'string') failure('schema', `Invalid ${key} annotation`);
            for (const key of ['deprecated', 'readOnly', 'writeOnly'])
                if (own(node, key) && typeof node[key] !== 'boolean') failure('schema', `Invalid ${key} annotation`);
            if (own(node, 'examples') && !Array.isArray(node.examples)) failure('schema', 'Invalid examples annotation');
            if (own(node, '$id') && node !== document) failure('schema', 'Nested $id resource scopes are not supported');
        }
        if (own(node, 'type')) {
            const types = Array.isArray(node.type) ? node.type : [node.type];
            if (!types.length || new Set(types).size !== types.length || !types.every(type => TYPES.has(type) || legacy && type === 'any'))
                failure('schema', 'Invalid type constraint');
        }
        for (const key of COUNTS) if (own(node, key) && (!Number.isSafeInteger(node[key]) || node[key] < 0)) failure('schema', `Invalid ${key}`);
        for (const key of NUMBERS) if (own(node, key) && (typeof node[key] !== 'number' || key === 'multipleOf' && node[key] <= 0)) failure('schema', `Invalid ${key}`);
        if (own(node, 'uniqueItems') && typeof node.uniqueItems !== 'boolean') failure('schema', 'Invalid uniqueItems');
        if (own(node, 'pattern')) {
            if (typeof node.pattern !== 'string' || node.pattern.length > 4096) failure('schema', 'Invalid pattern');
            try { new RegExp(node.pattern, legacy ? '' : 'u'); } catch { failure('schema', 'Invalid regular expression'); }
        }
        if (own(node, 'enum')) {
            if (!Array.isArray(node.enum) || !node.enum.length) failure('schema', 'enum must be non-empty');
            for (let i = 0; i < node.enum.length; i++) for (let j = 0; j < i; j++)
                if (equal(node.enum[i], node.enum[j], step)) failure('schema', 'enum values must be unique');
        }
        const strings = value => Array.isArray(value) && value.every(key => typeof key === 'string') && new Set(value).size === value.length;
        if (own(node, 'required') && !strings(node.required)) failure('schema', 'required must contain unique property names');
        if (own(node, 'dependentRequired')) {
            if (!isPlainJsonObject(node.dependentRequired) || !Object.values(node.dependentRequired).every(strings))
                failure('schema', 'Invalid dependentRequired');
        }
        for (const key of ['$defs', 'properties', ...(legacy ? ['definitions'] : [])]) if (own(node, key)) {
            if (!isPlainJsonObject(node[key])) failure('schema', `Invalid ${key}`);
            for (const sub of Object.values(node[key])) inspect(sub, document, depth + 1);
        }
        for (const key of SINGLES) if (own(node, key)) inspect(node[key], document, depth + 1);
        for (const key of ARRAYS) if (own(node, key)) {
            if (!Array.isArray(node[key]) || !node[key].length) failure('schema', `Invalid ${key}`);
            for (const sub of node[key]) inspect(sub, document, depth + 1);
        }
        if (own(node, 'items')) {
            if (legacy && Array.isArray(node.items)) { for (const sub of node.items) inspect(sub, document, depth + 1); }
            else inspect(node.items, document, depth + 1);
        }
        if (legacy && own(node, 'additionalItems')) inspect(node.additionalItems, document, depth + 1);
        if (own(node, '$ref')) {
            if (typeof node.$ref !== 'string' || node.$ref.length > 4096) failure('schema', 'Invalid $ref');
            const target = reference(node.$ref, document); inspect(target.schema, target.root, depth + 1);
        }
    };
    inspect(root, root);
    return { root, reference };
}

/** Assert that a schema uses only this implementation's supported profile. */
export function validateSchemaSupport(schema, options = {}) {
    try { const settings = configuration(options); prepare(schema, settings, options.refResolver); return { valid: true, errors: [] }; }
    catch (error) { return { valid: false, errors: [error.message] }; }
}

/** Bounded, side-effect-free validation of finite JSON data and approved schemas. */
export class JsonSchemaValidator {
    constructor(refResolver = null, options = {}) {
        this._ref = refResolver; this.options = configuration(options);
    }
    validateSchemaSupport(schema) { return validateSchemaSupport(schema, { ...this.options, refResolver: this._ref }); }
    validate(data, schema, path = '') {
        let prepared;
        try { prepared = prepare(schema, this.options, this._ref); }
        catch (error) { return { valid: false, errors: [error.message] }; }
        return this._validatePrepared(data, prepared, path);
    }
    /** Capture one bounded schema/reference closure for repeated immutable-contract validation. */
    compile(schema) {
        let prepared;
        try { prepared = prepare(schema, this.options, this._ref); }
        catch (error) { throw new SchemaValidationError('compile', [error.message]); }
        const validate = (data, path = '') => this._validatePrepared(data, prepared, path);
        return Object.freeze({ validate, assert: (data, context = 'validate') => {
            const result = validate(data);
            if (!result.valid) throw new SchemaValidationError(context, result.errors);
            return data;
        } });
    }
    _validatePrepared(data, prepared, path) {
        const errors = [], settings = this.options;
        try {
            const value = snapshot(data, settings, settings.dialect === 'legacy');
            this._check(value, prepared.root, path || '(root)', errors, prepared.root, prepared.reference, budget(settings, settings.maxEvaluationDepth), 0);
        } catch (error) { errors.push(error.message); }
        return { valid: !errors.length, errors: errors.slice(0, settings.maxErrors) };
    }
    assert(data, schema, context = 'validate') {
        const result = this.validate(data, schema);
        if (!result.valid) throw new SchemaValidationError(context, result.errors);
        return data;
    }
    _check(data, schema, path, errors, root, reference, step, depth) {
        step(depth);
        const add = message => { if (errors.length < this.options.maxErrors) errors.push(`${path.slice(0, 512)}: ${message}`); };
        if (schema === true) return;
        if (schema === false) { add('boolean schema forbids this value'); return; }
        const check = (value, sub, target = errors, childPath = path, document = root) =>
            this._check(value, sub, childPath, target, document, reference, step, depth + 1);
        const matches = sub => { const subErrors = []; check(data, sub, subErrors); return subErrors.length === 0; };
        const legacy = this.options.dialect === 'legacy';
        if (legacy && schema.nullable && data === null) return;
        if (own(schema, '$ref')) { const resolved = reference(schema.$ref, root); check(data, resolved.schema, errors, path, resolved.root); }
        if (schema.allOf) for (const sub of schema.allOf) check(data, sub);
        if (schema.anyOf && !schema.anyOf.some(matches)) add('anyOf did not match');
        if (schema.oneOf && schema.oneOf.filter(matches).length !== 1) add('oneOf must match exactly one schema');
        if (own(schema, 'not') && matches(schema.not)) add('not matched the forbidden schema');
        if (own(schema, 'if')) {
            const branch = matches(schema.if) ? 'then' : 'else';
            if (own(schema, branch)) check(data, schema[branch]);
        }
        if (own(schema, 'const') && !equal(data, schema.const, step)) add('value differs from const');
        if (schema.enum && !schema.enum.some(item => equal(data, item, step))) add('value is not in enum');
        const actual = kind(data);
        if (own(schema, 'type')) {
            const types = Array.isArray(schema.type) ? schema.type : [schema.type];
            if (!types.some(type => type === actual || type === 'integer' && Number.isInteger(data) || legacy && type === 'any')) {
                add(`expected type ${JSON.stringify(schema.type)}, got ${actual}`); return;
            }
        }
        if (actual === 'string') {
            if (schema.minLength !== undefined || schema.maxLength !== undefined) {
                const minimum = schema.minLength ?? 0, maximum = schema.maxLength ?? Infinity;
                if (data.length < minimum) add('string is shorter than minLength');
                else if (Math.ceil(data.length / 2) > maximum) add('string is longer than maxLength');
                else {
                    let length = 0;
                    for (const _character of data) { if ((length++ & 1023) === 0) step(0); if (length > maximum) break; }
                    if (length < minimum) add('string is shorter than minLength');
                    if (length > maximum) add('string is longer than maxLength');
                }
            }
            if (schema.pattern !== undefined && !new RegExp(schema.pattern, legacy ? '' : 'u').test(data)) add('string does not match pattern');
            if (legacy && schema.format) { const error = _checkFormat(data, schema.format, path); if (error) add(error); }
        }
        if (actual === 'number') {
            for (const [key, fails] of [['minimum', data < schema.minimum], ['maximum', data > schema.maximum],
                ['exclusiveMinimum', data <= schema.exclusiveMinimum], ['exclusiveMaximum', data >= schema.exclusiveMaximum]])
                if (schema[key] !== undefined && fails) add(`number violates ${key}`);
            if (schema.multipleOf !== undefined && !isMultiple(data, schema.multipleOf)) add('number is not a multipleOf');
        }
        if (actual === 'array') {
            if (schema.minItems !== undefined && data.length < schema.minItems) add('array is shorter than minItems');
            if (schema.maxItems !== undefined && data.length > schema.maxItems) add('array is longer than maxItems');
            const prefix = schema.prefixItems || (legacy && Array.isArray(schema.items) ? schema.items : []);
            for (let index = 0; index < Math.min(prefix.length, data.length); index++) check(data[index], prefix[index], errors, `${path}[${index}]`);
            const items = legacy && Array.isArray(schema.items) ? schema.additionalItems : schema.items;
            if (items !== undefined) for (let index = prefix.length; index < data.length; index++) check(data[index], items, errors, `${path}[${index}]`);
            if (schema.uniqueItems) {
                outer: for (let index = 0; index < data.length; index++) for (let previous = 0; previous < index; previous++)
                    if (equal(data[index], data[previous], step)) { add('array has duplicate items'); break outer; }
            }
        }
        if (actual === 'object') {
            const keys = Object.keys(data), present = key => own(data, key) && (!legacy || data[key] !== undefined);
            for (const key of schema.required || []) if (!present(key)) add(`missing required property ${key.slice(0, 128)}`);
            if (schema.minProperties !== undefined && keys.length < schema.minProperties) add('object has fewer than minProperties');
            if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) add('object has more than maxProperties');
            const properties = schema.properties || Object.create(null);
            for (const key of keys) {
                if (own(properties, key)) { if (present(key)) check(data[key], properties[key], errors, `${path}.${key}`); }
                else if (schema.additionalProperties === false) add(`additional property "${key.slice(0, 128)}" not allowed`);
                else if (schema.additionalProperties !== undefined) check(data[key], schema.additionalProperties, errors, `${path}.${key}`);
            }
            for (const [key, required] of Object.entries(schema.dependentRequired || {}))
                if (present(key)) for (const dependent of required) if (!present(dependent)) add(`property ${key.slice(0, 128)} requires ${dependent.slice(0, 128)}`);
        }
    }
}

export { JsonSchemaValidator as SchemaValidator };

// ── Schema type builder (DSL sugar) ───────────────────────────────────────────

/**
 * Fluent schema type builders for ergonomic schema authoring.
 *
 * import { t } from './SchemaValidator.js';
 * const schema = t.obj({ name: t.str({ minLength: 1 }), age: t.int({ minimum: 0 }) }, ['name']);
 */
export const t = {
    any:      ()          => ({ type: 'any' }),
    str:      (o={})      => ({ type: 'string',  ...o }),
    num:      (o={})      => ({ type: 'number',  ...o }),
    int:      (o={})      => ({ type: 'integer', ...o }),
    bool:     ()          => ({ type: 'boolean' }),
    nil:      ()          => ({ type: 'null' }),
    arr:      (items,o={})=> ({ type: 'array',  items, ...o }),
    obj:      (props,req=[],o={}) => ({ type: 'object', properties: props, required: req, ...o }),
    strict:   (props,req=[]) => ({ type: 'object', properties: props, required: req, additionalProperties: false }),
    lit:      (v)         => ({ const: v }),
    enm:      (...vs)     => ({ enum: vs }),
    ref:      (name)      => ({ $ref: name }),
    oneOf:    (...ss)     => ({ oneOf: ss }),
    anyOf:    (...ss)     => ({ anyOf: ss }),
    allOf:    (...ss)     => ({ allOf: ss }),
    not:      (s)         => ({ not: s }),
    nullable: (s)         => ({ oneOf: [s, { type: 'null' }] }),
    opt:      (s)         => ({ ...s, optional: true }),
    uuid:     ()          => ({ type: 'string', format: 'uuid' }),
    email:    ()          => ({ type: 'string', format: 'email' }),
    url:      ()          => ({ type: 'string', format: 'uri' }),
    semver:   ()          => ({ type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' }),
    id:       ()          => ({ type: 'string', pattern: '^[a-z][a-z0-9._-]*$' }),
};


const FORMAT_PATTERNS = {
    uuid:  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    uri:   /^https?:\/\/.+/,
    'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    date:  /^\d{4}-\d{2}-\d{2}$/,
};

function _checkFormat(str, format, path) {
    const re = FORMAT_PATTERNS[format];
    if (re && !re.test(str)) return `${path}: string "${str}" is not a valid ${format}`;
    return null;
}
