# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Physical root aliases must produce exactly the same public module IDs."""
import ctypes
import os
from pathlib import Path
import tempfile
import unittest

from bundler.graph import ModuleGraph


class GraphRootPathTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sdk long graph root ')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / 'long directory name'
        self.root.mkdir()
        (self.root / 'dependency.js').write_text('export const value = 42;\n', encoding='utf-8')
        (self.root / 'entry.js').write_text(
            "export {value} from './dependency.js';\n", encoding='utf-8')

    def check_root(self, root):
        graph = ModuleGraph(root)
        graph.walk('entry.js')
        self.assertEqual(graph.errors, [])
        self.assertEqual(graph.root, self.root)
        self.assertEqual([graph.mod_id(path) for path in graph.order], ['dependency.js', 'entry.js'])
        self.assertFalse(graph.should_skip(self.root / 'entry.js'))
        graph.walk_source('generated.js', "export {value} from './dependency.js';\n")
        self.assertEqual(graph.errors, [])
        self.assertEqual(graph.mod_id(str(self.root / 'generated.js')), 'generated.js')

    def test_relative_root_uses_physical_identity(self):
        self.check_root(os.path.relpath(self.root))

    def test_symlink_root_uses_physical_identity(self):
        alias = self.root.parent / 'alias'
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except OSError as error:
            self.skipTest(f'Directory symlinks unavailable: {error}')
        self.check_root(alias)

    @unittest.skipUnless(os.name == 'nt', 'Windows 8.3 alias contract')
    def test_windows_short_root_uses_physical_identity(self):
        get_short_path = ctypes.windll.kernel32.GetShortPathNameW
        get_short_path.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
        get_short_path.restype = ctypes.c_uint32
        size = get_short_path(str(self.root), None, 0)
        self.assertGreater(size, 0)
        buffer = ctypes.create_unicode_buffer(size)
        self.assertGreater(get_short_path(str(self.root), buffer, size), 0)
        if buffer.value == str(self.root):
            self.skipTest('Volume has 8.3 short-name creation disabled')
        self.check_root(Path(buffer.value))

    @unittest.skipUnless(os.name == 'nt', 'Windows junction alias contract')
    def test_windows_junction_root_uses_physical_identity(self):
        import _winapi
        alias = self.root.parent / 'junction'
        _winapi.CreateJunction(str(self.root), str(alias))
        self.check_root(alias)


if __name__ == '__main__':
    unittest.main()
