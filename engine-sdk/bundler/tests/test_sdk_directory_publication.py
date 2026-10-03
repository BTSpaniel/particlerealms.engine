# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Directory publication has the same verification and rollback guarantees."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from bundler import sdk
from bundler.tests.test_sdk import sdk_fixture, write


class DirectoryPublicationTests(unittest.TestCase):
    def test_directory_cache_requires_integrity_but_not_a_zip(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'engine-sdk'
            sdk_fixture(root)
            (root.parent / 'particle-engine-sdk.zip').unlink()
            self.assertTrue(sdk.sdk_is_current(root, 'engine', create_archive=False))
            self.assertFalse(sdk.sdk_is_current(root, 'engine'))
            write(root, 'unexpected.txt', 'not inventoried')
            self.assertFalse(sdk.sdk_is_current(root, 'engine', create_archive=False))

    def test_verified_directory_promotion_does_not_touch_existing_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            stage, final = base / 'stage', base / 'engine-sdk'
            sdk_fixture(stage)
            archive = write(base, 'particle-engine-sdk.zip', b'preserve previous archive')
            sdk._publish_sdk(stage, final)
            self.assertTrue(sdk.sdk_is_current(final, 'engine', create_archive=False))
            self.assertEqual(archive.read_bytes(), b'preserve previous archive')
            self.assertFalse(list(base.glob('.sdk-rollback-*')))

    def test_failed_directory_verification_restores_previous_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            stage, final = base / 'stage', base / 'engine-sdk'
            sdk_fixture(stage)
            sdk_fixture(final)
            (base / 'particle-engine-sdk.zip').unlink()
            original = {p.relative_to(final): p.read_bytes() for p in final.rglob('*') if p.is_file()}
            with mock.patch.object(sdk, 'verify_sdk', side_effect=ValueError('injected verification failure')):
                with self.assertRaisesRegex(ValueError, 'injected'):
                    sdk._publish_sdk(stage, final)
            self.assertEqual({p.relative_to(final): p.read_bytes() for p in final.rglob('*') if p.is_file()}, original)
            self.assertFalse((base / 'particle-engine-sdk.zip').exists())
            self.assertFalse(list(base.glob('.sdk-rollback-*')))


if __name__ == '__main__':
    unittest.main()
