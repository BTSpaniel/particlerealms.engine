# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import tempfile
import unittest
from pathlib import Path

from bundler.stable_resource_inventory import (
    STABLE_NETWORK_RESOURCE_ENTRY_PATHS,
    STABLE_RESOURCE_INVENTORY_EXPORT,
    STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH,
    StableResourceInventoryError,
    generate_stable_resource_inventory,
    stable_network_resource_repository_paths,
    stable_network_resource_scope_paths,
    stable_resource_inventory_module_bytes,
    verify_stable_resource_inventory,
)


ROOT = Path(__file__).resolve().parents[2]


class TestStableResourceInventory(unittest.TestCase):
    def test_checked_in_inventory_is_the_complete_deterministic_host_closure(self):
        repository_paths = stable_network_resource_repository_paths(ROOT)
        scope_paths = stable_network_resource_scope_paths(ROOT)
        generated = stable_resource_inventory_module_bytes(ROOT)

        self.assertEqual(repository_paths, tuple(sorted(set(repository_paths))))
        self.assertGreater(len(repository_paths), 100)
        for entry in STABLE_NETWORK_RESOURCE_ENTRY_PATHS:
            self.assertIn(entry, repository_paths)
        self.assertIn(
            STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH.removeprefix("webgpu-os/"),
            scope_paths,
        )
        self.assertIn(
            f"export const {STABLE_RESOURCE_INVENTORY_EXPORT} = Object.freeze(".encode(),
            generated,
        )
        inventory = ROOT / STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH
        self.assertEqual(inventory.read_bytes(), generated)
        self.assertEqual(verify_stable_resource_inventory(ROOT, inventory), len(scope_paths))

    def test_generator_repairs_a_stale_destination_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "StableResourceInventory.generated.js"
            destination.write_bytes(b"stale")
            generated = generate_stable_resource_inventory(ROOT, destination=destination)
            expected = stable_resource_inventory_module_bytes(ROOT)

            self.assertEqual(generated, destination)
            self.assertEqual(destination.read_bytes(), expected)
            before = destination.stat().st_mtime_ns
            generate_stable_resource_inventory(ROOT, destination=destination)
            self.assertEqual(destination.stat().st_mtime_ns, before)

    def test_unresolved_bare_and_escaping_imports_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            entry = root / "entry.js"
            entry.write_text("import 'not-a-browser-module';\n", encoding="utf-8")
            with self.assertRaisesRegex(StableResourceInventoryError, "bare import"):
                stable_network_resource_repository_paths(root, entry_paths=("entry.js",))

            entry.write_text("import '../outside.js';\n", encoding="utf-8")
            (root.parent / "outside.js").write_text("export default true;\n", encoding="utf-8")
            with self.assertRaisesRegex(StableResourceInventoryError, "escapes"):
                stable_network_resource_repository_paths(root, entry_paths=("entry.js",))


if __name__ == "__main__":
    unittest.main()
