// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Canonical logical-path validator for JHC packages.
 */

import * as constants from './constants.js';

export class JhcPathError extends Error {
    constructor(code, message = constants.JHC_MESSAGES[code] || 'JHC validation error') {
        super(message);
        this.code = code;
        this.message = message;
        this.name = 'JhcPathError';
    }
}

const FORBIDDEN_SEGMENT_RE = /[\\:?#*|<>"\x00-\x1f\x7f]/;
const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION_RE = /^[A-Za-z0-9]+(?:[._+~\-][A-Za-z0-9]+)*$/;

function isHex(ch) {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function hexValue(ch) {
    if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 0x30;
    if (ch >= 'a' && ch <= 'f') return ch.charCodeAt(0) - 0x61 + 10;
    if (ch >= 'A' && ch <= 'F') return ch.charCodeAt(0) - 0x41 + 10;
    return -1;
}

function decodePercent(path) {
    const encoder = new TextEncoder();
    const chars = Array.from(path);
    const bytes = [];
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === '%') {
            if (i + 2 >= chars.length) {
                throw new JhcPathError(constants.JHC_E_INVALID_PERCENT, 'truncated percent escape');
            }
            const a = chars[i + 1], b = chars[i + 2];
            if (!isHex(a) || !isHex(b)) {
                throw new JhcPathError(constants.JHC_E_INVALID_PERCENT, 'non-hex percent escape');
            }
            bytes.push((hexValue(a) << 4) | hexValue(b));
            i += 2;
        } else {
            for (const byte of encoder.encode(ch)) {
                bytes.push(byte);
            }
        }
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    } catch (e) {
        throw new JhcPathError(constants.JHC_E_INVALID_UTF8, `invalid UTF-8: ${e.message}`);
    }
}

export function canonicalize(path) {
    if (typeof path !== 'string') {
        throw new JhcPathError(constants.JHC_E_INVALID_PATH, 'path must be a string');
    }
    if (!path) {
        throw new JhcPathError(constants.JHC_E_INVALID_PATH, 'path is empty');
    }
    if (path.length > constants.JHC_MAX_PATH_LENGTH) {
        throw new JhcPathError(constants.JHC_E_PATH_TOO_LONG, 'path exceeds maximum length');
    }

    const decoded = decodePercent(path);
    if (decoded.indexOf('\0') !== -1) {
        throw new JhcPathError(constants.JHC_E_NULL_BYTE, 'path contains null byte');
    }
    if (decoded.startsWith('/')) {
        throw new JhcPathError(constants.JHC_E_ABSOLUTE_PATH, 'absolute paths are not allowed');
    }
    if (decoded.startsWith('\\')) {
        throw new JhcPathError(constants.JHC_E_BACKSLASH, 'backslashes are not allowed');
    }
    if (decoded.indexOf(':') !== -1) {
        throw new JhcPathError(constants.JHC_E_DRIVE_LETTER, 'drive letters/colons are not allowed');
    }

    const segments = decoded.split('/');
    for (const seg of segments) {
        if (!seg) {
            throw new JhcPathError(constants.JHC_E_EMPTY_SEGMENT, 'empty path segment');
        }
        if (seg === '.' || seg === '..') {
            throw new JhcPathError(constants.JHC_E_TRAVERSAL, 'dot segment is not allowed');
        }
        if (FORBIDDEN_SEGMENT_RE.test(seg)) {
            throw new JhcPathError(constants.JHC_E_RESERVED_CHAR, 'segment contains reserved character');
        }
    }

    return segments.join('/');
}

export function validate(path) {
    return canonicalize(path);
}

export function isValid(path) {
    try {
        canonicalize(path);
        return true;
    } catch (e) {
        return false;
    }
}

export function validateMany(paths) {
    if (!Array.isArray(paths) && !(paths instanceof Set) && !(paths instanceof Map)) {
        // Accept iterables by converting to array.
        try {
            paths = Array.from(paths);
        } catch (e) {
            throw new JhcPathError(constants.JHC_E_INVALID_PATH, 'paths must be a collection');
        }
    }

    const canonicals = [];
    const errors = [];
    const seen = new Map();

    for (const original of paths) {
        let canonical;
        try {
            canonical = canonicalize(original);
        } catch (e) {
            errors.push({ path: original, code: e.code, message: e.message });
            continue;
        }

        if (seen.has(canonical)) {
            errors.push({
                path: original,
                code: constants.JHC_E_DUPLICATE_PATH,
                message: constants.JHC_MESSAGES[constants.JHC_E_DUPLICATE_PATH],
            });
            continue;
        }
        seen.set(canonical, original);
        canonicals.push(canonical);
    }

    return { ok: errors.length === 0, canonicals, errors };
}

export function validateId(appId) {
    if (typeof appId !== 'string') {
        throw new JhcPathError(constants.JHC_E_INVALID_ID, 'id must be a string');
    }
    if (!appId) {
        throw new JhcPathError(constants.JHC_E_INVALID_ID, 'id is empty');
    }
    if (appId.length > constants.JHC_MAX_ID_LENGTH) {
        throw new JhcPathError(constants.JHC_E_INVALID_ID, 'id exceeds maximum length');
    }
    if (!ID_RE.test(appId)) {
        throw new JhcPathError(constants.JHC_E_INVALID_ID, 'id contains unsafe characters');
    }
    return appId;
}

export function isValidId(appId) {
    try {
        validateId(appId);
        return true;
    } catch (e) {
        return false;
    }
}

export function validateVersion(version) {
    if (typeof version !== 'string') {
        throw new JhcPathError(constants.JHC_E_INVALID_VERSION, 'version must be a string');
    }
    if (!version) {
        throw new JhcPathError(constants.JHC_E_INVALID_VERSION, 'version is empty');
    }
    if (version.length > constants.JHC_MAX_VERSION_LENGTH) {
        throw new JhcPathError(constants.JHC_E_INVALID_VERSION, 'version exceeds maximum length');
    }
    if (!VERSION_RE.test(version)) {
        throw new JhcPathError(constants.JHC_E_INVALID_VERSION, 'version contains unsafe characters');
    }
    return version;
}

export function isValidVersion(version) {
    try {
        validateVersion(version);
        return true;
    } catch (e) {
        return false;
    }
}
