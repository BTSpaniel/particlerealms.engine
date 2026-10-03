import { PHYSICS_RUNTIME } from '../PhysicsRuntimeDescriptor.js';

let physxModulePromise = null;

/**
 * Where the PhysX `.wasm` lives, when it is not beside the module.
 *
 * Emscripten resolves the binary relative to the loader's own URL, which is
 * correct when the engine is served from its own tree and wrong for every
 * consumer that is not. A bundled consumer serving from its own root asks for
 * `engine/sim/physics/physx-pe.wasm`, gets a 404, and PhysX aborts — with
 * the only symptom being that physics silently never starts.
 *
 * Set this before the first `ensurePhysXModule()` call to point at wherever the
 * binary is actually served from. Left null, behaviour is unchanged.
 *
 * @type {string|null}
 */
let physxWasmUrl = null;

/**
 * @param {string|null} url absolute or page-relative URL of `physx-pe.wasm`
 */
export function setPhysXWasmUrl(url) {
  if (physxModulePromise) {
    // Worth saying out loud rather than ignoring: the module is a singleton and
    // the binary is already resolved, so a late call cannot take effect and the
    // caller would otherwise be left believing it had.
    console.warn('[PhysX] setPhysXWasmUrl called after the module was loaded; ignored.');
    return;
  }
  physxWasmUrl = url;
}

function getGlobalPhysXFactory() {
  if (typeof PhysX === "function") {
    return PhysX;
  }
  if (typeof window !== "undefined" && typeof window.PhysX === "function") {
    return window.PhysX;
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.PhysX === "function") {
    return globalThis.PhysX;
  }
  return null;
}

async function loadPhysXFactory() {
  const globalFactory = getGlobalPhysXFactory();
  if (globalFactory) {
    return globalFactory;
  }

  const esm = await import("./physx-pe.mjs");
  const factory =
    (esm && typeof esm.default === "function" && esm.default) ||
    (esm && typeof esm.__default === "function" && esm.__default) ||
    (esm && typeof esm.PhysX === "function" && esm.PhysX);

  if (!factory) {
    throw new Error(
      "PhysXModule: could not find PhysX factory in physx-pe.mjs export."
    );
  }

  return factory;
}

export function ensurePhysXModule() {
  if (physxModulePromise) {
    return physxModulePromise;
  }

  physxModulePromise = loadPhysXFactory().then((factory) => {
    // `locateFile` is emscripten's own hook and the only supported way to move
    // the binary. Passing no options at all is what produced the 404, so the
    // options object is only supplied when there is something to say — an empty
    // `locateFile` would override the default with the default.
    if (!physxWasmUrl) return factory();
    return factory({
      locateFile: (path) => (path.endsWith('.wasm') ? physxWasmUrl : path),
    });
  }).then((mod) => {
    if (
      !mod ||
      typeof mod.CreateFoundation !== "function" ||
      typeof mod.CreatePhysics !== "function"
    ) {
      throw new Error(
        "PhysXModule: loaded module does not look like a PhysX WebAssembly module."
      );
    }
    const version = `${mod.PHYSICS_VERSION >>> 24}.${(mod.PHYSICS_VERSION >>> 16) & 255}.${(mod.PHYSICS_VERSION >>> 8) & 255}`;
    if (version !== PHYSICS_RUNTIME.sdkVersion || mod._pr_bulk_backend?.() !== 2
        || mod._pr_bulk_abi?.() !== 1 || mod._pr_flow_stage_abi?.() !== 1
        || mod._pr_flow_simd_enabled?.() !== 1 || mod._pr_blast_version?.() !== 50006
        || (PHYSICS_RUNTIME.capabilities.blastSceneApi && mod._pr_blast_scene_abi?.() !== 1)
        || (PHYSICS_RUNTIME.capabilities.flowSolver && mod._pr_flow_host_abi?.() !== 1)) {
      throw new Error(`PhysXModule: expected the unified ${PHYSICS_RUNTIME.sdkVersion} runtime; loaded ${version}. Rebuild the matching loader and WASM assets.`);
    }
    // WebIDL emits these static extension functions on the prototype. Expose
    // their documented static API once so world, articulation and Inspector
    // consumers actually apply authored mass/inertia instead of skipping it.
    for (const name of ['setMassAndUpdateInertia', 'updateMassAndInertia']) {
      const extension = mod.PxRigidBodyExt;
      if (typeof extension?.[name] !== 'function' && typeof extension?.prototype?.[name] === 'function') {
        extension[name] = extension.prototype[name].bind(extension.prototype);
      }
      if (typeof extension?.[name] !== 'function') throw new Error(`PhysX PE omitted ${name}`);
    }
    console.info(`[PhysX PE] ${version}; Rust SIMD, Blast core and Flow staging ready`);
    return mod;
  });

  return physxModulePromise;
}

export { ensurePhysXModule as PhysXModule };
