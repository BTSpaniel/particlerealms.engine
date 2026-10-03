// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Resource-free retained population math shared by bounded water owners. */
export const WATER_FOAM_KERNELS_WGSL = /* wgsl */`
fn waterFoamBacktrace(uv:vec2f,velocity:vec2f,dt:f32,extent:vec2f)->vec2f {
 return uv-velocity*dt/max(extent,vec2f(.01));
}
fn waterFoamPopulation(decayed:f32,production:f32,impact:f32,dt:f32)->f32 {
 return 1.-(1.-decayed)*exp(-production*dt-impact);
}
fn waterFoamAge(previous:f32,production:f32,impact:f32,dt:f32)->f32 {
 return select(min(previous+dt,60.),0.,production*dt+impact>.015);
}
fn waterFoamNineCellWeight(offset:vec2i)->f32 {
 return select(1.,2.,offset.x==0)*select(1.,2.,offset.y==0)/16.;
}
fn waterFoamFiniteImpact(distance:f32,radius:f32,amount:f32)->f32 {
 let r=max(radius,.00001);if(distance>=r*2.){return 0.;}
 return max(0.,amount)*exp(-2.*distance*distance/(r*r));
}
`;

/** Independent CPU references for numerical population and age checks. */
export function waterFoamPopulation(decayed, production, impact, dt) {
    return 1 - (1 - decayed) * Math.exp(-production * dt - impact);
}
export function waterFoamAge(previous, production, impact, dt) {
    return production * dt + impact > .015 ? 0 : Math.min(previous + dt, 60);
}
