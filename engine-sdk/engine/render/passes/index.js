// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/render/passes/index.js - Post-Processing Passes Barrel Export
 */

// Anti-aliasing & Upscaling
export { FXAAPass } from './FXAAPass.js';
export { TAAPass } from './TAAPass.js';
export { PathTracingPass } from './PathTracingPass.js';
export { ReSTIRGIPass } from './ReSTIRGIPass.js';
export { TemporalSuperResolution, TSRQuality } from './TemporalSuperResolution.js';
export { FSRPass } from './FSRPass.js';
export { SVGFDenoise } from './SVGFDenoise.js';
export { ReconstructionProvider, ReconstructionMode } from './ReconstructionProvider.js';

// Shadows
export { CascadedShadowMap, CascadedShadowMap as CascadedShadowMapper } from './CascadedShadows.js';
export { CascadeMetrics } from './CascadeMetrics.js';
export { ContactShadowsPass } from './ContactShadowsPass.js';

// Screen-space effects
export { SSAOPass } from './SSAOPass.js';
export { SSRPass } from './SSRPass.js';
export { SSGIPass } from './SSGIPass.js';
export { HiZPass } from './HiZPass.js';

// Bloom & HDR
export { BloomPass } from './BloomPass.js';
export { HDR_PIPELINE_WGSL, TONEMAP_OPERATOR, HDRPipeline } from './HDRPipeline.js';
export { AutoExposurePass } from './AutoExposurePass.js';

// Color & Film
export { ColorGradingPass } from './ColorGradingPass.js';
export { FilmGrainPass } from './FilmGrainPass.js';
export { ChromaticAberrationPass } from './ChromaticAberrationPass.js';
export { VignettePass } from './VignettePass.js';

// Depth & Motion
export { DepthOfFieldPass } from './DepthOfFieldPass.js';
export { MotionBlurPass } from './MotionBlurPass.js';

// Lens effects
export { LensFlarePass } from './LensFlarePass.js';
export { PaniniProjectionPass } from './PaniniProjectionPass.js';

// Volumetric
export { GOD_RAYS_WGSL, GodRays } from './GodRays.js';
export { VolumetricCloudsPass } from './VolumetricCloudsPass.js';

// Environment
export { UnderwaterPass } from './UnderwaterPass.js';
export { PurkinjeEffectPass } from './PurkinjeEffectPass.js';

// Utility
export { OutlinePass } from './OutlinePass.js';
export { SharpeningPass } from './SharpeningPass.js';
export { AreaResamplePass } from './AreaResamplePass.js';

// Existing passes
export { ClearPass } from './ClearPass.js';
export { GeometryPass } from './GeometryPass.js';
export { LightingPass } from './LightingPass.js';
export { ShadowPass } from './ShadowPass.js';
export { ParticlePass } from './ParticlePass.js';
export { PostProcessChainPass } from './PostProcessChainPass.js';
export { PostProcessController } from './PostProcessController.js';
export { SpellEffectPass } from './SpellEffectPass.js';
export { UIHudPass } from './UIHudPass.js';
export { FluidWaterPass } from './FluidWaterPass.js';
export { FluidDebugPass } from './FluidDebugPass.js';
export { FluidDebugController } from './FluidDebugController.js';
export { ClothDebugPass } from './ClothDebugPass.js';
export { ClothDebugController } from './ClothDebugController.js';
