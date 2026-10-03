// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FramePipeline — Generic phased stage executor.
 *
 * Engine-level primitive. Consumers (editor, game, tests) register
 * their own stages via addStage(). The pipeline knows nothing about
 * WebGPU, ECS, or any specific renderer — it just executes stages
 * in order within named phases.
 *
 * Phases (run in this order by execute()):
 *   fixedStep  — 0..N per frame (physics, PBD, fixed-rate sim)
 *   update     — 1/frame (camera, matrices, lights, animation)
 *   render     — 1/frame (GPU render passes)
 *   postRender — 1/frame (composites, post-FX, GPU submit)
 *
 * Inspired by:
 *   Unity     — FixedUpdate / Update / LateUpdate / OnPostRender
 *   Unreal    — TG_PrePhysics → TG_PostPhysics → TG_PostUpdateWork
 *   Bevy      — Extract → Prepare → Queue → Render → Cleanup
 *   Frostbite — Frame Graph (Setup → Compile → Execute)
 *
 * Complements engine/core/framegraph/FrameGraph.js which handles
 * resource dependency scheduling; this handles execution scheduling.
 */

const DEFAULT_PHASES = ['fixedStep', 'update', 'render', 'postRender'];

export class FramePipeline {
    /**
     * @param {Object} [options]
     * @param {number} [options.fixedDt=1/60]         Fixed timestep in seconds
     * @param {number} [options.maxFixedSteps=5]       Cap to prevent spiral of death
     * @param {number} [options.maxFrameTime]           Max dt added to accumulator per frame (default fixedDt * 3)
     * @param {number} [options.timeScale=1.0]          Simulation speed multiplier (scales accumulator input)
     * @param {string[]} [options.phases]               Custom phase names (default: fixedStep/update/render/postRender)
     */
    constructor(options = {}) {
        const phaseNames = options.phases || DEFAULT_PHASES;
        this.phases = new Map();
        for (let i = 0; i < phaseNames.length; i++) {
            this.phases.set(phaseNames[i], []);
        }

        this._stageMap = new Map();    // name → { stage, phaseName }
        this._timings = new Map();     // name → last execution ms
        this._fixedDt = options.fixedDt || (1 / 60);
        this._maxFixedSteps = options.maxFixedSteps || 5;
        this._maxFrameTime = options.maxFrameTime || (this._fixedDt * 1.5);
        this._timeScale = options.timeScale ?? 1.0;
        this._accumulator = 0;         // persistent fixed-step accumulator (seconds)
    }

    /**
     * Register a stage into a phase. Stages are sorted by `order`.
     * @param {string} phaseName
     * @param {Object} stage
     * @param {string} stage.name          Unique identifier
     * @param {number} stage.order         Sort key (lower = earlier)
     * @param {Function} stage.execute     (ctx) => void
     * @param {boolean} [stage.enabled=true]
     * @param {Function} [stage.condition] (ctx) => bool — skip when false
     */
    addStage(phaseName, stage) {
        const list = this.phases.get(phaseName);
        if (!list) {
            throw new Error(`FramePipeline: unknown phase '${phaseName}'`);
        }
        if (!stage || !stage.name) {
            throw new Error('FramePipeline: stage.name is required');
        }
        if (typeof stage.execute !== 'function') {
            throw new Error(`FramePipeline: stage '${stage.name}' requires an execute(ctx) function`);
        }
        if (this._stageMap.has(stage.name)) {
            throw new Error(`FramePipeline: stage '${stage.name}' already registered`);
        }

        stage.enabled = stage.enabled !== false;
        stage.order = stage.order ?? 0;
        list.push(stage);
        list.sort((a, b) => a.order - b.order);
        this._stageMap.set(stage.name, { stage, phaseName });
    }

    /**
     * Remove a stage by name (from any phase).
     * @param {string} name
     * @returns {boolean} true if found and removed
     */
    removeStage(name) {
        const entry = this._stageMap.get(name);
        if (!entry) return false;
        const list = this.phases.get(entry.phaseName);
        const idx = list.indexOf(entry.stage);
        if (idx >= 0) list.splice(idx, 1);
        this._stageMap.delete(name);
        this._timings.delete(name);
        return true;
    }

    /**
     * Runtime enable/disable toggle.
     * @param {string} name
     * @param {boolean} enabled
     */
    setEnabled(name, enabled) {
        const entry = this._stageMap.get(name);
        if (entry) entry.stage.enabled = !!enabled;
    }

    /**
     * Check if a stage is currently enabled.
     * @param {string} name
     * @returns {boolean}
     */
    isEnabled(name) {
        const entry = this._stageMap.get(name);
        return entry ? entry.stage.enabled : false;
    }

    /**
     * Execute all stages in a single phase.
     * @param {string} phaseName
     * @param {Object} ctx  FrameContext
     */
    executePhase(phaseName, ctx) {
        const list = this.phases.get(phaseName);
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
            const stage = list[i];
            if (!stage.enabled) continue;
            if (stage.condition && !stage.condition(ctx)) continue;
            const t0 = performance.now();
            stage.execute(ctx);
            this._timings.set(stage.name, performance.now() - t0);
        }
    }

    /**
     * Execute fixedStep phase 0..N times (Unity FixedUpdate / Gaffer "Fix Your Timestep" pattern).
     *
     * The pipeline owns the accumulator internally. Each frame:
     *   1. Scale dt by timeScale, clamp to maxFrameTime, add to accumulator
     *   2. Drain accumulator in fixedDt-sized steps (capped by maxFixedSteps)
     *   3. Post-drain clamp: if accumulator overflowed maxFixedSteps, discard excess
     *      (simulation gracefully slows instead of spiraling)
     *   4. Expose fixedAlpha for future render interpolation
     *
     * @param {Object} ctx  Must have ctx.dt (seconds)
     */
    executeFixedStep(ctx) {
        // 1. Scale + clamp input, feed accumulator
        const inputDt = Math.min(ctx.dt * this._timeScale, this._maxFrameTime);
        this._accumulator += inputDt;

        // Clear fixedStep timings so they accumulate correctly across iterations
        const list = this.phases.get('fixedStep');
        if (list) {
            for (let i = 0; i < list.length; i++) {
                this._timings.set(list[i].name, 0);
            }
        }

        // 2. Drain in fixed-size steps
        let steps = 0;
        while (this._accumulator >= this._fixedDt && steps < this._maxFixedSteps) {
            ctx.fixedDt = this._fixedDt;
            this._executePhaseAccum('fixedStep', ctx);
            this._accumulator -= this._fixedDt;
            steps++;
        }

        // 3. Post-drain clamp: discard excess if we hit maxFixedSteps
        //    Simulation slows gracefully under heavy load instead of catching up
        if (this._accumulator > this._fixedDt) {
            this._accumulator = this._fixedDt;
        }

        ctx.fixedStepCount = steps;
        // 4. Interpolation alpha: fraction of remainder for future render lerp
        ctx.fixedAlpha = this._fixedDt > 0 ? (this._accumulator / this._fixedDt) : 0;
    }

    /**
     * Execute a phase with timing accumulation (adds to existing timing values).
     * Used by executeFixedStep so multiple iterations sum correctly.
     * @param {string} phaseName
     * @param {Object} ctx
     */
    _executePhaseAccum(phaseName, ctx) {
        const list = this.phases.get(phaseName);
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
            const stage = list[i];
            if (!stage.enabled) continue;
            if (stage.condition && !stage.condition(ctx)) continue;
            const t0 = performance.now();
            stage.execute(ctx);
            const elapsed = performance.now() - t0;
            this._timings.set(stage.name, (this._timings.get(stage.name) || 0) + elapsed);
        }
    }

    /**
     * Run a complete frame: fixedStep → update → render → postRender.
     * @param {Object} ctx  FrameContext
     */
    execute(ctx) {
        this.executeFixedStep(ctx);
        this.executePhase('update', ctx);
        this.executePhase('render', ctx);
        this.executePhase('postRender', ctx);
    }

    /**
     * Get per-stage timing map (stage name → ms).
     * @returns {Map<string, number>}
     */
    getTimings() {
        return this._timings;
    }

    /**
     * Console-friendly timing dump.
     */
    dumpTimings() {
        const obj = {};
        for (const [name, ms] of this._timings) {
            obj[name] = ms.toFixed(3) + 'ms';
        }
        console.table(obj);
    }

    /**
     * Get ordered list of all registered stages (for debug UI / inspector).
     * @returns {Array<{name, phase, order, enabled}>}
     */
    getStageList() {
        const result = [];
        for (const [phaseName, list] of this.phases) {
            for (const stage of list) {
                result.push({
                    name: stage.name,
                    phase: phaseName,
                    order: stage.order,
                    enabled: stage.enabled,
                });
            }
        }
        return result;
    }

    /**
     * Get the fixed timestep value (seconds).
     * @returns {number}
     */
    get fixedDt() {
        return this._fixedDt;
    }

    /**
     * Set the fixed timestep value (seconds).
     * @param {number} dt
     */
    set fixedDt(dt) {
        this._fixedDt = dt;
    }

    /**
     * Get the max fixed steps per frame.
     * @returns {number}
     */
    get maxFixedSteps() {
        return this._maxFixedSteps;
    }

    /**
     * Set the max fixed steps per frame.
     * @param {number} n
     */
    set maxFixedSteps(n) {
        this._maxFixedSteps = n;
    }

    /**
     * Max frame time added to accumulator per frame (seconds).
     * Equivalent to Unity's Time.maximumDeltaTime.
     * Prevents spiral of death by clamping input before accumulation.
     * @returns {number}
     */
    get maxFrameTime() {
        return this._maxFrameTime;
    }

    /** @param {number} t */
    set maxFrameTime(t) {
        this._maxFrameTime = t;
    }

    /**
     * Simulation time scale (default 1.0).
     * Equivalent to Unity's Time.timeScale.
     * Scales the accumulator input rate — timeScale=2 means 2× more fixed steps,
     * NOT 2× larger dt (which would destabilize physics).
     * @returns {number}
     */
    get timeScale() {
        return this._timeScale;
    }

    /** @param {number} s */
    set timeScale(s) {
        this._timeScale = s;
    }

    /**
     * Current accumulator value (seconds). Read-only diagnostic.
     * @returns {number}
     */
    get accumulator() {
        return this._accumulator;
    }

    /**
     * Reset the accumulator (e.g. on play/stop transition).
     */
    resetAccumulator() {
        this._accumulator = 0;
    }

    /**
     * Total number of registered stages across all phases.
     * @returns {number}
     */
    get stageCount() {
        return this._stageMap.size;
    }
}
