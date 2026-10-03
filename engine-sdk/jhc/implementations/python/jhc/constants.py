# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Generated constants for JHC.  Keep in sync with jhc/registry/*.json."""

# Diagnostics
JHC_E_INVALID_PATH = 100
JHC_E_INVALID_ID = 101
JHC_E_INVALID_VERSION = 102
JHC_E_DUPLICATE_PATH = 103
JHC_E_PATH_TOO_LONG = 104
JHC_E_ABSOLUTE_PATH = 105
JHC_E_TRAVERSAL = 106
JHC_E_NULL_BYTE = 107
JHC_E_INVALID_UTF8 = 108
JHC_E_DRIVE_LETTER = 109
JHC_E_BACKSLASH = 110
JHC_E_EMPTY_SEGMENT = 111
JHC_E_RESERVED_CHAR = 112
JHC_E_INVALID_PERCENT = 113
JHC_E_TOO_MANY_FILES = 114
JHC_E_FILE_TOO_LARGE = 115
JHC_E_PACKAGE_TOO_LARGE = 116
JHC_E_MANIFEST_TOO_LARGE = 117
JHC_E_TOO_MANY_SECTIONS = 118
JHC_E_DECODE_BUDGET = 119
JHC_E_LENGTH_MISMATCH = 120
JHC_E_OVERLAPPING_SECTION = 121
JHC_E_UNSUPPORTED_CODEC = 122
JHC_E_BAD_RESOURCE_MAP = 123
JHC_E_SIGNATURE_REQUIRED = 124
JHC_E_DICTIONARY_MISMATCH = 125
JHC_E_LICENSE_MISMATCH = 126

JHC_MESSAGES = {
    JHC_E_INVALID_PATH: "Path is not canonical or contains unsafe components.",
    JHC_E_INVALID_ID: "Application identifier is not safe.",
    JHC_E_INVALID_VERSION: "Version string is not safe.",
    JHC_E_DUPLICATE_PATH: "Duplicate normalized path.",
    JHC_E_PATH_TOO_LONG: "Path exceeds the maximum allowed length.",
    JHC_E_ABSOLUTE_PATH: "Absolute paths are not allowed.",
    JHC_E_TRAVERSAL: "Path traversal is not allowed.",
    JHC_E_NULL_BYTE: "Path contains a null byte.",
    JHC_E_INVALID_UTF8: "Path contains invalid UTF-8.",
    JHC_E_DRIVE_LETTER: "Drive letters are not allowed.",
    JHC_E_BACKSLASH: "Backslashes are not allowed.",
    JHC_E_EMPTY_SEGMENT: "Empty path segment is not allowed.",
    JHC_E_RESERVED_CHAR: "Path segment contains a reserved character.",
    JHC_E_INVALID_PERCENT: "Invalid percent-encoding.",
    JHC_E_TOO_MANY_FILES: "Package contains too many files.",
    JHC_E_FILE_TOO_LARGE: "File exceeds the maximum allowed size.",
    JHC_E_PACKAGE_TOO_LARGE: "Package exceeds the maximum allowed size.",
    JHC_E_MANIFEST_TOO_LARGE: "Manifest exceeds the maximum allowed size.",
    JHC_E_TOO_MANY_SECTIONS: "Package contains too many sections.",
    JHC_E_DECODE_BUDGET: "Decoded data exceeds the configured resource budget.",
    JHC_E_LENGTH_MISMATCH: "Decoded data length does not match authenticated metadata.",
    JHC_E_OVERLAPPING_SECTION: "Package sections overlap or cover protected metadata.",
    JHC_E_UNSUPPORTED_CODEC: "Package uses an unsupported or invalid codec.",
    JHC_E_BAD_RESOURCE_MAP: "Manifest resources do not match package sections.",
    JHC_E_SIGNATURE_REQUIRED: "A valid package signature is required.",
    JHC_E_DICTIONARY_MISMATCH: "Compression dictionary identity does not match authenticated metadata.",
    JHC_E_LICENSE_MISMATCH: "Asset license or provenance metadata does not match packaged content.",
}

# Section types
JHC_SECTION_MANIFEST = 0
JHC_SECTION_RAW_RESOURCE = 1
JHC_SECTION_SOURCE_MAP = 2
JHC_SECTION_LICENSE = 3
JHC_SECTION_SIGNATURE = 4

# Feature bits
JHC_FEATURE_MODULE_ENTRY = 1 << 0
JHC_FEATURE_DOCUMENT_ENTRY = 1 << 1
JHC_FEATURE_WORKER = 1 << 2
JHC_FEATURE_DYNAMIC_IMPORT = 1 << 3
JHC_FEATURE_WASM = 1 << 4

# Limits
JHC_MAX_PATH_LENGTH = 4096
JHC_MAX_ID_LENGTH = 64
JHC_MAX_VERSION_LENGTH = 64
JHC_MAX_FILES_PER_PACKAGE = 10000
JHC_MAX_FILE_SIZE = 50 * 1024 * 1024      # 50 MiB
JHC_MAX_PACKAGE_SIZE = 1024 * 1024 * 1024 # 1 GiB
JHC_MAX_MANIFEST_SIZE = 4 * 1024 * 1024    # 4 MiB
JHC_MAX_LICENSE_SIZE = 4 * 1024 * 1024     # 4 MiB
JHC_MAX_SIGNATURE_SIZE = 16 * 1024         # 16 KiB
JHC_MAX_TOTAL_DECODED_SIZE = 256 * 1024 * 1024  # 256 MiB
JHC_MAX_EXPANSION_RATIO = 256
JHC_MAX_EXPANSION_SLACK = 1024 * 1024       # 1 MiB

# Op-code placeholder
JHC_OPCODE_JS_VAR = 0
JHC_OPCODE_JS_CONST = 1
JHC_OPCODE_JS_LET = 2
JHC_OPCODE_JS_FUNCTION = 3
JHC_OPCODE_JS_CLASS = 4
JHC_OPCODE_JS_IMPORT = 5
JHC_OPCODE_JS_EXPORT = 6
