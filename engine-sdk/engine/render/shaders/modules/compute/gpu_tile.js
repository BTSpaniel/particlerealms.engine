// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GpuTile - WebGPU workgroup shared-memory tile (WebGPU equivalent of NVIDIA cuda-tile)
 *
 * Inspired by: https://github.com/NVIDIA/cuda-tile
 *
 * CONCEPT:
 *   Every thread in a workgroup cooperatively loads one element of a global
 *   buffer into fast workgroup-shared memory ("the tile"), then ALL threads
 *   process the cached tile before advancing to the next tile.  This amortises
 *   global-memory latency across the whole group — the same idea that makes
 *   tiled matrix-multiply orders of magnitude faster than naive O(N²) reads.
 *
 *   CUDA term         WebGPU/WGSL equivalent
 *   ─────────────     ─────────────────────
 *   __shared__        var<workgroup>
 *   template<T,N>     JS class with type / tileSize parameters (build-time)
 *   __syncthreads()   workgroupBarrier()
 *   threadIdx.x       @builtin(local_invocation_id)
 *
 * USAGE (JavaScript side, shader build-time):
 *
 *   import { GpuTile } from ".../modules/compute/gpu_tile.js";
 *
 *   const bodyTile = new GpuTile({ name: 'bodyTile', type: 'vec4f', tileSize: 64 });
 *
 *   const shader = `
 *     // --- module scope ---
 *     ${bodyTile.declareWGSL()}
 *
 *     @compute @workgroup_size(64)
 *     fn cs(@builtin(global_invocation_id) gid: vec3u,
 *           @builtin(local_invocation_id)  lid: vec3u) {
 *       let i   = gid.x;
 *       let myPos = bodies[i].pos.xyz;
 *       var acc = vec3f(0.);
 *
 *       ${bodyTile.tiledLoopWGSL({
 *         bufExpr:   'bodies',        // storage buffer binding name
 *         elemExpr:  'b.pos',         // expression to extract from element
 *         countExpr: 'u.count',
 *         lidExpr:   'lid.x',
 *         bodyWGSL: `
 *           for (var k = 0u; k < _bodyTile_len; k++) {
 *             let b = ${bodyTile.getWGSL('k')};
 *             let d = b.xyz - myPos;
 *             acc += d / (dot(d,d) + 0.01);
 *           }`
 *       })}
 *     }
 *   `;
 *
 * ADVANCED — multiple simultaneous tiles:
 *   Give each a unique `name` so their var<workgroup> identifiers don't collide.
 *
 *   const posTile = new GpuTile({ name: 'posTile', type: 'vec4f', tileSize: 64 });
 *   const velTile = new GpuTile({ name: 'velTile', type: 'vec4f', tileSize: 64 });
 *
 *   // In shader:
 *   ${posTile.declareWGSL()}
 *   ${velTile.declareWGSL()}
 */

export class GpuTile {
  /**
   * @param {object}  opts
   * @param {string}  [opts.name='tile']       - Identifier prefix used in all generated WGSL
   * @param {string}  [opts.type='vec4f']      - WGSL element type stored in the tile
   * @param {number}  [opts.tileSize=64]       - Elements per tile (usually == @workgroup_size)
   * @param {string}  [opts.zero='vec4f(0.)']  - Zero / out-of-bounds fill value for this type
   */
  constructor({ name = 'tile', type = 'vec4f', tileSize = 64, zero = 'vec4f(0.)' } = {}) {
    this.name     = name;
    this.type     = type;
    this.tileSize = tileSize;
    this.zero     = zero;
  }

  // ─── WGSL code generators ──────────────────────────────────────────────────

  /**
   * Module-scope workgroup shared-memory declaration.
   * Paste this once, outside any function, at the top of your compute shader.
   *
   * @returns {string}  e.g.  `var<workgroup> tile: array<vec4f, 64u>;`
   */
  declareWGSL() {
    return `var<workgroup> ${this.name}: array<${this.type}, ${this.tileSize}u>;`;
  }

  /**
   * Cooperative single-element load + barrier.
   * Each invocation loads one element; call this inside a tile loop before
   * processing.  Inserts `workgroupBarrier()` so the tile is fully populated
   * before any thread reads it.
   *
   * @param {string} bufExpr    - Storage buffer binding name (e.g. `"bodies"`)
   * @param {string} baseExpr   - Tile base index expression  (e.g. `"_t"`)
   * @param {string} lidExpr    - Local invocation id expression (e.g. `"lid.x"`)
   * @param {string} countExpr  - Total element count expression (e.g. `"u.count"`)
   * @param {string|null} elemExpr - Optional expression that extracts the tile element from `elemVar`
   * @param {string} elemVar - Local variable name bound to the source buffer element when `elemExpr` is used
   * @returns {string}
   */
  loadWGSL(bufExpr, baseExpr, lidExpr, countExpr, elemExpr = null, elemVar = 'b') {
    const n = this.name;
    const elementExpr = typeof elemExpr === 'string' && elemExpr.trim().length > 0 ? elemExpr.trim() : null;
    if (elementExpr) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(elemVar)) {
        throw new Error(`Invalid WGSL element variable name: ${elemVar}`);
      }
      return [
        `  let _${n}_gi = ${baseExpr} + ${lidExpr};`,
        `  if (_${n}_gi < ${countExpr}) {`,
        `    let ${elemVar} = ${bufExpr}[_${n}_gi];`,
        `    ${n}[${lidExpr}] = ${elementExpr};`,
        `  } else {`,
        `    ${n}[${lidExpr}] = ${this.zero};`,
        `  }`,
        `  workgroupBarrier();`,
      ].join('\n');
    }
    return [
      `  let _${n}_gi = ${baseExpr} + ${lidExpr};`,
      `  ${n}[${lidExpr}] = select(${this.zero}, ${bufExpr}[_${n}_gi], _${n}_gi < ${countExpr});`,
      `  workgroupBarrier();`,
    ].join('\n');
  }

  /**
   * Expression to read element `k` from the tile.
   * @param {string|number} k  - Index (literal or expression string)
   * @returns {string}  e.g.  `tile[k]`
   */
  getWGSL(k) {
    return `${this.name}[${k}]`;
  }

  /**
   * Trailing workgroupBarrier() to protect the tile from being overwritten
   * before all threads finish reading.  Call after the inner processing loop.
   * @returns {string}
   */
  barrierWGSL() {
    return `  workgroupBarrier();`;
  }

  /**
   * Generate a complete outer tiled-loop that:
   *   1. Iterates over the buffer in tiles of `tileSize` elements
   *   2. Cooperatively loads each tile into workgroup memory
   *   3. Executes your inner `bodyWGSL` with access to the tile
   *   4. Emits the trailing barrier before moving to the next tile
   *
   * Inside `bodyWGSL` you have access to:
   *   _<name>_base  - tile start index in the global buffer
   *   _<name>_len   - number of valid elements in this tile (≤ tileSize)
   *   Use `this.getWGSL('k')` to read element k from the tile.
   *
   * @param {object} opts
   * @param {string} opts.bufExpr    - Storage buffer binding name
   * @param {string} opts.countExpr  - Total element count expression
   * @param {string} opts.lidExpr    - Local invocation id expression
   * @param {string} [opts.elemExpr]  - Optional source element projection expression, e.g. `"b.pos"`
   * @param {string} [opts.elemVar='b'] - Optional local source element variable name used by `elemExpr`
   * @param {string} opts.bodyWGSL   - Inner loop body WGSL (as a string)
   * @returns {string}
   */
  tiledLoopWGSL({ bufExpr, countExpr, lidExpr, elemExpr = null, elemVar = 'b', bodyWGSL }) {
    const n  = this.name;
    const ts = this.tileSize;
    return (
`for (var _${n}_base = 0u; _${n}_base < ${countExpr}; _${n}_base += ${ts}u) {
${this.loadWGSL(bufExpr, `_${n}_base`, lidExpr, countExpr, elemExpr, elemVar)}
  let _${n}_len = min(${ts}u, ${countExpr} - _${n}_base);
${bodyWGSL}
${this.barrierWGSL()}
}`
    );
  }

  /**
   * Return a summary string useful for shader comments / debugging.
   * @returns {string}
   */
  toString() {
    return `GpuTile(name="${this.name}", type=${this.type}, tileSize=${this.tileSize})`;
  }
}

/**
 * Convenience factory — same as `new GpuTile(opts)`.
 * @param {object} opts
 * @returns {GpuTile}
 */
export function gpuTile(opts) {
  return new GpuTile(opts);
}

// ─── Pre-built tiles for the most common cases ────────────────────────────────
// Import these directly when you don't need custom configuration.

/** vec4f tile, 64 threads — matches the N-Body pattern exactly */
export const VEC4_TILE_64  = new GpuTile({ name: 'tile',     type: 'vec4f', tileSize: 64,  zero: 'vec4f(0.)' });

/** vec4f tile, 128 threads — good for higher-throughput passes */
export const VEC4_TILE_128 = new GpuTile({ name: 'tile128',  type: 'vec4f', tileSize: 128, zero: 'vec4f(0.)' });

/** f32 tile, 64 threads — useful for scalar reduction passes */
export const F32_TILE_64   = new GpuTile({ name: 'ftile',    type: 'f32',   tileSize: 64,  zero: '0.'        });

/** vec2f tile, 64 threads — 2-D positions / UVs */
export const VEC2_TILE_64  = new GpuTile({ name: 'v2tile',   type: 'vec2f', tileSize: 64,  zero: 'vec2f(0.)' });

// ─── WGSL snippet: canonical tiled N-body pattern (documentation / reference) ─

/**
 * Ready-to-paste WGSL string demonstrating the 64-thread tiled N-body pattern.
 * This is the same code used in the playground N-Body demo, expressed via GpuTile.
 */
export const TILED_NBODY_EXAMPLE_WGSL = (() => {
  const t = VEC4_TILE_64;
  return (
`// --- Tiled N-body gravity (64 threads) ---
// Generated by GpuTile: ${t}
${t.declareWGSL()}

@compute @workgroup_size(64)
fn cs(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id)  lid: vec3u,
) {
  let i     = gid.x;
  let valid = i < u.count;
  var acc   = vec3f(0.);
  var pi    = vec3f(0.);
  if (valid) { pi = bodies[i].pos.xyz; }

  ${t.tiledLoopWGSL({
    bufExpr:   'bodies',
    countExpr: 'u.count',
    lidExpr:   'lid.x',
    elemExpr:  'b.pos',
    bodyWGSL: `
    if (valid) {
      for (var _k = 0u; _k < _tile_len; _k++) {
        let jp  = ${t.getWGSL('_k')};
        let idx = _tile_base + _k;
        if (idx >= u.count || idx == i) { continue; }
        let d  = jp.xyz - pi;
        let ds = dot(d, d) + u.soften;
        acc   += d * (jp.w * inverseSqrt(ds * ds * ds));
      }
    }`
  })}

  if (valid) {
    var nv = (bodies[i].vel.xyz + acc * u.G * u.dt) * 0.9996;
    bodies[i].vel = vec4f(nv, 0.);
    bodies[i].pos = vec4f(bodies[i].pos.xyz + nv * u.dt, bodies[i].pos.w);
  }
}`
  );
})();
