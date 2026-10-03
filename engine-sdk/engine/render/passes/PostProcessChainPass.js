// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ensureColorAttachmentResource } from "./ClearPass.js";

export function addPostProcessChainPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addPostProcessChainPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "postfx_chain";
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
      const postfx = context && context.postfx;

      if (!device) {
        throw new Error("PostProcessChainPass.execute: context.device is required");
      }

      if (!canvasSurface || !canvasSurface.context) {
        throw new Error(
          "PostProcessChainPass.execute: context.canvasSurface with a WebGPU context is required"
        );
      }

      const stages =
        postfx && Array.isArray(postfx.stages) ? postfx.stages : [];

      if (!stages.length) {
        // No post-processing stages scheduled this frame.
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

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        if (!stage || !stage.pipeline) {
          continue;
        }

        renderPass.setPipeline(stage.pipeline);

        const bindGroups = Array.isArray(stage.bindGroups)
          ? stage.bindGroups
          : [];
        for (let bi = 0; bi < bindGroups.length; bi++) {
          const group = bindGroups[bi];
          if (group) {
            renderPass.setBindGroup(bi, group);
          }
        }

        if (stage.vertexBuffer) {
          renderPass.setVertexBuffer(0, stage.vertexBuffer);
        }

        const vertexCount =
          typeof stage.vertexCount === "number" && stage.vertexCount > 0
            ? stage.vertexCount
            : 3;
        const instanceCount =
          typeof stage.instanceCount === "number" && stage.instanceCount > 0
            ? stage.instanceCount
            : 1;
        const firstVertex = stage.firstVertex | 0;
        const firstInstance = stage.firstInstance | 0;

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

export { addPostProcessChainPass as PostProcessChainPass };
