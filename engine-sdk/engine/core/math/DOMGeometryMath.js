// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DOMGeometryMath.js - DOMPoint, DOMRect, DOMMatrix, and canvas coordinate helpers.
 */

import { clamp, finiteNumber, safeDiv } from './MathScalar.js';
import { cssPixelsToDevicePixels } from './UnitMath.js';

const IDENTITY_COLUMN_MAJOR_4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function readNumber(value, fallback = 0) {
  return finiteNumber(value, fallback);
}

function readPositiveNumber(value, fallback = 1) {
  const number = readNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function readNonNegativeNumber(value, fallback = 0) {
  const number = readNumber(value, fallback);
  return number >= 0 ? number : fallback;
}

function readIndexedOrNamed(source, index, name, fallback = 0) {
  if (source && typeof source.length === 'number' && index < source.length) {
    return readNumber(source[index], fallback);
  }
  return readNumber(source?.[name], fallback);
}

function valueIsFinite(source, index, name) {
  if (source && typeof source.length === 'number' && index < source.length) {
    return Number.isFinite(source[index]);
  }
  return Number.isFinite(source?.[name]);
}

function domPoint4Report(point, options = {}) {
  const fallbackX = readNumber(options.x ?? options.fallbackX, 0);
  const fallbackY = readNumber(options.y ?? options.fallbackY, 0);
  const fallbackZ = readNumber(options.z ?? options.fallbackZ, 0);
  const fallbackW = readNumber(options.w ?? options.fallbackW, 1);
  const x = readIndexedOrNamed(point, 0, 'x', fallbackX);
  const y = readIndexedOrNamed(point, 1, 'y', fallbackY);
  const z = readIndexedOrNamed(point, 2, 'z', fallbackZ);
  const w = readIndexedOrNamed(point, 3, 'w', fallbackW);
  return {
    x,
    y,
    z,
    w,
    valid: valueIsFinite(point, 0, 'x') &&
      valueIsFinite(point, 1, 'y') &&
      (point?.length >= 3 || point?.z !== undefined ? valueIsFinite(point, 2, 'z') : true) &&
      (point?.length >= 4 || point?.w !== undefined ? valueIsFinite(point, 3, 'w') : true),
  };
}

export function domPointToVec2(point, options = {}) {
  const report = domPoint4Report(point, options);
  return [report.x, report.y];
}

export function domPointToVec4(point, options = {}) {
  const report = domPoint4Report(point, options);
  return [report.x, report.y, report.z, report.w];
}

export function domRectNormalize(rect = {}, options = {}) {
  const fallbackX = readNumber(options.x ?? options.fallbackX, 0);
  const fallbackY = readNumber(options.y ?? options.fallbackY, 0);
  const fallbackWidth = readNumber(options.width ?? options.fallbackWidth, 0);
  const fallbackHeight = readNumber(options.height ?? options.fallbackHeight, 0);
  const hasX = Number.isFinite(rect?.x);
  const hasY = Number.isFinite(rect?.y);
  const hasWidth = Number.isFinite(rect?.width);
  const hasHeight = Number.isFinite(rect?.height);
  const hasLeftRight = Number.isFinite(rect?.left) && Number.isFinite(rect?.right);
  const hasTopBottom = Number.isFinite(rect?.top) && Number.isFinite(rect?.bottom);
  const x = hasX ? rect.x : readNumber(rect?.left, fallbackX);
  const y = hasY ? rect.y : readNumber(rect?.top, fallbackY);
  const width = hasWidth ? rect.width : hasLeftRight ? rect.right - rect.left : fallbackWidth;
  const height = hasHeight ? rect.height : hasTopBottom ? rect.bottom - rect.top : fallbackHeight;
  const x2 = x + width;
  const y2 = y + height;
  const left = Math.min(x, x2);
  const right = Math.max(x, x2);
  const top = Math.min(y, y2);
  const bottom = Math.max(y, y2);
  const normalizedWidth = right - left;
  const normalizedHeight = bottom - top;
  const valid = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height);
  return {
    x,
    y,
    width,
    height,
    left,
    right,
    top,
    bottom,
    centerX: (left + right) * 0.5,
    centerY: (top + bottom) * 0.5,
    normalizedWidth,
    normalizedHeight,
    area: normalizedWidth * normalizedHeight,
    empty: normalizedWidth === 0 || normalizedHeight === 0,
    valid,
  };
}

export function domMatrix2DFromInit(init = {}) {
  const arrayLike = init && typeof init.length === 'number' && init.length >= 6;
  const a = arrayLike ? readNumber(init[0], 1) : readNumber(init.a ?? init.m11, 1);
  const b = arrayLike ? readNumber(init[1], 0) : readNumber(init.b ?? init.m12, 0);
  const c = arrayLike ? readNumber(init[2], 0) : readNumber(init.c ?? init.m21, 0);
  const d = arrayLike ? readNumber(init[3], 1) : readNumber(init.d ?? init.m22, 1);
  const e = arrayLike ? readNumber(init[4], 0) : readNumber(init.e ?? init.m41, 0);
  const f = arrayLike ? readNumber(init[5], 0) : readNumber(init.f ?? init.m42, 0);
  const valid = [a, b, c, d, e, f].every(Number.isFinite);
  return {
    a,
    b,
    c,
    d,
    e,
    f,
    m11: a,
    m12: b,
    m13: 0,
    m14: 0,
    m21: c,
    m22: d,
    m23: 0,
    m24: 0,
    m31: 0,
    m32: 0,
    m33: 1,
    m34: 0,
    m41: e,
    m42: f,
    m43: 0,
    m44: 1,
    is2D: true,
    valid,
  };
}

export function domMatrixToColumnMajor4(init = {}) {
  if (init && typeof init.length === 'number' && init.length >= 16) {
    return new Float64Array(IDENTITY_COLUMN_MAJOR_4.map((fallback, index) => readNumber(init[index], fallback)));
  }

  if (init && typeof init.length === 'number' && init.length >= 6) {
    const matrix2D = domMatrix2DFromInit(init);
    return new Float64Array([
      matrix2D.m11, matrix2D.m12, 0, 0,
      matrix2D.m21, matrix2D.m22, 0, 0,
      0, 0, 1, 0,
      matrix2D.m41, matrix2D.m42, 0, 1,
    ]);
  }

  const matrix2DLike = init?.is2D === true ||
    init?.a !== undefined ||
    init?.b !== undefined ||
    init?.c !== undefined ||
    init?.d !== undefined ||
    init?.e !== undefined ||
    init?.f !== undefined;
  if (matrix2DLike) {
    const matrix2D = domMatrix2DFromInit(init);
    return new Float64Array([
      matrix2D.m11, matrix2D.m12, 0, 0,
      matrix2D.m21, matrix2D.m22, 0, 0,
      0, 0, 1, 0,
      matrix2D.m41, matrix2D.m42, 0, 1,
    ]);
  }

  return new Float64Array([
    readNumber(init?.m11, 1), readNumber(init?.m12, 0), readNumber(init?.m13, 0), readNumber(init?.m14, 0),
    readNumber(init?.m21, 0), readNumber(init?.m22, 1), readNumber(init?.m23, 0), readNumber(init?.m24, 0),
    readNumber(init?.m31, 0), readNumber(init?.m32, 0), readNumber(init?.m33, 1), readNumber(init?.m34, 0),
    readNumber(init?.m41, 0), readNumber(init?.m42, 0), readNumber(init?.m43, 0), readNumber(init?.m44, 1),
  ]);
}

export function columnMajor4ToDomMatrix(matrix = IDENTITY_COLUMN_MAJOR_4) {
  const values = domMatrixToColumnMajor4(matrix);
  const valid = Array.from(values).every(Number.isFinite);
  return {
    a: values[0],
    b: values[1],
    c: values[4],
    d: values[5],
    e: values[12],
    f: values[13],
    m11: values[0],
    m12: values[1],
    m13: values[2],
    m14: values[3],
    m21: values[4],
    m22: values[5],
    m23: values[6],
    m24: values[7],
    m31: values[8],
    m32: values[9],
    m33: values[10],
    m34: values[11],
    m41: values[12],
    m42: values[13],
    m43: values[14],
    m44: values[15],
    is2D: values[2] === 0 && values[3] === 0 && values[6] === 0 && values[7] === 0 &&
      values[8] === 0 && values[9] === 0 && values[10] === 1 && values[11] === 0 &&
      values[14] === 0 && values[15] === 1,
    valid,
  };
}

export function domMatrixTransformPoint(point, matrixInit = IDENTITY_COLUMN_MAJOR_4) {
  const p = domPoint4Report(point);
  const m = domMatrixToColumnMajor4(matrixInit);
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12] * p.w;
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13] * p.w;
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14] * p.w;
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15] * p.w;
  return {
    x,
    y,
    z,
    w,
    valid: p.valid && Array.from(m).every(Number.isFinite) && [x, y, z, w].every(Number.isFinite),
  };
}

export function domRectTransformBounds(rect, matrixInit = IDENTITY_COLUMN_MAJOR_4, options = {}) {
  const bounds = domRectNormalize(rect);
  const corners = [
    { x: bounds.left, y: bounds.top, z: 0, w: 1 },
    { x: bounds.right, y: bounds.top, z: 0, w: 1 },
    { x: bounds.right, y: bounds.bottom, z: 0, w: 1 },
    { x: bounds.left, y: bounds.bottom, z: 0, w: 1 },
  ].map((corner) => domMatrixTransformPoint(corner, matrixInit));
  const projected = corners.map((corner) => {
    if (options.homogeneousDivide === true && corner.w !== 0) {
      return { ...corner, x: corner.x / corner.w, y: corner.y / corner.w, z: corner.z / corner.w };
    }
    return corner;
  });
  const left = Math.min(...projected.map((corner) => corner.x));
  const right = Math.max(...projected.map((corner) => corner.x));
  const top = Math.min(...projected.map((corner) => corner.y));
  const bottom = Math.max(...projected.map((corner) => corner.y));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    right,
    top,
    bottom,
    centerX: (left + right) * 0.5,
    centerY: (top + bottom) * 0.5,
    area: (right - left) * (bottom - top),
    corners,
    valid: bounds.valid && corners.every((corner) => corner.valid),
  };
}

function domQuadPoints(quad = {}) {
  if (Array.isArray(quad) || (quad && typeof quad.length === 'number' && quad.length >= 4)) {
    return [quad[0], quad[1], quad[2], quad[3]];
  }
  if (quad?.p1 || quad?.p2 || quad?.p3 || quad?.p4) {
    return [quad.p1, quad.p2, quad.p3, quad.p4];
  }
  const rect = domRectNormalize(quad);
  return [
    { x: rect.left, y: rect.top, z: 0, w: 1 },
    { x: rect.right, y: rect.top, z: 0, w: 1 },
    { x: rect.right, y: rect.bottom, z: 0, w: 1 },
    { x: rect.left, y: rect.bottom, z: 0, w: 1 },
  ];
}

function polygonArea(points) {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) * 0.5;
}

export function domQuadBoundsReport(quad = {}, options = {}) {
  const points = domQuadPoints(quad).map((point) => domPoint4Report(point, options));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const width = right - left;
  const height = bottom - top;
  return {
    p1: points[0],
    p2: points[1],
    p3: points[2],
    p4: points[3],
    points,
    x: left,
    y: top,
    left,
    right,
    top,
    bottom,
    width,
    height,
    centerX: (left + right) * 0.5,
    centerY: (top + bottom) * 0.5,
    boundsArea: width * height,
    polygonArea: polygonArea(points),
    valid: points.every((point) => point.valid) && [left, right, top, bottom].every(Number.isFinite),
  };
}

export function domQuadTransformBounds(quad = {}, matrixInit = IDENTITY_COLUMN_MAJOR_4, options = {}) {
  const source = domQuadBoundsReport(quad, options);
  const transformedPoints = source.points.map((point) => {
    const transformed = domMatrixTransformPoint(point, matrixInit);
    if (options.homogeneousDivide === true && transformed.w !== 0) {
      return {
        ...transformed,
        x: transformed.x / transformed.w,
        y: transformed.y / transformed.w,
        z: transformed.z / transformed.w,
      };
    }
    return transformed;
  });
  const bounds = domQuadBoundsReport(transformedPoints, options);
  return {
    ...bounds,
    source,
    transformedPoints,
    valid: source.valid && bounds.valid && transformedPoints.every((point) => point.valid),
  };
}

export function domMatrixInverse2DReport(matrixInit = IDENTITY_COLUMN_MAJOR_4) {
  const matrix = columnMajor4ToDomMatrix(domMatrixToColumnMajor4(matrixInit));
  if (!matrix.is2D || !matrix.valid) {
    return {
      valid: false,
      invertible: false,
      determinant: Number.NaN,
      matrix,
      inverse: null,
      error: 'matrix-not-2d',
    };
  }

  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const invertible = Number.isFinite(determinant) && Math.abs(determinant) > Number.EPSILON;
  if (!invertible) {
    return {
      valid: false,
      invertible: false,
      determinant,
      matrix,
      inverse: null,
      error: 'matrix-not-invertible',
    };
  }

  const inverse = domMatrix2DFromInit([
    matrix.d / determinant,
    -matrix.b / determinant,
    -matrix.c / determinant,
    matrix.a / determinant,
    (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  ]);
  return {
    valid: inverse.valid,
    invertible: inverse.valid,
    determinant,
    matrix,
    inverse,
  };
}

export function canvasBackingStoreReport(cssWidth, cssHeight, devicePixelRatio = 1, options = {}) {
  const widthCss = readNonNegativeNumber(cssWidth, 0);
  const heightCss = readNonNegativeNumber(cssHeight, 0);
  const dpr = readPositiveNumber(devicePixelRatio, 1);
  const pixelWidth = Math.max(0, Math.round(readNumber(options.pixelWidth ?? options.width, cssPixelsToDevicePixels(widthCss, dpr))));
  const pixelHeight = Math.max(0, Math.round(readNumber(options.pixelHeight ?? options.height, cssPixelsToDevicePixels(heightCss, dpr))));
  return {
    cssWidth: widthCss,
    cssHeight: heightCss,
    devicePixelRatio: dpr,
    pixelWidth,
    pixelHeight,
    scaleX: widthCss > 0 ? safeDiv(pixelWidth, widthCss, dpr) : dpr,
    scaleY: heightCss > 0 ? safeDiv(pixelHeight, heightCss, dpr) : dpr,
    areaCssPixels: widthCss * heightCss,
    areaDevicePixels: pixelWidth * pixelHeight,
    valid: Number.isFinite(widthCss) && Number.isFinite(heightCss) && Number.isFinite(dpr),
  };
}

export function domScrollCoordinateReport(point = {}, viewport = {}, options = {}) {
  const visualViewport = viewport.visualViewport || viewport.visual || {};
  const scrollX = readNumber(
    viewport.scrollX ?? viewport.pageXOffset ?? viewport.scrollLeft ?? options.scrollX,
    0
  );
  const scrollY = readNumber(
    viewport.scrollY ?? viewport.pageYOffset ?? viewport.scrollTop ?? options.scrollY,
    0
  );
  const offsetLeft = readNumber(visualViewport.offsetLeft ?? viewport.offsetLeft ?? options.offsetLeft, 0);
  const offsetTop = readNumber(visualViewport.offsetTop ?? viewport.offsetTop ?? options.offsetTop, 0);
  const pageLeft = readNumber(visualViewport.pageLeft ?? viewport.pageLeft, scrollX + offsetLeft);
  const pageTop = readNumber(visualViewport.pageTop ?? viewport.pageTop, scrollY + offsetTop);
  const hasClientX = Number.isFinite(point.clientX ?? point.x);
  const hasClientY = Number.isFinite(point.clientY ?? point.y);
  const hasPageX = Number.isFinite(point.pageX);
  const hasPageY = Number.isFinite(point.pageY);
  const pageX = hasPageX ? readNumber(point.pageX, 0) : readNumber(point.clientX ?? point.x, 0) + scrollX;
  const pageY = hasPageY ? readNumber(point.pageY, 0) : readNumber(point.clientY ?? point.y, 0) + scrollY;
  const clientX = hasClientX ? readNumber(point.clientX ?? point.x, 0) : pageX - scrollX;
  const clientY = hasClientY ? readNumber(point.clientY ?? point.y, 0) : pageY - scrollY;
  return {
    clientX,
    clientY,
    pageX,
    pageY,
    scrollX,
    scrollY,
    visualOffsetLeft: offsetLeft,
    visualOffsetTop: offsetTop,
    visualPageLeft: pageLeft,
    visualPageTop: pageTop,
    visualX: clientX - offsetLeft,
    visualY: clientY - offsetTop,
    layoutViewportX: clientX,
    layoutViewportY: clientY,
    valid: [clientX, clientY, pageX, pageY, scrollX, scrollY, offsetLeft, offsetTop].every(Number.isFinite),
  };
}

export function canvasPointerCssPoint(event = {}, rect = {}, options = {}) {
  const bounds = domRectNormalize(rect);
  const clientX = readNumber(event.clientX ?? event.x, bounds.left);
  const clientY = readNumber(event.clientY ?? event.y, bounds.top);
  const rawX = clientX - bounds.left;
  const rawY = clientY - bounds.top;
  const x = options.clamp === true ? clamp(rawX, 0, bounds.normalizedWidth) : rawX;
  const y = options.clamp === true ? clamp(rawY, 0, bounds.normalizedHeight) : rawY;
  return {
    x,
    y,
    rawX,
    rawY,
    clientX,
    clientY,
    normalizedX: safeDiv(x, bounds.normalizedWidth, 0),
    normalizedY: safeDiv(y, bounds.normalizedHeight, 0),
    inside: rawX >= 0 && rawX <= bounds.normalizedWidth && rawY >= 0 && rawY <= bounds.normalizedHeight,
    rect: bounds,
    valid: bounds.valid && Number.isFinite(clientX) && Number.isFinite(clientY),
  };
}

export function canvasPointerWorldPoint(event = {}, rect = {}, matrixInit = IDENTITY_COLUMN_MAJOR_4, options = {}) {
  const cssPoint = canvasPointerCssPoint(event, rect, options.pointerOptions ?? options);
  const inverseReport = domMatrixInverse2DReport(matrixInit);
  const world = inverseReport.valid
    ? domMatrixTransformPoint({ x: cssPoint.x, y: cssPoint.y, z: 0, w: 1 }, inverseReport.inverse)
    : { x: Number.NaN, y: Number.NaN, z: Number.NaN, w: Number.NaN, valid: false };
  return {
    x: world.x,
    y: world.y,
    z: world.z,
    w: world.w,
    css: cssPoint,
    inverse: inverseReport,
    inside: cssPoint.inside,
    valid: cssPoint.valid && inverseReport.valid && world.valid,
  };
}

export function canvasPointerDevicePoint(event = {}, rect = {}, canvasOrScale = {}, options = {}) {
  const cssPoint = canvasPointerCssPoint(event, rect, options);
  const dpr = typeof canvasOrScale === 'number'
    ? readPositiveNumber(canvasOrScale, 1)
    : readPositiveNumber(canvasOrScale.devicePixelRatio ?? options.devicePixelRatio, 1);
  const backing = typeof canvasOrScale === 'number'
    ? canvasBackingStoreReport(cssPoint.rect.normalizedWidth, cssPoint.rect.normalizedHeight, dpr)
    : canvasBackingStoreReport(cssPoint.rect.normalizedWidth, cssPoint.rect.normalizedHeight, dpr, canvasOrScale);
  return {
    x: cssPoint.x * backing.scaleX,
    y: cssPoint.y * backing.scaleY,
    rawX: cssPoint.rawX * backing.scaleX,
    rawY: cssPoint.rawY * backing.scaleY,
    scaleX: backing.scaleX,
    scaleY: backing.scaleY,
    css: cssPoint,
    backingStore: backing,
    inside: cssPoint.inside,
    valid: cssPoint.valid && backing.valid,
  };
}

export function domGeometryInteropReport(options = {}) {
  const rect = domRectNormalize(options.rect ?? { x: 0, y: 0, width: 0, height: 0 });
  const matrix = columnMajor4ToDomMatrix(domMatrixToColumnMajor4(options.matrix ?? IDENTITY_COLUMN_MAJOR_4));
  const transformedRect = domRectTransformBounds(rect, matrix);
  const backingStore = canvasBackingStoreReport(
    options.cssWidth ?? rect.normalizedWidth,
    options.cssHeight ?? rect.normalizedHeight,
    options.devicePixelRatio ?? options.dpr ?? 1,
    options.canvas ?? {}
  );
  const pointerCss = options.event ? canvasPointerCssPoint(options.event, rect, options.pointerOptions ?? {}) : null;
  const pointerDevice = options.event
    ? canvasPointerDevicePoint(options.event, rect, options.canvas ?? backingStore, options.pointerOptions ?? {})
    : null;
  const scrollCoordinates = options.event
    ? domScrollCoordinateReport(options.event, options.viewport ?? options.visualViewport ?? {}, options.scrollOptions ?? {})
    : null;
  const pointerWorld = options.event
    ? canvasPointerWorldPoint(options.event, rect, options.pointerWorldMatrix ?? options.matrix ?? IDENTITY_COLUMN_MAJOR_4, options.pointerOptions ?? {})
    : null;
  return {
    point2: domPointToVec2(options.point ?? [0, 0]),
    point4: domPointToVec4(options.point ?? [0, 0, 0, 1]),
    rect,
    matrix,
    transformedRect,
    backingStore,
    pointerCss,
    pointerDevice,
    scrollCoordinates,
    pointerWorld,
    valid: rect.valid &&
      matrix.valid &&
      transformedRect.valid &&
      backingStore.valid &&
      (!pointerCss || pointerCss.valid) &&
      (!pointerDevice || pointerDevice.valid) &&
      (!scrollCoordinates || scrollCoordinates.valid) &&
      (!pointerWorld || pointerWorld.valid),
  };
}
