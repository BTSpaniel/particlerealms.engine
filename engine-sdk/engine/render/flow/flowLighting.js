// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { blackbodyWGSL } from '../shaders/modules/core/particles_blackbody.js';
import { flowSparseWGSL } from './flowSparse.js';

/** Shared display emission, not calibrated heat-release power. */
export const flowEmissionWGSL = blackbodyWGSL => /* wgsl */`${blackbodyWGSL}
fn emittedRadiance(density:vec4f)->vec3f {
    let temperature=1000.+1600.*clamp(density.x-.05,0.,1.);
    let colour=sampleBlackbody(colourMap,fieldSampler,temperature,1000.,2600.).rgb;
    // Visible red-band Planck response suppresses the cooling luminous halo;
    // total T^4 power includes infrared that should not brighten the image.
    // Native temperature remains dimensionless; this is an optical transfer,
    // not a second heat source or a claim of calibrated gas thermodynamics.
    let visiblePower=blackbodySpectralRatio(temperature,2600.,650.e-9);
    return colour*max(density.z-.001,0.)*visiblePower*smoothstep(0.,.1,density.x)*900.;
}`;

/** One finite-area light approximates the completed field's emission moments.
 * Coarse native-cell quadrature stays on the GPU and follows actual burn. This
 * adds reflected fire light, not geometry shadows or calibrated photometry. */
export async function createFlowLighting(ctx, boundarySource = '', { boundaryCache = true } = {}) {
    const source = /* wgsl */`${flowSparseWGSL(boundarySource, { boundaryCache })}
@group(0) @binding(5) var colourMap:texture_1d<f32>;
struct EmissionLight { centreRadius:vec4f, radiance:vec4f }
@group(0) @binding(6) var<storage,read_write> light:EmissionLight;
${flowEmissionWGSL(blackbodyWGSL)}
var<workgroup> moments:array<vec4f,64>;
var<workgroup> colours:array<vec4f,64>;
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) lane:u32) {
    let size=blockSize(); let sampleVolume=size.x*size.y*size.z/64.;
    var reference=vec3f(0);
    if(params[7]>0u) {
        let first=params[15];
        reference=vec3f(bitcast<vec3i>(vec3u(table[first],table[first+1u],table[first+2u])))*size;
    }
    var moment=vec4f(0); var colour=vec4f(0);
    for(var index=lane;index<params[7];index+=64u) {
        let address=params[15]+4u*index;
        if(table[address+3u]!=params[32] || (table[params[18]+index]&0x80000000u)==0u) { continue; }
        let location=bitcast<vec3i>(vec3u(table[address],table[address+1u],table[address+2u]));
        for(var sample=0u;sample<64u;sample++) {
            let offset=vec3f(vec3u(sample&3u,(sample>>2u)&3u,sample>>4u));
            let point=(vec3f(location)+(offset+.5)/4.)*size;
            let emission=emittedRadiance(sampleFieldInBlock(point,location,index))*sampleVolume;
            let weight=dot(emission,vec3f(.2126,.7152,.0722));
            let relative=point-reference;
            moment+=vec4f(relative*weight,weight);
            colour+=vec4f(emission,dot(relative,relative)*weight);
        }
    }
    moments[lane]=moment; colours[lane]=colour; workgroupBarrier();
    for(var stride=32u;stride>0u;stride>>=1u) {
        if(lane<stride) { moments[lane]+=moments[lane+stride]; colours[lane]+=colours[lane+stride]; }
        workgroupBarrier();
    }
    if(lane==0u) {
        let weight=max(moments[0].w,1.e-12); let centre=moments[0].xyz/weight;
        let variance=max(0.,colours[0].w/weight-dot(centre,centre));
        light.centreRadius=vec4f(reference+centre,max(.25,sqrt(variance)));
        light.radiance=vec4f(colours[0].xyz/(4.*3.14159265359),moments[0].w);
    }
}`;
    const module = await ctx.makeShader(source, 'PhysicsLab.NativeFireLight');
    const pipeline = await ctx.device.createComputePipelineAsync({ label: 'Reduce native fire emission', layout: 'auto',
        compute: { module, entryPoint: 'main' } });
    const buffer = ctx.device.createBuffer({ label: 'Completed native fire light', size: 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    let frame = -1, boundVolume = null, generation = -1, bindings = null;
    return {
        buffer,
        encode(encoder, flow, timing = () => ({})) {
            const input = flow?.lighting, next = flow?.stats.densityFrames;
            if (!input || next === frame && boundVolume === input.volumeView) return;
            if (boundVolume !== input.volumeView || generation !== input.generation) {
                bindings = ctx.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: input.volumeView }, { binding: 1, resource: input.sampler },
                    ...[input.table, input.metadata, input.scale].map((resource, index) => ({ binding: index + 2, resource: { buffer: resource } })),
                    { binding: 5, resource: input.colourView }, { binding: 6, resource: { buffer } },
                    ...(boundarySource ? [{ binding: 16, resource: { buffer: input.boundaries } }] : []),
                    ...(boundarySource && boundaryCache ? [{ binding: 17, resource: { buffer: input.boundaryStencils } }] : []),
                ] });
                boundVolume = input.volumeView; generation = input.generation;
            }
            const pass = encoder.beginComputePass({ ...timing('Fire reflection'), label: 'Reflect the completed fire field on solids' });
            pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.dispatchWorkgroups(1); pass.end();
            frame = next;
        },
        dispose() { buffer.destroy(); },
    };
}
