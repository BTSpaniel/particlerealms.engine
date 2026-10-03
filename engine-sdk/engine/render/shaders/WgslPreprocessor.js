// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WGSL Preprocessor - Tagged Template Literal for Shader Compilation
 * 
 * Provides GLSL-like preprocessor directives using JavaScript template literals.
 * 
 * USAGE:
 *   import { wgsl } from './WgslPreprocessor.js';
 *   
 *   const useShadows = true;
 *   const lightCount = 4;
 *   
 *   const shader = wgsl`
 *     #if ${useShadows}
 *       fn sampleShadow() -> f32 { ... }
 *     #endif
 *     
 *     #for ${lightCount}
 *       // Unrolled ${lightCount} times
 *     #endfor
 *     
 *     const MAX_LIGHTS : u32 = ${lightCount}u;
 *   `;
 * 
 * SUPPORTED DIRECTIVES:
 *   #if ${condition}     - Include block if truthy
 *   #ifdef ${condition}  - Same as #if
 *   #ifndef ${condition} - Include block if falsy
 *   #else                - Else branch
 *   #endif               - End conditional
 *   #for ${count}        - Repeat block N times (unroll)
 *   #endfor              - End loop
 * 
 * Based on: https://github.com/toji/wgsl-preprocessor
 */

/**
 * Tagged template literal for WGSL preprocessing
 * @param {TemplateStringsArray} strings - Template literal strings
 * @param  {...any} values - Interpolated values
 * @returns {string} Processed WGSL code
 */
export function wgsl(strings, ...values) {
  // First, build the raw string with placeholders for processing
  let result = '';
  const stack = []; // Track nested conditionals
  let skipDepth = 0; // Depth at which we started skipping
  
  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    const value = i < values.length ? values[i] : undefined;
    
    // Process each line for directives
    const lines = str.split('\n');
    
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      let line = lines[lineIdx];
      const trimmed = line.trim();
      
      // Handle #if / #ifdef
      if (trimmed.startsWith('#if') && !trimmed.startsWith('#ifndef')) {
        const isIfDef = trimmed.startsWith('#ifdef');
        // The condition is the next interpolated value
        if (i < values.length) {
          const condition = !!values[i];
          stack.push({ type: 'if', condition, included: condition });
          if (!condition && skipDepth === 0) {
            skipDepth = stack.length;
          }
          // Skip adding this line and consume the value
          continue;
        }
      }
      
      // Handle #ifndef
      if (trimmed.startsWith('#ifndef')) {
        if (i < values.length) {
          const condition = !values[i];
          stack.push({ type: 'if', condition, included: condition });
          if (!condition && skipDepth === 0) {
            skipDepth = stack.length;
          }
          continue;
        }
      }
      
      // Handle #else
      if (trimmed === '#else') {
        if (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top.type === 'if') {
            const wasIncluded = top.included;
            top.included = !top.condition;
            
            // Update skip state
            if (wasIncluded && skipDepth === 0) {
              skipDepth = stack.length;
            } else if (!wasIncluded && skipDepth === stack.length) {
              skipDepth = 0;
            }
          }
        }
        continue;
      }
      
      // Handle #endif
      if (trimmed === '#endif') {
        if (stack.length > 0) {
          if (skipDepth === stack.length) {
            skipDepth = 0;
          }
          stack.pop();
        }
        continue;
      }
      
      // Handle #for (simple unroll)
      if (trimmed.startsWith('#for')) {
        if (i < values.length) {
          const count = Number(values[i]) || 0;
          stack.push({ type: 'for', count, iteration: 0, startLine: result.length, content: '' });
          continue;
        }
      }
      
      // Handle #endfor
      if (trimmed === '#endfor') {
        if (stack.length > 0 && stack[stack.length - 1].type === 'for') {
          const loop = stack.pop();
          // Repeat content N times
          for (let iter = 0; iter < loop.count; iter++) {
            result += loop.content.replace(/\$\{i\}/g, String(iter));
          }
        }
        continue;
      }
      
      // Skip lines if we're in a false conditional
      if (skipDepth > 0) {
        continue;
      }
      
      // Accumulate for loops
      if (stack.length > 0 && stack[stack.length - 1].type === 'for') {
        stack[stack.length - 1].content += line + '\n';
        continue;
      }
      
      // Normal line - add it
      result += line;
      if (lineIdx < lines.length - 1) {
        result += '\n';
      }
    }
    
    // Add interpolated value (if not consumed by directive)
    if (value !== undefined && !strings[i].trim().match(/#(if|ifdef|ifndef|for)\s*$/)) {
      result += String(value);
    }
  }
  
  return result;
}

/**
 * Simple string-based conditionals without tagged template
 * Useful for simpler cases
 * 
 * @param {boolean} condition 
 * @param {string} ifTrue 
 * @param {string} ifFalse 
 * @returns {string}
 */
export function wgslIf(condition, ifTrue, ifFalse = '') {
  return condition ? ifTrue : ifFalse;
}

/**
 * Repeat a string N times with index substitution
 * ${i} in the template is replaced with the iteration index
 * 
 * @param {number} count 
 * @param {string} template 
 * @returns {string}
 */
export function wgslFor(count, template) {
  let result = '';
  for (let i = 0; i < count; i++) {
    result += template.replace(/\$\{i\}/g, String(i));
  }
  return result;
}

/**
 * Create a shader variant by selecting features
 * 
 * @param {Object} features - Feature flags { useShadows: true, ... }
 * @param {Object} variants - Code blocks for each feature
 * @returns {string}
 */
export function wgslVariant(features, variants) {
  let result = variants.base || '';
  
  for (const [key, enabled] of Object.entries(features)) {
    if (enabled && variants[key]) {
      result += '\n' + variants[key];
    }
  }
  
  return result;
}
