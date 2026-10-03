// SPDX-License-Identifier: MIT
// Requires the addon linked INTO this initialized PhysX/WebIDL WASM module.
const exportsRequired = ['abi','sdk_version','create','add','remove','snapshot','count','pose_ptr','ids_ptr','destroy'];
const errors = {[-1]:'invalid argument or context', [-2]:'capacity exhausted',
  [-3]:'duplicate ID or actor', [-4]:'unknown ID', [-5]:'pose read failed or non-finite pose'};
function u32(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff)
    throw new RangeError(`${name} must be a nonzero uint32`);
  return value;
}
// A WASM i32 can be exposed as signed. Reject invalid values BEFORE coercion;
// undefined, NaN, fractions and >32-bit integers must never silently become 0.
function wasmU32(value, name) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0xffffffff)
    throw new Error(`Invalid wasm32 ${name}`);
  return value >>> 0;
}
function heap(module) {
  const view = module.HEAPU8;
  if (!(view instanceof Uint8Array) || view.byteLength === 0 || view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength)
    throw new Error('Expected a live HEAPU8 view');
  if (typeof SharedArrayBuffer !== 'undefined' && view.buffer instanceof SharedArrayBuffer)
    throw new Error('This adapter requires the single-owner, non-pthread build');
  return view.buffer;
}
export class PhysXBulk {
  #m; #h=0; #capacity; #actors=new Map(); #pointers=new Set(); #busy=false;
  constructor(module, {capacity=4096}={}) {
    u32(capacity, 'capacity');
    for (const n of exportsRequired)
      if (typeof module?.[`_pr_bulk_${n}`] !== 'function')
        throw new Error(`Missing addon export: _pr_bulk_${n}`);
    if (module._pr_bulk_abi() !== 1) throw new Error('Unsupported bulk ABI');
    const sdk=wasmU32(module.PHYSICS_VERSION, 'SDK version');
    if (!sdk || wasmU32(module._pr_bulk_sdk_version(), 'addon SDK version') !== sdk)
      throw new Error('Bulk/PhysX SDK version mismatch');
    if (typeof module.getPointer !== 'function' || typeof module.PxRigidActor !== 'function')
      throw new Error('Expected an initialized WebIDL module with PxRigidActor');
    heap(module);
    this.#m=module; this.#capacity=capacity;
    this.#h=wasmU32(module._pr_bulk_create(capacity), 'context handle');
    if (!this.#h) throw new Error('Bulk allocation failed');
  }
  #invoke(fn) {
    if (!this.#h) throw new Error('Bulk context disposed');
    if (this.#busy) throw new Error('Reentrant bulk access is prohibited');
    this.#busy=true;
    try { return fn(); } finally { this.#busy=false; }
  }
  #check(code) {
    if (code !== 0) throw new Error(`Bulk: ${errors[code] ?? `error ${code}`}`);
  }
  add(id, actor) {
    return this.#invoke(() => {
      u32(id, 'id');
      // getPointer alone just extracts a number: it cannot establish type or
      // module ownership. This checks the module-specific wrapper prototype.
      // It catches accidental misuse, NOT malicious JS or an already freed actor.
      if (!(actor instanceof this.#m.PxRigidActor))
        throw new TypeError('Actor must be a PxRigidActor wrapper from this same module');
      if (this.#actors.has(id)) throw new Error('Duplicate ID');
      const pointer=wasmU32(this.#m.getPointer(actor), 'actor pointer');
      const buffer=heap(this.#m);
      if (!pointer || pointer % 4 || pointer + 4 > buffer.byteLength)
        throw new Error('Invalid wasm32 actor pointer bounds/alignment');
      if (this.#pointers.has(pointer)) throw new Error('Duplicate actor');
      // Acquire JS ownership before native registration. Roll back on failure.
      try {
        this.#actors.set(id, {actor, pointer});
        this.#pointers.add(pointer);
        this.#check(this.#m._pr_bulk_add(this.#h, id, pointer));
      } catch (error) {
        this.#actors.delete(id); this.#pointers.delete(pointer); throw error;
      }
      return this;
    });
  }
  remove(id) {
    return this.#invoke(() => {
      u32(id, 'id');
      const entry=this.#actors.get(id);
      if (!entry) throw new Error('Unknown ID');
      this.#check(this.#m._pr_bulk_remove(this.#h, id));
      this.#actors.delete(id); this.#pointers.delete(entry.pointer);
      return this;
    });
  }
  snapshot({copy=false}={}) {
    return this.#invoke(() => {
      if (typeof copy !== 'boolean') throw new TypeError('copy must be boolean');
      const m=this.#m;
      this.#check(m._pr_bulk_snapshot(this.#h));
      const count=wasmU32(m._pr_bulk_count(this.#h), 'published count');
      if (count > this.#capacity || count !== this.#actors.size)
        throw new Error('Invalid native count');
      const pp=wasmU32(m._pr_bulk_pose_ptr(this.#h), 'pose pointer');
      const ip=wasmU32(m._pr_bulk_ids_ptr(this.#h), 'ID pointer');
      const buffer=heap(m); // AFTER native calls, which may grow memory.
      if (!pp || !ip || pp % 4 || ip % 4 || pp+count*28 > buffer.byteLength || ip+count*4 > buffer.byteLength)
        throw new Error('Invalid native buffer bounds');
      if (count && pp < ip+count*4 && ip < pp+count*28)
        throw new Error('Native ID and pose buffers overlap');
      const poses=new Float32Array(buffer, pp, count*7);
      const ids=new Uint32Array(buffer, ip, count);
      return {count, stride:7, layout:'px,py,pz,qx,qy,qz,qw',
        poses:copy ? poses.slice() : poses, ids:copy ? ids.slice() : ids};
    });
  }
  dispose() {
    if (!this.#h) return;
    this.#invoke(() => {
      this.#check(this.#m._pr_bulk_destroy(this.#h));
      this.#h=0; this.#actors.clear(); this.#pointers.clear();
    });
  }
}
// Views are transient: snapshot overwrites them; memory growth detaches them.
// Use copy:true for asynchronous/retained data. Unregister BEFORE actor.release().
// Never pass raw pointers between WASM instances. No guarantee of actor lifetime.
