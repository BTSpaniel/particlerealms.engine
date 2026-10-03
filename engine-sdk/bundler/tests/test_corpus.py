# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Real-repository parser cross-checks for the production bundler."""

import unittest
import hashlib
from pathlib import Path

from bundler.parser import parse_module
from bundler.emitter import find_executable_import_meta, rewrite_module_canonical
from bundler.scan_import_paths import scan_import_paths
from bundler.transform import is_shader_file, preprocess_shader_source


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


def collect_corpus_results(root, source_roots=SOURCE_ROOTS):
    """Record the actual source census and parser/scanner/emitter outcomes."""
    root = Path(root).resolve()
    records = []
    for source_root in source_roots:
        for path in sorted((root / source_root).rglob("*.js")):
            relative = path.relative_to(root)
            if EXCLUDED_PARTS.intersection(relative.parts):
                continue
            raw = path.read_bytes()
            source = raw.decode("utf-8", errors="strict")
            preprocessed = is_shader_file(str(path))
            if preprocessed:
                source = preprocess_shader_source(source)
            record = {"name": relative.as_posix(), "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest(),
                      "shaderPreprocessed": preprocessed, "status": "PASS"}
            try:
                imports, exports = parse_module(source)
                rewritten = rewrite_module_canonical(source, str(path), _CorpusGraph())
                canonical = {item.spec for item in imports if item.spec}
                canonical.update(item.spec for item in exports if item.spec)
                scanned = scan_import_paths(source)
                if canonical != scanned:
                    raise AssertionError(f"parser={sorted(canonical)!r} scanner={sorted(scanned)!r}")
                if not rewritten.strip() and source.strip():
                    raise AssertionError("canonical emitter erased the module")
                if find_executable_import_meta(rewritten):
                    raise AssertionError("canonical emitter retained executable import.meta")
                record.update(imports=sorted(canonical), exports=[{"default": item.default, "named": item.named,
                              "declaration": item.declaration, "namespace": item.namespace} for item in exports],
                              emittedSha256=hashlib.sha256(rewritten.encode()).hexdigest())
            except Exception as error:
                record.update(status="FAIL", error=f"{type(error).__name__}: {error}")
            records.append(record)
    return records


class TestProductionCorpus(unittest.TestCase):
    def test_parser_matches_dependency_scanner_on_real_modules(self):
        records = collect_corpus_results(ROOT)
        failures = [f"{record['name']}: {record['error']}" for record in records if record['status'] != 'PASS']
        self.assertGreater(len(records), 100, "production corpus gate did not scan enough modules")
        self.assertFalse(failures, "\n" + "\n".join(failures[:100]))


if __name__ == "__main__":
    unittest.main()
