// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ensureColorAttachmentResource } from "./ClearPass.js";

function sortDrawLists(drawList) {
  const opaque = [];
  const transparent = [];

  for (let i = 0; i < drawList.length; i++) {
    const draw = drawList[i];
    if (!draw) continue;
    if (draw.transparent) {
      transparent.push(draw);
    } else {
      opaque.push(draw);
    }
  }

  opaque.sort((a, b) => {
    const ak = typeof a.sortKey === "number" ? a.sortKey : 0;
    const bk = typeof b.sortKey === "number" ? b.sortKey : 0;
    return ak - bk;
  });

  transparent.sort((a, b) => {
    const ak = typeof a.sortKey === "number" ? a.sortKey : 0;
    const bk = typeof b.sortKey === "number" ? b.sortKey : 0;
    return bk - ak;
  });

  return { opaque, transparent };
}

function encodeDraw(renderPass, draw, fallbackPipeline) {
  const mesh = draw.mesh;
  if (!mesh || !mesh.vertexBuffer || mesh.vertexCount <= 0) {
    return;
  }

  const pipeline = draw.pipeline || fallbackPipeline;
  if (!pipeline) {
    return;
  }

  renderPass.setPipeline(pipeline);

  const bindGroups = draw.bindGroups;
  if (Array.isArray(bindGroups)) {
    for (let i = 0; i < bindGroups.length; i++) {
      const group = bindGroups[i];
      if (group) {
        renderPass.setBindGroup(i, group);
      }
    }
  }

  renderPass.setVertexBuffer(0, mesh.vertexBuffer);

  if (mesh.indexBuffer && mesh.indexCount > 0 && mesh.indexFormat) {
    renderPass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
    const indexCount = draw.indexCount > 0 ? draw.indexCount : mesh.indexCount;
    const indexOffset = draw.indexOffset | 0;
    const instanceCount = draw.instanceCount > 0 ? draw.instanceCount : 1;
    const firstInstance = draw.firstInstance | 0;
    renderPass.drawIndexed(indexCount, instanceCount, indexOffset, 0, firstInstance);
  } else {
    const vertexCount = draw.vertexCount > 0 ? draw.vertexCount : mesh.vertexCount;
    const vertexOffset = draw.vertexOffset | 0;
    const instanceCount = draw.instanceCount > 0 ? draw.instanceCount : 1;
    const firstInstance = draw.firstInstance | 0;
    renderPass.draw(vertexCount, instanceCount, vertexOffset, firstInstance);
  }
}

export function addMainGeometryPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addMainGeometryPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "geometry_main";
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
      const geometry = context && context.geometry;
      const drawList = geometry && Array.isArray(geometry.drawList)
        ? geometry.drawList
        : [];

      if (!device) {
        throw new Error("GeometryPass.execute: context.device is required");
      }

      if (!canvasSurface || !canvasSurface.context) {
        throw new Error(
          "GeometryPass.execute: context.canvasSurface with a WebGPU context is required"
        );
      }

      if (!drawList.length) {
        // Nothing to draw this frame; avoid submitting empty command buffers.
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

      const { opaque, transparent } = sortDrawLists(drawList);

      const fallbackPipeline = geometry && geometry.pipeline ? geometry.pipeline : null;

      for (let i = 0; i < opaque.length; i++) {
        encodeDraw(renderPass, opaque[i], fallbackPipeline);
      }

      for (let i = 0; i < transparent.length; i++) {
        encodeDraw(renderPass, transparent[i], fallbackPipeline);
      }

      renderPass.end();

      if (!externalEncoder) {
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
      }
    },
  });
}

export { addMainGeometryPass as GeometryPass };
