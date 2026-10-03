# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Canonical logical-path validator for JHC packages.

Validates the logical paths used inside .prpkg v3 packages, manifest entry
fields, and resource records.  It is intentionally strict: it rejects
absolute paths, traversal, drive letters, backslashes, null bytes, invalid
UTF-8, and reserved characters in path segments.
"""

import re
from . import constants

__all__ = [
    "JhcPathError",
    "canonicalize",
    "validate",
    "is_valid",
    "validate_many",
    "validate_id",
    "is_valid_id",
    "validate_version",
    "is_valid_version",
]


class JhcPathError(ValueError):
    """Exception raised when a path, id, or version fails JHC validation."""

    def __init__(self, code, message=None):
        self.code = code
        self.message = message or constants.JHC_MESSAGES.get(code, "JHC validation error")
        super().__init__(self.message)


# Rejects URL/Windows reserved chars and ASCII control codes.
_FORBIDDEN_SEGMENT_RE = re.compile(r"[\\:?#*|<>\"\x00-\x1f\x7f]")

_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
_VERSION_RE = re.compile(r"^[A-Za-z0-9]+(?:[._+~\-][A-Za-z0-9]+)*$")


def _hex_value(ch):
    if "0" <= ch <= "9":
        return ord(ch) - ord("0")
    if "a" <= ch <= "f":
        return ord(ch) - ord("a") + 10
    if "A" <= ch <= "F":
        return ord(ch) - ord("A") + 10
    return -1


def _decode_percent(path):
    """Decode percent-escape sequences into a UTF-8 string.

    Rejects:
      - truncated % sequences
      - non-hex percent digits
      - UTF-8 overlong forms, surrogates, and invalid code points
    """
    out = []
    i = 0
    n = len(path)
    while i < n:
        ch = path[i]
        if ch == "%":
            if i + 2 >= n:
                raise JhcPathError(constants.JHC_E_INVALID_PERCENT, "truncated percent escape")
            a = _hex_value(path[i + 1])
            b = _hex_value(path[i + 2])
            if a < 0 or b < 0:
                raise JhcPathError(constants.JHC_E_INVALID_PERCENT, "non-hex percent escape")
            out.append((a << 4) | b)
            i += 3
        else:
            out.extend(ch.encode("utf-8"))
            i += 1
    try:
        return bytes(out).decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        raise JhcPathError(constants.JHC_E_INVALID_UTF8, f"invalid UTF-8: {exc}") from None


def canonicalize(path):
    """Return a canonical logical path or raise JhcPathError.

    A canonical path:
      - is a string
      - uses '/' as the only separator
      - has no leading '/' and no trailing '/'
      - contains no empty segments and no '.' or '..' segments
      - contains no backslashes, drive letters, null bytes, or reserved chars
      - is valid UTF-8 and rejects overlong encodings
    """
    if not isinstance(path, str):
        raise JhcPathError(constants.JHC_E_INVALID_PATH, "path must be a string")
    if not path:
        raise JhcPathError(constants.JHC_E_INVALID_PATH, "path is empty")
    if len(path) > constants.JHC_MAX_PATH_LENGTH:
        raise JhcPathError(constants.JHC_E_PATH_TOO_LONG, "path exceeds maximum length")

    decoded = _decode_percent(path)
    if "\x00" in decoded:
        raise JhcPathError(constants.JHC_E_NULL_BYTE, "path contains null byte")
    if decoded.startswith("/"):
        raise JhcPathError(constants.JHC_E_ABSOLUTE_PATH, "absolute paths are not allowed")
    if decoded.startswith("\\"):
        raise JhcPathError(constants.JHC_E_BACKSLASH, "backslashes are not allowed")
    if ":" in decoded:
        raise JhcPathError(constants.JHC_E_DRIVE_LETTER, "drive letters/colons are not allowed")

    segments = decoded.split("/")
    for seg in segments:
        if not seg:
            raise JhcPathError(constants.JHC_E_EMPTY_SEGMENT, "empty path segment")
        if seg == "." or seg == "..":
            raise JhcPathError(constants.JHC_E_TRAVERSAL, "dot segment is not allowed")
        if _FORBIDDEN_SEGMENT_RE.search(seg):
            raise JhcPathError(constants.JHC_E_RESERVED_CHAR, "segment contains reserved character")

    return "/".join(segments)


def validate(path):
    """Alias for canonicalize(); returns the canonical path or raises."""
    return canonicalize(path)


def is_valid(path):
    """Return True if path is canonical, False otherwise."""
    try:
        canonicalize(path)
        return True
    except JhcPathError:
        return False


def validate_many(paths):
    """Validate a collection of paths and return a report.

    Returns:
        {
          "ok": bool,
          "canonicals": list[str],   # unique canonical paths in order
          "errors": list[dict]       # [{"path": original, "code": int, "message": str}, ...]
        }
    """
    if not isinstance(paths, (list, tuple, set, frozenset)):
        raise JhcPathError(constants.JHC_E_INVALID_PATH, "paths must be a collection")

    canonicals = []
    errors = []
    seen = {}

    for original in paths:
        try:
            canonical = canonicalize(original)
        except JhcPathError as exc:
            errors.append({"path": original, "code": exc.code, "message": exc.message})
            continue

        if canonical in seen:
            errors.append({
                "path": original,
                "code": constants.JHC_E_DUPLICATE_PATH,
                "message": constants.JHC_MESSAGES[constants.JHC_E_DUPLICATE_PATH],
            })
            continue
        seen[canonical] = original
        canonicals.append(canonical)

    return {"ok": not errors, "canonicals": canonicals, "errors": errors}


def validate_id(app_id):
    """Return app_id if it is a safe JHC identifier, otherwise raise."""
    if not isinstance(app_id, str):
        raise JhcPathError(constants.JHC_E_INVALID_ID, "id must be a string")
    if not app_id:
        raise JhcPathError(constants.JHC_E_INVALID_ID, "id is empty")
    if len(app_id) > constants.JHC_MAX_ID_LENGTH:
        raise JhcPathError(constants.JHC_E_INVALID_ID, "id exceeds maximum length")
    if not _ID_RE.match(app_id):
        raise JhcPathError(constants.JHC_E_INVALID_ID, "id contains unsafe characters")
    return app_id


def is_valid_id(app_id):
    """Return True if app_id is a safe JHC identifier."""
    try:
        validate_id(app_id)
        return True
    except JhcPathError:
        return False


def validate_version(version):
    """Return version if it is a safe JHC version string, otherwise raise."""
    if not isinstance(version, str):
        raise JhcPathError(constants.JHC_E_INVALID_VERSION, "version must be a string")
    if not version:
        raise JhcPathError(constants.JHC_E_INVALID_VERSION, "version is empty")
    if len(version) > constants.JHC_MAX_VERSION_LENGTH:
        raise JhcPathError(constants.JHC_E_INVALID_VERSION, "version exceeds maximum length")
    if not _VERSION_RE.match(version):
        raise JhcPathError(constants.JHC_E_INVALID_VERSION, "version contains unsafe characters")
    return version


def is_valid_version(version):
    """Return True if version is a safe JHC version string."""
    try:
        validate_version(version)
        return True
    except JhcPathError:
        return False
