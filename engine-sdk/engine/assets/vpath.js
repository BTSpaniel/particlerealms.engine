// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vpath.js — virtual path system.
//
// Users never manage raw filesystem paths. Everything addresses through a
// scheme://path virtual path. The resolver (AssetResolver) maps a virtual path
// to a concrete backend handle; this module only parses/normalizes/builds them.
//
//   asset://   project asset library
//   user://    user-selected local folder (File System Access)
//   cache://   OPFS / local engine cache
//   cloud://   optional remote mirror
//   temp://    transient drag-drop import
//   surface:// live render surface (no backing file)

export const VPATH_SCHEMES = Object.freeze(['asset', 'user', 'cache', 'cloud', 'temp', 'surface']);

const VPATH_RE = /^([a-z]+):\/\/(.*)$/;

/**
 * Parse a virtual path into { scheme, path, segments }.
 * @param {string} vpath
 * @returns {{ scheme:string, path:string, segments:string[] }|null} null if malformed
 */
export function parseVPath(vpath) {
  if (typeof vpath !== 'string') return null;
  const m = VPATH_RE.exec(vpath.trim());
  if (!m) return null;
  const scheme = m[1];
  if (!VPATH_SCHEMES.includes(scheme)) return null;
  const path = normalizeSegments(m[2]);
  return { scheme, path, segments: path ? path.split('/') : [] };
}

export function isVPath(vpath) { return parseVPath(vpath) != null; }

/** Build a virtual path from a scheme + path parts. */
export function makeVPath(scheme, ...parts) {
  if (!VPATH_SCHEMES.includes(scheme)) throw new Error(`vpath: unknown scheme '${scheme}'`);
  const path = normalizeSegments(parts.flatMap((p) => String(p).split('/')).join('/'));
  return `${scheme}://${path}`;
}

/** Collapse duplicate/empty separators and strip leading/trailing slashes. */
export function normalizeSegments(path) {
  return String(path)
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s.length > 0 && s !== '.')
    .join('/');
}

/** Swap the scheme of a virtual path, keeping the same path (e.g. for backups). */
export function withScheme(vpath, scheme) {
  const p = parseVPath(vpath);
  if (!p) throw new Error(`vpath: cannot re-scheme invalid path '${vpath}'`);
  return makeVPath(scheme, p.path);
}

/** The basename (last segment) and extension of a virtual path. */
export function vpathBasename(vpath) {
  const p = parseVPath(vpath);
  if (!p || p.segments.length === 0) return '';
  return p.segments[p.segments.length - 1];
}

export function vpathExtension(vpath) {
  const base = vpathBasename(vpath);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Standard cache path for a converted artifact, keyed by content hash. */
export function cachePathFor(kind, sourceHash, ext) {
  const hex = String(sourceHash).replace(/^sha256:/, '').slice(0, 16);
  return makeVPath('cache', kind, `${hex}.${ext}`);
}
