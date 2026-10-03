// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { Sun, SunDefaults, SunWGSL } from '../CelestialSun.js';
import { Moon, MoonSystem, MoonType, MoonDefaults, MoonPresets, MoonWGSL } from '../CelestialMoon.js';
import { StarField, StarSystem, StarLayer, StarDefaults, StarLayerPresets, Constellations, StarsWGSL } from '../CelestialStars.js';
import { SpaceWGSL } from '../Space.js';

export {
    Sun,
    SunDefaults,
    SunWGSL,
    Moon,
    MoonSystem,
    MoonType,
    MoonDefaults,
    MoonPresets,
    MoonWGSL,
    StarField,
    StarSystem,
    StarLayer,
    StarDefaults,
    StarLayerPresets,
    Constellations,
    StarsWGSL,
    SpaceWGSL,
};

export const CelestialBodiesWGSL = /* wgsl */ `
${SunWGSL}

${MoonWGSL}

${StarsWGSL}

${SpaceWGSL}

fn renderSun(
    direction: vec3<f32>,
    sunDir: vec3<f32>,
    angularRadius: f32,
    sunColor: vec3<f32>,
    intensity: f32
) -> vec3<f32> {
    return sunDisc(direction, sunDir, angularRadius, sunColor, intensity);
}

fn renderMoons(
    direction: vec3<f32>,
    sunDir: vec3<f32>,
    dayFactor: f32,
    moon1Dir: vec3<f32>, moon1Radius: f32, moon1Phase: f32, moon1Color: vec3<f32>,
    moon2Dir: vec3<f32>, moon2Radius: f32, moon2Phase: f32, moon2Color: vec3<f32>,
    moon3Dir: vec3<f32>, moon3Radius: f32, moon3Phase: f32, moon3Color: vec3<f32>
) -> vec3<f32> {
    let night = 1.0 - clamp(dayFactor, 0.0, 1.0);

    var c = vec3<f32>(0.0);

    c += moonDiscWithGlow(direction, moon1Dir, moon1Radius, moon1Phase, moon1Color, moon1Color * 0.4, 0.15) * night;
    c += moonDiscWithGlow(direction, moon2Dir, moon2Radius, moon2Phase, moon2Color, moon2Color * 0.4, 0.12) * night;
    c += moonDiscWithGlow(direction, moon3Dir, moon3Radius, moon3Phase, moon3Color, moon3Color * 0.4, 0.10) * night;

    return c;
}

fn renderStars(
    direction: vec3<f32>,
    sunY: f32,
    density: f32,
    brightness: f32,
    time: f32,
    twinkleSpeed: f32
) -> vec3<f32> {
    let sunFade = clamp(-sunY * 2.0, 0.0, 1.0);
    return starsColored(direction, density, brightness, time, twinkleSpeed, 0.2, vec3<f32>(1.0)) * sunFade;
}

fn starNest(direction: vec3<f32>, time: f32) -> vec3<f32> {
    return nebula(direction, time);
}
`;
