// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/index.js — the shared factory design system.
 *
 * Import once, call ensureUI() in your part's mount, then compose with the
 * exported primitives. Every ported app shares this look and behaviour.
 *
 *   import * as ui from '../../factory/sdk/ui/index.js';
 *   ui.ensureUI();
 *   const { root, body } = ui.appShell({ toolbar: ui.toolbar({ title:'My App' }) });
 *   body.appendChild(ui.button({ label:'Go', variant:'primary', onClick }));
 *   element.appendChild(root);
 */

import { ensureStyles } from './styles.js';

export { el, clear, on, mountInto, appendChildren } from './dom.js';
export { TOKENS, token, ensureTokens } from './tokens.js';
export { button, iconButton, input, textarea, select, menuSelect, toggle, slider, segmented } from './controls.js';
export { label, badge, divider, icon, emptyState, spinner } from './elements.js';
export { card, field, toolbar, statusbar, list, appShell, sectionHeader, statusBadge } from './components.js';
export { computeStatus, updateComputeStatus, createComputeStatusReader } from './computeStatus.js';
export { led, gameShell, overlay } from './game.js';
export { createRebuildViewStateAdapter } from './rebuildViewState.js';
export { normalizePanelIds, normalizePanelOrder, orderPanels, resolvePanelActivity } from './panelState.js';
export { createAccessibleSplitter, normalizeSplitterOrientation } from './splitter.js';
export {
  AVATAR_EMOJI_OPTIONS,
  AVATAR_FILE_ACCEPT,
  AVATAR_SOURCE_CAP_BYTES,
  PROFILE_AVATAR_MAX_CHARS,
  PROFILE_AVATAR_THUMB_CAP_BYTES,
  fileToAvatarSet,
  fileToProfileAvatar,
  isImageAvatar,
  isMediaAvatar,
  isVideoAvatar,
  renderAvatar,
} from './avatar.js';

/** Resolve the style root (document or ShadowRoot) for a mount element. */
function _rootOf(el) {
  return (el && typeof el.getRootNode === 'function') ? el.getRootNode() : (typeof document !== 'undefined' ? document : null);
}

/**
 * Inject tokens + component stylesheet. Call at the start of mount(), passing
 * the mount element so styles land in the correct root (document head, or the
 * ShadowRoot when the app is embedded in shadow DOM, e.g. by Control Panel).
 */
export function ensureUI(el) { ensureStyles(_rootOf(el)); }

/**
 * Inject an app's private stylesheet (once) into the mount element's root, so it
 * works in both light DOM and shadow DOM. Replaces ad-hoc document.head injects.
 */
export function injectAppCss(el, id, css) {
  if (typeof document === 'undefined') return;
  const root = _rootOf(el) || document;
  const target = (root.nodeType === 9 /* Document */) ? root.head : root;
  if (!target) return;
  const existing = target.querySelector?.('#' + id);
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css;
    return existing;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  target.appendChild(style);
  return style;
}

/** Tag a root element as a design-system scope (enables .fx-scope defaults). */
export function scope(node) { node?.classList?.add('fx-scope'); return node; }
