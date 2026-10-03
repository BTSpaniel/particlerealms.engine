// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/GltfSceneImporter.js — full glTF/GLB scene → EngineModel.
//
// glTF is the preferred runtime delivery format (nodes, meshes, materials,
// skins, animations, buffers, textures). This importer parses the whole scene
// graph — not just motion — reusing the engine's accessor toolkit
// (core/math/MeshAttributeMath) to decode vertex/index data exactly. Materials
// and textures are preserved as raw blocks here and normalized in Phase 2; the
// original look must always be recoverable.

import {
  readAccessorArray, accessorElementCount, GLTF_COMPONENT_TYPES, attributeBounds,
} from '../../core/math/MeshAttributeMath.js';
import { aabbCenter } from '../../core/math/MathGeometry.js';
import {
  createEngineModel, createEngineNode, createEngineMesh, createEnginePrimitive,
} from '../EngineModel.js';

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942;  // 'BIN\0'

async function computeAttributeBounds(compute, positions) {
  let buffer = null;
  let job = null;
  try {
    buffer = await compute.copyFrom(positions);
    job = await compute.submit('math.geometry.attribute-bounds@1', {
      inputs: { positions: buffer }, parameters: { componentCount: 3 },
    });
    const result = await compute.wait(job);
    return result.value;
  } finally {
    if (job) await compute.releaseJob(job).catch(() => {});
    if (buffer) await compute.releaseBuffer(buffer).catch(() => {});
  }
}

export const GLTF_EXTERNAL_RESOURCE_LIMITS = Object.freeze({
  maxResources: 1024,
  maxUriBytes: 4096,
  maxJsonBytes: 64 * 1024 * 1024,
  maxResourceBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
});

const ATTR_MAP = {
  POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent',
  TEXCOORD_0: 'uv0', TEXCOORD_1: 'uv1', COLOR_0: 'color',
  JOINTS_0: 'joints', WEIGHTS_0: 'weights',
};

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('GltfSceneImporter: expected bytes');
}

/** Parse a binary GLB into { json, bin }. */
export function parseGlb(bytes) {
  const b = asBytes(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('parseGlb: not a GLB (bad magic)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`parseGlb: unsupported GLB version ${version}`);
  const total = dv.getUint32(8, true);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < total) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunk = b.subarray(start, start + chunkLen);
    if (chunkType === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (chunkType === CHUNK_BIN) bin = chunk;
    offset = start + chunkLen + (chunkLen % 4 === 0 ? 0 : 4 - (chunkLen % 4));
  }
  if (!json) throw new Error('parseGlb: missing JSON chunk');
  return { json, bin };
}

export function decodeGltfDataUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('data:')) {
    throw new TypeError('GltfSceneImporter: expected a data URI');
  }
  const comma = uri.indexOf(',');
  if (comma < 5) throw new TypeError('GltfSceneImporter: malformed data URI');
  const meta = uri.slice(5, comma); // after 'data:'
  const data = uri.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(data));
}

export function gltfExternalUriReport(uri) {
  if (typeof uri !== 'string' || uri.length === 0) {
    return { valid: false, embedded: false, path: '', reason: 'invalid-uri' };
  }
  if (uri.startsWith('data:')) return { valid: true, embedded: true, path: '', reason: 'embedded' };
  if (new TextEncoder().encode(uri).byteLength > GLTF_EXTERNAL_RESOURCE_LIMITS.maxUriBytes) {
    return { valid: false, embedded: false, path: '', reason: 'uri-too-large' };
  }
  if (uri.includes('\\') || uri.includes('?') || uri.includes('#')
    || uri.startsWith('/') || uri.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    return { valid: false, embedded: false, path: '', reason: 'non-local-uri' };
  }
  let decoded;
  try {
    decoded = decodeURIComponent(uri);
  } catch (_) {
    return { valid: false, embedded: false, path: '', reason: 'invalid-encoding' };
  }
  const parts = [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..' || segment.includes('\0')) {
      return { valid: false, embedded: false, path: '', reason: 'path-traversal' };
    }
    parts.push(segment);
  }
  const path = parts.join('/');
  return { valid: path.length > 0, embedded: false, path, reason: path ? 'valid' : 'invalid-uri' };
}

export function gltfExternalResourceReferences(json) {
  const references = [];
  const append = (kind, index, value, mimeType = null) => {
    if (!value || typeof value.uri !== 'string') return;
    const report = gltfExternalUriReport(value.uri);
    if (!report.valid) throw new TypeError(`glTF ${kind} ${index} URI rejected: ${report.reason}`);
    if (report.embedded) return;
    references.push({ kind, index, uri: value.uri, path: report.path, mimeType });
    if (references.length > GLTF_EXTERNAL_RESOURCE_LIMITS.maxResources) {
      throw new RangeError('glTF external resource count exceeds limit');
    }
  };
  (json?.buffers ?? []).forEach((buffer, index) => append('buffer', index, buffer));
  (json?.images ?? []).forEach((image, index) => append('image', index, image, image?.mimeType ?? null));
  return references;
}

function _selectedFilePath(file) {
  const raw = typeof file?.webkitRelativePath === 'string' && file.webkitRelativePath
    ? file.webkitRelativePath
    : file?.name;
  if (typeof raw !== 'string' || !raw || raw.includes('\\')) return null;
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..' || part.includes('\0'))) return null;
  return parts.join('/');
}

function _joinSelectedPath(mainPath, resourcePath) {
  const parent = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/')) : '';
  return parent ? `${parent}/${resourcePath}` : resourcePath;
}

function _inferImageMimeType(path) {
  const ext = path.toLowerCase().split('.').pop();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', ktx2: 'image/ktx2' })[ext] || 'application/octet-stream';
}

function _safeMimeType(value, fallback) {
  return typeof value === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value) ? value : fallback;
}

function _bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

function _packagedFile(text, source) {
  const options = { type: 'model/gltf+json', lastModified: source?.lastModified ?? Date.now() };
  if (typeof File === 'function') return new File([text], source.name, options);
  const blob = new Blob([text], options);
  Object.defineProperty(blob, 'name', { value: source.name, enumerable: true });
  Object.defineProperty(blob, 'lastModified', { value: options.lastModified, enumerable: true });
  return blob;
}

export async function packageLooseGltfFiles(inputFiles) {
  const files = Array.from(inputFiles ?? []);
  const pathEntries = new Map();
  const basenameEntries = new Map();
  for (const file of files) {
    const path = _selectedFilePath(file);
    if (!path || typeof file?.arrayBuffer !== 'function') throw new TypeError('glTF package contains an invalid file entry');
    if (!pathEntries.has(path)) pathEntries.set(path, []);
    pathEntries.get(path).push(file);
    const basename = path.slice(path.lastIndexOf('/') + 1);
    if (!basenameEntries.has(basename)) basenameEntries.set(basename, []);
    basenameEntries.get(basename).push(file);
  }

  const packaged = new Map();
  const consumed = new Set();
  const packages = [];
  for (const source of files) {
    if (!source.name?.toLowerCase().endsWith('.gltf')) continue;
    if (typeof source.text !== 'function') throw new TypeError(`glTF source ${source.name} is not readable`);
    if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > GLTF_EXTERNAL_RESOURCE_LIMITS.maxJsonBytes) {
      throw new RangeError(`glTF JSON exceeds byte limit: ${source.name}`);
    }
    const json = JSON.parse(await source.text());
    const references = gltfExternalResourceReferences(json);
    if (references.length === 0) {
      packaged.set(source, source);
      packages.push({ source, file: source, resources: [] });
      continue;
    }

    const mainPath = _selectedFilePath(source);
    const clone = JSON.parse(JSON.stringify(json));
    const resolved = new Map();
    let totalBytes = 0;
    for (const reference of references) {
      let resource = resolved.get(reference.path);
      if (!resource) {
        const exact = pathEntries.get(_joinSelectedPath(mainPath, reference.path)) ?? [];
        const direct = pathEntries.get(reference.path) ?? [];
        const basename = reference.path.slice(reference.path.lastIndexOf('/') + 1);
        const fallback = basenameEntries.get(basename) ?? [];
        const candidates = exact.length > 0 ? exact : (direct.length > 0 ? direct : fallback);
        if (candidates.length !== 1) {
          const reason = candidates.length === 0 ? 'missing' : 'ambiguous';
          throw new Error(`glTF external resource ${reason}: ${reference.uri}`);
        }
        const file = candidates[0];
        const bytes = asBytes(await file.arrayBuffer());
        if (bytes.byteLength > GLTF_EXTERNAL_RESOURCE_LIMITS.maxResourceBytes) {
          throw new RangeError(`glTF external resource exceeds byte limit: ${reference.uri}`);
        }
        totalBytes += bytes.byteLength;
        if (totalBytes > GLTF_EXTERNAL_RESOURCE_LIMITS.maxTotalBytes) {
          throw new RangeError('glTF external resources exceed total byte limit');
        }
        resource = { file, bytes };
        resolved.set(reference.path, resource);
        consumed.add(file);
      }

      if (reference.kind === 'buffer') {
        const declared = clone.buffers[reference.index]?.byteLength;
        if (!Number.isSafeInteger(declared) || declared < 0 || resource.bytes.byteLength < declared) {
          throw new RangeError(`glTF external buffer is shorter than declared: ${reference.uri}`);
        }
        clone.buffers[reference.index].uri = `data:application/octet-stream;base64,${_bytesToBase64(resource.bytes)}`;
      } else {
        const inferredMimeType = _inferImageMimeType(reference.path);
        const mimeType = _safeMimeType(reference.mimeType, _safeMimeType(resource.file.type, inferredMimeType));
        clone.images[reference.index].uri = `data:${mimeType};base64,${_bytesToBase64(resource.bytes)}`;
        if (!clone.images[reference.index].mimeType) clone.images[reference.index].mimeType = mimeType;
      }
    }
    const file = _packagedFile(JSON.stringify(clone), source);
    packaged.set(source, file);
    packages.push({ source, file, resources: Array.from(resolved.values(), (entry) => entry.file) });
  }

  const outputFiles = [];
  for (const file of files) {
    if (packaged.has(file)) outputFiles.push(packaged.get(file));
    else if (!consumed.has(file)) outputFiles.push(file);
  }
  return { files: outputFiles, packages };
}

/**
 * Resolve every glTF buffer to a Uint8Array.
 * @param {object} json gltf json
 * @param {Uint8Array|null} bin GLB binary chunk (buffer 0 when uri is absent)
 * @param {(uri:string)=>Promise<Uint8Array>} [readExternal] for external .bin
 */
async function resolveBuffers(json, bin, readExternal) {
  const buffers = json.buffers ?? [];
  const out = new Array(buffers.length);
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    if (!buf.uri) { out[i] = bin; }                         // GLB-embedded buffer
    else if (buf.uri.startsWith('data:')) out[i] = decodeGltfDataUri(buf.uri);
    else if (readExternal) out[i] = asBytes(await readExternal(buf.uri));
    else throw new Error(`GltfSceneImporter: unresolved external buffer ${buf.uri}`);
    const declared = buf.byteLength;
    if (!out[i] || !Number.isSafeInteger(declared) || declared < 0 || out[i].byteLength < declared) {
      throw new RangeError(`GltfSceneImporter: buffer ${i} is shorter than declared`);
    }
  }
  return out;
}

function readPrimitiveAccessor(json, buffers, accessorIndex, wantFloat) {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) return null;
  const bufferView = json.bufferViews?.[accessor.bufferView] ?? {};
  const source = buffers[bufferView.buffer];
  if (!source) return null;
  const array = readAccessorArray(source, accessor, bufferView, { output: wantFloat ? 'float32' : 'typed' });
  return array ? { array, count: accessor.count, components: accessorElementCount(accessor.type) } : null;
}

/**
 * Extract the recoverable glTF material/texture payload from already-resolved
 * buffers. This is shared by the full asset pipeline and the editor mesh
 * importer so both paths normalize exactly the same source records.
 */
export function extractGltfMaterialPayload(json, buffers = [], externalImages = null) {
  const metadata = {
    gltfAsset: json?.asset ?? null,
    extensionsUsed: Array.isArray(json?.extensionsUsed) ? [...json.extensionsUsed] : [],
    gltfSamplers: Array.isArray(json?.samplers) ? json.samplers : [],
    gltfImages: Array.isArray(json?.images) ? json.images : [],
  };
  const materials = (json?.materials ?? []).map((mat, i) => ({
    id: `material:${i}`,
    name: mat?.name ?? `material_${i}`,
    rawIndex: i,
    raw: mat,
    workflow: mat?.extensions?.KHR_materials_pbrSpecularGlossiness
      ? 'specularGlossiness'
      : (mat?.extensions?.KHR_materials_unlit ? 'unlit' : 'metallicRoughness'),
  }));
  const textures = (json?.textures ?? []).map((tex, i) => {
    const sourceIndex = tex?.extensions?.KHR_texture_basisu?.source ?? tex?.source ?? null;
    const image = Number.isInteger(sourceIndex) ? json?.images?.[sourceIndex] : null;
    let imageBytes = null;
    let mimeType = image?.mimeType ?? null;
    let uri = image?.uri ?? null;
    if (typeof uri === 'string' && uri.startsWith('data:')) {
      imageBytes = decodeGltfDataUri(uri);
      const header = uri.slice(5, uri.indexOf(','));
      mimeType = mimeType || header.split(';')[0] || null;
      uri = null;
    } else if (externalImages?.has(sourceIndex)) {
      imageBytes = asBytes(externalImages.get(sourceIndex));
      uri = null;
    } else if (image && Number.isInteger(image.bufferView)) {
      const view = json?.bufferViews?.[image.bufferView];
      const source = view && Number.isInteger(view.buffer) ? buffers[view.buffer] : null;
      if (source) {
        const bytes = asBytes(source);
        const start = view.byteOffset ?? 0;
        const end = start + (view.byteLength ?? 0);
        if (start >= 0 && end >= start && end <= bytes.byteLength) imageBytes = bytes.slice(start, end);
      }
    }
    return {
      id: `texture:${i}`,
      rawIndex: i,
      raw: tex,
      image: sourceIndex,
      sampler: tex?.sampler ?? null,
      name: image?.name ?? `texture_${i}`,
      imageBytes,
      mimeType,
      uri,
    };
  });
  return { metadata, materials, textures };
}

/**
 * Import a glTF/GLB into an EngineModel.
 * @param {Uint8Array|ArrayBuffer|object} data GLB bytes, or a parsed gltf object
 * @param {object} [opts] { name, bin, readExternal }
 * @returns {Promise<object>} EngineModel
 */
export async function importGltf(data, opts = {}) {
  let json;
  let bin = opts.bin ?? null;
  if (data && typeof data === 'object' && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
    json = data; // already-parsed gltf JSON
  } else {
    const bytes = asBytes(data);
    // GLB if it starts with the glTF magic, otherwise treat as JSON text.
    if (bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === GLB_MAGIC) {
      const parsed = parseGlb(bytes);
      json = parsed.json; bin = parsed.bin;
    } else {
      json = JSON.parse(new TextDecoder().decode(bytes));
    }
  }

  const externalCache = new Map();
  const readExternal = opts.readExternal
    ? async (uri) => {
      if (!externalCache.has(uri)) externalCache.set(uri, Promise.resolve(opts.readExternal(uri)).then(asBytes));
      return externalCache.get(uri);
    }
    : null;
  const buffers = await resolveBuffers(json, bin, readExternal);
  const externalImages = new Map();
  if (readExternal) {
    for (let i = 0; i < (json.images ?? []).length; i++) {
      const uri = json.images[i]?.uri;
      if (typeof uri === 'string' && !uri.startsWith('data:')) externalImages.set(i, await readExternal(uri));
    }
  }
  const model = createEngineModel({ name: opts.name ?? json.asset?.generator ?? 'gltf', sourceFormat: opts.sourceFormat ?? 'gltf' });
  const materialPayload = extractGltfMaterialPayload(json, buffers, externalImages);
  Object.assign(model.metadata, materialPayload.metadata);
  model.materials.push(...materialPayload.materials);
  model.textures.push(...materialPayload.textures);

  // --- meshes & primitives ---
  const meshPrimIds = []; // per gltf mesh → [primitive ids]
  (json.meshes ?? []).forEach((mesh, mi) => {
    const meshId = `mesh:${mi}`;
    const primIds = [];
    (mesh.primitives ?? []).forEach((prim, pi) => {
      const primId = `primitive:${mi}:${pi}`;
      const attributes = {};
      let vertexCount = 0;
      let bounds = null;
      for (const [gltfAttr, key] of Object.entries(ATTR_MAP)) {
        if (prim.attributes?.[gltfAttr] == null) continue;
        const wantFloat = key !== 'joints'; // joints stay integer
        const read = readPrimitiveAccessor(json, buffers, prim.attributes[gltfAttr], wantFloat);
        if (!read) continue;
        attributes[key] = read.array;
        if (key === 'position') {
          vertexCount = read.count;
          if (!opts.compute) {
            const b = attributeBounds(read.array, 3);
            bounds = { min: b.min, max: b.max, center: aabbCenter({ min: b.min, max: b.max }), radius: 0 };
            bounds.radius = Math.hypot(...b.max.map((m, i) => m - bounds.center[i]));
          }
        }
      }
      let indices = null;
      if (prim.indices != null) {
        const read = readPrimitiveAccessor(json, buffers, prim.indices, false);
        if (read) indices = read.array;
      }
      const enginePrim = createEnginePrimitive({
        id: primId, mesh: meshId, material: prim.material != null ? `material:${prim.material}` : null,
        attributes, indices, vertexCount, bounds,
      });
      model.primitives.push(enginePrim);
      primIds.push(primId);
    });
    model.meshes.push(createEngineMesh({ id: meshId, name: mesh.name ?? `mesh_${mi}`, primitives: primIds }));
    meshPrimIds[mi] = primIds;
  });

  // Await bounds before publishing any scene result. Source arrays remain owned
  // by the model; the injected owner-scoped facade copies and releases its input.
  if (opts.compute) {
    for (const primitive of model.primitives) {
      if (!primitive.attributes.position) continue;
      const b = await computeAttributeBounds(opts.compute, primitive.attributes.position);
      const center = aabbCenter({ min: b.min, max: b.max });
      primitive.bounds = { min: b.min, max: b.max, center,
        radius: Math.hypot(...b.max.map((value, index) => value - center[index])) };
    }
  }

  // --- nodes (preserve hierarchy + transforms exactly) ---
  (json.nodes ?? []).forEach((node, ni) => {
    const n = createEngineNode({
      id: `node:${ni}`, name: node.name ?? `node_${ni}`,
      translation: node.translation ?? [0, 0, 0],
      rotation: node.rotation ?? [0, 0, 0, 1],
      scale: node.scale ?? [1, 1, 1],
      mesh: node.mesh != null ? `mesh:${node.mesh}` : null,
      skin: node.skin != null ? `skin:${node.skin}` : null,
      children: (node.children ?? []).map((c) => `node:${c}`),
      extras: node.extras ?? {},
    });
    if (node.matrix) n.extras.matrix = node.matrix; // column-major 4x4 if authored
    model.nodes.push(n);
  });
  // parent links
  for (const n of model.nodes) for (const childId of n.children) {
    const child = model.nodes.find((x) => x.id === childId);
    if (child) child.parent = n.id;
  }

  // --- skins / animations (counts + names now; full rig/mixer in later phases) ---
  // We DO decode inverseBindMatrices here: bind-pose joint world = inverse(IBM),
  // which is the authoritative skeleton (the node-TRS hierarchy alone does not
  // always reproduce the bind pose). Joints are stored as node indices.
  (json.skins ?? []).forEach((skin, i) => {
    let inverseBindMatrices = null;
    if (skin.inverseBindMatrices != null) {
      const read = readPrimitiveAccessor(json, buffers, skin.inverseBindMatrices, true);
      if (read) inverseBindMatrices = read.array; // Float32Array, jointCount × 16 (column-major)
    }
    model.skins.push({
      id: `skin:${i}`, name: skin.name ?? `skin_${i}`,
      joints: (skin.joints ?? []).slice(), skeleton: skin.skeleton ?? null,
      jointCount: (skin.joints ?? []).length, inverseBindMatrices, raw: skin,
    });
  });
  (json.animations ?? []).forEach((anim, i) => model.animations.push({ id: `animation:${i}`, name: anim.name ?? `anim_${i}`, channelCount: (anim.channels ?? []).length, raw: anim }));

  // --- overall bounds (union of primitive bounds) ---
  model.bounds = unionBounds(model.primitives);
  model.metadata.stats = {
    nodes: model.nodes.length, meshes: model.meshes.length, primitives: model.primitives.length,
    materials: model.materials.length, textures: model.textures.length,
    skins: model.skins.length, animations: model.animations.length,
  };
  return model;
}

function unionBounds(primitives) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const p of primitives) {
    if (!p.bounds) continue;
    any = true;
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p.bounds.min[i]); max[i] = Math.max(max[i], p.bounds.max[i]); }
  }
  if (!any) return null;
  const center = aabbCenter({ min, max });
  const radius = Math.hypot(...max.map((m, i) => m - center[i]));
  return { min, max, center, radius };
}

export { GLTF_COMPONENT_TYPES };
