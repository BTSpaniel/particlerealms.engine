// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { make2DCanvas } from '../../surfaces/CanvasSurface.js';
import { glyphAtlasPlacementReport } from '../math/TextMetricMath.js';
import { extractGlyphFeatures } from '../math/DocumentImageMath.js';
import { mulberry32 } from '../math/MathRandom.js';

export const DEFAULT_GLYPH_ALPHABET = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33)).join('');
export const DOCUMENT_GLYPH_SYMBOLS = '¼½¾⅛⅜⅝⅞×÷°±−–—‘’“”²³•→←↔';
export const DOCUMENT_GLYPH_ALPHABET = DEFAULT_GLYPH_ALPHABET + DOCUMENT_GLYPH_SYMBOLS;
export const DEFAULT_GLYPH_FONTS = Object.freeze(['Arial', 'Times New Roman', 'Courier New', 'Verdana']);
export const DEFAULT_GLYPH_STYLES = Object.freeze([{ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' }, { weight: 400, style: 'italic' }].map(Object.freeze));
const check = signal => { if (signal?.aborted) throw new DOMException('Glyph rasterization cancelled', 'AbortError'); };

/** Locally authored samples from browser-resolved fonts; no network font loading. */
export async function createGlyphRasterDataset({ alphabet = DEFAULT_GLYPH_ALPHABET, fonts = DEFAULT_GLYPH_FONTS, styles = DEFAULT_GLYPH_STYLES, sizes = [28, 40], augment = false, seed = 74219, signal, onProgress } = {}) {
  const labels = [...new Set(Array.from(alphabet))];
  if (!Array.isArray(styles) || !styles.length || styles.length > 4 || styles.some(item => !item || ![400, 700].includes(item.weight) || !['normal', 'italic'].includes(item.style))) throw new TypeError('Declare up to four normal/bold/italic font styles');
  if (!labels.length || labels.length > 256 || labels.some(label => /\s/u.test(label)) || !fonts.length || fonts.length > 12 || !sizes.length || sizes.length > 4 || labels.length * fonts.length * (sizes.length + Number(augment)) * styles.length > 12288) throw new RangeError('Glyph dataset exceeds the bounded alphabet or sample budget');
  if (!fonts.every(font => typeof font === 'string' && /^[a-zA-Z0-9 -]{1,80}$/.test(font)) || !sizes.every(size => Number.isFinite(size) && size >= 12 && size <= 64)) throw new TypeError('Invalid local glyph font settings');
  if (typeof augment !== 'boolean' || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Declare a boolean augmentation switch and unsigned deterministic seed');
  const variants = sizes.map(fontSize => ({ fontSize, degraded: false }));
  if (augment) variants.push({ fontSize: sizes[sizes.length - 1], degraded: true });
  const rng = mulberry32(seed);
  const examples = []; const fontRuns = [];
  const total = fonts.length * styles.length * variants.length;
  for (const family of fonts) for (const style of styles) for (const { fontSize, degraded } of variants) {
    check(signal);
    const font = `${style.style} ${style.weight} ${fontSize}px "${family}"`;
    const { canvas, ctx } = make2DCanvas(1024, 1024);
    try {
      ctx.font = font; ctx.textBaseline = 'alphabetic';
      const cap = ctx.measureText('H');
      const measured = labels.map((label, id) => {
        const metrics = ctx.measureText(label);
        const left = metrics.actualBoundingBoxLeft || 0, right = metrics.actualBoundingBoxRight || metrics.width;
        const ascent = metrics.actualBoundingBoxAscent || 0, descent = metrics.actualBoundingBoxDescent || 0;
        return { id, label, width: Math.max(1, Math.ceil(left + right)) + 4, height: Math.max(1, Math.ceil(ascent + descent)) + 4,
          left, ascent, descent, advance: metrics.width };
      });
      const packing = glyphAtlasPlacementReport(measured, { atlasWidth: 1024, atlasHeight: 1024, padding: 2 });
      if (packing.overflow) throw new RangeError('Glyph atlas exceeded its fixed pixel budget');
      canvas.height = Math.max(1, packing.usedHeight); ctx.font = font; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
      if (degraded) ctx.filter = 'blur(0.35px)';
      for (const placement of packing.placements) {
        const glyph = measured[placement.index];
        ctx.fillText(glyph.label, placement.x + 2 + glyph.left, placement.y + 2 + glyph.ascent);
      }
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (degraded) for (let i = 0; i < image.data.length; i += 4) {
        const x = (i / 4) % image.width;
        const value = Math.max(0, Math.min(255, 18 + image.data[i] * (.82 + .08 * x / image.width) + (rng() - .5) * 8));
        image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
      }
      for (const placement of packing.placements) {
        const glyph = measured[placement.index]; let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (let y = placement.y; y < placement.y + placement.height; y++) for (let x = placement.x; x < placement.x + placement.width; x++) {
          if (image.data[(y * image.width + x) * 4] < (degraded ? 175 : 220)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        }
        if (x1 < x0) continue;
        const bbox = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
        const baseline = placement.y + 2 + glyph.ascent;
        examples.push({ label: glyph.label, features: extractGlyphFeatures(image, bbox, { lineHeight: Math.max(1, cap.actualBoundingBoxAscent + cap.actualBoundingBoxDescent), baseline }),
          provenance: { kind: 'browser-font-raster', requestedFont: font, fontResolution: 'browser-resolved', alphabet: labels.every(label => DEFAULT_GLYPH_ALPHABET.includes(label)) ? 'printable-ascii' : 'document-symbols', bbox, augmentation: degraded ? { blurPx: .35, contrast: [.82, .90], grayOffset: 18, noiseRange: 8, seed } : null,
            baseline, actualMetrics: { ascent: glyph.ascent, descent: glyph.descent, advance: glyph.advance }, atlasSchema: packing.schema } });
      }
      fontRuns.push({ requestedFont: font, degraded, samples: packing.placementCount });
      onProgress?.({ stage: 'Preparing local letter samples', progress: fontRuns.length / total });
    } finally { canvas.width = canvas.height = 0; }
    await new Promise(resolve => setTimeout(resolve, 0)); check(signal);
  }
  return { schema: 'engine.glyph-raster.v1', alphabet: labels.join(''), examples, provenance: { origin: 'local-browser-fonts', fonts: fontRuns } };
}
