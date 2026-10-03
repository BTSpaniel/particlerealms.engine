// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const _idByObject = new WeakMap();
let _nextObjectId = 1;

function getObjectId(obj) {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function")) {
    return 0;
  }
  if (obj.buffer && typeof obj.buffer === "object") {
    return getObjectId(obj.buffer);
  }
  let id = _idByObject.get(obj);
  if (!id) {
    id = _nextObjectId++;
    _idByObject.set(obj, id);
  }
  return id;
}

function keyPartForResource(resource) {
  const r = normalizeBindGroupResource(resource);
  if (!r) return "0";
  if (r.buffer && typeof r.buffer === "object") {
    const bufId = getObjectId(r.buffer);
    const off = (r.offset || 0) | 0;
    const size = (r.size || 0) | 0;
    return `${bufId}:${off}:${size}`;
  }
  return `${getObjectId(r)}`;
}

export class ResourceSignal {
  constructor(value = null) {
    this.value = value;
    this.version = 0;
  }

  set(value) {
    if (this.value !== value) {
      this.value = value;
      this.version = (this.version + 1) | 0;
    }
  }
}

export function createSignal(value = null) {
  return new ResourceSignal(value);
}

function normalizeBindGroupResource(value) {
  if (!value) {
    return null;
  }

  if (value instanceof ResourceSignal) {
    return normalizeBindGroupResource(value.value);
  }

  if (value.buffer && typeof value.buffer === "object") {
    return value;
  }

  if (typeof value === "object" && typeof value.destroy === "function") {
    return { buffer: value };
  }

  return value;
}

export class BindGroupSignals {
  constructor(device, layout, bindings, options = {}) {
    if (!device) {
      throw new Error("BindGroupSignals: device is required");
    }
    if (!layout) {
      throw new Error("BindGroupSignals: layout is required");
    }
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new Error("BindGroupSignals: bindings[] is required");
    }

    this.device = device;
    this.layout = layout;
    this.bindings = bindings.map((b) => ({
      name: b.name,
      binding: b.binding | 0,
    }));

    this.label = typeof options.label === "string" ? options.label : "BindGroupSignals";

    this.getBindGroup = typeof options.getBindGroup === "function" ? options.getBindGroup : null;

    const max = typeof options.maxEntries === "number" && Number.isFinite(options.maxEntries) ? options.maxEntries | 0 : 0;
    this.maxEntries = Math.max(0, max);

    this._cache = new Map();
    this._layoutId = getObjectId(layout);
  }

  _makeKey(resources) {
    let key = `${this._layoutId}`;
    for (let i = 0; i < this.bindings.length; i++) {
      const { name, binding } = this.bindings[i];
      const v = resources[name];
      if (v instanceof ResourceSignal) {
        key += `|${binding}:${keyPartForResource(v.value)}@${v.version}`;
      } else {
        key += `|${binding}:${keyPartForResource(v)}`;
      }
    }
    return key;
  }

  get(resources, labelOverride) {
    if (!resources) {
      throw new Error("BindGroupSignals.get: resources object is required");
    }

    if (this.getBindGroup) {
      const entries = [];
      for (let i = 0; i < this.bindings.length; i++) {
        const { name, binding } = this.bindings[i];
        const raw = resources[name];
        const resource = normalizeBindGroupResource(raw);
        if (!resource) {
          throw new Error(`BindGroupSignals.get: missing resource for '${name}'`);
        }
        entries.push({ binding, resource });
      }
      entries.sort((a, b) => a.binding - b.binding);
      const label = typeof labelOverride === "string" ? labelOverride : this.label;
      return this.getBindGroup(this.layout, entries, label);
    }

    const key = this._makeKey(resources);
    const cached = this._cache.get(key);
    if (cached) {
      cached.lastUsed = performance.now();
      return cached.bindGroup;
    }

    const entries = [];
    for (let i = 0; i < this.bindings.length; i++) {
      const { name, binding } = this.bindings[i];
      const raw = resources[name];
      const resource = normalizeBindGroupResource(raw);
      if (!resource) {
        throw new Error(`BindGroupSignals.get: missing resource for '${name}'`);
      }
      entries.push({ binding, resource });
    }

    entries.sort((a, b) => a.binding - b.binding);

    const bindGroup = this.device.createBindGroup({
      label: typeof labelOverride === "string" ? labelOverride : this.label,
      layout: this.layout,
      entries,
    });

    this._cache.set(key, { bindGroup, lastUsed: performance.now() });

    if (this.maxEntries > 0 && this._cache.size > this.maxEntries) {
      let oldestKey = null;
      let oldestT = Infinity;
      for (const [k, v] of this._cache) {
        if (v.lastUsed < oldestT) {
          oldestT = v.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) {
        this._cache.delete(oldestKey);
      }
    }
    return bindGroup;
  }

  clear() {
    this._cache.clear();
  }

  getStats() {
    return {
      size: this._cache.size,
      label: this.label,
      maxEntries: this.maxEntries,
    };
  }
}

export function generateWGSLBindGroupDeclarations(groupIndex, defs) {
  const group = groupIndex | 0;
  if (!Array.isArray(defs)) {
    throw new Error("generateWGSLBindGroupDeclarations: defs[] required");
  }

  const lines = [];
  for (const d of defs) {
    const binding = d.binding | 0;
    const name = d.name;
    const addressSpace = d.addressSpace || "storage";
    const access = d.access || "read";
    const wgslType = d.wgslType;

    if (!name || typeof name !== "string") {
      throw new Error("generateWGSLBindGroupDeclarations: def.name required");
    }
    if (!wgslType || typeof wgslType !== "string") {
      throw new Error("generateWGSLBindGroupDeclarations: def.wgslType required");
    }

    if (addressSpace === "uniform") {
      lines.push(`@group(${group}) @binding(${binding}) var<uniform> ${name} : ${wgslType};`);
    } else {
      lines.push(`@group(${group}) @binding(${binding}) var<${addressSpace}, ${access}> ${name} : ${wgslType};`);
    }
  }

  return lines.join("\n");
}
