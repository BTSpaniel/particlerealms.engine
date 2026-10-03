// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createDepthTexture } from "../../core/gpu/GpuTexture.js";

function ensureDepthAttachmentResource(frameGraph, name, descriptor) {
  if (!frameGraph || typeof frameGraph.addResource !== "function") {
    throw new Error(
      "ensureDepthAttachmentResource: frameGraph with addResource is required"
    );
  }
  const getResources = frameGraph.getResources;
  if (typeof getResources === "function") {
    const resources = getResources();
    if (resources && resources.has(name)) {
      return;
    }
  }
  frameGraph.addResource(
    name,
    descriptor || {
      kind: "depthAttachment",
      external: true,
    }
  );
}

function encodeShadowDraw(renderPass, draw) {
  const mesh = draw.mesh;
  if (!mesh || !mesh.vertexBuffer || mesh.vertexCount <= 0) {
    return;
  }

  const pipeline = draw.pipeline;
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

export function addDirectionalShadowPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addDirectionalShadowPass: frameGraph with addPass is required");
  }

  const resourceName = options.target || "shadowMap";
  const name = options.name || "shadow_directional";
  const addResource = options.addResource !== false;
  const contextKey = options.contextKey || "directionalShadow";

  if (addResource) {
    ensureDepthAttachmentResource(
      frameGraph,
      resourceName,
      options.resourceDescriptor || {
        kind: "depthAttachment",
        external: true,
      }
    );
  }

  const reads = Array.isArray(options.reads) ? options.reads.slice() : [];
  const writes = Array.isArray(options.writes)
    ? options.writes.slice()
    : [resourceName];

  frameGraph.addPass({
    name,
    kind: "render",
    reads,
    writes,
    execute(context) {
      const device = context && context.device;
      const shadow = context && context[contextKey];

      if (!device) {
        throw new Error("DirectionalShadowPass.execute: context.device is required");
      }

      if (!shadow) {
        // No shadow context provided this frame; skip work.
        return;
      }

      const canvasSurface = context.canvasSurface;
      const size = shadow.size || (canvasSurface && canvasSurface.getCanvasSize());
      const width = size && size.width ? size.width : 1024;
      const height = size && size.height ? size.height : 1024;

      if (!shadow.handle || shadow.handle.width !== width || shadow.handle.height !== height) {
        const handle = createDepthTexture(device, width, height, {
          label: shadow.label || "DirectionalShadowMap",
        });
        shadow.handle = handle;
        shadow.view = handle.view;
      }

      const depthView = shadow.view;
      if (!depthView) {
        throw new Error("DirectionalShadowPass.execute: shadow.view is required");
      }

      const drawList = Array.isArray(shadow.drawList) ? shadow.drawList : [];

      const externalEncoder = context && context.encoder;
      const encoder = externalEncoder || device.createCommandEncoder({
        label: `${name}_encoder`,
      });

      const passDesc = {
        label: `${name}_pass`,
        colorAttachments: [],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      };

      const renderPass = encoder.beginRenderPass(passDesc);

      for (let i = 0; i < drawList.length; i++) {
        const draw = drawList[i];
        if (!draw || draw.skip === true) {
          continue;
        }
        encodeShadowDraw(renderPass, draw);
      }

      renderPass.end();

      if (!externalEncoder) {
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
      }
    },
  });
}

export { addDirectionalShadowPass as ShadowPass };
