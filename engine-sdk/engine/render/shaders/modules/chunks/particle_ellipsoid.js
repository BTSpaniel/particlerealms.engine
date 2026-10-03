// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Binding-free analytic particle intersection shared with the SPH renderer.
 * Origin is relative to the particle centre; axes form an orthonormal basis.
 * Returns (selected positive hit, near root, far root, valid flag), retaining
 * both roots for physical optical path length and inside-origin handling.
 */
export const particleEllipsoidWGSL = /* wgsl */`
fn intersectParticleEllipsoid(origin:vec3f,ray:vec3f,axis0:vec3f,axis1:vec3f,axis2:vec3f,shapeRadii:vec3f)->vec4f {
  let radii = max(shapeRadii, vec3f(0.00001));
  let scaledOrigin = vec3f(dot(origin, axis0) / radii.x,
    dot(origin, axis1) / radii.y,
    dot(origin, axis2) / radii.z);
  let scaledRay = vec3f(dot(ray, axis0) / radii.x,
    dot(ray, axis1) / radii.y,
    dot(ray, axis2) / radii.z);
  let a = dot(scaledRay, scaledRay);
  let halfB = dot(scaledOrigin, scaledRay);
  let c = dot(scaledOrigin, scaledOrigin) - 1.0;
  let discriminant = halfB * halfB - a * c;
  if (a <= 0.00000001 || discriminant < 0.0) { return vec4f(0.0); }
  let root = sqrt(max(0.0, discriminant));
  let nearDistance = (-halfB - root) / a;
  let farDistance = (-halfB + root) / a;
  let minimumDistance = 0.0005;
  let hitDistance = select(farDistance, nearDistance, nearDistance > minimumDistance);
  let valid = select(0.0, 1.0, hitDistance > minimumDistance && farDistance > minimumDistance);
  return vec4f(hitDistance, nearDistance, farDistance, valid);
}`;
