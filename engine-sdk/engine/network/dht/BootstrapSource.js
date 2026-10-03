// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/dht/BootstrapSource.js — pluggable bootstrap sources for the
// no-bootstrap-is-impossible reality check (network plan §37/§47/§48):
// "no pure zero-bootstrap global discovery exists" — cached peers, LAN,
// invite code, DHT, radio beacon, or a seed/master server are the only
// starting paths. This module defines a tiny, transport-agnostic interface
// (`{ id, scan(), advertise(record) }`) and a registry to combine several
// sources into one bootstrap attempt order; it ships NO concrete transport.
//
// Concrete adapter (wired at the OS integration layer, per this module's
// engine/network-stays-webgpu-os-free rule): webgpu-os/drivers/
// ResidentBootstrapSource.js wraps the OS browser extension's "resident"
// node (webgpu-os/browser-extension/services/ResidentService.js, exposed
// via BrowserBridgeClient.resident) — a standing MV3 offscreen document that
// persists a device's PUBLIC identity cert and stays warm via a
// chrome.alarms keepalive. Kept honest in that adapter: the resident node
// does NOT answer presence with no OS tab open (it is a lightweight cert
// vault + heartbeat only, off by default) — its `scan()` returns a
// "last remembered identity" hint, not a confirmed-reachable peer.

/**
 * Wrap a bootstrap source implementation.
 * @param {object} c
 * @param {string} c.id                stage name (e.g. 'lan', 'residentExtension', 'radio')
 * @param {() => Promise<object[]>} c.scan       return known peer/route records this source currently has
 * @param {(record:object) => Promise<void>} [c.advertise]  publish our own presence via this source, if supported
 */
export function createBootstrapSource({ id, scan, advertise = null } = {}) {
  if (!id) throw new TypeError('createBootstrapSource requires an id');
  if (typeof scan !== 'function') throw new TypeError('createBootstrapSource requires a scan() function');
  return { id, scan, advertise };
}

/** Create a registry of bootstrap sources, tried in registration order. */
export function createBootstrapRegistry() {
  return { _sources: [] };
}

export function registerBootstrapSource(registry, source) {
  registry._sources.push(source);
}

/**
 * Try each registered source in order, collecting whatever records each one
 * returns (a source throwing/timing out just contributes nothing — this
 * never fails the whole bootstrap attempt).
 * @returns {Promise<Array<{ sourceId:string, records:object[] }>>}
 */
export async function runBootstrap(registry) {
  const results = [];
  for (const source of registry._sources) {
    try {
      const records = await source.scan();
      results.push({ sourceId: source.id, records: records || [] });
    } catch (_) {
      results.push({ sourceId: source.id, records: [] });
    }
  }
  return results;
}

/** Flatten runBootstrap()'s per-source results into one record list, tagged with their source. */
export function flattenBootstrapResults(results) {
  const flat = [];
  for (const { sourceId, records } of results) {
    for (const record of records) flat.push({ ...record, sourceId });
  }
  return flat;
}
