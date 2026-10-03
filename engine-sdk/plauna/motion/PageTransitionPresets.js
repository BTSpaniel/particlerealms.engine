// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PageTransitionPresets - Shared transition presets and stylesheet generation.
 *
 * This module is the single source of truth for the keyframes and CSS used by
 * both the same-document PageTransition engine and the cross-document
 * PageTransitionManager. Keeping the presets in one place means SPA demos and
 * MPA page navigation can share the same effects and the same default.
 */

import { randomElement } from '../../engine/core/math/MathRandom.js';

export const DEFAULT_PRESET = 'etch';
export const DEFAULT_DURATION = 350;
export const DEFAULT_EASING = 'ease-out';

export const DIRECTION_PRESETS = {
  forward: 'slide-left',
  backward: 'slide-right',
  up: 'slide-up',
  down: 'slide-down',
  reload: 'cross-fade',
};

export function directionToPreset(direction) {
  return DIRECTION_PRESETS[direction] || DEFAULT_PRESET;
}

const base = { opacity: 1, transform: 'none', filter: 'blur(0px)', clipPath: 'inset(0 0 0 0)' };
const out = { opacity: 0 };
const inStart = { opacity: 0 };
const inEnd = { opacity: 1 };

function _objToCss(obj) {
  return Object.entries(obj)
    .filter(([k]) => k !== 'offset')
    .map(([k, v]) => {
      const prop = k === 'easing'
        ? 'animation-timing-function'
        : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      return `${prop}: ${v};`;
    })
    .join(' ');
}

function _framesToCss(frames, name) {
  const len = frames.length - 1;
  const body = frames.map((f, i) => {
    const pct = Math.round(((f.offset ?? (i / len)) * 100));
    const props = _objToCss(f);
    return `  ${pct}% { ${props} }`;
  }).join('\n');
  return `@keyframes ${name} {\n${body}\n}`;
}

function _kf(frames, animationName) {
  return _framesToCss(frames, animationName);
}

function _two(outFrom, outTo, inFrom, inTo) {
  return { out: [outFrom, outTo], in: [inFrom, inTo] };
}

const PRESETS = {
  'none': _two(
    { ...base },
    { ...base },
    { ...base },
    { ...base }
  ),
  'cross-fade': _two(
    { ...base },
    { ...base, ...out },
    { ...base, ...inStart },
    { ...base, ...inEnd }
  ),
  'slide-left': _two(
    { ...base },
    { ...base, ...out, transform: 'translateX(-12vw)' },
    { ...base, ...inStart, transform: 'translateX(12vw)' },
    { ...base, ...inEnd }
  ),
  'slide-right': _two(
    { ...base },
    { ...base, ...out, transform: 'translateX(12vw)' },
    { ...base, ...inStart, transform: 'translateX(-12vw)' },
    { ...base, ...inEnd }
  ),
  'slide-up': _two(
    { ...base },
    { ...base, ...out, transform: 'translateY(-12vh)' },
    { ...base, ...inStart, transform: 'translateY(12vh)' },
    { ...base, ...inEnd }
  ),
  'slide-down': _two(
    { ...base },
    { ...base, ...out, transform: 'translateY(12vh)' },
    { ...base, ...inStart, transform: 'translateY(-12vh)' },
    { ...base, ...inEnd }
  ),
  'scale-up': _two(
    { ...base },
    { ...base, ...out, transform: 'scale(1.08)' },
    { ...base, ...inStart, transform: 'scale(0.92)' },
    { ...base, ...inEnd }
  ),
  'scale-down': _two(
    { ...base },
    { ...base, ...out, transform: 'scale(0.92)' },
    { ...base, ...inStart, transform: 'scale(1.08)' },
    { ...base, ...inEnd }
  ),
  'blur': _two(
    { ...base },
    { ...base, ...out, filter: 'blur(12px)' },
    { ...base, ...inStart, filter: 'blur(12px)' },
    { ...base, ...inEnd }
  ),
  'wipe-left': _two(
    { ...base },
    { ...base, ...out, clipPath: 'inset(0 100% 0 0)' },
    { ...base, ...inStart, clipPath: 'inset(0 0 0 100%)' },
    { ...base, ...inEnd, clipPath: 'inset(0 0 0 0)' }
  ),
  'wipe-right': _two(
    { ...base },
    { ...base, ...out, clipPath: 'inset(0 0 0 100%)' },
    { ...base, ...inStart, clipPath: 'inset(0 100% 0 0)' },
    { ...base, ...inEnd, clipPath: 'inset(0 0 0 0)' }
  ),
  'iris': _two(
    { ...base, clipPath: 'circle(150% at 50% 50%)' },
    { ...base, ...out, clipPath: 'circle(0% at 50% 50%)' },
    { ...base, ...inStart, clipPath: 'circle(0% at 50% 50%)' },
    { ...base, ...inEnd, clipPath: 'circle(150% at 50% 50%)' }
  ),
  'diamond': _two(
    { ...base, clipPath: 'polygon(-50% 50%, 50% -50%, 150% 50%, 50% 150%)' },
    { ...base, ...out, clipPath: 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)' },
    { ...base, ...inStart, clipPath: 'polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)' },
    { ...base, ...inEnd, clipPath: 'polygon(-50% 50%, 50% -50%, 150% 50%, 50% 150%)' }
  ),
  'page-flip': _two(
    { ...base, transformOrigin: 'left center' },
    { ...base, ...out, transform: 'perspective(1000px) rotateY(90deg)', transformOrigin: 'left center' },
    { ...base, ...inStart, transform: 'perspective(1000px) rotateY(-90deg)', transformOrigin: 'right center' },
    { ...base, ...inEnd, transformOrigin: 'right center' }
  ),
  'zoom-blur': _two(
    { ...base },
    { ...base, ...out, transform: 'scale(1.15)', filter: 'blur(12px)' },
    { ...base, ...inStart, transform: 'scale(1.15)', filter: 'blur(12px)' },
    { ...base, ...inEnd }
  ),
  'glitch': _two(
    { ...base },
    { ...base, ...out, transform: 'translateX(5px) scale(1.02)', filter: 'drop-shadow(3px 0 0 #ff0000) drop-shadow(-3px 0 0 #00ffff) brightness(1.2) saturate(1.5)' },
    { ...base, ...inStart, transform: 'translateX(-5px) scale(1.02)', filter: 'drop-shadow(3px 0 0 #ff0000) drop-shadow(-3px 0 0 #00ffff) brightness(1.2) saturate(1.5)' },
    { ...base, ...inEnd }
  ),
  'curtain': _two(
    { ...base },
    { ...base, ...out, clipPath: 'inset(0 50% 0 50%)' },
    { ...base, ...inStart, clipPath: 'inset(0 50% 0 50%)' },
    { ...base, ...inEnd, clipPath: 'inset(0 0 0 0)' }
  ),
  'morph': _two(
    { ...base },
    { ...base, ...out, transform: 'scale(1.05) rotate(3deg)' },
    { ...base, ...inStart, transform: 'scale(1.15) rotate(-3deg)' },
    { ...base, ...inEnd }
  ),
  'vortex': _two(
    { ...base },
    { ...base, ...out, transform: 'scale(0) rotate(180deg)' },
    { ...base, ...inStart, transform: 'scale(0) rotate(-180deg)' },
    { ...base, ...inEnd }
  ),
  'etch': (() => {
    const etchBase = { ...base, transform: 'translateX(0px) translateY(0px) rotate(0deg)' };
    return {
      out: [
        { ...etchBase, offset: 0 },
        { ...etchBase, opacity: 0.95, transform: 'translateX(-10px) translateY(-6px) rotate(-1.5deg)', offset: 0.1 },
        { ...etchBase, opacity: 0.9, transform: 'translateX(10px) translateY(6px) rotate(1.5deg)', offset: 0.2 },
        { ...etchBase, opacity: 0.75, transform: 'translateX(-10px) translateY(6px) rotate(-1.5deg)', offset: 0.3 },
        { ...etchBase, opacity: 0.55, transform: 'translateX(10px) translateY(-6px) rotate(1.5deg)', offset: 0.4 },
        { ...etchBase, opacity: 0.35, transform: 'translateX(-6px) translateY(3px) rotate(-1deg)', offset: 0.5 },
        { ...etchBase, opacity: 0.2, transform: 'translateX(6px) translateY(-3px) rotate(1deg)', offset: 0.6 },
        { ...etchBase, opacity: 0.1, transform: 'translateX(-3px) translateY(1px) rotate(-0.5deg)', offset: 0.7 },
        { ...etchBase, opacity: 0.05, transform: 'translateX(3px) translateY(-1px) rotate(0.5deg)', offset: 0.8 },
        { ...etchBase, opacity: 0, transform: 'translateX(0px) translateY(0px) rotate(0deg)', offset: 1 }
      ],
      in: [
        { ...etchBase, opacity: 0, transform: 'translateX(-12px) translateY(8px) rotate(-2deg)', offset: 0 },
        { ...etchBase, opacity: 0.1, transform: 'translateX(12px) translateY(-8px) rotate(2deg)', offset: 0.1 },
        { ...etchBase, opacity: 0.2, transform: 'translateX(-12px) translateY(-8px) rotate(-2deg)', offset: 0.2 },
        { ...etchBase, opacity: 0.3, transform: 'translateX(12px) translateY(8px) rotate(2deg)', offset: 0.3 },
        { ...etchBase, opacity: 0.4, transform: 'translateX(-6px) translateY(4px) rotate(-1deg)', offset: 0.4 },
        { ...etchBase, opacity: 0.6, transform: 'translateX(6px) translateY(-4px) rotate(1deg)', offset: 0.5 },
        { ...etchBase, opacity: 0.75, transform: 'translateX(-3px) translateY(2px) rotate(-0.5deg)', offset: 0.6 },
        { ...etchBase, opacity: 0.85, transform: 'translateX(3px) translateY(-2px) rotate(0.5deg)', offset: 0.7 },
        { ...etchBase, opacity: 0.95, transform: 'translateX(-1px) translateY(1px) rotate(-0.25deg)', offset: 0.8 },
        { ...etchBase, opacity: 1, transform: 'translateX(1px) translateY(-1px) rotate(0.25deg)', offset: 0.9 },
        { ...etchBase, opacity: 1, transform: 'translateX(0px) translateY(0px) rotate(0deg)', offset: 1 }
      ]
    };
  })(),
  'flip': _two(
    { ...base, transform: 'perspective(1200px) rotateY(0deg)', transformOrigin: 'center center', easing: 'ease-in-out' },
    { ...base, ...out, transform: 'perspective(1200px) rotateY(90deg)', transformOrigin: 'center center' },
    { ...base, ...inStart, transform: 'perspective(1200px) rotateY(-90deg)', transformOrigin: 'center center', easing: 'ease-in-out' },
    { ...base, ...inEnd, transform: 'perspective(1200px) rotateY(0deg)', transformOrigin: 'center center' }
  ),
  'fold': _two(
    { ...base, transform: 'perspective(1200px) rotateX(0deg)', transformOrigin: 'top center', easing: 'ease-in-out' },
    { ...base, ...out, transform: 'perspective(1200px) rotateX(-90deg)', transformOrigin: 'top center' },
    { ...base, ...inStart, transform: 'perspective(1200px) rotateX(90deg)', transformOrigin: 'bottom center', easing: 'ease-in-out' },
    { ...base, ...inEnd, transform: 'perspective(1200px) rotateX(0deg)', transformOrigin: 'bottom center' }
  ),
  'hang': _two(
    { ...base, transform: 'rotate(0deg)', transformOrigin: 'top center', easing: 'ease-in-out' },
    { ...base, ...out, transform: 'rotate(90deg)', transformOrigin: 'top center' },
    { ...base, ...inStart, transform: 'rotate(-90deg)', transformOrigin: 'top center', easing: 'ease-in-out' },
    { ...base, ...inEnd, transform: 'rotate(0deg)', transformOrigin: 'top center' }
  ),
  'drop': _two(
    { ...base, transform: 'translateY(0) rotate(0deg)', easing: 'ease-in' },
    { ...base, ...out, transform: 'translateY(100vh) rotate(45deg)' },
    { ...base, ...inStart, transform: 'translateY(-100vh) rotate(-45deg)', easing: 'ease-out' },
    { ...base, ...inEnd, transform: 'translateY(0) rotate(0deg)' }
  ),
  'spin': _two(
    { ...base, transform: 'rotate(0deg) scale(1)', easing: 'ease-in-out' },
    { ...base, ...out, transform: 'rotate(720deg) scale(0)' },
    { ...base, ...inStart, transform: 'rotate(-720deg) scale(0)', easing: 'ease-in-out' },
    { ...base, ...inEnd, transform: 'rotate(0deg) scale(1)' }
  ),
  'pulse': _two(
    { ...base, transform: 'scale(1)', filter: 'brightness(1)', easing: 'ease-out' },
    { ...base, ...out, transform: 'scale(1.15)', filter: 'brightness(1.2)' },
    { ...base, ...inStart, transform: 'scale(0.85)', filter: 'brightness(1.2)', easing: 'ease-out' },
    { ...base, ...inEnd, transform: 'scale(1)', filter: 'brightness(1)' }
  ),
  'explode': _two(
    { ...base, transform: 'scale(1)', filter: 'blur(0px)', easing: 'ease-out' },
    { ...base, ...out, transform: 'scale(1.3)', filter: 'blur(8px)' },
    { ...base, ...inStart, transform: 'scale(0.7)', filter: 'blur(8px)', easing: 'ease-out' },
    { ...base, ...inEnd, transform: 'scale(1)', filter: 'blur(0px)' }
  ),
  'implode': _two(
    { ...base, transform: 'scale(1)', filter: 'blur(0px)', easing: 'ease-out' },
    { ...base, ...out, transform: 'scale(0.7)', filter: 'blur(8px)' },
    { ...base, ...inStart, transform: 'scale(1.3)', filter: 'blur(8px)', easing: 'ease-out' },
    { ...base, ...inEnd, transform: 'scale(1)', filter: 'blur(0px)' }
  ),
  'bounce': _two(
    { ...base, transform: 'scale(1)', easing: 'ease-in' },
    { ...base, ...out, transform: 'scale(0.8)' },
    { ...base, ...inStart, transform: 'scale(0)', easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)' },
    { ...base, ...inEnd, transform: 'scale(1)' }
  ),
  'elastic': _two(
    { ...base, transform: 'scale(1)', easing: 'ease-in' },
    { ...base, ...out, transform: 'scale(1.2)' },
    { ...base, ...inStart, transform: 'scale(0)', easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    { ...base, ...inEnd, transform: 'scale(1)' }
  ),
  'flash': _two(
    { ...base, filter: 'brightness(1)', easing: 'ease-out' },
    { ...base, ...out, filter: 'brightness(2)' },
    { ...base, ...inStart, filter: 'brightness(0)', easing: 'ease-out' },
    { ...base, ...inEnd, filter: 'brightness(1)' }
  ),
  'film': _two(
    { ...base, filter: 'grayscale(0) sepia(0)', easing: 'ease-out' },
    { ...base, ...out, filter: 'grayscale(1) sepia(1)' },
    { ...base, ...inStart, filter: 'grayscale(1) sepia(1)', easing: 'ease-out' },
    { ...base, ...inEnd, filter: 'grayscale(0) sepia(0)' }
  ),
  'warp': _two(
    { ...base, transform: 'scale(1)', filter: 'hue-rotate(0) blur(0px)', easing: 'ease-out' },
    { ...base, ...out, transform: 'scale(1.1)', filter: 'hue-rotate(180deg) blur(8px)' },
    { ...base, ...inStart, transform: 'scale(0.9)', filter: 'hue-rotate(-180deg) blur(8px)', easing: 'ease-out' },
    { ...base, ...inEnd, transform: 'scale(1)', filter: 'hue-rotate(0) blur(0px)' }
  )
};

export const TYPES = new Set(Object.keys(PRESETS));
export const SPECIAL_TYPES = new Set(['random', 'cycle']);
export const ALL_TYPES = new Set([...TYPES, ...SPECIAL_TYPES]);

const allNames = [...TYPES];

export function resolvePreset(name, state = { index: 0 }) {
  if (TYPES.has(name)) {
    return { name, state };
  }

  if (name === 'random') {
    const pick = randomElement(allNames, Math.random);
    return { name: pick, state };
  }

  if (name === 'cycle') {
    const pick = allNames[state.index % allNames.length];
    state.index = (state.index + 1) % allNames.length;
    return { name: pick, state };
  }

  return { name: DEFAULT_PRESET, state };
}

export function keyframesForPreset(name) {
  return PRESETS[name] || PRESETS[DEFAULT_PRESET];
}

export function presetStyleSheet(namespace) {
  const rules = [
    '/* Shared PageTransition presets for the View Transitions API */',
    `::view-transition-group(root) {`,
    `  animation-duration: var(--${namespace}-duration, 350ms);`,
    `  animation-timing-function: var(--${namespace}-easing, ease-out);`,
    `}`,
    `::view-transition-old(root),`,
    `::view-transition-new(root) {`,
    `  animation-duration: inherit;`,
    `  animation-timing-function: inherit;`,
    `  animation-fill-mode: both;`,
    `}`,
  ];

  for (const type of TYPES) {
    if (type === 'cross-fade') continue;
    const { out: outFrames, in: inFrames } = PRESETS[type];
    rules.push(_framesToCss(outFrames, `${namespace}-${type}-out`));
    rules.push(_framesToCss(inFrames, `${namespace}-${type}-in`));
    rules.push(`html:active-view-transition-type(${type})::view-transition-old(root) { animation-name: ${namespace}-${type}-out; }`);
    rules.push(`html:active-view-transition-type(${type})::view-transition-new(root) { animation-name: ${namespace}-${type}-in; }`);
  }

  rules.push(`@media (prefers-reduced-motion: reduce) {`);
  rules.push(`  ::view-transition-group(root),`);
  rules.push(`  ::view-transition-old(root),`);
  rules.push(`  ::view-transition-new(root) {`);
  rules.push(`    animation-duration: 0.001ms !important;`);
  rules.push(`  }`);
  rules.push(`}`);

  return rules.join('\n');
}

export function ensureStyleSheet(namespace) {
  if (typeof document === 'undefined') return;
  const id = `${namespace}--styles`;
  if (document.getElementById(id)) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = presetStyleSheet(namespace);
  document.head.appendChild(style);
}
