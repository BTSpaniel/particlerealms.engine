// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlanetPhysics.js - Rotating Planet with Dynamic Gravity
 * 
 * Simulates a spherical planet with:
 * - Rotation (angular velocity, quaternion orientation)
 * - Radial gravity field (direction + magnitude based on position)
 * - Surface-relative coordinate transforms
 * - Double-precision position (via hi/lo f32 split)
 * 
 * Key Features:
 * - Shell theorem: Gravity only from mass "below" you
 * - Variable gravity by depth (surface → core)
 * - Coriolis effect for moving objects
 * - Day/night cycle from rotation
 * 
 * Coordinate Systems:
 * - World: Absolute coordinates (f64 via hi/lo)
 * - Planet-Local: Relative to planet center
 * - Surface-Local: Relative to a surface point (tangent space)
 */

import { HierarchicalPosition } from './HierarchicalCoords.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Gravitational constant (scaled for game) */
export const G = 6.674e-11;

/** Default planet radius (180,000 km = 180,000,000 m) */
export const DEFAULT_PLANET_RADIUS = 180000000;

/** Default planet mass (for Earth-like surface gravity) */
export const DEFAULT_PLANET_MASS = 5.972e24;

/** Default rotation period in seconds (24 hours) */
export const DEFAULT_ROTATION_PERIOD = 86400;

/** Minimum gravity magnitude (to avoid division issues) */
export const MIN_GRAVITY = 0.001;

// ============================================================================
// DOUBLE PRECISION VIA HI/LO SPLIT
// ============================================================================

/**
 * Split a double into hi/lo f32 pair for GPU precision
 */
export function splitDouble(value) {
    const hi = Math.fround(value);
    const lo = Math.fround(value - hi);
    return { hi, lo };
}

/**
 * Combine hi/lo f32 pair back to double
 */
export function combineDouble(hi, lo) {
    return hi + lo;
}

/**
 * Double-precision 3D vector using hi/lo split
 */
export class DoubleVec3 {
    constructor(x = 0, y = 0, z = 0) {
        this.xHi = 0; this.xLo = 0;
        this.yHi = 0; this.yLo = 0;
        this.zHi = 0; this.zLo = 0;
        this.set(x, y, z);
    }
    
    set(x, y, z) {
        const xs = splitDouble(x);
        const ys = splitDouble(y);
        const zs = splitDouble(z);
        this.xHi = xs.hi; this.xLo = xs.lo;
        this.yHi = ys.hi; this.yLo = ys.lo;
        this.zHi = zs.hi; this.zLo = zs.lo;
        return this;
    }
    
    get x() { return combineDouble(this.xHi, this.xLo); }
    get y() { return combineDouble(this.yHi, this.yLo); }
    get z() { return combineDouble(this.zHi, this.zLo); }
    
    set x(v) { const s = splitDouble(v); this.xHi = s.hi; this.xLo = s.lo; }
    set y(v) { const s = splitDouble(v); this.yHi = s.hi; this.yLo = s.lo; }
    set z(v) { const s = splitDouble(v); this.zHi = s.hi; this.zLo = s.lo; }
    
    add(other) {
        return new DoubleVec3(
            this.x + other.x,
            this.y + other.y,
            this.z + other.z
        );
    }
    
    sub(other) {
        return new DoubleVec3(
            this.x - other.x,
            this.y - other.y,
            this.z - other.z
        );
    }
    
    scale(s) {
        return new DoubleVec3(this.x * s, this.y * s, this.z * s);
    }
    
    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    
    normalize() {
        const len = this.length();
        if (len < 1e-10) return new DoubleVec3(0, 1, 0);
        return this.scale(1 / len);
    }
    
    toArray() {
        return [this.x, this.y, this.z];
    }
    
    toFloat32Array() {
        return new Float32Array([this.xHi, this.xLo, this.yHi, this.yLo, this.zHi, this.zLo]);
    }
    
    clone() {
        const v = new DoubleVec3();
        v.xHi = this.xHi; v.xLo = this.xLo;
        v.yHi = this.yHi; v.yLo = this.yLo;
        v.zHi = this.zHi; v.zLo = this.zLo;
        return v;
    }
}

// ============================================================================
// QUATERNION
// ============================================================================

export class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    
    static identity() {
        return new Quaternion(0, 0, 0, 1);
    }
    
    static fromAxisAngle(axis, angle) {
        const halfAngle = angle / 2;
        const s = Math.sin(halfAngle);
        return new Quaternion(
            axis[0] * s,
            axis[1] * s,
            axis[2] * s,
            Math.cos(halfAngle)
        );
    }
    
    static fromEuler(pitch, yaw, roll) {
        const cy = Math.cos(yaw * 0.5);
        const sy = Math.sin(yaw * 0.5);
        const cp = Math.cos(pitch * 0.5);
        const sp = Math.sin(pitch * 0.5);
        const cr = Math.cos(roll * 0.5);
        const sr = Math.sin(roll * 0.5);
        
        return new Quaternion(
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy,
            cr * cp * cy + sr * sp * sy
        );
    }
    
    multiply(other) {
        return new Quaternion(
            this.w * other.x + this.x * other.w + this.y * other.z - this.z * other.y,
            this.w * other.y - this.x * other.z + this.y * other.w + this.z * other.x,
            this.w * other.z + this.x * other.y - this.y * other.x + this.z * other.w,
            this.w * other.w - this.x * other.x - this.y * other.y - this.z * other.z
        );
    }
    
    conjugate() {
        return new Quaternion(-this.x, -this.y, -this.z, this.w);
    }
    
    normalize() {
        const len = Math.sqrt(this.x*this.x + this.y*this.y + this.z*this.z + this.w*this.w);
        if (len < 1e-10) return Quaternion.identity();
        return new Quaternion(this.x/len, this.y/len, this.z/len, this.w/len);
    }
    
    rotateVector(v) {
        // v' = q * v * q^-1
        const qv = new Quaternion(v[0], v[1], v[2], 0);
        const result = this.multiply(qv).multiply(this.conjugate());
        return [result.x, result.y, result.z];
    }
    
    toMatrix() {
        const xx = this.x * this.x, xy = this.x * this.y, xz = this.x * this.z, xw = this.x * this.w;
        const yy = this.y * this.y, yz = this.y * this.z, yw = this.y * this.w;
        const zz = this.z * this.z, zw = this.z * this.w;
        
        return new Float32Array([
            1 - 2*(yy + zz), 2*(xy + zw), 2*(xz - yw), 0,
            2*(xy - zw), 1 - 2*(xx + zz), 2*(yz + xw), 0,
            2*(xz + yw), 2*(yz - xw), 1 - 2*(xx + yy), 0,
            0, 0, 0, 1
        ]);
    }
    
    clone() {
        return new Quaternion(this.x, this.y, this.z, this.w);
    }
}

// ============================================================================
// PLANET CLASS
// ============================================================================

export class Planet {
    /**
     * @param {Object} options 
     */
    constructor(options = {}) {
        // Position (world coordinates, double precision)
        this.position = new DoubleVec3(
            options.x ?? 0,
            options.y ?? 0,
            options.z ?? 0
        );
        
        // Orientation
        this.rotation = options.rotation ?? Quaternion.identity();
        
        // Angular velocity (radians per second, around axis)
        this.angularVelocityAxis = options.rotationAxis ?? [0, 1, 0]; // Y-up
        this.angularVelocityMagnitude = options.rotationSpeed ?? 
            (2 * Math.PI / DEFAULT_ROTATION_PERIOD);
        
        // Physical properties
        this.radius = options.radius ?? DEFAULT_PLANET_RADIUS;
        this.mass = options.mass ?? DEFAULT_PLANET_MASS;
        
        // Derived
        this.surfaceGravity = (G * this.mass) / (this.radius * this.radius);
        
        // Atmosphere (for drag/effects)
        this.atmosphereHeight = options.atmosphereHeight ?? this.radius * 0.01;
        
        // Time tracking
        this.rotationAngle = 0; // Current rotation in radians
    }
    
    /**
     * Update planet rotation
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        // Integrate angular velocity
        this.rotationAngle += this.angularVelocityMagnitude * dt;
        
        // Wrap angle
        while (this.rotationAngle > Math.PI * 2) {
            this.rotationAngle -= Math.PI * 2;
        }
        
        // Update rotation quaternion
        this.rotation = Quaternion.fromAxisAngle(
            this.angularVelocityAxis,
            this.rotationAngle
        );
    }
    
    /**
     * Get gravity vector at a world position
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {{ direction: number[], magnitude: number, altitude: number }}
     */
    getGravityAt(x, y, z) {
        // Vector from planet center to point
        const dx = x - this.position.x;
        const dy = y - this.position.y;
        const dz = z - this.position.z;
        
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const altitude = distance - this.radius;
        
        // Direction toward planet center (negative of radial)
        const direction = distance > MIN_GRAVITY 
            ? [-dx/distance, -dy/distance, -dz/distance]
            : [0, -1, 0];
        
        // Magnitude based on distance
        let magnitude;
        
        if (distance >= this.radius) {
            // Above surface: inverse square law
            magnitude = (G * this.mass) / (distance * distance);
        } else {
            // Inside planet: Shell theorem - only mass "below" counts
            // g = (G * M * r) / R³ (linear decrease to center)
            magnitude = (G * this.mass * distance) / (this.radius * this.radius * this.radius);
        }
        
        return { direction, magnitude, altitude };
    }
    
    /**
     * Get gravity as a vec3
     * @returns {number[]}
     */
    getGravityVec3At(x, y, z) {
        const { direction, magnitude } = this.getGravityAt(x, y, z);
        return [
            direction[0] * magnitude,
            direction[1] * magnitude,
            direction[2] * magnitude
        ];
    }
    
    /**
     * Get surface-local up vector at a position
     * @returns {number[]}
     */
    getUpVectorAt(x, y, z) {
        const dx = x - this.position.x;
        const dy = y - this.position.y;
        const dz = z - this.position.z;
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        if (len < MIN_GRAVITY) return [0, 1, 0];
        return [dx/len, dy/len, dz/len];
    }
    
    /**
     * Convert world position to planet-local (rotating frame)
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {number[]}
     */
    worldToPlanetLocal(x, y, z) {
        // Translate to planet center
        const dx = x - this.position.x;
        const dy = y - this.position.y;
        const dz = z - this.position.z;
        
        // Rotate by inverse of planet rotation
        return this.rotation.conjugate().rotateVector([dx, dy, dz]);
    }
    
    /**
     * Convert planet-local to world position
     * @param {number} lx 
     * @param {number} ly 
     * @param {number} lz 
     * @returns {number[]}
     */
    planetLocalToWorld(lx, ly, lz) {
        // Rotate by planet rotation
        const rotated = this.rotation.rotateVector([lx, ly, lz]);
        
        // Translate from planet center
        return [
            rotated[0] + this.position.x,
            rotated[1] + this.position.y,
            rotated[2] + this.position.z
        ];
    }
    
    /**
     * Get latitude/longitude from world position
     * @returns {{ latitude: number, longitude: number, altitude: number }}
     */
    getLatLongAlt(x, y, z) {
        const local = this.worldToPlanetLocal(x, y, z);
        const r = Math.sqrt(local[0]*local[0] + local[1]*local[1] + local[2]*local[2]);
        
        const latitude = Math.asin(local[1] / Math.max(r, 0.001));
        const longitude = Math.atan2(local[2], local[0]);
        const altitude = r - this.radius;
        
        return { latitude, longitude, altitude };
    }
    
    /**
     * Get world position from latitude/longitude/altitude
     */
    latLongAltToWorld(latitude, longitude, altitude) {
        const r = this.radius + altitude;
        
        const local = [
            r * Math.cos(latitude) * Math.cos(longitude),
            r * Math.sin(latitude),
            r * Math.cos(latitude) * Math.sin(longitude)
        ];
        
        return this.planetLocalToWorld(local[0], local[1], local[2]);
    }
    
    /**
     * Get surface velocity at a position (from planet rotation)
     * @returns {number[]}
     */
    getSurfaceVelocityAt(x, y, z) {
        // v = ω × r
        const dx = x - this.position.x;
        const dy = y - this.position.y;
        const dz = z - this.position.z;
        
        const omega = this.angularVelocityMagnitude;
        const axis = this.angularVelocityAxis;
        
        // ω vector
        const wx = axis[0] * omega;
        const wy = axis[1] * omega;
        const wz = axis[2] * omega;
        
        // Cross product ω × r
        return [
            wy * dz - wz * dy,
            wz * dx - wx * dz,
            wx * dy - wy * dx
        ];
    }
    
    /**
     * Compute Coriolis acceleration for a moving object
     * @param {number[]} velocity - Object velocity in world frame
     * @returns {number[]}
     */
    getCoriolisAcceleration(velocity) {
        // a_cor = -2 * ω × v
        const omega = this.angularVelocityMagnitude;
        const axis = this.angularVelocityAxis;
        
        const wx = axis[0] * omega;
        const wy = axis[1] * omega;
        const wz = axis[2] * omega;
        
        return [
            -2 * (wy * velocity[2] - wz * velocity[1]),
            -2 * (wz * velocity[0] - wx * velocity[2]),
            -2 * (wx * velocity[1] - wy * velocity[0])
        ];
    }
    
    /**
     * Get tangent space basis at a surface point
     * @returns {{ up: number[], north: number[], east: number[] }}
     */
    getTangentBasisAt(x, y, z) {
        const up = this.getUpVectorAt(x, y, z);
        
        // North: project world Y onto tangent plane
        let north = [0, 1, 0];
        const dot = up[0]*north[0] + up[1]*north[1] + up[2]*north[2];
        north = [
            north[0] - dot * up[0],
            north[1] - dot * up[1],
            north[2] - dot * up[2]
        ];
        const nLen = Math.sqrt(north[0]*north[0] + north[1]*north[1] + north[2]*north[2]);
        if (nLen > 0.001) {
            north = [north[0]/nLen, north[1]/nLen, north[2]/nLen];
        } else {
            // At poles, use arbitrary tangent
            north = [1, 0, 0];
        }
        
        // East: cross(up, north)
        const east = [
            up[1]*north[2] - up[2]*north[1],
            up[2]*north[0] - up[0]*north[2],
            up[0]*north[1] - up[1]*north[0]
        ];
        
        return { up, north, east };
    }
    
    /**
     * Raycast to planet surface
     * @param {number[]} origin 
     * @param {number[]} direction 
     * @returns {{ hit: boolean, point: number[], distance: number, normal: number[] }}
     */
    raycastSurface(origin, direction) {
        // Ray-sphere intersection
        const ox = origin[0] - this.position.x;
        const oy = origin[1] - this.position.y;
        const oz = origin[2] - this.position.z;
        
        const a = direction[0]*direction[0] + direction[1]*direction[1] + direction[2]*direction[2];
        const b = 2 * (ox*direction[0] + oy*direction[1] + oz*direction[2]);
        const c = ox*ox + oy*oy + oz*oz - this.radius*this.radius;
        
        const discriminant = b*b - 4*a*c;
        
        if (discriminant < 0) {
            return { hit: false, point: null, distance: Infinity, normal: null };
        }
        
        const sqrtD = Math.sqrt(discriminant);
        let t = (-b - sqrtD) / (2*a);
        
        if (t < 0) {
            t = (-b + sqrtD) / (2*a);
        }
        
        if (t < 0) {
            return { hit: false, point: null, distance: Infinity, normal: null };
        }
        
        const point = [
            origin[0] + direction[0] * t,
            origin[1] + direction[1] * t,
            origin[2] + direction[2] * t
        ];
        
        const normal = this.getUpVectorAt(point[0], point[1], point[2]);
        
        return { hit: true, point, distance: t, normal };
    }
    
    /**
     * Get GPU uniform data
     * @returns {Float32Array}
     */
    toGPUData() {
        return new Float32Array([
            // Position (hi/lo split)
            this.position.xHi, this.position.xLo,
            this.position.yHi, this.position.yLo,
            this.position.zHi, this.position.zLo,
            0, 0, // padding
            
            // Rotation quaternion
            this.rotation.x, this.rotation.y, this.rotation.z, this.rotation.w,
            
            // Physical properties
            this.radius, this.mass, this.surfaceGravity, this.rotationAngle,
        ]);
    }
}

// ============================================================================
// MULTI-PLANET SYSTEM
// ============================================================================

export class PlanetarySystem {
    constructor() {
        this.planets = [];
        this.primaryPlanet = null; // Main planet for gameplay
    }
    
    addPlanet(planet) {
        this.planets.push(planet);
        if (!this.primaryPlanet) {
            this.primaryPlanet = planet;
        }
        return planet;
    }
    
    update(dt) {
        for (const planet of this.planets) {
            planet.update(dt);
        }
    }
    
    /**
     * Get combined gravity at a position from all planets
     */
    getGravityAt(x, y, z) {
        let gx = 0, gy = 0, gz = 0;
        
        for (const planet of this.planets) {
            const g = planet.getGravityVec3At(x, y, z);
            gx += g[0];
            gy += g[1];
            gz += g[2];
        }
        
        return [gx, gy, gz];
    }
    
    /**
     * Find nearest planet to a position
     */
    getNearestPlanet(x, y, z) {
        let nearest = null;
        let minDist = Infinity;
        
        for (const planet of this.planets) {
            const dx = x - planet.position.x;
            const dy = y - planet.position.y;
            const dz = z - planet.position.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            if (dist < minDist) {
                minDist = dist;
                nearest = planet;
            }
        }
        
        return { planet: nearest, distance: minDist };
    }
}

export default Planet;
