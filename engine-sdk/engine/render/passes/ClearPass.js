// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function ensureColorAttachmentResource(frameGraph, name, descriptor) {
  if (!frameGraph || typeof frameGraph.addResource !== "function") {
    throw new Error("ensureColorAttachmentResource: frameGraph with addResource is required");
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
      kind: "colorAttachment",
      external: true,
    }
  );
}

export function addCanvasClearPass(frameGraph, options = {}) {
  if (!frameGraph || typeof frameGraph.addPass !== "function") {
    throw new Error("addCanvasClearPass: frameGraph with addPass is required");
  }

  const target = options.target || "backbuffer";
  const name = options.name || "clear_canvas";
  const clearColor = options.clearColor || { r: 0, g: 0, b: 0, a: 1 };
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

  frameGraph.addPass({
    name,
    kind: "render",
    reads: [],
    writes: [target],
    execute(context) {
      const device = context && context.device;
      const canvasSurface = context && context.canvasSurface;
      if (!device || !canvasSurface || !canvasSurface.context) {
        throw new Error(
          "addCanvasClearPass.execute: context.device and context.canvasSurface are required"
        );
      }

      const swapTexture = canvasSurface.context.getCurrentTexture();
      const swapView = swapTexture.createView();

      const color =
        typeof clearColor === "function" ? clearColor(context) : clearColor;

      const externalEncoder = context && context.encoder;
      const encoder = externalEncoder || device.createCommandEncoder({
        label: `${name}_encoder`,
      });

      const renderPass = encoder.beginRenderPass({
        label: `${name}_pass`,
        colorAttachments: [
          {
            view: swapView,
            clearValue: color,
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });

      renderPass.end();

      if (!externalEncoder) {
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
      }
    },
  });
}

export { addCanvasClearPass as ClearPass };
