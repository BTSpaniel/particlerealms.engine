// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { RopeMeshRenderer } from '../mesh/RopeMeshRenderer.js';
import oilVisual from '../../sim/particles/substances/materials/oil/visual.js';
import acidVisual from '../../sim/particles/substances/materials/acid/visual.js';
import { SURFACE_OIL_PROFILE, SURFACE_ACID_PROFILE, SURFACE_LIQUID_CLOSURE } from '../../sim/surfaceFields/SurfaceFieldChemistry.js';

/** Reuses the woven/rope tube shader for native suspension hardware and
 * material-colored strand segments. Updated only on completed material ticks. */
export class SurfaceFieldSupportRenderer {
    constructor(device) {
        this.mesh = new RopeMeshRenderer(device);
        this.mesh.maxVertices = 8192; this.mesh.maxIndices = 32768;
        this.mesh.sides = 8; this.mesh.subdivisions = 1;
    }
    async initialize(format, { reverseZ = false } = {}) {
        if (typeof reverseZ !== 'boolean') throw new TypeError('Surface support renderer reverseZ must be boolean');
        await this.mesh.init(format, reverseZ ? 'depth32float' : 'depth24plus', { reverseZ }); return this;
    }
    upload(supports, geometry, materialFrames, rods) {
        const definitions = new Map(supports.map(support => [support.id, support]));
        const materials = new Map(materialFrames.map(frame => [`${frame.id}:${frame.segment}`, frame]));
        const views = rods.map(rod => ({ ropeId: rod.id, segmentIds: [`${rod.id}:span`], positions: [rod.start, rod.end],
            radiusMeters: rod.radiusM, material: { color: [.28, .33, .38, 1], roughness: .28, sheenStrength: .8, anisotropy: .1, twistRate: 0 } }));
        for (const strand of geometry) {
            const support = definitions.get(strand.id), steel = support.material === 'carbon-steel';
            for (let segment = 0; segment < strand.positions.length - 1; segment++) {
                if (strand.brokenSegments.includes(segment)) continue;
                const state = materials.get(`${strand.id}:${segment}`);
                const remaining = Math.max(0, Math.min(1, state?.strengthFraction ?? 1));
                const color = steel ? [.27, .31, .33, 1] : [.52 * remaining + .07, .39 * remaining + .05, .20 * remaining + .035, 1];
                const a = strand.positions[segment], b = strand.positions[segment + 1];
                const area = Math.max(1e-12, 2 * Math.PI * support.radiusM * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
                const waterKg = Math.max(0, state?.waterKg ?? 0), oilKg = Math.max(0, state?.oilKg ?? 0), acidKg = Math.max(0, state?.acidHClKg ?? 0);
                // Match the panel's water-loading darkening/roughness response.
                // This includes retained fiber moisture, without inventing film
                // thickness, increasing radius, or advancing any reaction.
                const wet = Math.min(1, waterKg / area * 1.8);
                const oil = Math.min(1, oilKg / (SURFACE_OIL_PROFILE.densityKgM3 * area * SURFACE_LIQUID_CLOSURE.oilCoverageDepthM));
                // HCl's shared green is a diagnostic, not light emission. The
                // admitted HCl/water ratio weakens on dilution; a separate oil
                // film covers it. Dissolved salts are not inferred from mass.
                const acid = Math.min(1, acidKg / Math.max(1e-12, waterKg + acidKg) / SURFACE_ACID_PROFILE.hclMassFraction)
                    * Math.min(1, acidKg / (area * .02));
                for (let channel = 0; channel < 3; channel++) {
                    color[channel] *= 1 - wet * .38;
                    color[channel] += (acidVisual.color[channel] - color[channel]) * acid * .65;
                    color[channel] += (oilVisual.color[channel] - color[channel]) * oil * .75;
                }
                const roughness = Math.max(.12, (steel ? .3 : .78) - wet * .3);
                const id = `${strand.id}:segment:${segment}`;
                views.push({ ropeId: id, segmentIds: [`${id}:span`], positions: strand.positions.slice(segment, segment + 2),
                    radiusMeters: Math.max(.00015, support.radiusM * Math.sqrt(Math.max(.001, remaining))),
                    material: { color, roughness: roughness + (oilVisual.roughness - roughness) * oil,
                        sheenStrength: (steel ? .7 : .4) + Math.max(wet, oil) * .35,
                        anisotropy: steel ? .25 : .85, twistRate: steel ? 16 : 100 } });
            }
        }
        this.mesh.updateFromRopeViews(views);
    }
    render(pass, vp, eye) { this.mesh.render(pass, vp, eye); }
    dispose() { this.mesh.destroy(); }
}
