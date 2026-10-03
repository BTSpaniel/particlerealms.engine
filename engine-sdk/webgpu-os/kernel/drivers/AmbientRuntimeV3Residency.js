// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// One physical-device ledger covers allocations before asynchronous lane
// construction, active owners, and deferred destruction. Reservations outlive
// cancellation until the constructor has unwound and the owner's fence settles.
const deviceRetirements = new WeakMap();

function ledgerFor(device) {
    let ledger=deviceRetirements.get(device);
    if(ledger) return ledger;
    ledger={records:new Map(),lost:false,listeners:new Set()};deviceRetirements.set(device,ledger);
    let lost;
    try {lost=device.lost;} catch {}
    if(lost?.then) void Promise.resolve(lost).then(()=>{
        ledger.lost=true;ledger.records.clear();notifyResidency(ledger);
    },()=>{});
    return ledger;
}

function notifyResidency(ledger) {
    for(const listener of [...ledger.listeners]) listener();
}

/** A preview waits for earlier constructors and their existing retirement
 * fences. Notifications come from the ledger; no polling clock or submission
 * is introduced. Active last-valid frames keep their exact reservations. */
export async function reserveAmbientWaterConstructionAfterRetirements(device,owner,minimumBytes,{signal,fullEnvelope=false}={}) {
    const ledger=ledgerFor(device);
    while(true) {
        signal?.throwIfAborted();
        if(ledger.lost) throw new Error('Ambient water device was lost during retirement.');
        const pending=[...ledger.records.values()].filter(record=>record.state!=='active');
        // Reservation and the empty-pending check are synchronous together:
        // two awakened previews cannot both claim the same capacity.
        if(!pending.length) return reserveAmbientWaterConstruction(device,owner,minimumBytes,{fullEnvelope});
        if(pending.some(record=>record.failed)) throw new Error('An existing water retirement fence failed; its GPU reservation remains.');
        await new Promise((resolve,reject)=>{
            const remove=()=>{ledger.listeners.delete(changed);signal?.removeEventListener('abort',aborted);};
            const changed=()=>{remove();resolve();};
            const aborted=()=>{remove();reject(signal.reason??new Error('Ambient water retirement wait was aborted.'));};
            ledger.listeners.add(changed);signal?.addEventListener('abort',aborted,{once:true});
        });
    }
}

/** Caller supplies the existing device owner's queue fence; this module
 * acquires no device, encodes no commands and never submits a queue. */
export function retainAmbientWaterRetirement(device,owner,bytes,completion,settled=Promise.resolve()) {
    if(!Number.isSafeInteger(bytes)||bytes<0) throw new RangeError('Ambient retired bytes must be a nonnegative integer.');
    const ledger=ledgerFor(device);
    if(ledger.lost) return;
    const previous=ledger.records.get(owner);
    if(previous?.state==='retired') return;
    // A rejected constructor may have no returned lane diagnostics. Its full
    // envelope is still required until that constructor's cleanup is complete.
    bytes=Math.max(bytes,previous?.bytes??0);
    if(!bytes){ledger.records.delete(owner);notifyResidency(ledger);return;}
    const record={bytes,state:'retired',failed:false};ledger.records.set(owner,record);notifyResidency(ledger);
    void Promise.all([completion,settled]).then(()=>{
        if(ledger.records.get(owner)===record) {ledger.records.delete(owner);notifyResidency(ledger);}
    },()=>{record.failed=true;notifyResidency(ledger);});
}

export function ambientWaterRetirementSnapshot(device) {
    const ledger=deviceRetirements.get(device);let bytes=0,count=0,failed=0;
    if(ledger) for(const record of ledger.records.values()) if(record.state==='retired') {
        bytes+=record.bytes;count++;if(record.failed)failed++;
    }
    return Object.freeze({bytes,count,failed});
}

export function ambientWaterRetiredBytes(device) {return ambientWaterRetirementSnapshot(device).bytes;}

export const AMBIENT_WATER_RESIDENCY_LIMIT_BYTES=64*1024*1024;

/** Synchronous admission precedes every candidate allocation. Heavy lanes
 * reserve the remaining envelope; stateless programs reserve exact host bytes. */
export function reserveAmbientWaterConstruction(device,owner,minimumBytes,{fullEnvelope=false}={}) {
    if(!Number.isSafeInteger(minimumBytes)||minimumBytes<0) throw new RangeError('Ambient construction bytes must be a nonnegative integer.');
    const ledger=ledgerFor(device);
    if(ledger.lost||ledger.records.has(owner)) throw new Error('Ambient construction owner is unavailable.');
    const available=AMBIENT_WATER_RESIDENCY_LIMIT_BYTES-ambientWaterResidentBytes(device);
    if(minimumBytes>available) throw new RangeError('Existing and constructing water resources occupy the shared 64 MiB GPU budget.');
    const bytes=fullEnvelope?available:minimumBytes;
    ledger.records.set(owner,{bytes,state:'constructing',failed:false});
    return bytes;
}

/** The caller refreshes the owner's exact descriptor total after bounded lane
 * allocation. Excluding this owner prevents active/candidate double counting. */
export function updateAmbientWaterResidency(device,owner,bytes) {
    if(!Number.isSafeInteger(bytes)||bytes<0) throw new RangeError('Ambient resident bytes must be a nonnegative integer.');
    const ledger=ledgerFor(device),record=ledger.records.get(owner);
    if(ledger.lost) return false;
    if(!record||record.state==='retired') throw new Error('Ambient residency owner is unavailable.');
    if(bytes+ambientWaterResidentBytes(device,owner)>AMBIENT_WATER_RESIDENCY_LIMIT_BYTES) {
        throw new RangeError('Ambient active resources exceed the shared 64 MiB GPU budget.');
    }
    record.bytes=bytes;record.state='active';notifyResidency(ledger);return true;
}

export function ambientWaterResidentBytes(device,excludeOwner=null) {
    const ledger=deviceRetirements.get(device);let bytes=0;
    if(ledger) for(const [owner,record] of ledger.records) if(owner!==excludeOwner) bytes+=record.bytes;
    return bytes;
}

export function ambientWaterResidencySnapshot(device) {
    const ledger=deviceRetirements.get(device);let bytes=0,constructingBytes=0,activeBytes=0,retiredBytes=0,constructing=0,active=0,retired=0,failed=0;
    if(ledger) for(const record of ledger.records.values()) {
        bytes+=record.bytes;
        if(record.state==='constructing'){constructing++;constructingBytes+=record.bytes;}
        else if(record.state==='active'){active++;activeBytes+=record.bytes;}
        else {retired++;retiredBytes+=record.bytes;if(record.failed)failed++;}
    }
    return Object.freeze({bytes,constructingBytes,activeBytes,retiredBytes,constructing,active,retired,failed});
}
