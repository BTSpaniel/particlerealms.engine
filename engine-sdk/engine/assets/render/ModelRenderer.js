// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/render/ModelRenderer.js — the batteries-included way to draw an
// EngineModel. It composes the small render modules (ModelShader + ModelGpu) and
// the vehicle wheel-spin helper, applying sensible DEFAULTS so any engine system
// can go from "I have an EngineModel" to "it's on screen" in two calls:
//
//   const r = createModelRenderer(device, { format });
//   await r.setModel(model, { wheelSpin: true, rig });   // upload + drawables
//   // per frame: r.render(pass, { mvp, eye, distance });
//
// The caller still owns the render pass + camera (so it slots into any pipeline);
// the renderer owns the model's GPU lifetime and offers a depth-texture + camera-
// framing convenience. Override the shader/format/cull via opts when needed.

import { createModelPipeline, MODEL_UNIFORM_FLOATS } from './ModelShader.js';
import {
  createDefaultSampler, createWhiteTexture, uploadModelTextures,
  buildModelDrawables, releaseDrawables, frameBounds, importMatrixOf, bakeSkinnedMeshes,
} from './ModelGpu.js';
import { uploadModel, releaseModelGpu } from '../import/GpuUploader.js';
import { multiply, identity } from '../vehicle/VehicleMath.js';
import { pivotSpin, rollAngle, buildWheelSpinMap } from '../vehicle/WheelSpinVisual.js';

export function createModelRenderer(device, opts = {}) {
  if (!device) throw new Error('createModelRenderer: device is required');
  const { pipeline, shader, depthFormat } = createModelPipeline(device, opts);
  const sampler = opts.sampler ?? createDefaultSampler(device);
  const whiteTex = createWhiteTexture(device);
  const whiteView = whiteTex.createView();
  const u = new Float32Array(MODEL_UNIFORM_FLOATS);

  let model = null;
  let items = [];
  let createdTex = [];
  let importMatrix = identity();
  let wheelMap = null;
  let depthTex = null;
  let depthView = null;

  function releaseModel() {
    releaseDrawables(items);
    items = [];
    for (const t of createdTex) t.destroy?.();
    createdTex = [];
    if (model) releaseModelGpu(model);
    model = null;
    wheelMap = null;
  }

  /**
   * Adopt a model: upload GPU buffers + textures, build drawables, optionally
   * build a wheel-spin map. Replaces any previous model.
   * @param {object} m EngineModel
   * @param {object} [o] { importMatrix?, upload=true, wheelSpin=false, rig?, wheelMap? }
   * @returns {Promise<{ drawables:number, textures:number, decoded:number }>}
   */
  async function setModel(m, o = {}) {
    releaseModel();
    model = m;
    // Skinned characters: CPU-skin to the default pose so the mesh wraps the
    // node-hierarchy skeleton (must run BEFORE GPU upload, mutates positions).
    bakeSkinnedMeshes(m);
    if (o.upload !== false && !m.gpuReady) uploadModel(device, m);
    importMatrix = o.importMatrix || importMatrixOf(m);
    const { texMap, created, decoded } = await uploadModelTextures(device, m);
    createdTex = created;
    wheelMap = o.wheelMap || (o.wheelSpin && o.rig ? buildWheelSpinMap(m, importMatrix, o.rig) : null);
    items = buildModelDrawables(device, m, { pipeline, importMatrix, texMap, sampler, fallbackTexture: whiteView, wheelMap });
    return { drawables: items.length, textures: texMap.size, decoded };
  }

  /** World-space bounds of the current model for camera framing (or null). */
  function frame() { return frameBounds(items); }

  /** Lazily (re)allocate a depth texture matching the target size; returns its view. */
  function ensureDepth(width, height) {
    if (!depthTex || depthTex.width !== width || depthTex.height !== height) {
      depthTex?.destroy();
      depthTex = device.createTexture({ size: [width, height], format: depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      depthView = depthTex.createView();
    }
    return depthView;
  }

  /**
   * Draw every drawable into an open render pass.
   * @param {GPURenderPassEncoder} pass
   * @param {object} cam { mvp:Float32Array, eye:number[], distance?:number, steer?:number }
   *   distance = metres rolled (drives wheel spin); steer = front-wheel yaw radians.
   */
  function render(pass, cam) {
    if (!items.length) return;
    const { mvp, eye, distance = 0, steer = 0 } = cam;
    pass.setPipeline(pipeline);
    for (const it of items) {
      // Wheel transforms are built in MESH-LOCAL space and applied BEFORE baseDraw
      // (draw = baseDraw · steer · roll), so the node hierarchy + import correction
      // carry them to the correct world hub/axle automatically (Unity/Godot style).
      // Steer (yaw about the steer axis) is the OUTER rotation so it also turns the
      // roll axle; roll (about the axle) is inner.
      let draw = it.baseDraw;
      if (it.wheel) {
        let spin = pivotSpin(it.wheel.pivot, it.wheel.axle, rollAngle(distance, it.wheel.radius));
        if (it.wheel.steer && steer) {
          spin = multiply(pivotSpin(it.wheel.pivot, it.wheel.steerAxis, steer), spin);
        }
        draw = multiply(it.baseDraw, spin);
      }
      u.set(multiply(mvp, draw), 0);
      u.set(draw, 16);
      u.set(it.color, 32);
      u.set([eye[0], eye[1], eye[2], 1], 36);
      device.queue.writeBuffer(it.uBuf, 0, u);
      pass.setBindGroup(0, it.bind);
      pass.setVertexBuffer(0, it.prim.gpu.vertexBuffer);
      if (it.prim.gpu.indexBuffer) {
        pass.setIndexBuffer(it.prim.gpu.indexBuffer, it.prim.gpu.indexFormat);
        pass.drawIndexed(it.prim.gpu.indexCount);
      } else {
        pass.draw(it.prim.gpu.vertexCount);
      }
    }
  }

  /** Release everything (model + depth + shared defaults). */
  function dispose() {
    releaseModel();
    depthTex?.destroy();
    whiteTex.destroy();
  }

  return {
    pipeline, shader, depthFormat,
    setModel, frame, ensureDepth, render, releaseModel, dispose,
    get model() { return model; },
    get items() { return items; },
    get importMatrix() { return importMatrix; },
    get wheelMap() { return wheelMap; },
    get drawableCount() { return items.length; },
  };
}
