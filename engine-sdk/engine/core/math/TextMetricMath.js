// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TextMetricMath.js - grapheme, text-run, wrap, baseline, selection, and glyph-atlas reports.
 */

import { clamp, finiteNumber, safeDiv } from './MathScalar.js';

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_LINE_HEIGHT_RATIO = 1.2;
const COMBINING_MARK_RE = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/u;
const VARIATION_SELECTOR_RE = /[\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/u;
const RTL_STRONG_RE = /[\u0590-\u05ff\u0600-\u06ff\u0700-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;
const LTR_STRONG_RE = /[A-Za-z\u00c0-\u02af\u0370-\u052f\u1e00-\u1eff\u2c60-\u2c7f\ua720-\ua7ff]/u;
const NUMBER_RE = /[0-9\u0660-\u0669\u06f0-\u06f9]/u;
const CJK_OR_HANGUL_RE = /[\u1100-\u11ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;
const LINE_BREAK_AFTER_RE = /[\u002d\u058a\u05be\u1400\u1806\u2010\u2013\u2014\u2e17\u30a0]/u;
const LINE_BREAK_BEFORE_RE = /[([{<\u00ab\u2018\u201c\u3008-\u3011\u3014-\u301b]/u;
const LINE_BREAK_CLOSE_RE = /[)\]}>.,;:!?\u00bb\u2019\u201d\u3001\u3002\uff0c\uff0e\uff1a\uff1b\uff01\uff1f]/u;

function textValue(value) {
  return String(value ?? '');
}

function nonnegativeNumber(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return number >= 0 ? number : fallback;
}

function positiveNumber(value, fallback = 1) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function positiveInteger(value, name, fallback = 1) {
  const number = Math.trunc(finiteNumber(value, fallback));
  if (number <= 0) throw new RangeError(`${name} must be a positive integer`);
  return number;
}

function nonnegativeInteger(value, name, fallback = 0) {
  const number = Math.trunc(finiteNumber(value, fallback));
  if (number < 0) throw new RangeError(`${name} must be a nonnegative integer`);
  return number;
}

function freezeList(values) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

function segmentReport(segment, index) {
  return {
    segment,
    index,
    end: index + segment.length,
    length: segment.length,
  };
}

function isCombiningMark(char) {
  return COMBINING_MARK_RE.test(char);
}

function isVariationSelector(char) {
  return VARIATION_SELECTOR_RE.test(char);
}

function isRegionalIndicator(char) {
  const code = char.codePointAt(0);
  return code >= 0x1f1e6 && code <= 0x1f1ff;
}

function isBidiControl(char) {
  const code = char.codePointAt(0);
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f || code === 0x061c;
}

function textDirectionClass(segment) {
  if (!segment) return 'neutral';
  if (segment === '\n' || segment === '\r') return 'paragraph-separator';
  if (/^\s+$/u.test(segment)) return 'space';
  if (isBidiControl(segment)) return 'bidi-control';
  if (RTL_STRONG_RE.test(segment)) return 'rtl';
  if (LTR_STRONG_RE.test(segment)) return 'ltr';
  if (NUMBER_RE.test(segment)) return 'number';
  return 'neutral';
}

function textLineBreakClass(segment) {
  if (segment === '\r') return 'CR';
  if (segment === '\n') return 'LF';
  if (segment === '\u2028' || segment === '\u2029') return 'BK';
  if (segment === '\u00ad') return 'SHY';
  if (segment === '\u200b') return 'ZW';
  if (segment === '\u2060' || segment === '\ufeff' || segment === '\u00a0') return 'GL';
  if (/^\s$/u.test(segment)) return 'SP';
  if (LINE_BREAK_AFTER_RE.test(segment)) return 'HY';
  if (LINE_BREAK_BEFORE_RE.test(segment)) return 'OP';
  if (LINE_BREAK_CLOSE_RE.test(segment)) return 'CL';
  if (CJK_OR_HANGUL_RE.test(segment)) return 'ID';
  if (NUMBER_RE.test(segment)) return 'NU';
  if (isRegionalIndicator(segment)) return 'RI';
  if (isCombiningMark(segment) || isVariationSelector(segment) || segment.includes('\u200d')) return 'CM';
  return 'AL';
}

function bidiRunDirection(className, baseDirection) {
  if (className === 'rtl') return 'rtl';
  if (className === 'ltr' || className === 'number') return 'ltr';
  return baseDirection;
}

function breakStrength(beforeClass, afterClass, beforeSegment, afterSegment) {
  if (!beforeSegment) return { allowed: false, mandatory: false, reason: 'start' };
  if (beforeClass === 'CR' && afterClass === 'LF') return { allowed: false, mandatory: false, reason: 'crlf-pair' };
  if (beforeClass === 'CR' || beforeClass === 'LF' || beforeClass === 'BK') return { allowed: true, mandatory: true, reason: 'mandatory-break' };
  if (beforeClass === 'GL' || afterClass === 'GL') return { allowed: false, mandatory: false, reason: 'glue' };
  if (beforeClass === 'CM' || afterClass === 'CM') return { allowed: false, mandatory: false, reason: 'combining-sequence' };
  if (beforeSegment.includes('\u200d') || afterSegment.includes('\u200d')) return { allowed: false, mandatory: false, reason: 'zero-width-joiner' };
  if (beforeClass === 'ZW' || beforeClass === 'SHY') return { allowed: true, mandatory: false, reason: beforeClass === 'ZW' ? 'zero-width-space' : 'soft-hyphen' };
  if (beforeClass === 'SP') return { allowed: true, mandatory: false, reason: 'space' };
  if (beforeClass === 'HY') return { allowed: true, mandatory: false, reason: 'hyphen' };
  if (beforeClass === 'ID' && afterClass === 'ID') return { allowed: true, mandatory: false, reason: 'ideographic' };
  if (beforeClass === 'CL' || afterClass === 'OP') return { allowed: false, mandatory: false, reason: 'punctuation-guard' };
  return { allowed: false, mandatory: false, reason: 'prohibited' };
}

function fallbackGraphemeSegments(text) {
  const segments = [];
  let current = '';
  let currentIndex = 0;
  let offset = 0;
  let joinNext = false;
  let regionalRun = 0;

  const pushCurrent = () => {
    if (current.length > 0) {
      segments.push(segmentReport(current, currentIndex));
    }
  };

  for (const char of text) {
    const charIndex = offset;
    const charLength = char.length;
    const regional = isRegionalIndicator(char);
    const extend = isCombiningMark(char) || isVariationSelector(char);
    const zwj = char === '\u200d';

    if (current.length === 0) {
      current = char;
      currentIndex = charIndex;
      joinNext = zwj;
      regionalRun = regional ? 1 : 0;
      offset += charLength;
      continue;
    }

    if (extend || joinNext || zwj || (regional && regionalRun === 1)) {
      current += char;
      joinNext = zwj;
      regionalRun = regional ? regionalRun + 1 : 0;
      if (regionalRun >= 2) regionalRun = 0;
      offset += charLength;
      continue;
    }

    pushCurrent();
    current = char;
    currentIndex = charIndex;
    joinNext = zwj;
    regionalRun = regional ? 1 : 0;
    offset += charLength;
  }

  pushCurrent();
  return segments;
}

function intlGraphemeSegments(text) {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (entry) => segmentReport(entry.segment, entry.index));
}

function advanceTableValue(table, segment) {
  if (!table) return undefined;
  if (typeof table.get === 'function') return table.get(segment);
  if (Object.prototype.hasOwnProperty.call(table, segment)) return table[segment];
  return undefined;
}

function advanceForSegment(segmentInfo, ordinal, options = {}) {
  if (segmentInfo.segment === '\n' || segmentInfo.segment === '\r') return 0;
  if (typeof options.advanceForSegment === 'function') {
    const value = options.advanceForSegment(segmentInfo.segment, ordinal, segmentInfo);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const tableValue = advanceTableValue(options.advances, segmentInfo.segment);
  if (Number.isFinite(tableValue) && tableValue >= 0) return tableValue;
  if (/^\s$/u.test(segmentInfo.segment) && Number.isFinite(options.spaceAdvance) && options.spaceAdvance >= 0) {
    return options.spaceAdvance;
  }
  const fontSize = positiveNumber(options.fontSize, DEFAULT_FONT_SIZE);
  return nonnegativeNumber(options.defaultAdvance, fontSize * 0.5);
}

function measuredSegments(segments, options = {}) {
  const letterSpacing = finiteNumber(options.letterSpacing, 0);
  let x = 0;
  return segments.map((segment, ordinal) => {
    const advance = advanceForSegment(segment, ordinal, options);
    const report = {
      ...segment,
      ordinal,
      x,
      advance,
      width: advance,
      endX: x + advance,
      letterSpacingAfter: ordinal < segments.length - 1 ? letterSpacing : 0,
    };
    x = report.endX + report.letterSpacingAfter;
    return report;
  });
}

function lineFromSegments(segments, lineIndex, y, options = {}) {
  const measured = measuredSegments(segments, options);
  const width = measured.length > 0 ? measured[measured.length - 1].endX : 0;
  const start = measured.length > 0 ? measured[0].index : finiteNumber(options.emptyOffset, 0);
  const end = measured.length > 0 ? measured[measured.length - 1].end : start;
  return Object.freeze({
    text: measured.map((segment) => segment.segment).join(''),
    lineIndex,
    start,
    end,
    x: 0,
    y,
    width,
    height: positiveNumber(options.lineHeight, DEFAULT_FONT_SIZE * DEFAULT_LINE_HEIGHT_RATIO),
    segmentCount: measured.length,
    segments: freezeList(measured.map((segment) => ({ ...segment, lineIndex }))),
  });
}

function normalizeOverflowWrap(value) {
  const mode = String(value ?? 'normal').toLowerCase();
  return mode === 'anywhere' || mode === 'break-word' ? mode : 'normal';
}

function appendMeasuredWidth(currentWidth, currentCount, segment, ordinal, options) {
  const spacing = currentCount > 0 ? finiteNumber(options.letterSpacing, 0) : 0;
  return currentWidth + spacing + advanceForSegment(segment, ordinal, options);
}

export function textGraphemeSegments(text, options = {}) {
  const value = textValue(text);
  const segments = options.useIntl === false ? fallbackGraphemeSegments(value) : (intlGraphemeSegments(value) ?? fallbackGraphemeSegments(value));
  return freezeList(segments);
}

export function textGraphemeBoundaries(text, options = {}) {
  const segments = textGraphemeSegments(text, options);
  return Object.freeze([0, ...segments.map((segment) => segment.end)]);
}

export function textCursorAdvance(text, offset = 0, direction = 1, options = {}) {
  const value = textValue(text);
  const segments = textGraphemeSegments(value, options);
  const boundaries = textGraphemeBoundaries(value, options);
  const previousOffset = clamp(Math.trunc(finiteNumber(offset, 0)), 0, value.length);
  const dir = finiteNumber(direction, 1);
  let nextOffset = previousOffset;

  if (dir > 0) {
    nextOffset = boundaries.find((boundary) => boundary > previousOffset) ?? value.length;
  } else if (dir < 0) {
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (boundaries[i] < previousOffset) {
        nextOffset = boundaries[i];
        break;
      }
    }
  } else {
    nextOffset = boundaries.reduce((nearest, boundary) => (
      Math.abs(boundary - previousOffset) < Math.abs(nearest - previousOffset) ? boundary : nearest
    ), boundaries[0]);
  }

  const boundaryIndex = Math.max(0, boundaries.indexOf(nextOffset));
  const segmentIndex = dir < 0 ? boundaryIndex : Math.max(0, boundaryIndex - 1);
  return {
    schema: 'particle-realms.text-cursor-advance.v1',
    previousOffset,
    offset: nextOffset,
    direction: dir < 0 ? -1 : dir > 0 ? 1 : 0,
    moved: nextOffset !== previousOffset,
    boundaryIndex,
    segment: segments[segmentIndex] ?? null,
    boundaryCount: boundaries.length,
  };
}

export function textRunMetricReport(text, options = {}) {
  const value = textValue(text);
  const fontSize = positiveNumber(options.fontSize, DEFAULT_FONT_SIZE);
  const lineHeight = positiveNumber(options.lineHeight, fontSize * DEFAULT_LINE_HEIGHT_RATIO);
  const segments = textGraphemeSegments(value, options);
  const measured = measuredSegments(segments, options);
  const width = measured.length > 0 ? measured[measured.length - 1].endX : 0;
  return {
    schema: 'particle-realms.text-run-metric.v1',
    text: value,
    width,
    advance: width,
    fontSize,
    lineHeight,
    segmentCount: measured.length,
    segments: freezeList(measured),
  };
}

export function textBidiRunReport(text, options = {}) {
  const value = textValue(text);
  const segments = textGraphemeSegments(value, options).map((segment, ordinal) => {
    const bidiClass = textDirectionClass(segment.segment);
    return {
      ...segment,
      ordinal,
      bidiClass,
      strong: bidiClass === 'ltr' || bidiClass === 'rtl',
      weak: bidiClass === 'number',
      control: bidiClass === 'bidi-control',
    };
  });
  const firstStrong = segments.find((segment) => segment.strong) ?? null;
  const requestedBase = String(options.baseDirection || options.dir || 'auto').toLowerCase();
  const fallbackDirection = String(options.fallbackDirection || 'ltr').toLowerCase() === 'rtl' ? 'rtl' : 'ltr';
  const baseDirection = requestedBase === 'ltr' || requestedBase === 'rtl'
    ? requestedBase
    : firstStrong?.bidiClass ?? fallbackDirection;
  const runs = [];

  for (const segment of segments) {
    const direction = bidiRunDirection(segment.bidiClass, runs.length > 0 ? runs[runs.length - 1].direction : baseDirection);
    const previous = runs[runs.length - 1];
    if (previous && previous.direction === direction) {
      previous.text += segment.segment;
      previous.end = segment.end;
      previous.segmentCount += 1;
      previous.classes[segment.bidiClass] = (previous.classes[segment.bidiClass] || 0) + 1;
      previous.segments.push(segment);
    } else {
      runs.push({
        direction,
        text: segment.segment,
        start: segment.index,
        end: segment.end,
        segmentCount: 1,
        classes: { [segment.bidiClass]: 1 },
        segments: [segment],
      });
    }
  }

  const frozenRuns = runs.map((run, index) => Object.freeze({
    ...run,
    index,
    classes: Object.freeze({ ...run.classes }),
    segments: freezeList(run.segments),
  }));
  const rtlCount = segments.filter((segment) => segment.bidiClass === 'rtl').length;
  const ltrCount = segments.filter((segment) => segment.bidiClass === 'ltr').length;
  const numberCount = segments.filter((segment) => segment.bidiClass === 'number').length;
  return {
    schema: 'particle-realms.text-bidi-run.v1',
    text: value,
    baseDirection,
    fallbackDirection,
    firstStrong: firstStrong ? Object.freeze({ ...firstStrong }) : null,
    mixedDirection: rtlCount > 0 && (ltrCount > 0 || numberCount > 0),
    rtlCount,
    ltrCount,
    numberCount,
    controlCount: segments.filter((segment) => segment.control).length,
    segmentCount: segments.length,
    runCount: frozenRuns.length,
    runs: freezeList(frozenRuns),
    visualOrderApprox: freezeList((baseDirection === 'rtl' ? [...frozenRuns].reverse() : frozenRuns).map((run) => ({
      index: run.index,
      direction: run.direction,
      text: run.text,
      start: run.start,
      end: run.end,
    }))),
    exactUnicodeBidi: false,
  };
}

export function textLineBreakOpportunityReport(text, options = {}) {
  const value = textValue(text);
  const overflowWrap = normalizeOverflowWrap(options.overflowWrap);
  const segments = textGraphemeSegments(value, options).map((segment, ordinal) => ({
    ...segment,
    ordinal,
    lineBreakClass: textLineBreakClass(segment.segment),
  }));
  const boundaries = [];

  for (let i = 0; i < segments.length; i += 1) {
    const before = segments[i];
    const after = segments[i + 1] ?? null;
    const base = after
      ? breakStrength(before.lineBreakClass, after.lineBreakClass, before.segment, after.segment)
      : { allowed: true, mandatory: false, reason: 'end' };
    const anywhereAllowed = overflowWrap === 'anywhere' && after &&
      !base.mandatory &&
      before.lineBreakClass !== 'GL' &&
      after.lineBreakClass !== 'GL' &&
      before.lineBreakClass !== 'CM' &&
      after.lineBreakClass !== 'CM' &&
      !before.segment.includes('\u200d') &&
      !after.segment.includes('\u200d');
    const allowed = base.allowed || anywhereAllowed;
    const reason = base.allowed || !anywhereAllowed ? base.reason : 'overflow-wrap-anywhere';
    boundaries.push(Object.freeze({
      index: i,
      offset: before.end,
      before: before.segment,
      after: after?.segment ?? '',
      beforeClass: before.lineBreakClass,
      afterClass: after?.lineBreakClass ?? 'END',
      allowed,
      mandatory: base.mandatory,
      reason,
    }));
  }

  const opportunities = boundaries.filter((boundary) => boundary.allowed);
  return {
    schema: 'particle-realms.text-line-break-opportunity.v1',
    text: value,
    overflowWrap,
    segmentCount: segments.length,
    boundaryCount: boundaries.length,
    opportunityCount: opportunities.length,
    mandatoryCount: opportunities.filter((boundary) => boundary.mandatory).length,
    softHyphenCount: opportunities.filter((boundary) => boundary.reason === 'soft-hyphen').length,
    exactUax14: false,
    segments: freezeList(segments),
    boundaries: freezeList(boundaries),
    opportunities: freezeList(opportunities),
  };
}

export function textLineWrapReport(text, maxWidth = Infinity, options = {}) {
  const value = textValue(text);
  const widthLimit = nonnegativeNumber(maxWidth, Infinity);
  const fontSize = positiveNumber(options.fontSize, DEFAULT_FONT_SIZE);
  const lineHeight = positiveNumber(options.lineHeight, fontSize * DEFAULT_LINE_HEIGHT_RATIO);
  const overflowWrap = normalizeOverflowWrap(options.overflowWrap);
  const segments = textGraphemeSegments(value, options);
  const lines = [];
  let current = [];
  let currentWidth = 0;

  const pushLine = (emptyOffset = 0) => {
    lines.push(lineFromSegments(current, lines.length, lines.length * lineHeight, {
      ...options,
      lineHeight,
      emptyOffset,
    }));
    current = [];
    currentWidth = 0;
  };

  segments.forEach((segment, ordinal) => {
    if (segment.segment === '\n' || segment.segment === '\r') {
      pushLine(segment.end);
      return;
    }

    const candidateWidth = appendMeasuredWidth(currentWidth, current.length, segment, ordinal, options);
    if (current.length > 0 && candidateWidth > widthLimit && overflowWrap !== 'normal') {
      pushLine(segment.index);
      current.push(segment);
      currentWidth = advanceForSegment(segment, ordinal, options);
      return;
    }

    current.push(segment);
    currentWidth = candidateWidth;
  });

  if (segments.length === 0 || current.length > 0 || value.endsWith('\n') || value.endsWith('\r')) {
    pushLine(value.length);
  }

  const maxLineWidth = lines.reduce((maxWidthSoFar, line) => Math.max(maxWidthSoFar, line.width), 0);
  return {
    schema: 'particle-realms.text-line-wrap.v1',
    text: value,
    maxWidth: widthLimit,
    overflowWrap,
    fontSize,
    lineHeight,
    lineCount: lines.length,
    width: maxLineWidth,
    height: lines.length * lineHeight,
    overflow: Number.isFinite(widthLimit) && maxLineWidth > widthLimit,
    lines: freezeList(lines),
  };
}

export function textTruncateReport(text, maxWidth = Infinity, options = {}) {
  const value = textValue(text);
  const widthLimit = nonnegativeNumber(maxWidth, Infinity);
  const ellipsis = textValue(options.ellipsis ?? '...');
  const run = textRunMetricReport(value, options);
  const ellipsisRun = textRunMetricReport(ellipsis, options);
  if (run.width <= widthLimit) {
    return {
      schema: 'particle-realms.text-truncate.v1',
      text: value,
      originalText: value,
      truncated: false,
      width: run.width,
      originalWidth: run.width,
      maxWidth: widthLimit,
      ellipsis,
      ellipsisWidth: ellipsisRun.width,
      visibleSegmentCount: run.segmentCount,
    };
  }

  if (ellipsisRun.width > widthLimit) {
    return {
      schema: 'particle-realms.text-truncate.v1',
      text: '',
      originalText: value,
      truncated: true,
      width: 0,
      originalWidth: run.width,
      maxWidth: widthLimit,
      ellipsis,
      ellipsisWidth: ellipsisRun.width,
      visibleSegmentCount: 0,
    };
  }

  const letterSpacing = finiteNumber(options.letterSpacing, 0);
  const visible = [];
  let visibleWidth = 0;
  for (let i = 0; i < run.segments.length; i++) {
    const segment = run.segments[i];
    const nextWidth = visibleWidth + (visible.length > 0 ? letterSpacing : 0) + segment.advance;
    const suffixSpacing = ellipsis.length > 0 && visible.length + 1 > 0 ? letterSpacing : 0;
    if (nextWidth + suffixSpacing + ellipsisRun.width > widthLimit) break;
    visible.push(segment.segment);
    visibleWidth = nextWidth;
  }

  const textOut = `${visible.join('')}${ellipsis}`;
  const width = visibleWidth + (visible.length > 0 && ellipsis.length > 0 ? letterSpacing : 0) + ellipsisRun.width;
  return {
    schema: 'particle-realms.text-truncate.v1',
    text: textOut,
    originalText: value,
    truncated: true,
    width,
    originalWidth: run.width,
    maxWidth: widthLimit,
    ellipsis,
    ellipsisWidth: ellipsisRun.width,
    visibleSegmentCount: visible.length,
  };
}

export function textBaselineReport(metrics = {}, options = {}) {
  const fontSize = positiveNumber(options.fontSize ?? metrics.fontSize, DEFAULT_FONT_SIZE);
  const lineHeight = positiveNumber(options.lineHeight ?? metrics.lineHeight, fontSize * DEFAULT_LINE_HEIGHT_RATIO);
  const actualAscent = nonnegativeNumber(metrics.actualBoundingBoxAscent, fontSize * 0.8);
  const actualDescent = nonnegativeNumber(metrics.actualBoundingBoxDescent, fontSize * 0.2);
  const fontAscent = nonnegativeNumber(metrics.fontBoundingBoxAscent ?? metrics.emHeightAscent, Math.max(actualAscent, fontSize * 0.8));
  const fontDescent = nonnegativeNumber(metrics.fontBoundingBoxDescent ?? metrics.emHeightDescent, Math.max(actualDescent, fontSize * 0.2));
  const leading = Math.max(0, lineHeight - fontAscent - fontDescent) * 0.5;
  const top = -fontAscent - leading;
  const bottom = fontDescent + leading;
  return {
    schema: 'particle-realms.text-baseline.v1',
    fontSize,
    lineHeight,
    actualAscent,
    actualDescent,
    ascent: fontAscent,
    descent: fontDescent,
    emHeightAscent: fontAscent,
    emHeightDescent: fontDescent,
    leading,
    alphabeticBaseline: -top,
    top,
    bottom,
    height: bottom - top,
    actualTop: -actualAscent,
    actualBottom: actualDescent,
    actualHeight: actualAscent + actualDescent,
  };
}

export function textSelectionRects(wrapReport, start = 0, end = start, options = {}) {
  const lines = Array.isArray(wrapReport?.lines) ? wrapReport.lines : [];
  const low = Math.max(0, Math.min(Math.trunc(finiteNumber(start, 0)), Math.trunc(finiteNumber(end, start))));
  const high = Math.max(low, Math.max(Math.trunc(finiteNumber(start, 0)), Math.trunc(finiteNumber(end, start))));
  const lineHeight = positiveNumber(options.lineHeight ?? wrapReport?.lineHeight, DEFAULT_FONT_SIZE * DEFAULT_LINE_HEIGHT_RATIO);
  const rects = [];

  for (const line of lines) {
    const selected = (line.segments ?? []).filter((segment) => segment.end > low && segment.index < high);
    if (selected.length === 0) continue;
    const first = selected[0];
    const last = selected[selected.length - 1];
    const x = first.x;
    const width = last.endX - first.x;
    rects.push(Object.freeze({
      lineIndex: line.lineIndex,
      start: Math.max(low, first.index),
      end: Math.min(high, last.end),
      x,
      y: finiteNumber(line.y, line.lineIndex * lineHeight),
      width,
      height: lineHeight,
    }));
  }

  const maxWidth = rects.reduce((value, rect) => Math.max(value, rect.width), 0);
  const height = rects.length === 0 ? 0 : rects[rects.length - 1].y + lineHeight - rects[0].y;
  return {
    schema: 'particle-realms.text-selection-rects.v1',
    start: low,
    end: high,
    empty: low === high || rects.length === 0,
    rectCount: rects.length,
    width: maxWidth,
    height,
    rects: freezeList(rects),
  };
}

export function glyphAtlasPlacementReport(glyphs = [], options = {}) {
  const atlasWidth = positiveInteger(options.atlasWidth, 'atlasWidth', 256);
  const atlasHeight = positiveInteger(options.atlasHeight, 'atlasHeight', atlasWidth);
  const padding = nonnegativeInteger(options.padding, 'padding', 1);
  const source = Array.from(glyphs ?? []);
  const placements = [];
  let cursorX = padding;
  let cursorY = padding;
  let shelfHeight = 0;
  let usedWidth = 0;
  let usedHeight = 0;
  let payloadArea = 0;
  let overflowCount = 0;

  source.forEach((glyph, index) => {
    const width = Math.ceil(nonnegativeNumber(glyph?.width, 0));
    const height = Math.ceil(nonnegativeNumber(glyph?.height, 0));
    const allocatedWidth = width + padding * 2;
    const allocatedHeight = height + padding * 2;
    if (cursorX + allocatedWidth > atlasWidth && cursorX > padding) {
      cursorX = padding;
      cursorY += shelfHeight;
      shelfHeight = 0;
    }

    if (cursorY + allocatedHeight > atlasHeight) {
      overflowCount += 1;
      placements.push(Object.freeze({
        id: glyph?.id ?? index,
        index,
        width,
        height,
        advance: nonnegativeNumber(glyph?.advance, width),
        overflow: true,
        valid: false,
      }));
      return;
    }

    const x = cursorX + padding;
    const y = cursorY + padding;
    cursorX += allocatedWidth;
    shelfHeight = Math.max(shelfHeight, allocatedHeight);
    usedWidth = Math.max(usedWidth, cursorX);
    usedHeight = Math.max(usedHeight, cursorY + shelfHeight);
    payloadArea += width * height;
    placements.push(Object.freeze({
      id: glyph?.id ?? index,
      index,
      x,
      y,
      width,
      height,
      advance: nonnegativeNumber(glyph?.advance, width),
      u0: safeDiv(x, atlasWidth, 0),
      v0: safeDiv(y, atlasHeight, 0),
      u1: safeDiv(x + width, atlasWidth, 0),
      v1: safeDiv(y + height, atlasHeight, 0),
      overflow: false,
      valid: true,
    }));
  });

  return {
    schema: 'particle-realms.glyph-atlas-placement.v1',
    atlasWidth,
    atlasHeight,
    padding,
    glyphCount: source.length,
    placementCount: placements.length,
    overflow: overflowCount > 0,
    overflowCount,
    usedWidth,
    usedHeight,
    occupancyRatio: safeDiv(payloadArea, atlasWidth * atlasHeight, 0),
    placements: freezeList(placements),
  };
}
