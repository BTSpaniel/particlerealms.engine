// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared texture coordinate, mip, atlas, and virtual-texture helpers for WGSL.
 */

export const textureMathWGSL = /* wgsl */`
struct TextureVirtualPageCoord {
  x : u32,
  y : u32,
  id : u32,
  width : u32,
  height : u32,
  localUV : vec2<f32>,
};

fn textureModulo(x : f32, y : f32) -> f32 {
  return x - y * floor(x / y);
}

fn textureWrapComponent(value : f32, lo : f32, hi : f32) -> f32 {
  let span = hi - lo;
  if (span == 0.0) {
    return lo;
  }
  return lo + textureModulo(value - lo, span);
}

fn textureUvWrap(uv : vec2<f32>, minUV : vec2<f32>, maxUV : vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    textureWrapComponent(uv.x, minUV.x, maxUV.x),
    textureWrapComponent(uv.y, minUV.y, maxUV.y)
  );
}

fn textureUvClamp(uv : vec2<f32>, minUV : vec2<f32>, maxUV : vec2<f32>) -> vec2<f32> {
  return clamp(uv, minUV, maxUV);
}

fn textureUvMirror(uv : vec2<f32>) -> vec2<f32> {
  let mirrored = vec2<f32>(
    1.0 - abs(textureModulo(uv.x, 2.0) - 1.0),
    1.0 - abs(textureModulo(uv.y, 2.0) - 1.0)
  );
  return mirrored;
}

fn textureTileUV(uv : vec2<f32>, scale : vec2<f32>, offset : vec2<f32>) -> vec2<f32> {
  return uv * scale + offset;
}

fn textureAtlasUVTransform(
  xy : vec2<f32>,
  size : vec2<f32>,
  atlasSize : vec2<f32>,
) -> vec4<f32> {
  return vec4<f32>(xy / atlasSize, size / atlasSize);
}

fn textureAtlasUV(uv : vec2<f32>, transform : vec4<f32>) -> vec2<f32> {
  return transform.xy + uv * transform.zw;
}

fn texturePixelToUV(pixel : vec2<f32>, textureSize : vec2<f32>, centered : bool) -> vec2<f32> {
  let bias = select(0.0, 0.5, centered);
  return (pixel + vec2<f32>(bias)) / max(textureSize, vec2<f32>(1.0));
}

fn textureUVToPixel(uv : vec2<f32>, textureSize : vec2<f32>, centered : bool) -> vec2<f32> {
  let bias = select(0.0, 0.5, centered);
  return uv * max(textureSize, vec2<f32>(1.0)) - vec2<f32>(bias);
}

fn textureTriplanarWeights(normal : vec3<f32>, sharpness : f32) -> vec3<f32> {
  let s = max(0.0, sharpness);
  let weights = pow(abs(normal), vec3<f32>(s));
  let sum = weights.x + weights.y + weights.z;
  if (sum <= 0.0) {
    return vec3<f32>(0.0, 1.0, 0.0);
  }
  return weights / sum;
}

fn textureMipLevelCount(width : u32, height : u32, depth : u32, maxMipLevels : u32) -> u32 {
  let maxExtent = max(max(max(1u, width), max(1u, height)), max(1u, depth));
  let levels = u32(floor(log2(f32(maxExtent)))) + 1u;
  return max(1u, min(levels, max(1u, maxMipLevels)));
}

fn textureMipExtent(width : u32, height : u32, mipLevel : u32) -> vec2<u32> {
  let divisor = exp2(f32(mipLevel));
  return vec2<u32>(
    max(1u, u32(floor(f32(max(1u, width)) / divisor))),
    max(1u, u32(floor(f32(max(1u, height)) / divisor)))
  );
}

fn textureMipExtent3D(width : u32, height : u32, depth : u32, mipLevel : u32) -> vec3<u32> {
  let divisor = exp2(f32(mipLevel));
  return vec3<u32>(
    max(1u, u32(floor(f32(max(1u, width)) / divisor))),
    max(1u, u32(floor(f32(max(1u, height)) / divisor))),
    max(1u, u32(floor(f32(max(1u, depth)) / divisor)))
  );
}

fn textureMipLevelFromPixelSize(pixelSize : f32, maxMipLevels : u32) -> u32 {
  let mip = u32(floor(log2(max(1.0, pixelSize))));
  let maxLevel = max(1u, maxMipLevels) - 1u;
  return max(0u, min(mip, maxLevel));
}

fn textureSmoothstep(edge0 : f32, edge1 : f32, x : f32) -> f32 {
  let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn textureFade(distance : f32, fadeStart : f32, fadeEnd : f32) -> f32 {
  return clamp(1.0 - textureSmoothstep(fadeStart, fadeEnd, distance), 0.0, 1.0);
}

fn textureVirtualPageId(pageX : u32, pageY : u32, pageTableSize : vec2<u32>) -> u32 {
  let width = max(1u, pageTableSize.x);
  let height = max(1u, pageTableSize.y);
  let x = min(pageX, width - 1u);
  let y = min(pageY, height - 1u);
  return y * width + x;
}

fn textureVirtualPageCoord(pageId : u32, pageTableSize : vec2<u32>) -> TextureVirtualPageCoord {
  let width = max(1u, pageTableSize.x);
  let height = max(1u, pageTableSize.y);
  let id = min(pageId, width * height - 1u);
  let x = id % width;
  let y = id / width;
  return TextureVirtualPageCoord(x, y, id, width, height, vec2<f32>(0.0));
}

fn textureVirtualPageCoordFromUV(uv : vec2<f32>, pageTableSize : vec2<u32>) -> TextureVirtualPageCoord {
  let width = max(1u, pageTableSize.x);
  let height = max(1u, pageTableSize.y);
  let scaled = uv * vec2<f32>(f32(width), f32(height));
  let x = min(u32(floor(max(0.0, scaled.x))), width - 1u);
  let y = min(u32(floor(max(0.0, scaled.y))), height - 1u);
  let localUV = vec2<f32>(textureModulo(scaled.x, 1.0), textureModulo(scaled.y, 1.0));
  return TextureVirtualPageCoord(x, y, y * width + x, width, height, localUV);
}

fn textureVirtualPhysicalPageOrigin(slotIndex : u32, cacheSize : vec2<u32>, pageSize : u32) -> vec4<u32> {
  let size = max(1u, pageSize);
  let pagesX = max(1u, max(1u, cacheSize.x) / size);
  let pagesY = max(1u, max(1u, cacheSize.y) / size);
  let slot = min(slotIndex, pagesX * pagesY - 1u);
  let pageX = slot % pagesX;
  let pageY = slot / pagesX;
  return vec4<u32>(pageX * size, pageY * size, pageX, pageY);
}

fn textureVirtualPhysicalUV(
  uv : vec2<f32>,
  physicalPage : vec2<u32>,
  pageTableSize : vec2<u32>,
  pageSize : u32,
  cacheSize : vec2<u32>,
) -> vec2<f32> {
  let page = textureVirtualPageCoordFromUV(uv, pageTableSize);
  let size = f32(max(1u, pageSize));
  let pixel = vec2<f32>(physicalPage) * size + page.localUV * size;
  return pixel / vec2<f32>(max(cacheSize, vec2<u32>(1u)));
}

fn textureVirtualPageTableEntry(
  pageId : u32,
  physicalPage : vec2<u32>,
  pageTableSize : vec2<u32>,
  resident : u32,
  reserved : u32,
) -> vec4<u32> {
  _ = textureVirtualPageCoord(pageId, pageTableSize);
  return vec4<u32>(
    min(physicalPage.x, 65535u),
    min(physicalPage.y, 65535u),
    min(resident, 65535u),
    min(reserved, 65535u)
  );
}
`;

export default textureMathWGSL;
