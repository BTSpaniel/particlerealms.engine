// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DrawHelpers - Common WebGPU draw utilities
 * Now powered by vGPU driver
 */

import { initVGPU } from '../core/gpu/VirtualGPU.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _viewProjData = new Float32Array(16);
const _smokeFrameData = new Float32Array(56);

/**
 * Draw a mesh with the given bind group and uniforms.
 */
export function drawMesh(pass, mesh, bindGroup) {
  if (!mesh || !bindGroup) return;
  
  pass.setVertexBuffer(0, mesh.vertexBuffer);
  pass.setBindGroup(0, bindGroup);

  const culler = mesh.indexedClusterCuller;
  if (culler && culler.hasGeometry && culler.hasGeometry() && culler.dstIndicesBuffer && culler.indirectBuffer) {
    pass.setIndexBuffer(culler.dstIndicesBuffer, "uint32");
    pass.drawIndexedIndirect(culler.indirectBuffer, 0);
    return;
  }
  
  if (mesh.indexBuffer) {
    pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat || "uint16");
    pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
  } else {
    pass.draw(mesh.vertexCount, 1, 0, 0);
  }
}

export function encodeIndexedMeshClusterCulling(commandEncoder, viewProj, meshes) {
  if (!commandEncoder || !viewProj || !meshes) return;
  const list = Array.isArray(meshes) ? meshes : [meshes];
  for (let i = 0; i < list.length; i++) {
    const mesh = list[i];
    const culler = mesh && mesh.indexedClusterCuller;
    if (!culler || typeof culler.encodeCulling !== "function") continue;
    culler.encodeCulling(commandEncoder, viewProj);
  }
}

/**
 * Draw multiple meshes efficiently.
 */
export function drawMeshes(pass, meshEntries) {
  for (const entry of meshEntries) {
    if (!entry.mesh || !entry.bindGroup) continue;
    drawMesh(pass, entry.mesh, entry.bindGroup);
  }
}

/**
 * Create a render pass with standard settings.
 */
export function beginStandardRenderPass(encoder, options) {
  const { swapView, depthView, clearColor, label } = options;
  
  return encoder.beginRenderPass({
    label: label || "StandardRenderPass",
    colorAttachments: [{
      view: swapView,
      clearValue: clearColor || { r: 0.03, g: 0.03, b: 0.06, a: 1.0 },
      loadOp: "clear",
      storeOp: "store",
    }],
    depthStencilAttachment: depthView ? {
      view: depthView,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    } : undefined,
  });
}

/**
 * Ensure depth texture matches canvas size, recreating if needed.
 */
export function ensureDepthTexture(device, current, width, height) {
  if (current && current.width === width && current.height === height) {
    return { texture: current, view: current.createView(), recreated: false };
  }
  
  if (current) current.destroy();
  
  const vgpu = initVGPU(device);
  const texture = vgpu.texture.create({
    width, height, format: 'depth24plus',
    usage: 'render|texture', label: 'DepthTexture'
  }).texture;
  
  return { texture, view: texture.createView(), recreated: true };
}

/**
 * Ensure scene color texture matches canvas size, recreating if needed.
 * Used for screen-space water refraction which needs to sample the rendered scene.
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUTexture} current - Current scene color texture (or null)
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {string} format - Texture format (default: 'bgra8unorm')
 * @returns {{ texture: GPUTexture, view: GPUTextureView, recreated: boolean }}
 */
export function ensureSceneColorTexture(device, current, width, height, format = "bgra8unorm") {
  if (current && current.width === width && current.height === height) {
    return { texture: current, view: current.createView(), recreated: false };
  }
  
  if (current) current.destroy();
  
  const vgpu = initVGPU(device);
  const texture = vgpu.texture.create({
    width, height, format, usage: 'render|texture|copy-src',
    label: 'SceneColorTexture'
  }).texture;
  
  return { texture, view: texture.createView(), recreated: true };
}

/**
 * Build viewProj matrix data for a frame buffer.
 */
export function buildViewProjData(projection, view, multiply, out = null) {
  const viewProj = multiply(projection, view);
  const data = out || _viewProjData; // Reuse buffer if no output provided
  for (let i = 0; i < 16; i++) data[i] = viewProj[i];
  return data;
}

/**
 * Render particle billboards or points in an existing render pass.
 * Automatically detects point-list vs triangle-list topology.
 * @param {GPURenderPassEncoder} renderPass - Active render pass
 * @param {Object} particles - Particle state object with pipeline, frameBuffer, etc.
 * @param {Object} options - { projection, view, updateBuffer, mat4Multiply, getCameraEyeBasis }
 */
export function renderParticleBillboards(renderPass, particles, options) {
  const { projection, view, updateBuffer, mat4Multiply, getCameraEyeBasis } = options;
  const logger = options.logger;

  const chunks = particles && Array.isArray(particles.chunks) ? particles.chunks : null;
  if (chunks && chunks.length > 0) {
    if (!particles.pipeline || !particles.frameBuffer || !particles.frameBindGroup) {
      return false;
    }

    if (projection[0] === 1 && projection[5] === 1 && projection[10] === 1 && projection[15] === 1) {
      return false;
    }

    const frameData = particles._frameData || (particles._frameData = new Float32Array(24));
    const viewProj = mat4Multiply(projection, view);
    for (let i = 0; i < 16; i++) frameData[i] = viewProj[i];

    let vr0 = view[0], vr1 = view[4], vr2 = view[8];
    let vu0 = view[1], vu1 = view[5], vu2 = view[9];

    if (getCameraEyeBasis && typeof getCameraEyeBasis === "function") {
      const eyeBasis = getCameraEyeBasis();
      if (eyeBasis) {
        const r = eyeBasis.right;
        const u = eyeBasis.up;
        if (r) { vr0 = r[0]; vr1 = r[1]; vr2 = r[2]; }
        if (u) { vu0 = u[0]; vu1 = u[1]; vu2 = u[2]; }
      }
    }

    frameData[16] = vr0;
    frameData[17] = vr1;
    frameData[18] = vr2;
    frameData[19] = 0;
    frameData[20] = vu0;
    frameData[21] = vu1;
    frameData[22] = vu2;
    frameData[23] = 0;

    updateBuffer(options.device, particles.frameBuffer, frameData, 0);

    renderPass.setPipeline(particles.pipeline);
    renderPass.setBindGroup(0, particles.frameBindGroup);
    const vpi = typeof particles.verticesPerInstance === 'number' ? (particles.verticesPerInstance | 0) : 6;

    let anyRendered = false;
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      if (!chunk) continue;

      const instanceCount = typeof chunk.activeInstanceCount === 'number'
        ? (chunk.activeInstanceCount | 0)
        : (chunk.instanceCount | 0);

      if (!chunk.world || !chunk.dataBindGroup || instanceCount <= 0) {
        continue;
      }

      renderPass.setBindGroup(1, chunk.dataBindGroup);
      renderPass.draw(Math.max(1, vpi), instanceCount, 0, 0);
      anyRendered = true;
    }

    return anyRendered;
  }
  
  const instanceCount = typeof particles.activeInstanceCount === 'number'
    ? (particles.activeInstanceCount | 0)
    : (particles.instanceCount | 0);

  if (!particles.world || !particles.pipeline || !particles.frameBuffer ||
      !particles.frameBindGroup || !particles.dataBindGroup || instanceCount <= 0) {
    return false;
  }
  
  // Skip rendering if projection matrix is identity (first frame before camera initialized)
  // This prevents particles rendering at wrong positions when matrices aren't set up
  if (projection[0] === 1 && projection[5] === 1 && projection[10] === 1 && projection[15] === 1) {
    return false;
  }
  
  // Build frame uniform: viewProj (mat4) + viewRight (vec3+pad) + viewUp (vec3+pad) = 24 floats = 96 bytes
  const frameData = particles._frameData || (particles._frameData = new Float32Array(24));
  const viewProj = mat4Multiply(projection, view);
  for (let i = 0; i < 16; i++) frameData[i] = viewProj[i];
  
  // Extract camera right and up vectors for billboarding
  // These come from the inverse of the view matrix's rotation part
  // For a standard view matrix, columns 0,1,2 are right, up, forward in camera space
  // We need them in world space, so we use the transpose (first 3 rows)
  let vr0 = view[0], vr1 = view[4], vr2 = view[8];
  let vu0 = view[1], vu1 = view[5], vu2 = view[9];
  
  // Optionally use getCameraEyeBasis if available for more accurate vectors
  if (getCameraEyeBasis && typeof getCameraEyeBasis === "function") {
    const eyeBasis = getCameraEyeBasis();
    if (eyeBasis) {
      const r = eyeBasis.right;
      const u = eyeBasis.up;
      if (r) { vr0 = r[0]; vr1 = r[1]; vr2 = r[2]; }
      if (u) { vu0 = u[0]; vu1 = u[1]; vu2 = u[2]; }
    }
  }
  
  // viewRight at offset 16 (vec3 + 1 pad)
  frameData[16] = vr0;
  frameData[17] = vr1;
  frameData[18] = vr2;
  frameData[19] = 0; // padding
  
  // viewUp at offset 20 (vec3 + 1 pad)
  frameData[20] = vu0;
  frameData[21] = vu1;
  frameData[22] = vu2;
  frameData[23] = 0; // padding
  
  updateBuffer(options.device, particles.frameBuffer, frameData, 0);
  
  // Render particles - billboards use 6 vertices per particle
  renderPass.setPipeline(particles.pipeline);
  renderPass.setBindGroup(0, particles.frameBindGroup);
  renderPass.setBindGroup(1, particles.dataBindGroup);
  const vpi = typeof particles.verticesPerInstance === 'number' ? (particles.verticesPerInstance | 0) : 6;
  renderPass.draw(Math.max(1, vpi), instanceCount, 0, 0);
  
  return true;
}

// Throttle for smoke render logging
let _lastSmokeRenderLogTime = 0;

/**
 * Render volumetric smoke in a separate pass after the main render pass.
 * @param {GPUCommandEncoder} encoder - Command encoder
 * @param {GPUTextureView} swapView - Swap chain texture view
 * @param {Object} smoke - Smoke state object
 * @param {Object} options - { projection, view, depthTextureView, getCameraEyeBasis, canvas, updateBuffer, mat4Multiply, mat4Inverse, logger }
 * @returns {boolean} Whether smoke was rendered
 */
export function renderVolumetricSmoke(encoder, swapView, smoke, options) {
  const { 
    projection, view, depthTextureView, getCameraEyeBasis, canvas,
    updateBuffer, mat4Multiply, mat4Inverse, device, smokeParams, logger
  } = options;
  
  if (!smoke.fluidWorld || !smoke.pipeline || !smoke.frameBuffer ||
      !smoke.frameBindGroup || !smoke.dataBindGroup || !depthTextureView ||
      !smoke.worldMin || !smoke.worldMax) {
    return false;
  }
  
  // ==========================================================================
  // MATRIX SETUP FOR VOLUMETRIC SMOKE (WORKING - DO NOT MODIFY WITHOUT TESTING)
  // ==========================================================================
  //
  // Critical: Skip first frame when projection is identity (camera not yet initialized)
  // Identity matrices cause invViewProj to also be identity, resulting in garbage rays
  // that make smoke appear attached to canvas instead of world space.
  //
  if (projection[0] === 1 && projection[5] === 1 && projection[10] === 1 && projection[15] === 1) {
    return false;
  }
  
  // Build combined view-projection and its inverse for screen→world unprojection
  const viewProj = mat4Multiply(projection, view);
  const invViewProj = mat4Inverse(viewProj);
  const invView = mat4Inverse(view);
  const frameData = _smokeFrameData; // Reuse module-level buffer
  
  // viewProj (16 floats) - transforms world→clip space
  for (let i = 0; i < 16; i++) frameData[i] = viewProj[i];
  // invViewProj (16 floats) - transforms clip→world space (used by shader for ray calculation)
  for (let i = 0; i < 16; i++) frameData[16 + i] = invViewProj[i];
  
  // ==========================================================================
  // CAMERA POSITION EXTRACTION (CRITICAL FOR CORRECT WORLD-SPACE RAYS)
  // ==========================================================================
  //
  // Extract camera position from inverse view matrix to GUARANTEE consistency
  // with the matrices used for ray calculation. This is essential because:
  //
  // 1. The shader computes: rayDir = normalize(invViewProj * clipPos - cameraPos)
  // 2. If cameraPos doesn't match the view matrix's camera position, rays will be wrong
  // 3. The inverse view matrix's translation column (12,13,14) contains the world-space
  //    camera position that was used to build the original view matrix
  //
  // Previously used getCameraEyeBasis() which could return inconsistent values,
  // causing smoke to "track with camera" instead of staying fixed in world space.
  //
  const eye = [invView[12], invView[13], invView[14]];
  
  // Get camera basis vectors for other uniforms (direction, right, up)
  const eyeBasis = getCameraEyeBasis();
  const fwd = eyeBasis?.forward || [0, 0, -1];
  const right = eyeBasis?.right || [1, 0, 0];
  const up = eyeBasis?.up || [0, 1, 0];
  
  frameData[32] = eye[0];
  frameData[33] = eye[1];
  frameData[34] = eye[2];
  frameData[35] = performance.now() * 0.001;
  
  const densityScale = smokeParams && typeof smokeParams.densityScale === "number"
    ? smokeParams.densityScale
    : 0.5;
  const extinction = smokeParams && typeof smokeParams.extinction === "number"
    ? smokeParams.extinction
    : 2.0;

  frameData[36] = smoke.worldMin[0];
  frameData[37] = smoke.worldMin[1];
  frameData[38] = smoke.worldMin[2];
  frameData[39] = densityScale;
  
  frameData[40] = smoke.worldMax[0];
  frameData[41] = smoke.worldMax[1];
  frameData[42] = smoke.worldMax[2];
  frameData[43] = extinction;
  
  const tanFovY = 1 / projection[5];
  const aspect = canvas.width / canvas.height;
  
  frameData[44] = fwd[0];
  frameData[45] = fwd[1];
  frameData[46] = fwd[2];
  frameData[47] = tanFovY;
  
  frameData[48] = right[0];
  frameData[49] = right[1];
  frameData[50] = right[2];
  frameData[51] = aspect;
  
  frameData[52] = up[0];
  frameData[53] = up[1];
  frameData[54] = up[2];
  // frameData[55] unused (was particleCount, now color is in grid)

  // Comprehensive transform pipeline tracing
  const now = performance.now();
  if (logger && typeof logger.addSnapshot === "function" && now - _lastSmokeRenderLogTime > 500) {
    _lastSmokeRenderLogTime = now;
    
    // Compute volume center in world space
    const volumeCenter = [
      0.5 * (smoke.worldMin[0] + smoke.worldMax[0]),
      0.5 * (smoke.worldMin[1] + smoke.worldMax[1]),
      0.5 * (smoke.worldMin[2] + smoke.worldMax[2]),
    ];
    
    // Transform volume center through full pipeline to verify
    const vcx = volumeCenter[0], vcy = volumeCenter[1], vcz = volumeCenter[2];
    const clipX = viewProj[0]*vcx + viewProj[4]*vcy + viewProj[8]*vcz + viewProj[12];
    const clipY = viewProj[1]*vcx + viewProj[5]*vcy + viewProj[9]*vcz + viewProj[13];
    const clipZ = viewProj[2]*vcx + viewProj[6]*vcy + viewProj[10]*vcz + viewProj[14];
    const clipW = viewProj[3]*vcx + viewProj[7]*vcy + viewProj[11]*vcz + viewProj[15];
    const ndcX = clipW !== 0 ? clipX / clipW : 0;
    const ndcY = clipW !== 0 ? clipY / clipW : 0;
    const ndcZ = clipW !== 0 ? clipZ / clipW : 0;
    const screenX = (ndcX * 0.5 + 0.5) * canvas.width;
    const screenY = (1.0 - (ndcY * 0.5 + 0.5)) * canvas.height;
    
    // Extract projection matrix components for analysis
    const projData = {
      m00: projection[0],  // 1/(aspect*tan(fov/2))
      m11: projection[5],  // 1/tan(fov/2)
      m22: projection[10], // (far+near)/(near-far) for OpenGL, far/(near-far) for WebGPU
      m23: projection[11], // -1 for OpenGL perspective
      m32: projection[14], // 2*far*near/(near-far) for OpenGL
      m33: projection[15], // 0 for perspective
    };
    
    // Check if projection is OpenGL-style or WebGPU-style based on m22/m32 ratio
    // OpenGL: m22 = (far+near)/(near-far), m32 = 2*far*near/(near-far) => m32/m22 = 2*far*near/(far+near)
    // WebGPU: m22 = far/(near-far), m32 = far*near/(near-far) => m32/m22 = near
    // For OpenGL with near=0.1, far=200: m32/m22 = 2*200*0.1/(200.1) ≈ 0.2
    // For WebGPU with near=0.1: m32/m22 = 0.1
    const m22 = projection[10];
    const m32 = projection[14];
    const ratio = m32 !== 0 ? Math.abs(m32 / m22) : 0;
    // If ratio is close to near (typically 0.1), it's WebGPU style
    // If ratio is close to 2*near, it's OpenGL style
    const isWebGPUStyle = ratio > 0 && ratio < 0.15;  // Near is usually 0.1
    const isOpenGLStyle = ratio > 0.15 && ratio < 0.3;
    const projectionStyle = isWebGPUStyle ? "WebGPU [0,1]" : isOpenGLStyle ? "OpenGL [-1,1]" : "Unknown";
    
    logger.addSnapshot("RENDER.SmokeTransform", {
      // Projection matrix analysis
      projectionStyle,
      projectionM22M32Ratio: ratio,
      projectionDiag: projData,
      tanFovY,
      aspect,
      canvasSize: [canvas.width, canvas.height],
      
      // Camera basis vectors (world space)
      cameraEye: eye,
      cameraFwd: fwd,
      cameraRight: right,
      cameraUp: up,
      
      // Volume bounds (world space)
      volumeMin: smoke.worldMin,
      volumeMax: smoke.worldMax,
      volumeCenter,
      volumeSize: [
        smoke.worldMax[0] - smoke.worldMin[0],
        smoke.worldMax[1] - smoke.worldMin[1],
        smoke.worldMax[2] - smoke.worldMin[2],
      ],
      
      // Transform pipeline for volume center
      clipSpace: [clipX, clipY, clipZ, clipW],
      ndcSpace: [ndcX, ndcY, ndcZ],
      screenSpace: [screenX, screenY],
      
      // Verify NDC Z range (should be 0-1 for WebGPU, -1 to 1 for OpenGL)
      ndcZRange: ndcZ < 0 ? "NEGATIVE (OpenGL near)" : ndcZ > 1 ? "OVER 1 (behind far)" : "0-1 (valid WebGPU)",
      
      // Frame uniform buffer layout verification
      uniformLayout: {
        viewProj_offset: 0,
        invViewProj_offset: 16,
        cameraPos_offset: 32,
        time_offset: 35,
        volumeMin_offset: 36,
        densityScale_offset: 39,
        volumeMax_offset: 40,
        extinction_offset: 43,
        cameraFwd_offset: 44,
        tanFovY_offset: 47,
        cameraRight_offset: 48,
        aspect_offset: 51,
        cameraUp_offset: 52,
      },
      
      // Smoke params
      densityScale,
      extinction,
    });
  }
  
  updateBuffer(device, smoke.frameBuffer, frameData, 0);
  
  // Create depth bind group
  const depthLayout = smoke.pipeline.getBindGroupLayout(2);
  smoke.depthBindGroup = device.createBindGroup({
    layout: depthLayout,
    entries: [{ binding: 0, resource: depthTextureView }],
  });
  
  const smokePass = encoder.beginRenderPass({
    label: "VolumeSmokePass",
    colorAttachments: [{
      view: swapView,
      loadOp: "load",
      storeOp: "store",
    }],
  });
  
  smokePass.setPipeline(smoke.pipeline);
  smokePass.setBindGroup(0, smoke.frameBindGroup);
  smokePass.setBindGroup(1, smoke.dataBindGroup);  // Includes density + color + grid
  smokePass.setBindGroup(2, smoke.depthBindGroup);
  smokePass.draw(3, 1, 0, 0);
  smokePass.end();
  
  return true;
}
