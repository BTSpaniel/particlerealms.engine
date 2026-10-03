// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ensureColorAttachmentResource } from "./ClearPass.js";

export function addLightingPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addLightingPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "lighting_main";
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
      const lighting = context && context.lighting;

      if (!device) {
        throw new Error("LightingPass.execute: context.device is required");
      }

      if (!canvasSurface || !canvasSurface.context) {
        throw new Error(
          "LightingPass.execute: context.canvasSurface with a WebGPU context is required"
        );
      }

      if (!lighting || !lighting.pipeline) {
        // Nothing to shade this frame.
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

      renderPass.setPipeline(lighting.pipeline);

      const bindGroups = Array.isArray(lighting.bindGroups)
        ? lighting.bindGroups
        : [];
      for (let i = 0; i < bindGroups.length; i++) {
        const group = bindGroups[i];
        if (group) {
          renderPass.setBindGroup(i, group);
        }
      }

      const vertexCount =
        typeof lighting.vertexCount === "number" && lighting.vertexCount > 0
          ? lighting.vertexCount
          : 3;
      const instanceCount =
        typeof lighting.instanceCount === "number" && lighting.instanceCount > 0
          ? lighting.instanceCount
          : 1;
      const firstVertex = lighting.firstVertex | 0;
      const firstInstance = lighting.firstInstance | 0;

      if (lighting.vertexBuffer) {
        renderPass.setVertexBuffer(0, lighting.vertexBuffer);
      }

      renderPass.draw(vertexCount, instanceCount, firstVertex, firstInstance);

      renderPass.end();

      if (!externalEncoder) {
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
      }
    },
  });
}

export { addLightingPass as LightingPass };
