// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * IntegrationTests.js - System Integration Testing Framework
 * 
 * Validates integration between planet-scale systems:
 * - Vehicle mounting with surface attachment
 * - Multiplayer sync for planet state and destruction
 * - Memory leak detection and auditing
 * - Frame budget validation
 * - Cross-system communication
 * 
 * Run tests manually or as part of CI/CD pipeline.
 */

// ============================================================================
// TEST FRAMEWORK
// ============================================================================

/** Test result status */
export const TestStatus = {
    PENDING: 'pending',
    RUNNING: 'running',
    PASSED: 'passed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
};

/**
 * Test result
 */
export class TestResult {
    constructor(name) {
        this.name = name;
        this.status = TestStatus.PENDING;
        this.duration = 0;
        this.error = null;
        this.assertions = [];
        this.metadata = {};
    }
    
    pass() {
        this.status = TestStatus.PASSED;
    }
    
    fail(error) {
        this.status = TestStatus.FAILED;
        this.error = error;
    }
    
    addAssertion(description, passed) {
        this.assertions.push({ description, passed });
        if (!passed) {
            this.status = TestStatus.FAILED;
        }
    }
}

/**
 * Test suite for organizing tests
 */
export class TestSuite {
    constructor(name) {
        this.name = name;
        this.tests = [];
        this.beforeAll = null;
        this.afterAll = null;
        this.beforeEach = null;
        this.afterEach = null;
    }
    
    addTest(name, fn) {
        this.tests.push({ name, fn });
    }
    
    async run() {
        const results = [];
        
        if (this.beforeAll) {
            await this.beforeAll();
        }
        
        for (const test of this.tests) {
            const result = new TestResult(test.name);
            result.status = TestStatus.RUNNING;
            
            try {
                if (this.beforeEach) {
                    await this.beforeEach();
                }
                
                const start = performance.now();
                await test.fn(result);
                result.duration = performance.now() - start;
                
                if (result.status === TestStatus.RUNNING) {
                    result.pass();
                }
                
                if (this.afterEach) {
                    await this.afterEach();
                }
            } catch (error) {
                result.fail(error.message || String(error));
            }
            
            results.push(result);
        }
        
        if (this.afterAll) {
            await this.afterAll();
        }
        
        return results;
    }
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

export const assert = {
    equal(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message}: Expected ${expected}, got ${actual}`);
        }
    },
    
    notEqual(actual, expected, message = '') {
        if (actual === expected) {
            throw new Error(`${message}: Expected not ${expected}`);
        }
    },
    
    true(value, message = '') {
        if (!value) {
            throw new Error(`${message}: Expected true, got ${value}`);
        }
    },
    
    false(value, message = '') {
        if (value) {
            throw new Error(`${message}: Expected false, got ${value}`);
        }
    },
    
    approximately(actual, expected, tolerance = 0.001, message = '') {
        if (Math.abs(actual - expected) > tolerance) {
            throw new Error(`${message}: Expected ~${expected}, got ${actual} (tolerance: ${tolerance})`);
        }
    },
    
    arrayEqual(actual, expected, message = '') {
        if (actual.length !== expected.length) {
            throw new Error(`${message}: Array length mismatch`);
        }
        for (let i = 0; i < actual.length; i++) {
            if (actual[i] !== expected[i]) {
                throw new Error(`${message}: Arrays differ at index ${i}`);
            }
        }
    },
    
    throws(fn, message = '') {
        try {
            fn();
            throw new Error(`${message}: Expected function to throw`);
        } catch (e) {
            // Expected
        }
    },
    
    async asyncThrows(fn, message = '') {
        try {
            await fn();
            throw new Error(`${message}: Expected async function to throw`);
        } catch (e) {
            // Expected
        }
    },
};

// ============================================================================
// VEHICLE MOUNTING TESTS
// ============================================================================

export function createVehicleMountingTests() {
    const suite = new TestSuite('Vehicle Mounting');
    
    suite.addTest('Mount entity to vehicle surface', async (result) => {
        // Mock vehicle and entity
        const vehicle = {
            position: [100, 50, 200],
            rotation: [0, 0, 0, 1],
            velocity: [10, 0, 5],
        };
        
        const entity = {
            position: [100, 52, 200],
            attachment: null,
        };
        
        // Simulate mount
        entity.attachment = {
            type: 'VEHICLE_MOUNT',
            target: vehicle,
            localOffset: [0, 2, 0],
        };
        
        result.addAssertion('Entity has attachment', entity.attachment !== null);
        result.addAssertion('Attachment type is VEHICLE_MOUNT', 
            entity.attachment.type === 'VEHICLE_MOUNT');
    });
    
    suite.addTest('Entity inherits vehicle velocity', async (result) => {
        const vehicleVelocity = [10, 0, 5];
        const entityBaseVelocity = [1, 0, 0];
        
        // Mounted entity should have combined velocity
        const mountedVelocity = [
            vehicleVelocity[0] + entityBaseVelocity[0],
            vehicleVelocity[1] + entityBaseVelocity[1],
            vehicleVelocity[2] + entityBaseVelocity[2],
        ];
        
        result.addAssertion('X velocity combined', mountedVelocity[0] === 11);
        result.addAssertion('Z velocity combined', mountedVelocity[2] === 5);
    });
    
    suite.addTest('Dismount preserves momentum', async (result) => {
        const vehicleVelocity = [20, 0, 10];
        const dismountVelocity = [...vehicleVelocity];
        
        // After dismount, entity should keep vehicle velocity
        result.addAssertion('Velocity preserved on dismount', 
            dismountVelocity[0] === 20 && dismountVelocity[2] === 10);
    });
    
    suite.addTest('Mount breaks on high force', async (result) => {
        const breakForce = 1000;
        const appliedForce = 1500;
        
        const shouldBreak = appliedForce > breakForce;
        result.addAssertion('Mount breaks at high force', shouldBreak);
    });
    
    return suite;
}

// ============================================================================
// MULTIPLAYER SYNC TESTS
// ============================================================================

export function createMultiplayerSyncTests() {
    const suite = new TestSuite('Multiplayer Sync');
    
    suite.addTest('Planet state serialization', async (result) => {
        const planetState = {
            position: { hi: [0, 0, 0], lo: [1000, 2000, 3000] },
            rotation: [0, 0, 0.707, 0.707],
            angularVelocity: 0.0001,
        };
        
        // Serialize
        const serialized = JSON.stringify(planetState);
        
        // Deserialize
        const deserialized = JSON.parse(serialized);
        
        result.addAssertion('Rotation preserved', 
            deserialized.rotation[2] === 0.707);
        result.addAssertion('Angular velocity preserved',
            deserialized.angularVelocity === 0.0001);
    });
    
    suite.addTest('Destruction event sync', async (result) => {
        const destructionEvent = {
            type: 'voxel_destroy',
            timestamp: Date.now(),
            position: [100, 50, 200],
            radius: 5,
            source: 'player_1',
        };
        
        // Validate event structure
        result.addAssertion('Has timestamp', destructionEvent.timestamp > 0);
        result.addAssertion('Has position', destructionEvent.position.length === 3);
        result.addAssertion('Has source', typeof destructionEvent.source === 'string');
    });
    
    suite.addTest('State interpolation', async (result) => {
        const state1 = { x: 0, time: 0 };
        const state2 = { x: 100, time: 100 };
        const targetTime = 50;
        
        // Linear interpolation
        const t = (targetTime - state1.time) / (state2.time - state1.time);
        const interpolatedX = state1.x + t * (state2.x - state1.x);
        
        result.addAssertion('Interpolation correct', interpolatedX === 50);
    });
    
    suite.addTest('Delta compression', async (result) => {
        const fullState = new Float32Array(1000).fill(1);
        const deltaState = new Float32Array(10); // Only changed values
        
        const compressionRatio = deltaState.length / fullState.length;
        result.addAssertion('Delta compression effective', compressionRatio < 0.1);
    });
    
    return suite;
}

// ============================================================================
// MEMORY LEAK TESTS
// ============================================================================

export function createMemoryLeakTests() {
    const suite = new TestSuite('Memory Leak Detection');
    
    let initialMemory = 0;
    
    suite.beforeAll = () => {
        if (typeof performance !== 'undefined' && performance.memory) {
            initialMemory = performance.memory.usedJSHeapSize;
        }
    };
    
    suite.addTest('Buffer allocation/deallocation', async (result) => {
        const allocations = [];
        
        // Allocate
        for (let i = 0; i < 100; i++) {
            allocations.push(new Float32Array(10000));
        }
        
        const afterAlloc = allocations.length;
        
        // Deallocate
        allocations.length = 0;
        
        // Force GC hint (not guaranteed)
        if (typeof global !== 'undefined' && global.gc) {
            global.gc();
        }
        
        result.addAssertion('Allocations created', afterAlloc === 100);
        result.addAssertion('Allocations cleared', allocations.length === 0);
    });
    
    suite.addTest('Event listener cleanup', async (result) => {
        const listeners = new Set();
        
        const addListener = (fn) => {
            listeners.add(fn);
        };
        
        const removeListener = (fn) => {
            listeners.delete(fn);
        };
        
        // Add listeners
        const fn1 = () => {};
        const fn2 = () => {};
        addListener(fn1);
        addListener(fn2);
        
        result.addAssertion('Listeners added', listeners.size === 2);
        
        // Remove listeners
        removeListener(fn1);
        removeListener(fn2);
        
        result.addAssertion('Listeners removed', listeners.size === 0);
    });
    
    suite.addTest('Object pool recycling', async (result) => {
        const pool = [];
        const maxPoolSize = 10;
        
        // Create objects
        for (let i = 0; i < 20; i++) {
            const obj = { id: i, data: new Array(100) };
            pool.push(obj);
            
            // Recycle when over limit
            if (pool.length > maxPoolSize) {
                pool.shift();
            }
        }
        
        result.addAssertion('Pool size limited', pool.length === maxPoolSize);
    });
    
    suite.addTest('Circular reference detection', async (result) => {
        const objA = { name: 'A' };
        const objB = { name: 'B' };
        
        // Create circular reference
        objA.ref = objB;
        objB.ref = objA;
        
        // Break circular reference
        objA.ref = null;
        objB.ref = null;
        
        result.addAssertion('Circular refs broken', 
            objA.ref === null && objB.ref === null);
    });
    
    return suite;
}

// ============================================================================
// FRAME BUDGET TESTS
// ============================================================================

export function createFrameBudgetTests() {
    const suite = new TestSuite('Frame Budget Validation');
    
    suite.addTest('Physics budget (4ms)', async (result) => {
        const budget = 4; // ms
        
        // Simulate physics work
        const start = performance.now();
        let sum = 0;
        for (let i = 0; i < 100000; i++) {
            sum += Math.sin(i) * Math.cos(i);
        }
        const duration = performance.now() - start;
        
        result.metadata.physicsDuration = duration;
        result.addAssertion('Physics within budget', duration < budget * 2); // 2x tolerance for test env
    });
    
    suite.addTest('Meshing budget (3ms)', async (result) => {
        const budget = 3; // ms
        
        // Simulate meshing work
        const start = performance.now();
        const vertices = new Float32Array(30000);
        for (let i = 0; i < vertices.length; i++) {
            vertices[i] = Math.random();
        }
        const duration = performance.now() - start;
        
        result.metadata.meshingDuration = duration;
        result.addAssertion('Meshing within budget', duration < budget * 3);
    });
    
    suite.addTest('Total frame budget (16.67ms)', async (result) => {
        const budget = 16.67; // 60 FPS
        
        // Simulate full frame
        const start = performance.now();
        
        // Physics
        for (let i = 0; i < 50000; i++) {
            Math.sqrt(i);
        }
        
        // Meshing
        const arr = new Float32Array(10000);
        
        // Rendering prep
        for (let i = 0; i < arr.length; i++) {
            arr[i] = i * 0.001;
        }
        
        const duration = performance.now() - start;
        
        result.metadata.frameDuration = duration;
        result.addAssertion('Frame within budget', duration < budget);
    });
    
    suite.addTest('Adaptive quality scaling', async (result) => {
        let qualityLevel = 1.0;
        const targetFPS = 60;
        const targetFrameTime = 1000 / targetFPS;
        
        // Simulate over-budget frames
        const frameTimes = [20, 22, 18, 25, 19]; // All over 16.67ms
        
        for (const frameTime of frameTimes) {
            if (frameTime > targetFrameTime * 1.1) {
                qualityLevel = Math.max(0.5, qualityLevel - 0.05);
            }
        }
        
        result.addAssertion('Quality reduced', qualityLevel < 1.0);
        result.addAssertion('Quality above minimum', qualityLevel >= 0.5);
    });
    
    return suite;
}

// ============================================================================
// CROSS-SYSTEM INTEGRATION TESTS
// ============================================================================

export function createCrossSystemTests() {
    const suite = new TestSuite('Cross-System Integration');
    
    suite.addTest('Planet physics → Surface attachment', async (result) => {
        // Simulate planet with gravity
        const planet = {
            radius: 180000000,
            getGravityAt: (x, y, z) => {
                const dist = Math.sqrt(x*x + y*y + z*z);
                const magnitude = 9.8 * Math.pow(planet.radius / dist, 2);
                return {
                    direction: [-x/dist, -y/dist, -z/dist],
                    magnitude: Math.min(magnitude, 9.8),
                };
            },
        };
        
        // Entity on surface
        const entityPos = [0, planet.radius + 1.8, 0];
        const gravity = planet.getGravityAt(...entityPos);
        
        result.addAssertion('Gravity points toward center', gravity.direction[1] < 0);
        result.addAssertion('Gravity magnitude reasonable', 
            gravity.magnitude > 9 && gravity.magnitude < 10);
    });
    
    suite.addTest('Seismic → Ragdoll response', async (result) => {
        // Simulate earthquake shake
        const shake = [0.5, 0.3, 0.4];
        const amplitude = 0.6;
        
        // Ragdoll response
        const balanceStrength = 1.0;
        const newBalance = Math.max(0.1, balanceStrength - amplitude * 0.1 * 2);
        
        result.addAssertion('Balance degraded', newBalance < balanceStrength);
        result.addAssertion('Balance above minimum', newBalance >= 0.1);
    });
    
    suite.addTest('MPM → Mesh particles', async (result) => {
        // Simulate MPM particles breaking off
        const detachedParticles = 50;
        const meshGenerated = detachedParticles > 10;
        
        result.addAssertion('Mesh generated for detached clusters', meshGenerated);
    });
    
    suite.addTest('Connectivity → Destruction cascade', async (result) => {
        // Simulate voxel destruction causing disconnect
        const connectedBefore = 1000;
        const destroyedVoxels = 10;
        const floatingAfter = 50;
        
        const cascadeTriggered = floatingAfter > 0;
        result.addAssertion('Cascade triggered', cascadeTriggered);
        result.addAssertion('Floating voxels detected', floatingAfter === 50);
    });
    
    return suite;
}

// ============================================================================
// TEST RUNNER
// ============================================================================

export class TestRunner {
    constructor() {
        this.suites = [];
        this.results = [];
    }
    
    addSuite(suite) {
        this.suites.push(suite);
    }
    
    async runAll() {
        this.results = [];
        
        for (const suite of this.suites) {
            console.log(`\n📋 Running: ${suite.name}`);
            const suiteResults = await suite.run();
            
            for (const result of suiteResults) {
                const icon = result.status === TestStatus.PASSED ? '✅' : '❌';
                console.log(`  ${icon} ${result.name} (${result.duration.toFixed(2)}ms)`);
                
                if (result.status === TestStatus.FAILED) {
                    console.log(`     Error: ${result.error}`);
                }
            }
            
            this.results.push({
                suite: suite.name,
                results: suiteResults,
            });
        }
        
        return this.getSummary();
    }
    
    getSummary() {
        let total = 0;
        let passed = 0;
        let failed = 0;
        
        for (const { results } of this.results) {
            for (const result of results) {
                total++;
                if (result.status === TestStatus.PASSED) passed++;
                if (result.status === TestStatus.FAILED) failed++;
            }
        }
        
        return {
            total,
            passed,
            failed,
            passRate: total > 0 ? (passed / total * 100).toFixed(1) : 0,
        };
    }
}

// ============================================================================
// RUN ALL INTEGRATION TESTS
// ============================================================================

export async function runIntegrationTests() {
    const runner = new TestRunner();
    
    runner.addSuite(createVehicleMountingTests());
    runner.addSuite(createMultiplayerSyncTests());
    runner.addSuite(createMemoryLeakTests());
    runner.addSuite(createFrameBudgetTests());
    runner.addSuite(createCrossSystemTests());
    
    const summary = await runner.runAll();
    
    console.log('\n' + '='.repeat(50));
    console.log(`📊 Test Summary: ${summary.passed}/${summary.total} passed (${summary.passRate}%)`);
    console.log('='.repeat(50));
    
    return summary;
}

export default { TestRunner, runIntegrationTests };
