// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ensureColorAttachmentResource } from "./ClearPass.js";

export function addFluidDebugPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addFluidDebugPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "fluid_debug";
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
      const fluids = context && context.fluids;

      if (!device) {
        throw new Error("FluidDebugPass.execute: context.device is required");
      }

      if (!canvasSurface || !canvasSurface.context) {
        throw new Error(
          "FluidDebugPass.execute: context.canvasSurface with a WebGPU context is required"
        );
      }

      if (!fluids || !fluids.pipeline) {
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

      renderPass.setPipeline(fluids.pipeline);

      const bindGroups = Array.isArray(fluids.bindGroups)
        ? fluids.bindGroups
        : [];
      for (let i = 0; i < bindGroups.length; i++) {
        const group = bindGroups[i];
        if (group) {
          renderPass.setBindGroup(i, group);
        }
      }

      if (fluids.vertexBuffer) {
        renderPass.setVertexBuffer(0, fluids.vertexBuffer);
      }

      const vertexCount =
        typeof fluids.vertexCount === "number" && fluids.vertexCount > 0
          ? fluids.vertexCount
          : 3;
      const instanceCount =
        typeof fluids.instanceCount === "number" && fluids.instanceCount > 0
          ? fluids.instanceCount
          : 1;
      const firstVertex = fluids.firstVertex | 0;
      const firstInstance = fluids.firstInstance | 0;

      renderPass.draw(vertexCount, instanceCount, firstVertex, firstInstance);

      renderPass.end();

      if (!externalEncoder) {
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
      }
    },
  });
}

export { addFluidDebugPass as FluidDebugPass };
