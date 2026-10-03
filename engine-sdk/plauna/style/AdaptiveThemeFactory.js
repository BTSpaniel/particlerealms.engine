// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  contrastRatio as mathContrastRatio,
  cssColorParseReport,
  relativeLuminance as mathRelativeLuminance,
  rgbLerp,
  rgbToHex as mathRgbToHex,
} from '../../engine/core/math/MathColor.js';
import { clamp, lerp } from '../../engine/core/math/MathScalar.js';
import { tokens } from './DesignTokens.js';

const DEFAULT_COMPONENT_DENSITY = {
  compact: {
    scale: 0.92,
    gap: 6,
    paddingX: 10,
    paddingY: 8,
    radius: 10,
    fontSize: 13,
    lineHeight: 1.35
  },
  cozy: {
    scale: 0.98,
    gap: 8,
    paddingX: 12,
    paddingY: 10,
    radius: 12,
    fontSize: 14,
    lineHeight: 1.4
  },
  comfortable: {
    scale: 1,
    gap: 10,
    paddingX: 14,
    paddingY: 12,
    radius: 14,
    fontSize: 15,
    lineHeight: 1.45
  },
  expanded: {
    scale: 1.04,
    gap: 12,
    paddingX: 16,
    paddingY: 14,
    radius: 16,
    fontSize: 16,
    lineHeight: 1.5
  }
};

function round(value, precision = 0) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toChannel(value) {
  return clamp(Math.round(value), 0, 255);
}

function parseColor(color) {
  if (!color && color !== 0) {
    return null;
  }

  if (typeof color === 'object' && color && 'r' in color && 'g' in color && 'b' in color) {
    return {
      r: toChannel(color.r),
      g: toChannel(color.g),
      b: toChannel(color.b),
      a: clamp(color.a ?? 1, 0, 1)
    };
  }

  if (typeof color !== 'string') {
    return null;
  }

  const value = color.trim();
  const report = cssColorParseReport(value);
  if (!report.valid || report.resolved === false || !Array.isArray(report.rgb)) {
    return null;
  }

  return {
    r: toChannel(report.rgb[0] * 255),
    g: toChannel(report.rgb[1] * 255),
    b: toChannel(report.rgb[2] * 255),
    a: clamp(report.alpha ?? 1, 0, 1)
  };
}

function rgbaString({ r, g, b, a = 1 }) {
  const alpha = round(clamp(a, 0, 1), 3);
  return `rgba(${toChannel(r)}, ${toChannel(g)}, ${toChannel(b)}, ${alpha})`;
}

function colorToHex(color) {
  const parsed = parseColor(color);
  if (!parsed) {
    return typeof color === 'string' ? color : '#000000';
  }

  return mathRgbToHex([parsed.r / 255, parsed.g / 255, parsed.b / 255]);
}

function mixColors(colorA, colorB, amount = 0.5) {
  const parsedA = parseColor(colorA);
  const parsedB = parseColor(colorB);

  if (!parsedA) return colorToHex(colorB || '#000000');
  if (!parsedB) return colorToHex(colorA || '#000000');

  const t = clamp(amount, 0, 1);
  const [r, g, b] = rgbLerp(
    [parsedA.r, parsedA.g, parsedA.b],
    [parsedB.r, parsedB.g, parsedB.b],
    t
  );
  return rgbaString({
    r,
    g,
    b,
    a: lerp(parsedA.a, parsedB.a, t)
  });
}

function applyAlpha(color, alpha = 1) {
  const parsed = parseColor(color);
  if (!parsed) {
    return color;
  }

  return rgbaString({
    ...parsed,
    a: alpha
  });
}

function relativeLuminance(color) {
  const parsed = parseColor(color);
  if (!parsed) {
    return 0.5;
  }

  return mathRelativeLuminance([
    parsed.r / 255,
    parsed.g / 255,
    parsed.b / 255
  ]);
}

function contrastRatio(colorA, colorB) {
  const a = parseColor(colorA);
  const b = parseColor(colorB);
  if (!a || !b) {
    const l1 = relativeLuminance(colorA);
    const l2 = relativeLuminance(colorB);
    const light = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
  }
  return mathContrastRatio(
    [a.r / 255, a.g / 255, a.b / 255],
    [b.r / 255, b.g / 255, b.b / 255]
  );
}

function isDarkColor(color) {
  return relativeLuminance(color) < 0.45;
}

function ensureContrast(foreground, background, minimumRatio = 4.5) {
  const parsedForeground = parseColor(foreground);
  const bg = background;

  if (!parsedForeground) {
    return foreground || bg;
  }

  let candidate = foreground;
  if (contrastRatio(candidate, bg) >= minimumRatio) {
    return candidate;
  }

  const preferLight = isDarkColor(bg);
  const target = preferLight ? '#ffffff' : '#000000';
  let blendAmount = 0.15;

  while (blendAmount <= 1) {
    candidate = mixColors(foreground, target, blendAmount);
    if (contrastRatio(candidate, bg) >= minimumRatio) {
      return candidate;
    }
    blendAmount += 0.1;
  }

  return target;
}

function resolvePaletteColor(entry, shade, fallback) {
  if (typeof entry === 'string' && entry.trim()) {
    return entry;
  }

  if (isObject(entry)) {
    if (shade in entry && entry[shade]) {
      return entry[shade];
    }
    if ('default' in entry && entry.default) {
      return entry.default;
    }
  }

  return fallback;
}

function resolveThemeSource(themeSource) {
  if (!themeSource) {
    return tokens.tokens || {};
  }

  if (themeSource.tokens) {
    return themeSource.tokens;
  }

  return themeSource;
}

export class AdaptiveThemeFactory {
  constructor() {
    this.cache = new Map();
  }

  getDensity(context = {}) {
    if (context.density) {
      return context.density;
    }

    const width = Number(context.containerWidth || context.width || 0);
    if (width > 0) {
      if (width < 280) return 'compact';
      if (width < 420) return 'cozy';
      if (width < 720) return 'comfortable';
      return 'expanded';
    }

    if (context.widgetType === 'tooltip' || context.widgetType === 'badge') {
      return 'compact';
    }

    return 'comfortable';
  }

  getCacheKey(source, context) {
    const colors = source?.colors || {};
    const signature = {
      themeId: context.themeId || source?.id || source?.name || 'theme',
      widgetType: context.widgetType || 'global',
      variant: context.variant || 'default',
      density: this.getDensity(context),
      width: context.containerWidth || context.width || 0,
      nearbyColor: context.nearbyColor || '',
      accentColor: context.accentColor || '',
      background: resolvePaletteColor(colors.background, 'primary', tokens.get('colors.background.primary', '#ffffff')),
      primary: resolvePaletteColor(colors.primary, 500, tokens.get('colors.primary.500', '#0ea5e9'))
    };

    return JSON.stringify(signature);
  }

  buildSemanticColors(source, context) {
    const colors = source.colors || {};
    const baseBackground = resolvePaletteColor(colors.background, 'primary', tokens.get('colors.background.primary', '#ffffff'));
    const baseSurface = resolvePaletteColor(colors.surface, 'default', resolvePaletteColor(colors.background, 'secondary', baseBackground));
    const baseText = resolvePaletteColor(colors.text, 'primary', tokens.get('colors.text.primary', '#0f172a'));
    const primary = resolvePaletteColor(colors.primary, 500, tokens.get('colors.primary.500', '#0ea5e9'));
    const secondary = resolvePaletteColor(colors.secondary, 500, tokens.get('colors.secondary.500', '#475569'));
    const accent = resolvePaletteColor(colors.accent, 500, tokens.get('colors.accent.500', '#8b5cf6'));
    const success = resolvePaletteColor(colors.success, 'default', tokens.get('colors.success', '#10b981'));
    const warning = resolvePaletteColor(colors.warning, 'default', tokens.get('colors.warning', '#f59e0b'));
    const error = resolvePaletteColor(colors.error, 'default', tokens.get('colors.error', '#ef4444'));
    const info = resolvePaletteColor(colors.info, 'default', tokens.get('colors.info', '#3b82f6'));
    const nearbyColor = context.nearbyColor || context.accentColor || primary;
    const darkMode = isDarkColor(baseBackground);

    const surfaceTint = mixColors(baseSurface, nearbyColor, darkMode ? 0.14 : 0.08);
    const surfaceContainerLowest = mixColors(baseSurface, darkMode ? '#ffffff' : '#000000', darkMode ? 0.04 : 0.02);
    const surfaceContainerLow = mixColors(baseSurface, darkMode ? '#ffffff' : '#000000', darkMode ? 0.08 : 0.05);
    const surfaceContainer = mixColors(baseSurface, nearbyColor, darkMode ? 0.08 : 0.05);
    const surfaceContainerHigh = mixColors(baseSurface, nearbyColor, darkMode ? 0.14 : 0.09);
    const surfaceContainerHighest = mixColors(baseSurface, nearbyColor, darkMode ? 0.2 : 0.12);

    const onSurface = ensureContrast(baseText, surfaceContainerHighest, 4.5);
    const onSurfaceVariant = ensureContrast(mixColors(baseText, baseBackground, darkMode ? 0.45 : 0.62), surfaceContainer, 3.2);
    const outline = ensureContrast(mixColors(baseText, baseBackground, darkMode ? 0.55 : 0.7), baseSurface, 2.2);
    const outlineVariant = mixColors(outline, baseSurface, darkMode ? 0.45 : 0.32);

    const primaryContainer = mixColors(baseSurface, primary, darkMode ? 0.22 : 0.12);
    const secondaryContainer = mixColors(baseSurface, secondary, darkMode ? 0.18 : 0.1);
    const accentContainer = mixColors(baseSurface, accent, darkMode ? 0.18 : 0.1);
    const successContainer = mixColors(baseSurface, success, darkMode ? 0.18 : 0.1);
    const warningContainer = mixColors(baseSurface, warning, darkMode ? 0.18 : 0.1);
    const errorContainer = mixColors(baseSurface, error, darkMode ? 0.18 : 0.1);
    const infoContainer = mixColors(baseSurface, info, darkMode ? 0.18 : 0.1);

    const onPrimaryContainer = ensureContrast(baseText, primaryContainer, 4.5);
    const onSecondaryContainer = ensureContrast(baseText, secondaryContainer, 4.5);
    const onAccentContainer = ensureContrast(baseText, accentContainer, 4.5);
    const onSuccessContainer = ensureContrast(baseText, successContainer, 4.5);
    const onWarningContainer = ensureContrast(baseText, warningContainer, 4.5);
    const onErrorContainer = ensureContrast(baseText, errorContainer, 4.5);
    const onInfoContainer = ensureContrast(baseText, infoContainer, 4.5);

    const stateLayer = applyAlpha(primary, darkMode ? 0.18 : 0.12);
    const stateLayerHover = applyAlpha(primary, darkMode ? 0.22 : 0.15);
    const stateLayerPressed = applyAlpha(primary, darkMode ? 0.3 : 0.2);
    const overlay = applyAlpha('#000000', darkMode ? 0.48 : 0.28);
    const tooltipBg = mixColors(baseSurface, darkMode ? '#000000' : '#ffffff', darkMode ? 0.18 : 0.08);
    const tooltipFg = ensureContrast(baseText, tooltipBg, 4.5);
    const tooltipBorder = mixColors(outlineVariant, tooltipBg, 0.3);

    const shadowColor = darkMode ? 'rgba(0, 0, 0, 0.45)' : 'rgba(15, 23, 42, 0.16)';
    const surfaceShadow = darkMode
      ? `0 18px 40px ${shadowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.06)`
      : `0 14px 32px ${shadowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.22)`;

    return {
      background: {
        primary: baseBackground,
        secondary: baseSurface,
        tertiary: surfaceContainer,
        disabled: surfaceContainerLow,
        inverse: darkMode ? '#f8fafc' : '#0f172a'
      },
      text: {
        primary: onSurface,
        secondary: onSurfaceVariant,
        tertiary: ensureContrast(mixColors(onSurfaceVariant, baseSurface, 0.5), baseSurface, 3),
        muted: onSurfaceVariant,
        inverse: darkMode ? '#0f172a' : '#f8fafc',
        disabled: ensureContrast(mixColors(onSurfaceVariant, baseSurface, 0.6), baseSurface, 2)
      },
      surface: baseSurface,
      backgroundPrimary: baseBackground,
      backgroundSecondary: baseSurface,
      backgroundTertiary: surfaceContainer,
      backgroundDisabled: surfaceContainerLow,
      backgroundInverse: darkMode ? '#f8fafc' : '#0f172a',
      textPrimary: onSurface,
      textSecondary: onSurfaceVariant,
      textTertiary: ensureContrast(mixColors(onSurfaceVariant, baseSurface, 0.5), baseSurface, 3),
      textMuted: onSurfaceVariant,
      textDisabled: ensureContrast(mixColors(onSurfaceVariant, baseSurface, 0.6), baseSurface, 2),
      surfaceContainerLowest,
      surfaceContainerLow,
      surfaceContainer,
      surfaceContainerHigh,
      surfaceContainerHighest,
      surfaceTint,
      onSurface,
      onSurfaceVariant,
      outline,
      outlineVariant,
      border: outlineVariant,
      borderLight: mixColors(outlineVariant, baseSurface, 0.5),
      borderMedium: outline,
      borderDark: ensureContrast(mixColors(outline, baseBackground, darkMode ? 0.32 : 0.2), baseSurface, 2),
      borderDisabled: mixColors(outlineVariant, baseSurface, 0.7),
      primary,
      onPrimary: ensureContrast(darkMode ? '#ffffff' : '#ffffff', primary, 4.5),
      primaryContainer,
      onPrimaryContainer,
      primaryHover: mixColors(primary, darkMode ? '#ffffff' : '#000000', darkMode ? 0.16 : 0.08),
      secondary,
      onSecondary: ensureContrast(darkMode ? '#ffffff' : '#ffffff', secondary, 4.5),
      secondaryContainer,
      onSecondaryContainer,
      accent,
      onAccent: ensureContrast(darkMode ? '#ffffff' : '#ffffff', accent, 4.5),
      accentContainer,
      onAccentContainer,
      success,
      onSuccess: ensureContrast(darkMode ? '#ffffff' : '#ffffff', success, 4.5),
      successContainer,
      onSuccessContainer,
      warning,
      onWarning: ensureContrast(darkMode ? '#111827' : '#111827', warning, 4.5),
      warningContainer,
      onWarningContainer,
      error,
      onError: ensureContrast('#ffffff', error, 4.5),
      errorContainer,
      onErrorContainer,
      info,
      onInfo: ensureContrast('#ffffff', info, 4.5),
      infoContainer,
      onInfoContainer,
      stateLayer,
      stateLayerHover,
      stateLayerPressed,
      surfaceHover: stateLayerHover,
      surfacePressed: stateLayerPressed,
      overlay,
      tooltipBg,
      tooltipFg,
      tooltip: tooltipBg,
      tooltipText: tooltipFg,
      tooltipBorder,
      inputBg: surfaceContainerLowest,
      inputText: onSurface,
      inputBorder: outlineVariant,
      inputPlaceholder: onSurfaceVariant,
      shadowColor,
      surfaceShadow
    };
  }

  buildDensity(context = {}) {
    const densityKey = this.getDensity(context);
    return DEFAULT_COMPONENT_DENSITY[densityKey] || DEFAULT_COMPONENT_DENSITY.comfortable;
  }

  buildComponentMetrics(widgetType, context, semantic) {
    const density = this.buildDensity(context);
    const baseRadius = density.radius;
    const baseFontSize = density.fontSize;
    const baseGap = density.gap;
    const basePaddingX = density.paddingX;
    const basePaddingY = density.paddingY;

    const sizes = {
      avatar: {
        fontSize: baseFontSize + 1,
        size: widgetType === 'avatar' && context.size === 'lg' ? 56 : widgetType === 'avatar' && context.size === 'sm' ? 32 : 40,
        radius: 9999,
        border: semantic.outlineVariant,
        background: semantic.surfaceContainerHigh,
        color: semantic.onSurface,
        shadow: semantic.surfaceShadow
      },
      badge: {
        fontSize: baseFontSize - 2,
        paddingX: Math.max(8, basePaddingX - 4),
        paddingY: Math.max(4, basePaddingY - 6),
        radius: 9999,
        gap: 4,
        border: semantic.outlineVariant
      },
      chip: {
        fontSize: baseFontSize - 1,
        paddingX: basePaddingX,
        paddingY: Math.max(6, basePaddingY - 4),
        radius: 9999,
        gap: baseGap,
        border: semantic.outlineVariant
      },
      tooltip: {
        fontSize: baseFontSize - 1,
        paddingX: basePaddingX,
        paddingY: basePaddingY - 2,
        radius: baseRadius + 2,
        maxWidth: context.maxWidth ? Number(context.maxWidth) : 320,
        border: semantic.tooltipBorder,
        background: semantic.tooltipBg,
        color: semantic.tooltipFg,
        shadow: semantic.surfaceShadow
      },
      field: {
        fontSize: baseFontSize,
        paddingX: basePaddingX,
        paddingY: basePaddingY,
        radius: baseRadius + 2,
        minHeight: Math.max(36, Math.round(36 * density.scale)),
        border: semantic.outlineVariant,
        background: semantic.surfaceContainerLowest,
        color: semantic.onSurface,
        focusBorder: semantic.primary,
        shadow: semantic.surfaceShadow
      },
      button: {
        fontSize: baseFontSize,
        paddingX: basePaddingX + 2,
        paddingY: Math.max(8, basePaddingY - 2),
        radius: baseRadius + 4,
        minHeight: Math.max(34, Math.round(38 * density.scale)),
        border: semantic.outlineVariant,
        background: semantic.surfaceContainerHigh,
        color: semantic.onSurface
      },
      switch: {
        trackWidth: context.size === 'lg' ? 52 : context.size === 'sm' ? 36 : 44,
        trackHeight: context.size === 'lg' ? 28 : context.size === 'sm' ? 18 : 22,
        thumbSize: context.size === 'lg' ? 22 : context.size === 'sm' ? 14 : 18,
        radius: 9999,
        gap: baseGap,
        trackOff: semantic.surfaceContainerHigh,
        trackOn: semantic.primary,
        thumbOff: semantic.onSurfaceVariant,
        thumbOn: semantic.onPrimary,
        shadow: semantic.surfaceShadow
      },
      select: {
        fontSize: baseFontSize,
        paddingX: basePaddingX,
        paddingY: basePaddingY,
        radius: baseRadius + 2,
        minHeight: Math.max(36, Math.round(40 * density.scale)),
        dropdownRadius: baseRadius + 4,
        optionPaddingX: basePaddingX,
        optionPaddingY: Math.max(8, basePaddingY - 2),
        panelBackground: semantic.surfaceContainerHighest,
        panelBorder: semantic.outlineVariant,
        optionHover: semantic.stateLayerHover,
        optionSelected: semantic.primaryContainer,
        optionSelectedText: semantic.onPrimaryContainer,
        shadow: semantic.surfaceShadow
      },
      textarea: {
        fontSize: baseFontSize,
        paddingX: basePaddingX,
        paddingY: basePaddingY,
        radius: baseRadius + 2,
        minHeight: Math.max(88, Math.round(96 * density.scale)),
        border: semantic.outlineVariant,
        background: semantic.surfaceContainerLowest,
        color: semantic.onSurface,
        focusBorder: semantic.primary,
        shadow: semantic.surfaceShadow
      }
    };

    return sizes[widgetType] || {
      fontSize: baseFontSize,
      paddingX: basePaddingX,
      paddingY: basePaddingY,
      radius: baseRadius,
      gap: baseGap,
      border: semantic.outlineVariant,
      background: semantic.surfaceContainer,
      color: semantic.onSurface,
      shadow: semantic.surfaceShadow
    };
  }

  buildVariables(semantic, components, palette = {}) {
    const palettePrimary = palette.primary || {};
    return {
      '--bg-primary': semantic.background.primary,
      '--bg-secondary': semantic.background.secondary,
      '--bg-tertiary': semantic.background.tertiary,
      '--bg-quaternary': semantic.background.inverse,
      '--text-primary': semantic.text.primary,
      '--text-secondary': semantic.text.secondary,
      '--text-muted': semantic.text.muted,
      '--text-disabled': semantic.text.disabled,
      '--border-light': semantic.borderLight,
      '--border-medium': semantic.borderMedium,
      '--border-dark': semantic.borderDark,
      '--border-subtle': semantic.background.tertiary,
      '--accent-primary': palettePrimary[500] || semantic.primary,
      '--accent-secondary': palettePrimary[300] || semantic.primaryHover,
      '--accent-warning': semantic.warning,
      '--accent-error': semantic.error,
      '--accent-success': semantic.success,
      '--surface': semantic.surface,
      '--surface-container-lowest': semantic.surfaceContainerLowest,
      '--surface-container-low': semantic.surfaceContainerLow,
      '--surface-container': semantic.surfaceContainer,
      '--surface-container-high': semantic.surfaceContainerHigh,
      '--surface-container-highest': semantic.surfaceContainerHighest,
      '--surface-tint': semantic.surfaceTint,
      '--on-surface': semantic.onSurface,
      '--on-surface-variant': semantic.onSurfaceVariant,
      '--outline': semantic.outline,
      '--outline-variant': semantic.outlineVariant,
      '--primary': semantic.primary,
      '--on-primary': semantic.onPrimary,
      '--primary-container': semantic.primaryContainer,
      '--on-primary-container': semantic.onPrimaryContainer,
      '--secondary': semantic.secondary,
      '--on-secondary': semantic.onSecondary,
      '--secondary-container': semantic.secondaryContainer,
      '--on-secondary-container': semantic.onSecondaryContainer,
      '--accent': semantic.accent,
      '--on-accent': semantic.onAccent,
      '--accent-container': semantic.accentContainer,
      '--on-accent-container': semantic.onAccentContainer,
      '--success': semantic.success,
      '--on-success': semantic.onSuccess,
      '--success-container': semantic.successContainer,
      '--on-success-container': semantic.onSuccessContainer,
      '--warning': semantic.warning,
      '--on-warning': semantic.onWarning,
      '--warning-container': semantic.warningContainer,
      '--on-warning-container': semantic.onWarningContainer,
      '--error': semantic.error,
      '--on-error': semantic.onError,
      '--error-container': semantic.errorContainer,
      '--on-error-container': semantic.onErrorContainer,
      '--info': semantic.info,
      '--on-info': semantic.onInfo,
      '--info-container': semantic.infoContainer,
      '--on-info-container': semantic.onInfoContainer,
      '--state-layer': semantic.stateLayer,
      '--state-layer-hover': semantic.stateLayerHover,
      '--state-layer-pressed': semantic.stateLayerPressed,
      '--overlay': semantic.overlay,
      '--tooltip-bg': semantic.tooltipBg,
      '--tooltip-fg': semantic.tooltipFg,
      '--tooltip-border': semantic.tooltipBorder,
      '--shadow-elevated': semantic.surfaceShadow,
      '--avatar-bg': semantic.surfaceContainerHigh,
      '--avatar-fg': semantic.onSurface,
      '--avatar-border': semantic.outlineVariant,
      '--avatar-shadow': semantic.surfaceShadow,
      '--badge-default-bg': semantic.surfaceContainer,
      '--badge-default-fg': semantic.onSurface,
      '--badge-default-border': semantic.outlineVariant,
      '--badge-primary-bg': semantic.primaryContainer,
      '--badge-primary-fg': semantic.onPrimaryContainer,
      '--badge-primary-border': semantic.primary,
      '--badge-secondary-bg': semantic.secondaryContainer,
      '--badge-secondary-fg': semantic.onSecondaryContainer,
      '--badge-secondary-border': semantic.secondary,
      '--badge-success-bg': semantic.successContainer,
      '--badge-success-fg': semantic.onSuccessContainer,
      '--badge-success-border': semantic.success,
      '--badge-warning-bg': semantic.warningContainer,
      '--badge-warning-fg': semantic.onWarningContainer,
      '--badge-warning-border': semantic.warning,
      '--badge-error-bg': semantic.errorContainer,
      '--badge-error-fg': semantic.onErrorContainer,
      '--badge-error-border': semantic.error,
      '--badge-info-bg': semantic.infoContainer,
      '--badge-info-fg': semantic.onInfoContainer,
      '--badge-info-border': semantic.info,
      '--chip-default-bg': semantic.surfaceContainer,
      '--chip-default-fg': semantic.onSurface,
      '--chip-default-border': semantic.outlineVariant,
      '--chip-primary-bg': semantic.primaryContainer,
      '--chip-primary-fg': semantic.onPrimaryContainer,
      '--chip-primary-border': semantic.primary,
      '--chip-secondary-bg': semantic.secondaryContainer,
      '--chip-secondary-fg': semantic.onSecondaryContainer,
      '--chip-secondary-border': semantic.secondary,
      '--chip-success-bg': semantic.successContainer,
      '--chip-success-fg': semantic.onSuccessContainer,
      '--chip-success-border': semantic.success,
      '--chip-warning-bg': semantic.warningContainer,
      '--chip-warning-fg': semantic.onWarningContainer,
      '--chip-warning-border': semantic.warning,
      '--chip-error-bg': semantic.errorContainer,
      '--chip-error-fg': semantic.onErrorContainer,
      '--chip-error-border': semantic.error,
      '--field-bg': semantic.surfaceContainerLowest,
      '--field-fg': semantic.onSurface,
      '--field-border': semantic.outlineVariant,
      '--field-focus-border': semantic.primary,
      '--field-placeholder': semantic.onSurfaceVariant,
      '--field-shadow': semantic.surfaceShadow,
      '--select-panel-bg': semantic.surfaceContainerHighest,
      '--select-panel-border': semantic.outlineVariant,
      '--select-option-hover': semantic.stateLayerHover,
      '--select-option-selected': semantic.primaryContainer,
      '--select-option-selected-fg': semantic.onPrimaryContainer,
      '--switch-track-off': semantic.surfaceContainerHigh,
      '--switch-track-on': semantic.primary,
      '--switch-thumb-off': semantic.onSurfaceVariant,
      '--switch-thumb-on': semantic.onPrimary,
      '--switch-shadow': semantic.surfaceShadow,
      '--density-scale': components?.adaptiveScale || 1,
      '--control-gap': `${components?.gap || 8}px`,
      '--control-padding-x': `${components?.paddingX || 12}px`,
      '--control-padding-y': `${components?.paddingY || 10}px`,
      '--control-radius': `${components?.radius || 12}px`,
      '--control-font-size': `${components?.fontSize || 14}px`
    };
  }

  createThemeTokens(themeSource = null, context = {}) {
    const source = resolveThemeSource(themeSource);
    const cacheKey = this.getCacheKey(source, context);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const semantic = this.buildSemanticColors(source, context);
    const widgetType = context.widgetType || 'global';
    const components = this.buildComponentMetrics(widgetType, context, semantic);
    const density = this.buildDensity(context);
    const adaptiveScale = density.scale;

    const resolved = {
      ...source,
      ...semantic,
      colors: {
        ...(source.colors || {}),
        backgroundPrimary: semantic.background.primary,
        backgroundSecondary: semantic.background.secondary,
        backgroundTertiary: semantic.background.tertiary,
        backgroundDisabled: semantic.background.disabled,
        backgroundInverse: semantic.background.inverse,
        textPrimary: semantic.text.primary,
        textSecondary: semantic.text.secondary,
        textTertiary: semantic.text.tertiary,
        textMuted: semantic.text.muted,
        textDisabled: semantic.text.disabled,
        surface: semantic.surface,
        surfaceContainerLowest: semantic.surfaceContainerLowest,
        surfaceContainerLow: semantic.surfaceContainerLow,
        surfaceContainer: semantic.surfaceContainer,
        surfaceContainerHigh: semantic.surfaceContainerHigh,
        surfaceContainerHighest: semantic.surfaceContainerHighest,
        surfaceTint: semantic.surfaceTint,
        onSurface: semantic.onSurface,
        onSurfaceVariant: semantic.onSurfaceVariant,
        outline: semantic.outline,
        outlineVariant: semantic.outlineVariant,
        border: semantic.border,
        borderLight: semantic.borderLight,
        borderMedium: semantic.borderMedium,
        borderDark: semantic.borderDark,
        borderDisabled: semantic.borderDisabled,
        onPrimary: semantic.onPrimary,
        primaryContainer: semantic.primaryContainer,
        onPrimaryContainer: semantic.onPrimaryContainer,
        primaryHover: semantic.primaryHover,
        onSecondary: semantic.onSecondary,
        secondaryContainer: semantic.secondaryContainer,
        onSecondaryContainer: semantic.onSecondaryContainer,
        onAccent: semantic.onAccent,
        accentContainer: semantic.accentContainer,
        onAccentContainer: semantic.onAccentContainer,
        onSuccess: semantic.onSuccess,
        successContainer: semantic.successContainer,
        onSuccessContainer: semantic.onSuccessContainer,
        onWarning: semantic.onWarning,
        warningContainer: semantic.warningContainer,
        onWarningContainer: semantic.onWarningContainer,
        onError: semantic.onError,
        errorContainer: semantic.errorContainer,
        onErrorContainer: semantic.onErrorContainer,
        onInfo: semantic.onInfo,
        infoContainer: semantic.infoContainer,
        onInfoContainer: semantic.onInfoContainer,
        stateLayer: semantic.stateLayer,
        stateLayerHover: semantic.stateLayerHover,
        stateLayerPressed: semantic.stateLayerPressed,
        surfaceHover: semantic.surfaceHover,
        surfacePressed: semantic.surfacePressed,
        overlay: semantic.overlay,
        tooltip: semantic.tooltip,
        tooltipText: semantic.tooltipText,
        tooltipBorder: semantic.tooltipBorder,
        inputBg: semantic.inputBg,
        inputText: semantic.inputText,
        inputBorder: semantic.inputBorder,
        inputPlaceholder: semantic.inputPlaceholder,
        shadowColor: semantic.shadowColor,
        surfaceShadow: semantic.surfaceShadow
      },
      roles: semantic,
      semantic,
      spacing: {
        ...(source.spacing || {}),
        controlGap: components.gap || density.gap,
        controlPaddingX: components.paddingX || density.paddingX,
        controlPaddingY: components.paddingY || density.paddingY
      },
      fontSizes: {
        ...(source.fontSizes || {}),
        control: `${components.fontSize || density.fontSize}px`
      },
      borderRadius: {
        ...(source.borderRadius || {}),
        control: `${components.radius || density.radius}px`
      },
      shadows: {
        ...(source.shadows || {}),
        elevated: semantic.surfaceShadow
      },
      components: {
        ...(source.components || {}),
        [widgetType]: components
      },
      adaptive: {
        density: this.getDensity(context),
        scale: adaptiveScale,
        widgetType,
        containerWidth: context.containerWidth || context.width || null
      }
    };

    resolved.variables = this.buildVariables(semantic, {
      ...components,
      adaptiveScale,
      gap: components.gap || density.gap,
      paddingX: components.paddingX || density.paddingX,
      paddingY: components.paddingY || density.paddingY,
      radius: components.radius || density.radius,
      fontSize: components.fontSize || density.fontSize
    }, source.colors || {});

    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  applyToElement(target, themeSource = null, context = {}) {
    if (!target || !target.style) {
      return null;
    }

    const resolved = this.createThemeTokens(themeSource, context);
    const variables = resolved.variables || {};

    for (const [name, value] of Object.entries(variables)) {
      target.style.setProperty(name, String(value));
    }

    return resolved;
  }

  clearCache() {
    this.cache.clear();
  }
}

export const adaptiveThemeFactory = new AdaptiveThemeFactory();
