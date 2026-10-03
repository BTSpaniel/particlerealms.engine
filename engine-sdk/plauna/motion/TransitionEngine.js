// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TransitionEngine - Property animation system for Plauna
 * Provides smooth transitions and animations for UI properties
 */

import { DIRTY } from '../core/UINode.js';
import { runtimeFrameDeltaSeconds } from '../../engine/core/math/FrameMath.js';
import { clamp } from '../../engine/core/math/MathScalar.js';
import {
    easeLinear,
    easeInQuad,
    easeOutQuad,
    easeInOutQuad,
    easeInCubic,
    easeOutCubic,
    easeInOutCubic
} from '../../engine/core/math/MathEasing.js';

export class TransitionEngine {
    constructor() {
        this.animations = new Map(); // node.id -> Set of animations
        this.runningAnimations = new Set();
        this.isRunning = false;
        this.lastFrameTime = 0;
        
        // Performance tracking
        this.totalAnimations = 0;
        this.totalFrames = 0;
        this.totalTime = 0;
        this.averageFrameTime = 0;
        
        // Animation frame callback
        this._tick = this._tick.bind(this);
    }

    // Create property transition
    transition(node, properties, duration = 300, easing = 'ease', delay = 0) {
        const animation = {
            node,
            type: 'transition',
            properties: {},
            duration,
            easing,
            delay,
            startTime: null,
            endTime: null,
            currentTime: 0,
            startValues: {},
            targetValues: {},
            completed: false,
            onUpdate: null,
            onComplete: null
        };
        
        // Process properties
        for (const [property, value] of Object.entries(properties)) {
            const currentValue = this.getPropertyValue(node, property);
            
            animation.properties[property] = {
                start: currentValue,
                target: value,
                current: currentValue,
                delta: this.calculateDelta(currentValue, value)
            };
            
            animation.startValues[property] = currentValue;
            animation.targetValues[property] = value;
        }
        
        // Calculate end time
        animation.endTime = performance.now() + delay + duration;
        
        // Add to animations
        this.addAnimation(node, animation);
        
        return animation;
    }

    // Create keyframe animation
    animate(node, keyframes, duration = 1000, easing = 'ease', iterations = 1) {
        const animation = {
            node,
            type: 'keyframe',
            keyframes: [...keyframes],
            duration,
            easing,
            iterations,
            currentIteration: 0,
            startTime: null,
            endTime: null,
            currentTime: 0,
            completed: false,
            onUpdate: null,
            onComplete: null
        };
        
        // Calculate end time
        animation.endTime = performance.now() + (duration * iterations);
        
        // Add to animations
        this.addAnimation(node, animation);
        
        return animation;
    }

    // Add animation to node
    addAnimation(node, animation) {
        if (!this.animations.has(node.id)) {
            this.animations.set(node.id, new Set());
        }
        
        this.animations.get(node.id).add(animation);
        this.runningAnimations.add(animation);
        this.totalAnimations++;
        
        // Start animation loop if not running
        if (!this.isRunning) {
            this.startAnimationLoop();
        }
    }

    // Start animation loop
    startAnimationLoop() {
        this.isRunning = true;
        this.lastFrameTime = performance.now();
        requestAnimationFrame(this._tick);
    }

    // Animation loop
    _tick(timestamp) {
        if (!this.isRunning) return;
        
        const frameStartTime = performance.now();
        const deltaTimeMs = runtimeFrameDeltaSeconds(timestamp, this.lastFrameTime, Infinity) * 1000;
        const frameTimestamp = this.lastFrameTime + deltaTimeMs;
        this.lastFrameTime = frameTimestamp;
        
        try {
            // Update all running animations
            const completedAnimations = [];
            
            for (const animation of this.runningAnimations) {
                if (this.updateAnimation(animation, frameTimestamp)) {
                    completedAnimations.push(animation);
                }
            }
            
            // Remove completed animations
            for (const animation of completedAnimations) {
                this.completeAnimation(animation);
            }
            
            // Update performance stats
            const frameEndTime = performance.now();
            const frameTime = frameEndTime - frameStartTime;
            this.updatePerformanceStats(frameTime);
            
            // Continue animation loop
            if (this.runningAnimations.size > 0) {
                requestAnimationFrame(this._tick);
            } else {
                this.isRunning = false;
            }
            
        } catch (error) {
            console.error('Error in animation loop:', error);
            this.isRunning = false;
        }
    }

    // Update single animation
    updateAnimation(animation, timestamp) {
        if (animation.completed) return true;
        
        // Check if animation should start
        if (!animation.startTime) {
            if (timestamp >= animation.endTime - animation.duration) {
                animation.startTime = animation.endTime - animation.duration;
            } else {
                return false; // Not started yet
            }
        }
        
        // Calculate progress
        const normalizedElapsed = runtimeFrameDeltaSeconds(timestamp, animation.startTime, Infinity) * 1000;
        const elapsed = clamp(normalizedElapsed, animation.currentTime ?? 0, Infinity);
        animation.currentTime = elapsed;
        const progress = clamp(elapsed / animation.duration, 0, 1);
        const easedProgress = this.applyEasing(progress, animation.easing);
        
        if (animation.type === 'transition') {
            return this.updateTransition(animation, easedProgress);
        } else if (animation.type === 'keyframe') {
            return this.updateKeyframe(animation, easedProgress, elapsed);
        }
        
        return false;
    }

    // Update transition animation
    updateTransition(animation, progress) {
        let hasChanges = false;
        
        for (const [property, prop] of Object.entries(animation.properties)) {
            const oldValue = prop.current;
            const newValue = this.interpolateValue(prop.start, prop.target, prop.delta, progress);
            
            if (oldValue !== newValue) {
                prop.current = newValue;
                this.setPropertyValue(animation.node, property, newValue);
                hasChanges = true;
            }
        }
        
        if (hasChanges) {
            animation.node.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
        
        // Call update callback
        if (animation.onUpdate) {
            animation.onUpdate(progress);
        }
        
        // Check if completed
        if (progress >= 1) {
            animation.completed = true;
            
            // Ensure final values are set
            for (const [property, prop] of Object.entries(animation.properties)) {
                this.setPropertyValue(animation.node, property, prop.target);
            }
            
            animation.node.markDirty(DIRTY.STYLE | DIRTY.PAINT);
            
            return true;
        }
        
        return false;
    }

    // Update keyframe animation
    updateKeyframe(animation, progress, elapsed) {
        const totalDuration = animation.duration * animation.iterations;
        const iterationDuration = animation.duration;
        
        // Calculate current iteration
        animation.currentIteration = Math.floor(elapsed / iterationDuration);
        
        // Check if all iterations completed
        if (elapsed >= totalDuration) {
            animation.completed = true;
            
            // Apply final keyframe
            const finalKeyframe = animation.keyframes[animation.keyframes.length - 1];
            this.applyKeyframe(animation.node, finalKeyframe);
            
            return true;
        }
        
        // Calculate current keyframe progress
        const iterationProgress = (elapsed % iterationDuration) / iterationDuration;
        const keyframeIndex = Math.floor(iterationProgress * (animation.keyframes.length - 1));
        const keyframeProgress = (iterationProgress * (animation.keyframes.length - 1)) % 1;
        
        // Get current and next keyframes
        const currentKeyframe = animation.keyframes[keyframeIndex];
        const nextKeyframe = animation.keyframes[Math.min(keyframeIndex + 1, animation.keyframes.length - 1)];
        
        // Interpolate between keyframes
        this.interpolateKeyframes(animation.node, currentKeyframe, nextKeyframe, keyframeProgress);
        
        // Call update callback
        if (animation.onUpdate) {
            animation.onUpdate(iterationProgress);
        }
        
        return false;
    }

    // Apply keyframe to node
    applyKeyframe(node, keyframe) {
        for (const [property, value] of Object.entries(keyframe)) {
            this.setPropertyValue(node, property, value);
        }
        node.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Interpolate between keyframes
    interpolateKeyframes(node, keyframe1, keyframe2, progress) {
        const easedProgress = this.applyEasing(progress, 'ease');
        
        for (const [property, value1] of Object.entries(keyframe1)) {
            const value2 = keyframe2[property];
            
            if (value2 !== undefined) {
                const delta = this.calculateDelta(value1, value2);
                const interpolatedValue = this.interpolateValue(value1, value2, delta, easedProgress);
                this.setPropertyValue(node, property, interpolatedValue);
            }
        }
        
        node.markDirty(DIRTY.STYLE | DIRTY.PAINT);
    }

    // Get property value from node
    getPropertyValue(node, property) {
        const value = node.getStyle(property);
        return value !== undefined ? value : 0;
    }

    // Set property value on node
    setPropertyValue(node, property, value) {
        node.setStyle(property, value);
    }

    // Calculate delta between values
    calculateDelta(start, target) {
        if (typeof start === 'number' && typeof target === 'number') {
            return target - start;
        }
        
        // For colors and other complex values, return target for now
        // In a full implementation, we'd parse and interpolate colors, transforms, etc.
        return target;
    }

    // Interpolate value
    interpolateValue(start, target, delta, progress) {
        if (typeof start === 'number' && typeof target === 'number') {
            return start + (delta * progress);
        }
        
        // For complex values, return target for now
        // In a full implementation, we'd interpolate colors, transforms, etc.
        return progress >= 0.5 ? target : start;
    }

    // Apply easing function
    applyEasing(progress, easing) {
        switch (easing) {
            case 'linear':
                return easeLinear(progress);
                
            case 'ease':
                return easeInOutQuad(progress);
                
            case 'ease-in':
                return easeInQuad(progress);
                
            case 'ease-out':
                return easeOutQuad(progress);
                
            case 'ease-in-out':
                return easeInOutQuad(progress);
                
            case 'ease-in-cubic':
                return easeInCubic(progress);
                
            case 'ease-out-cubic':
                return easeOutCubic(progress);
                
            case 'ease-in-out-cubic':
                return easeInOutCubic(progress);
                
            default:
                return progress;
        }
    }

    easeInQuad(t) {
        return easeInQuad(t);
    }

    easeOutQuad(t) {
        return easeOutQuad(t);
    }

    easeInOutQuad(t) {
        return easeInOutQuad(t);
    }

    easeInCubic(t) {
        return easeInCubic(t);
    }

    easeOutCubic(t) {
        return easeOutCubic(t);
    }

    easeInOutCubic(t) {
        return easeInOutCubic(t);
    }

    // Complete animation
    completeAnimation(animation) {
        animation.completed = true;
        this.runningAnimations.delete(animation);
        
        // Remove from node animations
        const nodeAnimations = this.animations.get(animation.node.id);
        if (nodeAnimations) {
            nodeAnimations.delete(animation);
            
            if (nodeAnimations.size === 0) {
                this.animations.delete(animation.node.id);
            }
        }
        
        // Call completion callback
        if (animation.onComplete) {
            animation.onComplete();
        }
    }

    // Stop animation
    stopAnimation(animation) {
        if (this.runningAnimations.has(animation)) {
            this.runningAnimations.delete(animation);
            animation.completed = true;
            
            // Remove from node animations
            const nodeAnimations = this.animations.get(animation.node.id);
            if (nodeAnimations) {
                nodeAnimations.delete(animation);
                
                if (nodeAnimations.size === 0) {
                    this.animations.delete(animation.node.id);
                }
            }
        }
    }

    // Stop all animations for a node
    stopAnimations(node) {
        const nodeAnimations = this.animations.get(node.id);
        if (nodeAnimations) {
            for (const animation of nodeAnimations) {
                this.stopAnimation(animation);
            }
        }
    }

    // Check if node has running animations
    hasAnimations(node) {
        const nodeAnimations = this.animations.get(node.id);
        return nodeAnimations && nodeAnimations.size > 0;
    }

    // Get animations for a node
    getAnimations(node) {
        return this.animations.get(node.id) || new Set();
    }

    // Get performance stats
    getPerformanceStats() {
        return {
            totalAnimations: this.totalAnimations,
            runningAnimations: this.runningAnimations.size,
            totalFrames: this.totalFrames,
            totalTime: this.totalTime,
            averageFrameTime: this.averageFrameTime,
            frameRate: this.averageFrameTime > 0 ? 1000 / this.averageFrameTime : 0
        };
    }

    // Update performance stats
    updatePerformanceStats(frameTime) {
        this.totalFrames++;
        this.totalTime += frameTime;
        this.averageFrameTime = this.totalTime / this.totalFrames;
    }

    // Reset performance stats
    resetPerformanceStats() {
        this.totalAnimations = this.runningAnimations.size;
        this.totalFrames = 0;
        this.totalTime = 0;
        this.averageFrameTime = 0;
    }

    // Clear all animations
    clearAllAnimations() {
        for (const animation of this.runningAnimations) {
            animation.completed = true;
        }
        
        this.animations.clear();
        this.runningAnimations.clear();
        this.isRunning = false;
    }

    // Destroy
    destroy() {
        this.clearAllAnimations();
    }
}

// Transition utility functions
export const TransitionUtils = {
    // Create simple transition
    transition(node, properties, duration = 300, easing = 'ease') {
        const engine = new TransitionEngine();
        return engine.transition(node, properties, duration, easing);
    },
    
    // Create fade in transition
    fadeIn(node, duration = 300) {
        const engine = new TransitionEngine();
        node.setStyle('opacity', 0);
        return engine.transition(node, { opacity: 1 }, duration, 'ease-out');
    },
    
    // Create fade out transition
    fadeOut(node, duration = 300) {
        const engine = new TransitionEngine();
        return engine.transition(node, { opacity: 0 }, duration, 'ease-in');
    },
    
    // Create slide in transition
    slideIn(node, direction = 'left', duration = 300) {
        const engine = new TransitionEngine();
        const transforms = {
            left: { translateX: -100 },
            right: { translateX: 100 },
            up: { translateY: -100 },
            down: { translateY: 100 }
        };
        
        node.setStyle('transform', `translate(${transforms[direction].translateX}px, ${transforms[direction].translateY}px)`);
        return engine.transition(node, { transform: 'translate(0, 0)' }, duration, 'ease-out');
    },
    
    // Create slide out transition
    slideOut(node, direction = 'left', duration = 300) {
        const engine = new TransitionEngine();
        const transforms = {
            left: { translateX: -100 },
            right: { translateX: 100 },
            up: { translateY: -100 },
            down: { translateY: 100 }
        };
        
        return engine.transition(node, { 
            transform: `translate(${transforms[direction].translateX}px, ${transforms[direction].translateY}px)` 
        }, duration, 'ease-in');
    },
    
    // Create scale transition
    scale(node, fromScale = 0, toScale = 1, duration = 300) {
        const engine = new TransitionEngine();
        node.setStyle('transform', `scale(${fromScale})`);
        return engine.transition(node, { transform: `scale(${toScale})` }, duration, 'ease-out');
    },
    
    // Create rotate transition
    rotate(node, fromAngle = 0, toAngle = 360, duration = 300) {
        const engine = new TransitionEngine();
        node.setStyle('transform', `rotate(${fromAngle}deg)`);
        return engine.transition(node, { transform: `rotate(${toAngle}deg)` }, duration, 'ease-in-out');
    },
    
    // Create bounce transition
    bounce(node, duration = 600) {
        const engine = new TransitionEngine();
        return engine.transition(node, { transform: 'translateY(0)' }, duration, 'ease-out');
    },
    
    // Stop all transitions for node
    stop(node) {
        const engine = new TransitionEngine();
        engine.stopAnimations(node);
    },
    
    // Check if node is animating
    isAnimating(node) {
        const engine = new TransitionEngine();
        return engine.hasAnimations(node);
    }
};
