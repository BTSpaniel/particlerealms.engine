// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function normalizeColor3(input, defaultValue) {
  const base = Array.isArray(input) ? input : defaultValue;
  const r = Number(base[0]);
  const g = Number(base[1]);
  const b = Number(base[2]);
  return [
    Number.isFinite(r) ? r : defaultValue[0],
    Number.isFinite(g) ? g : defaultValue[1],
    Number.isFinite(b) ? b : defaultValue[2],
  ];
}

function normalizeColor4(input, defaultValue) {
  const base = Array.isArray(input) ? input : defaultValue;
  const r = Number(base[0]);
  const g = Number(base[1]);
  const b = Number(base[2]);
  const a = Number(base[3]);
  return [
    Number.isFinite(r) ? r : defaultValue[0],
    Number.isFinite(g) ? g : defaultValue[1],
    Number.isFinite(b) ? b : defaultValue[2],
    Number.isFinite(a) ? a : defaultValue[3],
  ];
}

function normalizeNormalTextureScale(input, defaultValue = 1) {
  const value = Number(input);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 8) : defaultValue;
}

function normalizeNormalGreenChannel(input, defaultValue = "up") {
  return input === "down" ? "down" : defaultValue;
}

const DEFAULT_MATERIAL = {
  id: "",
  label: null,
  type: "unlit", // unlit, pbr, debug, etc.
  baseColorFactor: [1, 1, 1, 1],
  emissiveFactor: [0, 0, 0],
  metallicFactor: 0,
  roughnessFactor: 1,
  baseColorTexture: null,
  normalTexture: null,

  normalTextureScale: 1,

  normalTextureGreenChannel: "up",
  metallicRoughnessTexture: null,
  emissiveTexture: null,
  pipelineTag: null,
};

export function normalizeMaterialDescriptor(input) {
  const src = input && typeof input === "object" ? input : {};
  const id = typeof src.id === "string" ? src.id : "";
  const label =
    typeof src.label === "string" && src.label.length > 0 ? src.label : null;
  const type = typeof src.type === "string" ? src.type : DEFAULT_MATERIAL.type;

  const metallicValue = Number(src.metallicFactor);
  const roughnessValue = Number(src.roughnessFactor);

  return {
    id,
    label,
    type,
    baseColorFactor: normalizeColor4(
      src.baseColorFactor,
      DEFAULT_MATERIAL.baseColorFactor
    ),
    emissiveFactor: normalizeColor3(
      src.emissiveFactor,
      DEFAULT_MATERIAL.emissiveFactor
    ),
    metallicFactor: Number.isFinite(metallicValue)
      ? Math.min(Math.max(metallicValue, 0), 1)
      : DEFAULT_MATERIAL.metallicFactor,
    roughnessFactor: Number.isFinite(roughnessValue)
      ? Math.min(Math.max(roughnessValue, 0.04), 1)
      : DEFAULT_MATERIAL.roughnessFactor,
    baseColorTexture:
      typeof src.baseColorTexture === "string"
        ? src.baseColorTexture
        : DEFAULT_MATERIAL.baseColorTexture,
    normalTexture:
      typeof src.normalTexture === "string"
        ? src.normalTexture
        : DEFAULT_MATERIAL.normalTexture,
    normalTextureScale: normalizeNormalTextureScale(

      src.normalTextureScale ?? src.normalScale,

      DEFAULT_MATERIAL.normalTextureScale

    ),

    normalTextureGreenChannel: normalizeNormalGreenChannel(

      src.normalTextureGreenChannel ?? src.normalGreenChannel,

      DEFAULT_MATERIAL.normalTextureGreenChannel

    ),

    metallicRoughnessTexture:
      typeof src.metallicRoughnessTexture === "string"
        ? src.metallicRoughnessTexture
        : DEFAULT_MATERIAL.metallicRoughnessTexture,
    emissiveTexture:
      typeof src.emissiveTexture === "string"
        ? src.emissiveTexture
        : DEFAULT_MATERIAL.emissiveTexture,
    pipelineTag:
      typeof src.pipelineTag === "string" && src.pipelineTag.length > 0
        ? src.pipelineTag
        : null,
  };
}

let nextMaterialId = 1;

function allocateMaterialId() {
  const id = `mat_${nextMaterialId}`;
  nextMaterialId += 1;
  return id;
}

function createDefaultLayouts(device, options) {
  const frameLayout = device.createBindGroupLayout({
    label: options && options.frameLayoutLabel,
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  const materialEntries = [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float" },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: "filtering" },
    },
  ];

  const materialLayout = device.createBindGroupLayout({
    label: options && options.materialLayoutLabel,
    entries: materialEntries,
  });

  const pipelineLayout = device.createPipelineLayout({
    label: options && options.pipelineLayoutLabel,
    bindGroupLayouts: [frameLayout, materialLayout],
  });

  return { frameLayout, materialLayout, pipelineLayout };
}

export function createMaterialSystem(device, options = {}) {
  if (!device) {
    throw new Error("createMaterialSystem: device is required");
  }

  const layouts = createDefaultLayouts(device, options.layouts || {});

  const materialsById = new Map();
  const typeHandlers = new Map();
  const pipelineCache = new Map();

  function registerMaterialType(type, handler) {
    if (!type || typeof type !== "string") {
      throw new Error("registerMaterialType: type string is required");
    }
    if (!handler || typeof handler.createPipeline !== "function") {
      throw new Error(
        "registerMaterialType: handler.createPipeline(device, layouts, material, meshLayout, options) is required"
      );
    }
    typeHandlers.set(type, {
      createPipeline: handler.createPipeline,
      getCacheKey:
        typeof handler.getCacheKey === "function"
          ? handler.getCacheKey
          : null,
    });
  }

  function createMaterial(descriptor) {
    const normalized = normalizeMaterialDescriptor(descriptor);
    let id = normalized.id;
    if (!id) {
      id = allocateMaterialId();
      normalized.id = id;
    }
    if (materialsById.has(id)) {
      throw new Error(`createMaterial: material '${id}' already exists`);
    }
    materialsById.set(id, normalized);
    return normalized;
  }

  function getMaterial(id) {
    return materialsById.get(id) || null;
  }

  function getPipelineFor(materialId, meshLayout, optionsForType) {
    const material = materialsById.get(materialId);
    if (!material) {
      throw new Error(`getPipelineFor: unknown material '${materialId}'`);
    }
    const handler = typeHandlers.get(material.type);
    if (!handler) {
      throw new Error(
        `getPipelineFor: no material type handler registered for '${material.type}'`
      );
    }

    const cacheKey = (() => {
      if (handler.getCacheKey) {
        return handler.getCacheKey(material, meshLayout, optionsForType);
      }
      const tag = material.pipelineTag || material.type;
      const stride = meshLayout && meshLayout.arrayStride;
      const attrCount =
        meshLayout && Array.isArray(meshLayout.attributes)
          ? meshLayout.attributes.length
          : 0;
      return `${tag}|stride:${stride}|attrs:${attrCount}`;
    })();

    const cached = pipelineCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pipeline = handler.createPipeline(
      device,
      layouts,
      material,
      meshLayout,
      optionsForType || {}
    );
    pipelineCache.set(cacheKey, pipeline);
    return pipeline;
  }

  function dispose() {
    pipelineCache.clear();
    materialsById.clear();
    typeHandlers.clear();
  }

  return {
    device,
    layouts,
    registerMaterialType,
    createMaterial,
    getMaterial,
    getPipelineFor,
    dispose,
  };
}
