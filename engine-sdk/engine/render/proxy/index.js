// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Proxy Geometry System — Public Exports
 *
 * Ray Portal Proxy Topology rendering system:
 * Decouples visual complexity from geometric complexity using 5 quality tiers
 * that switch dynamically based on FPS.
 *
 * Primary entry point: ProxyGeometrySystem
 *
 * Usage:
 *   import { ProxyGeometrySystem, PROXY_MODE, PROXY_TIER } from './proxy/index.js';
 *
 *   const proxy = new ProxyGeometrySystem(device, width, height);
 *   await proxy.registerTarget(0, positions, indices, uvs, material);
 *   proxy.addInstance(0, worldMatrix, PROXY_MODE.BOX);
 *
 *   // Per frame:
 *   proxy.update(fps, cameraPos, encoder);
 *   proxy.render(encoder, gbuffer, hdrTarget, sceneData);
 */

export { ProxyGeometrySystem, PROXY_MODE } from './ProxyGeometrySystem.js';
export { ProxyGBufferPass }                from './ProxyGBufferPass.js';
export { PROXY_TIER }                       from './ProxyMaskPass.js';
export { TLASBuilder }                      from './TLASBuilder.js';
export { ProxyBillboardAlign }              from './ProxyBillboardAlign.js';
export { ProxyOctahedralCache, OCTAHEDRAL_WGSL } from './ProxyOctahedralCache.js';
export { ProxySDF, SDF_PROXY_WGSL }         from './ProxySDF.js';
export { ProxyMaskPass }                    from './ProxyMaskPass.js';
export { ProxyShadePass }                   from './ProxyShadePass.js';
export { RAY_PORTAL_WGSL }                  from '../shaders/modules/proxy/ray_portal.js';
