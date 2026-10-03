// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createFrameGraph } from "../framegraph/FrameGraph.js";

function normalizeAccessList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.length > 0);
}

function resolveValue(value, context) {
  if (typeof value === "function") {
    return value(context);
  }
  return value;
}

function normalizeDispatchSize(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const x = Math.max(1, value[0] | 0);
    const y = Math.max(1, value[1] | 0);
    const z = Math.max(1, value[2] | 0);
    return [x, y, z];
  }
  if (value && typeof value === "object") {
    const x = Math.max(1, (value.x ?? 1) | 0);
    const y = Math.max(1, (value.y ?? 1) | 0);
    const z = Math.max(1, (value.z ?? 1) | 0);
    return [x, y, z];
  }
  const x = Math.max(1, (value ?? 1) | 0);
  return [x, 1, 1];
}

export function createGpuPassGraph() {
  const fg = createFrameGraph();

  function addResource(name, descriptor = {}) {
    return fg.addResource(name, descriptor);
  }

  function addComputePass(options) {
    const name = options && options.name ? options.name : null;
    if (!name) {
      throw new Error("GpuPassGraph.addComputePass: pass name is required");
    }

    const reads = normalizeAccessList(options.reads);
    const writes = normalizeAccessList(options.writes);

    const record = options.record;
    if (typeof record === "function") {
      fg.addPass({
        name,
        kind: "compute",
        reads,
        writes,
        execute(context) {
          record(context);
        },
      });
      return;
    }

    const pipelineProvider = options.pipeline;
    if (!pipelineProvider) {
      throw new Error(`GpuPassGraph.addComputePass '${name}': pipeline is required`);
    }

    const bindGroupsProvider = options.bindGroups;
    const dispatchProvider = options.dispatchSize ?? options.workgroups;

    fg.addPass({
      name,
      kind: "compute",
      reads,
      writes,
      execute(context) {
        const pipeline = resolveValue(pipelineProvider, context);
        if (!pipeline) {
          throw new Error(`GpuPassGraph.execute: missing pipeline for '${name}'`);
        }

        const bindGroupsResolved = resolveValue(bindGroupsProvider, context);
        const bindGroups = Array.isArray(bindGroupsResolved)
          ? bindGroupsResolved
          : (bindGroupsResolved ? [bindGroupsResolved] : []);

        const dispatchResolved = resolveValue(dispatchProvider, context);
        const dispatchSize = normalizeDispatchSize(dispatchResolved ?? 1);

        const sharedPass = context && context.computePass;
        const encoder = context && context.encoder;
        const pass = sharedPass || (encoder ? encoder.beginComputePass({ label: name }) : null);
        if (!pass) {
          throw new Error(`GpuPassGraph.execute: missing computePass/encoder for '${name}'`);
        }

        pass.setPipeline(pipeline);
        for (let i = 0; i < bindGroups.length; i++) {
          if (bindGroups[i]) {
            pass.setBindGroup(i, bindGroups[i]);
          }
        }

        pass.dispatchWorkgroups(dispatchSize[0], dispatchSize[1], dispatchSize[2]);

        if (!sharedPass) {
          pass.end();
        }
      },
    });
  }

  function compile() {
    const compiled = fg.compile();

    function encode(device, options = {}) {
      if (!device) {
        throw new Error("GpuPassGraph.encode: device is required");
      }

      const externalEncoder = options.encoder;
      const encoder = externalEncoder || device.createCommandEncoder({
        label: typeof options.label === "string" ? options.label : "GpuPassGraph.encode",
      });

      const openComputePass = options.openComputePass !== false;
      const computePass = openComputePass
        ? encoder.beginComputePass({
          label: typeof options.passLabel === "string" ? options.passLabel : "GpuPassGraph.computePass",
        })
        : null;

      const userContext = options.context && typeof options.context === "object" ? options.context : null;
      const context = userContext
        ? { device, computePass, encoder, ...userContext }
        : { device, computePass, encoder };

      compiled.execute(context);

      if (computePass) {
        computePass.end();
      }

      if (externalEncoder) {
        return null;
      }

      return encoder.finish();
    }

    function getDebugSnapshot() {
      return compiled.getDebugSnapshot();
    }

    return {
      id: compiled.id,
      encode,
      getDebugSnapshot,
    };
  }

  return {
    id: fg.id,
    addResource,
    addComputePass,
    compile,
    getResources: fg.getResources,
    getPasses: fg.getPasses,
  };
}
