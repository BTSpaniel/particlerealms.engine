// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WorldTime.js - Comprehensive Temporal Architecture
 * 
 * Implements robust server-side time tracking based on:
 * - Tick-based architecture with 64-bit precision (BigInt)
 * - Hierarchical Timing Wheels for O(1) event scheduling
 * - Custom calendar system derived from total ticks
 * - Timescale ratios (game time vs real time)
 * - Offline progression support
 * - Network clock synchronization
 * 
 * Reference: "Temporal Architecture in Virtual Environments"
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Ticks per second (server tick rate) */
import { oneWayLatencyEstimateMs } from '../core/math/NetworkMetricMath.js';

export const TICKS_PER_SECOND = 20;  // Like Minecraft

/** Tick duration in milliseconds */
export const TICK_DURATION_MS = 1000 / TICKS_PER_SECOND;  // 50ms

/** High-precision ticks (100-nanosecond intervals, like .NET DateTime.Ticks) */
export const PRECISION_TICKS_PER_SECOND = 10_000_000n;  // 10 million

/** Timescale presets (game:real ratios) */
export const TIMESCALE = {
    REALTIME: 1,      // 1:1 (Animal Crossing style)
    SLOW: 6,          // 6:1 (4 hour day)
    NORMAL: 20,       // 20:1 (Skyrim default - 72 min day)
    FAST: 72,         // 72:1 (Minecraft - 20 min day)
    SUPER_FAST: 144,  // 144:1 (10 min day)
};

/** Calendar configuration */
export const CALENDAR_CONFIG = {
    MONTHS_PER_YEAR: 4,
    DAYS_PER_MONTH: 28,
    HOURS_PER_DAY: 24,
    MINUTES_PER_HOUR: 60,
    SECONDS_PER_MINUTE: 60,
};

/** Derived constants */
export const SECONDS_PER_DAY = CALENDAR_CONFIG.HOURS_PER_DAY * 
    CALENDAR_CONFIG.MINUTES_PER_HOUR * CALENDAR_CONFIG.SECONDS_PER_MINUTE;
export const DAYS_PER_YEAR = CALENDAR_CONFIG.MONTHS_PER_YEAR * CALENDAR_CONFIG.DAYS_PER_MONTH;
export const TICKS_PER_DAY = BigInt(SECONDS_PER_DAY * TICKS_PER_SECOND);
export const TICKS_PER_YEAR = BigInt(DAYS_PER_YEAR) * TICKS_PER_DAY;

/** Moon phases */
export const MOON_PHASE = {
    NEW: 0,
    WAXING_CRESCENT: 1,
    FIRST_QUARTER: 2,
    WAXING_GIBBOUS: 3,
    FULL: 4,
    WANING_GIBBOUS: 5,
    LAST_QUARTER: 6,
    WANING_CRESCENT: 7,
};

/** Season names */
export const SEASON = {
    SPRING: 0,
    SUMMER: 1,
    AUTUMN: 2,
    WINTER: 3,
};

const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
const MOON_PHASE_NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 
    'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];

// ============================================================================
// GAME DATE - Derived from Total Ticks
// ============================================================================

/**
 * GameDate - A view of the world time as calendar date
 * Never store date components directly - always derive from ticks
 */
export class GameDate {
    /**
     * @param {BigInt} totalTicks - Total world ticks since epoch
     */
    constructor(totalTicks) {
        this._ticks = BigInt(totalTicks);
    }
    
    get ticks() { return this._ticks; }
    
    /** Total seconds since epoch */
    get totalSeconds() {
        return Number(this._ticks / BigInt(TICKS_PER_SECOND));
    }
    
    /** Total days since epoch */
    get totalDays() {
        return Number(this._ticks / TICKS_PER_DAY);
    }
    
    /** Current year (1-indexed) */
    get year() {
        return Math.floor(this.totalDays / DAYS_PER_YEAR) + 1;
    }
    
    /** Day of year (0-indexed) */
    get dayOfYear() {
        return this.totalDays % DAYS_PER_YEAR;
    }
    
    /** Current season (0-3) */
    get season() {
        return Math.floor(this.dayOfYear / CALENDAR_CONFIG.DAYS_PER_MONTH) % 4;
    }
    
    /** Season name */
    get seasonName() {
        return SEASON_NAMES[this.season];
    }
    
    /** Current month (1-indexed) */
    get month() {
        return (Math.floor(this.dayOfYear / CALENDAR_CONFIG.DAYS_PER_MONTH) % 
            CALENDAR_CONFIG.MONTHS_PER_YEAR) + 1;
    }
    
    /** Day of month (1-indexed) */
    get day() {
        return (this.dayOfYear % CALENDAR_CONFIG.DAYS_PER_MONTH) + 1;
    }
    
    /** Hour of day (0-23) */
    get hour() {
        const ticksInDay = Number(this._ticks % TICKS_PER_DAY);
        const secondsInDay = ticksInDay / TICKS_PER_SECOND;
        return Math.floor(secondsInDay / (CALENDAR_CONFIG.MINUTES_PER_HOUR * 
            CALENDAR_CONFIG.SECONDS_PER_MINUTE));
    }
    
    /** Minute of hour (0-59) */
    get minute() {
        const ticksInDay = Number(this._ticks % TICKS_PER_DAY);
        const secondsInDay = ticksInDay / TICKS_PER_SECOND;
        const minutesInDay = secondsInDay / CALENDAR_CONFIG.SECONDS_PER_MINUTE;
        return Math.floor(minutesInDay) % CALENDAR_CONFIG.MINUTES_PER_HOUR;
    }
    
    /** Second of minute (0-59) */
    get second() {
        const ticksInDay = Number(this._ticks % TICKS_PER_DAY);
        const secondsInDay = ticksInDay / TICKS_PER_SECOND;
        return Math.floor(secondsInDay) % CALENDAR_CONFIG.SECONDS_PER_MINUTE;
    }
    
    /** Normalized time of day (0.0 = midnight, 0.5 = noon, 1.0 = midnight) */
    get normalizedTimeOfDay() {
        const ticksInDay = Number(this._ticks % TICKS_PER_DAY);
        return ticksInDay / Number(TICKS_PER_DAY);
    }
    
    /** Is it daytime (6:00 - 18:00)? */
    get isDaytime() {
        const h = this.hour;
        return h >= 6 && h < 18;
    }
    
    /** Is it night (18:00 - 6:00)? */
    get isNighttime() {
        return !this.isDaytime;
    }
    
    /** Moon phase (0-7) based on 28-day cycle */
    get moonPhase() {
        const dayInCycle = this.totalDays % 28;
        return Math.floor(dayInCycle / 3.5);
    }
    
    /** Moon phase name */
    get moonPhaseName() {
        return MOON_PHASE_NAMES[this.moonPhase];
    }
    
    /** Moon illumination (0.0 = new, 1.0 = full) */
    get moonIllumination() {
        const phase = this.moonPhase;
        if (phase <= 4) return phase / 4;
        return (8 - phase) / 4;
    }
    
    /** Format as string */
    toString() {
        const h = this.hour.toString().padStart(2, '0');
        const m = this.minute.toString().padStart(2, '0');
        return `Year ${this.year}, ${this.seasonName} ${this.day}, ${h}:${m}`;
    }
    
    /** Format as short date */
    toShortString() {
        return `Y${this.year} M${this.month} D${this.day}`;
    }
    
    /** Format time only */
    toTimeString() {
        const h = this.hour.toString().padStart(2, '0');
        const m = this.minute.toString().padStart(2, '0');
        return `${h}:${m}`;
    }
    
    /** Add ticks and return new date */
    addTicks(ticks) {
        return new GameDate(this._ticks + BigInt(ticks));
    }
    
    /** Add days and return new date */
    addDays(days) {
        return new GameDate(this._ticks + BigInt(days) * TICKS_PER_DAY);
    }
    
    /** Compare with another date */
    compareTo(other) {
        if (this._ticks < other._ticks) return -1;
        if (this._ticks > other._ticks) return 1;
        return 0;
    }
}

// ============================================================================
// HIERARCHICAL TIMING WHEEL - O(1) Event Scheduling
// ============================================================================

/**
 * TimingWheel - Single level of the hierarchical wheel
 */
class TimingWheel {
    /**
     * @param {number} slots - Number of slots in wheel
     * @param {number} resolution - Ticks per slot
     */
    constructor(slots, resolution) {
        this.slots = slots;
        this.resolution = resolution;
        this.buckets = new Array(slots).fill(null).map(() => new Set());
        this.cursor = 0;
    }
    
    /** Get bucket for a tick offset */
    getBucketIndex(tickOffset) {
        const slotOffset = Math.floor(tickOffset / this.resolution);
        return (this.cursor + slotOffset) % this.slots;
    }
    
    /** Add event to bucket */
    add(event, tickOffset) {
        const index = this.getBucketIndex(tickOffset);
        this.buckets[index].add(event);
    }
    
    /** Remove event from bucket */
    remove(event, tickOffset) {
        const index = this.getBucketIndex(tickOffset);
        this.buckets[index].delete(event);
    }
    
    /** Advance cursor and return expired events */
    tick() {
        const expired = this.buckets[this.cursor];
        this.buckets[this.cursor] = new Set();
        this.cursor = (this.cursor + 1) % this.slots;
        return expired;
    }
    
    /** Get all events (for cascading) */
    getCurrentBucket() {
        return this.buckets[this.cursor];
    }
}

/**
 * HierarchicalTimingWheel - Multi-level timing wheel for efficient scheduling
 * 
 * Level 0: Ticks (20 slots = 1 second at 20 TPS)
 * Level 1: Seconds (60 slots = 1 minute)
 * Level 2: Minutes (60 slots = 1 hour)
 * Level 3: Hours (24 slots = 1 day)
 * Level 4: Days (28 slots = 1 month)
 */
export class HierarchicalTimingWheel {
    constructor() {
        this.wheels = [
            new TimingWheel(TICKS_PER_SECOND, 1),           // Level 0: ticks
            new TimingWheel(60, TICKS_PER_SECOND),          // Level 1: seconds
            new TimingWheel(60, TICKS_PER_SECOND * 60),     // Level 2: minutes
            new TimingWheel(24, TICKS_PER_SECOND * 3600),   // Level 3: hours
            new TimingWheel(28, TICKS_PER_SECOND * 86400),  // Level 4: days
        ];
        
        this.eventMap = new Map();  // eventId -> { event, level, tickOffset }
        this.nextEventId = 1;
        this.currentTick = 0n;
        
        // Stats
        this.stats = {
            scheduled: 0,
            executed: 0,
            cancelled: 0,
            cascaded: 0,
        };
    }
    
    /**
     * Schedule an event
     * @param {Function} callback - Function to execute
     * @param {number} delayTicks - Delay in ticks
     * @param {Object} data - Optional data to pass to callback
     * @returns {number} Event ID for cancellation
     */
    schedule(callback, delayTicks, data = null) {
        const eventId = this.nextEventId++;
        const executionTick = this.currentTick + BigInt(delayTicks);
        
        const event = {
            id: eventId,
            callback,
            data,
            executionTick,
            delayTicks,
        };
        
        // Find appropriate wheel level
        const level = this._findLevel(delayTicks);
        this.wheels[level].add(event, delayTicks);
        
        this.eventMap.set(eventId, { event, level, tickOffset: delayTicks });
        this.stats.scheduled++;
        
        return eventId;
    }
    
    /**
     * Schedule recurring event
     * @param {Function} callback - Function to execute
     * @param {number} intervalTicks - Interval in ticks
     * @param {Object} data - Optional data
     * @returns {number} Event ID
     */
    scheduleRecurring(callback, intervalTicks, data = null) {
        const eventId = this.nextEventId++;
        
        const recurringCallback = () => {
            callback(data);
            // Reschedule
            if (this.eventMap.has(eventId)) {
                const newDelay = intervalTicks;
                const level = this._findLevel(newDelay);
                const event = this.eventMap.get(eventId).event;
                event.executionTick = this.currentTick + BigInt(newDelay);
                event.delayTicks = newDelay;
                this.wheels[level].add(event, newDelay);
                this.eventMap.get(eventId).level = level;
                this.eventMap.get(eventId).tickOffset = newDelay;
            }
        };
        
        const event = {
            id: eventId,
            callback: recurringCallback,
            data,
            executionTick: this.currentTick + BigInt(intervalTicks),
            delayTicks: intervalTicks,
            recurring: true,
        };
        
        const level = this._findLevel(intervalTicks);
        this.wheels[level].add(event, intervalTicks);
        this.eventMap.set(eventId, { event, level, tickOffset: intervalTicks });
        this.stats.scheduled++;
        
        return eventId;
    }
    
    /**
     * Cancel a scheduled event
     * @param {number} eventId - Event ID from schedule()
     * @returns {boolean} True if cancelled
     */
    cancel(eventId) {
        const info = this.eventMap.get(eventId);
        if (!info) return false;
        
        this.wheels[info.level].remove(info.event, info.tickOffset);
        this.eventMap.delete(eventId);
        this.stats.cancelled++;
        return true;
    }
    
    /**
     * Advance the wheel by one tick and execute due events
     * @returns {Array} Executed events
     */
    tick() {
        this.currentTick++;
        const executed = [];
        
        // Process level 0 (finest granularity)
        const expired = this.wheels[0].tick();
        
        for (const event of expired) {
            if (event.executionTick <= this.currentTick) {
                // Execute
                try {
                    event.callback(event.data);
                } catch (err) {
                    console.error('[TimingWheel] Event error:', err);
                }
                executed.push(event);
                this.stats.executed++;
                
                if (!event.recurring) {
                    this.eventMap.delete(event.id);
                }
            } else {
                // Not yet due (cascaded too early), reschedule
                const remaining = Number(event.executionTick - this.currentTick);
                const level = this._findLevel(remaining);
                this.wheels[level].add(event, remaining);
            }
        }
        
        // Cascade higher levels when their cursors advance
        this._cascade();
        
        return executed;
    }
    
    /**
     * Cascade events from higher levels to lower levels
     */
    _cascade() {
        const ticksPerSecond = TICKS_PER_SECOND;
        
        // Check each wheel for cascade
        for (let level = 1; level < this.wheels.length; level++) {
            const wheel = this.wheels[level];
            const lowerResolution = this.wheels[level - 1].resolution * 
                this.wheels[level - 1].slots;
            
            // If we've completed a full rotation of the lower wheel
            if (Number(this.currentTick) % lowerResolution === 0) {
                const bucket = wheel.tick();
                
                for (const event of bucket) {
                    // Cascade down to appropriate level
                    const remaining = Number(event.executionTick - this.currentTick);
                    if (remaining <= 0) {
                        // Execute immediately
                        try {
                            event.callback(event.data);
                        } catch (err) {
                            console.error('[TimingWheel] Cascade event error:', err);
                        }
                        this.stats.executed++;
                        if (!event.recurring) {
                            this.eventMap.delete(event.id);
                        }
                    } else {
                        const newLevel = this._findLevel(remaining);
                        this.wheels[newLevel].add(event, remaining);
                        this.stats.cascaded++;
                    }
                }
            }
        }
    }
    
    /**
     * Find the appropriate wheel level for a delay
     */
    _findLevel(delayTicks) {
        for (let i = 0; i < this.wheels.length; i++) {
            const wheelCapacity = this.wheels[i].slots * this.wheels[i].resolution;
            if (delayTicks < wheelCapacity) return i;
        }
        return this.wheels.length - 1;
    }
    
    /**
     * Get pending event count
     */
    getPendingCount() {
        return this.eventMap.size;
    }
    
    /**
     * Get stats
     */
    getStats() {
        return { ...this.stats, pending: this.eventMap.size };
    }
}

// ============================================================================
// WORLD TIME SYSTEM
// ============================================================================

/**
 * WorldTimeSystem - Main time tracking system
 * 
 * Features:
 * - 64-bit tick precision
 * - Configurable timescale
 * - Event scheduling via timing wheel
 * - Offline progression
 * - Network sync support
 */
export class WorldTimeSystem {
    constructor() {
        // Core time state (all derived from totalTicks)
        this._totalTicks = 0n;          // Master tick counter (BigInt for precision)
        this._lastRealTime = 0;         // Last real timestamp (ms)
        this._accumulator = 0;          // Sub-tick accumulator (ms)
        
        // Timescale
        this.timescale = TIMESCALE.FAST;  // Default 72:1 like Minecraft
        this.targetTimescale = TIMESCALE.FAST;
        this.timescaleTransitionSpeed = 2.0;
        
        // Pause state
        this.isPaused = false;
        this.pausedAt = 0n;
        
        // Event scheduling
        this.timingWheel = new HierarchicalTimingWheel();
        
        // Network sync
        this.serverTimeOffset = 0;      // Offset from server time (ms)
        this.clockSlew = 1.0;           // Clock speed adjustment (0.99-1.01)
        this.lastSyncTime = 0;
        this._networkEpochAnchor = Date.now() - performance.now();
        
        // Offline progression
        this.lastSaveTime = 0n;
        this.offlineCallbacks = [];     // Functions to call on offline catch-up
        
        // Stats
        this.stats = {
            ticksProcessed: 0n,
            realTimeElapsed: 0,
            gameTimeElapsed: 0,
            ticksPerSecondActual: 0,
        };
        
        // Performance tracking
        this._tickTimes = [];
        this._lastTickTime = 0;
        
        console.log('[WorldTimeSystem] Created');
    }
    
    /**
     * Initialize the time system
     * @param {Object} options - Configuration
     */
    init(options = {}) {
        this.timescale = options.timescale ?? TIMESCALE.FAST;
        this.targetTimescale = this.timescale;
        this._lastRealTime = performance.now();
        
        // Load saved time if provided
        if (options.savedTicks !== undefined) {
            this._totalTicks = BigInt(options.savedTicks);
        }
        
        // Start at specific time of day
        if (options.startHour !== undefined) {
            const ticksPerHour = TICKS_PER_SECOND * 3600;
            this._totalTicks = BigInt(options.startHour * ticksPerHour);
        }
        
        console.log(`[WorldTimeSystem] Initialized at ${this.getDate().toString()}`);
    }
    
    /**
     * Update the time system - call every frame
     * @param {number} realDeltaMs - Real time elapsed since last update (ms)
     * @returns {number} Number of ticks processed this frame
     */
    update(realDeltaMs) {
        if (this.isPaused) return 0;
        
        const now = performance.now();
        
        // Apply clock slew for network sync
        const adjustedDelta = realDeltaMs * this.clockSlew;
        
        // Smooth timescale transition
        if (this.timescale !== this.targetTimescale) {
            const diff = this.targetTimescale - this.timescale;
            const maxChange = this.timescaleTransitionSpeed * (realDeltaMs / 1000);
            this.timescale += Math.sign(diff) * Math.min(Math.abs(diff), maxChange);
        }
        
        // Convert real time to game time
        const gameTimeMs = adjustedDelta * this.timescale;
        
        // Accumulate for fixed timestep
        this._accumulator += gameTimeMs;
        
        // Process ticks
        let ticksProcessed = 0;
        while (this._accumulator >= TICK_DURATION_MS) {
            this._totalTicks++;
            this._accumulator -= TICK_DURATION_MS;
            ticksProcessed++;
            
            // Process timing wheel
            this.timingWheel.tick();
            
            // Prevent runaway (cap at 10 ticks per frame)
            if (ticksProcessed >= 10) {
                this._accumulator = 0;
                break;
            }
        }
        
        // Update stats
        this.stats.ticksProcessed += BigInt(ticksProcessed);
        this.stats.realTimeElapsed += realDeltaMs / 1000;
        this.stats.gameTimeElapsed += gameTimeMs / 1000;
        
        // Track actual TPS
        this._tickTimes.push({ ticks: ticksProcessed, time: now });
        while (this._tickTimes.length > 0 && 
               now - this._tickTimes[0].time > 1000) {
            this._tickTimes.shift();
        }
        this.stats.ticksPerSecondActual = this._tickTimes.reduce(
            (sum, t) => sum + t.ticks, 0);
        
        this._lastRealTime = now;
        return ticksProcessed;
    }
    
    /**
     * Get current total ticks
     */
    getTicks() {
        return this._totalTicks;
    }
    
    /**
     * Get current game time in seconds (float, for rendering)
     */
    getGameTimeSeconds() {
        const wholeTicks = Number(this._totalTicks);
        const fractionalTick = this._accumulator / TICK_DURATION_MS;
        return (wholeTicks + fractionalTick) / TICKS_PER_SECOND;
    }
    
    /**
     * Get current date/time as GameDate
     */
    getDate() {
        return new GameDate(this._totalTicks);
    }
    
    /**
     * Get normalized time of day (0-1)
     */
    getTimeOfDay() {
        return this.getDate().normalizedTimeOfDay;
    }
    
    /**
     * Schedule an event
     * @param {Function} callback - Function to call
     * @param {number} delaySeconds - Delay in game seconds
     * @param {Object} data - Optional data
     * @returns {number} Event ID
     */
    scheduleEvent(callback, delaySeconds, data = null) {
        const delayTicks = Math.ceil(delaySeconds * TICKS_PER_SECOND);
        return this.timingWheel.schedule(callback, delayTicks, data);
    }
    
    /**
     * Schedule recurring event
     * @param {Function} callback - Function to call
     * @param {number} intervalSeconds - Interval in game seconds
     * @param {Object} data - Optional data
     * @returns {number} Event ID
     */
    scheduleRecurring(callback, intervalSeconds, data = null) {
        const intervalTicks = Math.ceil(intervalSeconds * TICKS_PER_SECOND);
        return this.timingWheel.scheduleRecurring(callback, intervalTicks, data);
    }
    
    /**
     * Cancel scheduled event
     * @param {number} eventId - Event ID
     */
    cancelEvent(eventId) {
        return this.timingWheel.cancel(eventId);
    }
    
    /**
     * Set timescale
     * @param {number} scale - New timescale ratio
     * @param {boolean} instant - Apply instantly vs smooth transition
     */
    setTimescale(scale, instant = false) {
        this.targetTimescale = Math.max(0, Math.min(1000, scale));
        if (instant) {
            this.timescale = this.targetTimescale;
        }
    }
    
    /**
     * Pause time
     */
    pause() {
        if (!this.isPaused) {
            this.isPaused = true;
            this.pausedAt = this._totalTicks;
        }
    }
    
    /**
     * Resume time
     */
    resume() {
        this.isPaused = false;
    }
    
    /**
     * Toggle pause
     */
    togglePause() {
        if (this.isPaused) this.resume();
        else this.pause();
        return this.isPaused;
    }
    
    // ========================================================================
    // OFFLINE PROGRESSION
    // ========================================================================
    
    /**
     * Register callback for offline progression
     * @param {Function} callback - (missedTicks, missedSeconds) => void
     */
    registerOfflineCallback(callback) {
        this.offlineCallbacks.push(callback);
    }
    
    /**
     * Process offline time (call on load)
     * @param {BigInt} savedTicks - Ticks when game was saved
     * @param {number} realTimePassed - Real seconds since save
     */
    processOfflineTime(savedTicks, realTimePassed) {
        const savedTicksBigInt = BigInt(savedTicks);
        
        // Calculate expected game ticks based on real time and timescale
        const expectedGameSeconds = realTimePassed * this.timescale;
        const expectedTicks = BigInt(Math.floor(expectedGameSeconds * TICKS_PER_SECOND));
        
        // Cap offline progression (max 7 days game time)
        const maxOfflineTicks = 7n * TICKS_PER_DAY;
        const actualMissedTicks = expectedTicks < maxOfflineTicks ? 
            expectedTicks : maxOfflineTicks;
        
        // Update total ticks
        this._totalTicks = savedTicksBigInt + actualMissedTicks;
        
        // Calculate missed time
        const missedSeconds = Number(actualMissedTicks) / TICKS_PER_SECOND;
        
        console.log(`[WorldTimeSystem] Offline progression: ${missedSeconds.toFixed(0)}s game time`);
        
        // Call offline callbacks
        for (const callback of this.offlineCallbacks) {
            try {
                callback(Number(actualMissedTicks), missedSeconds);
            } catch (err) {
                console.error('[WorldTimeSystem] Offline callback error:', err);
            }
        }
        
        return { missedTicks: actualMissedTicks, missedSeconds };
    }
    
    /**
     * Save current state
     */
    save() {
        this.lastSaveTime = this._totalTicks;
        return {
            totalTicks: this._totalTicks.toString(),
            timescale: this.timescale,
            savedAt: Date.now(),
        };
    }
    
    /**
     * Load saved state
     * @param {Object} data - Saved data
     * @param {boolean} processOffline - Process offline time
     */
    load(data, processOffline = true) {
        const savedTicks = BigInt(data.totalTicks || '0');
        this.timescale = data.timescale || TIMESCALE.FAST;
        this.targetTimescale = this.timescale;
        
        if (processOffline && data.savedAt) {
            const realTimePassed = (Date.now() - data.savedAt) / 1000;
            this.processOfflineTime(savedTicks, realTimePassed);
        } else {
            this._totalTicks = savedTicks;
        }
    }
    
    // ========================================================================
    // NETWORK SYNCHRONIZATION
    // ========================================================================
    
    /**
     * Synchronize with server time
     * @param {number} serverTime - Server's current time (ms)
     * @param {number} rtt - Round-trip time (ms)
     */
    syncWithServer(serverTime, rtt) {
        if (!Number.isFinite(serverTime)) throw new TypeError('serverTime must be Unix epoch milliseconds');
        const localTime = this._networkEpochAnchor + performance.now();
        const oneWayLatency = Number.isFinite(rtt) && rtt >= 0
            ? oneWayLatencyEstimateMs({ rttMs: rtt })
            : 0;
        
        // Estimate server's current time
        const estimatedServerTime = serverTime + oneWayLatency;
        
        // Calculate offset
        const offset = estimatedServerTime - localTime;
        
        // Smooth the offset (don't jump)
        const alpha = 0.1;  // Smoothing factor
        this.serverTimeOffset = this.serverTimeOffset * (1 - alpha) + offset * alpha;
        
        // Adjust clock slew to converge
        const drift = this.serverTimeOffset - offset;
        if (Math.abs(drift) > 100) {
            // Large drift - speed up or slow down clock
            this.clockSlew = drift > 0 ? 0.99 : 1.01;
        } else if (Math.abs(drift) > 10) {
            this.clockSlew = drift > 0 ? 0.995 : 1.005;
        } else {
            this.clockSlew = 1.0;
        }
        
        this.lastSyncTime = localTime;
    }
    
    /**
     * Get synchronized time for network messages
     */
    getNetworkTime() {
        return this._networkEpochAnchor + performance.now() + this.serverTimeOffset;
    }
    
    // ========================================================================
    // UTILITY
    // ========================================================================
    
    /**
     * Convert game seconds to ticks
     */
    secondsToTicks(seconds) {
        return Math.ceil(seconds * TICKS_PER_SECOND);
    }
    
    /**
     * Convert ticks to game seconds
     */
    ticksToSeconds(ticks) {
        return Number(ticks) / TICKS_PER_SECOND;
    }
    
    /**
     * Get ticks until a specific time of day
     * @param {number} targetHour - Target hour (0-23)
     */
    getTicksUntilHour(targetHour) {
        const current = this.getDate();
        const currentHour = current.hour + current.minute / 60;
        
        let hoursUntil = targetHour - currentHour;
        if (hoursUntil < 0) hoursUntil += 24;
        
        return Math.ceil(hoursUntil * 3600 * TICKS_PER_SECOND);
    }
    
    /**
     * Skip to a specific time
     * @param {number} hour - Target hour (0-23)
     */
    skipToHour(hour) {
        const ticksToSkip = this.getTicksUntilHour(hour);
        this._totalTicks += BigInt(ticksToSkip);
        
        // Process any events that would have fired
        for (let i = 0; i < ticksToSkip; i++) {
            this.timingWheel.tick();
        }
    }
    
    /**
     * Get current state for debugging/UI
     */
    getState() {
        const date = this.getDate();
        return {
            totalTicks: this._totalTicks.toString(),
            gameTimeSeconds: this.getGameTimeSeconds(),
            date: date.toString(),
            timeOfDay: date.normalizedTimeOfDay,
            hour: date.hour,
            minute: date.minute,
            day: date.day,
            month: date.month,
            year: date.year,
            season: date.seasonName,
            moonPhase: date.moonPhaseName,
            moonIllumination: date.moonIllumination,
            isDaytime: date.isDaytime,
            timescale: this.timescale,
            isPaused: this.isPaused,
            tps: this.stats.ticksPerSecondActual,
            pendingEvents: this.timingWheel.getPendingCount(),
        };
    }
    
    /**
     * Load configuration
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        if (cfg.timescale) {
            const scale = parseFloat(cfg.timescale);
            if (!isNaN(scale)) this.setTimescale(scale, true);
        }
        
        if (cfg.start_hour !== undefined) {
            const hour = parseInt(cfg.start_hour);
            if (!isNaN(hour)) {
                const ticksPerHour = TICKS_PER_SECOND * 3600;
                this._totalTicks = BigInt(hour * ticksPerHour);
            }
        }
    }
}

export default WorldTimeSystem;
