# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Security and wire-format tests for Compression Dictionary Transport."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from bundler.compress import (
    DCZ_HEADER_LEN,
    DCZ_MAGIC,
    HAS_ZSTD,
    compress_dcz,
    parse_dcz_header,
    wrap_dcz,
)
from bundler.config import DEFAULT_ENTRY, DEFAULT_NAME, resolve_bundle_configuration


class TestDczWireFormat(unittest.TestCase):
    def test_header_binds_exact_dictionary(self):
        dictionary = b"previous version of the minified bundle"
        stream = b"\x28\xb5\x2f\xfdpayload"
        frame = wrap_dcz(stream, dictionary)
        parsed = parse_dcz_header(frame)

        self.assertEqual(len(frame), DCZ_HEADER_LEN + len(stream))
        self.assertEqual(frame[:8], DCZ_MAGIC)
        self.assertEqual(parsed["dictionary_sha256"], hashlib.sha256(dictionary).hexdigest())
        self.assertEqual(parsed["zstd_stream"], stream)

    def test_invalid_or_truncated_header_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_dcz_header(b"short")
        with self.assertRaises(ValueError):
            parse_dcz_header(b"\0" * DCZ_HEADER_LEN)

    @unittest.skipUnless(HAS_ZSTD, "zstandard is optional")
    def test_dcz_payload_round_trips_with_exact_dictionary(self):
        import zstandard

        dictionary = (b"const previousVersion = true;\n" * 64)
        content = dictionary.replace(b"true", b"false") + b"export default previousVersion;\n"
        frame = compress_dcz(content, dictionary, level=10)
        parsed = parse_dcz_header(frame)
        dctx = zstandard.ZstdDecompressor(
            dict_data=zstandard.ZstdCompressionDict(dictionary)
        )
        self.assertEqual(dctx.decompress(parsed["zstd_stream"]), content)


class TestBundlerFlags(unittest.TestCase):
    @staticmethod
    def _args(config_path, build_site):
        return SimpleNamespace(
            targets_config=str(config_path), target="test", entry=[DEFAULT_ENTRY],
            include_agi=False, include_plauna=False, include_webgpu_os=False,
            name=DEFAULT_NAME, eager=False, site_profile=None, build_site=build_site,
            build_sdk=False, include_editor=False,
        )

    def test_explicit_no_site_overrides_target_default(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "targets.json"
            config.write_text(json.dumps({
                "defaultTarget": "test",
                "targets": {"test": {"entry": DEFAULT_ENTRY, "build_site": True}},
            }), encoding="utf-8")
            explicit = self._args(config, False)
            resolve_bundle_configuration(explicit)
            self.assertFalse(explicit.build_site)

            inherited = self._args(config, None)
            resolve_bundle_configuration(inherited)
            self.assertTrue(inherited.build_site)


if __name__ == "__main__":
    unittest.main()
