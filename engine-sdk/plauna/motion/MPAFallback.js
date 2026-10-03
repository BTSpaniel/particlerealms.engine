// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MPAFallback - Cross-document view transition fallback for mobile/legacy browsers.
 *
 * Browsers that don't support the CSS @view-transition at-rule for MPA navigation
 * get a minimal fade-in of the new page instead of a hard cut. This is a graceful
 * degradation, not a full polyfill; the real cross-document transition only works
 * in browsers that support the View Transitions API Level 2.
 *
 * Usage: load as an optional enhancement, never as a parsing prerequisite:
 *   <script defer src="/plauna/motion/MPAFallback.js"></script>
 */

(function () {
  if (typeof document === 'undefined') return;

  // Detect @view-transition support by attempting to inject the rule and read
  // back a parsed CSSRule. If it succeeds, the browser handles MPA transitions
  // natively and we should not interfere.
  function supportsViewTransitionNavigation() {
    var style = document.createElement('style');
    var text = document.createTextNode('@view-transition { navigation: auto; }');
    style.appendChild(text);
    var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    head.appendChild(style);
    var ok = false;
    try {
      var sheet = style.sheet;
      ok = !!(sheet && sheet.cssRules && sheet.cssRules.length > 0);
    } catch (_) {
      ok = false;
    }
    head.removeChild(style);
    return ok;
  }

  if (supportsViewTransitionNavigation()
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  // A decorative fade must finish without DOMContentLoaded or pagereveal:
  // either event can be delayed by unrelated modules on a mobile connection.
  // Keep content visible even during the fade, and retain no hidden end state.
  var html = document.documentElement;
  var css = document.createElement('style');
  css.textContent =
    '.js-pt-fallback-reveal { animation: plauna-mpa-reveal 250ms ease-out; }\n' +
    '@keyframes plauna-mpa-reveal { from { opacity: .35; } to { opacity: 1; } }\n' +
    '@media (prefers-reduced-motion: reduce) { .js-pt-fallback-reveal { animation: none; } }';
  var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
  head.appendChild(css);
  html.classList.add('js-pt-fallback-reveal');
  console.debug('[MPAFallback] Non-blocking 250ms page fade started');
})();
