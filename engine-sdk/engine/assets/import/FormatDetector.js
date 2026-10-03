// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/FormatDetector.js — detect format by extension + magic
// bytes (spec §5). Never trust the filename alone: the magic-byte sniff wins
// when it disagrees with the extension, and a confidence is reported so the
// pipeline can fall back to the editor when unsure.

const NATIVE = new Set(['glb', 'gltf', 'obj', 'mtl', 'stl', 'ply']);
const BRIDGE = new Set(['fbx', 'dae', '3mf', 'step', 'stp', 'iges', 'igs', 'usd', 'usdz']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp', 'ktx2', 'dds']);

function extOf(name) {
  const base = String(name).split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function asBytes(head) {
  if (!head) return null;
  if (head instanceof Uint8Array) return head;
  if (head instanceof ArrayBuffer) return new Uint8Array(head);
  if (ArrayBuffer.isView(head)) return new Uint8Array(head.buffer, head.byteOffset, head.byteLength);
  return null;
}

const startsWithAscii = (bytes, str) => {
  for (let i = 0; i < str.length; i++) if (bytes[i] !== str.charCodeAt(i)) return false;
  return true;
};

/**
 * Sniff a format from a leading byte slice. Returns a format token or null.
 * Pass at least the first 16 bytes for reliable results.
 */
export function sniffMagic(head) {
  const b = asBytes(head);
  if (!b || b.length < 4) return null;
  if (startsWithAscii(b, 'glTF')) return 'glb';                       // binary glTF
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';                   // PK.. (3mf/usdz container)
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (startsWithAscii(b, 'RIFF') && b.length >= 12 && startsWithAscii(b.subarray(8), 'WEBP')) return 'webp';
  if (b[0] === 0xab && b[1] === 0x4b && b[2] === 0x54 && b[3] === 0x58) return 'ktx2';   // «KTX
  if (startsWithAscii(b, 'solid')) return 'stl';                      // ASCII STL (may also be binary)
  if (startsWithAscii(b, 'ply')) return 'ply';
  if (startsWithAscii(b, 'Kaydara')) return 'fbx';                    // 'Kaydara FBX Binary'
  if (startsWithAscii(b, 'ISO-10303')) return 'step';                 // STEP header
  // glTF JSON and OBJ/MTL/DAE are text without a strict magic; leave to extension.
  return null;
}

export const FORMAT_CLASS = Object.freeze({ NATIVE: 'native', BRIDGE: 'bridge', IMAGE: 'image', UNKNOWN: 'unknown' });

export function classOf(format) {
  if (NATIVE.has(format)) return FORMAT_CLASS.NATIVE;
  if (BRIDGE.has(format)) return FORMAT_CLASS.BRIDGE;
  if (IMAGE.has(format)) return FORMAT_CLASS.IMAGE;
  return FORMAT_CLASS.UNKNOWN;
}

/**
 * Detect a file's format from its name and (optional) leading bytes.
 * @param {string} name filename or virtual path
 * @param {Uint8Array|ArrayBuffer} [head] leading bytes (>= 16 recommended)
 * @returns {{ format:string|null, klass:string, byExtension:string|null, byMagic:string|null, confidence:number, conflict:boolean }}
 */
export function detectFormat(name, head = null) {
  const byExtension = extOf(name) || null;
  const byMagic = sniffMagic(head);

  // glTF disambiguation: a .gltf is JSON, a .glb is binary (magic 'glTF').
  let format = byMagic || byExtension;
  if (byExtension === 'gltf' && !byMagic) format = 'gltf';
  if (byMagic === 'zip' && (byExtension === '3mf' || byExtension === 'usdz')) format = byExtension;

  let confidence;
  let conflict = false;
  if (byMagic && byExtension) {
    const agree = byMagic === byExtension
      || (byMagic === 'glb' && byExtension === 'gltf')
      || (byMagic === 'jpg' && byExtension === 'jpeg')
      || (byMagic === 'zip' && (byExtension === '3mf' || byExtension === 'usdz'));
    confidence = agree ? 0.99 : 0.6;
    conflict = !agree;
    if (conflict) format = byMagic; // magic wins over a lying extension
  } else if (byMagic) {
    confidence = 0.9;
  } else if (byExtension) {
    confidence = 0.7;
  } else {
    confidence = 0;
  }

  return { format: format || null, klass: classOf(format), byExtension, byMagic, confidence, conflict };
}

export { NATIVE as NATIVE_FORMATS, BRIDGE as BRIDGE_FORMATS, IMAGE as IMAGE_FORMATS };
