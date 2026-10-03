// SPDX-License-Identifier: MIT
import {PhysXBulk} from './physx-bulk.mjs';
/** Require the Rust batching backend, while preserving the public bulk API. */
export class PhysXBulkRust extends PhysXBulk {
  constructor(module, options = {}) {
    if (typeof module?._pr_bulk_backend !== 'function' || module._pr_bulk_backend() !== 2)
      throw new Error('Expected the Rust-backed addon in this same PhysX module. Build with python build.py wasm.');
    super(module, options);
  }
}
