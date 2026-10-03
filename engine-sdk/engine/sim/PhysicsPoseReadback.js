// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { PhysXBulkRust } from './physics/addons/physx-bulk-rust.mjs';

/** World-owned, bounded native pose batches. Actors must unregister before release. */
export class PhysicsPoseReadback {
    constructor(module, capacity = 1024) {
        if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65536) {
            throw new RangeError('Pose batch capacity must be from 1 to 65536');
        }
        this.module = module;
        this.capacity = capacity;
        this.batches = new Map();
        this.stats = { backend: 'physx-pe-rust', bodies: 0, batches: 0, snapshots: 0 };
    }

    add(body) {
        if (body.simMode === 'static') return;
        const key = Math.floor((body.handle - 1) / this.capacity);
        let entry = this.batches.get(key);
        if (!entry) {
            entry = { batch: new PhysXBulkRust(this.module, { capacity: this.capacity }), bodies: new Map() };
            this.batches.set(key, entry);
        }
        try {
            entry.batch.add(body.handle, body._actor);
            entry.bodies.set(body.handle, body);
        } catch (error) {
            if (!entry.bodies.size) { entry.batch.dispose(); this.batches.delete(key); }
            throw error;
        }
        this.stats.bodies++;
        this.stats.batches = this.batches.size;
    }

    remove(body) {
        const key = Math.floor((body.handle - 1) / this.capacity);
        const entry = this.batches.get(key);
        if (!entry?.bodies.has(body.handle)) return;
        entry.batch.remove(body.handle);
        entry.bodies.delete(body.handle);
        if (!entry.bodies.size) { entry.batch.dispose(); this.batches.delete(key); }
        this.stats.bodies--;
        this.stats.batches = this.batches.size;
    }

    update() {
        for (const { batch, bodies } of this.batches.values()) {
            const { ids, poses, count } = batch.snapshot();
            // Consume borrowed views before any native call can grow the heap.
            for (let i = 0; i < count; i++) {
                const body = bodies.get(ids[i]);
                if (!body) throw new Error('PhysX PE pose registration changed during readback');
                const offset = i * 7;
                for (let axis = 0; axis < 3; axis++) body.position[axis] = poses[offset + axis];
                for (let axis = 0; axis < 4; axis++) body.rotation[axis] = poses[offset + 3 + axis];
            }
        }
        this.stats.snapshots++;
    }

    dispose() {
        for (const { batch } of this.batches.values()) batch.dispose();
        this.batches.clear();
        this.stats.bodies = 0;
        this.stats.batches = 0;
    }
}
