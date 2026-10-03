// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProfilerCanvasWorker.js - OffscreenCanvas worker for profiler rendering
 * 
 * Moves ALL canvas rendering off the main thread:
 * - Timeline graph
 * - Thread lanes
 * - Flame graph bars
 * 
 * Main thread only sends frame data, worker handles all drawing.
 */

let timelineCanvas = null;
let timelineCtx = null;
let laneCanvases = {};
let frameHistory = [];
let laneHistory = { main: [], gpu: [], render: [], compute: [] };
let currentDpr = 1;
let cssWidth = 500;
let cssHeight = 80;
let targetMs = 16.67; // Dynamic based on monitor refresh rate
const MAX_HISTORY = 180;

// Colors (flat - no gradients for perf)
const COLORS = {
    bg: '#1a1a1a',
    target: '#444',
    scripting: '#F9A825',
    rendering: '#E53935',
    painting: '#7B1FA2',
    idle: '#455A64',
    warning: '#FF5722',
    critical: '#F44336',
    main: '#F9A825',
    gpu: '#2196F3',
    render: '#7B1FA2',
    compute: '#4CAF50'
};

/**
 * Initialize canvases
 */
function initCanvases(data) {
    const { timeline, lanes } = data;
    
    if (timeline) {
        timelineCanvas = timeline;
        timelineCtx = timeline.getContext('2d', { alpha: false });
        
        // Get initial dimensions from transferred canvas
        if (timeline.width > 0 && timeline.height > 0) {
            cssWidth = timeline.width;
            cssHeight = timeline.height;
        }
    }
    
    if (lanes) {
        for (const [name, canvas] of Object.entries(lanes)) {
            laneCanvases[name] = {
                canvas,
                ctx: canvas.getContext('2d', { alpha: false }),
                width: canvas.width,
                height: canvas.height
            };
        }
    }
    
    console.log('[ProfilerWorker] Canvases initialized, size:', cssWidth, 'x', cssHeight);
}

/**
 * Compress old frame data instead of deleting
 * Uses tiered compression based on age
 */
function compressOldFrames() {
    const COMPRESS_AFTER = 60;   // Compress frames older than 60
    const ARCHIVE_AFTER = 120;   // Archive frames older than 120
    
    for (let i = 0; i < frameHistory.length; i++) {
        const frame = frameHistory[i];
        const age = frameHistory.length - i;
        
        if (age < COMPRESS_AFTER) continue;
        if (frame._compressed) continue;
        
        const tier = age >= ARCHIVE_AFTER ? 2 : 1;
        
        // Compress frame by reducing precision
        if (tier >= 2) {
            // Archive tier: only keep essential data
            frameHistory[i] = {
                total: Math.round(frame.total * 10) / 10,
                cpu: Math.round((frame.cpu || 0) * 10) / 10,
                gpu: Math.round((frame.gpu || 0) * 10) / 10,
                _compressed: true,
                _tier: tier
            };
        } else {
            // Lossless tier: reduce precision but keep all data
            frameHistory[i] = {
                ...frame,
                total: Math.round(frame.total * 100) / 100,
                cpu: frame.cpu ? Math.round(frame.cpu * 100) / 100 : undefined,
                gpu: frame.gpu ? Math.round(frame.gpu * 100) / 100 : undefined,
                _compressed: true,
                _tier: tier
            };
        }
    }
}

/**
 * Add frame data and render
 */
function addFrameAndRender(data) {
    const { frame, lanes: laneData } = data;
    
    // Add to history - no deletion, compress old frames instead
    frameHistory.push(frame);
    if (frameHistory.length > MAX_HISTORY) {
        // Compress old frames instead of deleting
        compressOldFrames();
        // Only trim if compression isn't enough (extreme case)
        if (frameHistory.length > MAX_HISTORY * 2) {
            frameHistory.shift();
        }
    }
    
    // Add lane data - compress old lanes instead of deleting
    if (laneData) {
        for (const [lane, entry] of Object.entries(laneData)) {
            if (!laneHistory[lane]) laneHistory[lane] = [];
            laneHistory[lane].push(entry);
            if (laneHistory[lane].length > MAX_HISTORY) {
                // Compress old lane data
                for (let i = 0; i < laneHistory[lane].length - MAX_HISTORY; i++) {
                    const old = laneHistory[lane][i];
                    if (!old._compressed) {
                        laneHistory[lane][i] = {
                            time: Math.round(old.time * 10) / 10,
                            _compressed: true
                        };
                    }
                }
                // Only trim in extreme case
                if (laneHistory[lane].length > MAX_HISTORY * 2) {
                    laneHistory[lane].shift();
                }
            }
        }
    }
    
    // Render timeline using stored CSS dimensions (DPR scaling applied via context transform)
    if (timelineCtx && timelineCanvas && cssWidth > 0 && cssHeight > 0) {
        renderTimeline(cssWidth, cssHeight);
    }
    
    // Render lanes
    if (timelineCanvas) {
        renderLanes(cssWidth);
    }
}

/**
 * Render timeline graph - optimized for performance
 */
function renderTimeline(w, h) {
    const ctx = timelineCtx;
    const history = frameHistory;
    
    // Clear with single fillRect (faster than clearRect)
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    
    if (history.length < 2) return;
    
    // Use dynamic target from monitor refresh rate
    const maxMs = targetMs * 2;
    
    // Draw target line
    const targetY = Math.floor(h - (targetMs / maxMs) * h) | 0;
    ctx.strokeStyle = COLORS.target;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(w, targetY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Calculate bar dimensions
    const barWidth = w / history.length;
    const actualBarWidth = Math.max(1, barWidth);
    
    // Batch similar operations - draw all segments of same color together
    // This reduces context state changes significantly
    
    // Pass 1: Scripting (orange)
    ctx.fillStyle = COLORS.scripting;
    for (let i = 0; i < history.length; i++) {
        const frame = history[i];
        const scripting = frame.scripting || 0;
        if (scripting <= 0) continue;
        
        const x = (i * barWidth) | 0;
        const segHeight = Math.max(1, ((scripting / maxMs) * h) | 0);
        const y = h - segHeight;
        ctx.fillRect(x, y, actualBarWidth, segHeight);
    }
    
    // Pass 2: Rendering (red)
    ctx.fillStyle = COLORS.rendering;
    for (let i = 0; i < history.length; i++) {
        const frame = history[i];
        const rendering = frame.rendering || 0;
        if (rendering <= 0) continue;
        
        const x = (i * barWidth) | 0;
        const scriptingHeight = ((frame.scripting || 0) / maxMs) * h;
        const segHeight = Math.max(1, ((rendering / maxMs) * h) | 0);
        const y = h - scriptingHeight - segHeight;
        ctx.fillRect(x, y | 0, actualBarWidth, segHeight);
    }
    
    // Pass 3: Painting (purple)
    ctx.fillStyle = COLORS.painting;
    for (let i = 0; i < history.length; i++) {
        const frame = history[i];
        const painting = frame.painting || 0;
        if (painting <= 0) continue;
        
        const x = (i * barWidth) | 0;
        const prevHeight = ((frame.scripting || 0) + (frame.rendering || 0)) / maxMs * h;
        const segHeight = Math.max(1, ((painting / maxMs) * h) | 0);
        const y = h - prevHeight - segHeight;
        ctx.fillRect(x, y | 0, actualBarWidth, segHeight);
    }
    
    // Pass 4: Remaining/idle time - batch by color
    for (let i = 0; i < history.length; i++) {
        const frame = history[i];
        const accounted = (frame.scripting || 0) + (frame.rendering || 0) + (frame.painting || 0);
        const remaining = frame.frameTime - accounted;
        if (remaining <= 0) continue;
        
        const x = (i * barWidth) | 0;
        const prevHeight = (accounted / maxMs) * h;
        const segHeight = Math.max(1, ((remaining / maxMs) * h) | 0);
        const y = h - prevHeight - segHeight;
        
        // Color based on total frame time vs dynamic target
        if (frame.frameTime <= targetMs) {
            ctx.fillStyle = COLORS.idle;
        } else if (frame.frameTime <= targetMs * 2) {
            ctx.fillStyle = COLORS.warning;
        } else {
            ctx.fillStyle = COLORS.critical;
        }
        ctx.fillRect(x, y | 0, actualBarWidth, segHeight);
    }
}

/**
 * Render thread lanes
 */
function renderLanes(mainWidth) {
    const maxMs = targetMs; // Use dynamic target from monitor
    
    for (const [lane, { ctx, width, height }] of Object.entries(laneCanvases)) {
        if (!ctx) continue;
        
        const history = laneHistory[lane];
        if (!history || history.length < 1) continue;
        
        // Clear
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, width, height);
        
        const scale = width / mainWidth;
        const barWidth = mainWidth / history.length;
        const actualBarWidth = Math.max(1, barWidth * scale);
        
        ctx.fillStyle = COLORS[lane] || '#888';
        
        for (let i = 0; i < history.length; i++) {
            const frame = history[i];
            if (!frame.active && frame.time < 0.5) continue;
            
            const x = (i * barWidth * scale) | 0;
            const intensity = Math.min(frame.time / maxMs, 1);
            
            ctx.globalAlpha = 0.3 + intensity * 0.7;
            ctx.fillRect(x, 2, actualBarWidth, height - 4);
        }
        ctx.globalAlpha = 1;
    }
}

/**
 * Clear all history
 */
function clearHistory() {
    frameHistory = [];
    laneHistory = { main: [], gpu: [], render: [], compute: [] };
    
    // Clear canvases
    if (timelineCtx && timelineCanvas) {
        timelineCtx.fillStyle = COLORS.bg;
        timelineCtx.fillRect(0, 0, timelineCanvas.width, timelineCanvas.height);
    }
    
    for (const { ctx, canvas } of Object.values(laneCanvases)) {
        if (ctx && canvas) {
            ctx.fillStyle = COLORS.bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }
}

/**
 * Resize canvases
 */
function resize(data) {
    const { width, height, dpr = 1, targetMs: newTargetMs } = data;
    
    // Store DPR, CSS dimensions, and target frame time
    currentDpr = dpr;
    cssWidth = width / dpr;
    cssHeight = height / dpr;
    if (newTargetMs) targetMs = newTargetMs;
    
    if (timelineCanvas && width && height) {
        timelineCanvas.width = width;
        timelineCanvas.height = height;
        
        // Re-acquire context after resize and apply DPR scaling
        if (timelineCtx) {
            timelineCtx.setTransform(1, 0, 0, 1, 0, 0);
            timelineCtx.scale(dpr, dpr);
        }
        
        // Immediately re-render after resize using CSS dimensions
        renderTimeline(cssWidth, cssHeight);
    }
    
    for (const lane of Object.values(laneCanvases)) {
        if (lane.canvas) {
            lane.width = lane.canvas.width;
            lane.height = lane.canvas.height;
        }
    }
}

// Message handler
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'init':
            initCanvases(data);
            break;
        case 'frame':
            addFrameAndRender(data);
            break;
        case 'clear':
            clearHistory();
            break;
        case 'resize':
            resize(data);
            break;
    }
};

console.log('[ProfilerCanvasWorker] Ready');
