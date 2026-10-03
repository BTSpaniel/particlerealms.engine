// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/routes/MasterServerList.js — client-shipped master server list +
// connection fallback ordering (network plan §4).
//
// A master server is a meeting place, not an authority: it introduces peers
// and forwards signaling, nothing more (network plan §4/§6). This module only
// normalizes/validates the list shape and computes connection attempt order;
// it does not open any sockets (that is the signaling tier, Phase 2b/Phase A).

/** Fallback stages other than master servers themselves, in priority order (§4). */
export const FALLBACK_STAGES = Object.freeze([
  'cachedPeers',   // 1. Cached trusted peers
  'lan',           // 2. LAN discovery
  'groupGossip',   // 3. Group peer tickets / gossip
  // master servers are inserted here, sorted by priority (§4 steps 4-5)
  'carrier',       // 6. Public carrier routes
  'dht',           // 7. Future Particle DHT
  'relay',         // 8. Optional relay fallback
]);

const DEFAULT_FALLBACKS = Object.freeze({
  cachedPeers: true,
  lanDiscovery: true,
  groupGossip: true,
  publicCarrier: true,
  particleDht: false,
});

export const PARTICLE_MASTER_SERVERS_KEY = 'os.network.masterServers';
export const PARTICLE_MASTER_SERVER_LIST_FORMAT = 'particle-master-server-list-v2';
export const PARTICLE_MASTER_SERVER_LIST_VERSION = 2;
export const PARTICLE_PRODUCTION_V2_URL = 'wss://discovery.particlerealms.online/v2/ws';
export const PARTICLE_PRODUCTION_V1_URL = 'wss://discovery.particlerealms.online/v1/ws';
export const PARTICLE_PRODUCTION_SERVER_KEY_PIN = '372df935c1927357ccec265c5ad1bcdf25ba054112a25db798a7f6bf8711178b';

const PARTICLE_PRODUCTION_SERVER = Object.freeze({
  url: PARTICLE_PRODUCTION_V2_URL,
  priority: 1,
  role: 'default_bootstrap',
  trust: 'pinned_particle_v2',
  enabled: true,
  serverKeyPin: PARTICLE_PRODUCTION_SERVER_KEY_PIN,
  serverKeyPins: Object.freeze([PARTICLE_PRODUCTION_SERVER_KEY_PIN]),
  networkRootId: 'particle-network-root-v1',
  networkRootVersion: 1,
  networkRootRollbackVersion: 0,
  allowLegacyV1: false,
});

const PARTICLE_PRODUCTION_LEGACY_SERVER = Object.freeze({
  url: PARTICLE_PRODUCTION_V1_URL,
  priority: 2,
  role: 'legacy_availability_fallback',
  trust: 'explicit_particle_v1',
  enabled: true,
  serverKeyPin: null,
  serverKeyPins: Object.freeze([]),
  networkRootId: null,
  networkRootVersion: null,
  networkRootRollbackVersion: null,
  allowLegacyV1: true,
});

function cloneProductionServer(overrides = {}) {
  return {
    ...PARTICLE_PRODUCTION_SERVER,
    serverKeyPins: [...PARTICLE_PRODUCTION_SERVER.serverKeyPins],
    ...overrides,
  };
}

/** A fresh, mutable copy of the client-shipped production bootstrap list. */
export function defaultParticleMasterServers() {
  return [
    cloneProductionServer(),
    { ...PARTICLE_PRODUCTION_LEGACY_SERVER, serverKeyPins: [] },
  ];
}

function migrateOfficialLegacyDefault(server) {
  if (server?.url !== PARTICLE_PRODUCTION_V1_URL) return server;
  const explicitlyLegacy = (server.allowLegacyV1 ?? server.allow_legacy_v1) === true;
  const alreadyPinned = !!(server.serverKeyPin ?? server.server_key_pin)
    || (server.serverKeyPins ?? server.server_key_pins)?.length > 0;
  if (explicitlyLegacy || alreadyPinned) return server;
  return cloneProductionServer({
    priority: Number.isFinite(server.priority) ? server.priority : 1,
    enabled: server.enabled !== false,
  });
}

/**
 * Read the shared browser master-server list and migrate only the historical,
 * unpinned official V1 default. Explicit legacy/custom entries are preserved.
 */
function masterServerStorageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedServerList(value, { legacy = false } = {}) {
  if (!Array.isArray(value)) throw masterServerStorageError('MASTER_SERVER_LIST_CORRUPT', 'master-server list must be an array');
  if (legacy && value.length === 0) return defaultParticleMasterServers();
  return value.slice(0, 128)
    .filter((server) => server && typeof server === 'object'
      && typeof server.url === 'string' && server.url.length > 0 && server.url.length <= 2048)
    .map(migrateOfficialLegacyDefault);
}

/** Strict read used by writers to quarantine unsupported/corrupt records. */
export function readParticleMasterServerRecord(storage = globalThis.localStorage) {
  if (!storage?.getItem) return { found: false, legacy: false, servers: defaultParticleMasterServers() };
  const raw = storage.getItem(PARTICLE_MASTER_SERVERS_KEY);
  if (raw === null) return { found: false, legacy: false, servers: defaultParticleMasterServers() };
  if (raw.length > 1024 * 1024) throw masterServerStorageError('MASTER_SERVER_LIST_CORRUPT', 'master-server record is too large');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw masterServerStorageError('MASTER_SERVER_LIST_CORRUPT', 'master-server record is not valid JSON'); }
  if (Array.isArray(parsed)) return { found: true, legacy: true, servers: boundedServerList(parsed, { legacy: true }) };
  if (!parsed || typeof parsed !== 'object') {
    throw masterServerStorageError('MASTER_SERVER_LIST_CORRUPT', 'master-server record must be an object or legacy array');
  }
  if (!Number.isSafeInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
    throw masterServerStorageError('MASTER_SERVER_LIST_CORRUPT', 'master-server schemaVersion is invalid');
  }
  if (parsed.schemaVersion > PARTICLE_MASTER_SERVER_LIST_VERSION) {
    throw masterServerStorageError('MASTER_SERVER_LIST_VERSION_UNSUPPORTED', `master-server schema version ${parsed.schemaVersion} is newer than supported version ${PARTICLE_MASTER_SERVER_LIST_VERSION}`);
  }
  if (parsed.schemaVersion !== PARTICLE_MASTER_SERVER_LIST_VERSION || parsed.format !== PARTICLE_MASTER_SERVER_LIST_FORMAT) {
    throw masterServerStorageError('MASTER_SERVER_LIST_CORRUPT', 'master-server format/version pairing is unsupported');
  }
  return { found: true, legacy: false, servers: boundedServerList(parsed.servers) };
}

export function loadParticleMasterServers(storage = globalThis.localStorage) {
  try { return readParticleMasterServerRecord(storage).servers; }
  catch (error) {
    console.warn('[MasterServerList] persisted configuration quarantined:', error.message);
    return defaultParticleMasterServers();
  }
}

export function saveParticleMasterServers(list, storage = globalThis.localStorage) {
  if (!storage?.setItem || !Array.isArray(list)) return false;
  try {
    // Preflight happens before serialization or mutation. A future/corrupt
    // generation remains byte-for-byte intact.
    readParticleMasterServerRecord(storage);
    const envelope = {
      format: PARTICLE_MASTER_SERVER_LIST_FORMAT,
      schemaVersion: PARTICLE_MASTER_SERVER_LIST_VERSION,
      servers: boundedServerList(list),
    };
    const encoded = JSON.stringify(envelope);
    storage.setItem(PARTICLE_MASTER_SERVERS_KEY, encoded);
    if (storage.getItem?.(PARTICLE_MASTER_SERVERS_KEY) !== encoded) return false;
    return true;
  } catch (error) {
    console.warn('[MasterServerList] configuration was not persisted:', error.message);
    return false;
  }
}

/**
 * Validate + normalize a client master-server-list config (network plan §4).
 * Unknown/malformed servers are dropped rather than throwing, so a bad entry
 * in a self-hosted community list can't break the whole client.
 * @param {object} config
 * @param {Array} [config.master_servers]
 * @param {object} [config.fallbacks]
 * @returns {{ masterServers: object[], fallbacks: object }}
 */
export function normalizeMasterServerList(config = {}) {
  const raw = Array.isArray(config.master_servers) ? config.master_servers : [];
  const masterServers = raw
    .filter((s) => s && typeof s.url === 'string' && s.url.length > 0)
    .map((s) => ({
      url: s.url,
      priority: Number.isFinite(s.priority) ? s.priority : 999,
      role: s.role ?? 'bootstrap',
      trust: s.trust ?? 'introducer_only',
      enabled: s.enabled !== false,
      serverKeyPin: s.server_key_pin ?? s.serverKeyPin ?? null,
      serverKeyPins: Array.isArray(s.server_key_pins ?? s.serverKeyPins)
        ? [...(s.server_key_pins ?? s.serverKeyPins)]
        : [],
      networkRootId: s.network_root_id ?? s.networkRootId ?? null,
      networkRootVersion: s.network_root_version ?? s.networkRootVersion ?? null,
      networkRootRollbackVersion: s.network_root_rollback_version ?? s.networkRootRollbackVersion ?? null,
      allowLegacyV1: (s.allow_legacy_v1 ?? s.allowLegacyV1) === true,
    }))
    .sort((a, b) => a.priority - b.priority);

  const fallbacks = { ...DEFAULT_FALLBACKS, ...(config.fallbacks ?? {}) };
  return Object.freeze({ masterServers: Object.freeze(masterServers), fallbacks: Object.freeze(fallbacks) });
}

/**
 * Pick the next enabled master server to try, in priority order, skipping
 * any whose url is in `excluded` (e.g. servers that just failed this round).
 * @param {object[]} masterServers  from normalizeMasterServerList().masterServers
 * @param {object} [opts]
 * @param {string[]} [opts.excluded]
 * @returns {object|null}
 */
export function pickNextMasterServer(masterServers, { excluded = [] } = {}) {
  const excludeSet = new Set(excluded);
  for (const server of masterServers) {
    if (server.enabled && !excludeSet.has(server.url)) return server;
  }
  return null;
}

/**
 * Build the full connection attempt order (network plan §4): cached peers ->
 * LAN -> group gossip -> master servers (by priority) -> carrier -> DHT ->
 * relay. Stages disabled via `fallbacks` (or with no master servers
 * configured) are omitted.
 * @param {object} normalized  from normalizeMasterServerList()
 * @returns {Array<{ stage:string, server?:object }>}
 */
export function buildConnectionOrder(normalized) {
  const { masterServers, fallbacks } = normalized;
  const order = [];
  if (fallbacks.cachedPeers) order.push({ stage: 'cachedPeers' });
  if (fallbacks.lanDiscovery) order.push({ stage: 'lan' });
  if (fallbacks.groupGossip) order.push({ stage: 'groupGossip' });
  for (const server of masterServers) {
    if (server.enabled) order.push({ stage: 'masterServer', server });
  }
  if (fallbacks.publicCarrier) order.push({ stage: 'carrier' });
  if (fallbacks.particleDht) order.push({ stage: 'dht' });
  return order;
}
