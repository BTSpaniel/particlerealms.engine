// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { extractAmbientWgslFunctions } from '../schema/AmbientNativeAppearance.js';
import { hasFiniteAmbientWaterState } from '../schema/AmbientFiniteWaterContract.js';

/** Opt in only through the actual saved pure marker, never a recipe name. */
export function ambientProgramHasVersionedWater(source) {
    if (typeof source !== 'string') return false;
    if (hasFiniteAmbientWaterState(source)) return true;
    const marker=extractAmbientWgslFunctions(source).find(fn=>fn.name==='ambientWaterSurfaceVersion');
    return !!marker && /^\s*return\s+2u\s*;\s*$/.test(marker.body.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g,''));
}

/** Project a submitted water phase without the legacy shader's rewind flag.
 * The host clock already freezes phase; neutral interaction inputs preserve
 * Still's hover/click suppression while saved time expressions keep that phase.
 * An absent transaction leaves an older program's frame byte-for-byte intact.
 */
export function projectAmbientProgramWaterFrame(frame, transaction, { previousTime=0, paused=false, timeOverride=null } = {}) {
    if (!transaction) return frame;
    const time = timeOverride === null ? transaction.time : timeOverride;
    if (!Number.isFinite(time) || time<0 || !Number.isFinite(previousTime) || previousTime<0) {
        throw new TypeError('Projected water phase must be finite and nonnegative');
    }
    const projected = {
        ...frame,
        resolutionTime: [frame.resolutionTime[0],frame.resolutionTime[1],time,
            paused||timeOverride!==null?0:Math.max(0,time-previousTime)],
        tone: [1,...frame.tone.slice(1)],
    };
    if (frame.effects) projected.effects = [paused?0:frame.effects[0],frame.effects[1],frame.effects[2],0];
    if (paused) {
        if (frame.pointer) projected.pointer = [-1,-1,0,0];
        if (frame.pointerState) projected.pointerState = [0,0,0,0];
        if (frame.clickActivity) projected.clickActivity = [-1,-1,60,0];
        if (frame.gesture) projected.gesture = {shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,buttons:0};
    }
    return projected;
}

/** A phase belongs to successfully submitted frames. Preparation is read-only;
 * speed changes affect subsequent increments and frozen frames retain phase. */
export function createAmbientProgramWaterClock({time=0} = {}) {
    if (!Number.isFinite(time) || time<0) throw new TypeError('Water clock time must be finite and nonnegative');
    let committed=time,revision=0;
    return Object.freeze({
        get time(){return committed;},
        prepare({deltaSeconds=0,speed=1,paused=false,advance=false} = {}) {
            if (!Number.isFinite(deltaSeconds) || !Number.isFinite(speed)) throw new TypeError('Water clock frame values must be finite');
            const base=revision, next=committed+(advance&&!paused?Math.min(.1,Math.max(0,deltaSeconds))*Math.min(4,Math.max(0,speed)):0);
            let settled=false;
            return Object.freeze({time:next,commit(){if(settled||base!==revision)return false;settled=true;committed=next;revision++;return true;},abort(){if(settled)return false;settled=true;return true;}});
        },
    });
}
