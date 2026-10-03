# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import json
import tempfile
import unittest
from pathlib import Path
from bundler.engine_demo_transport import descriptor_path, publish_transport, read_transport_file, transport_paths


class EngineDemoTransportTests(unittest.TestCase):
    def test_large_artifact_reassembles_and_rejects_changed_or_missing_parts(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'starter.zip'
            data = bytes(range(256)) * 4
            path.write_bytes(data)
            records = publish_transport(path, 256)
            self.assertFalse(path.exists())
            self.assertEqual(len(records), 4)
            self.assertEqual(read_transport_file(path), data)
            self.assertTrue(all(p.stat().st_size <= 256 for p in transport_paths(path)[1:]))
            part = path.parent / records[0]['src']
            part.write_bytes(b'!' * 256)
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                read_transport_file(path)
            part.unlink()
            with self.assertRaises(FileNotFoundError):
                read_transport_file(path)

    def test_small_artifact_and_legacy_file_keep_their_exact_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'starter.zip'
            path.write_bytes(b'exact')
            self.assertEqual(read_transport_file(path), b'exact')
            self.assertEqual(publish_transport(path, 256), [])
            self.assertEqual(read_transport_file(path), b'exact')
            path.write_bytes(b'wrong')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                read_transport_file(path)

    def test_descriptor_rejects_path_escape_and_wrong_logical_size(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'starter.zip'
            path.write_bytes(b'X' * 512)
            publish_transport(path, 256)
            descriptor = descriptor_path(path)
            original = json.loads(descriptor.read_text())
            changed = json.loads(descriptor.read_text())
            changed['parts'][0]['src'] = '../outside.bin'
            descriptor.write_text(json.dumps(changed))
            with self.assertRaises(ValueError): read_transport_file(path)
            original['bytes'] += 1
            descriptor.write_text(json.dumps(original))
            with self.assertRaises(ValueError): read_transport_file(path)
