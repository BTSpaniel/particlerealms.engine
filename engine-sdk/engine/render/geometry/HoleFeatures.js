// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HoleFeatures.js — machined hole cutters: through, countersunk, counterbored,
 * counterdrilled, tapped and blind.
 *
 * A hole is a SOLID that gets subtracted, not a hole primitive. Building each one
 * as a silhouette revolved about its own axis means the resulting geometry is
 * exact for the straight and conical faces, composes with the exact BSP boolean
 * in PolyhedralCsg, and carries the real machinist dimensions — clearance
 * diameter, head angle, bore depth — rather than an approximation.
 *
 * Cutters are generated along +Y (the revolve axis) with the hole MOUTH at y = 0
 * and the hole running DOWNWARD into the material. Callers position and orient
 * them; `holeCutterTree` emits the CSG node so a document can subtract one
 * without touching mesh data at all.
 *
 * Every cutter deliberately overshoots the mouth by a small margin so a boolean
 * against a coplanar face cannot leave a skin of material behind — coplanar
 * subtraction faces are the classic way a "through" hole ends up blind.
 */

import { circleProfile, makeProfile } from './Profile2D.js';
import { revolveProfile } from './ProfileSolidGeometry.js';

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

export const HOLE_KINDS = Object.freeze([
    'through', 'blind', 'countersunk', 'counterbored', 'counterdrilled', 'tapped',
]);

function positive(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`HoleFeatures: ${label} must be a positive finite number`);
    }
    return number;
}

function nonNegative(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`HoleFeatures: ${label} must be a non-negative finite number`);
    }
    return number;
}

/**
 * Silhouette of a hole cutter in (radius, y), mouth at y = 0, running to -depth.
 *
 * Returned as an open polyline from the axis at the mouth, out along the mouth
 * face, down the bore, across the bottom and back to the axis. `revolveProfile`
 * closes it about the axis.
 */
export function holeSilhouette(spec = {}) {
    const kind = String(spec.kind ?? 'through');
    if (!HOLE_KINDS.includes(kind)) {
        throw new Error(`HoleFeatures: unknown hole kind '${kind}' (${HOLE_KINDS.join('|')})`);
    }
    const diameter = positive(spec.diameterMeters, 'diameterMeters');
    const radius = diameter / 2;
    const depth = positive(spec.depthMeters, 'depthMeters');
    // Overshoot the mouth so a coplanar boolean face cannot leave a skin.
    const overshoot = Math.max(diameter * 0.02, 1e-5);

    const points = [];
    const add = (r, y) => points.push([r, y]);

    if (kind === 'countersunk' || kind === 'counterdrilled') {
        // A conical seat for a flat-head screw. `headAngleDegrees` is the INCLUDED
        // angle, the way a drill or a screw head is actually specified (82 deg is
        // the imperial standard, 90 deg metric), so the cone half-angle is half it.
        const headDiameter = positive(spec.headDiameterMeters, 'headDiameterMeters');
        if (headDiameter <= diameter) {
            throw new Error('HoleFeatures: headDiameterMeters must exceed diameterMeters');
        }
        const included = Number(spec.headAngleDegrees ?? 90);
        if (!Number.isFinite(included) || included <= 0 || included >= 180) {
            throw new Error('HoleFeatures: headAngleDegrees must be within 0..180 exclusive');
        }
        const headRadius = headDiameter / 2;
        // Cone depth follows from the geometry: tan(half-angle) = dr / dy.
        const coneDepth = (headRadius - radius) / Math.tan((included / 2) * DEG);
        if (coneDepth >= depth) {
            throw new Error('HoleFeatures: the countersink cone is deeper than the hole');
        }
        add(0, overshoot);
        add(headRadius, overshoot);
        add(headRadius, 0);
        add(radius, -coneDepth);
        if (kind === 'counterdrilled') {
            // Counterdrilled: cone, then a parallel clearance bore, then the pilot.
            const boreDepth = positive(spec.boreDepthMeters, 'boreDepthMeters');
            if (coneDepth + boreDepth >= depth) {
                throw new Error('HoleFeatures: cone plus bore is deeper than the hole');
            }
            const pilotRadius = positive(spec.pilotDiameterMeters, 'pilotDiameterMeters') / 2;
            if (pilotRadius >= radius) {
                throw new Error('HoleFeatures: pilotDiameterMeters must be smaller than diameterMeters');
            }
            add(radius, -(coneDepth + boreDepth));
            add(pilotRadius, -(coneDepth + boreDepth));
            add(pilotRadius, -depth);
            add(0, -depth);
            return makeSilhouette(points);
        }
        add(radius, -depth);
        add(0, -depth);
        return makeSilhouette(points);
    }

    if (kind === 'counterbored') {
        // A flat-bottomed recess for a socket-head cap screw.
        const boreDiameter = positive(spec.boreDiameterMeters, 'boreDiameterMeters');
        if (boreDiameter <= diameter) {
            throw new Error('HoleFeatures: boreDiameterMeters must exceed diameterMeters');
        }
        const boreDepth = positive(spec.boreDepthMeters, 'boreDepthMeters');
        if (boreDepth >= depth) {
            throw new Error('HoleFeatures: boreDepthMeters must be shallower than depthMeters');
        }
        const boreRadius = boreDiameter / 2;
        add(0, overshoot);
        add(boreRadius, overshoot);
        add(boreRadius, -boreDepth);
        add(radius, -boreDepth);
        add(radius, -depth);
        add(0, -depth);
        return makeSilhouette(points);
    }

    if (kind === 'tapped') {
        // Threaded holes are cut at the PITCH diameter, not the crest: a tapped
        // hole's clearance is what the mating thread engages, and cutting at the
        // nominal crest diameter would leave a bolt loose in it. The helix itself
        // is a cosmetic detail no boolean needs.
        const pitch = positive(spec.threadPitchMeters, 'threadPitchMeters');
        // ISO metric: pitch diameter = nominal - 0.6495 * pitch.
        const pitchRadius = (diameter - 0.6495 * pitch) / 2;
        if (pitchRadius <= 0) {
            throw new Error('HoleFeatures: threadPitchMeters is too coarse for this diameter');
        }
        add(0, overshoot);
        add(pitchRadius, overshoot);
        add(pitchRadius, -depth);
        add(0, -depth);
        return makeSilhouette(points);
    }

    // Through and blind share one straight bore. A blind hole may carry a conical
    // point left by the drill tip; a through hole simply overshoots both faces.
    const tipAngle = kind === 'blind' ? Number(spec.tipAngleDegrees ?? 0) : 0;
    const bottomOvershoot = kind === 'through' ? overshoot : 0;
    add(0, overshoot);
    add(radius, overshoot);
    if (tipAngle > 0 && tipAngle < 180) {
        const tipDepth = radius / Math.tan((tipAngle / 2) * DEG);
        add(radius, -(depth - tipDepth));
        add(0, -depth);
        return makeSilhouette(points);
    }
    add(radius, -(depth + bottomOvershoot));
    add(0, -(depth + bottomOvershoot));
    return makeSilhouette(points);
}

function makeSilhouette(points) {
    // Drop any zero-length step so the revolve never sees a duplicate station.
    const cleaned = [];
    for (const point of points) {
        const last = cleaned[cleaned.length - 1];
        if (last && Math.abs(last[0] - point[0]) < EPSILON && Math.abs(last[1] - point[1]) < EPSILON) continue;
        cleaned.push([point[0], point[1]]);
    }
    if (cleaned.length < 3) throw new Error('HoleFeatures: silhouette collapsed');
    return cleaned;
}

/**
 * Cutter solid for a hole, revolved about +Y with its mouth at the origin.
 *
 * Subtract this from a part to make the hole. Exact for straight and conical
 * faces; the only approximation is the revolve tessellation, so `segments`
 * belongs in the caller's geometry key.
 */
export function holeCutter(spec = {}, { segments = 24 } = {}) {
    const silhouette = holeSilhouette(spec);
    return revolveProfile(makeProfile(silhouette), {
        angleDegrees: 360,
        segments: Math.max(8, Math.floor(segments)),
    });
}

/**
 * The same hole as a CSG node, ready to drop into a `csg` tree.
 *
 * `atMeters` places the mouth and `axis` picks which way the hole runs, so a
 * document can author "M8 counterbore, 12 mm deep, through this plate" without
 * ever handling mesh data.
 */
export function holeCutterTree(spec = {}, {
    atMeters = [0, 0, 0],
    axis = '-y',
    segments = 24,
} = {}) {
    const silhouette = holeSilhouette(spec);
    // The silhouette is authored mouth-down along -Y, which `revolve` reproduces.
    // Re-aiming is a rotation of the whole cutter, never a rebuild of the profile.
    const rotate = {
        '-y': [0, 0, 0],
        '+y': [180, 0, 0],
        '+x': [0, 0, -90],
        '-x': [0, 0, 90],
        '+z': [90, 0, 0],
        '-z': [-90, 0, 0],
    }[String(axis)];
    if (rotate == null) {
        throw new Error(`HoleFeatures: axis '${axis}' must be one of -y,+y,+x,-x,+z,-z`);
    }
    return {
        shape: 'revolve',
        profile: { kind: 'polygon', points: silhouette },
        angleDegrees: 360,
        segments: Math.max(8, Math.floor(segments)),
        translate: [...atMeters],
        rotate,
    };
}

/**
 * Exact material volume a hole removes, from the revolved silhouette.
 *
 * Pappus applied per silhouette edge: a revolved polyline encloses
 * V = 2*pi * integral(r * dA), which for a closed polygon reduces to the
 * cross-product form below. Used to check cutters against hand calculation
 * rather than eyeballing a mesh.
 */
export function holeCutterVolume(spec = {}) {
    const points = holeSilhouette(spec);
    // Signed volume of the solid of revolution about the y axis:
    // V = (pi/3) * sum over edges of (r0^2 + r0*r1 + r1^2) * (y0 - y1).
    let volume = 0;
    for (let index = 0; index < points.length; index++) {
        const [r0, y0] = points[index];
        const [r1, y1] = points[(index + 1) % points.length];
        volume += (r0 * r0 + r0 * r1 + r1 * r1) * (y0 - y1);
    }
    return Math.abs((Math.PI / 3) * volume);
}

// ── Emboss / deboss ──────────────────────────────────────────────────────────

const EMBOSS_AXES = Object.freeze({
    '+y': [0, 0, 0],
    '-y': [180, 0, 0],
    '+x': [0, 90, 0],
    '-x': [0, -90, 0],
    '+z': [-90, 0, 0],
    '-z': [90, 0, 0],
});

/**
 * Raise (`emboss`) or recess (`deboss`) a 2D profile on a face.
 *
 * Both are the same solid — a prism of the profile, standing on the face — used
 * with a different boolean: union to raise it, subtract to sink it. Returning a
 * CSG node rather than a mesh means an embossed logo, a recessed nameplate or a
 * raised rib all compose through the exact BSP path and keep their sharp arrises.
 *
 * `draftDegrees` tapers the sides, which is what makes a real moulded or cast
 * emboss releasable from its tool; it defaults to 0 for machined work.
 *
 * @param {object} profileSpec A ForgeSource profile spec (kind + dimensions).
 * @param {object} options
 * @param {number} options.heightMeters Raise height, or recess depth.
 * @param {number[]} [options.atMeters] Where on the face the feature sits.
 * @param {'+y'|'-y'|'+x'|'-x'|'+z'|'-z'} [options.faceNormal] Which way it stands.
 * @param {number} [options.draftDegrees]
 * @param {'emboss'|'deboss'} [options.mode]
 * @param {number} [options.embedMeters] How far the prism sinks into the face.
 * @returns {{op:string, nodes:object[]}} a CSG operation ready to apply to a solid.
 */
export function embossFeature(profileSpec, {
    heightMeters,
    atMeters = [0, 0, 0],
    faceNormal = '+y',
    draftDegrees = 0,
    mode = 'emboss',
    embedMeters = null,
} = {}) {
    const height = positive(heightMeters, 'heightMeters');
    if (mode !== 'emboss' && mode !== 'deboss') {
        throw new Error(`HoleFeatures: emboss mode '${mode}' must be 'emboss' or 'deboss'`);
    }
    const rotate = EMBOSS_AXES[String(faceNormal)];
    if (rotate == null) {
        throw new Error(`HoleFeatures: faceNormal '${faceNormal}' must be one of ${Object.keys(EMBOSS_AXES).join(',')}`);
    }
    const draft = nonNegative(draftDegrees, 'draftDegrees');
    if (draft >= 90) throw new Error('HoleFeatures: draftDegrees must be below 90');
    // Sink the prism slightly into the face so neither boolean leaves a coplanar
    // seam: an emboss must fuse to the surface, and a deboss must break it.
    const embed = embedMeters == null ? Math.max(height * 0.05, 1e-5) : nonNegative(embedMeters, 'embedMeters');
    const depth = height + embed;
    return Object.freeze({
        op: mode === 'emboss' ? 'union' : 'subtract',
        // The prism is extruded along its own +Z then rotated so that +Z aligns
        // with the requested face normal; the -embed shift puts the base under
        // the surface and the crest exactly `height` above it.
        nodes: Object.freeze([Object.freeze({
            shape: 'extrude',
            profile: profileSpec,
            depth,
            draftDegrees: draft,
            translate: Object.freeze([...atMeters]),
            rotate: Object.freeze([...rotate]),
            embedMeters: embed,
        })]),
    });
}

export default holeCutter;
