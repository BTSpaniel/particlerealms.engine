// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ensureColorAttachmentResource } from "./ClearPass.js";

export function addUIHudPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addUIHudPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "ui_hud";
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
      const ui = context && context.ui;

      if (!device) {
        throw new Error("UIHudPass.execute: context.device is required");
      }

      if (!canvasSurface || !canvasSurface.context) {
        throw new Error(
          "UIHudPass.execute: context.canvasSurface with a WebGPU context is required"
        );
      }

      const layers = ui && Array.isArray(ui.layers) ? ui.layers : [];

      if (!layers.length) {
        // No UI/HUD layers scheduled this frame.
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
        // UI/HUD should draw on top of the existing image.
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

      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (!layer || !layer.pipeline) {
          continue;
        }

        renderPass.setPipeline(layer.pipeline);

        const bindGroups = Array.isArray(layer.bindGroups)
          ? layer.bindGroups
          : [];
        for (let bi = 0; bi < bindGroups.length; bi++) {
          const group = bindGroups[bi];
          if (group) {
            renderPass.setBindGroup(bi, group);
          }
        }

        if (layer.vertexBuffer) {
          renderPass.setVertexBuffer(0, layer.vertexBuffer);
        }

        const vertexCount =
          typeof layer.vertexCount === "number" && layer.vertexCount > 0
            ? layer.vertexCount
            : 3;
        const instanceCount =
          typeof layer.instanceCount === "number" && layer.instanceCount > 0
            ? layer.instanceCount
            : 1;
        const firstVertex = layer.firstVertex | 0;
        const firstInstance = layer.firstInstance | 0;

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

export { addUIHudPass as UIHudPass };
