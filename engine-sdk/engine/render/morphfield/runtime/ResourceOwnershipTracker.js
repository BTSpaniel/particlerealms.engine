// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class ResourceOwnershipTracker {
  constructor(label = "MorphField") {
    this.label = label;
    this._entries = new Map();
    this._bytes = 0;
    this._created = 0;
    this._destroyed = 0;
    this._createdBytes = 0;
    this._destroyedBytes = 0;
    this._lifetimeByKind = new Map();
  }

  own(resource, { kind = "other", label = "", bytes = 0 } = {}) {
    if (!resource || (typeof resource !== "object" && typeof resource !== "function")) {
      throw new TypeError(`${this.label}: cannot own an invalid GPU resource`);
    }
    if (this._entries.has(resource)) return resource;
    const size = Math.max(0, Math.floor(Number(bytes) || 0));
    this._entries.set(resource, { kind, label, bytes: size });
    this._bytes += size;
    this._created += 1;
    this._createdBytes += size;
    const lifetime = this._lifetimeByKind.get(kind) || {
      created: 0, released: 0, createdBytes: 0, releasedBytes: 0,
    };
    lifetime.created += 1;
    lifetime.createdBytes += size;
    this._lifetimeByKind.set(kind, lifetime);
    return resource;
  }

  owns(resource) {
    return this._entries.has(resource);
  }

  release(resource) {
    const entry = this._entries.get(resource);
    if (!entry) return false;
    this._entries.delete(resource);
    this._bytes -= entry.bytes;
    if (typeof resource.destroy === "function") resource.destroy();
    this._destroyed += 1;
    this._destroyedBytes += entry.bytes;
    const lifetime = this._lifetimeByKind.get(entry.kind);
    if (lifetime) {
      lifetime.released += 1;
      lifetime.releasedBytes += entry.bytes;
    }
    return true;
  }

  releaseWhere(predicate) {
    const resources = [];
    for (const [resource, entry] of this._entries) {
      if (predicate(entry, resource)) resources.push(resource);
    }
    for (const resource of resources) this.release(resource);
    return resources.length;
  }

  destroyAll() {
    for (const resource of Array.from(this._entries.keys())) this.release(resource);
  }

  getStats() {
    const byKind = {};
    for (const entry of this._entries.values()) {
      const current = byKind[entry.kind] || { count: 0, bytes: 0 };
      current.count += 1;
      current.bytes += entry.bytes;
      byKind[entry.kind] = current;
    }
    return {
      ownedCount: this._entries.size,
      ownedBytes: this._bytes,
      lifetimeCreated: this._created,
      lifetimeReleased: this._destroyed,
      lifetimeCreatedBytes: this._createdBytes,
      lifetimeReleasedBytes: this._destroyedBytes,
      lifetimeByKind: Object.fromEntries([...this._lifetimeByKind.entries()].map(([kind, lifetime]) => [
        kind,
        {
          ...lifetime,
          resident: lifetime.created - lifetime.released,
          residentBytes: lifetime.createdBytes - lifetime.releasedBytes,
        },
      ])),
      byKind,
    };
  }
}
