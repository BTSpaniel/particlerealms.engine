// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const restirGuidePolicyWGSL = /* wgsl */`
const RESTIR_GUIDE_CLASS_DEFAULT : f32 = 0.0;
const RESTIR_GUIDE_CLASS_DIRECT : f32 = 1.0;
const RESTIR_GUIDE_CLASS_TRANSMITTED : f32 = 2.0;
const RESTIR_GUIDE_CLASS_PROXY : f32 = 3.0;

fn restirDecodeGuideClass(v : f32) -> f32 {
    return floor(max(v, 0.0) + 0.5);
}

fn restirGuideClassMatch(a : f32, b : f32) -> bool {
    let ca = restirDecodeGuideClass(a);
    let cb = restirDecodeGuideClass(b);
    return ca < 0.5 || cb < 0.5 || ca == cb;
}

fn restirTemporalHistoryScale(guideClass : f32) -> f32 {
    let c = restirDecodeGuideClass(guideClass);
    var scale = select(1.0, 0.62, c == RESTIR_GUIDE_CLASS_TRANSMITTED);
    scale = select(scale, 0.5, c == RESTIR_GUIDE_CLASS_PROXY);
    return scale;
}

fn restirSpatialReuseScale(guideClass : f32) -> f32 {
    let c = restirDecodeGuideClass(guideClass);
    var scale = select(1.0, 0.35, c == RESTIR_GUIDE_CLASS_TRANSMITTED);
    scale = select(scale, 0.28, c == RESTIR_GUIDE_CLASS_PROXY);
    return scale;
}
`;

export default restirGuidePolicyWGSL;
