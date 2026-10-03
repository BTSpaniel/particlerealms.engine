// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/ImportPipeline.js — orchestrates the ingestion flow
// (spec §5 pipeline): detect → license-gate → parse → normalize orientation →
// detect hierarchy/parts/domain → deduplicate/register. GPU upload is a separate
// explicit step (GpuUploader) because parsing must stay GPU-free and worker-able.

import { detectFormat } from './FormatDetector.js';
import { importGltf } from './GltfSceneImporter.js';
import { importObj, parseMtl } from './ObjImporter.js';
import { importStl } from './StlImporter.js';
import { importPly } from './PlyImporter.js';
import { resolveOrientation } from './OrientationResolver.js';
import { detectHierarchy, detectParts, detectSemanticDomain } from './Detectors.js';
import { importMaterials } from '../material/MaterialImport.js';
import { normalizeTextures } from '../material/TextureImport.js';
import { buildSurfaceBindings } from '../material/SurfaceBinding.js';

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new TypeError('ImportPipeline: expected bytes or string');
}

/** Parse raw bytes of a known format into an EngineModel (no GPU, no registry). */
export async function parseToModel(format, data, opts = {}) {
  switch (format) {
    case 'glb':
    case 'gltf':
      return importGltf(data, { name: opts.name, sourceFormat: format, readExternal: opts.readExternal, bin: opts.bin, compute: opts.compute });
    case 'obj':
      return importObj(data, { name: opts.name, mtl: opts.mtl instanceof Map ? opts.mtl : (opts.mtlText ? parseMtl(opts.mtlText) : null) });
    case 'stl':
      return importStl(data, { name: opts.name });
    case 'ply':
      return importPly(data, { name: opts.name });
    default:
      throw new Error(`ImportPipeline: no native parser for '${format}' (bridge formats land later)`);
  }
}

/**
 * Full import of a single file.
 * @param {object} args
 * @param {string} args.name  filename or virtual path
 * @param {Uint8Array|ArrayBuffer|string} args.bytes  source data
 * @param {object} [args.registry]        AssetRegistry to dedup/register into
 * @param {object} [args.licenseTracker]  LicenseTracker for the import gate
 * @param {object} [args.license]         license block for this source
 * @param {object} [args.options]         { readExternal, mtlText, unitHint, upAxis, forwardAxis, primary }
 * @returns {Promise<{ ok:boolean, model:object|null, format:object, gate:object|null, registration:object|null, reason?:string }>}
 */
export async function importFile(args) {
  const { name, bytes, registry = null, licenseTracker = null, license = null, options = {} } = args;
  const data = asBytes(bytes);
  const head = data.subarray(0, 32);
  const format = detectFormat(name, head);

  // License gate (advisory by default; strict trackers block).
  let gate = null;
  if (licenseTracker) {
    gate = licenseTracker.evaluate(license || {});
    if (!gate.allowed) return { ok: false, model: null, format, gate, registration: null, reason: gate.reasons.join('; ') };
  }

  if (!format.format) return { ok: false, model: null, format, gate, registration: null, reason: 'unknown format' };

  let model;
  try {
    model = await parseToModel(format.format, data, { name, ...options });
  } catch (e) {
    return { ok: false, model: null, format, gate, registration: null, reason: e?.message ?? String(e) };
  }

  model.sourceFormat = format.format;
  resolveOrientation(model, options);
  detectHierarchy(model);
  detectParts(model);
  detectSemanticDomain(model);

  // Phase 2: decode materials/textures and bind them to surfaces (no GPU; pixel
  // decode + upload happen later via decodeAllTextures / GpuUploader).
  importMaterials(model);
  normalizeTextures(model);
  buildSurfaceBindings(model);

  let registration = null;
  if (registry) {
    registration = await registry.registerSource(data, {
      name: name.split(/[\\/]/).pop(), sourceFormat: format.format, primary: options.primary, license,
      type: 'model',
    });
    model.sourceHash = registration.record.sourceHash;
    registration.record.converted.engineModel = registration.record.converted.engineModel || null;
  }

  return { ok: true, model, format, gate, registration };
}
