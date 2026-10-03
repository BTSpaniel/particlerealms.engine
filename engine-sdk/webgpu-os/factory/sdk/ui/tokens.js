// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/tokens.js — design tokens (the single source of visual truth).
 *
 * Semantic tokens are exposed as CSS custom properties under the `--fx-` prefix
 * and fall back to the OS ThemeEngine variables (`--bg-*`, `--text-*`,
 * `--os-accent`, `--os-font`, `--os-radius`, …) when present, so the factory design system stays in sync with
 * the active OS theme while providing a refined, modern default look (soft
 * elevation, rounded geometry, accent gradients, smooth motion).
 *
 * Apps never hardcode colours/spacing — they reference tokens via token()
 * or the styled helpers in controls.js / components.js.
 */

export const TOKENS = Object.freeze({
  // ── Surfaces (elevation ladder) ──────────────────────────────────────────
  'bg-app':        'var(--bg-primary, #0b0e14)',
  'bg-surface':    'var(--bg-secondary, #11151d)',
  'bg-raised':     'var(--bg-tertiary, #161b26)',
  'bg-overlay':    'color-mix(in srgb, var(--bg-secondary, #11151d) 86%, transparent)',
  'bg-hover':      'var(--os-hover, rgba(255,255,255,0.05))',
  'bg-active':     'var(--os-hover-2, rgba(255,255,255,0.09))',
  'bg-input':      'var(--os-hover, rgba(255,255,255,0.04))',

  // ── Text ──────────────────────────────────────────────────────────────────
  'text':          'var(--text-primary, #e7ecf3)',
  'text-muted':    'var(--text-secondary, #9aa6b8)',
  'text-faint':    'var(--text-tertiary, #61708a)',
  'text-on-accent':'#04111a',

  // ── Border / lines ──────────────────────────────────────────────────────
  'border':        'var(--border-medium, rgba(255,255,255,0.10))',
  'border-strong': 'var(--border-strong, rgba(255,255,255,0.18))',
  'border-faint':  'var(--border-soft, rgba(255,255,255,0.06))',

  // ── Accent ──────────────────────────────────────────────────────────────
  'accent':        'var(--os-accent, var(--accent, #5eead4))',
  'accent-strong': 'var(--os-accent-2, var(--accent-strong, #2dd4bf))',
  'accent-soft':   'color-mix(in srgb, var(--fx-accent) 16%, transparent)',
  'accent-grad':   'linear-gradient(135deg, var(--fx-accent), var(--fx-accent-strong))',

  // Shared app chrome follows the selected theme, including light surfaces.
  'chrome-cool':   'color-mix(in srgb, var(--fx-info) 62%, var(--fx-accent-strong))',
  'chrome-border':'color-mix(in srgb, var(--fx-border) 78%, var(--fx-accent) 22%)',
  'chrome-ink':    'color-mix(in srgb, var(--fx-accent) 26%, var(--fx-text) 74%)',
  'success-ink':   'color-mix(in srgb, var(--fx-success) 32%, var(--fx-text) 68%)',
  'warning-ink':   'color-mix(in srgb, var(--fx-warning) 32%, var(--fx-text) 68%)',
  'danger-ink':    'color-mix(in srgb, var(--fx-danger) 32%, var(--fx-text) 68%)',

  // ── Status ─────────────────────────────────────────────────────────────
  'success':       '#3fb950',
  'warning':       '#e3b341',
  'danger':        '#f85149',
  'info':          '#58a6ff',

  // ── Spacing scale (4px base) ──────────────────────────────────────────────
  'space-0':  '0',
  'space-1':  '4px',
  'space-2':  '8px',
  'space-3':  '12px',
  'space-4':  '16px',
  'space-5':  '24px',
  'space-6':  '32px',
  'space-8':  '48px',

  // ── Radius ─────────────────────────────────────────────────────────────
  'radius-sm': 'clamp(4px, calc(var(--os-radius, 10px) - 4px), 6px)',
  'radius':    'clamp(4px, var(--os-radius, 10px), 10px)',
  'radius-lg': 'var(--os-radius, 14px)',
  'radius-xl': 'calc(var(--os-radius, 14px) + 6px)',
  'radius-pill': '999px',

  // ── Elevation (soft, layered shadows) ─────────────────────────────────────
  'shadow-sm': '0 1px 2px rgba(0,0,0,0.30)',
  'shadow':    '0 4px 16px rgba(0,0,0,0.32)',
  'shadow-lg': '0 12px 40px rgba(0,0,0,0.45)',
  'glow':      '0 0 0 1px var(--fx-accent-soft), 0 6px 24px rgba(0,0,0,0.4)',

  // ── Typography ─────────────────────────────────────────────────────────
  'font':      "var(--os-font, 'Inter'), system-ui, -apple-system, 'Segoe UI', sans-serif",
  'font-mono': "ui-monospace, 'JetBrains Mono', 'Cascadia Code', 'SF Mono', monospace",
  'text-xs':   '11px',
  'text-sm':   '12px',
  'text-md':   '13px',
  'text-lg':   '15px',
  'text-xl':   '19px',
  'text-2xl':  '26px',
  'weight-normal': '450',
  'weight-medium': '550',
  'weight-bold':   '680',

  // ── Motion ─────────────────────────────────────────────────────────────
  'ease':      'cubic-bezier(0.22, 1, 0.36, 1)',
  'dur-fast':  'var(--os-anim-dur, 0.12s)',
  'dur':       'var(--os-anim-dur, 0.2s)',
  'dur-slow':  'var(--os-anim-dur, 0.32s)',

  // ── Arcade / games (LED readouts, full-bleed game stage) ──────────────────
  'font-led':      "ui-monospace, 'SFMono-Regular', Consolas, monospace",
  'led-red':       '#ff5f6d',
  'led-green':     'var(--fx-accent)',
  'led-amber':     '#fbbf24',
  'game-backdrop': 'radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--fx-accent) 16%, transparent), transparent 42%), var(--bg-primary, #070b14)',
});

/** Reference a token as a CSS value: token('accent') → 'var(--fx-accent)'. */
export function token(name) {
  return `var(--fx-${name})`;
}

/** The CSS text that declares every token as a custom property. */
export function tokenCss() {
  return ':root, .fx-scope {' + Object.entries(TOKENS).map(([k, v]) => `--fx-${k}:${v}`).join(';') + '}';
}

/** Inject token custom-property declarations into a root (document/ShadowRoot).
 * Idempotent by presence of the style tag, so it re-injects after a cleared root. */
export function ensureTokens(root) {
  if (typeof document === 'undefined') return;
  const r = root || document;
  const target = (r.nodeType === 9 /* Document */) ? r.head : r;
  if (!target || (target.querySelector && target.querySelector('#fx-design-tokens'))) return;
  const style = document.createElement('style');
  style.id = 'fx-design-tokens';
  style.textContent = tokenCss();
  target.appendChild(style);
}
