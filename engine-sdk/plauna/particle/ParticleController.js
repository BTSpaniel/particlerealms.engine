// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../engine/core/math/MathRandom.js';

/**
 * ParticleController - Manages particle effects and animations
 * Handles particle system initialization and control for showcase
 */

export class ParticleController {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement ? canvasElement.getContext('2d') : null;
    this.particles = [];
    this.isRunning = false;
    this.animationFrameId = null;
    this.particleCount = 240;
    this.config = {
      speed: 0.5,
      opacity: 0.6,
      size: 2,
      color: 'rgba(56, 189, 248, 0.5)',
      spawnRate: 2
    };
  }

  /**
   * Initialize particle system
   */
  initialize() {
    if (!this.canvas || !this.ctx) {
      console.warn('ParticleController: Canvas element not available');
      return;
    }

    this.resizeCanvas();
    this.createParticles();
    this.setupEventListeners();
  }

  /**
   * Resize canvas to fit window
   */
  resizeCanvas() {
    if (!this.canvas) return;
    
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  /**
   * Create particles
   */
  createParticles() {
    this.particles = [];
    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push(this.createParticle());
    }
  }

  /**
   * Create a single particle
   * @private
   */
  createParticle() {
    return {
      x: uniformDistribution(0, this.canvas.width, Math.random),
      y: uniformDistribution(0, this.canvas.height, Math.random),
      vx: uniformDistribution(-0.5, 0.5, Math.random) * this.config.speed,
      vy: uniformDistribution(-0.5, 0.5, Math.random) * this.config.speed,
      life: uniformDistribution(50, 150, Math.random),
      maxLife: 150,
      size: this.config.size + uniformDistribution(0, 2, Math.random)
    };
  }

  /**
   * Update particles
   * @private
   */
  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Update position
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      // Wrap around edges
      if (p.x < 0) p.x = this.canvas.width;
      if (p.x > this.canvas.width) p.x = 0;
      if (p.y < 0) p.y = this.canvas.height;
      if (p.y > this.canvas.height) p.y = 0;

      // Remove dead particles
      if (p.life <= 0) {
        this.particles[i] = this.createParticle();
      }
    }
  }

  /**
   * Draw particles
   * @private
   */
  drawParticles() {
    if (!this.ctx) return;

    // Clear canvas
    this.ctx.fillStyle = 'rgba(7, 17, 29, 0.1)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw particles
    this.particles.forEach(p => {
      const opacity = (p.life / p.maxLife) * this.config.opacity;
      this.ctx.fillStyle = this.config.color.replace('0.5', opacity.toString());
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  /**
   * Animation loop
   * @private
   */
  animate = () => {
    if (!this.isRunning) return;

    this.updateParticles();
    this.drawParticles();
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  /**
   * Start particle animation
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.animate();
  }

  /**
   * Stop particle animation
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  /**
   * Set particle configuration
   * @param {Object} config - Configuration options
   */
  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set particle count
   * @param {number} count
   */
  setParticleCount(count) {
    this.particleCount = count;
    this.createParticles();
  }

  /**
   * Add particles at position
   * @param {number} x
   * @param {number} y
   * @param {number} count
   */
  addParticlesAt(x, y, count = 10) {
    for (let i = 0; i < count; i++) {
      const p = this.createParticle();
      p.x = x + uniformDistribution(-25, 25, Math.random);
      p.y = y + uniformDistribution(-25, 25, Math.random);
      this.particles.push(p);
    }
  }

  /**
   * Clear all particles
   */
  clear() {
    this.particles = [];
  }

  /**
   * Get particle count
   * @returns {number}
   */
  getParticleCount() {
    return this.particles.length;
  }

  /**
   * Destroy particle controller
   */
  destroy() {
    this.stop();
    this.clear();
    this.canvas = null;
    this.ctx = null;
  }
}
