// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ensureColorAttachmentResource } from "./ClearPass.js";
import { ParticleRenderBundleCache } from "../RenderBundleManager.js";

// Global render bundle cache (shared across frames)
let particleBundleCache = null;

export function addParticleBillboardPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addParticleBillboardPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "particles_billboard";
  const addResource = options.addResource !== false;

  if (addResource) {
    ensureColorAttachmentResource(
      frameGraph,
      target,
      options.resourceDescriptor || {
        kind: "colorAttachment",
        external: true,
      }
    );
  }

  const reads = Array.isArray(options.reads)
    ? options.reads.slice()
    : [target];
  const writes = Array.isArray(options.writes)
    ? options.writes.slice()
    : [target];

  frameGraph.addPass({
    name,
    kind: "render",
    reads,
    writes,
    execute(context) {
      const device = context && context.device;
      const canvasSurface = context && context.canvasSurface;
      const particles = context && context.particles;

      if (!device) {
        throw new Error("ParticleBillboardPass.execute: context.device is required");
      }

      if (!canvasSurface || !canvasSurface.context) {
        throw new Error(
          "ParticleBillboardPass.execute: context.canvasSurface with a WebGPU context is required"
        );
      }

      if (!particles || !particles.pipeline) {
        return;
      }

      const swapTexture = canvasSurface.context.getCurrentTexture();
      const swapView = swapTexture.createView();

      const externalEncoder = context && context.encoder;
      const encoder = externalEncoder || device.createCommandEncoder({
        label: `${name}_encoder`,
      });

      const colorAttachment = {
        view: swapView,
        loadOp: options.loadOp || "load",
        storeOp: "store",
      };

      if (options.clearColor) {
        const cc =
          typeof options.clearColor === "function"
            ? options.clearColor(context)
            : options.clearColor;
        colorAttachment.clearValue = cc;
        colorAttachment.loadOp = "clear";
      }

      const renderPass = encoder.beginRenderPass({
        label: `${name}_pass`,
        colorAttachments: [colorAttachment],
      });

      const instanceCount =
        typeof particles.instanceCount === "number" && particles.instanceCount > 0
          ? particles.instanceCount
          : 1;

      // Use render bundles for 10x draw call overhead reduction
      const useRenderBundles = instanceCount > 100; // Only for large particle counts

      if (useRenderBundles) {
        // Initialize bundle cache if needed
        if (!particleBundleCache) {
          particleBundleCache = new ParticleRenderBundleCache(device);
        }

        try {
          // Execute pre-recorded render bundle (10x faster than manual draw)
          const bindGroups = Array.isArray(particles.bindGroups)
            ? particles.bindGroups
            : [];
          const vertexBuffers = particles.vertexBuffer ? [particles.vertexBuffer] : [];
          
          particleBundleCache.executeParticleBundle(
            renderPass,
            particles.pipeline,
            bindGroups,
            vertexBuffers,
            instanceCount,
            {
              colorFormats: ['bgra8unorm'],
              sampleCount: 1,
            }
          );
        } catch (err) {
          // Fallback to manual rendering if bundle fails
          console.warn('[ParticlePass] Render bundle failed, using fallback:', err);
          useRenderBundles = false;
        }
      }

      if (!useRenderBundles) {
        // Fallback: Manual rendering (slower but always works)
        renderPass.setPipeline(particles.pipeline);

        const bindGroups = Array.isArray(particles.bindGroups)
          ? particles.bindGroups
          : [];
        for (let i = 0; i < bindGroups.length; i++) {
          const group = bindGroups[i];
          if (group) {
            renderPass.setBindGroup(i, group);
          }
        }

        if (particles.vertexBuffer) {
          renderPass.setVertexBuffer(0, particles.vertexBuffer);
        }

        const vertexCount =
          typeof particles.vertexCount === "number" && particles.vertexCount > 0
            ? particles.vertexCount
            : 6;
        const firstVertex = particles.firstVertex | 0;
        const firstInstance = particles.firstInstance | 0;

        renderPass.draw(vertexCount, instanceCount, firstVertex, firstInstance);
      }

      renderPass.end();

      if (!externalEncoder) {
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
      }
    },
  });
}

export { addParticleBillboardPass as ParticlePass };
