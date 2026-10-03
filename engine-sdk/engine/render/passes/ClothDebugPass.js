// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ensureColorAttachmentResource } from "./ClearPass.js";

export function addClothDebugPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addClothDebugPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "cloth_debug";
  const addResource = options.addResource !== false;

  if (addResource) {
    ensureColorAttachmentResource(
      frameGraph,
      target,
      options.resourceDescriptor || {
        kind: "colorAttachment",
        external: true,
      },
    );
  }

  const reads = Array.isArray(options.reads) ? options.reads.slice() : [target];
  const writes = Array.isArray(options.writes) ? options.writes.slice() : [target];

  frameGraph.addPass({
    name,
    kind: "render",
    reads,
    writes,
    execute(context) {
      const device = context && context.device;
      const canvasSurface = context && context.canvasSurface;
      const cloth = context && context.cloth;

      if (!device) {
        throw new Error("ClothDebugPass.execute: context.device is required");
      }

      if (!canvasSurface || !canvasSurface.context) {
        throw new Error(
          "ClothDebugPass.execute: context.canvasSurface with a WebGPU context is required",
        );
      }

      if (
        !cloth ||
        !cloth.pipeline ||
        !cloth.vertexBuffer ||
        !cloth.indexBuffer ||
        !cloth.indexCount
      ) {
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

      renderPass.setPipeline(cloth.pipeline);

      const bindGroups = Array.isArray(cloth.bindGroups) ? cloth.bindGroups : [];
      for (let i = 0; i < bindGroups.length; i++) {
        const group = bindGroups[i];
        if (group) {
          renderPass.setBindGroup(i, group);
        }
      }

      renderPass.setVertexBuffer(0, cloth.vertexBuffer);
      renderPass.setIndexBuffer(
        cloth.indexBuffer,
        cloth.indexFormat || "uint16",
      );

      const indexCount =
        typeof cloth.indexCount === "number" && cloth.indexCount > 0
          ? cloth.indexCount
          : 0;
      const instanceCount =
        typeof cloth.instanceCount === "number" && cloth.instanceCount > 0
          ? cloth.instanceCount
          : 1;
      const firstIndex = cloth.firstIndex | 0;
      const firstInstance = cloth.firstInstance | 0;

      if (indexCount > 0) {
        renderPass.drawIndexed(indexCount, instanceCount, firstIndex, 0, firstInstance);
      }

      renderPass.end();

      if (!externalEncoder) {
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
      }
    },
  });
}

export { addClothDebugPass as ClothDebugPass };
