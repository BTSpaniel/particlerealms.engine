// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Quaternion Math for Shader Animation
 * 
 * Full quaternion operations for skeletal animation and rotation.
 * 
 * Key Concepts:
 *   1. Quaternion multiplication - Compose rotations
 *   2. Quaternion inverse/conjugate - Reverse rotation
 *   3. Slerp interpolation - Smooth rotation blending
 *   4. Point rotation - Apply quaternion to position
 *   5. Matrix conversion - Quaternion to mat4
 * 
 * Functions:
 *   - quaternionMul(a, b) - Multiply quaternions
 *   - quaternionInverse(q) - Inverse rotation
 *   - quaternionSlerp(a, b, t) - Spherical interpolation
 *   - rotatePoint(p, center, q) - Rotate point
 *   - quaternionToMatrix(q, offset) - Convert to mat4
 */

export const quaternionWGSL = /* wgsl */`
// ============================================================================
// QUATERNION CONSTANTS
// ============================================================================

const QUAT_IDENTITY : vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 1.0);
const QUAT_PI : f32 = 3.14159265358979;

// ============================================================================
// BASIC QUATERNION OPERATIONS
// ============================================================================

// Quaternion conjugate (negate xyz, keep w)
fn quatConjugate(q : vec4<f32>) -> vec4<f32> {
  return vec4<f32>(-q.xyz, q.w);
}

// Quaternion inverse (conjugate / magnitude²)
fn quatInverse(q : vec4<f32>) -> vec4<f32> {
  return quatConjugate(q) / dot(q, q);
}

// Quaternion multiplication (Hamilton product)
fn quatMul(left : vec4<f32>, right : vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z
  );
}

// Normalize quaternion
fn quatNormalize(q : vec4<f32>) -> vec4<f32> {
  return q / length(q);
}

// ============================================================================
// QUATERNION INTERPOLATION
// ============================================================================

// Linear interpolation (nlerp) - faster but not constant velocity
fn quatNlerp(a : vec4<f32>, b : vec4<f32>, t : f32) -> vec4<f32> {
  var bAdj = b;
  
  // Handle opposite hemisphere
  if (dot(a, b) < 0.0) {
    bAdj = -b;
  }
  
  return quatNormalize(mix(a, bAdj, t));
}

// Spherical linear interpolation (slerp) - constant angular velocity
fn quatSlerp(starting : vec4<f32>, ending : vec4<f32>, t : f32) -> vec4<f32> {
  var endAdj = ending;
  var cosa = dot(starting, ending);
  
  // Handle opposite hemisphere
  if (cosa < 0.0) {
    endAdj = -ending;
    cosa = -cosa;
  }
  
  var k0 : f32;
  var k1 : f32;
  
  // Use linear interpolation for very close quaternions
  if (cosa > 0.9995) {
    k0 = 1.0 - t;
    k1 = t;
  } else {
    let sina = sqrt(1.0 - cosa * cosa);
    let a = atan2(sina, cosa);
    k0 = sin((1.0 - t) * a) / sina;
    k1 = sin(t * a) / sina;
  }
  
  return vec4<f32>(
    starting.x * k0 + endAdj.x * k1,
    starting.y * k0 + endAdj.y * k1,
    starting.z * k0 + endAdj.z * k1,
    starting.w * k0 + endAdj.w * k1
  );
}

// ============================================================================
// QUATERNION FROM AXIS-ANGLE
// ============================================================================

// Create quaternion from axis and angle (radians)
fn quatFromAxisAngle(axis : vec3<f32>, angle : f32) -> vec4<f32> {
  let halfAngle = angle * 0.5;
  let s = sin(halfAngle);
  return vec4<f32>(axis * s, cos(halfAngle));
}

// Create quaternion for rotation around X axis
fn quatRotateX(angle : f32) -> vec4<f32> {
  let halfAngle = angle * 0.5;
  return vec4<f32>(sin(halfAngle), 0.0, 0.0, cos(halfAngle));
}

// Create quaternion for rotation around Y axis
fn quatRotateY(angle : f32) -> vec4<f32> {
  let halfAngle = angle * 0.5;
  return vec4<f32>(0.0, sin(halfAngle), 0.0, cos(halfAngle));
}

// Create quaternion for rotation around Z axis
fn quatRotateZ(angle : f32) -> vec4<f32> {
  let halfAngle = angle * 0.5;
  return vec4<f32>(0.0, 0.0, sin(halfAngle), cos(halfAngle));
}

// ============================================================================
// POINT ROTATION
// ============================================================================

// Rotate point around center using quaternion
fn rotatePoint(p : vec3<f32>, center : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  let pQuat = vec4<f32>(p - center, 0.0);
  let rotated = quatMul(quatMul(q, pQuat), quatConjugate(q));
  return rotated.xyz + center;
}

// Rotate point around origin
fn rotatePointOrigin(p : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  let pQuat = vec4<f32>(p, 0.0);
  let rotated = quatMul(quatMul(q, pQuat), quatConjugate(q));
  return rotated.xyz;
}

// Rotate direction (no translation)
fn rotateDirection(dir : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  return rotatePointOrigin(dir, q);
}

// ============================================================================
// MATRIX CONVERSION
// ============================================================================

// Quaternion to 4x4 model matrix with translation
fn quatToMatrix(q : vec4<f32>, offset : vec3<f32>) -> mat4x4<f32> {
  let qx2 = q.x * q.x;
  let qy2 = q.y * q.y;
  let qz2 = q.z * q.z;
  
  let qxqy = q.x * q.y;
  let qxqz = q.x * q.z;
  let qxqw = q.x * q.w;
  let qyqz = q.y * q.z;
  let qyqw = q.y * q.w;
  let qzqw = q.z * q.w;
  
  return mat4x4<f32>(
    vec4<f32>(1.0 - 2.0 * (qy2 + qz2), 2.0 * (qxqy + qzqw), 2.0 * (qxqz - qyqw), 0.0),
    vec4<f32>(2.0 * (qxqy - qzqw), 1.0 - 2.0 * (qx2 + qz2), 2.0 * (qyqz + qxqw), 0.0),
    vec4<f32>(2.0 * (qxqz + qyqw), 2.0 * (qyqz - qxqw), 1.0 - 2.0 * (qx2 + qy2), 0.0),
    vec4<f32>(offset, 1.0)
  );
}

// Quaternion to 3x3 rotation matrix
fn quatToMatrix3(q : vec4<f32>) -> mat3x3<f32> {
  let qx2 = q.x * q.x;
  let qy2 = q.y * q.y;
  let qz2 = q.z * q.z;
  
  let qxqy = q.x * q.y;
  let qxqz = q.x * q.z;
  let qxqw = q.x * q.w;
  let qyqz = q.y * q.z;
  let qyqw = q.y * q.w;
  let qzqw = q.z * q.w;
  
  return mat3x3<f32>(
    vec3<f32>(1.0 - 2.0 * (qy2 + qz2), 2.0 * (qxqy + qzqw), 2.0 * (qxqz - qyqw)),
    vec3<f32>(2.0 * (qxqy - qzqw), 1.0 - 2.0 * (qx2 + qz2), 2.0 * (qyqz + qxqw)),
    vec3<f32>(2.0 * (qxqz + qyqw), 2.0 * (qyqz - qxqw), 1.0 - 2.0 * (qx2 + qy2))
  );
}

// Inverse model matrix (for transforming world -> local)
fn quatToMatrixInverse(q : vec4<f32>, offset : vec3<f32>) -> mat4x4<f32> {
  let rotMat = quatToMatrix(quatInverse(q), vec3<f32>(0.0));
  let transMat = mat4x4<f32>(
    vec4<f32>(1.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.0, 1.0, 0.0, 0.0),
    vec4<f32>(0.0, 0.0, 1.0, 0.0),
    vec4<f32>(-offset, 1.0)
  );
  return rotMat * transMat;
}

// ============================================================================
// QUATERNION FROM DIRECTIONS
// ============================================================================

// Create quaternion that rotates 'from' direction to 'to' direction
fn quatFromTo(fromDir : vec3<f32>, toDir : vec3<f32>) -> vec4<f32> {
  let cosTheta = dot(fromDir, toDir);
  
  // Already aligned
  if (cosTheta > 0.9999) {
    return QUAT_IDENTITY;
  }
  
  // Opposite directions
  if (cosTheta < -0.9999) {
    // Find perpendicular axis
    var axis = cross(vec3<f32>(1.0, 0.0, 0.0), fromDir);
    if (length(axis) < 0.001) {
      axis = cross(vec3<f32>(0.0, 1.0, 0.0), fromDir);
    }
    return quatFromAxisAngle(normalize(axis), QUAT_PI);
  }
  
  let axis = cross(fromDir, toDir);
  let s = sqrt((1.0 + cosTheta) * 2.0);
  let invS = 1.0 / s;
  
  return vec4<f32>(axis * invS, s * 0.5);
}

// Create quaternion from forward and up vectors (look rotation)
fn quatLookRotation(forward : vec3<f32>, up : vec3<f32>) -> vec4<f32> {
  let f = normalize(forward);
  let r = normalize(cross(up, f));
  let u = cross(f, r);
  
  // Build rotation matrix then convert to quaternion
  let m00 = r.x; let m01 = u.x; let m02 = f.x;
  let m10 = r.y; let m11 = u.y; let m12 = f.y;
  let m20 = r.z; let m21 = u.z; let m22 = f.z;
  
  let trace = m00 + m11 + m22;
  
  var q : vec4<f32>;
  
  if (trace > 0.0) {
    let s = 0.5 / sqrt(trace + 1.0);
    q = vec4<f32>(
      (m21 - m12) * s,
      (m02 - m20) * s,
      (m10 - m01) * s,
      0.25 / s
    );
  } else if (m00 > m11 && m00 > m22) {
    let s = 2.0 * sqrt(1.0 + m00 - m11 - m22);
    q = vec4<f32>(
      0.25 * s,
      (m01 + m10) / s,
      (m02 + m20) / s,
      (m21 - m12) / s
    );
  } else if (m11 > m22) {
    let s = 2.0 * sqrt(1.0 + m11 - m00 - m22);
    q = vec4<f32>(
      (m01 + m10) / s,
      0.25 * s,
      (m12 + m21) / s,
      (m02 - m20) / s
    );
  } else {
    let s = 2.0 * sqrt(1.0 + m22 - m00 - m11);
    q = vec4<f32>(
      (m02 + m20) / s,
      (m12 + m21) / s,
      0.25 * s,
      (m10 - m01) / s
    );
  }
  
  return quatNormalize(q);
}

// ============================================================================
// BONE CHAIN UTILITIES
// ============================================================================

// Chain multiple bone rotations (parent to child order)
fn chainRotations(parent : vec4<f32>, child : vec4<f32>) -> vec4<f32> {
  return quatMul(parent, child);
}

// Get world rotation from local rotation and parent world rotation
fn localToWorldRotation(localRot : vec4<f32>, parentWorldRot : vec4<f32>) -> vec4<f32> {
  return quatMul(parentWorldRot, localRot);
}

// Get local rotation from world rotation and parent world rotation
fn worldToLocalRotation(worldRot : vec4<f32>, parentWorldRot : vec4<f32>) -> vec4<f32> {
  return quatMul(quatInverse(parentWorldRot), worldRot);
}
`;

export default quaternionWGSL;
