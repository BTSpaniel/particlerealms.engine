# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import ast
import hashlib
import base64
import gzip
import io
import json
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from contextlib import ExitStack, redirect_stdout
from unittest import mock

import bundler.cli as cli_module
import bundler.builder as builder_module
import bundler.sdk_rebuild as rebuild_module
from bundler.tests.test_official_package_inventory import _official_record
from bundler.official_inventory import (
    OFFICIAL_PACKAGE_ASSIGNMENT,
    extract_official_package_records,
    official_package_inventory_from_source,
)

from bundler.site import WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS, _ENGINE_DEMO_PLATFORM_ENTRIES, _release_archive_datetime
from bundler.compress import compress_brotli, compress_gzip, compress_lzma, compress_zstd
from bundler.graph import ModuleGraph
from bundler.builder import (
    build_bundle,
    minify_source,
    shorten_bundle_internals,
    shorten_module_ids,
)
from bundler.cli import (
    _base_required_deployment_paths,
    _required_ai_echo_module_paths,
    _required_playground_deployment_paths,
    _release_compressed_artifacts_are_current,
    _release_build_input_digest,
    _inventory_sha256,
    _build_runtime_provenance,
    _module_export_names,
    _source_inventory_sha256,
    _platform_required_modules_by_subsystem,
    _platform_subsystem_manifest,
    _publish_verified_runtime_artifacts,
    _platform_site_requires_production,
    _platform_template_sync_required,
    _signed_os_release_requires_fresh_build,
    _verify_platform_release_artifacts,
    _validate_required_bundle_modules,
    _validate_symbol_contracts,
    _write_release_compressed_artifacts,
    _write_exact_utf8,
)


class TestCliOutputIntegrity(unittest.TestCase):
    def test_sdk_compiler_preserves_supplied_signed_registry_utf8_bytes(self):
        """Execute the actual CLI assembly/optimization branches on a small graph."""
        records = {'os.zeta': _official_record('os.zeta', '2.0.0', 'b'),
                   'os.alpha': _official_record('os.alpha', '1.0.0', 'a')}
        signed_owner = ("export { sum } from 'engine/math/sum.js';\n"
                        "console.debug('engine/EngineBootstrap.js');\n"
                        "export const markup = `<main>  signed UTF-8 雪  </main>`;\n")
        for record in records.values():
            record['envelope']['manifest']['signedOwnerSource'] = signed_owner
            record['envelope']['provenance']['moduleIdentity'] = 'engine/EngineBootstrap.js'
            record['envelope']['signature']['literalEvidence'] = '__r("engine/math/sum.js");console.debug("signed");'
        literal = '\r\n \t' + json.dumps(records, indent=2, ensure_ascii=False) + '\n '
        preamble = ' \t// supplied public registry\r\n' + OFFICIAL_PACKAGE_ASSIGNMENT + literal + ';\r\n'
        expected_inventory = official_package_inventory_from_source(preamble)
        main = next(node for node in ast.parse(Path(cli_module.__file__).read_text(encoding='utf-8')).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'main')
        start = next(index for index, node in enumerate(main.body)
                     if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'bundle'
                     for target in node.targets) and isinstance(node.value, ast.Call)
                     and isinstance(node.value.func, ast.Name) and node.value.func.id == 'build_bundle')
        restoration = next(index for index in range(start, len(main.body))
                           if isinstance(main.body[index], ast.If)
                           and isinstance(main.body[index].test, ast.Name)
                           and main.body[index].test.id == 'protected_registry')
        end = next(index for index in range(restoration + 1, len(main.body))
                   if isinstance(main.body[index], ast.If) and isinstance(main.body[index].test, ast.Name)
                   and main.body[index].test.id == '_official_preamble')
        compilation = compile(ast.Module(body=main.body[start:end + 1], type_ignores=[]),
                              str(cli_module.__file__), 'exec')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bootstrap = root / 'engine/EngineBootstrap.js'
            bootstrap.parent.mkdir(parents=True)
            bootstrap.write_text("export { sum } from './math/sum.js';\nconsole.debug('runtime debug marker');\n",
                                 encoding='utf-8')
            dependency = root / 'engine/math/sum.js'
            dependency.parent.mkdir(parents=True)
            dependency.write_text('export function sum(a, b) { return a + b; }\n', encoding='utf-8')
            graph = ModuleGraph(root)
            graph.walk('engine/EngineBootstrap.js')
            self.assertEqual(graph.errors, [])
            for sdk_build, production in ((True, False), (True, True), (False, True)):
                with self.subTest(sdk_build=sdk_build, production=production), \
                        mock.patch.object(builder_module, 'HAS_ESBUILD', False), \
                        mock.patch.object(cli_module, 'HAS_ESBUILD', False), \
                        mock.patch.object(cli_module, '_prepend_sdk_official_registry',
                                          wraps=cli_module._prepend_sdk_official_registry) as prepend, \
                        redirect_stdout(io.StringIO()):
                    namespace = vars(cli_module).copy()
                    namespace.update(ROOT=root, graph=graph, entry_ids=['engine/EngineBootstrap.js'],
                                     os_base_prefix=None, outdir=root / 'output', _source_preamble=None,
                                     _official_preamble=preamble, _official_package_inventory=expected_inventory,
                                     _lap=lambda _label: None,
                                     args=SimpleNamespace(name='particle-fixture', eager=False,
                                                          include_webgpu_os=True, build_sdk=sdk_build,
                                                          production=production))
                    exec(compilation, namespace)
                    final = namespace['minified']
                    self.assertEqual(namespace['bundle_bytes'][:len(preamble.encode('utf-8'))],
                                     preamble.encode('utf-8'))
                    self.assertEqual(len(namespace['id_map']), 2)
                    extracted = extract_official_package_records(final)
                    self.assertEqual(list(extracted), list(records))
                    self.assertEqual(json.dumps(extracted, ensure_ascii=False), json.dumps(records, ensure_ascii=False))
                    self.assertEqual(official_package_inventory_from_source(final), expected_inventory)
                    self.assertEqual(prepend.call_count, int(sdk_build))
                    if sdk_build:
                        prefix = preamble.encode('utf-8') + b'\n'
                        self.assertEqual(final.encode('utf-8')[:len(prefix)], prefix)
                        runtime = final[len(preamble) + 1:]
                        if production:
                            self.assertNotIn('runtime debug marker', runtime)
                        else:
                            self.assertIn('runtime debug marker', runtime)
                    else:
                        self.assertFalse(final.startswith(preamble))

    def test_sdk_registry_composition_rejects_a_second_embedded_registry(self):
        records = {'os.alpha': _official_record('os.alpha', '1.0.0', 'a')}
        preamble = OFFICIAL_PACKAGE_ASSIGNMENT + json.dumps(records, indent=2) + ';'
        with self.assertRaisesRegex(ValueError, 'exactly one registry assignment'):
            cli_module._prepend_sdk_official_registry(preamble, preamble)

    def test_unknown_target_reports_failure_before_creating_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "output"
            with mock.patch("sys.argv", [
                "bundle_engine.py", "--target", "missing-compression-check-target",
                "--outdir", str(output),
            ]):
                self.assertEqual(cli_module.main(), 2)
            self.assertFalse(output.exists())

    def test_only_production_platform_builds_replace_the_template_runtime_kit(self):
        self.assertTrue(
            _platform_template_sync_required(
                SimpleNamespace(target="platform", production=True, dry_run=False)
            )
        )
        for args in (
            SimpleNamespace(target="platform", production=False, dry_run=False),
            SimpleNamespace(target="platform", production=True, dry_run=True),
            SimpleNamespace(target="webgpu-os", production=True, dry_run=False),
        ):
            self.assertFalse(_platform_template_sync_required(args))

    def test_platform_site_requires_production_but_development_only_bundle_does_not(self):
        self.assertTrue(
            _platform_site_requires_production(
                SimpleNamespace(
                    target="platform",
                    build_site=True,
                    production=False,
                    dry_run=False,
                )
            )
        )
        for args in (
            SimpleNamespace(
                target="platform",
                build_site=False,
                production=False,
                dry_run=False,
            ),
            SimpleNamespace(
                target="platform",
                build_site=True,
                production=True,
                dry_run=False,
            ),
            SimpleNamespace(
                target="platform",
                build_site=True,
                production=False,
                dry_run=True,
            ),
            SimpleNamespace(
                target="webgpu-os",
                build_site=True,
                production=False,
                dry_run=False,
            ),
        ):
            self.assertFalse(_platform_site_requires_production(args))

    def test_gzip_output_is_reproducible(self):
        payload = b"deterministic browser runtime\n" * 128
        compressed = compress_gzip(payload)
        self.assertEqual(compressed, compress_gzip(payload))
        self.assertEqual(compressed[4:8], b"\0\0\0\0")
        self.assertEqual(gzip.decompress(compressed), payload)

    def test_source_content_digest_is_order_independent_and_content_sensitive(self):
        first = {"b.js": "export const b = 2;", "a.js": "export const a = 1;"}
        second = {"a.js": first["a.js"], "b.js": first["b.js"]}
        self.assertEqual(_source_inventory_sha256(first), _source_inventory_sha256(second))
        second["b.js"] = "export const b = 3;"
        self.assertNotEqual(_source_inventory_sha256(first), _source_inventory_sha256(second))

    def test_public_symbol_resolver_follows_reexports_and_rejects_missing_symbols(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "source.js").write_text(
                "export const stable = 1;\n", encoding="utf-8"
            )
            entry = root / "entry.js"
            entry.write_text(
                "export { stable as publicStable } from './source.js';\n",
                encoding="utf-8",
            )
            graph = ModuleGraph(root)
            graph.walk("entry.js")
            self.assertEqual(_module_export_names(graph, "entry.js"), {"publicStable"})
            report = _validate_symbol_contracts(
                graph,
                {"fixture": {"entry": "entry.js", "required": ("publicStable",)}},
                "bootstrap",
            )
            self.assertEqual(report["fixture"]["required_symbols_verified"], 1)

            entry.write_text(
                "export { missing } from './source.js';\n", encoding="utf-8"
            )
            broken = ModuleGraph(root)
            broken.walk("entry.js")
            with self.assertRaisesRegex(RuntimeError, "absent from source.js"):
                _module_export_names(broken, "entry.js")

    def test_browser_root_imports_resolve_to_stable_repository_modules(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stable = root / "webgpu-os" / "shared" / "EchoForm.js"
            stable.parent.mkdir(parents=True)
            stable.write_text("export const createEchoForm = () => null;\n", encoding="utf-8")
            consumer = root / "webgpu-os" / "apps" / "ai-echo" / "factory.js"
            consumer.parent.mkdir(parents=True)
            consumer.write_text(
                "import { createEchoForm } from '/webgpu-os/shared/EchoForm.js';\n"
                "export { createEchoForm };\n",
                encoding="utf-8",
            )

            graph = ModuleGraph(root)
            graph.walk("webgpu-os/apps/ai-echo/factory.js")

            self.assertEqual(graph.errors, [])
            self.assertEqual(
                graph.resolve_import(consumer, "/webgpu-os/shared/EchoForm.js"),
                str(stable.resolve()),
            )
            self.assertIsNone(graph.resolve_import(consumer, "/../outside.js"))
            self.assertEqual(
                set(graph.mod_id(path) for path in graph.modules),
                {"webgpu-os/apps/ai-echo/factory.js", "webgpu-os/shared/EchoForm.js"},
            )
            bundle = build_bundle(
                graph,
                root,
                entry_ids=["webgpu-os/apps/ai-echo/factory.js"],
            )
            self.assertNotIn("skipped: import", bundle)
            self.assertIn("__r('webgpu-os/shared/EchoForm.js')", bundle)

    def test_runtime_provenance_binds_source_and_both_runtime_representations(self):
        minified = b"globalThis.PE={};"
        compressed = compress_gzip(minified)
        source_digest = _source_inventory_sha256({"engine/index.js": "export {};"})
        manifest = {
            "name": "particle-platform",
            "version": "0.8.1",
            "target": "platform",
            "entries": ["engine/index.js"],
            "modules": 1,
            "file_inventory_sha256": _inventory_sha256(["engine/index.js"]),
            "source_content_sha256": source_digest,
            "production": True,
            "eager": True,
            "obfuscate": False,
            "encrypt": False,
        }

        provenance = _build_runtime_provenance(manifest, minified, compressed)

        self.assertEqual(provenance["predicateType"], "https://slsa.dev/provenance/v1")
        self.assertEqual(
            provenance["predicate"]["buildDefinition"]["resolvedDependencies"][0]["digest"]["sha256"],
            source_digest,
        )
        self.assertEqual(
            provenance["subject"][0]["digest"]["sha256"],
            hashlib.sha256(compressed).hexdigest(),
        )

    def test_platform_manifest_cross_verifies_every_subsystem_inventory(self):
        required = _platform_required_modules_by_subsystem()
        files = sorted({path for paths in required.values() for path in paths})

        inventories = _platform_subsystem_manifest(files)

        self.assertEqual(set(inventories), {"engine", "editor", "agi", "plauna", "webgpu-os"})
        for subsystem, contract in inventories.items():
            self.assertGreater(contract["files"], 0, subsystem)
            self.assertEqual(
                contract["required_modules_verified"],
                len(required[subsystem]),
            )

    def test_platform_post_build_verifies_gzip_registry_and_namespaces(self):
        required = _platform_required_modules_by_subsystem()
        files = sorted({path for paths in required.values() for path in paths})
        wrappers = "".join(
            f"__modules[{index}]=(__e,__r)=>{{}};" for index in range(len(files))
        )
        module_id_map = {module_id: index for index, module_id in enumerate(files)}
        runtime = (
            "(function(){var __modules={};var PE={};"
            + wrappers
            + "PE.AGI={};PE.Plauna={};PE.WebGPUOS={};PE.WebGPUOSContent={};"
            + "PE.requireModule=function(){};PE.__require=__r;"
            + "PE.__modules=__modules;PE._require=__r;})();"
        ).encode("utf-8")
        compressed = gzip.compress(runtime, compresslevel=9)
        integrity = "sha384-" + base64.b64encode(hashlib.sha384(runtime).digest()).decode("ascii")
        manifest = {
            "entries": [
                "engine/EngineEditorBootstrap.js",
                "agi/index.js",
                "plauna/index.js",
                "webgpu-os/index.js",
                "webgpu-os/.bundled-os-content.generated.js",
            ],
            "files": files,
            "modules": len(files),
            "file_inventory_sha256": _inventory_sha256(files),
            "browser_runtime_bytes": len(compressed),
            "browser_runtime_decoded_bytes": len(runtime),
            "browser_runtime_integrity": integrity,
            "sri": integrity,
            "public_namespaces": ["AGI", "Plauna", "WebGPUOS", "WebGPUOSContent"],
            "obfuscate": False,
            "encrypt": False,
            "integrity_wrapper": False,
        }
        with tempfile.TemporaryDirectory() as temp:
            gzip_path = Path(temp) / "runtime.min.js.gz"
            gzip_path.write_bytes(compressed)

            report = _verify_platform_release_artifacts(
                manifest,
                files,
                runtime,
                gzip_path,
                module_id_map=module_id_map,
            )

            self.assertEqual(report["registry_entries"], len(files))
            self.assertTrue(report["static_registry_verified"])
            self.assertEqual(report["decoded_sha384"], integrity)

    def test_platform_post_build_verifier_consumes_the_real_builder_grammar(self):
        class TinyPlatformGraph:
            def __init__(self):
                self.order = ["engine/main.js", "agi/index.js", "webgpu-os/tool.js"]
                self.modules = {
                    "engine/main.js": "export const engineValue = 7;\n",
                    "agi/index.js": "export const agiValue = 9;\n",
                    "webgpu-os/tool.js": "export const toolValue = 11;\n",
                }
                self.stats = {
                    "files": len(self.order),
                    "total_bytes": sum(
                        len(source.encode("utf-8")) for source in self.modules.values()
                    ),
                }

            @staticmethod
            def mod_id(filepath):
                return str(filepath).replace("\\", "/")

        graph = TinyPlatformGraph()
        emitted = build_bundle(
            graph,
            ".",
            entry_ids=["engine/main.js", "agi/index.js"],
        )
        compacted, module_id_map = shorten_module_ids(emitted)
        runtime_text = minify_source(shorten_bundle_internals(compacted))
        runtime = runtime_text.encode("utf-8")
        compressed = gzip.compress(runtime, compresslevel=9)
        integrity = "sha384-" + base64.b64encode(hashlib.sha384(runtime).digest()).decode("ascii")
        files = list(graph.order)
        manifest = {
            "entries": ["engine/main.js", "agi/index.js"],
            "files": files,
            "modules": len(files),
            "file_inventory_sha256": _inventory_sha256(files),
            "source_content_sha256": _source_inventory_sha256(graph.modules),
            "browser_runtime_bytes": len(compressed),
            "browser_runtime_decoded_bytes": len(runtime),
            "browser_runtime_integrity": integrity,
            "sri": integrity,
            "public_namespaces": ["AGI"],
            "obfuscate": False,
            "encrypt": False,
            "integrity_wrapper": False,
            "public_api_contracts": {
                "engine": {
                    "entry": "engine/main.js",
                    "required_symbols": ["engineValue"],
                },
            },
        }

        def verify_runtime_text(candidate_text):
            candidate = candidate_text.encode("utf-8")
            candidate_gzip = gzip.compress(candidate, compresslevel=9)
            candidate_integrity = "sha384-" + base64.b64encode(
                hashlib.sha384(candidate).digest()
            ).decode("ascii")
            candidate_manifest = {
                **manifest,
                "browser_runtime_bytes": len(candidate_gzip),
                "browser_runtime_decoded_bytes": len(candidate),
                "browser_runtime_integrity": candidate_integrity,
                "sri": candidate_integrity,
            }
            return _verify_platform_release_artifacts(
                candidate_manifest,
                files,
                candidate,
                candidate_gzip,
                module_sources=graph.modules,
                module_id_map=module_id_map,
            )

        with tempfile.TemporaryDirectory() as temp:
            gzip_path = Path(temp) / "runtime.min.js.gz"
            gzip_path.write_bytes(compressed)
            report = _verify_platform_release_artifacts(
                manifest,
                files,
                runtime,
                compressed,
                module_sources=graph.modules,
                module_id_map=module_id_map,
            )
            self.assertEqual(report["registry_entries"], len(files))

            double_quoted_text = runtime_text.replace(
                "__modules['webgpu-os/tool.js']",
                '__modules["webgpu-os/tool.js"]',
                1,
            )
            self.assertNotEqual(double_quoted_text, runtime_text)
            double_quoted = double_quoted_text.encode("utf-8")
            double_quoted_compressed = gzip.compress(double_quoted, compresslevel=9)
            double_quoted_integrity = "sha384-" + base64.b64encode(
                hashlib.sha384(double_quoted).digest()
            ).decode("ascii")
            double_quoted_manifest = {
                **manifest,
                "browser_runtime_bytes": len(double_quoted_compressed),
                "browser_runtime_decoded_bytes": len(double_quoted),
                "browser_runtime_integrity": double_quoted_integrity,
                "sri": double_quoted_integrity,
            }
            double_quoted_report = _verify_platform_release_artifacts(
                double_quoted_manifest,
                files,
                double_quoted,
                double_quoted_compressed,
                module_sources=graph.modules,
                module_id_map=module_id_map,
            )
            self.assertEqual(double_quoted_report["registry_entries"], len(files))

            wrong_order_text = runtime_text.replace(
                "__modules[0]=", "__modules[999]=", 1
            ).replace(
                "__modules[1]=", "__modules[0]=", 1
            ).replace(
                "__modules[999]=", "__modules[1]=", 1
            )
            self.assertNotEqual(wrong_order_text, runtime_text)
            with self.assertRaisesRegex(RuntimeError, "inventory.*index 0"):
                verify_runtime_text(wrong_order_text)

            registry_marker = "PE.__modules=__modules"
            self.assertIn(registry_marker, runtime_text)
            marker_decoy_text = runtime_text.replace(
                registry_marker,
                "function __registryDecoy(){PE.__modules=__modules}"
                "const __registryText='PE.__modules=__modules'",
                1,
            )
            with self.assertRaisesRegex(RuntimeError, "missing registry marker"):
                verify_runtime_text(marker_decoy_text)

            namespace_marker = "PE.AGI=__AGI"
            self.assertIn(namespace_marker, runtime_text)
            namespace_decoy_text = runtime_text.replace(
                namespace_marker,
                "function __namespaceDecoy(){PE.AGI=__AGI}"
                "const __namespaceText='PE.AGI=__AGI'",
                1,
            )
            with self.assertRaisesRegex(RuntimeError, "missing PE.AGI"):
                verify_runtime_text(namespace_decoy_text)

            direct_export = "__e.engineValue=engineValue"
            target_export = "__e.toolValue=toolValue"
            self.assertIn(direct_export, runtime_text)
            self.assertIn(target_export, runtime_text)
            reexport_text = runtime_text.replace(
                direct_export,
                "Object.assign(__e,__r('webgpu-os/tool.js'))",
                1,
            ).replace(
                target_export,
                target_export + ";__e.engineValue=toolValue",
                1,
            )
            reexport_report = verify_runtime_text(reexport_text)
            self.assertEqual(reexport_report["registry_entries"], len(files))

            wrong_scope_text = runtime_text.replace(
                direct_export,
                "function __exportDecoy(){__e.engineValue=engineValue}",
                1,
            ).replace(
                target_export,
                target_export + ";__e.engineValue=toolValue",
                1,
            )
            with self.assertRaisesRegex(
                RuntimeError,
                "missing engine contract symbol engineValue from engine/main.js",
            ):
                verify_runtime_text(wrong_scope_text)

            for transform_flag in ("obfuscate", "encrypt", "integrity_wrapper"):
                transformed_manifest = {
                    **manifest,
                    transform_flag: True,
                }
                with self.subTest(transform_flag=transform_flag):
                    with self.assertRaisesRegex(
                        RuntimeError,
                        "cannot prove transformed runtime structure",
                    ):
                        _verify_platform_release_artifacts(
                            transformed_manifest,
                            files,
                            runtime,
                            compressed,
                            module_sources=graph.modules,
                            module_id_map=module_id_map,
                        )

            tampered = runtime_text.replace("__modules[0]=", "__missing[0]=", 1).encode("utf-8")
            tampered_compressed = gzip.compress(tampered, compresslevel=9)
            tampered_integrity = "sha384-" + base64.b64encode(
                hashlib.sha384(tampered).digest()
            ).decode("ascii")
            tampered_manifest = {
                **manifest,
                "browser_runtime_bytes": len(tampered_compressed),
                "browser_runtime_decoded_bytes": len(tampered),
                "browser_runtime_integrity": tampered_integrity,
                "sri": tampered_integrity,
            }
            gzip_path.write_bytes(tampered_compressed)
            with self.assertRaisesRegex(RuntimeError, "2 wrappers; manifest requires 3"):
                _verify_platform_release_artifacts(
                    tampered_manifest,
                    files,
                    tampered,
                    gzip_path,
                    module_sources=graph.modules,
                    module_id_map=module_id_map,
                )

    def test_platform_verification_failure_preserves_every_published_runtime_byte(self):
        rejected_runtime = b"(function(){var PE={};})();"
        rejected_gzip = gzip.compress(rejected_runtime, compresslevel=9)
        rejected_integrity = "sha384-" + base64.b64encode(
            hashlib.sha384(rejected_runtime).digest()
        ).decode("ascii")
        files = ["engine/main.js"]
        rejected_manifest = {
            "entries": files,
            "files": files,
            "modules": len(files),
            "file_inventory_sha256": _inventory_sha256(files),
            "browser_runtime_bytes": len(rejected_gzip),
            "browser_runtime_decoded_bytes": len(rejected_runtime),
            "browser_runtime_integrity": rejected_integrity,
            "sri": rejected_integrity,
            "public_namespaces": [],
            "obfuscate": False,
            "encrypt": False,
            "integrity_wrapper": False,
        }

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            outdir = root / "out"
            release = root / "release"
            bundle_name = "particle-platform"
            preseeded = {
                outdir / f"{bundle_name}.js": b"old-unminified-runtime",
                outdir / f"{bundle_name}.min.js": b"old-minified-runtime",
                outdir / f"{bundle_name}.min.js.sri": b"old-output-sri",
                outdir / f"{bundle_name}.min.js.gz": b"old-output-gzip",
                outdir / f"{bundle_name}.min.js.br": b"old-output-brotli",
                outdir / f"{bundle_name}.min.js.zst": b"old-output-zstd",
                outdir / f"{bundle_name}.min.js.dcz": b"old-output-delta",
                release / f"{bundle_name}.min.js.sri": b"old-release-sri",
                release / f"{bundle_name}.min.js.gz": b"old-release-gzip",
                release / f"{bundle_name}.min.js.br": b"old-release-brotli",
                release / f"{bundle_name}.min.js.zst": b"old-release-zstd",
                release / f"{bundle_name}.dict": b"old-release-dictionary",
                release / f"{bundle_name}.manifest.json": b"old-release-manifest",
                release / f"{bundle_name}.provenance.json": b"old-release-provenance",
            }
            for path, payload in preseeded.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(payload)

            def snapshot():
                return {
                    path.relative_to(root).as_posix(): path.read_bytes()
                    for path in sorted(root.rglob("*"))
                    if path.is_file()
                }

            before = snapshot()
            verification_called = False

            def reject_final_artifact():
                nonlocal verification_called
                verification_called = True
                return _verify_platform_release_artifacts(
                    rejected_manifest,
                    files,
                    rejected_runtime,
                    rejected_gzip,
                    module_id_map={},
                )

            candidate_writes = [
                (outdir / f"{bundle_name}.js", b"candidate-unminified-runtime"),
                (outdir / f"{bundle_name}.min.js", rejected_runtime),
                (outdir / f"{bundle_name}.min.js.sri", rejected_integrity.encode("utf-8")),
                (release / f"{bundle_name}.min.js.sri", rejected_integrity.encode("utf-8")),
                (outdir / f"{bundle_name}.min.js.gz", rejected_gzip),
                (outdir / f"{bundle_name}.min.js.br", b"candidate-output-brotli"),
                (outdir / f"{bundle_name}.min.js.zst", b"candidate-output-zstd"),
                (outdir / f"{bundle_name}.min.js.dcz", b"candidate-output-delta"),
                (release / f"{bundle_name}.dict", rejected_runtime),
            ]
            with self.assertRaises(RuntimeError):
                _publish_verified_runtime_artifacts(
                    writes=candidate_writes,
                    release_dir=release,
                    bundle_name=bundle_name,
                    gzip_data=rejected_gzip,
                    best_ext=".br",
                    best_data=b"candidate-release-brotli",
                    verify=reject_final_artifact,
                )

            self.assertTrue(verification_called)
            self.assertEqual(snapshot(), before)

    def test_signed_os_production_and_release_bypass_incremental_cache(self):
        self.assertTrue(_signed_os_release_requires_fresh_build(SimpleNamespace(
            include_webgpu_os=True,
            production=True,
            release=False,
        )))
        self.assertTrue(_signed_os_release_requires_fresh_build(SimpleNamespace(
            include_webgpu_os=True,
            production=False,
            release=True,
        )))
        self.assertFalse(_signed_os_release_requires_fresh_build(SimpleNamespace(
            include_webgpu_os=True,
            production=False,
            release=False,
        )))
        self.assertFalse(_signed_os_release_requires_fresh_build(SimpleNamespace(
            include_webgpu_os=False,
            production=True,
            release=True,
        )))

    def test_ai_echo_contract_covers_every_nested_javascript_module(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "webgpu-os" / "apps" / "ai-echo"
            (source / "audio").mkdir(parents=True)
            (source / "index.js").write_text("export {};", encoding="utf-8")
            (source / "audio" / "factory.js").write_text("export {};", encoding="utf-8")
            (source / "EngineDemoDelivery.js").write_text("export {};", encoding="utf-8")
            (source / "EngineDemoPackage.js").write_text("export {};", encoding="utf-8")
            (source / "EngineDemoPreview.js").write_text("export {};", encoding="utf-8")
            (source / "EngineDemoRuntimeKit.js").write_text("export {};", encoding="utf-8")
            (source / "manifest.json").write_text("{}", encoding="utf-8")

            required = _required_ai_echo_module_paths(root)

            self.assertEqual(
                required,
                [
                    "webgpu-os/apps/ai-echo/audio/factory.js",
                    "webgpu-os/apps/ai-echo/index.js",
                ],
            )
            self.assertEqual(
                _validate_required_bundle_modules(required, required, "AI Echo"),
                2,
            )
            with self.assertRaisesRegex(RuntimeError, "audio/factory.js"):
                _validate_required_bundle_modules(
                    ["webgpu-os/apps/ai-echo/index.js"],
                    required,
                    "AI Echo",
                )

    def test_playground_contract_covers_every_nested_source_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "tests" / "playground"
            (source / "src" / "core").mkdir(parents=True)
            (source / "index.html").write_text("playground", encoding="utf-8")
            (source / "src" / "main.js").write_text("import './core/experiments.js';", encoding="utf-8")
            (source / "src" / "core" / "experiments.js").write_text(
                "export {};", encoding="utf-8"
            )
            (source / "index.legacy.html").write_text(
                "source-only legacy backup", encoding="utf-8"
            )

            self.assertEqual(
                _required_playground_deployment_paths(root),
                [
                    "playground/index.html",
                    "playground/src/core/experiments.js",
                    "playground/src/main.js",
                ],
            )

    def test_release_always_refreshes_gzip_when_zstd_is_best(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            (release / "particle-os.min.js.gz").write_bytes(b"stale-gzip")
            (release / "particle-os.min.js.br").write_bytes(b"stale-brotli")
            best_path = _write_release_compressed_artifacts(
                release,
                "particle-os",
                b"current-gzip",
                ".zst",
                b"current-zstd",
            )

            self.assertEqual((release / "particle-os.min.js.gz").read_bytes(), b"current-gzip")
            self.assertEqual((release / "particle-os.min.js.zst").read_bytes(), b"current-zstd")
            self.assertFalse((release / "particle-os.min.js.br").exists())
            self.assertEqual(best_path, release / "particle-os.min.js.zst")

    def test_release_removes_stale_zstd_when_brotli_is_best(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            (release / "particle-os.min.js.zst").write_bytes(b"stale-zstd")

            best_path = _write_release_compressed_artifacts(
                release,
                "particle-os",
                b"current-gzip",
                ".br",
                b"current-brotli",
            )

            self.assertEqual((release / "particle-os.min.js.gz").read_bytes(), b"current-gzip")
            self.assertEqual((release / "particle-os.min.js.br").read_bytes(), b"current-brotli")
            self.assertFalse((release / "particle-os.min.js.zst").exists())
            self.assertEqual(best_path, release / "particle-os.min.js.br")

    def _sdk_compression_fixture(self, release, *, multipart=False):
        from bundler.runtime_transport import plan_compressed_artifact_parts

        runtime = b"globalThis.PE={vec3:(x,y,z)=>[x,y,z]};"
        payloads = {".gz": compress_gzip(runtime), ".br": compress_brotli(runtime),
                    ".zst": compress_zstd(runtime), ".xz": compress_lzma(runtime)}
        payloads = {extension: data for extension, data in payloads.items() if data is not None}
        sri = "sha384-" + base64.b64encode(hashlib.sha384(runtime).digest()).decode("ascii")
        manifest = {"name": "particle-engine", "target": "engine", "buildMode": "sdk",
                    "source_content_sha256": hashlib.sha256(b"authored source").hexdigest(),
                    "gzip_bytes": len(payloads[".gz"]), "best_compressed": "gzip",
                    "best_bytes": len(payloads[".gz"]), "sri": sri,
                    "browser_runtime_integrity": sri, "browser_runtime_decoded_bytes": len(runtime)}
        for field, extension in (("brotli_bytes", ".br"), ("zstd_bytes", ".zst"), ("lzma_bytes", ".xz")):
            manifest[field] = len(payloads.get(extension, b""))
        writes = [(release / ("particle-engine.min.js" + extension), payload)
                  for extension, payload in payloads.items()]
        if multipart:
            manifest["compressed_artifact_parts"] = {}
            for extension, payload in payloads.items():
                logical_name = "particle-engine.min.js" + extension
                records, parts = plan_compressed_artifact_parts(logical_name, payload,
                                                                max_file_bytes=16, part_bytes=16)
                manifest["compressed_artifact_parts"][logical_name] = records
                writes.extend((release / name, data) for name, data in parts.items())
        provenance = (json.dumps(_build_runtime_provenance(manifest, runtime, payloads[".gz"])) + "\n").encode()
        manifest["provenance"] = {"path": "particle-engine.provenance.json",
                                  "sha256": hashlib.sha256(provenance).hexdigest()}
        writes.extend([(release / "particle-engine.min.js.sri", sri.encode()),
                       (release / "particle-engine.provenance.json", provenance),
                       (release / "particle-engine.manifest.json", json.dumps(manifest).encode())])
        _publish_verified_runtime_artifacts(writes=writes, release_dir=release, bundle_name="particle-engine",
            gzip_data=payloads[".gz"], best_ext=".gz", best_data=payloads[".gz"], preserve_encodings=True)
        return manifest, payloads, writes

    def test_sdk_publication_retains_all_supplied_encodings_and_ordinary_release_cleans_them(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            _, payloads, writes = self._sdk_compression_fixture(release)
            for extension, payload in payloads.items():
                self.assertEqual((release / ("particle-engine.min.js" + extension)).read_bytes(), payload)
            self.assertTrue(_release_compressed_artifacts_are_current(release, "particle-engine"))
            _publish_verified_runtime_artifacts(writes=writes, release_dir=release, bundle_name="particle-engine",
                gzip_data=payloads[".gz"], best_ext=".gz", best_data=payloads[".gz"])
            self.assertEqual((release / "particle-engine.min.js.gz").read_bytes(), payloads[".gz"])
            for extension in (".br", ".zst", ".xz"):
                self.assertFalse((release / ("particle-engine.min.js" + extension)).exists())

    def test_sdk_cache_rejects_missing_and_same_size_corruption_for_every_declared_encoding(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            _, payloads, _ = self._sdk_compression_fixture(release)
            for extension, payload in payloads.items():
                with self.subTest(extension=extension):
                    path = release / ("particle-engine.min.js" + extension)
                    damaged = bytearray(payload)
                    damaged[len(damaged) // 2] ^= 0xFF
                    path.write_bytes(damaged)
                    self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-engine"))
                    path.write_bytes(payload)
                    self.assertTrue(_release_compressed_artifacts_are_current(release, "particle-engine"))
                    path.unlink()
                    self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-engine"))
                    path.write_bytes(payload)

    def test_sdk_cache_verifies_nonbest_parts_with_and_without_whole_encoding_files(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            manifest, payloads, _ = self._sdk_compression_fixture(release, multipart=True)
            self.assertTrue(_release_compressed_artifacts_are_current(release, "particle-engine"))
            for logical_name, records in manifest["compressed_artifact_parts"].items():
                with self.subTest(encoding=logical_name):
                    part = release / records[-1]["src"]
                    original = part.read_bytes()
                    part.write_bytes(b"x" * len(original))
                    self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-engine"))
                    part.write_bytes(original)
                    (release / logical_name).unlink()
                    self.assertTrue(_release_compressed_artifacts_are_current(release, "particle-engine"))
                    part.unlink()
                    self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-engine"))
                    part.write_bytes(original)
                    (release / logical_name).write_bytes(payloads[Path(logical_name).suffix])

    def test_sdk_cache_rejects_malformed_manifest_and_provenance_subject_shapes(self):
        malformed = (None, [], {"subject": None}, {"subject": [None]},
                     {"subject": [{"name": [], "digest": {}}]},
                     {"subject": [{"name": "particle-engine.min.js", "digest": []}]})
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            manifest, _, _ = self._sdk_compression_fixture(release)
            manifest_path = release / "particle-engine.manifest.json"
            proof_path = release / manifest["provenance"]["path"]
            for value in (None, [], "not a manifest"):
                with self.subTest(manifest=value):
                    manifest_path.write_text(json.dumps(value), encoding="utf-8")
                    self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-engine"))
            for value in malformed:
                with self.subTest(provenance=value):
                    payload = json.dumps(value).encode()
                    proof_path.write_bytes(payload)
                    manifest["provenance"]["sha256"] = hashlib.sha256(payload).hexdigest()
                    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                    self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-engine"))

    def test_release_cache_rejects_stale_or_missing_compressed_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            (release / "particle-os.min.js.gz").write_bytes(b"current-gzip")
            (release / "particle-os.min.js.zst").write_bytes(b"current-zstd")
            manifest = {
                "name": "particle-os",
                "gzip_bytes": len(b"current-gzip"),
                "best_compressed": "zstd",
                "best_bytes": len(b"current-zstd"),
            }
            provenance = b'{"predicateType":"https://slsa.dev/provenance/v1"}\n'
            (release / "particle-os.provenance.json").write_bytes(provenance)
            manifest["provenance"] = {
                "path": "particle-os.provenance.json",
                "sha256": hashlib.sha256(provenance).hexdigest(),
            }
            (release / "particle-os.manifest.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )

            self.assertTrue(_release_compressed_artifacts_are_current(release, "particle-os"))
            (release / "particle-os.min.js.br").write_bytes(b"stale-brotli")
            self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-os"))
            (release / "particle-os.min.js.br").unlink()
            (release / "particle-os.min.js.gz").write_bytes(b"wrong-size")
            self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-os"))

    def test_release_cache_requires_exact_declared_parts_even_with_whole_artifacts(self):
        from bundler.runtime_transport import plan_compressed_artifact_parts

        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            name = "particle-os.min.js.gz"
            payload = gzip.compress(b"complete-shared-runtime", mtime=0)
            records, files = plan_compressed_artifact_parts(
                name, payload, max_file_bytes=16, part_bytes=16,
            )
            (release / name).write_bytes(payload)
            for part_name, data in files.items():
                (release / part_name).write_bytes(data)
            provenance = b'{"predicateType":"https://slsa.dev/provenance/v1"}\n'
            (release / "particle-os.provenance.json").write_bytes(provenance)
            manifest = {
                "name": "particle-os", "gzip_bytes": len(payload),
                "best_compressed": "gzip", "best_bytes": len(payload),
                "compressed_artifact_parts": {name: records},
                "provenance": {
                    "path": "particle-os.provenance.json",
                    "sha256": hashlib.sha256(provenance).hexdigest(),
                },
            }
            (release / "particle-os.manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(_release_compressed_artifacts_are_current(release, "particle-os"))
            part = release / records[-1]["src"]
            part.write_bytes(b"x" * records[-1]["bytes"])
            self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-os"))
            part.unlink()
            self.assertFalse(_release_compressed_artifacts_are_current(release, "particle-os"))

    def test_required_deployment_paths_match_each_site_root_layout(self):
        schema_paths = [
            "schemas/morphfield/v2/benchmark-receipt.schema.json",
            "schemas/morphfield/v2/bundle.schema.json",
            "schemas/morphfield/v2/common.schema.json",
            "schemas/morphfield/v2/nexel-capabilities.schema.json",
            "schemas/morphfield/v2/nexel-capability-report.schema.json",
            "schemas/morphfield/v2/nexel.schema.json",
            "schemas/morphfield/v2/particle-chain-simulation.schema.json",
            "schemas/morphfield/v2/patch.schema.json",
            "schemas/morphfield/v2/provenance.schema.json",
            "schemas/morphfield/v2/scene.schema.json",
            "schemas/morphfield/v2/source.schema.json",
            "schemas/morphfield/v2/validation-report.schema.json",
        ]
        os_contract_paths = [
            f"webgpu-os/{relative_path}"
            for relative_path in WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS
        ]
        self.assertEqual(
            _base_required_deployment_paths("webgpu-os", "particle-os"),
            [
                "webgpu-os/index.html",
                "webgpu-os/assets/particle-os.min.js.gz",
                "webgpu-os/assets/particle-os.min.js.sri",
                "webgpu-os/assets/particle-os.manifest.json",
                "webgpu-os/assets/particle-os.provenance.json",
                *os_contract_paths,
                *schema_paths,
            ],
        )
        self.assertEqual(
            _base_required_deployment_paths("platform", "particle-platform"),
            ["index.html", *schema_paths],
        )
        self.assertEqual(
            _base_required_deployment_paths(
                "platform",
                "particle-platform",
                include_webgpu_os=True,
            ),
            ["index.html", *os_contract_paths, *schema_paths],
        )

    def test_exact_utf8_writer_preserves_hashed_line_endings(self):
        source = "alpha\nbeta\nconst shader = `line one\nline two`;\n"

        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "bundle.min.js"
            written = _write_exact_utf8(output, source)

            self.assertEqual(written, source.encode("utf-8"))
            self.assertEqual(output.read_bytes(), written)
            self.assertEqual(
                hashlib.sha384(output.read_bytes()).digest(),
                hashlib.sha384(written).digest(),
            )

    def test_template_runtime_sync_precedes_site_copy_and_optional_consumers_follow(self):
        source = (
            Path(__file__).resolve().parents[1] / "cli.py"
        ).read_text(encoding="utf-8")
        main_source = source[source.index("def main("):]
        template_reservation = main_source.index(
            "synchronized.add(str(template_root.resolve()).casefold())"
        )
        production_guard = main_source.index(
            "if _platform_template_sync_required(args):"
        )
        template_sync = main_source.index("engine_demo_root=ROOT")
        site_copy = main_source.index("copy_release_site(")
        optional_sync = main_source.index(
            "for consumer_root, assets_only in ("
        )

        # SDK-only and standalone rebuilds skip implicit Template reservation;
        # normal production builds still reserve before synchronizing it.
        self.assertLess(production_guard, template_reservation)
        self.assertLess(template_reservation, template_sync)
        self.assertLess(template_sync, site_copy)
        self.assertLess(site_copy, optional_sync)
        optional_slice = main_source[optional_sync:]
        self.assertLess(
            optional_slice.index("if identity in synchronized:"),
            optional_slice.index("receipt = sync_release_runtime_consumer("),
        )

    def test_assets_only_consumer_cli_is_explicit_and_dispatches_without_bootstrap(self):
        argv = [
            "bundle_engine.py", "--target", "platform",
            "--sync-consumer", "configured-page",
            "--sync-consumer-assets-only", "source-tests",
            "--sync-consumer-assets-only", "source-tests",
        ]
        with mock.patch("sys.argv", argv), mock.patch(
            "bundler.cli.resolve_bundle_configuration", side_effect=RuntimeError("parsed arguments"),
        ) as configure:
            with self.assertRaisesRegex(RuntimeError, "parsed arguments"):
                cli_module.main()
        args = configure.call_args.args[0]
        self.assertEqual(args.sync_consumer, ["configured-page"])
        self.assertEqual(args.sync_consumer_assets_only, ["source-tests", "source-tests"])

        # Execute the actual post-publication dispatch without recompiling a runtime.
        source = Path(cli_module.__file__).read_text(encoding="utf-8")
        main = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == "main")
        dispatch = next(node for node in main.body if isinstance(node, ast.If) and any(
            isinstance(child, ast.Attribute) and child.attr == "sync_consumer_assets_only"
            for child in ast.walk(node)
        ))
        sync = mock.Mock(return_value={"assets_only": True})
        release = Path("release")
        manifest = {"name": "particle-platform"}
        namespace = {
            "args": args, "Path": Path, "synchronized": set(),
            "release_dir": release, "manifest": manifest,
            "sync_release_runtime_consumer": sync, "_print_runtime_consumer_receipt": mock.Mock(),
        }
        exec(compile(ast.Module(body=[dispatch], type_ignores=[]), str(cli_module.__file__), "exec"), namespace)
        self.assertEqual(sync.call_args_list, [
            mock.call(Path("configured-page"), release, manifest, assets_only=False),
            mock.call(Path("source-tests"), release, manifest, assets_only=True),
        ])

    def test_release_site_digest_tracks_nested_playground_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bundler").mkdir()
            (root / "bundler" / "site.py").write_text("recipe = 1\n", encoding="utf-8")
            (root / "tests" / "playground" / "src" / "demos").mkdir(parents=True)
            morphfield = root / "tests" / "playground" / "src" / "demos" / "morphField.js"
            morphfield.write_text("export const id = 'morphfield-r2';\n", encoding="utf-8")

            before = _release_build_input_digest(root, include_site=True)
            morphfield.write_text("export const id = 'morphfield-r3';\n", encoding="utf-8")
            after = _release_build_input_digest(root, include_site=True)

            self.assertNotEqual(before, after)

    def test_runtime_only_digest_ignores_public_site_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bundler").mkdir()
            recipe = root / "bundler" / "site.py"
            recipe.write_text("recipe = 1\n", encoding="utf-8")

            before = _release_build_input_digest(root, include_site=False)
            (root / "tests" / "playground").mkdir(parents=True)
            (root / "tests" / "playground" / "index.html").write_text(
                "playground", encoding="utf-8"
            )
            after = _release_build_input_digest(root, include_site=False)

            self.assertEqual(before, after)

    def test_release_site_digest_tracks_morphfield_schema_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bundler").mkdir()
            (root / "bundler" / "site.py").write_text("recipe = 1\n", encoding="utf-8")
            schema_dir = root / "engine" / "render" / "morphfield" / "schemas"
            schema_dir.mkdir(parents=True)
            schema = schema_dir / "scene.schema.json"
            schema.write_text('{"revision":1}\n', encoding="utf-8")

            before = _release_build_input_digest(root, include_site=True)
            schema.write_text('{"revision":2}\n', encoding="utf-8")
            after = _release_build_input_digest(root, include_site=True)

            self.assertNotEqual(before, after)

    def test_release_site_digest_tracks_engine_demo_runtime_kit_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bundler").mkdir()
            (root / "bundler" / "site.py").write_text(
                "recipe = 1\n", encoding="utf-8"
            )
            manifest = (
                root
                / "Template"
                / "assets"
                / "engine-demo.runtime-kit.json"
            )
            manifest.parent.mkdir(parents=True)
            manifest.write_text('{"revision":1}\n', encoding="utf-8")

            before = _release_build_input_digest(root, include_site=True)
            manifest.write_text('{"revision":2}\n', encoding="utf-8")
            after = _release_build_input_digest(root, include_site=True)

            self.assertNotEqual(before, after)


class TestSdkConfigurationPreflight(unittest.TestCase):
    @staticmethod
    def _platform_runtime():
        return {
            "name": "particle-platform", "entries": list(_ENGINE_DEMO_PLATFORM_ENTRIES),
            "production": True, "eager": True, "release": False, "extreme": False,
            "include_editor": True, "include_agi": True, "include_plauna": True,
            "include_webgpu_os": True, "site_profile": "platform", "base_url_root": "webgpu-os/",
            "ns_ordered": False,
        }

    def _run_before_native(self, flags, *, runtime=None, epoch="1780272000"):
        """Execute real CLI preflight, stopping at its first native contract check."""
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
            root = Path(temporary)
            (root / "preserved.txt").write_bytes(b"previous release is untouched")
            if runtime is not None:
                (root / "sdk-build.json").write_text(json.dumps({"target": "platform"}), encoding="utf-8")
            original_files = {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}
            argv = ["bundle_engine.py", *flags]
            if "--sdk-rebuild" not in flags:
                argv.extend(["--outdir", str(root / "runtime")])
            stack.enter_context(mock.patch.object(cli_module, "ROOT", root))
            stack.enter_context(mock.patch("sys.argv", argv))
            stack.enter_context(mock.patch.dict(os.environ, {"SOURCE_DATE_EPOCH": epoch}))
            stack.enter_context(mock.patch.object(rebuild_module, "_verify_tools"))
            stack.enter_context(mock.patch.object(builder_module, "HAS_ESBUILD", False))
            stack.enter_context(mock.patch.object(cli_module, "HAS_ESBUILD", False))
            prepare = stack.enter_context(mock.patch.object(rebuild_module, "prepare_sdk_rebuild",
                return_value={"descriptor": {"runtime": runtime}}))
            native = stack.enter_context(mock.patch("bundler.compute_contracts.verify_compute_contracts",
                side_effect=ValueError("native contract gate reached")))
            compiler = stack.enter_context(mock.patch("bundler.wasm.build_compute_kernels"))
            docs = stack.enter_context(mock.patch("bundler.site._prepare_md_docs"))
            metrics = stack.enter_context(mock.patch.object(cli_module, "write_code_metrics"))
            output = stack.enter_context(mock.patch.object(cli_module, "_write_exact_bytes"))
            diagnostic = stack.enter_context(redirect_stdout(io.StringIO()))
            result = cli_module.main()
            compiler.assert_not_called()
            docs.assert_not_called()
            metrics.assert_not_called()
            output.assert_not_called()
            self.assertEqual({path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()},
                             original_files)
            self.assertEqual(set(root.iterdir()), {root / name for name in original_files})
            self.assertEqual(prepare.call_count, int(runtime is not None))
            return result, diagnostic.getvalue(), native.call_count

    def test_platform_sdk_rejects_nonproduction_custom_name_and_extra_entry_before_writes(self):
        cases = (
            [],
            ["--production", "--name", "custom-platform"],
            ["--production", "--entry", _ENGINE_DEMO_PLATFORM_ENTRIES[0], "engine/custom.js"],
        )
        for flags in cases:
            with self.subTest(flags=flags):
                result, diagnostic, native_calls = self._run_before_native(["--target", "platform", "--sdk-only", *flags])
                self.assertEqual(result, 2)
                self.assertIn("Platform SDK packaging requires", diagnostic)
                self.assertEqual(native_calls, 0)

    def test_platform_sdk_validates_replayed_configuration_before_native_and_output_work(self):
        changes = ({"production": False}, {"eager": False}, {"name": "custom-platform"},
                   {"entries": [*_ENGINE_DEMO_PLATFORM_ENTRIES, "engine/custom.js"]},
                   {"entries": list(_ENGINE_DEMO_PLATFORM_ENTRIES[:-1])})
        for change in changes:
            with self.subTest(change=change):
                runtime = self._platform_runtime()
                runtime.update(change)
                result, diagnostic, native_calls = self._run_before_native(["--sdk-rebuild"], runtime=runtime)
                self.assertEqual(result, 2)
                self.assertIn("Platform SDK packaging requires", diagnostic)
                self.assertEqual(native_calls, 0)

    def test_canonical_normal_and_rebuilt_platform_sdk_reach_native_preflight(self):
        for flags, runtime in ((["--target", "platform", "--sdk-only", "--production"], None),
                               (["--sdk-rebuild"], self._platform_runtime())):
            with self.subTest(rebuild=runtime is not None):
                result, diagnostic, native_calls = self._run_before_native(flags, runtime=runtime)
                self.assertEqual(result, 1)
                self.assertIn("native contract gate reached", diagnostic)
                self.assertEqual(native_calls, 1)

    def test_non_sdk_platform_and_custom_engine_sdk_configurations_remain_supported(self):
        for flags in (["--target", "platform", "--no-site", "--name", "custom-platform"],
                      ["--target", "engine", "--sdk-only", "--name", "custom-engine", "--entry",
                       "engine/EngineBootstrap.js", "engine/custom.js"]):
            with self.subTest(flags=flags):
                result, diagnostic, native_calls = self._run_before_native(flags)
                self.assertEqual(result, 1)
                self.assertIn("native contract gate reached", diagnostic)
                self.assertEqual(native_calls, 1)

    def test_invalid_sdk_epoch_is_rejected_before_native_docs_or_output_work(self):
        for epoch in ("not-an-epoch", "-1"):
            for flags in (["--target", "engine", "--sdk-only"],
                          ["--target", "platform", "--sdk-only", "--production"]):
                with self.subTest(epoch=epoch, target=flags[1]):
                    result, diagnostic, native_calls = self._run_before_native(flags, epoch=epoch)
                    self.assertEqual(result, 2)
                    self.assertIn("SOURCE_DATE_EPOCH", diagnostic)
                    self.assertEqual(native_calls, 0)
        result, diagnostic, native_calls = self._run_before_native(
            ["--target", "platform", "--no-site"], epoch="not-an-epoch")
        self.assertEqual(result, 1)
        self.assertIn("native contract gate reached", diagnostic)
        self.assertEqual(native_calls, 1)

    def test_sdk_manifest_date_ignores_elapsed_wall_clock_and_local_timezone(self):
        for current, zone in ((datetime(2030, 5, 4, 3, 2), "EST5EDT"),
                              (datetime(2099, 11, 10, 9, 8), "JST-9")):
            with self.subTest(current=current, zone=zone):
                class Clock(datetime):
                    @classmethod
                    def now(cls, tz=None):
                        return current

                with mock.patch.dict(os.environ, {"SOURCE_DATE_EPOCH": "1780272000", "TZ": zone}), \
                        mock.patch("datetime.datetime", Clock), \
                        mock.patch("time.localtime", side_effect=AssertionError("SDK dates must use UTC")):
                    self.assertEqual(cli_module._bundle_manifest_date(True), "2026-06-01 00:00")
                    self.assertEqual(cli_module._bundle_manifest_date(False), current.strftime("%Y-%m-%d %H:%M"))

    def test_sdk_manifest_date_uses_shared_deterministic_fallback_when_epoch_is_absent(self):
        with mock.patch.dict(os.environ, clear=True):
            expected = datetime(*_release_archive_datetime()).strftime("%Y-%m-%d %H:%M")
            self.assertEqual(expected, "1980-01-01 00:00")
            with mock.patch.object(cli_module, "_release_archive_datetime", wraps=_release_archive_datetime) as timestamp:
                self.assertEqual(cli_module._bundle_manifest_date(True), expected)
            timestamp.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
