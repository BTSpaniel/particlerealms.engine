/**
 * GPUVehicle.js — GPU-Accelerated Vehicle Physics
 * 
 * Arcade-to-simulation vehicle system running on GPU compute.
 * Models wheels, suspension, engine, transmission, steering, and drivetrain.
 * 
 * Based on:
 * - PhysX 5 Vehicle SDK: suspension raycasts, tire model, drivetrain
 * - Bullet Vehicle: raycast vehicle with Pacejka tire friction
 * - Marco Monster's "Car Physics for Games" (classic reference)
 * - Brian Beckman's "Physics of Racing" series
 * 
 * Architecture:
 * - Vehicle is a rigid body in GPURigidBodyWorld with attached wheel descriptors
 * - Each frame: suspension raycasts → tire forces → engine torque → apply to chassis body
 * - GPU shader handles all wheels in parallel (one thread per wheel across all vehicles)
 * - CPU manages gear shifts, input mapping, and vehicle creation
 * 
 * Tire model: simplified Pacejka "Magic Formula"
 *   F = D * sin(C * atan(B * slip - E * (B * slip - atan(B * slip))))
 *   Simplified to: F = peakForce * sin(2 * atan(slip / peakSlip))
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_VEHICLES = 64;
export const MAX_WHEELS_PER_VEHICLE = 8;
export const MAX_TOTAL_WHEELS = MAX_VEHICLES * MAX_WHEELS_PER_VEHICLE;

export const DRIVE_FRONT = 0;
export const DRIVE_REAR  = 1;
export const DRIVE_AWD   = 2;

export const GEAR_REVERSE = -1;
export const GEAR_NEUTRAL = 0;
export const GEAR_1 = 1;
export const GEAR_2 = 2;
export const GEAR_3 = 3;
export const GEAR_4 = 4;
export const GEAR_5 = 5;
export const GEAR_6 = 6;

// ============================================================================
// WGSL SHADERS
// ============================================================================

const VEHICLE_SUSPENSION_SHADER = /* wgsl */`
// Per-wheel suspension force computation
// Input: wheel config, chassis transform, ground hit results
// Output: suspension force, wheel contact info

struct Wheel {
    // Config (set once)
    localPosX: f32, localPosY: f32, localPosZ: f32, radius: f32,
    suspensionRestLength: f32, suspensionStiffness: f32, suspensionDamping: f32, suspensionMaxTravel: f32,
    tireFrictionLat: f32, tireFrictionLon: f32, tireStiffness: f32, brakeForce: f32,
    isDriven: u32, steeringFactor: f32, camber: f32, _pad0: f32,

    // State (updated per frame)
    suspensionLength: f32, contactDepth: f32,
    groundNormalX: f32, groundNormalY: f32, groundNormalZ: f32,
    groundHitX: f32, groundHitY: f32, groundHitZ: f32,
    isGrounded: u32, angularVelocity: f32, slipAngle: f32, slipRatio: f32,

    // Output forces
    suspForceX: f32, suspForceY: f32, suspForceZ: f32, _pad1: f32,
    tireForceX: f32, tireForceY: f32, tireForceZ: f32, _pad2: f32,
}

struct VehicleState {
    bodyHandle: u32,
    wheelCount: u32,
    wheelStartIdx: u32,
    driveType: u32,          // 0=FWD, 1=RWD, 2=AWD
    engineTorque: f32,
    brakeTorque: f32,
    steeringAngle: f32,
    currentGear: i32,
    gearRatio: f32,
    finalDriveRatio: f32,
    engineRPM: f32,
    speed: f32,
    chassisMass: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

struct Params {
    dt: f32,
    gravity: f32,
    vehicleCount: u32,
    totalWheelCount: u32,
}

@group(0) @binding(0) var<storage, read_write> wheels: array<Wheel>;
@group(0) @binding(1) var<storage, read> vehicles: array<VehicleState>;
@group(0) @binding(2) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> rotations: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> angularVelocities: array<vec4<f32>>;
@group(0) @binding(6) var<uniform> params: Params;

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn inverseRotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    return rotateVec(v, vec4<f32>(-q.xyz, q.w));
}

// Simplified Pacejka tire force
fn pacejkaTireForce(slip: f32, peakSlip: f32, peakForce: f32) -> f32 {
    if (abs(slip) < 0.0001) { return 0.0; }
    return peakForce * sin(2.0 * atan(slip / max(peakSlip, 0.01)));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let wheelIdx = gid.x;
    if (wheelIdx >= params.totalWheelCount) { return; }

    // Find which vehicle this wheel belongs to
    var vehicleIdx: u32 = 0u;
    for (var v = 0u; v < params.vehicleCount; v++) {
        let veh = vehicles[v];
        if (wheelIdx >= veh.wheelStartIdx && wheelIdx < veh.wheelStartIdx + veh.wheelCount) {
            vehicleIdx = v;
            break;
        }
    }

    let veh = vehicles[vehicleIdx];
    var wheel = wheels[wheelIdx];
    let bodyIdx = veh.bodyHandle;

    let chassisPos = positions[bodyIdx].xyz;
    let chassisRot = rotations[bodyIdx];
    let chassisVel = velocities[bodyIdx].xyz;
    let chassisAngVel = angularVelocities[bodyIdx].xyz;

    // Apply steering to wheel local position
    let steerAngle = veh.steeringAngle * wheel.steeringFactor;
    let cosSteer = cos(steerAngle);
    let sinSteer = sin(steerAngle);

    // World-space wheel attachment point
    let localPos = vec3<f32>(wheel.localPosX, wheel.localPosY, wheel.localPosZ);
    let worldAttach = chassisPos + rotateVec(localPos, chassisRot);

    // Wheel down direction (chassis local Y, rotated)
    let downDir = rotateVec(vec3<f32>(0.0, -1.0, 0.0), chassisRot);

    // Forward direction (with steering)
    let localFwd = vec3<f32>(sinSteer, 0.0, cosSteer);
    let wheelForward = rotateVec(localFwd, chassisRot);
    let wheelRight = cross(wheelForward, -downDir);

    // Velocity at wheel contact point
    let r = worldAttach - chassisPos;
    let pointVel = chassisVel + cross(chassisAngVel, r);

    // === SUSPENSION ===
    // Assume ground check result is pre-filled (from raycast pass)
    let suspRest = wheel.suspensionRestLength;
    let suspLength = wheel.suspensionLength;
    let isGrounded = wheel.isGrounded != 0u;

    var suspForce = vec3<f32>(0.0);
    if (isGrounded) {
        let groundNormal = vec3<f32>(wheel.groundNormalX, wheel.groundNormalY, wheel.groundNormalZ);
        let compression = suspRest - suspLength;
        let compressionVel = -dot(pointVel, groundNormal);

        // Spring + damper force
        let springForce = wheel.suspensionStiffness * compression;
        let damperForce = wheel.suspensionDamping * compressionVel;
        let totalForce = max(springForce + damperForce, 0.0);

        suspForce = groundNormal * totalForce;
    }

    wheel.suspForceX = suspForce.x;
    wheel.suspForceY = suspForce.y;
    wheel.suspForceZ = suspForce.z;

    // === TIRE FORCES ===
    var tireForce = vec3<f32>(0.0);

    if (isGrounded) {
        let groundNormal = vec3<f32>(wheel.groundNormalX, wheel.groundNormalY, wheel.groundNormalZ);

        // Project velocity onto ground plane
        let groundVel = pointVel - groundNormal * dot(pointVel, groundNormal);
        let forwardSpeed = dot(groundVel, wheelForward);
        let lateralSpeed = dot(groundVel, wheelRight);

        // Slip angle (lateral)
        let speed = max(length(groundVel), 0.1);
        let slipAngle = atan2(lateralSpeed, abs(forwardSpeed));

        // Slip ratio (longitudinal)
        let wheelLinearSpeed = wheel.angularVelocity * wheel.radius;
        var slipRatio: f32 = 0.0;
        if (abs(forwardSpeed) > 0.5) {
            slipRatio = (wheelLinearSpeed - forwardSpeed) / abs(forwardSpeed);
        } else if (abs(wheelLinearSpeed) > 0.5) {
            slipRatio = (wheelLinearSpeed - forwardSpeed) / abs(wheelLinearSpeed);
        }
        slipRatio = clamp(slipRatio, -1.0, 1.0);

        wheel.slipAngle = slipAngle;
        wheel.slipRatio = slipRatio;

        // Normal force from suspension
        let normalForce = length(suspForce);

        // Lateral tire force (cornering)
        let latForce = pacejkaTireForce(slipAngle, 0.12, wheel.tireFrictionLat * normalForce);
        tireForce -= wheelRight * latForce;

        // Longitudinal tire force (traction/braking)
        let lonForce = pacejkaTireForce(slipRatio, 0.08, wheel.tireFrictionLon * normalForce);
        tireForce += wheelForward * lonForce;

        // Brake force
        if (veh.brakeTorque > 0.0) {
            let brakeForceMag = min(veh.brakeTorque / max(wheel.radius, 0.1), normalForce * wheel.tireFrictionLon);
            if (abs(forwardSpeed) > 0.1) {
                tireForce -= wheelForward * sign(forwardSpeed) * brakeForceMag;
            }
        }

        // Engine drive force (only for driven wheels)
        if (wheel.isDriven != 0u && veh.engineTorque != 0.0) {
            let drivenWheelCount = select(
                select(f32(veh.wheelCount), 2.0, veh.driveType != 2u),
                2.0,
                veh.driveType != 2u
            );
            let wheelTorque = veh.engineTorque * veh.gearRatio * veh.finalDriveRatio / max(drivenWheelCount, 1.0);
            let driveForce = wheelTorque / max(wheel.radius, 0.1);
            tireForce += wheelForward * driveForce;
        }
    }

    wheel.tireForceX = tireForce.x;
    wheel.tireForceY = tireForce.y;
    wheel.tireForceZ = tireForce.z;

    // Update wheel angular velocity (simplified)
    if (isGrounded) {
        let groundVel = chassisVel - vec3<f32>(wheel.groundNormalX, wheel.groundNormalY, wheel.groundNormalZ) * dot(chassisVel, vec3<f32>(wheel.groundNormalX, wheel.groundNormalY, wheel.groundNormalZ));
        let forwardSpeed = dot(groundVel, wheelForward);
        wheel.angularVelocity = forwardSpeed / max(wheel.radius, 0.1);
    } else {
        // In air: spin down slowly
        wheel.angularVelocity *= 0.98;
    }

    wheels[wheelIdx] = wheel;
}
`;

// ============================================================================
// VEHICLE MANAGER (CPU-side orchestration)
// ============================================================================

/**
 * Default wheel presets for common vehicle types.
 */
export const WHEEL_PRESETS = {
    sedan: {
        radius: 0.35,
        suspensionRestLength: 0.3,
        suspensionStiffness: 30000,
        suspensionDamping: 4500,
        suspensionMaxTravel: 0.25,
        tireFrictionLat: 1.2,
        tireFrictionLon: 1.4,
        tireStiffness: 50000,
    },
    truck: {
        radius: 0.5,
        suspensionRestLength: 0.45,
        suspensionStiffness: 50000,
        suspensionDamping: 7000,
        suspensionMaxTravel: 0.35,
        tireFrictionLat: 1.0,
        tireFrictionLon: 1.2,
        tireStiffness: 70000,
    },
    sports: {
        radius: 0.32,
        suspensionRestLength: 0.2,
        suspensionStiffness: 45000,
        suspensionDamping: 5000,
        suspensionMaxTravel: 0.15,
        tireFrictionLat: 1.5,
        tireFrictionLon: 1.6,
        tireStiffness: 80000,
    },
    offroad: {
        radius: 0.45,
        suspensionRestLength: 0.5,
        suspensionStiffness: 25000,
        suspensionDamping: 4000,
        suspensionMaxTravel: 0.4,
        tireFrictionLat: 0.9,
        tireFrictionLon: 1.0,
        tireStiffness: 40000,
    },
};

/**
 * Default engine/transmission presets.
 */
export const ENGINE_PRESETS = {
    sedan: {
        maxTorque: 300,     // Nm
        maxRPM: 6500,
        idleRPM: 800,
        gearRatios: [-3.0, 0, 3.5, 2.5, 1.8, 1.3, 1.0, 0.8],
        finalDriveRatio: 3.7,
        driveType: DRIVE_FRONT,
    },
    sports: {
        maxTorque: 500,
        maxRPM: 8000,
        idleRPM: 1000,
        gearRatios: [-3.2, 0, 3.8, 2.6, 1.9, 1.4, 1.1, 0.85],
        finalDriveRatio: 3.4,
        driveType: DRIVE_REAR,
    },
    truck: {
        maxTorque: 700,
        maxRPM: 5000,
        idleRPM: 700,
        gearRatios: [-4.0, 0, 5.0, 3.5, 2.5, 1.8, 1.3, 1.0],
        finalDriveRatio: 4.1,
        driveType: DRIVE_AWD,
    },
    offroad: {
        maxTorque: 500,
        maxRPM: 5500,
        idleRPM: 750,
        gearRatios: [-3.5, 0, 4.5, 3.0, 2.2, 1.6, 1.2],
        finalDriveRatio: 4.5,
        driveType: DRIVE_AWD,
    },
};

const WHEEL_STRIDE = 192; // bytes per Wheel struct (48 floats)
const VEHICLE_STATE_STRIDE = 64; // bytes per VehicleState (16 floats)

export class GPUVehicleManager {
    constructor(device, options = {}) {
        this.device = device;
        this.maxVehicles = options.maxVehicles ?? MAX_VEHICLES;
        this.maxTotalWheels = options.maxTotalWheels ?? MAX_TOTAL_WHEELS;

        this.vehicles = [];       // CPU vehicle descriptors
        this.totalWheelCount = 0;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsF32 = new Float32Array(4);
        this._paramsU32 = new Uint32Array(this._paramsF32.buffer);

        // CPU-side data arrays
        this._cpuWheels = new Float32Array(this.maxTotalWheels * (WHEEL_STRIDE / 4));
        this._cpuVehicleStates = new Float32Array(this.maxVehicles * (VEHICLE_STATE_STRIDE / 4));
        this._wheelsDirty = false;
        this._vehiclesDirty = false;
    }

    async init(worldBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers);
        console.log(`[GPUVehicle] Initialized — maxVehicles=${this.maxVehicles}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        this._buffers.wheels = b('VH_Wheels', this.maxTotalWheels * WHEEL_STRIDE, SUW);
        this._buffers.vehicleStates = b('VH_VehicleStates', this.maxVehicles * VEHICLE_STATE_STRIDE, SUW);
        this._buffers.params = b('VH_Params', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    }

    async _createPipelines(worldBuffers) {
        const d = this.device;
        const module = d.createShaderModule({ label: 'VH_Suspension', code: VEHICLE_SUSPENSION_SHADER });
        this._pipelines.suspension = await d.createComputePipelineAsync({
            label: 'VH_Suspension', layout: 'auto',
            compute: { module, entryPoint: 'main' },
        });

        this._rebuildBindGroups(worldBuffers);
    }

    _rebuildBindGroups(wb) {
        const d = this.device;
        const B = this._buffers;

        this._bindGroups.suspension = d.createBindGroup({
            label: 'VH_Suspension_BG',
            layout: this._pipelines.suspension.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.wheels } },
                { binding: 1, resource: { buffer: B.vehicleStates } },
                { binding: 2, resource: { buffer: wb.positions } },
                { binding: 3, resource: { buffer: wb.rotations } },
                { binding: 4, resource: { buffer: wb.velocities } },
                { binding: 5, resource: { buffer: wb.angularVelocities } },
                { binding: 6, resource: { buffer: B.params } },
            ],
        });
    }

    // ========================================================================
    // VEHICLE CREATION
    // ========================================================================

    /**
     * Create a vehicle.
     * @param {Object} desc
     * @param {number} desc.bodyHandle - Handle from GPURigidBodyWorld.createBody()
     * @param {Array} desc.wheels - Array of wheel descriptors [{localPos, radius, ...}]
     * @param {Object} [desc.engine] - Engine preset or custom config
     * @param {string} [desc.preset] - Use a named preset ('sedan','sports','truck','offroad')
     * @returns {number} Vehicle index
     */
    createVehicle(desc = {}) {
        if (this.vehicles.length >= this.maxVehicles) {
            console.warn(`[GPUVehicle] MAX_VEHICLES (${this.maxVehicles}) exceeded`);
            return -1;
        }

        const preset = desc.preset || 'sedan';
        const wheelPreset = WHEEL_PRESETS[preset] || WHEEL_PRESETS.sedan;
        const enginePreset = ENGINE_PRESETS[preset] || ENGINE_PRESETS.sedan;
        const engine = { ...enginePreset, ...(desc.engine || {}) };

        const wheelDescs = desc.wheels || this._defaultWheelLayout(wheelPreset, engine.driveType);
        const wheelStartIdx = this.totalWheelCount;
        const wheelCount = wheelDescs.length;

        if (this.totalWheelCount + wheelCount > this.maxTotalWheels) {
            console.warn(`[GPUVehicle] MAX_TOTAL_WHEELS exceeded`);
            return -1;
        }

        // Write wheel data
        for (let i = 0; i < wheelCount; i++) {
            const w = { ...wheelPreset, ...wheelDescs[i] };
            const wi = (wheelStartIdx + i) * (WHEEL_STRIDE / 4);

            this._cpuWheels[wi + 0] = w.localPos?.[0] ?? 0;
            this._cpuWheels[wi + 1] = w.localPos?.[1] ?? 0;
            this._cpuWheels[wi + 2] = w.localPos?.[2] ?? 0;
            this._cpuWheels[wi + 3] = w.radius;
            this._cpuWheels[wi + 4] = w.suspensionRestLength;
            this._cpuWheels[wi + 5] = w.suspensionStiffness;
            this._cpuWheels[wi + 6] = w.suspensionDamping;
            this._cpuWheels[wi + 7] = w.suspensionMaxTravel;
            this._cpuWheels[wi + 8] = w.tireFrictionLat;
            this._cpuWheels[wi + 9] = w.tireFrictionLon;
            this._cpuWheels[wi + 10] = w.tireStiffness;
            this._cpuWheels[wi + 11] = w.brakeForce ?? 5000;
            const u32View = new Uint32Array(this._cpuWheels.buffer);
            u32View[wi + 12] = w.isDriven ? 1 : 0;
            this._cpuWheels[wi + 13] = w.steeringFactor ?? 0;
            this._cpuWheels[wi + 14] = w.camber ?? 0;
            // Rest is state — initialized to defaults
            this._cpuWheels[wi + 16] = w.suspensionRestLength; // suspensionLength = rest
        }

        this.totalWheelCount += wheelCount;

        // Vehicle state
        const vi = this.vehicles.length;
        const si = vi * (VEHICLE_STATE_STRIDE / 4);
        const stateU32 = new Uint32Array(this._cpuVehicleStates.buffer);

        stateU32[si + 0] = desc.bodyHandle ?? 0;
        stateU32[si + 1] = wheelCount;
        stateU32[si + 2] = wheelStartIdx;
        stateU32[si + 3] = engine.driveType;
        this._cpuVehicleStates[si + 4] = 0; // engineTorque (set per frame)
        this._cpuVehicleStates[si + 5] = 0; // brakeTorque
        this._cpuVehicleStates[si + 6] = 0; // steeringAngle
        // gear as i32
        new Int32Array(this._cpuVehicleStates.buffer)[si + 7] = GEAR_NEUTRAL;
        this._cpuVehicleStates[si + 8] = engine.gearRatios?.[GEAR_1 + 1] ?? 3.5;
        this._cpuVehicleStates[si + 9] = engine.finalDriveRatio;
        this._cpuVehicleStates[si + 10] = engine.idleRPM;
        this._cpuVehicleStates[si + 11] = 0; // speed
        this._cpuVehicleStates[si + 12] = desc.chassisMass ?? 1500;

        const vehicle = {
            index: vi,
            bodyHandle: desc.bodyHandle,
            wheelStartIdx,
            wheelCount,
            engine,
            currentGear: GEAR_NEUTRAL,
            throttle: 0,
            brake: 0,
            steering: 0,
            handbrake: false,
        };

        this.vehicles.push(vehicle);
        this._wheelsDirty = true;
        this._vehiclesDirty = true;

        return vi;
    }

    _defaultWheelLayout(preset, driveType) {
        const isFront = (driveType === DRIVE_FRONT || driveType === DRIVE_AWD);
        const isRear = (driveType === DRIVE_REAR || driveType === DRIVE_AWD);
        const w = 0.8; // half track width
        const f = 1.3; // front axle distance from center
        const r = -1.2; // rear axle distance from center
        const y = -0.3; // suspension attachment height

        return [
            { localPos: [-w, y, f], steeringFactor: 1.0, isDriven: isFront, ...preset },
            { localPos: [w, y, f],  steeringFactor: 1.0, isDriven: isFront, ...preset },
            { localPos: [-w, y, r], steeringFactor: 0.0, isDriven: isRear,  ...preset },
            { localPos: [w, y, r],  steeringFactor: 0.0, isDriven: isRear,  ...preset },
        ];
    }

    // ========================================================================
    // INPUT & UPDATE
    // ========================================================================

    /**
     * Set vehicle input state.
     * @param {number} vehicleIdx
     * @param {Object} input - { throttle: 0-1, brake: 0-1, steering: -1 to 1, handbrake: bool, gearUp: bool, gearDown: bool }
     */
    setInput(vehicleIdx, input = {}) {
        if (vehicleIdx < 0 || vehicleIdx >= this.vehicles.length) return;
        const v = this.vehicles[vehicleIdx];

        v.throttle = Math.max(0, Math.min(1, input.throttle ?? v.throttle));
        v.brake = Math.max(0, Math.min(1, input.brake ?? v.brake));
        v.steering = Math.max(-1, Math.min(1, input.steering ?? v.steering));
        v.handbrake = input.handbrake ?? v.handbrake;

        if (input.gearUp) this._shiftUp(v);
        if (input.gearDown) this._shiftDown(v);
    }

    _shiftUp(v) {
        const maxGear = v.engine.gearRatios.length - 2; // -1 for reverse slot, -1 for neutral
        if (v.currentGear < maxGear) v.currentGear++;
    }

    _shiftDown(v) {
        if (v.currentGear > GEAR_REVERSE) v.currentGear--;
    }

    /**
     * Update vehicle states before GPU dispatch.
     * Computes engine torque, gear ratio, etc. from inputs.
     */
    update(dt) {
        for (const v of this.vehicles) {
            const eng = v.engine;
            const si = v.index * (VEHICLE_STATE_STRIDE / 4);

            // Engine torque from throttle + torque curve
            const rpmFraction = Math.min(this._cpuVehicleStates[si + 10] / eng.maxRPM, 1);
            // Simple torque curve: peak at ~60% RPM
            const torqueCurve = 1.0 - Math.pow((rpmFraction - 0.6) * 2, 2) * 0.3;
            const engineTorque = v.throttle * eng.maxTorque * Math.max(torqueCurve, 0.1);

            // Gear ratio
            const gearIdx = v.currentGear + 1; // +1 because index 0 = reverse
            const gearRatio = eng.gearRatios[gearIdx] ?? 0;

            // Brake torque
            const brakeTorque = v.brake * 8000 + (v.handbrake ? 12000 : 0);

            // Steering angle (max ~35 degrees)
            const maxSteerAngle = 0.61; // ~35 degrees in radians
            const steerAngle = v.steering * maxSteerAngle;

            // Write to CPU buffer
            this._cpuVehicleStates[si + 4] = engineTorque;
            this._cpuVehicleStates[si + 5] = brakeTorque;
            this._cpuVehicleStates[si + 6] = steerAngle;
            new Int32Array(this._cpuVehicleStates.buffer)[si + 7] = v.currentGear;
            this._cpuVehicleStates[si + 8] = gearRatio;

            // Auto-shift (simple RPM-based)
            if (v.currentGear >= GEAR_1) {
                const rpm = this._cpuVehicleStates[si + 10];
                if (rpm > eng.maxRPM * 0.9 && v.currentGear < eng.gearRatios.length - 2) {
                    this._shiftUp(v);
                } else if (rpm < eng.idleRPM * 1.5 && v.currentGear > GEAR_1) {
                    this._shiftDown(v);
                }
            }
        }
        this._vehiclesDirty = true;
    }

    // ========================================================================
    // GPU DISPATCH
    // ========================================================================

    /**
     * Dispatch vehicle physics compute.
     * Call BEFORE the main rigid body step so forces are ready.
     * After dispatch, accumulated wheel forces need to be applied to chassis bodies.
     */
    dispatch(encoder, world) {
        if (this.vehicles.length === 0 || this.totalWheelCount === 0) return;

        // Upload dirty data
        if (this._wheelsDirty) {
            this.device.queue.writeBuffer(this._buffers.wheels, 0, this._cpuWheels);
            this._wheelsDirty = false;
        }
        if (this._vehiclesDirty) {
            this.device.queue.writeBuffer(this._buffers.vehicleStates, 0, this._cpuVehicleStates);
            this._vehiclesDirty = false;
        }

        // Write params
        this._paramsF32[0] = 1 / 60; // dt (will be overridden by caller)
        this._paramsF32[1] = -9.81;
        this._paramsU32[2] = this.vehicles.length;
        this._paramsU32[3] = this.totalWheelCount;
        this.device.queue.writeBuffer(this._buffers.params, 0, this._paramsF32);

        const wg = Math.ceil(this.totalWheelCount / 64);
        const pass = encoder.beginComputePass({ label: 'VH_Suspension' });
        pass.setPipeline(this._pipelines.suspension);
        pass.setBindGroup(0, this._bindGroups.suspension);
        pass.dispatchWorkgroups(wg);
        pass.end();
    }

    /**
     * After GPU dispatch + readback, apply accumulated wheel forces to chassis rigid bodies.
     * Called on CPU after readback.
     */
    applyForcesToWorld(world) {
        for (const v of this.vehicles) {
            let totalForceX = 0, totalForceY = 0, totalForceZ = 0;
            let totalTorqueX = 0, totalTorqueY = 0, totalTorqueZ = 0;

            for (let i = 0; i < v.wheelCount; i++) {
                const wi = (v.wheelStartIdx + i) * (WHEEL_STRIDE / 4);
                // Suspension force
                totalForceX += this._cpuWheels[wi + 32];
                totalForceY += this._cpuWheels[wi + 33];
                totalForceZ += this._cpuWheels[wi + 34];
                // Tire force
                totalForceX += this._cpuWheels[wi + 36];
                totalForceY += this._cpuWheels[wi + 37];
                totalForceZ += this._cpuWheels[wi + 38];
            }

            if (Math.abs(totalForceX) + Math.abs(totalForceY) + Math.abs(totalForceZ) > 0.001) {
                world.applyForce(v.bodyHandle, totalForceX, totalForceY, totalForceZ);
            }
        }
    }

    /**
     * Get vehicle state for UI/audio.
     */
    getVehicleState(vehicleIdx) {
        if (vehicleIdx < 0 || vehicleIdx >= this.vehicles.length) return null;
        const v = this.vehicles[vehicleIdx];
        const si = v.index * (VEHICLE_STATE_STRIDE / 4);

        return {
            index: vehicleIdx,
            bodyHandle: v.bodyHandle,
            currentGear: v.currentGear,
            engineRPM: this._cpuVehicleStates[si + 10],
            speed: this._cpuVehicleStates[si + 11],
            throttle: v.throttle,
            brake: v.brake,
            steering: v.steering,
            wheelCount: v.wheelCount,
        };
    }

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
        this.vehicles = [];
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createVehicleManager(device, worldBuffers, options = {}) {
    const mgr = new GPUVehicleManager(device, options);
    await mgr.init(worldBuffers);
    return mgr;
}

export function destroyVehicleManager(mgr) {
    if (mgr) mgr.destroy();
}
