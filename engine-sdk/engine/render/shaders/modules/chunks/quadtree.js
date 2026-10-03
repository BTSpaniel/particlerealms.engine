// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Quadtree / Recursive Cell Pattern Helpers (WGSL)
 *
 * Port of a Shadertoy-style quadtree zoom pattern into reusable WGSL.
 *
 * Functions:
 *   - quadtreeCellLevel(uv, time, maxLevels, baseRadius, resolutionY)
 *       Returns how deep the recursive subdivision went and a mask for the disc.
 *   - quadtreeMask(uv, time)
 *       Simple convenience wrapper returning a [0,1] mask based on level.
 */

export const quadtreeWGSL = /* wgsl */`
// Static quadtree-style recursive subdivision in [0,1]^2

struct QuadtreeResult {
  level : f32,
  mask : f32,
};

// Compute quadtree level and a simple border mask for a UV in [0,1]^2
fn quadtreeCellLevel(
  uvIn : vec2<f32>,
  maxLevels : i32,
  borderThickness : f32,
) -> QuadtreeResult {
  var uv = uvIn;
  var level = 0.0;
  var mask = 1.0;

  for (var i = 0; i < maxLevels; i = i + 1) {
    // Distance to current cell border
    let fU = min(uv, 1.0 - uv);
    if (min(fU.x, fU.y) < borderThickness) {
      mask = 0.0;
      break;
    }

    // Go down one quadtree level
    let child = step(vec2<f32>(0.5, 0.5), uv);
    uv = uv * 2.0 - child;
    level = level + 1.0;
  }

  return QuadtreeResult(level, mask);
}

fn quadtreeMask(
  uv : vec2<f32>,
  time : f32,
  resolutionY : f32,
) -> f32 {
  // time and resolution are unused here; kept for API compatibility
  let res = quadtreeCellLevel(uv, 7, 0.003);
  let normalizedLevel = clamp(res.level / 7.0, 0.0, 1.0);
  return normalizedLevel * res.mask;
}
`;
