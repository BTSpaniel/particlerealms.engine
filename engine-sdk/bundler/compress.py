# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.compress — gzip/zopfli/brotli/zstd/lzma backends + size formatting."""

import gzip
import hashlib
import lzma

try:
    import brotli as _brotli
    HAS_BROTLI = True
except ImportError:
    HAS_BROTLI = False

try:
    import zstandard as _zstd
    HAS_ZSTD = True
except ImportError:
    HAS_ZSTD = False

try:
    from zopfli import gzip as _zopfli_gzip
    HAS_ZOPFLI = True
except ImportError:
    HAS_ZOPFLI = False


# RFC 9842 Dictionary-Compressed Zstandard frame header: a Zstandard
# skippable-frame magic, a fixed 32-byte payload length, then SHA-256(dict).
DCZ_MAGIC = bytes((0x5E, 0x2A, 0x4D, 0x18, 0x20, 0x00, 0x00, 0x00))
DCZ_HEADER_LEN = 40

# Keep the native-thread optimization bounded to small standalone bundles.
# Large platform inputs retain process isolation after measured thread slowdown.
SMALL_COMPRESSION_INPUT_BYTES = 4 * 1024 * 1024


def compress_gzip(data_bytes, level=9):
    """Gzip-compress bytes deterministically at the requested level.

    Pinning ``mtime`` prevents two otherwise identical releases from receiving
    different gzip headers merely because they were built at different times.
    """
    return gzip.compress(data_bytes, compresslevel=level, mtime=0)


def compress_zopfli(data_bytes, numiterations=5):
    """Zopfli gzip-compatible compress — 5-8% better than standard gzip.
    pip install zopfli  — returns None if unavailable.
    Default 5 iterations (was 15): ~3x faster, <0.3% larger."""
    if not HAS_ZOPFLI:
        return None
    return _zopfli_gzip.compress(data_bytes, numiterations=numiterations)


def compress_brotli(data_bytes, quality=11):
    """Brotli compress bytes at max quality. Returns None if brotli not available."""
    if not HAS_BROTLI:
        return None
    return _brotli.compress(data_bytes, quality=quality)


def compress_zstd(data_bytes, level=22):
    """Zstandard compress at max level (1-22). Chrome 123+, Firefox 126+.
    pip install zstandard  — returns None if unavailable."""
    if not HAS_ZSTD:
        return None
    cctx = _zstd.ZstdCompressor(level=level)
    return cctx.compress(data_bytes)


def compress_lzma(data_bytes, extreme=False):
    """LZMA/XZ compress with file-adaptive dictionary (Python stdlib).

    For stats only — browsers cannot decompress this format natively.
    Default: preset 6 (~3s). extreme=True: PRESET_EXTREME (~30s).
    """
    n = len(data_bytes)
    dict_size = 1 << max(22, (n - 1).bit_length())
    dict_size = min(dict_size, 1 << 28)
    preset = lzma.PRESET_EXTREME if extreme else 6
    filters = [{
        "id":     lzma.FILTER_LZMA2,
        "preset": preset,
        "dict_size": dict_size,
    }]
    return lzma.compress(data_bytes, format=lzma.FORMAT_XZ, filters=filters)


def compress_zstd_with_dict(data_bytes, dict_bytes, level=22):
    """Zstd compress using a raw-bytes dictionary (CDT workflow).

    In CDT the dictionary IS a previous version of the same file.
    dict_bytes should be the minified bundle from the last build.
    Returns None if zstandard is not installed.
    """
    if not HAS_ZSTD or dict_bytes is None:
        return None
    zdict = _zstd.ZstdCompressionDict(dict_bytes)
    cctx  = _zstd.ZstdCompressor(level=level, dict_data=zdict)
    return cctx.compress(data_bytes)


def wrap_dcz(zstd_stream, dict_bytes):
    """Wrap a dictionary-compressed Zstandard stream as RFC 9842 ``dcz``.

    The embedded SHA-256 binds the response to the exact dictionary advertised
    by ``Use-As-Dictionary``. It is intentionally not a signature; HTTPS and
    signed release metadata remain responsible for origin authenticity.
    """
    if not isinstance(zstd_stream, (bytes, bytearray, memoryview)):
        raise TypeError("zstd_stream must be bytes-like")
    if not isinstance(dict_bytes, (bytes, bytearray, memoryview)):
        raise TypeError("dict_bytes must be bytes-like")
    return DCZ_MAGIC + hashlib.sha256(bytes(dict_bytes)).digest() + bytes(zstd_stream)


def compress_dcz(data_bytes, dict_bytes, level=22):
    """Compress with a raw-content dictionary and emit an RFC 9842 frame."""
    stream = compress_zstd_with_dict(data_bytes, dict_bytes, level=level)
    return None if stream is None else wrap_dcz(stream, dict_bytes)


def parse_dcz_header(data_bytes):
    """Return the dictionary hash and Zstandard payload from a ``dcz`` frame."""
    data = bytes(data_bytes)
    if len(data) < DCZ_HEADER_LEN:
        raise ValueError("DCZ frame is shorter than its 40-byte header")
    if data[:8] != DCZ_MAGIC:
        raise ValueError("DCZ frame has an invalid dictionary-hash header")
    return {"dictionary_sha256": data[8:40].hex(), "zstd_stream": data[40:]}


def fmt_size(b):
    """Format bytes as human-readable."""
    if b < 1024:
        return f"{b} B"
    if b < 1024 * 1024:
        return f"{b / 1024:.1f} KB"
    return f"{b / (1024 * 1024):.2f} MB"
