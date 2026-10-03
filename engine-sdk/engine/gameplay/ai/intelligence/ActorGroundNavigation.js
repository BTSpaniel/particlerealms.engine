// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { findPathOnGrid } from '../../../sim/ai/Pathfinder.js';
import { worldToGrid, isCellWalkable } from '../../../sim/ai/NavGrid.js';
import { copyActorTaskData, sameActorTaskData } from './RegisteredMethods.js';

/**
 * Host-owned ground-navigation adapter. The supplied grid must already encode
 * this body's clearance and access constraints. Its body resolves every move
 * against real collision geometry; pathfinding alone is not collision proof.
 * No body, clock, timer or authority is allocated here.
 */
export function createActorGroundNavigation({ actorId, bodyId, body, readWorld,
    resolveAnchor, assertCurrent, assertAuthorized, arrivalRadius = 0.15, maxIterations = 8192 } = {}) {
    const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(value);
    if (!id(actorId) || !id(bodyId)) throw new TypeError('Navigation requires actor and body identities');
    for (const name of ['readPose', 'setIntent', 'step', 'stop']) if (typeof body?.[name] !== 'function') throw new TypeError(`Navigation body requires ${name}`);
    for (const fn of [readWorld, resolveAnchor, assertCurrent, assertAuthorized]) if (typeof fn !== 'function') throw new TypeError('Navigation requires host authority and geometry providers');
    if (!Number.isFinite(arrivalRadius) || arrivalRadius <= 0 || arrivalRadius > 1
        || !Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 65536) throw new RangeError('Invalid navigation budget');
    let disposed = false, active = null, waypoint = 0, phase = 'idle', lastMeasured = null;
    let routeSequence = 0;
    const routes = new Map();
    const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
    const current = () => {
        if (disposed) fail('ACTOR_NAVIGATION_DISPOSED', 'Navigation is disposed');
        if (assertCurrent() !== true) fail('ACTOR_NAVIGATION_STALE', 'Actor world generation changed');
    };
    const vector = value => Array.isArray(value) && value.length === 3 && value.every(v => Number.isFinite(v) && Math.abs(v) <= 1_000_000);
    const pose = () => {
        current();
        const result = body.readPose();
        current();
        if (result?.then || result?.bodyId !== bodyId || !vector(result.position)) fail('ACTOR_NAVIGATION_POSE', 'Navigation requires a measured pose for its exact body');
        lastMeasured = Object.freeze([...result.position]);
        return lastMeasured;
    };
    const world = () => {
        current();
        const value = readWorld();
        current();
        if (value?.then || !id(value?.worldId) || !Number.isSafeInteger(value.revision) || value.revision < 0
            || value.units !== 'metres' || value.frame !== 'world') fail('ACTOR_NAVIGATION_WORLD', 'Expected a revisioned world frame in metres');
        return value;
    };
    const gridShape = grid => {
        if (!Number.isSafeInteger(grid?.width) || !Number.isSafeInteger(grid?.height)
            || grid.width < 1 || grid.height < 1 || grid.width * grid.height > 65536
            || !Number.isFinite(grid.cellSize) || grid.cellSize <= 0
            || !Number.isFinite(grid.originX) || !Number.isFinite(grid.originZ)
            || grid.walkable?.length !== grid.width * grid.height) {
            fail('ACTOR_NAVIGATION_GRID', 'Navigation requires a bounded admitted clearance grid');
        }
        return Object.freeze({ width: grid.width, height: grid.height, cellSize: grid.cellSize,
            originX: grid.originX, originZ: grid.originZ });
    };
    const cell = (grid, position) => worldToGrid(grid, position[0], position[2]);
    const sameCell = (left, right) => left.gx === right.gx && left.gz === right.gz;
    const distance = (left, right) => Math.hypot(...left.map((v, i) => v - right[i]));
    const stopOwned = (reason = 'paused') => {
        active = null; waypoint = 0; phase = reason;
        const result = body.stop(reason);
        if (result?.then) fail('ACTOR_NAVIGATION_STOP_ASYNC', 'The owner must synchronously retire movement');
        if (result === false) fail('ACTOR_NAVIGATION_STOP_REJECTED', 'The body did not acknowledge retirement');
        return Object.freeze({ actorId, bodyId, status: phase, arrived: false });
    };
    const stop = (reason = 'paused') => { current(); return stopOwned(reason); };
    const stopAfterFailure = () => {
        if (disposed) return;
        // The host retires motion before revoking/reassigning its body lease.
        // An old adapter must never stop the next owner's body after handoff.
        let owned = false;
        try { owned = assertCurrent() === true; } catch { /* Preserve the original failure. */ }
        if (owned) stopOwned('blocked');
        else { active = null; waypoint = 0; phase = 'retired'; }
    };
    const validate = route => {
        current();
        const candidate = copyActorTaskData(route);
        const saved = routes.get(candidate.routeId);
        if (!saved || !sameActorTaskData(candidate, saved)) fail('ACTOR_NAVIGATION_ROUTE', 'Route was not prepared by this actor or its descriptor changed');
        const currentWorld = world();
        if (currentWorld.worldId !== saved.worldId || currentWorld.revision !== saved.worldRevision) fail('ACTOR_NAVIGATION_STALE', 'Route world revision changed');
        if (!sameActorTaskData(gridShape(currentWorld.grid), saved.grid)) fail('ACTOR_NAVIGATION_STALE', 'Route grid coordinates changed');
        const anchor = resolveAnchor(saved.targetRef, { actorId, worldId: saved.worldId });
        if (anchor?.then || anchor?.available !== true || anchor.id !== saved.targetRef
            || anchor.revision !== saved.targetRevision || !vector(anchor.position)
            || distance(anchor.position, saved.target) > 0) fail('ACTOR_NAVIGATION_TARGET_STALE', 'Destination identity, position or accessibility changed');
        return saved;
    };
    const corridor = (route, measured, index) => {
        const scope = world();
        if (scope.worldId !== route.worldId || scope.revision !== route.worldRevision
            || !sameActorTaskData(gridShape(scope.grid), route.grid)) fail('ACTOR_NAVIGATION_STALE', 'Route world or grid changed');
        const currentCell = cell(scope.grid, measured);
        const nextCell = cell(scope.grid, route.waypoints[Math.min(index, route.waypoints.length - 1)]);
        const previousCell = cell(scope.grid, index > 0 ? route.waypoints[Math.min(index - 1, route.waypoints.length - 1)] : route.startPosition);
        if (Math.abs(measured[1] - route.target[1]) > route.waypointRadius
            || !isCellWalkable(scope.grid, currentCell.gx, currentCell.gz)
            || !isCellWalkable(scope.grid, nextCell.gx, nextCell.gz)
            || !isCellWalkable(scope.grid, previousCell.gx, previousCell.gz)
            || (!sameCell(currentCell, nextCell) && !sameCell(currentCell, previousCell))) {
            fail('ACTOR_NAVIGATION_OFF_CORRIDOR', 'Measured body left the admitted ground segment; a new route is required');
        }
    };
    const reached = (route, measured, target) => sameCell(cell(route.grid, measured), cell(route.grid, target))
        && distance(measured, target) <= route.waypointRadius;
    const result = () => Object.freeze({ actorId, bodyId, status: phase,
        arrived: phase === 'arrived', measuredPosition: lastMeasured, waypoint,
        targetRef: active?.targetRef ?? null });
    return Object.freeze({
        resolveTarget({ actorId: requestedActor, targetRef } = {}) {
            current();
            if (requestedActor !== actorId || !id(targetRef)) fail('ACTOR_NAVIGATION_IDENTITY', 'Navigation cannot resolve another actor or an arbitrary coordinate');
            if (routes.size >= 128) return Object.freeze({ status: 'budget-exhausted', reason: 'retained-route-limit' });
            const scope = world();
            if (!scope.grid) return Object.freeze({ status: 'unavailable', reason: 'navigation-grid-unavailable' });
            const grid = gridShape(scope.grid);
            // Adjacent path-cell centres must never share an acceptance radius.
            // The host body must be able to reach this route's declared radius.
            const waypointRadius = Math.min(arrivalRadius, grid.cellSize / 4);
            const anchor = resolveAnchor(targetRef, { actorId, worldId: scope.worldId });
            if (anchor?.then) fail('ACTOR_NAVIGATION_ANCHOR_ASYNC', 'Anchor lookup must be an owner snapshot');
            if (anchor?.available !== true) return Object.freeze({ status: 'unavailable', reason: 'destination-unavailable' });
            if (anchor.id !== targetRef || !Number.isSafeInteger(anchor.revision) || anchor.revision < 0 || !vector(anchor.position)) fail('ACTOR_NAVIGATION_ANCHOR', 'Invalid destination anchor');
            const position = pose();
            const startCell = cell(scope.grid, position);
            if (!isCellWalkable(scope.grid, startCell.gx, startCell.gz)) return Object.freeze({ status: 'blocked', reason: 'start-cell-unavailable' });
            if (Math.abs(position[1] - anchor.position[1]) > waypointRadius) return Object.freeze({ status: 'unsupported', reason: 'ground-layer-change' });
            const path = findPathOnGrid(scope.grid, { x: position[0], z: position[2] },
                { x: anchor.position[0], z: anchor.position[2] }, { maxIterations, allowDiagonal: false });
            if (path.status !== 'ok') return Object.freeze({ status: path.iterations >= maxIterations ? 'budget-exhausted' : 'blocked', reason: path.status });
            if (path.waypoints.length > 4096) return Object.freeze({ status: 'budget-exhausted', reason: 'route-length' });
            const points = path.waypoints.map(point => Object.freeze([point.x, anchor.position[1], point.z]));
            points.push(Object.freeze([...anchor.position]));
            const route = Object.freeze({ status: 'ready', routeId: `route:${++routeSequence}`, actorId, bodyId, targetRef, worldId: scope.worldId,
                worldRevision: scope.revision, targetRevision: anchor.revision, frame: 'world', units: 'metres',
                grid, waypointRadius, startPosition: Object.freeze([...position]),
                target: Object.freeze([...anchor.position]), waypoints: Object.freeze(points) });
            routes.set(route.routeId, route);
            return route;
        },
        start(route) {
            try {
                const saved = validate(route);
                if (assertAuthorized({ actorId, bodyId, operation: 'move', route: saved }) !== true) fail('ACTOR_NAVIGATION_AUTHORITY', 'Movement is not authorized');
                const measured = pose();
                if (distance(measured, saved.startPosition) !== 0) fail('ACTOR_NAVIGATION_START_STALE', 'Body moved after route preparation; a new route is required');
                corridor(saved, measured, 0);
                stop('replaced'); active = saved; waypoint = 0; phase = 'moving';
                return result();
            } catch (error) { stopAfterFailure(); throw error; }
        },
        step(deltaSeconds) {
            if (!active) { current(); return result(); }
            try {
                validate(active);
                if (assertAuthorized({ actorId, bodyId, operation: 'move', route: active }) !== true) fail('ACTOR_NAVIGATION_AUTHORITY', 'Movement authority ended');
                if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || deltaSeconds > 0.1) fail('ACTOR_NAVIGATION_TICK', 'Host ticks must be between zero and 100 ms');
                let measured = pose();
                corridor(active, measured, waypoint);
                while (waypoint < active.waypoints.length && reached(active, measured, active.waypoints[waypoint])) waypoint += 1;
                if (waypoint === active.waypoints.length) {
                    const completed = active;
                    stop('arrived'); active = completed; waypoint = completed.waypoints.length;
                    return result();
                }
                corridor(active, measured, waypoint);
                current();
                const accepted = body.setIntent({ target: active.waypoints[waypoint], mode: 'walk' });
                if (accepted?.then || accepted === false) fail('ACTOR_NAVIGATION_INTENT', 'Body did not accept a synchronous ground intent');
                current();
                const stepped = body.step(deltaSeconds);
                if (stepped?.then || stepped === false) fail('ACTOR_NAVIGATION_STEP', 'Body did not step synchronously');
                measured = pose();
                corridor(active, measured, waypoint);
                if (waypoint === active.waypoints.length - 1 && reached(active, measured, active.target)) {
                    const completed = active; stop('arrived'); active = completed; waypoint = completed.waypoints.length;
                }
                return result();
            } catch (error) { stopAfterFailure(); throw error; }
        },
        observeArrival(route) {
            const saved = validate(route);
            return Object.freeze({ actorId, bodyId, targetRef: saved.targetRef, arrived: reached(saved, pose(), saved.target),
                measuredPosition: lastMeasured, worldRevision: saved.worldRevision, targetRevision: saved.targetRevision });
        },
        releaseRoute(routeId) {
            current();
            if (active?.routeId === routeId && phase === 'moving') fail('ACTOR_NAVIGATION_ROUTE_ACTIVE', 'Stop movement before releasing its route');
            return routes.delete(routeId);
        },
        stop,
        status() { current(); return result(); },
        dispose() {
            if (!disposed) {
                try { if (assertCurrent() === true) stopOwned('disposed'); }
                finally { disposed = true; active = null; waypoint = 0; phase = 'disposed'; lastMeasured = null; routes.clear(); }
            }
        },
    });
}
