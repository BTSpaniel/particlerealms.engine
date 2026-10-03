// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SchemaEvolutionRegistry } from '../schema/SchemaEvolutionRegistry.js'

export const SAVE_SCHEMA_VERSION = 1

const DEFAULT_SLOT = 'auto'
const MAX_SLOT_LENGTH = 128

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireVersion(value, label = 'Save schema version') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function requireSlot(value, fallback = DEFAULT_SLOT) {
  const slot = value === undefined || value === null || value === '' ? fallback : value
  if (typeof slot !== 'string' || slot.length > MAX_SLOT_LENGTH || slot.trim() !== slot || slot.length === 0) {
    throw new TypeError(`Save slot must be a non-empty string of at most ${MAX_SLOT_LENGTH} characters`)
  }
  return slot
}

function envelopeValidation(value, expectedVersion) {
  const errors = []
  if (!isRecord(value)) return { valid: false, errors: ['save must be a plain object'] }
  if (value.schemaVersion !== expectedVersion) errors.push(`schemaVersion must be ${expectedVersion}`)
  if (!Number.isFinite(value.timestamp) || value.timestamp < 0) errors.push('timestamp must be a non-negative finite number')
  if (typeof value.slot !== 'string' || value.slot.length === 0 || value.slot.length > MAX_SLOT_LENGTH
    || value.slot.trim() !== value.slot) {
    errors.push(`slot must be a non-empty string of at most ${MAX_SLOT_LENGTH} characters`)
  }
  if (!Number.isSafeInteger(value.frame) || value.frame < 0) errors.push('frame must be a non-negative safe integer')
  if (value.state === null || typeof value.state !== 'object') errors.push('state must be an object or array')
  return { valid: errors.length === 0, errors }
}

function mergeValidation(base, extension) {
  const errors = [...(base.errors || [])]
  if (extension === false) {
    errors.push('custom validator returned false')
  } else if (extension && typeof extension === 'object' && typeof extension.valid === 'boolean') {
    if (!extension.valid) {
      if (Array.isArray(extension.errors) && extension.errors.length) errors.push(...extension.errors.map(String))
      else errors.push('custom validator returned an invalid result')
    }
  } else if (extension !== true) {
    errors.push('custom validator must return a boolean or { valid, errors } result')
  }
  return { valid: errors.length === 0, errors }
}

function versionDefinitions(currentVersion, migrations, configuredVersions) {
  const versions = new Set([currentVersion])
  for (const migration of migrations) {
    versions.add(requireVersion(migration.from, `Migration ${migration.id || '<unnamed>'} source version`))
    versions.add(requireVersion(migration.to, `Migration ${migration.id || '<unnamed>'} target version`))
  }
  if (configuredVersions instanceof Map) {
    for (const version of configuredVersions.keys()) versions.add(requireVersion(Number(version)))
  } else if (isRecord(configuredVersions)) {
    for (const version of Object.keys(configuredVersions)) versions.add(requireVersion(Number(version)))
  } else if (configuredVersions !== undefined) {
    throw new TypeError('SaveSystem versions must be an object or Map')
  }
  return [...versions].sort((left, right) => left - right)
}

function configuredVersion(configuredVersions, version) {
  if (configuredVersions instanceof Map) return configuredVersions.get(version) || configuredVersions.get(String(version))
  return configuredVersions?.[version]
}

function operationError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createLocalStorageAdapter(storage) {
  const target = storage || globalThis.localStorage
  if (!target) throw new Error('SaveSystem requires a storage adapter or localStorage')
  return {
    getItem(key) { return target.getItem(key) },
    setItem(key, value) { target.setItem(key, value) },
    removeItem(key) { target.removeItem(key) }
  }
}

export class SaveSystem {
  constructor(options) {
    const config = options || {}
    if (config.migrate !== undefined) {
      throw new TypeError('SaveSystem migrate is no longer implicit; register ordered migrations with from, to, and apply')
    }

    this._schemaVersion = requireVersion(config.schemaVersion ?? SAVE_SCHEMA_VERSION)
    this._storageKey = config.storageKey || 'engine_save'
    this._storage = config.storage || createLocalStorageAdapter(config.localStorage)
    this._serialize = config.serialize || (() => ({}))
    this._deserialize = config.deserialize || (() => {})
    this._getFrame = config.getFrame || (() => 0)
    this._setFrame = config.setFrame || (() => {})
    this._createRecord = config.createRecord || ((state, metadata) => ({ ...metadata, state }))
    this._logger = config.logger || console
    this._contractId = config.contractId || `${this._storageKey}-save`
    if (config.migrations !== undefined && !Array.isArray(config.migrations)) {
      throw new TypeError('SaveSystem migrations must be an ordered array')
    }
    this._migrations = config.migrations || []
    this._knownVersions = new Set(versionDefinitions(this._schemaVersion, this._migrations, config.versions))
    this._registry = config.evolutionRegistry || new SchemaEvolutionRegistry()

    if (this._registry.hasContract(this._contractId)) {
      throw new Error(`SaveSystem contract ${this._contractId} is already registered`)
    }

    const definitions = {}
    for (const version of this._knownVersions) {
      const configured = configuredVersion(config.versions, version)
      const definition = typeof configured === 'function' ? { validate: configured } : (configured || {})
      if (!isRecord(definition)) throw new TypeError(`Save schema version ${version} definition must be an object or function`)
      if (definition.validate !== undefined && typeof definition.validate !== 'function') {
        throw new TypeError(`Save schema version ${version} validate must be a function`)
      }
      definitions[version] = {
        validate: (value, context) => mergeValidation(
          envelopeValidation(value, version),
          definition.validate ? definition.validate(value, context) : true
        ),
        normalize: definition.normalize
      }
    }

    this._registry.registerContract({
      id: this._contractId,
      writeVersion: this._schemaVersion,
      versions: definitions,
      versionOf: value => value?.schemaVersion,
      stampVersion: (value, version) => ({ ...value, schemaVersion: Number(version) })
    })
    for (const migration of this._migrations) {
      this._registry.registerMigration({
        ...migration,
        contractId: this._contractId
      })
    }
  }

  save(slotName) {
    const startedAt = performance.now()
    let slot
    try {
      slot = requireSlot(slotName)
      this._log('log', 'save.entry', { slot, version: this._schemaVersion })
      const timestamp = Date.now()
      const frame = this._getFrame()
      const state = this._serialize()
      const candidate = this._createRecord(state, {
        schemaVersion: this._schemaVersion,
        timestamp,
        slot,
        frame
      })
      const prepared = this._registry.prepareWrite(this._contractId, candidate)
      const json = JSON.stringify(prepared.value)
      this._commitJson(slot, json, timestamp)
      this._log('log', 'save.exit', {
        slot,
        version: this._schemaVersion,
        bytes: json.length,
        elapsedMs: Math.round(performance.now() - startedAt)
      })
      return { slot, timestamp, size: json.length }
    } catch (error) {
      this._log('error', 'save.error', { slot: slot || null, code: error.code || 'SAVE_FAILED', message: error.message })
      return null
    }
  }

  load(slotName) {
    const startedAt = performance.now()
    let slot
    try {
      slot = requireSlot(slotName)
      this._log('log', 'load.entry', { slot, version: this._schemaVersion })
      const raw = this._storage.getItem(this._primaryKey(slot))
      if (raw === null) {
        this._log('warn', 'load.missing', { slot })
        return false
      }

      const prepared = this._prepareRead(JSON.parse(raw))
      if (prepared.migrationIds.length) {
        this._log('log', 'load.migrated-in-memory', {
          slot,
          fromVersion: Number(prepared.sourceVersion),
          toVersion: Number(prepared.targetVersion),
          steps: prepared.migrationIds.length,
          persisted: false
        })
      }
      this._deserialize(prepared.value.state)
      this._setFrame(prepared.value.frame)
      this._log('log', 'load.exit', {
        slot,
        version: Number(prepared.targetVersion),
        elapsedMs: Math.round(performance.now() - startedAt)
      })
      return true
    } catch (error) {
      this._log('error', 'load.error', { slot: slot || null, code: error.code || 'LOAD_FAILED', message: error.message })
      return false
    }
  }

  hasSave(slotName) {
    try {
      return this._storage.getItem(this._primaryKey(requireSlot(slotName))) !== null
    } catch {
      return false
    }
  }

  deleteSave(slotName) {
    const slot = requireSlot(slotName)
    const key = this._primaryKey(slot)
    this._storage.removeItem(key)
    this._storage.removeItem(`${key}_pending`)
    this._storage.removeItem(`${key}_backup`)
    const slots = this.getSlots().filter(entry => entry.slot !== slot)
    this._storage.setItem(this._indexKey(), JSON.stringify(slots))
    this._log('log', 'delete.state-change', { slot })
  }

  getSlots() {
    try {
      const raw = this._storage.getItem(this._indexKey())
      if (raw === null) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(entry => isRecord(entry)
        && typeof entry.slot === 'string'
        && Number.isFinite(entry.timestamp))
    } catch {
      return []
    }
  }

  exportSave(slotName) {
    return this._storage.getItem(this._primaryKey(requireSlot(slotName)))
  }

  exportBackup(slotName) {
    return this._storage.getItem(`${this._primaryKey(requireSlot(slotName))}_backup`)
  }

  importSave(json, slotName) {
    const startedAt = performance.now()
    let slot
    try {
      slot = requireSlot(slotName, 'import')
      this._log('log', 'import.entry', { slot })
      if (typeof json !== 'string') throw new TypeError('Imported save must be JSON text')
      const prepared = this._prepareRead(JSON.parse(json))
      const candidate = { ...prepared.value, slot }
      const writable = this._registry.prepareWrite(this._contractId, candidate)
      const encoded = JSON.stringify(writable.value)
      this._commitJson(slot, encoded, writable.value.timestamp)
      this._log('log', 'import.exit', {
        slot,
        fromVersion: Number(prepared.sourceVersion),
        toVersion: this._schemaVersion,
        migrationSteps: prepared.migrationIds.length,
        bytes: encoded.length,
        elapsedMs: Math.round(performance.now() - startedAt)
      })
      return true
    } catch (error) {
      this._log('error', 'import.error', { slot: slot || null, code: error.code || 'IMPORT_FAILED', message: error.message })
      return false
    }
  }

  getEvolutionRegistry() {
    return this._registry
  }

  _prepareRead(value) {
    const version = value?.schemaVersion
    if (!Number.isSafeInteger(version) || version < 1) {
      throw operationError('UNKNOWN_SCHEMA_VERSION', 'Save has a missing or invalid schema version')
    }
    if (version > this._schemaVersion) {
      throw operationError('FUTURE_SCHEMA_VERSION', `Save schema version ${version} is newer than supported version ${this._schemaVersion}`)
    }
    if (!this._knownVersions.has(version)) {
      throw operationError('UNKNOWN_SCHEMA_VERSION', `Save schema version ${version} is not supported`)
    }
    return this._registry.prepareRead(this._contractId, value)
  }

  _commitJson(slot, json, timestamp) {
    const key = this._primaryKey(slot)
    const pendingKey = `${key}_pending`
    const backupKey = `${key}_backup`
    const previous = this._storage.getItem(key)

    try {
      this._storage.setItem(pendingKey, json)
      if (this._storage.getItem(pendingKey) !== json) throw operationError('PENDING_WRITE_MISMATCH', 'Pending save verification failed')
      this._log('log', 'commit.state-change', { slot, state: 'pending-verified' })

      if (previous !== null) {
        this._storage.setItem(backupKey, previous)
        if (this._storage.getItem(backupKey) !== previous) throw operationError('BACKUP_WRITE_MISMATCH', 'Save backup verification failed')
        this._log('log', 'commit.state-change', { slot, state: 'backup-verified' })
      }

      this._storage.setItem(key, json)
      if (this._storage.getItem(key) !== json) throw operationError('PRIMARY_WRITE_MISMATCH', 'Primary save verification failed')
      this._updateSlotIndex(slot, timestamp)
      try {
        this._storage.removeItem(pendingKey)
      } catch (cleanupError) {
        this._log('warn', 'commit.cleanup-warning', { slot, message: cleanupError.message })
      }
      this._log('log', 'commit.state-change', { slot, state: 'committed' })
    } catch (error) {
      try {
        if (previous === null) this._storage.removeItem(key)
        else this._storage.setItem(key, previous)
      } catch (restoreError) {
        this._log('error', 'commit.restore-error', { slot, message: restoreError.message })
      }
      throw error
    }
  }

  _updateSlotIndex(slot, timestamp) {
    const slots = this.getSlots()
    const existing = slots.find(entry => entry.slot === slot)
    if (existing) existing.timestamp = timestamp
    else slots.push({ slot, timestamp })
    this._storage.setItem(this._indexKey(), JSON.stringify(slots))
  }

  _primaryKey(slot) {
    return `${this._storageKey}_${slot}`
  }

  _indexKey() {
    return `${this._storageKey}_index`
  }

  _log(level, event, details) {
    const method = typeof this._logger?.[level] === 'function' ? this._logger[level].bind(this._logger) : null
    if (method) method(`[SaveSystem] ${event}`, details)
  }
}

export default SaveSystem
