// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * sdk/ui/dom.js — minimal DOM primitives shared by every factory part.
 *
 * The "headless" base layer: tiny helpers for building and wiring DOM with no
 * styling opinions. Styling comes from design tokens (tokens.js) + component
 * helpers (controls.js / components.js). Keeps every app off bespoke DOM glue.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props]  attrs/props: { class, style, text, html, dataset, on:{click}, ...attrs }
 * @param {Array|Node|string} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val == null) continue;
    if (key === 'class' || key === 'className') node.className = val;
    else if (key === 'style') node.style.cssText = typeof val === 'string' ? val : styleObj(val);
    else if (key === 'text') node.textContent = val;
    else if (key === 'html') node.innerHTML = val;
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key === 'on') for (const [ev, fn] of Object.entries(val)) node.addEventListener(ev, fn);
    else if (key in node && key !== 'list') { try { node[key] = val; } catch { node.setAttribute(key, val); } }
    else node.setAttribute(key, val);
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  if (children == null) return node;
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Remove all children of a node. */
export function clear(node) { if (node) node.textContent = ''; return node; }

/** Add a listener and return an unsubscribe function. */
export function on(target, event, handler, opts) {
  target.addEventListener(event, handler, opts);
  return () => target.removeEventListener(event, handler, opts);
}

/** Mount content into a root, returning a teardown that clears it. */
export function mountInto(root, content) {
  clear(root);
  appendChildren(root, content);
  return () => clear(root);
}

function styleObj(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';');
}
