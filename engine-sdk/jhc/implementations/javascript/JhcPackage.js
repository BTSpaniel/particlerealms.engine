// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as constants from './constants.js';
import { canonicalize, validateMany, validateId, validateVersion } from './path.js';
import { TokenCodec } from './codec/TokenCodec.js';

const SECTION_TYPES = {
  MANIFEST: 0,
  RAW_RESOURCE: 1,
  SOURCE_MAP: 2,
  LICENSE: 3,
  SIGNATURE: 4,
};

export class JhcPackageError extends Error {
  constructor(code, message) {
    super(message || constants.JHC_MESSAGES[code] || 'JHC package error');
    this.code = code;
    this.name = 'JhcPackageError';
  }
}

const _DiagCodes = {
  INVALID_PATH: constants.JHC_E_INVALID_PATH,
  INVALID_ID: constants.JHC_E_INVALID_ID,
  INVALID_VERSION: constants.JHC_E_INVALID_VERSION,
  DUPLICATE_PATH: constants.JHC_E_DUPLICATE_PATH,
  PATH_TOO_LONG: constants.JHC_E_PATH_TOO_LONG,
  ABSOLUTE_PATH: constants.JHC_E_ABSOLUTE_PATH,
  TRAVERSAL: constants.JHC_E_TRAVERSAL,
  NULL_BYTE: constants.JHC_E_NULL_BYTE,
  INVALID_UTF8: constants.JHC_E_INVALID_UTF8,
  DRIVE_LETTER: constants.JHC_E_DRIVE_LETTER,
  BACKSLASH: constants.JHC_E_BACKSLASH,
  EMPTY_SEGMENT: constants.JHC_E_EMPTY_SEGMENT,
  RESERVED_CHAR: constants.JHC_E_RESERVED_CHAR,
  INVALID_PERCENT: constants.JHC_E_INVALID_PERCENT,
  TOO_MANY_FILES: constants.JHC_E_TOO_MANY_FILES,
  FILE_TOO_LARGE: constants.JHC_E_FILE_TOO_LARGE,
  PACKAGE_TOO_LARGE: constants.JHC_E_PACKAGE_TOO_LARGE,
  MANIFEST_TOO_LARGE: constants.JHC_E_MANIFEST_TOO_LARGE,
  TOO_MANY_SECTIONS: constants.JHC_E_TOO_MANY_SECTIONS,
  DECODE_BUDGET: constants.JHC_E_DECODE_BUDGET,
  LENGTH_MISMATCH: constants.JHC_E_LENGTH_MISMATCH,
  OVERLAPPING_SECTION: constants.JHC_E_OVERLAPPING_SECTION,
  UNSUPPORTED_CODEC: constants.JHC_E_UNSUPPORTED_CODEC,
  BAD_RESOURCE_MAP: constants.JHC_E_BAD_RESOURCE_MAP,
  SIGNATURE_REQUIRED: constants.JHC_E_SIGNATURE_REQUIRED,
  DICTIONARY_MISMATCH: constants.JHC_E_DICTIONARY_MISMATCH,
  LICENSE_MISMATCH: constants.JHC_E_LICENSE_MISMATCH,
  BAD_MAGIC: 200,
  BAD_HEADER: 201,
  BAD_DIRECTORY: 202,
  BAD_SECTION: 203,
  HASH_MISMATCH: 204,
  BAD_SIGNATURE: 205,
  TRUST_FAILED: 206,
};

function canonicalString(value) {
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (ch) => {
    const cp = ch.charCodeAt(0);
    return '\\u' + cp.toString(16).padStart(4, '0');
  });
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not allow non-finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const fields = [];
    for (const key of keys) {
      if (value[key] === undefined) throw new TypeError(`Canonical JSON does not allow undefined at ${key}`);
      fields.push(canonicalString(key) + ':' + canonicalJson(value[key]));
    }
    return '{' + fields.join(',') + '}';
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

async function sha256(data) {
  const crypto = globalThis.crypto || globalThis.msCrypto;
  if (!crypto || !crypto.subtle) {
    throw new JhcPackageError(_DiagCodes.TRUST_FAILED, 'Web Crypto API unavailable for SHA-256');
  }
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buffer);
}

function concat(arrays) {
  const total = arrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function encodeU32LE(n) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, n, true);
  return new Uint8Array(buf);
}

function encodeU64LE(n) {
  const buf = new ArrayBuffer(8);
  const low = n & 0xffffffff;
  const high = Math.floor(n / 0x100000000);
  new DataView(buf).setUint32(0, low, true);
  new DataView(buf).setUint32(4, high, true);
  return new Uint8Array(buf);
}

function decodeU32LE(view, offset) {
  return view.getUint32(offset, true);
}

function decodeU64LE(view, offset) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return low + high * 0x100000000;
}

function u8ToHex(u8) {
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToU8(hex) {
  const u8 = new Uint8Array(hex.length / 2);
  for (let i = 0; i < u8.length; i++) {
    u8[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return u8;
}

function textToU8(text) {
  return new TextEncoder().encode(text);
}

function u8ToText(u8) {
  return new TextDecoder('utf-8', { fatal: true }).decode(u8);
}

async function importPublicKey(rawOrPem) {
  const crypto = globalThis.crypto || globalThis.msCrypto;
  if (!crypto || !crypto.subtle) {
    throw new JhcPackageError(_DiagCodes.TRUST_FAILED, 'Web Crypto API unavailable');
  }
  if (typeof rawOrPem === 'string' && rawOrPem.startsWith('-----')) {
    // SPKI/PEM not supported by subtle without extra parsing; assume JWK for strings.
    return crypto.subtle.importKey('jwk', JSON.parse(rawOrPem), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  }
  if (rawOrPem instanceof CryptoKey) {
    return rawOrPem;
  }
  const raw = rawOrPem instanceof Uint8Array ? rawOrPem : new Uint8Array(rawOrPem);
  if (raw.length === 65 && raw[0] === 0x04) {
    return crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  }
  // Assume SPKI DER
  return crypto.subtle.importKey('spki', raw, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

function arrayEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class JhcPackage {
  static MAGIC = new Uint8Array([0x4a, 0x48, 0x43, 0x31]);
  static MAJOR = 1;
  static MINOR = 0;
  static HEADER_LEN = 48;
  static DIR_ENTRY_LEN = 72;
  static MAX_FILES = 10000;
  static MAX_FILE_BYTES = 50 * 1024 * 1024;
  static MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
  static MAX_MANIFEST_BYTES = constants.JHC_MAX_MANIFEST_SIZE;
  static MAX_LICENSE_BYTES = constants.JHC_MAX_LICENSE_SIZE;
  static MAX_SIGNATURE_BYTES = constants.JHC_MAX_SIGNATURE_SIZE;
  static MAX_TOTAL_DECODED_BYTES = constants.JHC_MAX_TOTAL_DECODED_SIZE;
  static MAX_EXPANSION_RATIO = constants.JHC_MAX_EXPANSION_RATIO;
  static MAX_EXPANSION_SLACK = constants.JHC_MAX_EXPANSION_SLACK;

  static canonicalJson(value) { return canonicalJson(value); }

  static _validateResources(resources) {
    const keys = Object.keys(resources);
    if (keys.length > JhcPackage.MAX_FILES) {
      throw new JhcPackageError(_DiagCodes.TOO_MANY_FILES, 'Too many resource files');
    }
    const report = validateMany(keys);
    if (!report.ok) {
      const err = report.errors[0];
      throw new JhcPackageError(_DiagCodes.INVALID_PATH, `Invalid resource path ${err.path}: ${err.message}`);
    }
    const seen = new Set();
    for (const path of keys) {
      const canon = canonicalize(path);
      if (seen.has(canon)) {
        throw new JhcPackageError(_DiagCodes.DUPLICATE_PATH, `Duplicate normalized path: ${path}`);
      }
      seen.add(canon);
    }
    for (const path of keys) {
      const content = resources[path];
      if (content.length > JhcPackage.MAX_FILE_BYTES) {
        throw new JhcPackageError(_DiagCodes.FILE_TOO_LARGE, `Resource too large: ${path}`);
      }
    }
    return keys
      .map((path) => ({ path, content: resources[path] }))
      .sort((a, b) => {
        const aBytes = textToU8(a.path);
        const bBytes = textToU8(b.path);
        for (let i = 0; i < Math.min(aBytes.length, bBytes.length); i++) {
          if (aBytes[i] !== bBytes[i]) return aBytes[i] - bBytes[i];
        }
        return aBytes.length - bBytes.length;
      });
  }

  static async _buildManifest(manifest, orderedResources) {
    if (!manifest.applicationId) {
      throw new JhcPackageError(_DiagCodes.INVALID_ID, 'applicationId is required');
    }
    if (!manifest.applicationVersion) {
      throw new JhcPackageError(_DiagCodes.INVALID_VERSION, 'applicationVersion is required');
    }
    validateId(manifest.applicationId);
    validateVersion(manifest.applicationVersion);

    const resourceRecords = [];
    for (let i = 0; i < orderedResources.length; i++) {
      const { path, content } = orderedResources[i];
      const mime = (manifest.resourceMime && manifest.resourceMime[path]) || 'application/octet-stream';
      const hash = await sha256(content);
      resourceRecords.push({
        path: canonicalize(path),
        mime,
        id: i,
        hash: u8ToHex(hash),
        representation: 'raw',
        decodedLength: content.length,
      });
    }
    const canonicalManifest = { ...manifest };
    canonicalManifest.resources = resourceRecords;
    canonicalManifest.format = 'jhc-1.0';
    canonicalManifest.container = 'jhc-1.0';
    delete canonicalManifest.signature;
    // License bytes live in their dedicated hashed section. The signed
    // manifest carries legal.licenseTextSha256, not a duplicate plaintext.
    delete canonicalManifest.licenseText;
    return textToU8(canonicalJson(canonicalManifest));
  }

  static async _computeRootHash(manifestBytes, directory) {
    // Bind the manifest and non-signature section metadata. The signature
    // section itself is excluded to avoid a circular dependency: the signature
    // is computed over the root hash, so the root hash cannot depend on the
    // signature bytes.
    const entries = directory.filter((e) => e.sectionType !== SECTION_TYPES.SIGNATURE);
    const count = encodeU32LE(entries.length);
    const parts = [manifestBytes, count];
    for (const entry of entries) {
      parts.push(encodeU32LE(entry.sectionType));
      parts.push(encodeU32LE(entry.logicalId));
      parts.push(new Uint8Array(entry.decodedSha256));
    }
    return sha256(concat(parts));
  }

  static _signatureMessage(rootHash, manifest) {
    const major = new Uint8Array([JhcPackage.MAJOR]);
    const minor = new Uint8Array([JhcPackage.MINOR]);
    const appId = textToU8(manifest.applicationId || '');
    const appVersion = textToU8(manifest.applicationVersion || '');
    const features = (Number(manifest.requiredFeatures) || 0) & 0xffffffff;
    const parts = [
      major,
      minor,
      rootHash,
      appId,
      appVersion,
      encodeU32LE(features),
    ];
    return concat(parts);
  }

  static async pack(manifest, resources, signer = null, coder = null) {
    const orderedResources = JhcPackage._validateResources(resources);
    const manifestBytes = await JhcPackage._buildManifest(manifest, orderedResources);

    const directory = [];
    const sections = [manifestBytes];

    directory.push({
      sectionType: SECTION_TYPES.MANIFEST,
      sectionFlags: 0,
      logicalId: 0,
      codec: 0,
      storedOffset: 0,
      storedLength: manifestBytes.length,
      decodedLength: manifestBytes.length,
      decodedSha256: await sha256(manifestBytes),
    });

    for (let i = 0; i < orderedResources.length; i++) {
      const { path, content } = orderedResources[i];
      let codec = 0;
      let decoded = content;
      let encoded = content;
      if (coder) {
        const result = await coder(path, content);
        if (result) {
          const candidateCodec = Number(result.codec ?? 0);
          const candidateDecoded = result.decoded instanceof Uint8Array
            ? result.decoded : new Uint8Array(result.decoded ?? content);
          const candidateEncoded = result.encoded instanceof Uint8Array
            ? result.encoded : new Uint8Array(result.encoded ?? content);
          if (!arrayEquals(candidateDecoded, content)) {
            throw new JhcPackageError(
              _DiagCodes.BAD_SECTION,
              `Coder changed decoded resource bytes for ${path}`,
            );
          }
          if (candidateCodec !== 0 && candidateCodec !== 1) {
            throw new JhcPackageError(
              _DiagCodes.BAD_SECTION,
              `Unsupported resource codec ${candidateCodec} for ${path}`,
            );
          }
          if (candidateCodec === 0 && !arrayEquals(candidateEncoded, content)) {
            throw new JhcPackageError(
              _DiagCodes.BAD_SECTION,
              `Raw coder changed stored resource bytes for ${path}`,
            );
          }
          // Codecs optimize storage only. Expanded or equal-sized output is
          // represented canonically as raw bytes.
          if (candidateCodec !== 0 && candidateEncoded.length < content.length) {
            codec = candidateCodec;
            decoded = candidateDecoded;
            encoded = candidateEncoded;
          }
        }
      }
      directory.push({
        sectionType: SECTION_TYPES.RAW_RESOURCE,
        sectionFlags: 0,
        logicalId: i,
        codec,
        storedOffset: 0,
        storedLength: encoded.length,
        decodedLength: decoded.length,
        decodedSha256: await sha256(decoded),
      });
      sections.push(encoded);
    }

    if (manifest.licenseText) {
      const licenseBytes = textToU8(manifest.licenseText);
      directory.push({
        sectionType: SECTION_TYPES.LICENSE,
        sectionFlags: 0,
        logicalId: 0,
        codec: 0,
        storedOffset: 0,
        storedLength: licenseBytes.length,
        decodedLength: licenseBytes.length,
        decodedSha256: await sha256(licenseBytes),
      });
      sections.push(licenseBytes);
    }

    directory.sort((a, b) => (a.sectionType - b.sectionType) || (a.logicalId - b.logicalId));

    let rootHash = await JhcPackage._computeRootHash(manifestBytes, directory);
    let signature = null;

    if (signer) {
      const message = JhcPackage._signatureMessage(rootHash, manifest);
      signature = await signer.sign(message);
      if (signature) {
        directory.push({
          sectionType: SECTION_TYPES.SIGNATURE,
          sectionFlags: 0,
          logicalId: 0,
          codec: 0,
          storedOffset: 0,
          storedLength: signature.length,
          decodedLength: signature.length,
          decodedSha256: await sha256(signature),
        });
        sections.push(signature);
      }
    }

    directory.sort((a, b) => (a.sectionType - b.sectionType) || (a.logicalId - b.logicalId));
    rootHash = await JhcPackage._computeRootHash(manifestBytes, directory);

    if (signer) {
      const message = JhcPackage._signatureMessage(rootHash, manifest);
      signature = await signer.sign(message);
      for (const entry of directory) {
        if (entry.sectionType === SECTION_TYPES.SIGNATURE) {
          entry.storedLength = signature.length;
          entry.decodedLength = signature.length;
          entry.decodedSha256 = await sha256(signature);
          break;
        }
      }
      sections[sections.length - 1] = signature;
      rootHash = await JhcPackage._computeRootHash(manifestBytes, directory);
    }

    const manifestOffset = JhcPackage.HEADER_LEN;
    const directoryOffset = manifestOffset + manifestBytes.length;
    const sectionsOffset = directoryOffset + directory.length * JhcPackage.DIR_ENTRY_LEN;

    let sectionOffset = sectionsOffset;
    for (let i = 0; i < directory.length; i++) {
      const entry = directory[i];
      if (i === 0 && entry.sectionType === SECTION_TYPES.MANIFEST) {
        entry.storedOffset = manifestOffset;
      } else {
        entry.storedOffset = sectionOffset;
        sectionOffset += entry.storedLength;
      }
    }

    const directoryParts = [];
    for (const entry of directory) {
      directoryParts.push(encodeU32LE(entry.sectionType));
      directoryParts.push(encodeU32LE(entry.sectionFlags));
      directoryParts.push(encodeU32LE(entry.logicalId));
      directoryParts.push(encodeU32LE(entry.codec));
      directoryParts.push(encodeU64LE(entry.storedOffset));
      directoryParts.push(encodeU64LE(entry.storedLength));
      directoryParts.push(encodeU64LE(entry.decodedLength));
      directoryParts.push(new Uint8Array(entry.decodedSha256));
    }
    const directoryBytes = concat(directoryParts);

    const header = new Uint8Array(JhcPackage.HEADER_LEN);
    header.set(JhcPackage.MAGIC, 0);
    header[4] = JhcPackage.MAJOR;
    header[5] = JhcPackage.MINOR;
    const headerView = new DataView(header.buffer);
    headerView.setUint16(6, JhcPackage.HEADER_LEN, true);
    headerView.setUint32(8, 0, true); // flags
    headerView.setUint32(12, 0, true); // dictionary version
    headerView.setUint32(16, 0, true); // language profile
    headerView.setBigUint64(20, BigInt(manifestOffset), true);
    headerView.setBigUint64(28, BigInt(manifestBytes.length), true);
    headerView.setBigUint64(36, BigInt(directoryOffset), true);
    headerView.setUint32(44, directory.length, true);

    const body = concat([manifestBytes, directoryBytes, concat(sections.slice(1))]);
    const container = concat([header, body]);

    if (container.length > JhcPackage.MAX_PACKAGE_BYTES) {
      throw new JhcPackageError(_DiagCodes.PACKAGE_TOO_LARGE, 'Package exceeds maximum size');
    }
    return container;
  }

  static preflight(container) {
    container = container instanceof Uint8Array ? container : new Uint8Array(container);
    if (container.length > JhcPackage.MAX_PACKAGE_BYTES) {
      throw new JhcPackageError(_DiagCodes.PACKAGE_TOO_LARGE, 'Package exceeds maximum size');
    }
    if (container.length < JhcPackage.HEADER_LEN) {
      throw new JhcPackageError(_DiagCodes.BAD_HEADER, 'Container too short');
    }
    for (let i = 0; i < 4; i++) {
      if (container[i] !== JhcPackage.MAGIC[i]) {
        throw new JhcPackageError(_DiagCodes.BAD_MAGIC, 'Bad JHC1 magic');
      }
    }
    const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
    const major = container[4];
    const minor = container[5];
    const headerLen = view.getUint16(6, true);
    const flags = view.getUint32(8, true);
    const dictVersion = view.getUint32(12, true);
    const langProfile = view.getUint32(16, true);
    const safeU64 = (offset, label) => {
      const value = view.getBigUint64(offset, true);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new JhcPackageError(_DiagCodes.BAD_HEADER, `${label} exceeds JavaScript safe integer range`);
      }
      return Number(value);
    };
    const manifestOffset = safeU64(20, 'Manifest offset');
    const manifestLength = safeU64(28, 'Manifest length');
    const directoryOffset = safeU64(36, 'Directory offset');
    const directoryCount = view.getUint32(44, true);

    if (headerLen !== JhcPackage.HEADER_LEN) {
      throw new JhcPackageError(_DiagCodes.BAD_HEADER, 'Unsupported header length');
    }
    if (major !== JhcPackage.MAJOR || minor > JhcPackage.MINOR) {
      throw new JhcPackageError(_DiagCodes.BAD_HEADER, `Unsupported JHC version ${major}.${minor}`);
    }
    if (manifestOffset !== headerLen) {
      throw new JhcPackageError(_DiagCodes.BAD_HEADER, 'Manifest offset is not canonical');
    }
    if (directoryOffset !== manifestOffset + manifestLength) {
      throw new JhcPackageError(_DiagCodes.BAD_DIRECTORY, 'Directory offset is not canonical');
    }
    if (manifestLength > JhcPackage.MAX_MANIFEST_BYTES) {
      throw new JhcPackageError(_DiagCodes.MANIFEST_TOO_LARGE, 'Manifest exceeds maximum size');
    }
    if (directoryCount < 1 || directoryCount > JhcPackage.MAX_FILES + 4) {
      throw new JhcPackageError(_DiagCodes.TOO_MANY_SECTIONS, 'Package contains too many sections');
    }
    if (manifestOffset + manifestLength > container.length) {
      throw new JhcPackageError(_DiagCodes.BAD_HEADER, 'Manifest out of bounds');
    }

    const manifestBytes = container.subarray(manifestOffset, manifestOffset + manifestLength);
    let manifest;
    try {
      manifest = JSON.parse(u8ToText(manifestBytes));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('manifest root must be an object');
      }
    } catch (e) {
      throw new JhcPackageError(_DiagCodes.BAD_SECTION, `Manifest is not valid JSON: ${e.message}`);
    }
    const manifestFormat = manifest.format;
    const manifestContainer = manifest.container;
    // Legacy JHC1 manifests may omit both declarations. A partial, foreign,
    // or future declaration is never interpreted as the current contract.
    if (manifestFormat !== undefined || manifestContainer !== undefined) {
      if (manifestFormat !== 'jhc-1.0' || manifestContainer !== 'jhc-1.0') {
        throw new JhcPackageError(_DiagCodes.BAD_SECTION, 'Unsupported JHC manifest format/container contract');
      }
    }

    const directory = [];
    const directoryEnd = directoryOffset + directoryCount * JhcPackage.DIR_ENTRY_LEN;
    if (!Number.isSafeInteger(directoryEnd) || directoryEnd > container.length) {
      throw new JhcPackageError(_DiagCodes.BAD_DIRECTORY, 'Directory out of bounds');
    }

    const allowedTypes = new Set(Object.values(SECTION_TYPES));
    let totalDecoded = 0;
    for (let i = 0; i < directoryCount; i++) {
      const off = directoryOffset + i * JhcPackage.DIR_ENTRY_LEN;
      const entry = {
        sectionType: decodeU32LE(view, off),
        sectionFlags: decodeU32LE(view, off + 4),
        logicalId: decodeU32LE(view, off + 8),
        codec: decodeU32LE(view, off + 12),
        storedOffset: safeU64(off + 16, `Section ${i} offset`),
        storedLength: safeU64(off + 24, `Section ${i} stored length`),
        decodedLength: safeU64(off + 32, `Section ${i} decoded length`),
        decodedSha256: new Uint8Array(container.buffer, container.byteOffset + off + 40, 32),
      };
      if (!allowedTypes.has(entry.sectionType) || entry.sectionFlags !== 0) {
        throw new JhcPackageError(_DiagCodes.BAD_SECTION, `Unsupported section type or flags at directory entry ${i}`);
      }
      if (entry.codec !== 0 && entry.codec !== 1) {
        throw new JhcPackageError(_DiagCodes.UNSUPPORTED_CODEC, `Unsupported codec ${entry.codec}`);
      }
      if (entry.codec === 1 && entry.sectionType !== SECTION_TYPES.RAW_RESOURCE) {
        throw new JhcPackageError(_DiagCodes.UNSUPPORTED_CODEC, 'Token codec is only valid for resource sections');
      }
      const sectionLimit = entry.sectionType === SECTION_TYPES.MANIFEST
        ? JhcPackage.MAX_MANIFEST_BYTES
        : entry.sectionType === SECTION_TYPES.LICENSE
          ? JhcPackage.MAX_LICENSE_BYTES
          : entry.sectionType === SECTION_TYPES.SIGNATURE
            ? JhcPackage.MAX_SIGNATURE_BYTES
            : JhcPackage.MAX_FILE_BYTES;
      if (entry.decodedLength > sectionLimit) {
        throw new JhcPackageError(_DiagCodes.DECODE_BUDGET, `Section ${entry.sectionType}/${entry.logicalId} exceeds decoded size limit`);
      }
      if (entry.codec === 0 && entry.storedLength !== entry.decodedLength) {
        throw new JhcPackageError(_DiagCodes.LENGTH_MISMATCH, 'Raw section stored and decoded lengths differ');
      }
      if (entry.codec !== 0 && entry.decodedLength > entry.storedLength * JhcPackage.MAX_EXPANSION_RATIO + JhcPackage.MAX_EXPANSION_SLACK) {
        throw new JhcPackageError(_DiagCodes.DECODE_BUDGET, 'Compressed section exceeds expansion-ratio limit');
      }
      totalDecoded += entry.decodedLength;
      if (!Number.isSafeInteger(totalDecoded) || totalDecoded > JhcPackage.MAX_TOTAL_DECODED_BYTES) {
        throw new JhcPackageError(_DiagCodes.DECODE_BUDGET, 'Package exceeds aggregate decoded size limit');
      }
      directory.push(entry);
    }

    const sorted = [...directory].sort((a, b) => (a.sectionType - b.sectionType) || (a.logicalId - b.logicalId));
    for (let i = 0; i < directory.length; i++) {
      if (directory[i].sectionType !== sorted[i].sectionType ||
          directory[i].logicalId !== sorted[i].logicalId) {
        throw new JhcPackageError(_DiagCodes.BAD_DIRECTORY, 'Directory is not sorted');
      }
      if (i > 0 && directory[i].sectionType === directory[i - 1].sectionType &&
          directory[i].logicalId === directory[i - 1].logicalId) {
        throw new JhcPackageError(_DiagCodes.BAD_DIRECTORY, 'Directory contains duplicate section identities');
      }
    }

    const manifestEntries = directory.filter((entry) => entry.sectionType === SECTION_TYPES.MANIFEST);
    if (manifestEntries.length !== 1) {
      throw new JhcPackageError(_DiagCodes.BAD_DIRECTORY, 'Package must contain exactly one manifest section');
    }
    const manifestEntry = manifestEntries[0];
    if (manifestEntry.logicalId !== 0 || manifestEntry.codec !== 0 ||
        manifestEntry.storedOffset !== manifestOffset || manifestEntry.storedLength !== manifestLength) {
      throw new JhcPackageError(_DiagCodes.BAD_DIRECTORY, 'Manifest directory entry does not match the header');
    }

    const occupied = [];
    for (const entry of directory) {
      const start = entry.storedOffset;
      const end = start + entry.storedLength;
      if (!Number.isSafeInteger(end) || end > container.length) {
        throw new JhcPackageError(_DiagCodes.BAD_SECTION, 'Section out of bounds');
      }
      if (entry.sectionType === SECTION_TYPES.MANIFEST) continue;
      if (start < directoryEnd) {
        throw new JhcPackageError(_DiagCodes.OVERLAPPING_SECTION, 'Section overlaps package metadata');
      }
      occupied.push({ start, end });
    }
    occupied.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < occupied.length; i++) {
      if (occupied[i].start < occupied[i - 1].end) {
        throw new JhcPackageError(_DiagCodes.OVERLAPPING_SECTION, 'Package sections overlap');
      }
    }

    const signatureEntries = directory.filter((entry) => entry.sectionType === SECTION_TYPES.SIGNATURE);
    if (signatureEntries.length > 1 || signatureEntries.some((entry) => entry.codec !== 0 || entry.logicalId !== 0)) {
      throw new JhcPackageError(_DiagCodes.BAD_SIGNATURE, 'Invalid signature section layout');
    }
    const licenseEntries = directory.filter((entry) => entry.sectionType === SECTION_TYPES.LICENSE);
    if (licenseEntries.length > 1 || licenseEntries.some((entry) => entry.codec !== 0 || entry.logicalId !== 0)) {
      throw new JhcPackageError(_DiagCodes.BAD_SECTION, 'Invalid license section layout');
    }

    const resourceEntries = directory.filter((entry) => entry.sectionType === SECTION_TYPES.RAW_RESOURCE);
    const records = manifest.resources;
    if (!Array.isArray(records) || records.length !== resourceEntries.length || records.length > JhcPackage.MAX_FILES) {
      throw new JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, 'Manifest resource count does not match resource sections');
    }
    const paths = [];
    for (let i = 0; i < resourceEntries.length; i++) {
      const entry = resourceEntries[i];
      const record = records[i];
      if (entry.logicalId !== i || !record || record.id !== i || typeof record.path !== 'string') {
        throw new JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, `Invalid resource mapping at logical id ${i}`);
      }
      if (record.decodedLength !== entry.decodedLength ||
          typeof record.hash !== 'string' || !/^[0-9a-f]{64}$/.test(record.hash) ||
          record.hash !== u8ToHex(entry.decodedSha256)) {
        throw new JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, `Resource metadata mismatch for ${record.path}`);
      }
      paths.push(record.path);
    }
    const pathReport = validateMany(paths);
    if (!pathReport.ok) {
      throw new JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, `Invalid manifest resource path: ${pathReport.errors[0].message}`);
    }
    if (manifest.blockmap?.files) {
      const blockPaths = Object.keys(manifest.blockmap.files);
      if (blockPaths.length !== records.length || blockPaths.some((path) => !paths.includes(path))) {
        throw new JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, 'Blockmap paths do not match manifest resources');
      }
      for (const record of records) {
        if (manifest.blockmap.files[record.path] !== record.hash) {
          throw new JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, `Blockmap hash mismatch for ${record.path}`);
        }
      }
    }

    const signatureEntry = signatureEntries[0] ?? null;
    const signature = signatureEntry
      ? container.subarray(signatureEntry.storedOffset, signatureEntry.storedOffset + signatureEntry.storedLength)
      : null;
    return {
      container,
      header: { major, minor, flags, dictionaryVersion: dictVersion, languageProfile: langProfile },
      manifest,
      manifestBytes,
      directory,
      directoryEnd,
      signature,
      totalDecoded,
    };
  }

  static async _decodePrepared(prepared) {
    const { container, manifest, manifestBytes, directory, header, signature } = prepared;
    const sections = [];
    for (const entry of directory) {
      const soff = entry.storedOffset;
      const slen = entry.storedLength;
      const section = container.subarray(soff, soff + slen);
      const decoded = await JhcPackage._decodeSection(section, entry, manifest);
      if (decoded.length !== entry.decodedLength) {
        throw new JhcPackageError(_DiagCodes.LENGTH_MISMATCH, `Decoded length mismatch for section ${entry.sectionType}/${entry.logicalId}`);
      }
      const hash = await sha256(decoded);
      if (!arrayEquals(hash, new Uint8Array(entry.decodedSha256))) {
        throw new JhcPackageError(_DiagCodes.HASH_MISMATCH, `Hash mismatch for section ${entry.sectionType}/${entry.logicalId}`);
      }
      sections.push(decoded);
    }

    const resources = {};
    for (let i = 0; i < directory.length; i++) {
      const entry = directory[i];
      if (entry.sectionType !== SECTION_TYPES.RAW_RESOURCE) continue;
      const record = manifest.resources[entry.logicalId];
      resources[record.path] = sections[i];
    }

    let decodedSignature = null;
    let licenseText = null;
    for (let i = 0; i < directory.length; i++) {
      if (directory[i].sectionType === SECTION_TYPES.SIGNATURE) {
        decodedSignature = sections[i];
      } else if (directory[i].sectionType === SECTION_TYPES.LICENSE) {
        try { licenseText = u8ToText(sections[i]); }
        catch (e) { throw new JhcPackageError(_DiagCodes.LICENSE_MISMATCH, `License text is not valid UTF-8: ${e.message}`); }
      }
    }

    const rootHash = await JhcPackage._computeRootHash(manifestBytes, directory);
    return {
      header,
      manifest,
      manifestBytes,
      directory,
      resources,
      signature: decodedSignature ?? signature,
      licenseText,
      rootHash: u8ToHex(rootHash),
    };
  }

  static async parse(container) {
    return JhcPackage._decodePrepared(JhcPackage.preflight(container));
  }

  static async parseAuthenticated(container, publicKey) {
    const prepared = JhcPackage.preflight(container);
    if (!prepared.signature) {
      throw new JhcPackageError(_DiagCodes.SIGNATURE_REQUIRED, 'Package signature is required before decoding');
    }
    const rootHash = await JhcPackage._computeRootHash(prepared.manifestBytes, prepared.directory);
    const message = JhcPackage._signatureMessage(rootHash, prepared.manifest);
    const key = await importPublicKey(publicKey);
    const valid = await (globalThis.crypto || globalThis.msCrypto).subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, prepared.signature, message,
    );
    if (!valid) {
      throw new JhcPackageError(_DiagCodes.BAD_SIGNATURE, 'Package signature verification failed before decoding');
    }
    return JhcPackage._decodePrepared(prepared);
  }

  static _resourceLanguage(path) {
    if (path.endsWith('.html') || path.endsWith('.htm')) return 'html';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.json')) return 'json';
    return 'js';
  }

  static async _decodeSection(section, entry, manifest) {
    if (entry.codec === 0) return section;
    if (entry.codec === 1) {
      if (entry.sectionType !== SECTION_TYPES.RAW_RESOURCE) return section;
      const record = manifest.resources[entry.logicalId];
      const lang = JhcPackage._resourceLanguage(record.path);
      const text = TokenCodec.decode(section, lang);
      return textToU8(text);
    }
    throw new JhcPackageError(_DiagCodes.BAD_SECTION, `Unsupported codec ${entry.codec}`);
  }

  static async verify(container, trustStore = null) {
    const prepared = JhcPackage.preflight(container);
    const manifest = prepared.manifest;
    const directory = prepared.directory;
    const signature = prepared.signature;
    const manifestBytes = prepared.manifestBytes;
    const rootHashU8 = await JhcPackage._computeRootHash(manifestBytes, directory);

    const diagnostics = [];
    let verdict = 'unsigned';
    const fingerprint = manifest.publisherFingerprint ?? null;

    if (!signature) {
      diagnostics.push('No signature section; package was not decoded');
      return {
        ok: false,
        rootHash: u8ToHex(rootHashU8),
        verdict,
        fingerprint,
        diagnostics,
      };
    }

    const message = JhcPackage._signatureMessage(rootHashU8, manifest);
    let pubKey = null;
    if (fingerprint && trustStore) {
      try {
        if (trustStore.get) {
          pubKey = await trustStore.get(fingerprint);
        } else if (trustStore[fingerprint] !== undefined) {
          pubKey = trustStore[fingerprint];
        } else if (typeof trustStore.getPublicKey === 'function') {
          pubKey = await trustStore.getPublicKey(fingerprint);
        }
      } catch (e) {
        diagnostics.push(`Trust store lookup failed: ${e.message}`);
      }
      if (pubKey == null) {
        verdict = 'untrusted';
        diagnostics.push('No public key for fingerprint in trust store; package was not decoded');
        return { ok: false, rootHash: u8ToHex(rootHashU8), verdict, fingerprint, diagnostics };
      }
      verdict = 'trusted';
    } else if (typeof manifest.pubKey === 'string') {
      try {
        pubKey = Uint8Array.from(atob(manifest.pubKey), (ch) => ch.charCodeAt(0));
        verdict = 'signed';
      } catch (e) {
        diagnostics.push(`Embedded publisher key is invalid: ${e.message}`);
      }
    }

    if (pubKey == null) {
      verdict = 'untrusted';
      diagnostics.push('No public key is available; package was not decoded');
      return { ok: false, rootHash: u8ToHex(rootHashU8), verdict, fingerprint, diagnostics };
    }

    try {
      const key = await importPublicKey(pubKey);
      const valid = await (globalThis.crypto || globalThis.msCrypto).subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, key, signature, message,
      );
      if (!valid) {
        verdict = 'invalid';
        diagnostics.push('Signature verification failed before decode');
        return { ok: false, rootHash: u8ToHex(rootHashU8), verdict, fingerprint, diagnostics };
      }
      await JhcPackage._decodePrepared(prepared);
    } catch (e) {
      verdict = 'invalid';
      diagnostics.push(`Authenticated decode failed: ${e.message}`);
      return { ok: false, rootHash: u8ToHex(rootHashU8), verdict, fingerprint, diagnostics };
    }

    return {
      ok: verdict === 'trusted' || verdict === 'signed',
      rootHash: u8ToHex(rootHashU8),
      verdict,
      fingerprint,
      diagnostics,
    };
  }

  static async inspect(container) {
    const parsed = await JhcPackage.parse(container);
    const manifest = parsed.manifest;
    const resources = parsed.resources;
    return {
      format: 'jhc-1.0',
      applicationId: manifest.applicationId,
      applicationVersion: manifest.applicationVersion,
      entry: manifest.entry,
      sectionCount: parsed.directory.length,
      resourceCount: Object.keys(resources).length,
      rootHash: parsed.rootHash,
      signed: parsed.signature !== null,
      resourcePaths: Object.keys(resources).sort(),
    };
  }
}
