// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathColor.js - Color spaces and conversions
// RGB, HSL, HSV, LAB, LCH, OKLAB, OKLCH, hex, blend modes, gradients, palettes

import { clamp, lerp, fract, mod } from './MathScalar.js';
import { statsMean } from './MathStatistics.js';

// ============================================================================
// RGB UTILITIES
// ============================================================================

export const rgb = (r, g, b) => [r, g, b];
export const rgba = (r, g, b, a = 1) => [r, g, b, a];
export const rgbClone = (c) => [...c];

export const rgbAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const rgbSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const rgbMul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const rgbScale = (c, s) => [c[0] * s, c[1] * s, c[2] * s];
export const rgbLerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const rgbClamp = (c) => [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)];

export const COLOR_LUMA_REC709 = Object.freeze([0.2126, 0.7152, 0.0722]);
export const COLOR_LUMA_REC601 = Object.freeze([0.299, 0.587, 0.114]);
export const COLOR_LUMA_REC2020 = Object.freeze([0.2627, 0.6780, 0.0593]);

export const COLOR_SPACE_METADATA = Object.freeze({
  srgb: Object.freeze({
    id: 'srgb',
    label: 'sRGB',
    cssColorSpace: 'srgb',
    transferFunction: 'srgb',
    whitePoint: Object.freeze({ name: 'D65', x: 0.3127, y: 0.3290 }),
    primaries: Object.freeze({
      red: Object.freeze([0.64, 0.33]),
      green: Object.freeze([0.30, 0.60]),
      blue: Object.freeze([0.15, 0.06]),
    }),
    lumaCoefficients: COLOR_LUMA_REC709,
    hdrCapable: false,
    referenceWhiteNits: 80,
  }),
  'display-p3': Object.freeze({
    id: 'display-p3',
    label: 'Display P3',
    cssColorSpace: 'display-p3',
    transferFunction: 'srgb',
    whitePoint: Object.freeze({ name: 'D65', x: 0.3127, y: 0.3290 }),
    primaries: Object.freeze({
      red: Object.freeze([0.68, 0.32]),
      green: Object.freeze([0.265, 0.69]),
      blue: Object.freeze([0.15, 0.06]),
    }),
    lumaCoefficients: COLOR_LUMA_REC709,
    hdrCapable: false,
    referenceWhiteNits: 80,
  }),
  rec2020: Object.freeze({
    id: 'rec2020',
    label: 'Rec. 2020 / BT.2020',
    cssColorSpace: 'rec2020',
    transferFunction: 'bt2020',
    whitePoint: Object.freeze({ name: 'D65', x: 0.3127, y: 0.3290 }),
    primaries: Object.freeze({
      red: Object.freeze([0.708, 0.292]),
      green: Object.freeze([0.170, 0.797]),
      blue: Object.freeze([0.131, 0.046]),
    }),
    lumaCoefficients: COLOR_LUMA_REC2020,
    hdrCapable: true,
    referenceWhiteNits: 203,
  }),
  'a98-rgb': Object.freeze({
    id: 'a98-rgb',
    label: 'Adobe RGB (1998)',
    cssColorSpace: 'a98-rgb',
    transferFunction: 'gamma-2.2',
    whitePoint: Object.freeze({ name: 'D65', x: 0.3127, y: 0.3290 }),
    primaries: Object.freeze({
      red: Object.freeze([0.64, 0.33]),
      green: Object.freeze([0.21, 0.71]),
      blue: Object.freeze([0.15, 0.06]),
    }),
    lumaCoefficients: Object.freeze([0.297361, 0.627355, 0.075285]),
    hdrCapable: false,
    referenceWhiteNits: 80,
  }),
  'xyz': Object.freeze({
    id: 'xyz',
    label: 'CIE XYZ D65',
    cssColorSpace: 'xyz',
    transferFunction: 'linear',
    whitePoint: Object.freeze({ name: 'D65', x: 0.3127, y: 0.3290 }),
    primaries: null,
    lumaCoefficients: COLOR_LUMA_REC709,
    hdrCapable: true,
    referenceWhiteNits: 80,
  }),
  'xyz-d65': Object.freeze({
    id: 'xyz-d65',
    label: 'CIE XYZ D65',
    cssColorSpace: 'xyz-d65',
    transferFunction: 'linear',
    whitePoint: Object.freeze({ name: 'D65', x: 0.3127, y: 0.3290 }),
    primaries: null,
    lumaCoefficients: COLOR_LUMA_REC709,
    hdrCapable: true,
    referenceWhiteNits: 80,
  }),
  'xyz-d50': Object.freeze({
    id: 'xyz-d50',
    label: 'CIE XYZ D50',
    cssColorSpace: 'xyz-d50',
    transferFunction: 'linear',
    whitePoint: Object.freeze({ name: 'D50', x: 0.3457, y: 0.3585 }),
    primaries: null,
    lumaCoefficients: COLOR_LUMA_REC709,
    hdrCapable: true,
    referenceWhiteNits: 80,
  }),
});

export const CSS_NAMED_COLORS = Object.freeze({
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
});

export const CSS_SYSTEM_COLOR_KEYWORDS = Object.freeze({
  AccentColor: Object.freeze({ name: 'AccentColor', role: 'background', pair: 'AccentColorText', description: 'Background of accented user interface controls.' }),
  AccentColorText: Object.freeze({ name: 'AccentColorText', role: 'foreground', pair: 'AccentColor', description: 'Text of accented user interface controls.' }),
  ActiveText: Object.freeze({ name: 'ActiveText', role: 'foreground', pair: 'Canvas', description: 'Text in active links.' }),
  ButtonBorder: Object.freeze({ name: 'ButtonBorder', role: 'border', pair: 'Canvas', description: 'The base border color for push buttons.' }),
  ButtonFace: Object.freeze({ name: 'ButtonFace', role: 'background', pair: 'ButtonText', description: 'The face background color for push buttons.' }),
  ButtonText: Object.freeze({ name: 'ButtonText', role: 'foreground', pair: 'ButtonFace', description: 'Text on push buttons.' }),
  Canvas: Object.freeze({ name: 'Canvas', role: 'background', pair: 'CanvasText', description: 'Background of application content or documents.' }),
  CanvasText: Object.freeze({ name: 'CanvasText', role: 'foreground', pair: 'Canvas', description: 'Text in application content or documents.' }),
  Field: Object.freeze({ name: 'Field', role: 'background', pair: 'FieldText', description: 'Background of input fields.' }),
  FieldText: Object.freeze({ name: 'FieldText', role: 'foreground', pair: 'Field', description: 'Text in input fields.' }),
  GrayText: Object.freeze({ name: 'GrayText', role: 'foreground', pair: null, description: 'Disabled text.' }),
  Highlight: Object.freeze({ name: 'Highlight', role: 'background', pair: 'HighlightText', description: 'Background of selected text.' }),
  HighlightText: Object.freeze({ name: 'HighlightText', role: 'foreground', pair: 'Highlight', description: 'Text of selected text.' }),
  LinkText: Object.freeze({ name: 'LinkText', role: 'foreground', pair: 'Canvas', description: 'Text in non-active, non-visited links.' }),
  Mark: Object.freeze({ name: 'Mark', role: 'background', pair: 'MarkText', description: 'Background of specially marked text.' }),
  MarkText: Object.freeze({ name: 'MarkText', role: 'foreground', pair: 'Mark', description: 'Text that has been specially marked.' }),
  SelectedItem: Object.freeze({ name: 'SelectedItem', role: 'background', pair: 'SelectedItemText', description: 'Background of selected items.' }),
  SelectedItemText: Object.freeze({ name: 'SelectedItemText', role: 'foreground', pair: 'SelectedItem', description: 'Text of selected items.' }),
  VisitedText: Object.freeze({ name: 'VisitedText', role: 'foreground', pair: 'Canvas', description: 'Text in visited links.' }),
});

export const CSS_DEPRECATED_SYSTEM_COLOR_MAP = Object.freeze({
  activeborder: 'ButtonBorder',
  activecaption: 'Canvas',
  appworkspace: 'Canvas',
  background: 'Canvas',
  buttonhighlight: 'ButtonFace',
  buttonshadow: 'ButtonFace',
  captiontext: 'CanvasText',
  inactiveborder: 'ButtonBorder',
  inactivecaption: 'Canvas',
  inactivecaptiontext: 'GrayText',
  infobackground: 'Canvas',
  infotext: 'CanvasText',
  menu: 'Canvas',
  menutext: 'CanvasText',
  scrollbar: 'Canvas',
  threeddarkshadow: 'ButtonBorder',
  threedface: 'ButtonFace',
  threedhighlight: 'ButtonBorder',
  threedlightshadow: 'ButtonBorder',
  threedshadow: 'ButtonBorder',
  window: 'Canvas',
  windowframe: 'ButtonBorder',
  windowtext: 'CanvasText',
});

const CSS_SYSTEM_COLOR_BY_KEY = Object.freeze(Object.fromEntries(
  Object.entries(CSS_SYSTEM_COLOR_KEYWORDS).map(([name, metadata]) => [name.toLowerCase(), metadata])
));

export const CANVAS_PREDEFINED_COLOR_SPACES = Object.freeze(['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear']);
export const CANVAS_COLOR_TYPES = Object.freeze(['unorm8', 'float16']);
export const CANVAS_IMAGE_DATA_COLOR_SPACES = Object.freeze(['srgb', 'display-p3']);
export const CANVAS_IMAGE_DATA_PIXEL_FORMATS = Object.freeze(['rgba-unorm8', 'rgba-float16']);

const CANVAS_PREDEFINED_COLOR_SPACE_SET = new Set(CANVAS_PREDEFINED_COLOR_SPACES);
const CANVAS_COLOR_TYPE_SET = new Set(CANVAS_COLOR_TYPES);
const CANVAS_IMAGE_DATA_COLOR_SPACE_SET = new Set(CANVAS_IMAGE_DATA_COLOR_SPACES);
const CANVAS_IMAGE_DATA_PIXEL_FORMAT_SET = new Set(CANVAS_IMAGE_DATA_PIXEL_FORMATS);
export const DISPLAY_COLOR_GAMUT_MEDIA_VALUES = Object.freeze(['srgb', 'p3', 'rec2020']);
export const DISPLAY_DYNAMIC_RANGE_MEDIA_VALUES = Object.freeze(['standard', 'high']);
const CANVAS_RENDERING_CONTEXT_2D_DEFAULTS = Object.freeze({
  alpha: true,
  desynchronized: false,
  colorSpace: 'srgb',
  colorType: 'unorm8',
  willReadFrequently: false,
});
const CANVAS_COLOR_TYPE_METADATA = Object.freeze({
  unorm8: Object.freeze({
    colorType: 'unorm8',
    storage: 'normalized-unsigned-8',
    channelBits: 8,
    bytesPerChannel: 1,
    floatingPoint: false,
    normalizedInteger: true,
    supportsExtendedRange: false,
    preferredSerializationBitDepth: 8,
  }),
  float16: Object.freeze({
    colorType: 'float16',
    storage: 'binary16-float',
    channelBits: 16,
    bytesPerChannel: 2,
    floatingPoint: true,
    normalizedInteger: false,
    supportsExtendedRange: true,
    preferredSerializationBitDepth: 16,
  }),
});
const CANVAS_IMAGE_DATA_PIXEL_FORMAT_METADATA = Object.freeze({
  'rgba-unorm8': Object.freeze({
    pixelFormat: 'rgba-unorm8',
    dataConstructor: 'Uint8ClampedArray',
    channelBits: 8,
    bytesPerChannel: 1,
    floatingPoint: false,
    normalizedInteger: true,
    defaultTolerance: 1 / 255,
  }),
  'rgba-float16': Object.freeze({
    pixelFormat: 'rgba-float16',
    dataConstructor: 'Float16Array',
    channelBits: 16,
    bytesPerChannel: 2,
    floatingPoint: true,
    normalizedInteger: false,
    defaultTolerance: 2 / 1024,
  }),
});

function finiteColorChannel(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveColorNumber(value, fallback, name) {
  const number = finiteColorChannel(value, fallback);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function normalizedColorSpaceId(colorSpace = 'srgb') {
  const key = String(colorSpace ?? 'srgb').trim().toLowerCase();
  if (key === 'srgb-linear') return 'srgb';
  if (key === 'bt2020' || key === 'bt.2020' || key === 'rec.2020' || key === 'rec-2020') return 'rec2020';
  if (key === 'p3' || key === 'displayp3' || key === 'display-p3-linear') return 'display-p3';
  if (key === 'adobe-rgb' || key === 'adobergb' || key === 'adobe-rgb-1998') return 'a98-rgb';
  return COLOR_SPACE_METADATA[key] ? key : 'srgb';
}

function finiteRgb(color) {
  return [
    finiteColorChannel(color?.[0]),
    finiteColorChannel(color?.[1]),
    finiteColorChannel(color?.[2]),
  ];
}

export function colorSpaceMetadata(colorSpace = 'srgb') {
  const id = normalizedColorSpaceId(colorSpace);
  return COLOR_SPACE_METADATA[id];
}

export function srgbChannelToLinear(value) {
  const c = finiteColorChannel(value);
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearChannelToSrgb(value) {
  const c = finiteColorChannel(value);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
}

export function srgbToLinearRgb(color) {
  return [
    srgbChannelToLinear(color?.[0]),
    srgbChannelToLinear(color?.[1]),
    srgbChannelToLinear(color?.[2]),
  ];
}

export function linearRgbToSrgb(color) {
  return [
    linearChannelToSrgb(color?.[0]),
    linearChannelToSrgb(color?.[1]),
    linearChannelToSrgb(color?.[2]),
  ];
}

export function linearRgbLuminance(color, coefficients = COLOR_LUMA_REC709) {
  return (
    finiteColorChannel(color?.[0]) * coefficients[0] +
    finiteColorChannel(color?.[1]) * coefficients[1] +
    finiteColorChannel(color?.[2]) * coefficients[2]
  );
}

export function relativeLuminance(color) {
  return linearRgbLuminance(srgbToLinearRgb(rgbClamp([
    finiteColorChannel(color?.[0]),
    finiteColorChannel(color?.[1]),
    finiteColorChannel(color?.[2]),
  ])));
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function rgbToYuv(color) {
  const r = finiteColorChannel(color?.[0]);
  const g = finiteColorChannel(color?.[1]);
  const b = finiteColorChannel(color?.[2]);
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    -0.14713 * r - 0.28886 * g + 0.436 * b,
    0.615 * r - 0.51499 * g - 0.10001 * b,
  ];
}

export function yuvToRgb(color) {
  const y = finiteColorChannel(color?.[0]);
  const u = finiteColorChannel(color?.[1]);
  const v = finiteColorChannel(color?.[2]);
  return [
    y + 1.13983 * v,
    y - 0.39465 * u - 0.58060 * v,
    y + 2.03211 * u,
  ];
}

export function rgbToYCbCr(color) {
  const r = finiteColorChannel(color?.[0]);
  const g = finiteColorChannel(color?.[1]);
  const b = finiteColorChannel(color?.[2]);
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [
    y,
    0.5 + (b - y) / 1.772,
    0.5 + (r - y) / 1.402,
  ];
}

export function yCbCrToRgb(color) {
  const y = finiteColorChannel(color?.[0]);
  const cb = finiteColorChannel(color?.[1]) - 0.5;
  const cr = finiteColorChannel(color?.[2]) - 0.5;
  return [
    y + 1.402 * cr,
    y - 0.344136 * cb - 0.714136 * cr,
    y + 1.772 * cb,
  ];
}

export function toneMapReinhard(color) {
  return [
    finiteColorChannel(color?.[0]) / (1 + finiteColorChannel(color?.[0])),
    finiteColorChannel(color?.[1]) / (1 + finiteColorChannel(color?.[1])),
    finiteColorChannel(color?.[2]) / (1 + finiteColorChannel(color?.[2])),
  ];
}

export function toneMapReinhardExtended(color, whitePoint = 1) {
  const white = Math.max(1e-6, finiteColorChannel(whitePoint, 1));
  const invWhiteSq = 1 / (white * white);
  return [
    finiteColorChannel(color?.[0]) * (1 + finiteColorChannel(color?.[0]) * invWhiteSq) / (1 + finiteColorChannel(color?.[0])),
    finiteColorChannel(color?.[1]) * (1 + finiteColorChannel(color?.[1]) * invWhiteSq) / (1 + finiteColorChannel(color?.[1])),
    finiteColorChannel(color?.[2]) * (1 + finiteColorChannel(color?.[2]) * invWhiteSq) / (1 + finiteColorChannel(color?.[2])),
  ];
}

export function toneMapACES(color) {
  const map = (value) => {
    const x = finiteColorChannel(value);
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
  };
  return [map(color?.[0]), map(color?.[1]), map(color?.[2])];
}

export function colorExposure(color, exposure = 1) {
  const scale = 2 ** finiteColorChannel(exposure, 0);
  return [
    finiteColorChannel(color?.[0]) * scale,
    finiteColorChannel(color?.[1]) * scale,
    finiteColorChannel(color?.[2]) * scale,
  ];
}

export function colorContrastAdjust(color, amount = 1, pivot = 0.5) {
  const contrast = finiteColorChannel(amount, 1);
  const center = finiteColorChannel(pivot, 0.5);
  return [
    (finiteColorChannel(color?.[0]) - center) * contrast + center,
    (finiteColorChannel(color?.[1]) - center) * contrast + center,
    (finiteColorChannel(color?.[2]) - center) * contrast + center,
  ];
}

export function colorSaturationAdjust(color, amount = 1, coefficients = COLOR_LUMA_REC709) {
  const saturation = finiteColorChannel(amount, 1);
  const luminance = linearRgbLuminance(color, coefficients);
  return [
    luminance + (finiteColorChannel(color?.[0]) - luminance) * saturation,
    luminance + (finiteColorChannel(color?.[1]) - luminance) * saturation,
    luminance + (finiteColorChannel(color?.[2]) - luminance) * saturation,
  ];
}

export function colorGamutReport(color, options = {}) {
  const values = finiteRgb(color);
  const colorSpace = colorSpaceMetadata(options.colorSpace ?? options.space ?? 'srgb');
  const min = finiteColorChannel(options.min, 0);
  const max = finiteColorChannel(options.max, 1);
  const clipped = values.map((value) => clamp(value, min, max));
  let underRangeCount = 0;
  let overRangeCount = 0;
  let maxOvershoot = 0;
  let clipDistanceSquared = 0;
  const channels = values.map((value, index) => {
    const under = value < min;
    const over = value > max;
    if (under) underRangeCount++;
    if (over) overRangeCount++;
    const delta = clipped[index] - value;
    const overshoot = under ? min - value : (over ? value - max : 0);
    maxOvershoot = Math.max(maxOvershoot, overshoot);
    clipDistanceSquared += delta * delta;
    return {
      index,
      value,
      clipped: clipped[index],
      delta,
      inRange: !under && !over,
      under,
      over,
      overshoot,
    };
  });
  const outOfGamutChannelCount = underRangeCount + overRangeCount;

  return {
    valid: outOfGamutChannelCount === 0,
    colorSpace: colorSpace.id,
    colorSpaceMetadata: colorSpace,
    min,
    max,
    values,
    clipped,
    channels,
    inGamut: outOfGamutChannelCount === 0,
    outOfGamut: outOfGamutChannelCount > 0,
    underRangeCount,
    overRangeCount,
    outOfGamutChannelCount,
    maxOvershoot,
    clipDistance: Math.sqrt(clipDistanceSquared),
  };
}

export function colorHdrMetadataReport(options = {}) {
  const colorSpace = colorSpaceMetadata(options.colorSpace ?? options.space ?? 'rec2020');
  const referenceWhiteNits = positiveColorNumber(options.referenceWhiteNits ?? colorSpace.referenceWhiteNits ?? 100, 100, 'referenceWhiteNits');
  const peakNits = positiveColorNumber(options.peakNits ?? options.maxNits ?? referenceWhiteNits, referenceWhiteNits, 'peakNits');
  const blackLevelNits = Math.max(0, finiteColorChannel(options.blackLevelNits ?? options.minNits, 0));
  const contentMaxNits = positiveColorNumber(options.contentMaxNits ?? peakNits, peakNits, 'contentMaxNits');
  const maxFrameAverageNits = positiveColorNumber(options.maxFrameAverageNits ?? Math.min(contentMaxNits, referenceWhiteNits), referenceWhiteNits, 'maxFrameAverageNits');
  const headroomStops = Math.log2(Math.max(peakNits, referenceWhiteNits) / referenceWhiteNits);
  const dynamicRangeRatio = blackLevelNits > 0 ? peakNits / blackLevelNits : Infinity;
  const eotf = options.eotf ?? (peakNits > referenceWhiteNits ? 'pq-or-hlg' : 'sdr');

  return {
    colorSpace: colorSpace.id,
    colorSpaceMetadata: colorSpace,
    eotf,
    referenceWhiteNits,
    peakNits,
    blackLevelNits,
    contentMaxNits,
    maxFrameAverageNits,
    headroomStops,
    dynamicRangeRatio,
    hdr: peakNits > referenceWhiteNits || colorSpace.hdrCapable,
    sdrCompatible: peakNits <= referenceWhiteNits && !colorSpace.hdrCapable,
  };
}

export function colorDisplayTransformReport(color, options = {}) {
  const inputEncoding = options.inputEncoding ?? 'srgb';
  const outputEncoding = options.outputEncoding ?? 'srgb';
  const targetColorSpace = colorSpaceMetadata(options.targetColorSpace ?? options.colorSpace ?? 'srgb');
  const exposure = finiteColorChannel(options.exposure ?? options.exposureEv, 0);
  const toneMap = options.toneMap ?? 'none';
  const input = finiteRgb(color);
  const workingLinear = inputEncoding === 'srgb' ? srgbToLinearRgb(input) : input.slice();
  const exposedLinear = colorExposure(workingLinear, exposure);
  let toneMappedLinear;
  if (toneMap === 'reinhard') {
    toneMappedLinear = toneMapReinhard(exposedLinear);
  } else if (toneMap === 'extended-reinhard') {
    toneMappedLinear = toneMapReinhardExtended(exposedLinear, options.whitePoint ?? options.toneMapWhitePoint ?? 1);
  } else if (toneMap === 'aces') {
    toneMappedLinear = toneMapACES(exposedLinear);
  } else {
    toneMappedLinear = exposedLinear.slice();
  }
  const encodedOutput = outputEncoding === 'srgb' ? linearRgbToSrgb(toneMappedLinear) : toneMappedLinear.slice();
  const gamut = colorGamutReport(encodedOutput, {
    colorSpace: targetColorSpace.id,
    min: options.outputMin ?? 0,
    max: options.outputMax ?? 1,
  });
  const hdr = colorHdrMetadataReport({
    colorSpace: targetColorSpace.id,
    referenceWhiteNits: options.referenceWhiteNits ?? targetColorSpace.referenceWhiteNits,
    peakNits: options.peakNits ?? options.maxNits ?? targetColorSpace.referenceWhiteNits,
    blackLevelNits: options.blackLevelNits ?? 0,
    eotf: options.eotf,
  });

  return {
    input,
    inputEncoding,
    workingLinear,
    exposure,
    exposedLinear,
    toneMap,
    toneMappedLinear,
    outputEncoding,
    targetColorSpace: targetColorSpace.id,
    targetColorSpaceMetadata: targetColorSpace,
    encodedOutput,
    output: gamut.clipped,
    gamut,
    hdr,
    clipped: gamut.outOfGamut,
  };
}

function displayMediaBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'matches')) {
    return Boolean(value.matches);
  }
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === 'yes' || text === '1' || text === 'match' || text === 'matches') return true;
  if (text === 'false' || text === 'no' || text === '0' || text === 'none' || text === 'no-match') return false;
  return null;
}

function displayMediaRawValue(observed, nested, mediaKey, value) {
  const keys = [value, `(${mediaKey}: ${value})`, `${mediaKey}: ${value}`, `${mediaKey}:${value}`];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(nested, key)) return nested[key];
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(observed, key)) return observed[key];
  }
  return undefined;
}

function displayMediaFeatureReport(observed, camelKey, mediaKey, values) {
  const nestedSource = observed[camelKey] ?? observed[mediaKey] ?? {};
  const nested = nestedSource && typeof nestedSource === 'object' ? nestedSource : {};
  const mediaQueries = {};
  const queries = {};
  const matched = [];
  const missing = [];
  const invalid = [];
  let providedCount = 0;

  for (const value of values) {
    const raw = displayMediaRawValue(observed, nested, mediaKey, value);
    const parsed = displayMediaBoolean(raw);
    mediaQueries[value] = `(${mediaKey}: ${value})`;
    queries[value] = parsed;
    if (raw !== undefined && raw !== null && raw !== '') providedCount++;
    if (parsed === true) matched.push(value);
    if (parsed === null) {
      if (raw === undefined || raw === null || raw === '') {
        missing.push(value);
      } else {
        invalid.push({ value, raw: String(raw) });
      }
    }
  }

  let best = null;
  for (const value of values) {
    if (queries[value] === true) best = value;
  }

  return {
    feature: mediaKey,
    mediaQueries,
    queries,
    matched,
    best,
    providedCount,
    matchedCount: matched.length,
    missing,
    invalid,
    valid: invalid.length === 0,
  };
}

export function colorDisplayCapabilityReport(observed = {}, options = {}) {
  const source = observed && typeof observed === 'object' ? observed : {};
  const colorGamut = displayMediaFeatureReport(source, 'colorGamut', 'color-gamut', DISPLAY_COLOR_GAMUT_MEDIA_VALUES);
  const dynamicRange = displayMediaFeatureReport(source, 'dynamicRange', 'dynamic-range', DISPLAY_DYNAMIC_RANGE_MEDIA_VALUES);
  const videoColorGamut = displayMediaFeatureReport(source, 'videoColorGamut', 'video-color-gamut', DISPLAY_COLOR_GAMUT_MEDIA_VALUES);
  const videoDynamicRange = displayMediaFeatureReport(source, 'videoDynamicRange', 'video-dynamic-range', DISPLAY_DYNAMIC_RANGE_MEDIA_VALUES);
  const features = [colorGamut, dynamicRange, videoColorGamut, videoDynamicRange];
  const invalid = features.flatMap((feature) => feature.invalid.map((entry) => ({
    feature: feature.feature,
    value: entry.value,
    raw: entry.raw,
  })));
  const errors = invalid.map((entry) => `Invalid ${entry.feature} media query observation for ${entry.value}: ${entry.raw}`);
  const providedCount = features.reduce((sum, feature) => sum + feature.providedCount, 0);
  const displayWideGamut = colorGamut.best === 'p3' || colorGamut.best === 'rec2020';
  const videoWideGamut = videoColorGamut.best === 'p3' || videoColorGamut.best === 'rec2020';
  const displayHighDynamicRange = dynamicRange.queries.high === true;
  const videoHighDynamicRange = videoDynamicRange.queries.high === true;
  const warnings = [];
  if (providedCount === 0) warnings.push('No display media query observations were supplied');

  return {
    valid: errors.length === 0,
    source: options.source ?? source.source ?? 'caller-provided-display-media-queries',
    mediaQueryBased: true,
    errors,
    warnings,
    invalid,
    providedCount,
    featureCount: features.length,
    colorGamut,
    dynamicRange,
    videoColorGamut,
    videoDynamicRange,
    displayWideGamut,
    videoWideGamut,
    wideGamutCandidate: displayWideGamut || videoWideGamut,
    displayHighDynamicRange,
    videoHighDynamicRange,
    hdrPresentationCandidate: displayHighDynamicRange || videoHighDynamicRange,
    hdrPresentationConfirmed: false,
    displayOutputEvidence: providedCount > 0 ? 'caller-provided-matchMedia-observations' : 'none',
    physicalDisplayOutputProven: false,
    deviceOutputProven: false,
    outputConversion: 'media-query-capability-observations-do-not-prove-physical-display-output',
  };
}

function normalizeCanvasSettingToken(value, fallback) {
  const token = String(value ?? fallback).trim().toLowerCase();
  return token || fallback;
}

function canvasBooleanSetting(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}

function canvasBaseColorSpace(colorSpace) {
  return colorSpace.startsWith('display-p3') ? 'display-p3' : 'srgb';
}

function canvasReadbackColorSpaceToken(value, fallback = 'srgb') {
  const token = String(value ?? fallback).trim().toLowerCase();
  if (token === 'p3' || token === 'displayp3') return 'display-p3';
  return token || fallback;
}

function canvasReadbackPixelFormatToken(value, fallback = 'rgba-unorm8') {
  const token = String(value ?? fallback).trim().toLowerCase();
  if (token === 'unorm8') return 'rgba-unorm8';
  if (token === 'float16') return 'rgba-float16';
  return token || fallback;
}

function canvasPixelFormatForColorType(colorType) {
  return colorType === 'float16' ? 'rgba-float16' : 'rgba-unorm8';
}

function rgbaFromArrayLike(values, fallbackAlpha = 1) {
  return [
    finiteColorChannel(values?.[0]),
    finiteColorChannel(values?.[1]),
    finiteColorChannel(values?.[2]),
    finiteColorChannel(values?.[3], fallbackAlpha),
  ];
}

function canvasReadbackDataConstructor(data) {
  return data?.constructor?.name ?? null;
}

function canvasObservedPixel(data, pixelFormat, options = {}) {
  const source = data && typeof data.length === 'number' ? data : null;
  const errors = [];
  if (!source) {
    return { valid: false, errors: ['Canvas readback data is missing or not array-like'], raw: null, rgba: null };
  }
  const pixelIndex = Math.max(0, Math.floor(finiteColorChannel(options.pixelIndex, 0)));
  const offset = pixelIndex * 4;
  if (source.length < offset + 4) {
    return { valid: false, errors: [`Canvas readback data does not contain RGBA pixel ${pixelIndex}`], raw: null, rgba: null };
  }
  const raw = [
    finiteColorChannel(source[offset]),
    finiteColorChannel(source[offset + 1]),
    finiteColorChannel(source[offset + 2]),
    finiteColorChannel(source[offset + 3]),
  ];
  const normalizedInput = Boolean(options.normalized);
  const scale = pixelFormat === 'rgba-unorm8' && !normalizedInput ? 1 / 255 : 1;
  const rgbaValue = [
    raw[0] * scale,
    raw[1] * scale,
    raw[2] * scale,
    raw[3] * scale,
  ];
  return {
    valid: true,
    errors,
    pixelIndex,
    offset,
    raw,
    rgba: rgbaValue,
    normalized: true,
  };
}

function canvasObservedAttributesReport(effective, observedAttributes) {
  if (!effective || !observedAttributes || typeof observedAttributes !== 'object') {
    return { provided: false, attributes: null, mismatches: [], matches: null };
  }
  const comparisons = Object.freeze({
    alpha: (value) => Boolean(value),
    desynchronized: (value) => Boolean(value),
    colorSpace: (value) => normalizeCanvasSettingToken(value, effective.colorSpace),
    colorType: (value) => normalizeCanvasSettingToken(value, effective.colorType),
    willReadFrequently: (value) => Boolean(value),
  });
  const attributes = {};
  const mismatches = [];
  for (const [key, normalizeValue] of Object.entries(comparisons)) {
    if (!Object.prototype.hasOwnProperty.call(observedAttributes, key)) continue;
    const actual = normalizeValue(observedAttributes[key]);
    attributes[key] = actual;
    if (actual !== effective[key]) {
      mismatches.push({ key, expected: effective[key], actual });
    }
  }
  return {
    provided: true,
    attributes,
    mismatches,
    matches: mismatches.length === 0,
  };
}

export function canvasColorSettingsReport(settings = {}, observedAttributes = null) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const observed = observedAttributes ?? source.observedAttributes ?? source.observed ?? null;
  const requested = {
    alpha: source.alpha,
    desynchronized: source.desynchronized,
    colorSpace: source.colorSpace,
    colorType: source.colorType,
    willReadFrequently: source.willReadFrequently,
  };
  const alpha = canvasBooleanSetting(source.alpha, CANVAS_RENDERING_CONTEXT_2D_DEFAULTS.alpha);
  const desynchronized = canvasBooleanSetting(source.desynchronized, CANVAS_RENDERING_CONTEXT_2D_DEFAULTS.desynchronized);
  const colorSpace = normalizeCanvasSettingToken(source.colorSpace, CANVAS_RENDERING_CONTEXT_2D_DEFAULTS.colorSpace);
  const colorType = normalizeCanvasSettingToken(source.colorType, CANVAS_RENDERING_CONTEXT_2D_DEFAULTS.colorType);
  const willReadFrequently = canvasBooleanSetting(source.willReadFrequently, CANVAS_RENDERING_CONTEXT_2D_DEFAULTS.willReadFrequently);
  const colorSpaceValid = CANVAS_PREDEFINED_COLOR_SPACE_SET.has(colorSpace);
  const colorTypeValid = CANVAS_COLOR_TYPE_SET.has(colorType);
  const errors = [];
  if (!colorSpaceValid) errors.push(`Unsupported canvas colorSpace: ${colorSpace}`);
  if (!colorTypeValid) errors.push(`Unsupported canvas colorType: ${colorType}`);
  const valid = errors.length === 0;
  const baseColorSpace = colorSpaceValid ? canvasBaseColorSpace(colorSpace) : null;
  const colorSpaceMetadataReport = baseColorSpace ? colorSpaceMetadata(baseColorSpace) : null;
  const linear = colorSpaceValid && colorSpace.endsWith('-linear');
  const effective = valid
    ? { alpha, desynchronized, colorSpace, colorType, willReadFrequently }
    : null;
  const observedReport = canvasObservedAttributesReport(effective, observed);

  return {
    valid,
    errors,
    wouldThrow: !valid,
    defaults: CANVAS_RENDERING_CONTEXT_2D_DEFAULTS,
    requested,
    effective,
    alpha,
    desynchronized,
    colorSpace: colorSpaceValid ? colorSpace : null,
    colorType: colorTypeValid ? colorType : null,
    willReadFrequently,
    colorSpaceReport: colorSpaceValid ? {
      colorSpace,
      baseColorSpace,
      cssColorSpace: colorSpace,
      linear,
      transferFunction: linear ? 'linear' : colorSpaceMetadataReport.transferFunction,
      whitePoint: colorSpaceMetadataReport.whitePoint,
      colorSpaceMetadata: colorSpaceMetadataReport,
    } : null,
    colorTypeReport: colorTypeValid ? CANVAS_COLOR_TYPE_METADATA[colorType] : null,
    premultipliedAlphaBitmap: true,
    initialBitmapColor: alpha ? [0, 0, 0, 0] : [0, 0, 0, 1],
    getContextAttributes: effective,
    observed: observedReport,
    observedMatches: observedReport.matches,
    compatible: valid && observedReport.matches !== false,
    outputConversion: 'browser-converts-canvas-backing-store-to-output-device-color-space',
  };
}

export function canvasPixelReadbackReport(settings = {}, observedReadback = {}, options = {}) {
  const readbackSource = observedReadback && typeof observedReadback === 'object' ? observedReadback : {};
  const imageData = readbackSource.imageData && typeof readbackSource.imageData === 'object'
    ? readbackSource.imageData
    : readbackSource;
  const observedAttributes = options.observedAttributes
    ?? readbackSource.attributes
    ?? readbackSource.observedAttributes
    ?? settings?.observedAttributes
    ?? null;
  const settingsReport = canvasColorSettingsReport(settings, observedAttributes);
  const readbackSettings = options.readbackSettings
    ?? readbackSource.readbackSettings
    ?? readbackSource.settings
    ?? {};
  const requestedColorSpace = canvasReadbackColorSpaceToken(
    readbackSettings.colorSpace
      ?? options.colorSpace
      ?? imageData.colorSpace
      ?? settingsReport.colorSpaceReport?.baseColorSpace
      ?? 'srgb'
  );
  const requestedPixelFormat = canvasReadbackPixelFormatToken(
    readbackSettings.pixelFormat
      ?? options.pixelFormat
      ?? imageData.pixelFormat
      ?? canvasPixelFormatForColorType(settingsReport.colorType)
  );
  const observedColorSpace = canvasReadbackColorSpaceToken(
    imageData.colorSpace
      ?? readbackSource.colorSpace
      ?? requestedColorSpace,
    requestedColorSpace
  );
  const observedPixelFormat = canvasReadbackPixelFormatToken(
    imageData.pixelFormat
      ?? readbackSource.pixelFormat
      ?? requestedPixelFormat,
    requestedPixelFormat
  );
  const colorSpaceValid = CANVAS_IMAGE_DATA_COLOR_SPACE_SET.has(requestedColorSpace);
  const pixelFormatValid = CANVAS_IMAGE_DATA_PIXEL_FORMAT_SET.has(requestedPixelFormat);
  const observedColorSpaceValid = CANVAS_IMAGE_DATA_COLOR_SPACE_SET.has(observedColorSpace);
  const observedPixelFormatValid = CANVAS_IMAGE_DATA_PIXEL_FORMAT_SET.has(observedPixelFormat);
  const data = imageData.data ?? readbackSource.data ?? null;
  const expectedRgba = options.expectedRgba ?? readbackSource.expectedRgba ?? null;
  const hasExpected = expectedRgba && typeof expectedRgba.length === 'number';
  const expected = hasExpected ? rgbaFromArrayLike(expectedRgba) : null;
  const sourceError = readbackSource.error ?? readbackSource.exception ?? null;
  const sourceErrorName = sourceError && typeof sourceError === 'object' ? (sourceError.name ?? 'Error') : null;
  const sourceErrorText = sourceError && typeof sourceError === 'object' ? (sourceError.message ?? 'canvas readback failed') : null;
  const sourceErrorMessage = sourceError
    ? (typeof sourceError === 'string' ? sourceError : `${sourceErrorName}: ${sourceErrorText}`)
    : null;
  const errors = [];
  const warnings = [];
  if (sourceErrorMessage) errors.push(sourceErrorMessage);
  if (!colorSpaceValid) errors.push(`Unsupported ImageData colorSpace: ${requestedColorSpace}`);
  if (!pixelFormatValid) errors.push(`Unsupported ImageData pixelFormat: ${requestedPixelFormat}`);
  if (!observedColorSpaceValid) errors.push(`Unsupported observed ImageData colorSpace: ${observedColorSpace}`);
  if (!observedPixelFormatValid) errors.push(`Unsupported observed ImageData pixelFormat: ${observedPixelFormat}`);
  if (observedColorSpaceValid && colorSpaceValid && observedColorSpace !== requestedColorSpace) {
    warnings.push(`Observed ImageData colorSpace ${observedColorSpace} differs from requested ${requestedColorSpace}`);
  }
  if (observedPixelFormatValid && pixelFormatValid && observedPixelFormat !== requestedPixelFormat) {
    warnings.push(`Observed ImageData pixelFormat ${observedPixelFormat} differs from requested ${requestedPixelFormat}`);
  }
  const pixel = canvasObservedPixel(data, observedPixelFormat, {
    pixelIndex: options.pixelIndex ?? readbackSource.pixelIndex,
    normalized: options.observedNormalized ?? readbackSource.normalized,
  });
  errors.push(...pixel.errors);
  const formatMetadata = observedPixelFormatValid ? CANVAS_IMAGE_DATA_PIXEL_FORMAT_METADATA[observedPixelFormat] : null;
  const tolerance = Math.max(0, finiteColorChannel(options.tolerance ?? readbackSource.tolerance ?? formatMetadata?.defaultTolerance, formatMetadata?.defaultTolerance ?? 0));
  const deltaRgba = pixel.valid && expected ? pixel.rgba.map((value, index) => value - expected[index]) : null;
  const absDeltaRgba = deltaRgba ? deltaRgba.map((value) => Math.abs(value)) : null;
  const maxAbsDelta = absDeltaRgba ? Math.max(...absDeltaRgba) : null;
  const pixelMatches = expected ? maxAbsDelta <= tolerance : null;
  const readbackProvided = pixel.valid && !sourceErrorMessage;
  const compatible = settingsReport.compatible !== false && observedColorSpace === requestedColorSpace && observedPixelFormat === requestedPixelFormat;
  const valid = settingsReport.valid && errors.length === 0 && compatible && pixelMatches !== false;

  return {
    valid,
    source: options.source ?? readbackSource.source ?? 'caller-provided-canvas-readback',
    sourceErrorName,
    sourceErrorMessage,
    errors,
    warnings,
    settingsReport,
    readbackSettings: {
      colorSpace: requestedColorSpace,
      pixelFormat: requestedPixelFormat,
    },
    requestedColorSpace,
    requestedPixelFormat,
    observedColorSpace,
    observedPixelFormat,
    colorSpaceValid,
    pixelFormatValid,
    observedColorSpaceValid,
    observedPixelFormatValid,
    compatible,
    readbackProvided,
    readbackSupported: readbackProvided,
    width: Math.max(0, Math.floor(finiteColorChannel(imageData.width ?? readbackSource.width, 0))),
    height: Math.max(0, Math.floor(finiteColorChannel(imageData.height ?? readbackSource.height, 0))),
    dataConstructor: canvasReadbackDataConstructor(data),
    pixelFormatReport: formatMetadata,
    pixelIndex: pixel.pixelIndex ?? Math.max(0, Math.floor(finiteColorChannel(options.pixelIndex ?? readbackSource.pixelIndex, 0))),
    observedRawRgba: pixel.raw,
    observedRgba: pixel.rgba,
    expectedRgba: expected,
    deltaRgba,
    absDeltaRgba,
    maxAbsDelta,
    tolerance,
    pixelMatches,
    getImageData: {
      colorSpace: requestedColorSpace,
      pixelFormat: requestedPixelFormat,
      convertsToRequestedImageDataSpace: true,
      transformationIndependent: true,
    },
    deviceOutputProven: false,
    outputConversion: 'getImageData-readback-proves-backing-store-pixels-not-display-device-output',
  };
}

function canvasCapabilityCaseUnsupported(report) {
  if (report.valid) return false;
  if (report.sourceErrorMessage) return true;
  if (!report.compatible) return true;
  return report.errors.some((message) => String(message).toLowerCase().includes('unsupported'));
}

export function canvasPixelReadbackCapabilityReport(cases = [], options = {}) {
  const caseList = Array.isArray(cases)
    ? cases
    : (Array.isArray(cases?.cases) ? cases.cases : []);
  const defaultRequired = Boolean(options.required);
  const reports = caseList.map((entry = {}, index) => {
    const readbackSettings = entry.readbackSettings
      ?? entry.readback?.readbackSettings
      ?? entry.observedReadback?.readbackSettings
      ?? {
        colorSpace: entry.colorSpace,
        pixelFormat: entry.pixelFormat,
      };
    const settings = entry.settings
      ?? entry.contextSettings
      ?? {
        colorSpace: entry.contextColorSpace ?? entry.colorSpace ?? readbackSettings.colorSpace,
        colorType: entry.colorType,
      };
    const observedReadback = entry.observedReadback ?? entry.readback ?? entry;
    const required = entry.required === undefined ? defaultRequired : Boolean(entry.required);
    const label = entry.label
      ?? `${readbackSettings.colorSpace ?? observedReadback.colorSpace ?? 'srgb'}|${readbackSettings.pixelFormat ?? observedReadback.pixelFormat ?? 'rgba-unorm8'}`;
    const report = canvasPixelReadbackReport(settings, observedReadback, {
      ...options,
      ...(entry.options ?? {}),
      source: entry.source ?? options.source ?? 'canvas-readback-capability-case',
      readbackSettings,
      expectedRgba: entry.expectedRgba ?? options.expectedRgba,
      tolerance: entry.tolerance ?? options.tolerance,
      pixelIndex: entry.pixelIndex ?? options.pixelIndex,
    });
    const optionalUnsupported = !required && canvasCapabilityCaseUnsupported(report);
    const status = report.valid ? 'supported' : (optionalUnsupported ? 'unsupported' : 'failed');
    return {
      index,
      label,
      required,
      status,
      supported: status === 'supported',
      unsupported: status === 'unsupported',
      failed: status === 'failed',
      settings,
      readbackSettings: report.readbackSettings,
      observedColorSpace: report.observedColorSpace,
      observedPixelFormat: report.observedPixelFormat,
      readbackProvided: report.readbackProvided,
      pixelMatches: report.pixelMatches,
      maxAbsDelta: report.maxAbsDelta,
      errors: report.errors,
      warnings: report.warnings,
      report,
    };
  });
  const supported = reports.filter((entry) => entry.supported);
  const unsupported = reports.filter((entry) => entry.unsupported);
  const failed = reports.filter((entry) => entry.failed);
  const requiredReports = reports.filter((entry) => entry.required);
  const requiredFailed = requiredReports.filter((entry) => !entry.supported);

  return {
    valid: reports.length > 0 && failed.length === 0 && requiredFailed.length === 0,
    source: options.source ?? 'canvas-readback-capability-matrix',
    requestedCount: reports.length,
    supportedCount: supported.length,
    unsupportedCount: unsupported.length,
    failedCount: failed.length,
    requiredCount: requiredReports.length,
    requiredSupportedCount: requiredReports.length - requiredFailed.length,
    requiredFailedCount: requiredFailed.length,
    matrixComplete: reports.length > 0 && unsupported.length === 0 && failed.length === 0,
    reports,
    supported,
    unsupported,
    failed,
    requiredFailed,
    deviceOutputProven: false,
    outputConversion: 'canvas-readback-capability-proves-browser-ImageData-support-not-display-device-output',
  };
}

function canvasPrecisionMetricsFromDelta(absDeltaRgba) {
  if (!Array.isArray(absDeltaRgba) || absDeltaRgba.length === 0) {
    return { channelCount: 0, maxAbsDelta: null, meanAbsDelta: null, rmsError: null };
  }
  let sum = 0;
  let sumSquares = 0;
  let maxAbsDelta = 0;
  for (const value of absDeltaRgba) {
    const finite = finiteColorChannel(value);
    sum += finite;
    sumSquares += finite * finite;
    maxAbsDelta = Math.max(maxAbsDelta, finite);
  }
  return {
    channelCount: absDeltaRgba.length,
    maxAbsDelta,
    meanAbsDelta: sum / absDeltaRgba.length,
    rmsError: Math.sqrt(sumSquares / absDeltaRgba.length),
  };
}

export function canvasPixelReadbackPrecisionReport(cases = [], options = {}) {
  const capability = canvasPixelReadbackCapabilityReport(cases, options);
  const unsupported = capability.unsupported.map((entry) => ({
    index: entry.index,
    label: entry.label,
    status: 'unsupported',
    required: entry.required,
    reason: entry.report.sourceErrorMessage ?? entry.errors[0] ?? 'optional readback capability unsupported',
    report: entry.report,
  }));
  const evaluated = [];
  const notEvaluated = [];

  for (const entry of capability.supported) {
    const report = entry.report;
    if (!Array.isArray(report.expectedRgba) || !Array.isArray(report.absDeltaRgba)) {
      notEvaluated.push({
        index: entry.index,
        label: entry.label,
        status: entry.required ? 'missing-required-expected-rgba' : 'missing-expected-rgba',
        required: entry.required,
        report,
      });
      continue;
    }
    const metrics = canvasPrecisionMetricsFromDelta(report.absDeltaRgba);
    evaluated.push({
      index: entry.index,
      label: entry.label,
      status: report.pixelMatches ? 'precision-pass' : 'precision-fail',
      required: entry.required,
      requestedColorSpace: report.requestedColorSpace,
      requestedPixelFormat: report.requestedPixelFormat,
      observedColorSpace: report.observedColorSpace,
      observedPixelFormat: report.observedPixelFormat,
      expectedRgba: report.expectedRgba,
      observedRgba: report.observedRgba,
      absDeltaRgba: report.absDeltaRgba,
      tolerance: report.tolerance,
      pixelMatches: report.pixelMatches,
      ...metrics,
      report,
    });
  }

  const precisionFailed = evaluated.filter((entry) => entry.pixelMatches === false);
  const requiredMissing = notEvaluated.filter((entry) => entry.required);
  const requiredPrecisionFailed = precisionFailed.filter((entry) => entry.required);
  const maxAbsDelta = evaluated.length ? Math.max(...evaluated.map((entry) => entry.maxAbsDelta)) : null;
  const meanAbsDelta = evaluated.length
    ? statsMean(evaluated.map((entry) => entry.meanAbsDelta))
    : null;
  const rmsError = evaluated.length
    ? Math.sqrt(statsMean(evaluated.map((entry) => entry.rmsError * entry.rmsError)))
    : null;

  return {
    valid: capability.valid && precisionFailed.length === 0 && requiredMissing.length === 0,
    source: options.source ?? 'canvas-readback-precision-matrix',
    capability,
    requestedCount: capability.requestedCount,
    evaluatedCount: evaluated.length,
    notEvaluatedCount: notEvaluated.length,
    unsupportedCount: unsupported.length,
    precisionPassedCount: evaluated.length - precisionFailed.length,
    precisionFailedCount: precisionFailed.length,
    requiredPrecisionFailedCount: requiredPrecisionFailed.length,
    requiredMissingCount: requiredMissing.length,
    maxAbsDelta,
    meanAbsDelta,
    rmsError,
    evaluated,
    notEvaluated,
    unsupported,
    precisionFailed,
    requiredPrecisionFailed,
    requiredMissing,
    deviceOutputProven: false,
    outputConversion: 'canvas-readback-precision-proves-returned-ImageData-pixels-not-display-device-output',
  };
}

function cssColorError(input, syntax, message, details = {}) {
  return {
    valid: false,
    source: String(input ?? ''),
    syntax,
    colorSpace: 'srgb',
    rgb: [0, 0, 0],
    alpha: 1,
    rgba: [0, 0, 0, 1],
    components: [],
    missingComponents: [],
    gamut: colorGamutReport([0, 0, 0], { colorSpace: 'srgb' }),
    errors: [message],
    warnings: [],
    ...details,
  };
}

function cssSplitFunctionArgs(content) {
  return String(content ?? '')
    .trim()
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s*,\s*/g, ',')
    .split(/\s+/)
    .filter(Boolean);
}

function cssSplitLegacyArgs(content) {
  return String(content ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function cssFunctionParts(value) {
  const match = /^([a-z][a-z0-9-]*)\((.*)\)$/i.exec(value.trim());
  return match ? { name: match[1].toLowerCase(), body: match[2].trim() } : null;
}

function cssSplitTopLevelCommaArgs(content) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const text = String(content ?? '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function cssHasTopLevelComma(content) {
  let depth = 0;
  const text = String(content ?? '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      return true;
    }
  }
  return false;
}

function cssSplitTopLevelSpaceArgs(content) {
  const tokens = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    const token = current.trim();
    if (token) tokens.push(token);
    current = '';
  };
  const text = String(content ?? '').trim();
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === '/' && depth === 0) {
      flush();
      tokens.push('/');
    } else if (/\s/.test(char) && depth === 0) {
      flush();
    } else {
      current += char;
    }
  }
  flush();
  return tokens;
}

function cssNumericToken(token) {
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(%|deg|grad|rad|turn)?$/i.exec(String(token ?? '').trim());
  if (!match) return null;
  return {
    value: Number(match[1]),
    unit: (match[2] ?? '').toLowerCase(),
  };
}

function cssComponent(token, {
  percentageScale = 1,
  numberScale = 1,
  fallback = 0,
  clampMin = -Infinity,
  clampMax = Infinity,
  name = 'component',
} = {}) {
  const text = String(token ?? '').trim().toLowerCase();
  if (text === 'none') {
    return { value: fallback, raw: token, missing: true, valid: true, name };
  }
  const parsed = cssNumericToken(text);
  if (!parsed || !Number.isFinite(parsed.value)) {
    return { value: fallback, raw: token, missing: false, valid: false, name };
  }
  const scale = parsed.unit === '%' ? percentageScale : numberScale;
  return {
    value: clamp(parsed.value * scale, clampMin, clampMax),
    raw: token,
    unit: parsed.unit,
    missing: false,
    valid: true,
    name,
  };
}

function cssHueComponent(token, fallback = 0) {
  const text = String(token ?? '').trim().toLowerCase();
  if (text === 'none') {
    return { value: fallback, raw: token, missing: true, valid: true, name: 'hue' };
  }
  const parsed = cssNumericToken(text);
  if (!parsed || !Number.isFinite(parsed.value)) {
    return { value: fallback, raw: token, missing: false, valid: false, name: 'hue' };
  }
  let degrees = parsed.value;
  if (parsed.unit === 'rad') degrees = parsed.value * 180 / Math.PI;
  if (parsed.unit === 'turn') degrees = parsed.value * 360;
  if (parsed.unit === 'grad') degrees = parsed.value * 0.9;
  const normalized = ((degrees % 360) + 360) % 360;
  return { value: normalized / 360, degrees: normalized, raw: token, unit: parsed.unit || 'deg', missing: false, valid: true, name: 'hue' };
}

function cssAlphaComponent(token) {
  if (token == null) return { value: 1, raw: undefined, missing: false, valid: true, name: 'alpha' };
  return cssComponent(token, {
    percentageScale: 0.01,
    numberScale: 1,
    fallback: 1,
    clampMin: 0,
    clampMax: 1,
    name: 'alpha',
  });
}

function cssAlphaCalcNumericComponent(token) {
  return cssComponent(token, {
    percentageScale: 0.01,
    numberScale: 1,
    fallback: 1,
    name: 'alpha',
  });
}

function cssRgbComponent(token) {
  return cssComponent(token, {
    percentageScale: 0.01,
    numberScale: 1 / 255,
    fallback: 0,
    clampMin: 0,
    clampMax: 1,
  });
}

function cssUnitComponent(token, name = 'component') {
  return cssComponent(token, {
    percentageScale: 0.01,
    numberScale: 1,
    fallback: 0,
    name,
  });
}

function cssFunctionTokens(body) {
  if (body.includes(',')) {
    return { legacy: true, values: cssSplitLegacyArgs(body), alphaToken: undefined };
  }
  const tokens = cssSplitFunctionArgs(body);
  const slashIndex = tokens.indexOf('/');
  if (slashIndex >= 0) {
    return {
      legacy: false,
      values: tokens.slice(0, slashIndex),
      alphaToken: tokens[slashIndex + 1],
    };
  }
  return { legacy: false, values: tokens, alphaToken: undefined };
}

function cssHexBytes(hex) {
  const text = String(hex ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(text)) return null;
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
  ];
}

function cssHexReport(source) {
  const text = String(source ?? '').trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (!match) return null;
  const hex = match[1].toLowerCase();
  const expand = (char) => parseInt(char + char, 16);
  let rgbaBytes;
  if (hex.length === 3 || hex.length === 4) {
    rgbaBytes = [
      expand(hex[0]),
      expand(hex[1]),
      expand(hex[2]),
      hex.length === 4 ? expand(hex[3]) : 255,
    ];
  } else {
    rgbaBytes = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
    ];
  }
  const rgba = rgbaBytes.map((value) => value / 255);
  return cssColorSuccess(source, 'hex', rgba.slice(0, 3), rgba[3], {
    components: rgbaBytes,
    normalized: rgba,
  });
}

function cssColorSuccess(source, syntax, rgbValue, alphaValue, details = {}) {
  const rgbFinite = finiteRgb(rgbValue);
  const alpha = clamp(finiteColorChannel(alphaValue, 1), 0, 1);
  const colorSpace = details.colorSpace ?? 'srgb';
  const gamut = colorGamutReport(rgbFinite, { colorSpace });
  const missingComponents = (details.componentReports ?? [])
    .filter((component) => component.missing)
    .map((component) => component.name);
  return {
    valid: true,
    source: String(source ?? ''),
    syntax,
    colorSpace,
    colorSpaceMetadata: colorSpaceMetadata(colorSpace),
    rgb: rgbFinite,
    alpha,
    rgba: [...rgbFinite, alpha],
    components: details.components ?? rgbFinite,
    componentReports: details.componentReports ?? [],
    missingComponents,
    normalized: details.normalized ?? [...rgbFinite, alpha],
    gamut,
    errors: [],
    warnings: details.warnings ?? [],
    ...details,
  };
}

function cssRgbFunctionReport(source, body, syntax) {
  const { legacy, values, alphaToken } = cssFunctionTokens(body);
  const components = values.slice(0, 3).map((token) => cssRgbComponent(token));
  const alpha = cssAlphaComponent(legacy ? values[3] : alphaToken);
  if (components.length !== 3 || components.some((component) => !component.valid) || !alpha.valid) {
    return cssColorError(source, syntax, 'Invalid CSS rgb()/rgba() color components');
  }
  return cssColorSuccess(source, syntax, components.map((component) => component.value), alpha.value, {
    componentReports: [
      { ...components[0], name: 'red' },
      { ...components[1], name: 'green' },
      { ...components[2], name: 'blue' },
      alpha,
    ],
    legacy,
  });
}

function cssHslFunctionReport(source, body, syntax) {
  const { legacy, values, alphaToken } = cssFunctionTokens(body);
  const hue = cssHueComponent(values[0]);
  const saturation = cssComponent(values[1], { percentageScale: 0.01, numberScale: 0.01, clampMin: 0, clampMax: 1, name: 'saturation' });
  const lightness = cssComponent(values[2], { percentageScale: 0.01, numberScale: 0.01, clampMin: 0, clampMax: 1, name: 'lightness' });
  const alpha = cssAlphaComponent(legacy ? values[3] : alphaToken);
  const components = [hue, saturation, lightness];
  if (values.length < 3 || components.some((component) => !component.valid) || !alpha.valid) {
    return cssColorError(source, syntax, 'Invalid CSS hsl()/hsla() color components');
  }
  return cssColorSuccess(source, syntax, hslToRgb([hue.value, saturation.value, lightness.value]), alpha.value, {
    componentReports: [hue, saturation, lightness, alpha],
    components: [hue.degrees, saturation.value, lightness.value],
    legacy,
  });
}

function cssLabFunctionReport(source, body, syntax) {
  const { values, alphaToken } = cssFunctionTokens(body);
  const lightness = cssComponent(values[0], { percentageScale: 1, numberScale: 1, clampMin: 0, clampMax: 100, name: 'lightness' });
  const a = cssComponent(values[1], { percentageScale: 1.25, numberScale: 1, name: 'a' });
  const b = cssComponent(values[2], { percentageScale: 1.25, numberScale: 1, name: 'b' });
  const alpha = cssAlphaComponent(alphaToken);
  const components = [lightness, a, b];
  if (values.length < 3 || components.some((component) => !component.valid) || !alpha.valid) {
    return cssColorError(source, syntax, 'Invalid CSS lab() color components');
  }
  return cssColorSuccess(source, syntax, labToRgb([lightness.value, a.value, b.value]), alpha.value, {
    componentReports: [lightness, a, b, alpha],
    components: [lightness.value, a.value, b.value],
    conversionSpace: 'lab',
  });
}

function cssLchFunctionReport(source, body, syntax) {
  const { values, alphaToken } = cssFunctionTokens(body);
  const lightness = cssComponent(values[0], { percentageScale: 1, numberScale: 1, clampMin: 0, clampMax: 100, name: 'lightness' });
  const chroma = cssComponent(values[1], { percentageScale: 1.5, numberScale: 1, clampMin: 0, name: 'chroma' });
  const hue = cssHueComponent(values[2]);
  const alpha = cssAlphaComponent(alphaToken);
  const components = [lightness, chroma, hue];
  if (values.length < 3 || components.some((component) => !component.valid) || !alpha.valid) {
    return cssColorError(source, syntax, 'Invalid CSS lch() color components');
  }
  return cssColorSuccess(source, syntax, lchToRgb([lightness.value, chroma.value, hue.value]), alpha.value, {
    componentReports: [lightness, chroma, hue, alpha],
    components: [lightness.value, chroma.value, hue.degrees],
    conversionSpace: 'lch',
  });
}

function cssOklabFunctionReport(source, body, syntax) {
  const { values, alphaToken } = cssFunctionTokens(body);
  const lightness = cssComponent(values[0], { percentageScale: 0.01, numberScale: 1, clampMin: 0, clampMax: 1, name: 'lightness' });
  const a = cssComponent(values[1], { percentageScale: 0.004, numberScale: 1, name: 'a' });
  const b = cssComponent(values[2], { percentageScale: 0.004, numberScale: 1, name: 'b' });
  const alpha = cssAlphaComponent(alphaToken);
  const components = [lightness, a, b];
  if (values.length < 3 || components.some((component) => !component.valid) || !alpha.valid) {
    return cssColorError(source, syntax, 'Invalid CSS oklab() color components');
  }
  return cssColorSuccess(source, syntax, oklabToRgb([lightness.value, a.value, b.value]), alpha.value, {
    componentReports: [lightness, a, b, alpha],
    components: [lightness.value, a.value, b.value],
    conversionSpace: 'oklab',
  });
}

function cssOklchFunctionReport(source, body, syntax) {
  const { values, alphaToken } = cssFunctionTokens(body);
  const lightness = cssComponent(values[0], { percentageScale: 0.01, numberScale: 1, clampMin: 0, clampMax: 1, name: 'lightness' });
  const chroma = cssComponent(values[1], { percentageScale: 0.004, numberScale: 1, clampMin: 0, name: 'chroma' });
  const hue = cssHueComponent(values[2]);
  const alpha = cssAlphaComponent(alphaToken);
  const components = [lightness, chroma, hue];
  if (values.length < 3 || components.some((component) => !component.valid) || !alpha.valid) {
    return cssColorError(source, syntax, 'Invalid CSS oklch() color components');
  }
  return cssColorSuccess(source, syntax, oklchToRgb([lightness.value, chroma.value, hue.value]), alpha.value, {
    componentReports: [lightness, chroma, hue, alpha],
    components: [lightness.value, chroma.value, hue.degrees],
    conversionSpace: 'oklch',
  });
}

const CSS_COLOR_FUNCTION_RGB_SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear', 'rec2020', 'a98-rgb']);
const CSS_COLOR_FUNCTION_XYZ_SPACES = new Set(['xyz', 'xyz-d65', 'xyz-d50']);
const CSS_COLOR_FUNCTION_SPACES = new Set([...CSS_COLOR_FUNCTION_RGB_SPACES, ...CSS_COLOR_FUNCTION_XYZ_SPACES]);

function cssCustomColorProfileTable(options = {}) {
  const table = options.customColorProfiles ?? options.customProfiles ?? options.colorProfiles;
  return table && typeof table === 'object' ? table : {};
}

function cssCustomColorProfileLookup(rawSpace, options = {}) {
  const authoredColorSpace = String(rawSpace ?? '').trim();
  const key = authoredColorSpace.toLowerCase();
  if (!key.startsWith('--')) return null;
  const table = cssCustomColorProfileTable(options);
  const profileSource = table[authoredColorSpace] ?? table[key];
  if (!profileSource || typeof profileSource !== 'object') return null;
  const channelSource = profileSource.channels ?? profileSource.channelNames ?? profileSource.componentNames ?? ['red', 'green', 'blue'];
  const channels = Array.isArray(channelSource)
    ? channelSource.map((channel, index) => String(channel ?? `c${index}`).trim().toLowerCase()).filter(Boolean)
    : ['red', 'green', 'blue'];
  const baseColorSpace = profileSource.baseColorSpace ?? profileSource.rgbColorSpace ?? profileSource.colorSpace ?? null;
  const normalizedBase = baseColorSpace ? colorSpaceMetadata(baseColorSpace).id : null;
  const rgbCompatible = profileSource.rgbCompatible === true || CSS_COLOR_FUNCTION_RGB_SPACES.has(String(baseColorSpace ?? '').trim().toLowerCase());
  const fromRgb = profileSource.fromRgb ?? profileSource.rgbToComponents ?? profileSource.convertFromRgb ?? null;
  const toRgb = profileSource.toRgb ?? profileSource.componentsToRgb ?? profileSource.convertToRgb ?? null;
  return {
    id: key,
    authoredColorSpace,
    label: profileSource.label ?? profileSource.name ?? authoredColorSpace,
    channels,
    channelCount: channels.length,
    baseColorSpace: normalizedBase,
    rgbCompatible,
    fromRgb: typeof fromRgb === 'function' ? fromRgb : null,
    toRgb: typeof toRgb === 'function' ? toRgb : null,
  };
}

function cssCustomColorProfileMetadata(profile) {
  return {
    id: profile.id,
    authoredColorSpace: profile.authoredColorSpace,
    label: profile.label,
    channels: profile.channels,
    channelCount: profile.channelCount,
    baseColorSpace: profile.baseColorSpace,
    rgbCompatible: profile.rgbCompatible,
    hasFromRgb: Boolean(profile.fromRgb),
    hasToRgb: Boolean(profile.toRgb),
  };
}

function cssCustomProfileArrayLike(value, expectedCount) {
  const source = Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number')
    ? value
    : (Array.isArray(value?.components) || ArrayBuffer.isView(value?.components) ? value.components : value?.rgb);
  if (!source || typeof source.length !== 'number' || source.length < expectedCount) return null;
  const components = Array.from({ length: expectedCount }, (_, index) => Number(source[index]));
  return components.every((component) => Number.isFinite(component)) ? components : null;
}

function cssCustomProfileFromRgbReport(profile, rgb, alpha) {
  if (!profile.fromRgb && !profile.rgbCompatible) {
    return { valid: false, error: `Custom color profile ${profile.authoredColorSpace} is missing a fromRgb conversion` };
  }
  let raw;
  try {
    raw = profile.fromRgb
      ? profile.fromRgb(rgb.slice(), { alpha, profile: cssCustomColorProfileMetadata(profile) })
      : rgb.slice(0, profile.channelCount);
  } catch (error) {
    return { valid: false, error: `Custom color profile ${profile.authoredColorSpace} fromRgb failed: ${error.message}` };
  }
  const components = cssCustomProfileArrayLike(raw, profile.channelCount);
  if (!components) return { valid: false, error: `Custom color profile ${profile.authoredColorSpace} fromRgb returned invalid components` };
  return {
    valid: true,
    components,
    conversionPolicy: profile.fromRgb ? 'caller-provided-custom-profile-from-rgb' : `${profile.baseColorSpace ?? 'srgb'}-compatible-custom-profile-from-rgb`,
  };
}

function cssCustomProfileToRgbReport(profile, components, alpha) {
  if (!profile.toRgb && !profile.rgbCompatible) {
    return { valid: false, error: `Custom color profile ${profile.authoredColorSpace} is missing a toRgb conversion` };
  }
  let raw;
  try {
    raw = profile.toRgb
      ? profile.toRgb(components.slice(), { alpha, profile: cssCustomColorProfileMetadata(profile) })
      : components.slice(0, 3);
  } catch (error) {
    return { valid: false, error: `Custom color profile ${profile.authoredColorSpace} toRgb failed: ${error.message}` };
  }
  const rgb = cssCustomProfileArrayLike(raw, 3);
  if (!rgb) return { valid: false, error: `Custom color profile ${profile.authoredColorSpace} toRgb returned invalid RGB` };
  return {
    valid: true,
    rgb,
    conversionPolicy: profile.toRgb ? 'caller-provided-custom-profile-to-rgb' : `${profile.baseColorSpace ?? 'srgb'}-compatible-custom-profile-to-rgb`,
  };
}

function cssCustomProfileContext(profile, components, alpha) {
  const context = { alpha };
  profile.channels.forEach((channel, index) => {
    context[channel] = finiteColorChannel(components[index], 0);
    context[`c${index}`] = context[channel];
  });
  return context;
}

function cssColorFunctionReport(source, body, options = {}) {
  const { values, alphaToken } = cssFunctionTokens(body);
  const spaceToken = values[0];
  const rawSpace = String(spaceToken ?? '').toLowerCase();
  const customProfile = cssCustomColorProfileLookup(rawSpace, options);
  if (!CSS_COLOR_FUNCTION_SPACES.has(rawSpace) && !customProfile) {
    return cssColorError(source, 'color', 'Unsupported or invalid CSS color() color space');
  }
  if (customProfile) {
    if (customProfile.channelCount === 0 || values.length < 1 + customProfile.channelCount) {
      return cssColorError(source, 'color', 'Invalid CSS custom color profile components', {
        authoredColorSpace: rawSpace,
        customColorProfile: cssCustomColorProfileMetadata(customProfile),
      });
    }
    const components = values.slice(1, 1 + customProfile.channelCount).map((token, index) => cssUnitComponent(token, customProfile.channels[index]));
    const alpha = cssAlphaComponent(alphaToken);
    if (components.some((component) => !component.valid) || !alpha.valid) {
      return cssColorError(source, 'color', 'Invalid CSS custom color profile components', {
        authoredColorSpace: rawSpace,
        customColorProfile: cssCustomColorProfileMetadata(customProfile),
        componentReports: [...components, alpha],
      });
    }
    const componentValues = components.map((component) => component.value);
    const converted = cssCustomProfileToRgbReport(customProfile, componentValues, alpha.value);
    if (!converted.valid) {
      return cssColorError(source, 'color', converted.error, {
        authoredColorSpace: rawSpace,
        customColorProfile: cssCustomColorProfileMetadata(customProfile),
        componentReports: [...components, alpha],
      });
    }
    return cssColorSuccess(source, 'color', converted.rgb, alpha.value, {
      colorSpace: 'srgb',
      authoredColorSpace: rawSpace,
      customColorProfile: cssCustomColorProfileMetadata(customProfile),
      customProfileColor: true,
      componentReports: [...components, alpha],
      components: componentValues,
      conversionPolicy: converted.conversionPolicy,
    });
  }
  if (values.length < 4) {
    return cssColorError(source, 'color', 'Unsupported or invalid CSS color() color space');
  }
  const colorSpace = colorSpaceMetadata(rawSpace).id;
  const isXyzSpace = CSS_COLOR_FUNCTION_XYZ_SPACES.has(rawSpace);
  const componentNames = isXyzSpace ? ['x', 'y', 'z'] : ['red', 'green', 'blue'];
  const components = values.slice(1, 4).map((token, index) => cssUnitComponent(token, componentNames[index]));
  const alpha = cssAlphaComponent(alphaToken);
  if (components.some((component) => !component.valid) || !alpha.valid) {
    return cssColorError(source, 'color', 'Invalid CSS color() components');
  }
  const componentValues = components.map((component) => component.value);
  const rgbValue = isXyzSpace ? xyzCssComponentsToRgb(componentValues, rawSpace) : componentValues;
  return cssColorSuccess(source, 'color', rgbValue, alpha.value, {
    colorSpace,
    authoredColorSpace: rawSpace,
    componentReports: [...components, alpha],
    components: componentValues,
    conversionSpace: isXyzSpace ? rawSpace : undefined,
    xyz: isXyzSpace ? componentValues : undefined,
  });
}

function cssFunctionBodyIsRelative(body) {
  return cssSplitTopLevelSpaceArgs(body)[0]?.toLowerCase() === 'from';
}

function cssCalcExpressionBody(token) {
  const parts = cssFunctionParts(String(token ?? '').trim());
  return parts?.name === 'calc' ? parts.body.trim() : null;
}

function cssCalcExpressionTokens(expression) {
  const tokens = [];
  const text = String(expression ?? '');
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index++;
    } else if (char === '(' || char === ')' || char === '+' || char === '-' || char === '*' || char === '/' || char === ',') {
      tokens.push({ type: char, raw: char });
      index++;
    } else if (/\d|\./.test(char)) {
      const start = index;
      if (char === '.') {
        index++;
        while (/\d/.test(text[index] ?? '')) index++;
      } else {
        while (/\d/.test(text[index] ?? '')) index++;
        if (text[index] === '.') {
          index++;
          while (/\d/.test(text[index] ?? '')) index++;
        }
      }
      if ((text[index] === 'e' || text[index] === 'E') && /[+\-\d]/.test(text[index + 1] ?? '')) {
        const exponentStart = index;
        index++;
        if (text[index] === '+' || text[index] === '-') index++;
        const digitStart = index;
        while (/\d/.test(text[index] ?? '')) index++;
        if (digitStart === index) index = exponentStart;
      }
      if (text[index] === '%') {
        index++;
      } else {
        while (/[a-zA-Z]/.test(text[index] ?? '')) index++;
      }
      tokens.push({ type: 'number', raw: text.slice(start, index) });
    } else if (/[a-zA-Z_]/.test(char)) {
      const start = index;
      index++;
      while (/[a-zA-Z0-9_-]/.test(text[index] ?? '')) index++;
      tokens.push({ type: 'identifier', raw: text.slice(start, index) });
    } else {
      return {
        valid: false,
        error: `Unsupported CSS calc() token: ${char}`,
        tokens,
      };
    }
  }
  return { valid: true, tokens };
}

const CSS_CALC_MATH_FUNCTIONS = new Set([
  'min', 'max', 'clamp',
  'round', 'mod', 'rem',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'pow', 'sqrt', 'hypot', 'log', 'exp',
  'abs', 'sign',
]);

const CSS_CALC_ROUNDING_STRATEGIES = new Set(['nearest', 'up', 'down', 'to-zero']);
const CSS_CALC_ANGLE_UNITS = new Set(['deg', 'grad', 'rad', 'turn']);

function cssCalcUnitType(unit = '') {
  const token = String(unit ?? '').toLowerCase();
  if (!token) return 'number';
  if (token === '%') return 'percentage';
  if (CSS_CALC_ANGLE_UNITS.has(token)) return 'angle';
  return 'dimension';
}

function cssCalcContextUnit(context, key) {
  return String(context?.__units?.[key] ?? '').toLowerCase();
}

function cssCalcAdditiveCompatible(left, right) {
  const leftType = cssCalcUnitType(left.unit);
  const rightType = cssCalcUnitType(right.unit);
  return leftType === rightType;
}

function cssCalcCompatibleUnit(left, right) {
  if (cssCalcUnitType(left.unit) === 'number' && cssCalcUnitType(right.unit) !== 'number') return right.unit;
  return left.unit || right.unit || '';
}

function cssRelativeCalcComponent(token, context, name, parseNumeric, finalizeValue = (value) => value) {
  const expression = cssCalcExpressionBody(token);
  if (expression == null) return null;
  const tokenReport = cssCalcExpressionTokens(expression);
  if (!tokenReport.valid) {
    return {
      value: finiteColorChannel(context[name], 0),
      raw: token,
      missing: false,
      valid: false,
      name,
      calc: true,
      expression,
      error: tokenReport.error,
    };
  }
  const tokens = tokenReport.tokens;
  const dependencies = new Set();
  const functions = new Set();
  let index = 0;
  const current = () => tokens[index];
  const consume = (type) => {
    if (current()?.type === type) {
      index++;
      return true;
    }
    return false;
  };
  const failure = (message) => ({
    value: finiteColorChannel(context[name], 0),
    raw: token,
    missing: false,
    valid: false,
    name,
    calc: true,
    expression,
    dependencies: [...dependencies],
    functions: [...functions],
    error: message,
    typeChecked: true,
  });
  const success = (value, unit = '') => ({ valid: true, value, unit, unitType: cssCalcUnitType(unit) });
  const argValue = (arg) => Number(arg?.value);
  const argUnit = (arg) => String(arg?.unit ?? '').toLowerCase();
  const checkSameUnitType = (args, functionName) => {
    const candidates = args.filter((arg) => !arg.none);
    if (candidates.length === 0) return { valid: true, unit: '' };
    const first = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (!cssCalcAdditiveCompatible(first, candidates[i])) {
        return {
          valid: false,
          error: `CSS ${functionName}() arguments have incompatible calc types: ${first.unitType} and ${candidates[i].unitType}`,
        };
      }
    }
    return { valid: true, unit: first.unit ?? '' };
  };
  const argRadians = (arg) => {
    const value = argValue(arg);
    const unit = argUnit(arg);
    if (unit === 'deg') return value * Math.PI / 180;
    if (unit === 'grad') return value * Math.PI / 200;
    if (unit === 'turn') return value * Math.PI * 2;
    return value;
  };
  const roundToStep = (strategy, value, step) => {
    if (step === 0) return NaN;
    if (!Number.isFinite(value) || !Number.isFinite(step)) return NaN;
    const ratio = value / step;
    const lower = (step > 0 ? Math.floor(ratio) : Math.ceil(ratio)) * step;
    const upper = (step > 0 ? Math.ceil(ratio) : Math.floor(ratio)) * step;
    if (strategy === 'up') return upper;
    if (strategy === 'down') return lower;
    if (strategy === 'to-zero') return Math.abs(lower) <= Math.abs(upper) ? lower : upper;
    const lowerDistance = Math.abs(value - lower);
    const upperDistance = Math.abs(upper - value);
    return lowerDistance < upperDistance ? lower : upper;
  };
  const modValue = (value, step) => {
    if (step === 0 || !Number.isFinite(value) || !Number.isFinite(step)) return NaN;
    return mod(value, step);
  };
  const remValue = (value, step) => {
    if (step === 0 || !Number.isFinite(value) || !Number.isFinite(step)) return NaN;
    return value % step;
  };
  const parseFunctionArguments = (functionName) => {
    const args = [];
    let strategy = 'nearest';
    if (!consume('(')) return failure(`CSS ${functionName}() requires parentheses`);
    if (
      functionName === 'round' &&
      current()?.type === 'identifier' &&
      CSS_CALC_ROUNDING_STRATEGIES.has(current().raw.toLowerCase()) &&
      tokens[index + 1]?.type === ','
    ) {
      strategy = current().raw.toLowerCase();
      index++;
      consume(',');
    }
    while (true) {
      if (current()?.type === ')') {
        consume(')');
        return { valid: true, args, strategy };
      }
      if (functionName === 'clamp' && current()?.type === 'identifier' && current().raw.toLowerCase() === 'none') {
        index++;
        args.push({ valid: true, none: true, value: null, unit: '' });
      } else {
        const value = parseSum();
        if (!value.valid) return value;
        args.push(value);
      }
      if (consume(',')) continue;
      if (consume(')')) return { valid: true, args, strategy };
      return failure(`Expected comma or closing parenthesis in CSS ${functionName}()`);
    }
  };
  const evaluateFunction = (functionName) => {
    const parsed = parseFunctionArguments(functionName);
    if (!parsed.valid) return parsed;
    const { args, strategy } = parsed;
    const nonClampNone = functionName !== 'clamp' && args.some((arg) => arg.none);
    if (nonClampNone) return failure(`CSS ${functionName}() does not accept none`);
    if (args.some((arg) => !arg.none && Number.isNaN(argValue(arg)))) return success(NaN);
    if (functionName === 'min' || functionName === 'max') {
      if (args.length === 0) return failure(`CSS ${functionName}() requires at least one argument`);
      const unitCheck = checkSameUnitType(args, functionName);
      if (!unitCheck.valid) return failure(unitCheck.error);
      const values = args.map((arg) => argValue(arg));
      return success(functionName === 'min' ? Math.min(...values) : Math.max(...values), unitCheck.unit);
    }
    if (functionName === 'clamp') {
      if (args.length !== 3) return failure('CSS clamp() requires exactly three arguments');
      const [minValue, centerValue, maxValue] = args;
      if (centerValue.none) return failure('CSS clamp() center value cannot be none');
      const unitCheck = checkSameUnitType(args, 'clamp');
      if (!unitCheck.valid) return failure(unitCheck.error);
      let value = argValue(centerValue);
      if (!maxValue.none) value = Math.min(value, argValue(maxValue));
      if (!minValue.none) value = Math.max(argValue(minValue), value);
      return success(value, unitCheck.unit);
    }
    if (functionName === 'round') {
      if (args.length < 1 || args.length > 2) return failure('CSS round() requires one or two numeric arguments after the optional strategy');
      if (args[1] && !cssCalcAdditiveCompatible(args[0], args[1])) {
        return failure(`CSS round() arguments have incompatible calc types: ${args[0].unitType} and ${args[1].unitType}`);
      }
      const step = args[1] ? argValue(args[1]) : 1;
      return success(roundToStep(strategy, argValue(args[0]), step), argUnit(args[0]));
    }
    if (functionName === 'mod' || functionName === 'rem') {
      if (args.length !== 2) return failure(`CSS ${functionName}() requires exactly two arguments`);
      if (!cssCalcAdditiveCompatible(args[0], args[1])) {
        return failure(`CSS ${functionName}() arguments have incompatible calc types: ${args[0].unitType} and ${args[1].unitType}`);
      }
      const value = functionName === 'mod'
        ? modValue(argValue(args[0]), argValue(args[1]))
        : remValue(argValue(args[0]), argValue(args[1]));
      return success(value, argUnit(args[0]));
    }
    if (functionName === 'sin' || functionName === 'cos' || functionName === 'tan') {
      if (args.length !== 1) return failure(`CSS ${functionName}() requires exactly one argument`);
      return success(Math[functionName](argRadians(args[0])));
    }
    if (functionName === 'asin' || functionName === 'acos' || functionName === 'atan') {
      if (args.length !== 1) return failure(`CSS ${functionName}() requires exactly one argument`);
      return success(Math[functionName](argValue(args[0])), 'rad');
    }
    if (functionName === 'atan2') {
      if (args.length !== 2) return failure('CSS atan2() requires exactly two arguments');
      if (!cssCalcAdditiveCompatible(args[0], args[1])) {
        return failure(`CSS atan2() arguments have incompatible calc types: ${args[0].unitType} and ${args[1].unitType}`);
      }
      return success(Math.atan2(argValue(args[0]), argValue(args[1])), 'rad');
    }
    if (functionName === 'pow') {
      if (args.length !== 2) return failure('CSS pow() requires exactly two arguments');
      return success(Math.pow(argValue(args[0]), argValue(args[1])));
    }
    if (functionName === 'sqrt') {
      if (args.length !== 1) return failure('CSS sqrt() requires exactly one argument');
      return success(Math.sqrt(argValue(args[0])));
    }
    if (functionName === 'hypot') {
      if (args.length === 0) return failure('CSS hypot() requires at least one argument');
      return success(Math.hypot(...args.map((arg) => argValue(arg))));
    }
    if (functionName === 'log') {
      if (args.length < 1 || args.length > 2) return failure('CSS log() requires one argument and an optional base');
      const value = Math.log(argValue(args[0]));
      return success(args[1] ? value / Math.log(argValue(args[1])) : value);
    }
    if (functionName === 'exp') {
      if (args.length !== 1) return failure('CSS exp() requires exactly one argument');
      return success(Math.exp(argValue(args[0])));
    }
    if (functionName === 'abs') {
      if (args.length !== 1) return failure('CSS abs() requires exactly one argument');
      return success(Math.abs(argValue(args[0])), argUnit(args[0]));
    }
    if (functionName === 'sign') {
      if (args.length !== 1) return failure('CSS sign() requires exactly one argument');
      return success(Math.sign(argValue(args[0])));
    }
    return failure(`Unsupported CSS calc() function: ${functionName}`);
  };
  const parsePrimary = () => {
    const next = current();
    if (!next) return failure('Unexpected end of CSS calc() expression');
    if (consume('(')) {
      const nested = parseSum();
      if (!nested.valid) return nested;
      if (!consume(')')) return failure('Unclosed parentheses in CSS calc() expression');
      return nested;
    }
    if (next.type === 'number') {
      index++;
      const parsed = parseNumeric(next.raw);
      if (!parsed.valid) return failure(`Invalid CSS calc() numeric token: ${next.raw}`);
      return success(parsed.value, parsed.unit);
    }
    if (next.type === 'identifier') {
      index++;
      const key = next.raw.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(context, key)) {
        dependencies.add(key);
        return success(finiteColorChannel(context[key], 0), cssCalcContextUnit(context, key));
      }
      if (CSS_CALC_MATH_FUNCTIONS.has(key) && current()?.type === '(') {
        functions.add(key);
        return evaluateFunction(key);
      }
      if (key === 'e') return success(Math.E);
      if (key === 'pi') return success(Math.PI);
      if (key === 'infinity') return success(Infinity);
      if (key === 'nan') return success(NaN);
      return failure(`Unsupported CSS calc() identifier: ${next.raw}`);
    }
    return failure(`Unexpected CSS calc() token: ${next.raw}`);
  };
  const parseUnary = () => {
    if (consume('+')) return parseUnary();
    if (consume('-')) {
      const value = parseUnary();
      return value.valid ? { ...value, value: -value.value } : value;
    }
    return parsePrimary();
  };
  const parseProduct = () => {
    let left = parseUnary();
    while (left.valid && (current()?.type === '*' || current()?.type === '/')) {
      const operator = current().type;
      index++;
      const right = parseUnary();
      if (!right.valid) return right;
      if (operator === '/') {
        if (right.value === 0) return failure('Division by zero in CSS calc() expression');
        if (cssCalcUnitType(right.unit) !== 'number') {
          return failure(`Division by a non-number calc type is unsupported in CSS relative color reports: ${right.unitType}`);
        }
        left = success(left.value / right.value, left.unit);
      } else {
        if (cssCalcUnitType(left.unit) !== 'number' && cssCalcUnitType(right.unit) !== 'number') {
          return failure(`Multiplication of two non-number calc types is unsupported in CSS relative color reports: ${left.unitType} and ${right.unitType}`);
        }
        left = success(left.value * right.value, cssCalcCompatibleUnit(left, right));
      }
    }
    return left;
  };
  function parseSum() {
    let left = parseProduct();
    while (left.valid && (current()?.type === '+' || current()?.type === '-')) {
      const operator = current().type;
      index++;
      const right = parseProduct();
      if (!right.valid) return right;
      if (!cssCalcAdditiveCompatible(left, right)) {
        return failure(`Incompatible CSS calc() types for ${operator}: ${left.unitType} and ${right.unitType}`);
      }
      left = {
        valid: true,
        value: operator === '+' ? left.value + right.value : left.value - right.value,
        unit: left.unit || right.unit || '',
        unitType: left.unitType,
      };
    }
    return left;
  }
  const result = parseSum();
  if (!result.valid) return result;
  if (index < tokens.length) return failure(`Unexpected trailing CSS calc() token: ${current().raw}`);
  const value = finalizeValue(result.value, result.unit);
  if (!Number.isFinite(value)) return failure('CSS calc() expression must resolve to a finite number');
  return {
    value,
    raw: token,
    missing: false,
    valid: true,
    name,
    calc: true,
    expression,
    dependencies: [...dependencies],
    functions: [...functions],
    unit: result.unit ?? '',
    unitType: cssCalcUnitType(result.unit),
    typeChecked: true,
  };
}

function cssRelativeBodyParts(body, componentCount) {
  if (cssHasTopLevelComma(body)) {
    return {
      valid: false,
      error: 'CSS relative color syntax must use modern space-separated components at top level',
    };
  }
  const tokens = cssSplitTopLevelSpaceArgs(body);
  if (tokens[0]?.toLowerCase() !== 'from') {
    return { valid: false, error: 'CSS relative color syntax must start with from <color>' };
  }
  const slashIndex = tokens.indexOf('/');
  if (slashIndex >= 0 && tokens.indexOf('/', slashIndex + 1) >= 0) {
    return { valid: false, error: 'CSS relative color syntax accepts only one top-level alpha slash' };
  }
  const valueTokens = slashIndex >= 0 ? tokens.slice(0, slashIndex) : tokens;
  const alphaTokens = slashIndex >= 0 ? tokens.slice(slashIndex + 1) : [];
  if (slashIndex >= 0 && alphaTokens.length !== 1) {
    return { valid: false, error: 'CSS relative color alpha must be one token' };
  }
  if (valueTokens.length < 2 + componentCount) {
    return { valid: false, error: 'CSS relative color is missing an origin color or component values' };
  }
  const componentTokens = componentCount > 0 ? valueTokens.slice(-componentCount) : [];
  const originTokens = valueTokens.slice(1, valueTokens.length - componentCount);
  if (originTokens.length === 0) {
    return { valid: false, error: 'CSS relative color origin is empty' };
  }
  return {
    valid: true,
    origin: originTokens.join(' '),
    componentTokens,
    alphaToken: alphaTokens[0],
    tokens,
  };
}

function cssRelativeColorSpaceBodyParts(body) {
  if (cssHasTopLevelComma(body)) {
    return {
      valid: false,
      error: 'CSS relative color() syntax must use modern space-separated components at top level',
    };
  }
  const tokens = cssSplitTopLevelSpaceArgs(body);
  if (tokens[0]?.toLowerCase() !== 'from') {
    return { valid: false, error: 'CSS relative color() syntax must start with from <color>' };
  }
  const slashIndex = tokens.indexOf('/');
  if (slashIndex >= 0 && tokens.indexOf('/', slashIndex + 1) >= 0) {
    return { valid: false, error: 'CSS relative color() syntax accepts only one top-level alpha slash' };
  }
  const valueTokens = slashIndex >= 0 ? tokens.slice(0, slashIndex) : tokens;
  const alphaTokens = slashIndex >= 0 ? tokens.slice(slashIndex + 1) : [];
  if (slashIndex >= 0 && alphaTokens.length !== 1) {
    return { valid: false, error: 'CSS relative color() alpha must be one token' };
  }
  if (valueTokens.length < 6) {
    return { valid: false, error: 'CSS relative color() is missing an origin color, color space, or component values' };
  }
  const componentTokens = valueTokens.slice(-3);
  const colorSpaceToken = valueTokens[valueTokens.length - 4];
  const originTokens = valueTokens.slice(1, valueTokens.length - 4);
  if (originTokens.length === 0) return { valid: false, error: 'CSS relative color() origin is empty' };
  return {
    valid: true,
    origin: originTokens.join(' '),
    colorSpaceToken,
    componentTokens,
    alphaToken: alphaTokens[0],
    tokens,
  };
}

function cssRelativeComponentToken(token, context, name, parseNumeric, finalizeCalcValue = (value) => value) {
  const raw = String(token ?? '').trim();
  const lower = raw.toLowerCase();
  if (!lower) return { value: 0, raw: token, missing: false, valid: false, name };
  if (lower === 'none') {
    return {
      value: finiteColorChannel(context[name], 0),
      raw: token,
      missing: true,
      valid: true,
      name,
    };
  }
  const calc = cssRelativeCalcComponent(token, context, name, parseNumeric, finalizeCalcValue);
  if (calc) return calc;
  if (Object.prototype.hasOwnProperty.call(context, lower)) {
    return {
      value: finiteColorChannel(context[lower], 0),
      raw: token,
      missing: false,
      valid: true,
      name,
      keyword: lower,
      fromOrigin: true,
    };
  }
  return parseNumeric(token);
}

function cssRelativeRgbComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => cssComponent(numericToken, {
    percentageScale: 2.55,
    numberScale: 1,
    name,
  }));
}

function cssRelativePercentComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => cssComponent(numericToken, {
    percentageScale: 1,
    numberScale: 1,
    name,
  }));
}

function cssRelativeLabAxisComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => cssComponent(numericToken, {
    percentageScale: 1.25,
    numberScale: 1,
    name,
  }));
}

function cssRelativeOklabLightnessComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => cssComponent(numericToken, {
    percentageScale: 0.01,
    numberScale: 1,
    name,
  }));
}

function cssRelativeLchChromaComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => cssComponent(numericToken, {
    percentageScale: 1.5,
    numberScale: 1,
    clampMin: 0,
    name,
  }));
}

function cssRelativeOklabAxisComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => cssComponent(numericToken, {
    percentageScale: 0.004,
    numberScale: 1,
    name,
  }));
}

function cssRelativeOklchChromaComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => cssComponent(numericToken, {
    percentageScale: 0.004,
    numberScale: 1,
    clampMin: 0,
    name,
  }));
}

function cssRelativeHueComponent(token, context, name) {
  return cssRelativeComponentToken(token, context, name, (numericToken) => {
    const hue = cssHueComponent(numericToken);
    return {
      ...hue,
      value: hue.degrees ?? 0,
      normalizedValue: hue.value,
      name,
    };
  }, (value, unit) => {
    if (unit === 'rad') return value * 180 / Math.PI;
    if (unit === 'turn') return value * 360;
    if (unit === 'grad') return value * 0.9;
    return value;
  });
}

function cssRelativeAlphaComponent(token, context, required = false) {
  if (token == null) {
    return {
      value: finiteColorChannel(context.alpha, 1),
      raw: undefined,
      missing: false,
      valid: !required,
      name: 'alpha',
      inherited: !required,
      error: required ? 'CSS relative alpha() requires a slash alpha component' : undefined,
    };
  }
  const calc = cssRelativeCalcComponent(
    token,
    context,
    'alpha',
    (numericToken) => cssAlphaCalcNumericComponent(numericToken),
    (value) => clamp(value, 0, 1)
  );
  if (calc) return calc;
  return cssRelativeComponentToken(
    token,
    context,
    'alpha',
    (numericToken) => cssAlphaComponent(numericToken),
    (value) => clamp(value, 0, 1)
  );
}

function cssRelativeProcessingSpec(functionName, originReport) {
  const rgb = finiteRgb(originReport.rgb);
  const alpha = clamp(finiteColorChannel(originReport.alpha, 1), 0, 1);
  const rgbContext = {
    r: rgb[0] * 255,
    g: rgb[1] * 255,
    b: rgb[2] * 255,
    red: rgb[0] * 255,
    green: rgb[1] * 255,
    blue: rgb[2] * 255,
    alpha,
  };
  if (functionName === 'rgb') {
    return {
      processingSpace: 'srgb',
      componentNames: ['red', 'green', 'blue'],
      context: rgbContext,
      parsers: [cssRelativeRgbComponent, cssRelativeRgbComponent, cssRelativeRgbComponent],
      toRgb: (components) => components.map((component) => component / 255),
    };
  }
  if (functionName === 'alpha') {
    return {
      processingSpace: originReport.colorSpace ?? 'srgb',
      componentNames: [],
      context: rgbContext,
      parsers: [],
      toRgb: () => rgb,
    };
  }
  if (functionName === 'hsl') {
    const hsl = rgbToHsl(rgb);
    const context = {
      h: hsl[0] * 360,
      s: hsl[1] * 100,
      l: hsl[2] * 100,
      hue: hsl[0] * 360,
      saturation: hsl[1] * 100,
      lightness: hsl[2] * 100,
      alpha,
      __units: { h: 'deg', hue: 'deg' },
    };
    return {
      processingSpace: 'hsl',
      componentNames: ['hue', 'saturation', 'lightness'],
      context,
      parsers: [cssRelativeHueComponent, cssRelativePercentComponent, cssRelativePercentComponent],
      toRgb: ([hue, saturation, lightness]) => hslToRgb([hue / 360, saturation / 100, lightness / 100]),
    };
  }
  if (functionName === 'lab') {
    const lab = rgbToLab(rgb);
    const context = { l: lab[0], a: lab[1], b: lab[2], lightness: lab[0], alpha };
    return {
      processingSpace: 'lab',
      componentNames: ['lightness', 'a', 'b'],
      context,
      parsers: [cssRelativePercentComponent, cssRelativeLabAxisComponent, cssRelativeLabAxisComponent],
      toRgb: (components) => labToRgb(components),
    };
  }
  if (functionName === 'lch') {
    const lch = rgbToLch(rgb);
    const context = {
      l: lch[0],
      c: lch[1],
      h: lch[2] * 360,
      lightness: lch[0],
      chroma: lch[1],
      hue: lch[2] * 360,
      alpha,
      __units: { h: 'deg', hue: 'deg' },
    };
    return {
      processingSpace: 'lch',
      componentNames: ['lightness', 'chroma', 'hue'],
      context,
      parsers: [cssRelativePercentComponent, cssRelativeLchChromaComponent, cssRelativeHueComponent],
      toRgb: ([lightness, chroma, hue]) => lchToRgb([lightness, chroma, hue / 360]),
    };
  }
  if (functionName === 'oklab') {
    const oklab = rgbToOklab(rgb);
    const context = { l: oklab[0], a: oklab[1], b: oklab[2], lightness: oklab[0], alpha };
    return {
      processingSpace: 'oklab',
      componentNames: ['lightness', 'a', 'b'],
      context,
      parsers: [cssRelativeOklabLightnessComponent, cssRelativeOklabAxisComponent, cssRelativeOklabAxisComponent],
      toRgb: (components) => oklabToRgb(components),
    };
  }
  if (functionName === 'oklch') {
    const oklch = rgbToOklch(rgb);
    const context = {
      l: oklch[0],
      c: oklch[1],
      h: oklch[2] * 360,
      lightness: oklch[0],
      chroma: oklch[1],
      hue: oklch[2] * 360,
      alpha,
      __units: { h: 'deg', hue: 'deg' },
    };
    return {
      processingSpace: 'oklch',
      componentNames: ['lightness', 'chroma', 'hue'],
      context,
      parsers: [cssRelativeOklabLightnessComponent, cssRelativeOklchChromaComponent, cssRelativeHueComponent],
      toRgb: ([lightness, chroma, hue]) => oklchToRgb([lightness, chroma, hue / 360]),
    };
  }
  return null;
}

function cssRelativeColorFunctionSpaceReport(source, body, options = {}) {
  const bodyParts = cssRelativeColorSpaceBodyParts(body);
  if (!bodyParts.valid) {
    return cssColorError(source, 'relative-color', bodyParts.error, { functionName: 'color' });
  }
  const rawSpace = String(bodyParts.colorSpaceToken ?? '').trim().toLowerCase();
  const customProfile = cssCustomColorProfileLookup(rawSpace, options);
  if (!CSS_COLOR_FUNCTION_SPACES.has(rawSpace) && !customProfile) {
    return cssColorError(source, 'relative-color', 'Unsupported CSS relative color() color space', {
      functionName: 'color',
      origin: bodyParts.origin,
      authoredColorSpace: rawSpace,
    });
  }
  const originReport = cssColorParseReport(bodyParts.origin, options);
  if (!colorReportHasRgb(originReport)) {
    return cssColorError(source, 'relative-color', 'CSS relative color() origin must resolve to numeric RGB', {
      functionName: 'color',
      origin: bodyParts.origin,
      originColor: originReport,
      authoredColorSpace: rawSpace,
    });
  }
  const rgb = finiteRgb(originReport.rgb);
  const alpha = clamp(finiteColorChannel(originReport.alpha, 1), 0, 1);
  if (customProfile) {
    const originProfile = cssCustomProfileFromRgbReport(customProfile, rgb, alpha);
    if (!originProfile.valid) {
      return cssColorError(source, 'relative-color', originProfile.error, {
        functionName: 'color',
        origin: bodyParts.origin,
        originColor: originReport,
        authoredColorSpace: rawSpace,
        customColorProfile: cssCustomColorProfileMetadata(customProfile),
      });
    }
    const context = cssCustomProfileContext(customProfile, originProfile.components, alpha);
    const componentReports = bodyParts.componentTokens.map((token, index) => (
      cssRelativeComponentToken(token, context, customProfile.channels[index], (numericToken) => cssUnitComponent(numericToken, customProfile.channels[index]))
    ));
    const alphaReport = cssRelativeAlphaComponent(bodyParts.alphaToken, context);
    const invalidComponents = [...componentReports, alphaReport].filter((component) => !component.valid);
    if (invalidComponents.length > 0) {
      const error = invalidComponents.find((component) => component.error)?.error ?? 'Invalid CSS relative custom color profile components';
      return cssColorError(source, 'relative-color', error, {
        functionName: 'color',
        origin: bodyParts.origin,
        originColor: originReport,
        authoredColorSpace: rawSpace,
        customColorProfile: cssCustomColorProfileMetadata(customProfile),
        componentReports: [...componentReports, alphaReport],
      });
    }
    const components = componentReports.map((component) => component.value);
    const converted = cssCustomProfileToRgbReport(customProfile, components, alphaReport.value);
    if (!converted.valid) {
      return cssColorError(source, 'relative-color', converted.error, {
        functionName: 'color',
        origin: bodyParts.origin,
        originColor: originReport,
        authoredColorSpace: rawSpace,
        customColorProfile: cssCustomColorProfileMetadata(customProfile),
        componentReports: [...componentReports, alphaReport],
      });
    }
    return cssColorSuccess(source, 'relative-color', converted.rgb, alphaReport.value, {
      relative: true,
      resolved: true,
      functionName: 'color',
      canonicalFunctionName: 'color',
      colorFunctionRelative: true,
      colorSpace: 'srgb',
      authoredColorSpace: rawSpace,
      origin: bodyParts.origin,
      originColor: originReport,
      processingSpace: rawSpace,
      customColorProfile: cssCustomColorProfileMetadata(customProfile),
      customProfileRelative: true,
      originProfileComponents: originProfile.components,
      componentReports: [...componentReports, alphaReport],
      relativeComponents: componentReports,
      relativeAlpha: alphaReport,
      components,
      conversionPolicy: `${originProfile.conversionPolicy}|${converted.conversionPolicy}`,
    });
  }
  const colorSpace = colorSpaceMetadata(rawSpace).id;
  const isXyzSpace = CSS_COLOR_FUNCTION_XYZ_SPACES.has(rawSpace);
  const originComponents = isXyzSpace ? rgbToCssXyzComponents(rgb, rawSpace) : rgb;
  const context = isXyzSpace ? {
    x: originComponents[0],
    y: originComponents[1],
    z: originComponents[2],
    alpha,
  } : {
    r: originComponents[0],
    g: originComponents[1],
    b: originComponents[2],
    red: originComponents[0],
    green: originComponents[1],
    blue: originComponents[2],
    alpha,
  };
  const componentNames = isXyzSpace ? ['x', 'y', 'z'] : ['red', 'green', 'blue'];
  const componentReports = bodyParts.componentTokens.map((token, index) => (
    cssRelativeComponentToken(token, context, componentNames[index], (numericToken) => cssUnitComponent(numericToken, componentNames[index]))
  ));
  const alphaReport = cssRelativeAlphaComponent(bodyParts.alphaToken, context);
  const invalidComponents = [...componentReports, alphaReport].filter((component) => !component.valid);
  if (invalidComponents.length > 0) {
    const error = invalidComponents.find((component) => component.error)?.error ?? 'Invalid CSS relative color() components';
    return cssColorError(source, 'relative-color', error, {
      functionName: 'color',
      origin: bodyParts.origin,
      originColor: originReport,
      authoredColorSpace: rawSpace,
      componentReports: [...componentReports, alphaReport],
    });
  }
  const components = componentReports.map((component) => component.value);
  const rgbValue = isXyzSpace ? xyzCssComponentsToRgb(components, rawSpace) : components;
  return cssColorSuccess(source, 'relative-color', rgbValue, alphaReport.value, {
    relative: true,
    resolved: true,
    functionName: 'color',
    canonicalFunctionName: 'color',
    colorFunctionRelative: true,
    colorSpace,
    authoredColorSpace: rawSpace,
    origin: bodyParts.origin,
    originColor: originReport,
    processingSpace: colorSpace,
    componentReports: [...componentReports, alphaReport],
    relativeComponents: componentReports,
    relativeAlpha: alphaReport,
    components,
    xyz: isXyzSpace ? components : undefined,
    conversionPolicy: isXyzSpace ? (rawSpace === 'xyz-d50' ? 'xyz-d50-bradford-to-srgb' : 'xyz-d65-to-srgb') : 'metadata-only',
  });
}

function cssRelativeCanonicalFunctionName(functionName) {
  if (functionName === 'rgba') return 'rgb';
  if (functionName === 'hsla') return 'hsl';
  return functionName;
}

function cssRelativeColorFunctionReport(source, functionName, body, options = {}) {
  const canonicalName = cssRelativeCanonicalFunctionName(functionName);
  if (canonicalName === 'color') return cssRelativeColorFunctionSpaceReport(source, body, options);
  const componentCount = canonicalName === 'alpha' ? 0 : 3;
  const bodyParts = cssRelativeBodyParts(body, componentCount);
  if (!bodyParts.valid) {
    return cssColorError(source, 'relative-color', bodyParts.error, { functionName });
  }
  const originReport = cssColorParseReport(bodyParts.origin, options);
  if (!colorReportHasRgb(originReport)) {
    return cssColorError(source, 'relative-color', 'CSS relative color origin must resolve to numeric RGB', {
      functionName,
      origin: bodyParts.origin,
      originColor: originReport,
    });
  }
  const spec = cssRelativeProcessingSpec(canonicalName, originReport);
  if (!spec) {
    return cssColorError(source, 'relative-color', `Unsupported CSS relative color function: ${functionName}`, {
      functionName,
      origin: bodyParts.origin,
      originColor: originReport,
    });
  }
  const componentReports = bodyParts.componentTokens.map((token, index) => (
    spec.parsers[index](token, spec.context, spec.componentNames[index])
  ));
  const alphaReport = cssRelativeAlphaComponent(bodyParts.alphaToken, spec.context, canonicalName === 'alpha');
  const invalidComponents = [...componentReports, alphaReport].filter((component) => !component.valid);
  if (invalidComponents.length > 0) {
    const error = invalidComponents.find((component) => component.error)?.error ?? 'Invalid CSS relative color components';
    return cssColorError(source, 'relative-color', error, {
      functionName,
      origin: bodyParts.origin,
      originColor: originReport,
      componentReports: [...componentReports, alphaReport],
    });
  }
  const components = componentReports.map((component) => component.value);
  const rgbValue = spec.toRgb(components);
  return cssColorSuccess(source, 'relative-color', rgbValue, alphaReport.value, {
    relative: true,
    resolved: true,
    functionName,
    canonicalFunctionName: canonicalName,
    origin: bodyParts.origin,
    originColor: originReport,
    processingSpace: spec.processingSpace,
    componentReports: [...componentReports, alphaReport],
    relativeComponents: componentReports,
    relativeAlpha: alphaReport,
    components,
    alphaOnly: canonicalName === 'alpha',
  });
}

export function cssRelativeColorReport(value, options = {}) {
  const source = String(value ?? '').trim();
  const parts = cssFunctionParts(source);
  if (!parts || !cssFunctionBodyIsRelative(parts.body)) {
    return cssColorError(source, 'relative-color', 'CSS relative color report requires a relative color function');
  }
  return cssRelativeColorFunctionReport(source, parts.name, parts.body, options);
}

function cssSystemColorLookup(name) {
  const key = String(name ?? '').trim().toLowerCase();
  const direct = CSS_SYSTEM_COLOR_BY_KEY[key];
  if (direct) return { metadata: direct, deprecated: false, specifiedName: String(name ?? '').trim() };
  const mappedName = CSS_DEPRECATED_SYSTEM_COLOR_MAP[key];
  if (!mappedName) return null;
  return {
    metadata: CSS_SYSTEM_COLOR_KEYWORDS[mappedName],
    deprecated: true,
    deprecatedName: String(name ?? '').trim(),
    specifiedName: String(name ?? '').trim(),
  };
}

function systemColorOptionValue(metadata, options = {}, specifiedName = '') {
  const table = options.systemColors ?? options.systemColorValues;
  if (!table || typeof table !== 'object') return undefined;
  const keys = [
    specifiedName,
    metadata.name,
    specifiedName.toLowerCase(),
    metadata.name.toLowerCase(),
  ].filter(Boolean);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  }
  return undefined;
}

function cssUnresolvedSystemColorReport(source, lookup) {
  const canonicalName = lookup.metadata.name;
  return {
    valid: true,
    resolved: false,
    source: String(source ?? ''),
    syntax: 'system-color',
    colorSpace: 'system',
    rgb: null,
    alpha: 1,
    rgba: null,
    components: [],
    componentReports: [],
    missingComponents: [],
    normalized: null,
    gamut: null,
    keyword: lookup.specifiedName,
    systemColor: lookup.metadata,
    canonicalName,
    deprecated: lookup.deprecated,
    deprecatedName: lookup.deprecatedName ?? null,
    mapsTo: lookup.deprecated ? canonicalName : null,
    errors: [],
    warnings: ['System color requires caller-provided systemColors to resolve to numeric RGB.'],
  };
}

export function cssNamedColorReport(value) {
  const source = String(value ?? '').trim();
  const key = source.toLowerCase();
  if (key === 'transparent') {
    return cssColorSuccess(source, 'named-color', [0, 0, 0], 0, {
      keyword: 'transparent',
      hex: '#00000000',
      namedColor: true,
      transparent: true,
    });
  }
  const hex = CSS_NAMED_COLORS[key];
  if (!hex) return cssColorError(source, 'named-color', 'Unknown CSS named color');
  const bytes = cssHexBytes(hex);
  const rgbValue = bytes.map((component) => component / 255);
  return cssColorSuccess(source, 'named-color', rgbValue, 1, {
    keyword: key,
    hex,
    namedColor: true,
    components: bytes,
    normalized: [...rgbValue, 1],
  });
}

export function cssSystemColorReport(value, options = {}) {
  const source = String(value ?? '').trim();
  const lookup = cssSystemColorLookup(source);
  if (!lookup) return cssColorError(source, 'system-color', 'Unknown CSS system color');
  const resolvedValue = systemColorOptionValue(lookup.metadata, options, source);
  if (resolvedValue != null) {
    const resolved = cssColorParseReport(resolvedValue, {
      ...options,
      systemColors: undefined,
      systemColorValues: undefined,
    });
    if (resolved.valid && resolved.resolved !== false) {
      return {
        ...resolved,
        source,
        syntax: 'system-color',
        keyword: source,
        resolved: true,
        resolvedFrom: String(resolvedValue),
        systemColor: lookup.metadata,
        canonicalName: lookup.metadata.name,
        deprecated: lookup.deprecated,
        deprecatedName: lookup.deprecatedName ?? null,
        mapsTo: lookup.deprecated ? lookup.metadata.name : null,
      };
    }
    return {
      ...resolved,
      source,
      syntax: 'system-color',
      keyword: source,
      systemColor: lookup.metadata,
      canonicalName: lookup.metadata.name,
      deprecated: lookup.deprecated,
      deprecatedName: lookup.deprecatedName ?? null,
      mapsTo: lookup.deprecated ? lookup.metadata.name : null,
      errors: [`System color ${source} resolved to invalid color: ${resolved.errors.join('; ')}`],
    };
  }
  return cssUnresolvedSystemColorReport(source, lookup);
}

export function cssSystemColorResolutionReport(systemColors = {}, options = {}) {
  const sourceMap = systemColors && typeof systemColors === 'object' ? systemColors : {};
  const names = Array.isArray(options.names) && options.names.length > 0
    ? options.names
    : Object.keys(CSS_SYSTEM_COLOR_KEYWORDS);
  const reports = names.map((name, index) => {
    const lookup = cssSystemColorLookup(name);
    if (!lookup) {
      return {
        index,
        name: String(name ?? ''),
        canonicalName: null,
        valid: false,
        resolved: false,
        value: null,
        rgb: null,
        rgba: null,
        errors: ['Unknown CSS system color'],
        report: null,
      };
    }
    const value = systemColorOptionValue(lookup.metadata, { systemColors: sourceMap }, lookup.specifiedName);
    const report = cssSystemColorReport(lookup.specifiedName, { systemColors: sourceMap });
    const errors = report.resolved === false
      ? [`CSS system color ${lookup.metadata.name} did not resolve to numeric RGB`]
      : report.errors;
    return {
      index,
      name: lookup.specifiedName,
      canonicalName: lookup.metadata.name,
      role: lookup.metadata.role,
      pair: lookup.metadata.pair,
      deprecated: lookup.deprecated,
      value: value == null ? null : String(value),
      valid: report.valid && report.resolved !== false,
      resolved: report.resolved !== false,
      colorSpace: report.colorSpace,
      rgb: report.rgb,
      rgba: report.rgba,
      errors,
      warnings: report.warnings,
      report,
    };
  });
  const byCanonicalName = new Map(reports.map((report) => [report.canonicalName, report]));
  const seenPairs = new Set();
  const pairReports = [];
  for (const report of reports) {
    if (!report.canonicalName || !report.pair || !byCanonicalName.has(report.pair)) continue;
    const key = [report.canonicalName, report.pair].sort().join('|');
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const pair = byCanonicalName.get(report.pair);
    const ratio = report.valid && pair.valid ? contrastRatio(report.rgb, pair.rgb) : 0;
    pairReports.push({
      pair: key,
      a: report.canonicalName,
      b: pair.canonicalName,
      roleA: report.role,
      roleB: pair.role,
      valid: report.valid && pair.valid,
      contrastRatio: ratio,
      passesAA: ratio >= 4.5,
      reports: [report, pair],
    });
  }
  const resolved = reports.filter((report) => report.valid);
  const unresolved = reports.filter((report) => !report.resolved);
  const invalid = reports.filter((report) => !report.valid);
  return {
    valid: invalid.length === 0,
    source: options.source ?? 'caller-provided-system-colors',
    requestedCount: names.length,
    resolvedCount: resolved.length,
    unresolvedCount: unresolved.length,
    invalidCount: invalid.length,
    pairCount: pairReports.length,
    reports,
    resolved,
    unresolved,
    invalid,
    pairReports,
    errors: invalid.flatMap((report) => report.errors.map((error) => `${report.name}: ${error}`)),
  };
}

export function cssColorParseReport(value, options = {}) {
  const source = String(value ?? '').trim();
  if (!source) return cssColorError(value, 'unknown', 'CSS color is empty');

  const hex = cssHexReport(source);
  if (hex) return hex;

  const lower = source.toLowerCase();
  if (lower === 'transparent') {
    return cssColorSuccess(source, 'keyword', [0, 0, 0], 0, { keyword: 'transparent' });
  }
  if (lower === 'currentcolor') {
    if (options.currentColor != null) {
      const resolved = cssColorParseReport(options.currentColor);
      return {
        ...resolved,
        source,
        syntax: 'keyword',
        keyword: 'currentcolor',
        resolvedFrom: String(options.currentColor),
      };
    }
    return cssColorError(source, 'keyword', 'currentcolor requires an explicit currentColor option', { keyword: 'currentcolor' });
  }

  if (Object.prototype.hasOwnProperty.call(CSS_NAMED_COLORS, lower)) return cssNamedColorReport(source);
  if (cssSystemColorLookup(source)) return cssSystemColorReport(source, options);

  const parts = cssFunctionParts(source);
  if (!parts) {
    return cssColorError(source, 'unknown', 'Unsupported CSS color syntax');
  }

  if (cssFunctionBodyIsRelative(parts.body)) return cssRelativeColorFunctionReport(source, parts.name, parts.body, options);
  if (parts.name === 'rgb' || parts.name === 'rgba') return cssRgbFunctionReport(source, parts.body, parts.name);
  if (parts.name === 'hsl' || parts.name === 'hsla') return cssHslFunctionReport(source, parts.body, parts.name);
  if (parts.name === 'lab') return cssLabFunctionReport(source, parts.body, parts.name);
  if (parts.name === 'lch') return cssLchFunctionReport(source, parts.body, parts.name);
  if (parts.name === 'oklab') return cssOklabFunctionReport(source, parts.body, parts.name);
  if (parts.name === 'oklch') return cssOklchFunctionReport(source, parts.body, parts.name);
  if (parts.name === 'color') return cssColorFunctionReport(source, parts.body, options);

  return cssColorError(source, parts.name, `Unsupported CSS color function: ${parts.name}`);
}

function isColorArrayLike(value) {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number');
}

function isNumericColorArrayLike(value) {
  return isColorArrayLike(value) &&
    Number.isFinite(Number(value?.[0])) &&
    Number.isFinite(Number(value?.[1])) &&
    Number.isFinite(Number(value?.[2]));
}

function colorReportHasRgb(report) {
  return Boolean(report?.valid && report.resolved !== false && isNumericColorArrayLike(report.rgb));
}

function colorInputReport(value, options = {}) {
  if (typeof value === 'string') return cssColorParseReport(value, options);
  if (isColorArrayLike(value)) {
    const rgbValue = finiteRgb(value);
    const alpha = clamp(finiteColorChannel(value?.[3], 1), 0, 1);
    return cssColorSuccess(value, 'array', rgbValue, alpha, {
      sourceType: Array.isArray(value) ? 'array' : 'typed-array',
    });
  }
  if (value && typeof value === 'object') {
    const rawColor = value.color ?? value.value ?? value.rgba ?? value.rgb;
    if (rawColor != null && rawColor !== value) {
      const report = colorInputReport(rawColor, options);
      return {
        ...report,
        label: value.label ?? value.name ?? value.id ?? report.label,
        sourceObject: value,
      };
    }
  }
  return cssColorError(value, 'unknown', 'Unsupported color input');
}

function colorCandidateInput(candidate, index) {
  if (typeof candidate === 'string' || isColorArrayLike(candidate)) {
    return {
      label: typeof candidate === 'string' ? candidate : `candidate-${index}`,
      color: candidate,
    };
  }
  if (candidate && typeof candidate === 'object') {
    return {
      label: candidate.label ?? candidate.name ?? candidate.id ?? `candidate-${index}`,
      color: candidate.color ?? candidate.value ?? candidate.rgba ?? candidate.rgb,
    };
  }
  return {
    label: `candidate-${index}`,
    color: candidate,
  };
}

function colorCandidateList(candidates) {
  if (candidates == null) return [];
  if (typeof candidates === 'string' || isNumericColorArrayLike(candidates)) return [candidates];
  return Array.isArray(candidates) ? candidates : [candidates];
}

function finiteContrastThreshold(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function colorContrastThresholds(options = {}) {
  return {
    aa: finiteContrastThreshold(options.threshold ?? options.aaThreshold, 4.5),
    aaLarge: finiteContrastThreshold(options.largeTextThreshold ?? options.aaLargeThreshold, 3),
    aaa: finiteContrastThreshold(options.aaaThreshold, 7),
    aaaLarge: finiteContrastThreshold(options.aaaLargeThreshold, 4.5),
  };
}

function normalizedColorScheme(value) {
  const scheme = String(value ?? 'light').trim().toLowerCase();
  if (scheme === 'dark' || scheme === 'auto') return scheme;
  return 'light';
}

export function colorContrastChoiceReport(background, candidates = [[0, 0, 0], [1, 1, 1]], options = {}) {
  const parseOptions = options.parseOptions ?? options;
  const thresholds = colorContrastThresholds(options);
  const backgroundReport = colorInputReport(background, parseOptions);
  const rawCandidates = colorCandidateList(candidates);
  const candidateReports = rawCandidates.map((candidate, index) => {
    const input = colorCandidateInput(candidate, index);
    const parsed = colorInputReport(input.color, parseOptions);
    const ratio = colorReportHasRgb(backgroundReport) && colorReportHasRgb(parsed) ? contrastRatio(backgroundReport.rgb, parsed.rgb) : 0;
    return {
      index,
      label: String(input.label),
      source: parsed.source,
      syntax: parsed.syntax,
      valid: parsed.valid,
      resolved: parsed.resolved !== false,
      colorSpace: parsed.colorSpace,
      rgb: parsed.rgb,
      alpha: parsed.alpha,
      rgba: parsed.rgba,
      ratio,
      contrastRatio: ratio,
      score: thresholds.aa > 0 ? ratio / thresholds.aa : ratio,
      passesAA: ratio >= thresholds.aa,
      passesAALarge: ratio >= thresholds.aaLarge,
      passesAAA: ratio >= thresholds.aaa,
      passesAAALarge: ratio >= thresholds.aaaLarge,
      errors: parsed.errors,
      warnings: parsed.warnings,
      parseReport: parsed,
    };
  });
  const rankedCandidates = [...candidateReports].sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    return a.index - b.index;
  });
  const selected = rankedCandidates.find((candidate) => colorReportHasRgb(candidate)) ?? null;
  const selectedIndex = selected?.index ?? -1;
  const reports = candidateReports.map((candidate) => ({
    ...candidate,
    selected: candidate.index === selectedIndex,
  }));
  const rankedReports = rankedCandidates.map((candidate) => ({
    ...candidate,
    selected: candidate.index === selectedIndex,
  }));
  const errors = [
    ...backgroundReport.errors,
    ...reports.flatMap((candidate) => candidate.errors.map((error) => `${candidate.label}: ${error}`)),
  ];
  return {
    valid: colorReportHasRgb(backgroundReport) && Boolean(selected?.valid),
    background: backgroundReport,
    thresholds,
    candidateCount: reports.length,
    validCandidateCount: reports.filter((candidate) => candidate.valid).length,
    resolvedCandidateCount: reports.filter((candidate) => colorReportHasRgb(candidate)).length,
    passingAACandidateCount: reports.filter((candidate) => candidate.passesAA).length,
    candidates: reports,
    rankedCandidates: rankedReports,
    selectedIndex,
    selectedLabel: selected?.label ?? null,
    selectedColor: selected?.rgb ?? null,
    selectedRgba: selected?.rgba ?? null,
    selectedRatio: selected?.ratio ?? 0,
    passesAA: selected?.passesAA ?? false,
    passesAALarge: selected?.passesAALarge ?? false,
    passesAAA: selected?.passesAAA ?? false,
    passesAAALarge: selected?.passesAAALarge ?? false,
    errors,
  };
}

export function cssLightDarkColorReport(lightColor, darkColor, options = {}) {
  let lightInput = lightColor;
  let darkInput = darkColor;
  let config = options;
  let source = '';
  if (typeof lightColor === 'string') {
    const parts = cssFunctionParts(lightColor);
    const darkIsOptions = darkColor && typeof darkColor === 'object' && !isColorArrayLike(darkColor) &&
      darkColor.color == null && darkColor.value == null && darkColor.rgb == null && darkColor.rgba == null;
    if (parts?.name === 'light-dark' && (darkColor == null || darkIsOptions)) {
      const args = cssSplitTopLevelCommaArgs(parts.body);
      lightInput = args[0];
      darkInput = args[1];
      config = darkIsOptions ? darkColor : options;
      source = lightColor;
    }
  }
  const parseOptions = config.parseOptions ?? config;
  const scheme = normalizedColorScheme(config.scheme ?? config.colorScheme);
  const light = colorInputReport(lightInput, parseOptions);
  const dark = colorInputReport(darkInput, parseOptions);
  const background = config.background == null ? null : colorInputReport(config.background, parseOptions);
  let selectedScheme = scheme === 'dark' ? 'dark' : 'light';
  let contrastChoice = null;
  if (scheme === 'auto' && background?.valid) {
    contrastChoice = colorContrastChoiceReport(background.rgb, [
      { label: 'light', color: lightInput },
      { label: 'dark', color: darkInput },
    ], config);
    selectedScheme = contrastChoice.selectedLabel === 'dark' ? 'dark' : 'light';
  }
  const selected = selectedScheme === 'dark' ? dark : light;
  const selectedContrastRatio = colorReportHasRgb(background) && colorReportHasRgb(selected) ? contrastRatio(background.rgb, selected.rgb) : null;
  const errors = [
    ...light.errors.map((error) => `light: ${error}`),
    ...dark.errors.map((error) => `dark: ${error}`),
    ...(background?.errors ?? []).map((error) => `background: ${error}`),
  ];
  return {
    valid: light.valid && dark.valid && selected.valid,
    source,
    syntax: 'light-dark',
    scheme,
    selectedScheme,
    light,
    dark,
    background,
    contrastChoice,
    selected,
    selectedColor: selected.rgb,
    selectedRgba: selected.rgba,
    selectedContrastRatio,
    errors,
  };
}

export const rgbLuminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const rgbBrightness = (c) => (c[0] + c[1] + c[2]) / 3;
export const rgbMax = (c) => Math.max(c[0], c[1], c[2]);
export const rgbMin = (c) => Math.min(c[0], c[1], c[2]);

export const rgbInvert = (c) => [1 - c[0], 1 - c[1], 1 - c[2]];
export const rgbGrayscale = (c) => { const l = rgbLuminance(c); return [l, l, l]; };

export function rgbContrast(c, amount) {
  return [(c[0] - 0.5) * amount + 0.5, (c[1] - 0.5) * amount + 0.5, (c[2] - 0.5) * amount + 0.5];
}

export function rgbSaturateAmount(c, amount) {
  const l = rgbLuminance(c);
  return [l + (c[0] - l) * amount, l + (c[1] - l) * amount, l + (c[2] - l) * amount];
}

export function rgbBrighten(c, amount) {
  return [c[0] + amount, c[1] + amount, c[2] + amount];
}

// ============================================================================
// HEX CONVERSIONS
// ============================================================================

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255] : [0, 0, 0];
}

export function rgbToHex(c) {
  const r = Math.round(clamp(c[0], 0, 1) * 255);
  const g = Math.round(clamp(c[1], 0, 1) * 255);
  const b = Math.round(clamp(c[2], 0, 1) * 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function byteRgbToHex(r, g, b) {
  const rb = Math.round(clamp(r, 0, 255));
  const gb = Math.round(clamp(g, 0, 255));
  const bb = Math.round(clamp(b, 0, 255));
  return '#' + ((1 << 24) + (rb << 16) + (gb << 8) + bb).toString(16).slice(1);
}

export function hexToRgba(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex);
  if (!result) return [0, 0, 0, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
    result[4] ? parseInt(result[4], 16) / 255 : 1,
  ];
}

export function rgbaToHex(c) {
  const r = Math.round(clamp(c[0], 0, 1) * 255);
  const g = Math.round(clamp(c[1], 0, 1) * 255);
  const b = Math.round(clamp(c[2], 0, 1) * 255);
  const a = Math.round(clamp(c[3] ?? 1, 0, 1) * 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1) + a.toString(16).padStart(2, '0');
}

// Integer hex (0xRRGGBB)
export function intToRgb(int) {
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
}

export function rgbToInt(c) {
  const r = Math.round(clamp(c[0], 0, 1) * 255);
  const g = Math.round(clamp(c[1], 0, 1) * 255);
  const b = Math.round(clamp(c[2], 0, 1) * 255);
  return (r << 16) | (g << 8) | b;
}

// ============================================================================
// HSL (Hue, Saturation, Lightness)
// ============================================================================

export function rgbToHsl(c) {
  const r = c[0], g = c[1], b = c[2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return [h, s, l];
}

export function hslToRgb(c) {
  const h = c[0], s = c[1], l = c[2];

  if (s === 0) return [l, l, l];

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1/3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1/3)];
}

export const hslLerp = (a, b, t) => hslToRgb([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);

// ============================================================================
// HSV (Hue, Saturation, Value)
// ============================================================================

export function rgbToHsv(c) {
  const r = c[0], g = c[1], b = c[2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return [h, s, v];
}

export function hsvToRgb(c) {
  const h = c[0] * 6, s = c[1], v = c[2];
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
    default: return [0, 0, 0];
  }
}

// ============================================================================
// XYZ / LAB (CIE L*a*b*)
// ============================================================================

export function rgbToXyz(c) {
  let r = c[0], g = c[1], b = c[2];

  // sRGB to linear
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  ];
}

const XYZ_D65_TO_D50_BRADFORD = Object.freeze([
  Object.freeze([1.0479298208405488, 0.022946793341019088, -0.05019222954313557]),
  Object.freeze([0.029627815688159344, 0.990434484573249, -0.01707382502938514]),
  Object.freeze([-0.009243058152591178, 0.015055144896577895, 0.7518742899580008]),
]);

const XYZ_D50_TO_D65_BRADFORD = Object.freeze([
  Object.freeze([0.955473421488075, -0.02309845494876471, 0.06325924320057072]),
  Object.freeze([-0.0283697093338637, 1.0099953980813041, 0.021041441191917323]),
  Object.freeze([0.012314014864481998, -0.020507649298898964, 1.330365926242124]),
]);

function xyzMatrixTransform(xyz, matrix) {
  const x = finiteColorChannel(xyz?.[0]);
  const y = finiteColorChannel(xyz?.[1]);
  const z = finiteColorChannel(xyz?.[2]);
  return matrix.map((row) => row[0] * x + row[1] * y + row[2] * z);
}

export function xyzD65ToD50(xyz) {
  return xyzMatrixTransform(xyz, XYZ_D65_TO_D50_BRADFORD);
}

export function xyzD50ToD65(xyz) {
  return xyzMatrixTransform(xyz, XYZ_D50_TO_D65_BRADFORD);
}

function rgbToCssXyzComponents(rgbValue, colorSpace) {
  const xyz = rgbToXyz(rgbValue);
  return colorSpace === 'xyz-d50' ? xyzD65ToD50(xyz) : xyz;
}

function xyzCssComponentsToRgb(components, colorSpace) {
  const xyz = colorSpace === 'xyz-d50' ? xyzD50ToD65(components) : components;
  return xyzToRgb(xyz);
}

export function xyzToRgb(c) {
  let r = c[0] * 3.2404542 - c[1] * 1.5371385 - c[2] * 0.4985314;
  let g = -c[0] * 0.9692660 + c[1] * 1.8760108 + c[2] * 0.0415560;
  let b = c[0] * 0.0556434 - c[1] * 0.2040259 + c[2] * 1.0572252;

  // Linear to sRGB
  r = r > 0.0031308 ? 1.055 * Math.pow(r, 1/2.4) - 0.055 : 12.92 * r;
  g = g > 0.0031308 ? 1.055 * Math.pow(g, 1/2.4) - 0.055 : 12.92 * g;
  b = b > 0.0031308 ? 1.055 * Math.pow(b, 1/2.4) - 0.055 : 12.92 * b;

  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
}

export function xyzToLab(c) {
  // D65 white point
  let x = c[0] / 0.95047;
  let y = c[1] / 1.0;
  let z = c[2] / 1.08883;

  const f = (t) => t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + 16/116;

  x = f(x);
  y = f(y);
  z = f(z);

  return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
}

export function labToXyz(c) {
  let y = (c[0] + 16) / 116;
  let x = c[1] / 500 + y;
  let z = y - c[2] / 200;

  const f = (t) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16/116) / 7.787;
  };

  return [f(x) * 0.95047, f(y) * 1.0, f(z) * 1.08883];
}

export const rgbToLab = (c) => xyzToLab(rgbToXyz(c));
export const labToRgb = (c) => xyzToRgb(labToXyz(c));

// Lab color distance (Delta E)
export function labDistance(a, b) {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

export const rgbDistance = (a, b) => labDistance(rgbToLab(a), rgbToLab(b));

// ============================================================================
// LCH (Lightness, Chroma, Hue) - Polar LAB
// ============================================================================

export function labToLch(c) {
  const l = c[0];
  const ch = Math.sqrt(c[1] * c[1] + c[2] * c[2]);
  let h = Math.atan2(c[2], c[1]) / (Math.PI * 2);
  if (h < 0) h += 1;
  return [l, ch, h];
}

export function lchToLab(c) {
  const h = c[2] * Math.PI * 2;
  return [c[0], c[1] * Math.cos(h), c[1] * Math.sin(h)];
}

export const rgbToLch = (c) => labToLch(rgbToLab(c));
export const lchToRgb = (c) => labToRgb(lchToLab(c));

// ============================================================================
// OKLAB / OKLCH (Perceptually uniform)
// ============================================================================

export function rgbToOklab(c) {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);

  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToRgb(c) {
  const l_ = c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2];
  const m_ = c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2];
  const s_ = c[0] - 0.0894841775 * c[1] - 1.2914855480 * c[2];

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, 0, 1),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, 0, 1),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s, 0, 1),
  ];
}

export function oklabToOklch(c) {
  const l = c[0];
  const ch = Math.sqrt(c[1] * c[1] + c[2] * c[2]);
  let h = Math.atan2(c[2], c[1]) / (Math.PI * 2);
  if (h < 0) h += 1;
  return [l, ch, h];
}

export function oklchToOklab(c) {
  const h = c[2] * Math.PI * 2;
  return [c[0], c[1] * Math.cos(h), c[1] * Math.sin(h)];
}

export const rgbToOklch = (c) => oklabToOklch(rgbToOklab(c));
export const oklchToRgb = (c) => oklabToRgb(oklchToOklab(c));

// Perceptual lerp using Oklab
export function rgbLerpOklab(a, b, t) {
  const labA = rgbToOklab(a);
  const labB = rgbToOklab(b);
  return oklabToRgb([lerp(labA[0], labB[0], t), lerp(labA[1], labB[1], t), lerp(labA[2], labB[2], t)]);
}

// ============================================================================
// COLOR TEMPERATURE
// ============================================================================

export function kelvinToRgb(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    if (temp <= 19) b = 0;
    else b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  return [clamp(r / 255, 0, 1), clamp(g / 255, 0, 1), clamp(b / 255, 0, 1)];
}

// ============================================================================
// BLEND MODES
// ============================================================================

export const blendNormal = (base, blend) => blend;
export const blendMultiply = (base, blend) => [base[0] * blend[0], base[1] * blend[1], base[2] * blend[2]];
export const blendScreen = (base, blend) => [1 - (1 - base[0]) * (1 - blend[0]), 1 - (1 - base[1]) * (1 - blend[1]), 1 - (1 - base[2]) * (1 - blend[2])];
export const blendOverlay = (base, blend) => base.map((b, i) => b < 0.5 ? 2 * b * blend[i] : 1 - 2 * (1 - b) * (1 - blend[i]));
export const blendDarken = (base, blend) => [Math.min(base[0], blend[0]), Math.min(base[1], blend[1]), Math.min(base[2], blend[2])];
export const blendLighten = (base, blend) => [Math.max(base[0], blend[0]), Math.max(base[1], blend[1]), Math.max(base[2], blend[2])];
export const blendDifference = (base, blend) => [Math.abs(base[0] - blend[0]), Math.abs(base[1] - blend[1]), Math.abs(base[2] - blend[2])];
export const blendExclusion = (base, blend) => [base[0] + blend[0] - 2 * base[0] * blend[0], base[1] + blend[1] - 2 * base[1] * blend[1], base[2] + blend[2] - 2 * base[2] * blend[2]];
export const blendAdd = (base, blend) => [clamp(base[0] + blend[0], 0, 1), clamp(base[1] + blend[1], 0, 1), clamp(base[2] + blend[2], 0, 1)];
export const blendSubtract = (base, blend) => [clamp(base[0] - blend[0], 0, 1), clamp(base[1] - blend[1], 0, 1), clamp(base[2] - blend[2], 0, 1)];

export function blendSoftLight(base, blend) {
  return base.map((b, i) => {
    const bl = blend[i];
    if (bl < 0.5) return b - (1 - 2 * bl) * b * (1 - b);
    return b + (2 * bl - 1) * (b < 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b) - b);
  });
}

export function blendHardLight(base, blend) {
  return blendOverlay(blend, base);
}

export function blendColorDodge(base, blend) {
  return base.map((b, i) => blend[i] === 1 ? 1 : Math.min(1, b / (1 - blend[i])));
}

export function blendColorBurn(base, blend) {
  return base.map((b, i) => blend[i] === 0 ? 0 : Math.max(0, 1 - (1 - b) / blend[i]));
}

// ============================================================================
// GRADIENT
// ============================================================================

export function gradientLinear(stops, t) {
  // stops: [{position: 0, color: [r,g,b]}, ...]
  if (stops.length === 0) return [0, 0, 0];
  if (stops.length === 1 || t <= stops[0].position) return stops[0].color;
  if (t >= stops[stops.length - 1].position) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].position && t <= stops[i + 1].position) {
      const localT = (t - stops[i].position) / (stops[i + 1].position - stops[i].position);
      return rgbLerp(stops[i].color, stops[i + 1].color, localT);
    }
  }
  return stops[stops.length - 1].color;
}

export function gradientOklab(stops, t) {
  if (stops.length === 0) return [0, 0, 0];
  if (stops.length === 1 || t <= stops[0].position) return stops[0].color;
  if (t >= stops[stops.length - 1].position) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].position && t <= stops[i + 1].position) {
      const localT = (t - stops[i].position) / (stops[i + 1].position - stops[i].position);
      return rgbLerpOklab(stops[i].color, stops[i + 1].color, localT);
    }
  }
  return stops[stops.length - 1].color;
}

// ============================================================================
// PALETTE GENERATION
// ============================================================================

export function paletteAnalogous(baseHue, count = 5, spread = 30) {
  const colors = [];
  const step = spread / (count - 1);
  for (let i = 0; i < count; i++) {
    const h = fract(baseHue + (i - Math.floor(count / 2)) * step / 360);
    colors.push(hslToRgb([h, 0.7, 0.5]));
  }
  return colors;
}

export function paletteComplementary(baseHue) {
  return [hslToRgb([baseHue, 0.7, 0.5]), hslToRgb([fract(baseHue + 0.5), 0.7, 0.5])];
}

export function paletteTriadic(baseHue) {
  return [
    hslToRgb([baseHue, 0.7, 0.5]),
    hslToRgb([fract(baseHue + 1/3), 0.7, 0.5]),
    hslToRgb([fract(baseHue + 2/3), 0.7, 0.5]),
  ];
}

export function paletteSplitComplementary(baseHue, spread = 30) {
  return [
    hslToRgb([baseHue, 0.7, 0.5]),
    hslToRgb([fract(baseHue + 0.5 - spread/360), 0.7, 0.5]),
    hslToRgb([fract(baseHue + 0.5 + spread/360), 0.7, 0.5]),
  ];
}

export function paletteTetradic(baseHue) {
  return [
    hslToRgb([baseHue, 0.7, 0.5]),
    hslToRgb([fract(baseHue + 0.25), 0.7, 0.5]),
    hslToRgb([fract(baseHue + 0.5), 0.7, 0.5]),
    hslToRgb([fract(baseHue + 0.75), 0.7, 0.5]),
  ];
}

export function paletteMonochromatic(baseHue, count = 5) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const l = 0.2 + (i / (count - 1)) * 0.6;
    colors.push(hslToRgb([baseHue, 0.5, l]));
  }
  return colors;
}

// ============================================================================
// COMMON COLOR PRESETS
// ============================================================================

export const COLOR_WHITE = [1, 1, 1];
export const COLOR_BLACK = [0, 0, 0];
export const COLOR_RED = [1, 0, 0];
export const COLOR_GREEN = [0, 1, 0];
export const COLOR_BLUE = [0, 0, 1];
export const COLOR_YELLOW = [1, 1, 0];
export const COLOR_CYAN = [0, 1, 1];
export const COLOR_MAGENTA = [1, 0, 1];
export const COLOR_ORANGE = [1, 0.5, 0];
export const COLOR_PURPLE = [0.5, 0, 0.5];
export const COLOR_GRAY = [0.5, 0.5, 0.5];
