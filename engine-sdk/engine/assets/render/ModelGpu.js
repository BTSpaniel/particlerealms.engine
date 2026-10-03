// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/render/ModelGpu.js — reusable GPU-side helpers to turn an
// uploaded EngineModel into drawable items. Small, composable, and shared by the
// importer/viewer, the editor, and the runtime so nobody re-implements texture
// upload, per-primitive bind groups, world-matrix flattening, or bounds framing.
//
// Pairs with ModelShader (uniform block) and GpuUploader (vertex layout). Pure
// data in → GPU objects out; callers own the render pass and camera.

import { multiply, composeTRS, transformPoint, computeWorldMatrices, identity, nodeLocalMatrix } from '../vehicle/VehicleMath.js';
import { MODEL_UNIFORM_BYTES } from './ModelShader.js';
import { decodeAllTextures } from '../material/TextureImport.js';
import { aabbCenter } from '../../core/math/MathGeometry.js';
import { fnv1aStringCodePointHead32 } from '../../core/math/ChecksumMath.js';

/** A linear, repeating sampler — a sane default for model albedo. */
export function createDefaultSampler(device) {
  return device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
}

/** A 1×1 white texture so untextured primitives sample white (albedo = color). */
export function createWhiteTexture(device) {
  const tex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: tex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  return tex;
}

/** Upload one decoded bitmap to a GPU texture (sRGB for colour, linear for data). */
export function makeGpuTexture(device, bitmap, srgb) {
  const tex = device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height]);
  return tex;
}

/**
 * Decode + upload every embedded texture in a model.
 * @returns {Promise<{ texMap: Map<string, GPUTextureView>, created: GPUTexture[], decoded: number }>}
 */
export async function uploadModelTextures(device, model) {
  const decoded = await decodeAllTextures(model);
  const texMap = new Map();
  const created = [];
  for (const tx of model.textures || []) {
    if (!tx.bitmap) continue;
    const gt = makeGpuTexture(device, tx.bitmap, tx.colorSpace === 'srgb');
    created.push(gt);
    texMap.set(tx.id, gt.createView());
  }
  return { texMap, created, decoded };
}

/** Deterministic fallback colour for a primitive lacking a baseColorFactor. */
export function primitiveColor(model, prim) {
  const m = prim.material ? (model.materials || []).find((x) => x.id === prim.material) : null;
  const c = m?.baseColorFactor || m?.raw?.pbrMetallicRoughness?.baseColorFactor;
  if (c) return [c[0], c[1], c[2], c[3] ?? 1];
  const h = fnv1aStringCodePointHead32(prim.id);
  return [0.45 + 0.45 * ((h & 255) / 255), 0.45 + 0.45 * (((h >> 8) & 255) / 255), 0.45 + 0.45 * (((h >> 16) & 255) / 255), 1];
}

/**
 * Build drawable items for an uploaded model: one per primitive, each with its
 * world draw matrix, uniform buffer, bind group, fallback colour, and (optional)
 * wheel-spin descriptor keyed by node id.
 * @returns {Array<{prim, baseDraw:Float32Array, color:number[], uBuf:GPUBuffer, bind:GPUBindGroup, wheel:object|null}>}
 */
export function buildModelDrawables(device, model, opts) {
  const { pipeline, importMatrix = identity(), texMap = new Map(), sampler, fallbackTexture, wheelMap = null } = opts;
  if (!pipeline) throw new Error('buildModelDrawables: opts.pipeline is required');
  if (!sampler) throw new Error('buildModelDrawables: opts.sampler is required');
  if (!fallbackTexture) throw new Error('buildModelDrawables: opts.fallbackTexture (white view) is required');

  const world = computeWorldMatrices(model);
  const layout = pipeline.getBindGroupLayout(0);
  const out = [];

  const addPrim = (prim, draw, nodeId) => {
    if (!prim?.gpu) return;
    const uBuf = device.createBuffer({ size: MODEL_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const mat = prim.material ? (model.materials || []).find((x) => x.id === prim.material) : null;
    const texId = mat?.textures?.baseColor?.textureId;
    const view = (texId && texMap.get(texId)) || fallbackTexture;
    const bind = device.createBindGroup({ layout, entries: [
      { binding: 0, resource: { buffer: uBuf } },
      { binding: 1, resource: view },
      { binding: 2, resource: sampler },
    ] });
    out.push({ prim, baseDraw: draw, color: primitiveColor(model, prim), uBuf, bind, wheel: wheelMap?.get(nodeId) || null });
  };

  let drew = false;
  for (const n of model.nodes || []) {
    if (!n.mesh) continue;
    const mesh = (model.meshes || []).find((x) => x.id === n.mesh);
    if (!mesh) continue;
    const nodeDraw = multiply(importMatrix, world.get(n.id) || identity());
    for (const pid of mesh.primitives) {
      const prim = (model.primitives || []).find((p) => p.id === pid);
      // Baked-skinned primitives already hold scene-space verts (joint·IBM·v), so
      // they draw with importMatrix only — the node transform is part of the bake.
      const draw = prim && prim._skinnedBaked ? importMatrix : nodeDraw;
      addPrim(prim, draw, n.id); drew = true;
    }
  }
  // Fallback: a flat primitive list (e.g. STL/OBJ with no node graph).
  if (!drew) for (const prim of model.primitives || []) addPrim(prim, importMatrix, null);
  return out;
}

/** Axis-aligned bounds of a flat position array. */
function boundsOf(arr) {
  const mn = [Infinity, Infinity, Infinity]; const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) for (let c = 0; c < 3; c++) { const v = arr[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
  const bounds = { min: mn, max: mx, center: null, radius: 0 };
  bounds.center = aabbCenter(bounds);
  bounds.radius = Math.hypot(...mx.map((m, i) => m - bounds.center[i]));
  return bounds;
}

/**
 * CPU-skin every skinned mesh to its DEFAULT pose so the static viewer draws the
 * mesh wrapped around the node-hierarchy skeleton (per the glTF rule that a
 * skinned mesh's own node transform is ignored). For each skinned vertex:
 *   v' = Σ wⱼ · (jointNodeWorld(j) · inverseBindMatrix(j)) · v   (scene space)
 * Positions/normals are replaced in place (original kept on `_bindPosition`) and
 * the primitive is flagged `_skinnedBaked`. No-op without skins/IBMs. GPU-free.
 * @returns {number} primitives baked
 */
export function bakeSkinnedMeshes(model) {
  if (!model.skins?.length) return 0;
  const world = computeWorldMatrices(model);
  const bySkin = new Map((model.skins || []).map((s) => [s.id, s]));
  const byMesh = new Map((model.meshes || []).map((m) => [m.id, m]));
  const byPrim = new Map((model.primitives || []).map((p) => [p.id, p]));
  let baked = 0;

  for (const node of model.nodes || []) {
    if (!node.skin || !node.mesh) continue;
    const skin = bySkin.get(node.skin);
    const ibm = skin?.inverseBindMatrices;
    const joints = skin && (skin.joints || skin.raw?.joints);
    const mesh = byMesh.get(node.mesh);
    if (!ibm || !joints || !mesh) continue;

    // jointMatrix[j] = jointNodeWorld(j) · IBM(j)  → maps bind verts to scene.
    const jmats = joints.map((nodeIdx, j) => {
      const jw = world.get(`node:${nodeIdx}`) || identity();
      const seg = ibm.subarray ? ibm.subarray(j * 16, j * 16 + 16) : ibm.slice(j * 16, j * 16 + 16);
      return multiply(jw, seg);
    });

    for (const pid of mesh.primitives) {
      const prim = byPrim.get(pid);
      const pos = prim?.attributes?.position; const jnt = prim?.attributes?.joints; const wgt = prim?.attributes?.weights;
      if (!pos || !jnt || !wgt || prim._skinnedBaked) continue;
      const nIn = prim.attributes.normal && prim.attributes.normal.length === pos.length ? prim.attributes.normal : null;
      const vc = pos.length / 3;
      const out = new Float32Array(pos.length);
      const nOut = nIn ? new Float32Array(nIn.length) : null;
      for (let v = 0; v < vc; v++) {
        const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
        let ox = 0, oy = 0, oz = 0, nx = 0, ny = 0, nz = 0, wsum = 0;
        for (let k = 0; k < 4; k++) {
          const w = wgt[v * 4 + k]; if (w <= 0) continue;
          const m = jmats[jnt[v * 4 + k]]; if (!m) continue;
          wsum += w;
          ox += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
          oy += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
          oz += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
          if (nIn) {
            const ix = nIn[v * 3], iy = nIn[v * 3 + 1], iz = nIn[v * 3 + 2];
            nx += w * (m[0] * ix + m[4] * iy + m[8] * iz);
            ny += w * (m[1] * ix + m[5] * iy + m[9] * iz);
            nz += w * (m[2] * ix + m[6] * iy + m[10] * iz);
          }
        }
        if (wsum > 1e-6) { out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz; }
        else { out[v * 3] = px; out[v * 3 + 1] = py; out[v * 3 + 2] = pz; }
        if (nOut) { const l = Math.hypot(nx, ny, nz) || 1; nOut[v * 3] = nx / l; nOut[v * 3 + 1] = ny / l; nOut[v * 3 + 2] = nz / l; }
      }
      prim._bindPosition = prim._bindPosition || pos; // keep original for recovery/regen
      prim.attributes.position = out;
      if (nOut) prim.attributes.normal = nOut;
      prim.bounds = boundsOf(out); // scene-space bounds → correct camera framing
      prim._skinnedBaked = true;
      baked++;
    }
  }
  return baked;
}

/** Free per-item uniform buffers built by buildModelDrawables. */
export function releaseDrawables(items) {
  for (const it of items || []) it.uBuf?.destroy?.();
}

/**
 * World-space bounds of a set of drawables, for camera framing.
 * @returns {{ center:number[], radius:number, min:number[], max:number[] }|null}
 */
export function frameBounds(items) {
  let min = [Infinity, Infinity, Infinity]; let max = [-Infinity, -Infinity, -Infinity]; let any = false;
  for (const it of items || []) {
    const b = it.prim.bounds; if (!b) continue; any = true;
    for (let i = 0; i < 8; i++) {
      const corner = [(i & 1) ? b.max[0] : b.min[0], (i & 2) ? b.max[1] : b.min[1], (i & 4) ? b.max[2] : b.min[2]];
      const w = transformPoint(it.baseDraw, corner);
      for (let c = 0; c < 3; c++) { if (w[c] < min[c]) min[c] = w[c]; if (w[c] > max[c]) max[c] = w[c]; }
    }
  }
  if (!any) return null;
  const bounds = { center: null, radius: 0, min, max };
  bounds.center = aabbCenter(bounds);
  bounds.radius = Math.max(0.1, Math.hypot(max[0] - bounds.center[0], max[1] - bounds.center[1], max[2] - bounds.center[2]));
  return bounds;
}

/** Compose the standard import-correction matrix from a model's importTransform. */
export function importMatrixOf(model) {
  const it = model.importTransform || {};
  return composeTRS(it.originCorrection, it.axisCorrection || [0, 0, 0, 1], it.scaleCorrection || 1);
}

export { nodeLocalMatrix };
