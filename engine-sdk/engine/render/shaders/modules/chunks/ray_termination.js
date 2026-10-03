// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const rayTerminationWGSL = /* wgsl */`
struct SecondaryRayTerminationInput {
    bounceIndex : u32,
    exitUv : vec2<f32>,
    returnCos : f32,
    throughputMax : f32,
    nextHitBeforeExit : bool,
    screenMargin : f32,
    returnCosThreshold : f32,
    throughputThreshold : f32,
}

fn rayExitUvOffscreen(exitUv : vec2<f32>, screenMargin : f32) -> bool {
    return exitUv.x < -screenMargin || exitUv.x > 1.0 + screenMargin || exitUv.y < -screenMargin || exitUv.y > 1.0 + screenMargin;
}

fn shouldTerminateSecondaryRay(input : SecondaryRayTerminationInput) -> bool {
    if (input.bounceIndex == 0u) {
        return false;
    }
    let offscreen = rayExitUvOffscreen(input.exitUv, input.screenMargin);
    let weakPath = input.throughputMax < input.throughputThreshold;
    let poorReturn = input.returnCos < input.returnCosThreshold;
    return offscreen && poorReturn && weakPath && !input.nextHitBeforeExit;
}

fn russianRouletteSurvivalProbability(throughputMax : f32, minProbability : f32, maxProbability : f32) -> f32 {
    return clamp(throughputMax, minProbability, maxProbability);
}
`;

export default rayTerminationWGSL;
