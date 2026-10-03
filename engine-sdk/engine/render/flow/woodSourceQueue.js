// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const quantity = () => ({ fuelKg: 0, heatAddedJ: 0, heatRemovedJ: 0 });
const add = (target, fuel, heat) => {
    target.fuelKg += fuel;
    if (heat >= 0) target.heatAddedJ += heat; else target.heatRemovedJ -= heat;
};
const finite = (value, label, minimum = -Infinity) => {
    if (!Number.isFinite(value) || value < minimum) throw new RangeError(`Invalid wood source ${label}`);
    return value;
};
const triple = (value, label, minimum = -Infinity) => {
    if (!Array.isArray(value) || value.length !== 3) throw new RangeError(`Invalid wood source ${label}`);
    return value.map(part => finite(part, label, minimum));
};
const near = (a, b) => Math.abs(a - b) <= 1e-11 + Math.max(Math.abs(a), Math.abs(b)) * 5e-5;
const sameVolume = (a, b) => ['position', 'halfSize', 'quaternion']
    .every(key => a[key].every((value, index) => value === b[key][index]));

/** Finite SI obligations between a solid thermal update and native Flow.
 * One pending volume per material face and independent fuel/heat-sign category
 * bounds active native descriptors without
 * discarding a backlog. A source can only spend its original finite budget;
 * missing fluid cells and cooling clamps leave the actual remainder queued.
 * Native failure has an unknown GPU outcome, never a guessed rollback/retry.
 */
export class WoodSourceQueue {
    constructor({ heatJPerNativeUnit, fuelKgPerNativeUnit = 1 } = {}) {
        this.heatScale = finite(heatJPerNativeUnit, 'heat calibration', Number.MIN_VALUE);
        this.fuelScale = finite(fuelKgPerNativeUnit, 'fuel calibration', Number.MIN_VALUE);
        this._faces = new Map(); this._sequences = new Map(); this._prepared = null; this._frame = -1;
        this.owner = null; this.blocked = false; this._token = 0; this.steps = 0;
        this.generated = quantity(); this.applied = quantity(); this.retired = quantity(); this.uncertain = quantity();
        this.rounding = { fuelKg: 0, heatJ: 0 }; this.retirements = []; this.failures = [];
        this.lastDelivery = null;
    }
    enqueue(batch) {
        if (this._prepared) throw new Error('Cannot replace wood source obligations during a native step');
        if (this.blocked) throw new Error('Wood source queue has an unresolved native outcome; reset the owner explicitly');
        if (!batch || typeof batch.owner !== 'string' || !batch.owner || !Number.isSafeInteger(batch.sequence) || batch.sequence < 0
            || !Array.isArray(batch.sources)) throw new RangeError('Wood source batch needs owner, sequence and sources');
        const duration = finite(batch.durationSeconds, 'batch duration', Number.MIN_VALUE), ids = new Set();
        if (batch.sequence <= (this._sequences.get(batch.owner) ?? -1)) throw new Error('Wood thermal source batch was already queued or is stale');
        const entries = batch.sources.map(source => {
            if (!Number.isInteger(source.id) || source.id < 0 || source.id > Math.floor(0xffffffff / 3) - 1 || ids.has(source.id)) throw new RangeError('Wood face source ids exceed the native category id space');
            ids.add(source.id);
            const position = triple(source.position, 'position'), halfSize = triple(source.halfSizeM, 'half extents', Number.MIN_VALUE);
            if (!Array.isArray(source.quaternion) || source.quaternion.length !== 4) throw new RangeError('Wood source needs its native orientation');
            const quaternion = source.quaternion.map(value => finite(value, 'rotation'));
            if (Math.abs(Math.hypot(...quaternion) - 1) > 1e-4) throw new RangeError('Wood source orientation must be normalized');
            const fuelRate = finite(source.fuelKgPerSecond, 'fuel rate', 0), heatRate = finite(source.gasHeatW, 'heat rate');
            return { id: source.id, owner: batch.owner, sequence: batch.sequence, position, halfSize, quaternion, fuelRate, heatRate,
                fuel: finite(fuelRate * duration, 'fuel budget', 0), heat: finite(heatRate * duration, 'heat budget') };
        }).filter(entry => entry.fuel > 0 || entry.heat !== 0);
        // Identical stationary emissions share one finite obligation. Only
        // adjacent entries with unchanged rates/geometry merge, preserving the
        // order and locations of moving faces and changing thermal histories.
        const admissions = entries.map(entry => {
            const tail = this.owner === batch.owner ? this._faces.get(entry.id)?.at(-1) : null;
            const merge = tail && tail.fuelRate === entry.fuelRate && tail.heatRate === entry.heatRate && sameVolume(tail, entry);
            return { entry, tail: merge ? tail : null,
                fuel: merge ? finite(tail.fuel + entry.fuel, 'combined fuel budget', 0) : entry.fuel,
                heat: merge ? finite(tail.heat + entry.heat, 'combined heat budget') : entry.heat };
        });
        // Fully validate a replacement before retiring the preceding owner.
        if (this.owner !== null && this.owner !== batch.owner) this.retireAll('wood assembly replaced');
        this.owner = batch.owner; this._sequences.set(batch.owner, batch.sequence);
        for (const { entry, tail, fuel, heat } of admissions) {
            if (tail) { tail.fuel = fuel; tail.heat = heat; tail.sequence = entry.sequence; }
            else {
                if (!this._faces.has(entry.id)) this._faces.set(entry.id, []);
                this._faces.get(entry.id).push(entry);
            }
            add(this.generated, entry.fuel, entry.heat);
        }
        return this.stats;
    }
    prepareStep(dt) {
        finite(dt, 'step duration', Number.MIN_VALUE);
        if (this._prepared) throw new Error('Wood source step is already pending');
        if (this.blocked) throw new Error('Wood source outcome is unresolved');
        const entries = [...this._faces.values()].flatMap(list => {
            const selected = [];
            for (let category = 0; category < 3; ++category) {
                const key = category === 0 ? 'fuel' : 'heat', sign = category === 2 ? -1 : 1;
                let head = null, remainingTime = dt, total = 0;
                const debits = [];
                for (const entry of list) {
                    const budget = entry[key] * sign;
                    if (!(budget > 0)) continue;
                    if (!head) head = entry;
                    if (!sameVolume(head, entry) || !(remainingTime > 0)) break;
                    const rate = Math.abs(entry[key + 'Rate']), amount = Math.min(budget, rate * remainingTime);
                    if (!(amount > 0)) break;
                    debits.push({ entry, fuel: key === 'fuel' ? amount : 0, heat: key === 'heat' ? amount * sign : 0 });
                    total = finite(total + amount, 'prefix budget', 0);
                    remainingTime = Math.max(0, remainingTime - amount / rate);
                }
                if (!debits.length) continue;
                // Spend the historical rate schedule sequentially within dt.
                // A sub-ULP remainder may share a request with its successor,
                // instead of permanently blocking larger later emissions.
                // Stop at a moved/rotated volume; pending gas never teleports.
                const heat = key === 'heat' ? total * sign : 0, fuel = key === 'fuel' ? total : 0;
                const combined = selected.find(item => sameVolume(item.entry, head) && !(item.heat !== 0 && heat !== 0));
                if (combined) { combined.fuel += fuel; combined.heat += heat; combined.debits.push(...debits); }
                else selected.push({ entry: head, category, fuel, heat, debits });
            }
            return selected.map(({ entry, category, fuel, heat, debits }) => {
            const requested = [heat / this.heatScale, fuel / this.fuelScale, 0, 0];
            const totalRates = requested.map(value => finite(value / dt, 'native rate'));
            const id = entry.id * 3 + category + 1;
            return { entry, debits, id, fuel, heat, requested, source: { id, layer: 0, type: 'box',
                position: [...entry.position], quaternion: [...entry.quaternion], halfSize: [...entry.halfSize], totalRates } };
            });
        });
        const prepared = { token: ++this._token, dt, entries };
        this._prepared = prepared;
        return { token: prepared.token, dt, sources: entries.map(item => item.source) };
    }
    commitStep(receipt) {
        const prepared = this._prepared;
        if (!prepared) throw new Error('No wood source step awaits a receipt');
        if (!prepared.entries.length) { this._prepared = null; ++this.steps; return this.stats; }
        if (!receipt || !Number.isSafeInteger(receipt.frame) || receipt.frame <= this._frame || !near(receipt.dt, prepared.dt)
            || !Array.isArray(receipt.sources) || receipt.sources.length !== prepared.entries.length) throw new Error('Incomplete or stale native wood source receipt');
        const byId = new Map();
        for (const item of receipt.sources) {
            if (byId.has(item.id)) throw new Error('Duplicate native wood source receipt');
            byId.set(item.id, item);
        }
        const settlements = prepared.entries.map(item => {
            const actual = byId.get(item.id);
            if (!actual || !['requested', 'applied', 'deferred'].every(key => Array.isArray(actual[key]) && actual[key].length === 4
                && actual[key].every(Number.isFinite))) throw new Error('Invalid native wood source accounting');
            for (let channel = 0; channel < 4; ++channel) {
                const asked = item.requested[channel], applied = actual.applied[channel], deferred = actual.deferred[channel];
                if (!near(actual.requested[channel], asked) || !near(applied + deferred, actual.requested[channel])
                    || Math.sign(applied) !== 0 && Math.sign(applied) !== Math.sign(asked)
                    || Math.sign(deferred) !== 0 && Math.sign(deferred) !== Math.sign(asked)
                    || Math.sign(actual.requested[channel]) !== 0 && Math.sign(actual.requested[channel]) !== Math.sign(asked)
                    || Math.abs(applied) > Math.abs(actual.requested[channel]) && !near(applied, actual.requested[channel])
                    || asked === 0 && (applied !== 0 || deferred !== 0)) throw new Error('Native wood source receipt violates its finite signed budget');
            }
            const rawFuel = actual.applied[1] * this.fuelScale, rawHeat = actual.applied[0] * this.heatScale;
            // Only native float roundoff can exceed the admitted request. Keep
            // that measured rounding residual explicit in addition to SI spend.
            const fuel = Math.max(0, Math.min(item.fuel, rawFuel));
            const heat = Math.sign(item.heat) * Math.min(Math.abs(item.heat), Math.abs(rawHeat));
            return { ...item, fuel, heat, rawFuel, rawHeat, admittedSamples: actual.admittedSamples };
        });
        const delivery = { nativeFrame: receipt.frame, sources: settlements.length,
            prefixEntries: new Set(settlements.flatMap(item => item.debits.map(debit => debit.entry))).size,
            admittedSources: 0, unadmittedSources: 0, admissionUnknownSources: 0, zeroAppliedAdmittedSources: 0,
            requested: quantity(), applied: quantity(), deferred: quantity() };
        for (const item of settlements) {
            this._spend(item, item.fuel, item.heat);
            add(this.applied, item.fuel, item.heat);
            this.rounding.fuelKg += item.rawFuel - item.fuel; this.rounding.heatJ += item.rawHeat - item.heat;
            add(delivery.requested, item.requested[1] * this.fuelScale, item.requested[0] * this.heatScale);
            add(delivery.applied, item.fuel, item.heat);
            add(delivery.deferred, item.requested[1] * this.fuelScale - item.fuel, item.requested[0] * this.heatScale - item.heat);
            if (item.admittedSamples === 0) ++delivery.unadmittedSources;
            else if (Number.isInteger(item.admittedSamples) && item.admittedSamples > 0) {
                ++delivery.admittedSources;
                if (item.fuel === 0 && item.heat === 0) ++delivery.zeroAppliedAdmittedSources;
            } else ++delivery.admissionUnknownSources;
        }
        this.lastDelivery = delivery;
        this._drainSpent(); this._frame = receipt.frame; this._prepared = null; ++this.steps;
        return this.stats;
    }
    cancelStep() {
        // Call only when admission failed before any native/GPU step began.
        if (!this._prepared) return false;
        this._prepared = null; return true;
    }
    failStep(reason) {
        if (!this._prepared) return false;
        for (const item of this._prepared.entries) {
            this._spend(item, item.fuel, item.heat);
            add(this.uncertain, item.fuel, item.heat);
        }
        this.failures.push({ reason: String(reason), token: this._prepared.token, dt: this._prepared.dt });
        this._drainSpent(); this._prepared = null; this.blocked = true;
        return true;
    }
    _spend(item, fuel, heat) {
        let remainingFuel = fuel, remainingHeat = Math.abs(heat);
        for (const debit of item.debits) {
            const takenFuel = Math.min(debit.fuel, remainingFuel), takenHeat = Math.min(Math.abs(debit.heat), remainingHeat);
            debit.entry.fuel -= takenFuel; debit.entry.heat -= Math.sign(debit.heat) * takenHeat;
            remainingFuel = Math.max(0, remainingFuel - takenFuel); remainingHeat = Math.max(0, remainingHeat - takenHeat);
        }
    }
    _drainSpent() {
        for (const [id, entries] of this._faces) {
            const remaining = entries.filter(entry => entry.fuel !== 0 || entry.heat !== 0);
            if (remaining.length) this._faces.set(id, remaining); else this._faces.delete(id);
        }
    }
    retireAll(reason) {
        if (this._prepared) throw new Error('Await native wood source completion before retiring its obligations');
        if (typeof reason !== 'string' || !reason) throw new RangeError('Wood source retirement needs an explicit reason');
        const pending = this._pending();
        this.retired.fuelKg += pending.fuelKg; this.retired.heatAddedJ += pending.heatAddedJ; this.retired.heatRemovedJ += pending.heatRemovedJ;
        this.retirements.push({ owner: this.owner, reason, quantities: pending, unresolved: this.blocked });
        this._faces.clear(); this.owner = null; this.blocked = false;
        return this.stats;
    }
    _pending() {
        const pending = quantity();
        for (const entries of this._faces.values()) for (const entry of entries) add(pending, entry.fuel, entry.heat);
        return pending;
    }
    get stats() {
        const pending = this._pending(), residual = quantity();
        for (const key of Object.keys(residual)) residual[key] = this.generated[key] - this.applied[key] - this.retired[key] - this.uncertain[key] - pending[key];
        return { owner: this.owner, generated: { ...this.generated }, applied: { ...this.applied }, pending, retired: { ...this.retired }, uncertain: { ...this.uncertain },
            nativeRounding: { ...this.rounding }, balanceResidual: residual, activeFaces: this._faces.size,
            pendingEntries: [...this._faces.values()].reduce((sum, entries) => sum + entries.length, 0),
            lastDelivery: this.lastDelivery ? structuredClone(this.lastDelivery) : null,
            steps: this.steps, pendingStep: !!this._prepared, blocked: this.blocked,
            retirements: this.retirements.map(item => ({ ...item, quantities: { ...item.quantities } })), failures: this.failures.map(item => ({ ...item })) };
    }
}
