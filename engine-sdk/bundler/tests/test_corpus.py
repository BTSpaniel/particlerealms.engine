# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Real-repository parser cross-checks for the production bundler."""

import unittest
from pathlib import Path

from bundler.parser import parse_module
from bundler.emitter import find_executable_import_meta, rewrite_module_canonical
from bundler.scan_import_paths import scan_import_paths


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOTS = ("engine", "editor", "plauna", "agi", "webgpu-os")
EXCLUDED_PARTS = {"vendor", "kaolin", "node_modules", "release", "dist", "build", ".logs", "evidence"}


class _CorpusGraph:
    @staticmethod
    def resolve_import(filepath, spec):
        return spec

    @staticmethod
    def mod_id(resolved):
        return resolved


class TestProductionCorpus(unittest.TestCase):
    def test_parser_matches_dependency_scanner_on_real_modules(self):
        failures = []
        checked = 0
        for source_root in SOURCE_ROOTS:
            for path in (ROOT / source_root).rglob("*.js"):
                if EXCLUDED_PARTS.intersection(path.relative_to(ROOT).parts):
                    continue
                checked += 1
                source = path.read_text(encoding="utf-8", errors="strict")
                try:
                    imports, exports = parse_module(source)
                    rewritten = rewrite_module_canonical(source, str(path), _CorpusGraph())
                except Exception as error:
                    failures.append(f"{path.relative_to(ROOT)}: parse failed: {error}")
                    continue
                if not rewritten.strip() and source.strip():
                    failures.append(f"{path.relative_to(ROOT)}: canonical emitter erased the module")
                remaining_import_meta = find_executable_import_meta(rewritten)
                if remaining_import_meta:
                    failures.append(
                        f"{path.relative_to(ROOT)}: canonical emitter retained "
                        f"{len(remaining_import_meta)} executable import.meta expression(s)"
                    )
                canonical = {item.spec for item in imports if item.spec}
                canonical.update(item.spec for item in exports if item.spec)
                dependency_scan = scan_import_paths(source)
                if canonical != dependency_scan:
                    failures.append(
                        f"{path.relative_to(ROOT)}: parser={sorted(canonical)!r} "
                        f"scanner={sorted(dependency_scan)!r}"
                    )
        self.assertGreater(checked, 100, "production corpus gate did not scan enough modules")
        self.assertFalse(failures, "\n" + "\n".join(failures[:100]))


if __name__ == "__main__":
    unittest.main()
