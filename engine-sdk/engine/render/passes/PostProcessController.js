// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createPostProcessController(options = {}) {
  const effects = new Map();

  function registerEffect(def) {
    if (!def || typeof def !== "object") {
      throw new Error("registerEffect: effect definition object is required");
    }
    const id = def.id;
    if (!id || typeof id !== "string") {
      throw new Error("registerEffect: effect.id string is required");
    }
    if (effects.has(id)) {
      throw new Error(`registerEffect: effect '${id}' is already registered`);
    }

    const orderValue = Number(def.order);

    const effect = {
      id,
      name: typeof def.name === "string" ? def.name : id,
      order: Number.isFinite(orderValue) ? orderValue : 0,
      enabled: def.enabled !== false,
      params: def.params && typeof def.params === "object" ? { ...def.params } : {},
      buildStage:
        typeof def.buildStage === "function"
          ? def.buildStage
          : null,
    };

    if (!effect.buildStage) {
      throw new Error(
        "registerEffect: def.buildStage(context, effectState) => stage|null is required"
      );
    }

    effects.set(id, effect);
    return effect;
  }

  function setEffectEnabled(id, enabled) {
    const effect = effects.get(id);
    if (!effect) {
      return false;
    }
    effect.enabled = !!enabled;
    return true;
  }

  function updateEffectOrder(id, order) {
    const effect = effects.get(id);
    if (!effect) {
      return false;
    }
    const value = Number(order);
    if (!Number.isFinite(value)) {
      return false;
    }
    effect.order = value;
    return true;
  }

  function updateEffectParams(id, patch) {
    const effect = effects.get(id);
    if (!effect || !patch || typeof patch !== "object") {
      return false;
    }
    const keys = Object.keys(patch);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      effect.params[key] = patch[key];
    }
    return true;
  }

  function buildStages(context) {
    const list = Array.from(effects.values());
    list.sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const stages = [];
    for (let i = 0; i < list.length; i++) {
      const effect = list[i];
      if (!effect.enabled) {
        continue;
      }
      const stage = effect.buildStage(context, effect);
      if (stage && typeof stage === "object") {
        stages.push(stage);
      }
    }
    return stages;
  }

  function getConfigSnapshot() {
    const out = [];
    for (const effect of effects.values()) {
      out.push({
        id: effect.id,
        name: effect.name,
        order: effect.order,
        enabled: effect.enabled,
        params: { ...effect.params },
      });
    }
    out.sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
  }

  function attachToContext(context) {
    if (!context || typeof context !== "object") {
      throw new Error("attachToContext: context object is required");
    }
    const stages = buildStages(context);
    context.postfx = context.postfx || {};
    context.postfx.stages = stages;
    return stages;
  }

  return {
    registerEffect,
    setEffectEnabled,
    updateEffectOrder,
    updateEffectParams,
    buildStages,
    getConfigSnapshot,
    attachToContext,
  };
}

export { createPostProcessController as PostProcessController };
