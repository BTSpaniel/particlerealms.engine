// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SchemaValidator — Validates game data against JSON schemas.
 *
 * Lightweight validator (no external deps). Checks required fields,
 * types, enums, min/max, and array items. Reports all errors.
 */

export class SchemaValidator {
  constructor() {
    /** @type {Map<string, object>} Registered schemas */
    this._schemas = new Map()
  }

  /**
   * Register a schema.
   * @param {string} name
   * @param {object} schema
   */
  register(name, schema) {
    this._schemas.set(name, schema)
  }

  /**
   * Validate data against a named schema.
   *
   * @param {string} schemaName
   * @param {object} data
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(schemaName, data) {
    const schema = this._schemas.get(schemaName)
    if (!schema) return { valid: false, errors: [`Unknown schema: ${schemaName}`] }

    const errors = []
    this._validateObject(data, schema, '', errors)
    return { valid: errors.length === 0, errors }
  }

  /**
   * Validate and return a cleaned copy with defaults applied.
   *
   * @param {string} schemaName
   * @param {object} data
   * @returns {{ valid: boolean, errors: string[], data: object }}
   */
  validateAndClean(schemaName, data) {
    const result = this.validate(schemaName, data)
    if (!result.valid) return { ...result, data }

    const schema = this._schemas.get(schemaName)
    const cleaned = this._applyDefaults(data, schema)
    return { valid: true, errors: [], data: cleaned }
  }

  // ── Internal ──

  _validateObject(data, schema, path, errors) {
    if (data === null || data === undefined) {
      errors.push(`${path || 'root'}: missing`)
      return
    }

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (data[field] === undefined || data[field] === null) {
          errors.push(`${path}.${field}: required field missing`)
        }
      }
    }

    // Check properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (data[key] === undefined) continue
        this._validateProperty(data[key], propSchema, `${path}.${key}`, errors)
      }
    }
  }

  _validateProperty(value, schema, path, errors) {
    if (value === null || value === undefined) {
      if (schema.type && Array.isArray(schema.type) && schema.type.includes('null')) return
      return
    }

    // Type check
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type]
      const actualType = Array.isArray(value) ? 'array' : typeof value
      if (!types.includes(actualType) && !types.includes('null')) {
        errors.push(`${path}: expected ${types.join('|')}, got ${actualType}`)
        return
      }
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path}: value "${value}" not in enum [${schema.enum.join(', ')}]`)
    }

    // Min/Max
    if (typeof value === 'number') {
      if (schema.min !== undefined && value < schema.min) errors.push(`${path}: ${value} < min ${schema.min}`)
      if (schema.max !== undefined && value > schema.max) errors.push(`${path}: ${value} > max ${schema.max}`)
    }

    // String maxLength
    if (typeof value === 'string' && schema.maxLength && value.length > schema.maxLength) {
      errors.push(`${path}: string length ${value.length} > maxLength ${schema.maxLength}`)
    }

    // Array items
    if (Array.isArray(value) && schema.items) {
      if (schema.maxItems && value.length > schema.maxItems) {
        errors.push(`${path}: array length ${value.length} > maxItems ${schema.maxItems}`)
      }
      for (let i = 0; i < value.length; i++) {
        this._validateProperty(value[i], schema.items, `${path}[${i}]`, errors)
      }
    }

    // Nested object
    if (typeof value === 'object' && !Array.isArray(value) && schema.properties) {
      this._validateObject(value, schema, path, errors)
    }
  }

  _applyDefaults(data, schema) {
    if (!schema.properties) return data
    const result = { ...data }
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (result[key] === undefined && propSchema.default !== undefined) {
        result[key] = propSchema.default
      }
      if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) && propSchema.properties) {
        result[key] = this._applyDefaults(result[key], propSchema)
      }
    }
    return result
  }

  /** Get all registered schema names */
  getSchemas() { return [...this._schemas.keys()] }
}

export default SchemaValidator
