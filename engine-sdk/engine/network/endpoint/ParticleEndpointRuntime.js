// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  createDiscoveryRegistry,
  registerDiscoveryProvider,
  unregisterDiscoveryProvider,
  discoverRealmPeers,
  discoveryProviderStatus,
} from '../realm/link/DiscoveryProvider.js';
import {
  createTransportRegistry,
  registerTransportProvider,
  unregisterTransportProvider,
  connectRealmTransport,
  transportProviderStatus,
} from '../realm/link/TransportProvider.js';
import { createHealthMonitor, buildHealthSnapshotV1, observeDiscoveryHealth } from '../realm/health/HealthSnapshot.js';
import { projectEndpointReachability } from '../realm/health/ReachabilityProjection.js';
import { routeProtocolRegistryStatus } from '../routes/RouteProtocolRegistry.js';

const ENDPOINT_STATE = Object.freeze({ IDLE: 'idle', RUNNING: 'running', STOPPED: 'stopped' });

function emit(runtime, event, details = {}, level = 'debug') {
  runtime.logger({ component: 'particle-endpoint', event, level, at: runtime.now(), ...details });
}

function safeArray(provider, label, runtime) {
  try {
    const value = provider?.();
    return Array.isArray(value) ? value : [];
  } catch (error) {
    emit(runtime, 'snapshot.provider-failed', { provider: label, reason: error?.message ?? 'provider-failed' }, 'warn');
    return [];
  }
}

export class ParticleEndpointRuntime {
  constructor({
    endpointId = null,
    now = () => Date.now(),
    clock = () => globalThis.performance?.now?.() ?? Date.now(),
    logger = () => {},
    residentStatus = () => null,
    routeStatuses = () => [],
    masterserverStatuses = () => [],
  } = {}) {
    if (typeof now !== 'function' || typeof clock !== 'function' || typeof logger !== 'function') {
      throw new TypeError('ParticleEndpointRuntime hooks must be functions');
    }
    this.endpointId = endpointId == null ? null : String(endpointId);
    this.now = now;
    this.clock = clock;
    this.logger = logger;
    this.state = ENDPOINT_STATE.IDLE;
    this.startedAt = null;
    this.discovery = createDiscoveryRegistry({ now, logger });
    this.transports = createTransportRegistry({ now, logger });
    this.health = createHealthMonitor({ now, logger });
    this.protocolRegistries = new Map();
    this.listeners = new Set();
    this.residentStatusProvider = residentStatus;
    this.routeStatusesProvider = routeStatuses;
    this.masterserverStatusesProvider = masterserverStatuses;
  }

  setEndpointId(endpointId) {
    const value = String(endpointId ?? '').trim();
    if (!value || value.length > 512) throw new TypeError('endpointId must be a non-empty bounded string');
    if (this.endpointId && this.endpointId !== value) throw new Error('Particle endpoint identity cannot change while the runtime exists');
    this.endpointId = value;
    this.#notify('identity-ready');
    return value;
  }

  start() {
    if (this.state === ENDPOINT_STATE.RUNNING) return this.snapshot();
    const started = this.clock();
    this.state = ENDPOINT_STATE.RUNNING;
    this.startedAt = this.now();
    emit(this, 'start.exit', { durationMs: Math.max(0, this.clock() - started) });
    this.#notify('started');
    return this.snapshot();
  }

  stop() {
    if (this.state === ENDPOINT_STATE.STOPPED) return this.snapshot();
    this.state = ENDPOINT_STATE.STOPPED;
    emit(this, 'stop.exit', { routeProtocolRegistries: this.protocolRegistries.size });
    this.#notify('stopped');
    return this.snapshot();
  }

  registerDiscoveryProvider(provider) {
    const result = registerDiscoveryProvider(this.discovery, provider);
    this.#notify('discovery-provider-registered');
    return result;
  }

  unregisterDiscoveryProvider(providerId) {
    const removed = unregisterDiscoveryProvider(this.discovery, providerId);
    if (removed) this.#notify('discovery-provider-unregistered');
    return removed;
  }

  registerTransportProvider(provider) {
    const result = registerTransportProvider(this.transports, provider);
    this.#notify('transport-provider-registered');
    return result;
  }

  unregisterTransportProvider(providerId) {
    const removed = unregisterTransportProvider(this.transports, providerId);
    if (removed) this.#notify('transport-provider-unregistered');
    return removed;
  }

  attachRouteProtocolRegistry(routeId, registry) {
    if (!registry?.descriptors || !registry?.peers) throw new TypeError('invalid route protocol registry');
    const id = String(routeId);
    const existing = this.protocolRegistries.get(id);
    if (existing && existing !== registry) {
      throw new Error(`route protocol registry already attached: ${id}`);
    }
    if (existing === registry) return () => this.detachRouteProtocolRegistry(id, registry);
    this.protocolRegistries.set(id, registry);
    this.#notify('route-protocols-attached');
    return () => this.detachRouteProtocolRegistry(id, registry);
  }

  detachRouteProtocolRegistry(routeId, expected = null) {
    const id = String(routeId);
    if (expected && this.protocolRegistries.get(id) !== expected) return false;
    const removed = this.protocolRegistries.delete(id);
    if (removed) this.#notify('route-protocols-detached');
    return removed;
  }

  async discoverPeers(query = {}, options = {}) {
    if (this.state !== ENDPOINT_STATE.RUNNING) throw new Error('Particle endpoint runtime is not running');
    const started = this.clock();
    const peers = await discoverRealmPeers(this.discovery, query, options);
    observeDiscoveryHealth(this.health, discoveryProviderStatus(this.discovery));
    emit(this, 'discover.exit', { peerCount: peers.length, durationMs: Math.max(0, this.clock() - started) });
    this.#notify('discovery-complete');
    return peers;
  }

  async connectTransport(target, options = {}) {
    if (this.state !== ENDPOINT_STATE.RUNNING) throw new Error('Particle endpoint runtime is not running');
    const started = this.clock();
    const session = await connectRealmTransport(this.transports, target, options);
    emit(this, 'transport.connect-exit', {
      kind: session.kind ?? null,
      durationMs: Math.max(0, this.clock() - started),
    });
    this.#notify('transport-connected');
    return session;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('endpoint listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refresh(reason = 'refreshed') {
    this.#notify(String(reason));
    return this.snapshot();
  }

  snapshot() {
    const resident = this.residentStatusProvider?.() ?? null;
    const routes = safeArray(this.routeStatusesProvider, 'routes', this);
    const masterservers = safeArray(this.masterserverStatusesProvider, 'masterservers', this);
    const peers = routes.flatMap((route) => Array.isArray(route?.peers) ? route.peers : []);
    const protocols = [...this.protocolRegistries.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([routeId, registry]) => {
        const status = routeProtocolRegistryStatus(registry);
        return Object.freeze({
          routeId,
          catalog: status.catalog,
          descriptors: status.descriptors,
          peerCatalogCount: status.peers.length,
          totals: status.totals,
        });
      });
    const reachability = projectEndpointReachability({
      residentActive: resident?.active === true,
      routeCount: routes.length,
      masterservers,
      peers,
      observedAt: this.now(),
    });
    return Object.freeze({
      endpointId: this.endpointId,
      state: this.state,
      startedAt: this.startedAt,
      resident,
      reachability,
      routes: Object.freeze(routes),
      masterservers: Object.freeze(masterservers),
      protocols: Object.freeze(protocols),
      discovery: Object.freeze(discoveryProviderStatus(this.discovery)),
      transports: Object.freeze(transportProviderStatus(this.transports)),
      health: buildHealthSnapshotV1(this.health),
    });
  }

  #notify(reason) {
    const event = Object.freeze({ reason, at: this.now() });
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch (error) {
        emit(this, 'listener.failed', { reason: error?.message ?? 'listener-failed' }, 'warn');
      }
    }
  }
}

export function createParticleEndpointRuntime(options) {
  return new ParticleEndpointRuntime(options);
}
