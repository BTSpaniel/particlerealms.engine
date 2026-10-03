// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { checksumHex32, fnv1aStringCodeUnit32 } from '../math/ChecksumMath.js'

export const SCHEMA_MIGRATION_PLAN_FORMAT = 'engine-schema-migration-plan/v1'

const CONTRACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const MIGRATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/

function fail(code, message, details = {}) {
  throw new SchemaEvolutionError(code, message, details)
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireIdentifier(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function versionKey(value, label = 'Schema version') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer or version string`)
    return String(value)
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty version string or non-negative safe integer`)
  }
  return value
}

function canonicalize(value, path = '$', ancestors = new Set()) {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== 'object') throw new TypeError(`${path} is not JSON-compatible`)
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`)

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, ancestors)).join(',')}]`
    }
    if (!isRecord(value)) throw new TypeError(`${path} must be a plain object`)

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(descriptors).sort()
    const fields = []
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (!descriptor.enumerable) continue
      if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${path}.${key} must not be an accessor`)
      if (descriptor.value === undefined) throw new TypeError(`${path}.${key} must not be undefined`)
      fields.push(`${JSON.stringify(key)}:${canonicalize(descriptor.value, `${path}.${key}`, ancestors)}`)
    }
    return `{${fields.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalSchemaValue(value) {
  return canonicalize(value)
}

export function cloneSchemaValue(value) {
  return JSON.parse(canonicalSchemaValue(value))
}

export function fingerprintSchemaValue(value) {
  const canonical = canonicalSchemaValue(value)
  return `fnv1a32:32:${checksumHex32(fnv1aStringCodeUnit32(canonical))}`
}

function syncResult(value, label) {
  if (value && typeof value.then === 'function') {
    throw new TypeError(`${label} must be synchronous and side-effect-free`)
  }
  return value
}

function validationErrors(result) {
  if (result === true) return []
  if (result === false) return ['validator returned false']
  if (result && typeof result === 'object' && typeof result.valid === 'boolean') {
    if (result.valid) return []
    return Array.isArray(result.errors) && result.errors.length
        ? result.errors.map(error => String(error))
        : ['validator returned an invalid result']
  }
  return ['validator must return a boolean or { valid, errors } result']
}

function versionEntries(versions) {
  if (versions instanceof Map) return [...versions.entries()]
  if (isRecord(versions)) return Object.entries(versions)
  throw new TypeError('Schema contract versions must be an object or Map')
}

function freezePlan(contractId, sourceVersion, targetVersion, sourceFingerprint, steps) {
  return Object.freeze({
    format: SCHEMA_MIGRATION_PLAN_FORMAT,
    contractId,
    sourceVersion,
    targetVersion,
    sourceFingerprint,
    steps: Object.freeze(steps.map(step => Object.freeze({
      id: step.id,
      from: step.from,
      to: step.to
    })))
  })
}

export class SchemaEvolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'SchemaEvolutionError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

/**
 * Pure registry for explicit schema readers, writers, and migration graphs.
 * It transforms decoded values only and never reads or writes persistence.
 */
export class SchemaEvolutionRegistry {
  constructor() {
    this._contracts = new Map()
    this._migrations = new Map()
    this._edges = new Map()
  }

  registerContract(definition) {
    if (!isRecord(definition)) throw new TypeError('Schema contract must be an object')
    const id = requireIdentifier(definition.id, CONTRACT_ID, 'Schema contract id')
    if (this._contracts.has(id)) throw new Error(`Schema contract ${id} is already registered`)

    const writeVersion = versionKey(definition.writeVersion, 'Write version')
    const versions = new Map()
    for (const [rawVersion, rawDefinition] of versionEntries(definition.versions)) {
      const version = versionKey(rawVersion)
      const versionDefinition = typeof rawDefinition === 'function'
        ? { validate: rawDefinition }
        : rawDefinition
      if (!isRecord(versionDefinition) || typeof versionDefinition.validate !== 'function') {
        throw new TypeError(`Schema contract ${id} version ${version} requires validate()`)
      }
      if (versionDefinition.normalize !== undefined && typeof versionDefinition.normalize !== 'function') {
        throw new TypeError(`Schema contract ${id} version ${version} normalize must be a function`)
      }
      versions.set(version, Object.freeze({
        validate: versionDefinition.validate,
        normalize: versionDefinition.normalize || (value => value)
      }))
    }
    if (!versions.has(writeVersion)) throw new Error(`Schema contract ${id} has no writer schema for ${writeVersion}`)

    const contract = Object.freeze({
      id,
      writeVersion,
      versions,
      versionOf: definition.versionOf || (value => value?.schemaVersion),
      stampVersion: definition.stampVersion || ((value, version) => ({ ...value, schemaVersion: version })),
      clone: definition.clone || cloneSchemaValue,
      fingerprint: definition.fingerprint || fingerprintSchemaValue
    })
    for (const method of ['versionOf', 'stampVersion', 'clone', 'fingerprint']) {
      if (typeof contract[method] !== 'function') throw new TypeError(`Schema contract ${id} ${method} must be a function`)
    }

    this._contracts.set(id, contract)
    this._migrations.set(id, new Map())
    this._edges.set(id, new Map())
    return id
  }

  registerMigration(definition) {
    if (!isRecord(definition)) throw new TypeError('Schema migration must be an object')
    const id = requireIdentifier(definition.id, MIGRATION_ID, 'Schema migration id')
    const contractId = requireIdentifier(definition.contractId, CONTRACT_ID, 'Schema migration contract id')
    const contract = this._requireContract(contractId)
    const from = versionKey(definition.from, 'Migration source version')
    const to = versionKey(definition.to, 'Migration target version')
    if (from === to) throw new Error(`Schema migration ${id} must change version`)
    if (!contract.versions.has(from) || !contract.versions.has(to)) {
      throw new Error(`Schema migration ${id} references an unregistered version`)
    }
    if (typeof definition.apply !== 'function') throw new TypeError(`Schema migration ${id} requires apply()`)
    if (definition.preview !== undefined && typeof definition.preview !== 'function') {
      throw new TypeError(`Schema migration ${id} preview must be a function`)
    }

    const migrations = this._migrations.get(contractId)
    if (migrations.has(id)) throw new Error(`Schema migration ${id} is already registered for ${contractId}`)
    const edges = this._edges.get(contractId)
    const outgoing = edges.get(from) || []
    if (outgoing.some(migration => migration.to === to)) {
      throw new Error(`Schema migration edge ${from} -> ${to} is already registered for ${contractId}`)
    }
    if (this._canReach(contractId, to, from)) {
      throw new Error(`Schema migration ${id} would create a cycle in ${contractId}`)
    }

    const migration = Object.freeze({
      id,
      contractId,
      from,
      to,
      apply: definition.apply,
      preview: definition.preview || null
    })
    migrations.set(id, migration)
    edges.set(from, Object.freeze([...outgoing, migration].sort((left, right) => left.id.localeCompare(right.id))))
    return id
  }

  hasContract(contractId) {
    return this._contracts.has(contractId)
  }

  readableVersions(contractId) {
    return Object.freeze([...this._requireContract(contractId).versions.keys()].sort())
  }

  writeVersion(contractId) {
    return this._requireContract(contractId).writeVersion
  }

  inspect(contractId, value) {
    const contract = this._requireContract(contractId)
    const version = this._versionOf(contract, value)
    this._validate(contract, version, value, 'inspect')
    return Object.freeze({
      contractId,
      version,
      readable: true,
      writable: version === contract.writeVersion,
      migrationAvailable: version === contract.writeVersion || this._hasPath(contractId, version, contract.writeVersion),
      fingerprint: contract.fingerprint(value)
    })
  }

  plan(contractId, value, targetVersion = undefined) {
    const contract = this._requireContract(contractId)
    const sourceVersion = this._versionOf(contract, value)
    const target = targetVersion === undefined
      ? contract.writeVersion
      : versionKey(targetVersion, 'Migration target version')
    if (!contract.versions.has(target)) {
      fail('UNKNOWN_TARGET_VERSION', `Schema contract ${contractId} does not support target version ${target}`, {
        contractId,
        targetVersion: target
      })
    }
    this._validate(contract, sourceVersion, value, 'plan-source')
    const sourceFingerprint = contract.fingerprint(value)
    if (sourceVersion === target) return freezePlan(contractId, sourceVersion, target, sourceFingerprint, [])

    const queue = [{ version: sourceVersion, steps: [] }]
    const bestDepth = new Map([[sourceVersion, 0]])
    const candidates = []
    let targetDepth = Infinity
    while (queue.length) {
      const current = queue.shift()
      if (current.steps.length >= targetDepth) continue
      const outgoing = this._edges.get(contractId).get(current.version) || []
      for (const migration of outgoing) {
        const steps = [...current.steps, migration]
        if (migration.to === target) {
          targetDepth = steps.length
          candidates.push(steps)
          continue
        }
        const knownDepth = bestDepth.get(migration.to)
        if (knownDepth === undefined || steps.length <= knownDepth) {
          bestDepth.set(migration.to, steps.length)
          queue.push({ version: migration.to, steps })
        }
      }
    }

    const shortest = candidates.filter(candidate => candidate.length === targetDepth)
    if (shortest.length === 0) {
      fail('NO_MIGRATION_PATH', `No migration path for ${contractId} from ${sourceVersion} to ${target}`, {
        contractId,
        sourceVersion,
        targetVersion: target
      })
    }
    if (shortest.length > 1) {
      fail('AMBIGUOUS_MIGRATION_PATH', `Multiple migration paths exist for ${contractId} from ${sourceVersion} to ${target}`, {
        contractId,
        sourceVersion,
        targetVersion: target
      })
    }
    return freezePlan(contractId, sourceVersion, target, sourceFingerprint, shortest[0])
  }

  apply(contractId, value, plan, context = {}) {
    const contract = this._requireContract(contractId)
    this._assertPlan(contractId, plan)
    const sourceVersion = this._versionOf(contract, value)
    if (sourceVersion !== plan.sourceVersion) {
      fail('STALE_MIGRATION_PLAN', `Migration plan expected ${plan.sourceVersion}, received ${sourceVersion}`, {
        contractId,
        expectedVersion: plan.sourceVersion,
        actualVersion: sourceVersion
      })
    }
    const sourceFingerprint = contract.fingerprint(value)
    if (sourceFingerprint !== plan.sourceFingerprint) {
      fail('STALE_MIGRATION_PLAN', 'Migration source changed after planning', { contractId })
    }

    let working = this._normalize(contract, sourceVersion, value, 'apply-source')
    this._validate(contract, sourceVersion, working, 'apply-source')
    const applied = []
    for (const planned of plan.steps) {
      const migration = this._migrations.get(contractId).get(planned.id)
      if (!migration || migration.from !== planned.from || migration.to !== planned.to) {
        fail('MIGRATION_CHANGED', `Migration ${planned.id} no longer matches its plan`, { contractId, migrationId: planned.id })
      }
      const currentVersion = this._versionOf(contract, working)
      if (currentVersion !== migration.from) {
        fail('MIGRATION_SOURCE_MISMATCH', `Migration ${migration.id} expected ${migration.from}, received ${currentVersion}`, {
          contractId,
          migrationId: migration.id
        })
      }

      const migrationInput = contract.clone(working)
      const inputFingerprint = contract.fingerprint(migrationInput)
      const migrationContext = Object.freeze({
        ...context,
        contractId,
        migrationId: migration.id,
        from: migration.from,
        to: migration.to
      })
      const output = syncResult(migration.apply(migrationInput, migrationContext), `Schema migration ${migration.id}`)
      if (contract.fingerprint(migrationInput) !== inputFingerprint) {
        fail('IMPURE_MIGRATION', `Schema migration ${migration.id} mutated its input`, { contractId, migrationId: migration.id })
      }
      if (output === undefined) {
        fail('INVALID_MIGRATION_OUTPUT', `Schema migration ${migration.id} returned undefined`, { contractId, migrationId: migration.id })
      }
      const outputVersion = this._versionOf(contract, output)
      if (outputVersion !== migration.to) {
        fail('INVALID_MIGRATION_OUTPUT', `Schema migration ${migration.id} did not produce version ${migration.to}`, {
          contractId,
          migrationId: migration.id,
          actualVersion: outputVersion
        })
      }
      working = this._normalize(contract, migration.to, output, `migration-${migration.id}`)
      this._validate(contract, migration.to, working, `migration-${migration.id}`)
      applied.push(migration.id)
    }

    const finalVersion = this._versionOf(contract, working)
    if (finalVersion !== plan.targetVersion) {
      fail('MIGRATION_TARGET_MISMATCH', `Migration plan stopped at ${finalVersion}, expected ${plan.targetVersion}`, { contractId })
    }
    const targetFingerprint = contract.fingerprint(working)
    return Object.freeze({
      value: working,
      sourceVersion,
      targetVersion: finalVersion,
      sourceFingerprint,
      targetFingerprint,
      migrationIds: Object.freeze(applied),
      needsRewrite: sourceVersion !== finalVersion || sourceFingerprint !== targetFingerprint
    })
  }

  prepareRead(contractId, value, { targetVersion } = {}) {
    const plan = this.plan(contractId, value, targetVersion)
    return this.apply(contractId, value, plan)
  }

  prepareWrite(contractId, value) {
    const contract = this._requireContract(contractId)
    const rawVersion = syncResult(contract.versionOf(value), `Schema contract ${contractId} versionOf`)
    if (rawVersion === undefined || rawVersion === null) {
      fail('MISSING_SCHEMA_VERSION', `Refusing to label an unversioned ${contractId} value as ${contract.writeVersion}`, {
        contractId,
        targetVersion: contract.writeVersion
      })
    }
    const existingVersion = versionKey(rawVersion)
    if (existingVersion !== contract.writeVersion) {
      fail('WRITE_VERSION_MISMATCH', `Refusing to relabel ${contractId} ${existingVersion} as ${contract.writeVersion}; migrate it first`, {
        contractId,
        sourceVersion: existingVersion,
        targetVersion: contract.writeVersion
      })
    }

    const input = contract.clone(value)
    const inputFingerprint = contract.fingerprint(input)
    const stamped = syncResult(contract.stampVersion(input, contract.writeVersion), `Schema contract ${contractId} stampVersion`)
    if (contract.fingerprint(input) !== inputFingerprint) {
      fail('IMPURE_VERSION_STAMP', `Schema contract ${contractId} stampVersion mutated its input`, { contractId })
    }
    const stampedVersion = this._versionOf(contract, stamped)
    if (stampedVersion !== contract.writeVersion) {
      fail('INVALID_VERSION_STAMP', `Schema contract ${contractId} did not stamp ${contract.writeVersion}`, { contractId })
    }
    const normalized = this._normalize(contract, contract.writeVersion, stamped, 'prepare-write')
    this._validate(contract, contract.writeVersion, normalized, 'prepare-write')
    return Object.freeze({
      value: normalized,
      version: contract.writeVersion,
      fingerprint: contract.fingerprint(normalized)
    })
  }

  _requireContract(contractId) {
    const contract = this._contracts.get(contractId)
    if (!contract) fail('UNKNOWN_CONTRACT', `Unknown schema contract: ${contractId}`, { contractId })
    return contract
  }

  _versionOf(contract, value) {
    const rawVersion = syncResult(contract.versionOf(value), `Schema contract ${contract.id} versionOf`)
    if (rawVersion === undefined || rawVersion === null) {
      fail('MISSING_SCHEMA_VERSION', `Schema contract ${contract.id} value has no version`, { contractId: contract.id })
    }
    const version = versionKey(rawVersion)
    if (!contract.versions.has(version)) {
      const registeredNumbers = [...contract.versions.keys()]
        .filter(candidate => /^(0|[1-9]\d*)$/.test(candidate))
        .map(Number)
      const rawNumber = typeof rawVersion === 'number' || /^(0|[1-9]\d*)$/.test(version)
        ? Number(rawVersion)
        : NaN
      const isFuture = Number.isSafeInteger(rawNumber)
        && registeredNumbers.length === contract.versions.size
        && rawNumber > Math.max(...registeredNumbers)
      const code = isFuture ? 'FUTURE_SCHEMA_VERSION' : 'UNKNOWN_SCHEMA_VERSION'
      fail(code, `Schema contract ${contract.id} does not support version ${version}`, {
        contractId: contract.id,
        version
      })
    }
    return version
  }

  _normalize(contract, version, value, phase) {
    const definition = contract.versions.get(version)
    const input = contract.clone(value)
    const inputFingerprint = contract.fingerprint(input)
    const normalized = syncResult(definition.normalize(input, Object.freeze({
      contractId: contract.id,
      version,
      phase
    })), `Schema contract ${contract.id} ${version} normalize`)
    if (contract.fingerprint(input) !== inputFingerprint) {
      fail('IMPURE_NORMALIZER', `Schema contract ${contract.id} ${version} normalizer mutated its input`, {
        contractId: contract.id,
        version,
        phase
      })
    }
    if (normalized === undefined) {
      fail('INVALID_NORMALIZED_VALUE', `Schema contract ${contract.id} ${version} normalizer returned undefined`, {
        contractId: contract.id,
        version,
        phase
      })
    }
    const normalizedVersion = this._versionOf(contract, normalized)
    if (normalizedVersion !== version) {
      fail('NORMALIZER_CHANGED_VERSION', `Schema contract ${contract.id} normalizer changed ${version} to ${normalizedVersion}`, {
        contractId: contract.id,
        version,
        phase
      })
    }
    return contract.clone(normalized)
  }

  _validate(contract, version, value, phase) {
    const definition = contract.versions.get(version)
    const result = syncResult(definition.validate(contract.clone(value), Object.freeze({
      contractId: contract.id,
      version,
      phase
    })), `Schema contract ${contract.id} ${version} validate`)
    const errors = validationErrors(result)
    if (errors.length) {
      fail('SCHEMA_VALIDATION_FAILED', `Schema contract ${contract.id} ${version} failed validation during ${phase}: ${errors.join('; ')}`, {
        contractId: contract.id,
        version,
        phase,
        errors: Object.freeze(errors)
      })
    }
  }

  _assertPlan(contractId, plan) {
    if (!isRecord(plan) || plan.format !== SCHEMA_MIGRATION_PLAN_FORMAT || plan.contractId !== contractId
      || !Array.isArray(plan.steps) || typeof plan.sourceFingerprint !== 'string') {
      fail('INVALID_MIGRATION_PLAN', `Invalid migration plan for ${contractId}`, { contractId })
    }
    versionKey(plan.sourceVersion, 'Plan source version')
    versionKey(plan.targetVersion, 'Plan target version')
  }

  _canReach(contractId, from, target) {
    if (from === target) return true
    const visited = new Set([from])
    const queue = [from]
    while (queue.length) {
      const current = queue.shift()
      for (const migration of this._edges.get(contractId).get(current) || []) {
        if (migration.to === target) return true
        if (!visited.has(migration.to)) {
          visited.add(migration.to)
          queue.push(migration.to)
        }
      }
    }
    return false
  }

  _hasPath(contractId, from, target) {
    return this._canReach(contractId, from, target)
  }
}

export function createSchemaEvolutionRegistry() {
  return new SchemaEvolutionRegistry()
}

export default SchemaEvolutionRegistry
