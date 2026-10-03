# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Run bounded, shipped SDK unittest cases and retain every actual outcome."""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import time
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT / "engine-sdk"
# These classes create their own temporary fixtures and do not require the
# development repository's OS HTML, native installer, Rust compiler or GPU.
# Browser-dependent console/compute cases have a separate browser CI job.
SELECTORS = (
    "bundler.tests.test_parser.TestParser",
    "bundler.tests.test_parser_registry.TestCanonicalModuleRegistry",
    "bundler.tests.test_emitter.TestEmitter",
    "bundler.tests.test_builder_module_access.TestBuilderModuleAccess",
    "bundler.tests.test_in_memory_generated_entry.TestInMemoryGeneratedEntry",
    "bundler.tests.test_console_stripping.ConsoleStrippingTests.test_literals_comments_and_other_objects_are_preserved",
    *("bundler.tests.test_runtime_transport.TestRuntimeTransport." + name for name in (
        "test_deterministic_parts_reassemble_exact_original_gzip",
        "test_small_artifact_and_full_local_consumer_remain_supported",
        "test_transport_metadata_rejects_malformed_shapes_paths_bounds_and_order",
        "test_tampered_truncated_missing_and_relabelled_parts_fail_closed",
        "test_public_copy_and_archive_preserve_gzip_and_best_transport",
        "test_loader_urls_and_cache_identity_bind_transport_metadata",
    )),
    *("bundler.tests.test_site_archive.TestReleaseSiteArchive." + name for name in (
        "test_cache_busting_preserves_attested_physics_bytes",
        "test_compute_consumer_inventory_includes_offline_contracts",
        "test_static_site_rejects_files_above_host_cap",
        "test_static_site_rejects_too_many_files_for_free_pages",
        "test_release_site_includes_static_404_page",
        "test_public_include_tree_parity_recurses_into_academy_starter",
        "test_docs_laydown_ships_curated_sources_indexes_and_root_discovery",
        "test_staged_site_publish_replaces_live_site_and_removes_previous",
        "test_staged_site_publish_restores_previous_site_when_swap_fails",
        "test_staged_site_publish_syncs_file_atomically_when_live_directory_is_locked",
        "test_server_uses_previous_then_staged_site_during_publication_gap",
        "test_server_transition_fallback_rejects_parent_traversal",
        "test_archive_contains_every_publish_file_at_root_with_exact_bytes",
        "test_archive_fails_when_a_required_asset_is_absent",
    )),
    *("bundler.tests.test_compute_wasm.TestComputeWasm." + name for name in (
        "test_cache_verifies_without_invoking_compiler",
        "test_source_changes_fail_readonly_check",
        "test_corrupted_binary_and_manifest_path_fail_closed",
        "test_binary_metadata_controls_features_and_imports",
        "test_sidecar_closure_is_portable_and_source_free",
        "test_binary_edit_invalidates_runtime_cache_even_without_site",
        "test_consumer_compute_inventory_requires_verified_complete_closure",
        "test_compiled_provider_urls_keep_engine_release_base",
    )),
    "sdk.tests.test_server.SDKServerTests",
    "bundler.tests.test_graph_root_paths.GraphRootPathTests",
    "bundler.tests.test_sdk_directory_publication.DirectoryPublicationTests",
    "sdk.tests.test_doc_snippets.SDKDocumentationSnippetTests",
    "sdk.tests.test_rebuild_acceptance.RebuildAcceptanceTests",
    *("sdk.tests.test_rebuild_network.SDKOfflineNetworkTests." + name for name in (
        "test_child_python_inherits_guard_and_runs_local_code",
        "test_concurrent_thread_does_not_inherit_socketpair_permission",
        "test_connections_are_rejected_before_the_operating_system_call",
        "test_dns_udp_and_saved_socket_calls_are_blocked",
        "test_native_tool_and_shell_spawns_are_blocked",
        "test_real_asyncio_self_pipe_runs_and_closes",
        "test_real_tcp_socketpair_exchanges_bytes_and_restores_scope",
        "test_socketpair_failure_restores_permission",
        "test_spawned_process_pool_blocks_network_and_preserves_compression",
    )),
    *("bundler.tests.test_sdk_rebuild.SDKRebuildTests." + name for name in (
        "test_missing_editable_source_is_rejected",
        "test_tampered_tool_and_native_binary_are_rejected_before_compute_checks",
        "test_selected_compression_tool_version_mismatch_fails",
        "test_descriptor_records_actual_python_and_native_compression_environment",
        "test_different_python_patch_version_is_rejected_before_native_checks",
        "test_missing_or_changed_native_compression_environment_is_rejected",
        "test_requirements_and_tools_cover_transitive_schema_and_crypto_dependencies",
        "test_existing_audited_compute_artifacts_rebuild_without_compiler_invocation",
        "test_changed_kernel_source_rejects_stale_native_artifacts",
        "test_input_path_escape_and_duplicate_json_keys_are_rejected",
        "test_input_mutation_between_copy_and_descriptor_is_rejected",
        "test_engine_sdk_rejects_explicit_signed_registry",
    )),
)


class RecordedResult(unittest.TextTestResult):
    """Record unittest's actual callbacks, including subtest/fixture failures."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = {}
        self.started = {}

    def entry(self, test):
        return self.records.setdefault(test.id(), {"name": test.id(), "status": "RUNNING",
                                                  "duration_seconds": 0.0})

    def startTest(self, test):
        self.started[test.id()] = time.perf_counter()
        self.entry(test)
        super().startTest(test)

    def stopTest(self, test):
        self.entry(test)["duration_seconds"] = round(time.perf_counter() - self.started[test.id()], 6)
        super().stopTest(test)

    def addSuccess(self, test):
        self.entry(test)["status"] = "PASS"
        super().addSuccess(test)

    def addFailure(self, test, err):
        self.entry(test).update(status="FAIL", detail=self._exc_info_to_string(err, test))
        super().addFailure(test, err)

    def addError(self, test, err):
        self.entry(test).update(status="ERROR", detail=self._exc_info_to_string(err, test))
        super().addError(test, err)

    def addSkip(self, test, reason):
        self.entry(test).update(status="SKIP", detail=str(reason))
        super().addSkip(test, reason)

    def addExpectedFailure(self, test, err):
        self.entry(test).update(status="XFAIL", detail=self._exc_info_to_string(err, test))
        super().addExpectedFailure(test, err)

    def addUnexpectedSuccess(self, test):
        self.entry(test).update(status="FAIL", detail="Unexpected success of an expected-failure test")
        super().addUnexpectedSuccess(test)

    def addSubTest(self, test, subtest, err):
        if err is not None:
            record = self.entry(test)
            status = "FAIL" if issubclass(err[0], test.failureException) else "ERROR"
            if record["status"] != "ERROR":
                record["status"] = status
            record.setdefault("subtests", []).append({"name": subtest.id(), "status": status,
                                                      "detail": self._exc_info_to_string(err, test)})
        super().addSubTest(test, subtest, err)


def write_reports(report, output):
    """Emit JSON, JUnit and a readable summary without changing SDK files."""
    output = Path(output).resolve()
    if output.is_relative_to(SDK):
        raise ValueError("Test reports must remain outside the immutable engine-sdk tree")
    output.parent.mkdir(parents=True, exist_ok=True)
    junit = output.with_suffix(".xml")
    counts = report["counts"]
    suite = ET.Element("testsuite", name="Shipped SDK Python tests", tests=str(len(report["tests"])),
                       failures=str(counts["failures"]), errors=str(counts["errors"]),
                       skipped=str(counts["skipped"] + counts["expectedFailures"]),
                       time=str(report["duration_seconds"]))
    for test in report["tests"]:
        classname, _, name = test["name"].rpartition(".")
        case = ET.SubElement(suite, "testcase", classname=classname, name=name,
                             time=str(test["duration_seconds"]))
        if test["status"] in {"FAIL", "ERROR", "RUNNING"}:
            tag = "failure" if test["status"] == "FAIL" else "error"
            details = test.get("detail", "\n".join(item["detail"] for item in test.get("subtests", [])))
            ET.SubElement(case, tag, message=test["status"]).text = details or "Test did not complete"
        elif test["status"] in {"SKIP", "XFAIL"}:
            ET.SubElement(case, "skipped", message=test["status"]).text = test.get("detail", "")
    ET.ElementTree(suite).write(junit, encoding="utf-8", xml_declaration=True)
    report["junit"] = junit.relative_to(ROOT).as_posix() if junit.is_relative_to(ROOT) else str(junit)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    lines = ["## Shipped SDK Python tests", "",
             f"**{report['status']}**: {counts['run']} run, {counts['passed']} passed, "
             f"{counts['failures']} failed, {counts['errors']} errors, {counts['skipped']} skipped, "
             f"{counts['expectedFailures']} expected failures.", "",
             "These are the selected shipped suites and CI guard tests; hardware browser acceptance is a separate job.", "",
             "| Test | Result |", "| --- | --- |"]
    lines.extend(f"| `{test['name'].replace('|', '&#124;')}` | {test['status']} |" for test in report["tests"])
    for test in report["tests"]:
        if test.get("detail") or test.get("subtests"):
            lines.extend(["", f"### {test['name']}", "", "```text",
                          test.get("detail", "\n".join(item["detail"] for item in test.get("subtests", []))).replace("```", "'''"), "```"])
    markdown = "\n".join(lines) + "\n"
    output.with_suffix(".md").write_text(markdown, encoding="utf-8")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a", encoding="utf-8") as destination:
            destination.write(markdown)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/python.json")
    args = parser.parse_args(argv)
    if args.output.resolve().is_relative_to(SDK):
        parser.error("--output must be outside engine-sdk/")
    sys.path.insert(0, str(SDK))
    started = time.perf_counter()
    loader = unittest.TestLoader()
    selected = unittest.TestSuite()
    sources = {}
    ci_sources = {}
    for selector in SELECTORS:
        module_name = ".".join(selector.split(".")[:3])
        # The unittest loader represents import/missing-test errors as actual
        # failing cases so JSON and JUnit retain them instead of losing a job.
        loaded = loader.loadTestsFromName(selector)
        module = sys.modules.get(module_name)
        if module is not None:
            path = Path(module.__file__).resolve()
            if not path.is_relative_to(SDK):
                raise ValueError(f"Selected test module escaped the shipped SDK: {module_name}")
            sources[path.relative_to(SDK).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
        selected.addTests(loaded)
    ci_modules = []
    for directory in (ROOT / "ci", ROOT / "ci/tests"):
        sys.path.insert(0, str(directory))
        for path in sorted(directory.glob("test_*.py")):
            ci_modules.append(path.stem)
            ci_sources[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
            selected.addTests(loader.loadTestsFromName(path.stem))
    expected = selected.countTestCases()
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordedResult).run(selected)
    tests = list(result.records.values())
    statuses = Counter(test["status"] for test in tests)
    status = "FAIL" if not result.wasSuccessful() or statuses["RUNNING"] or not expected else "PASS" if statuses["PASS"] else "SKIP"
    report = {"format": "particle-python-tests/v1", "status": status,
              "duration_seconds": round(time.perf_counter() - started, 6),
              "elapsedSeconds": round(time.perf_counter() - started, 6), "testsRun": result.testsRun,
              "python": sys.version.split()[0], "selected": list(SELECTORS) + ci_modules,
              "suite_sources_sha256": sources, "ci_sources_sha256": ci_sources,
              "discoveryErrors": list(loader.errors),
              "testNames": [test["name"] for test in tests], "tests": tests,
              "counts": {"expected": expected, "run": result.testsRun, "passed": statuses["PASS"],
                         "failures": statuses["FAIL"], "errors": statuses["ERROR"] + statuses["RUNNING"],
                         "skipped": statuses["SKIP"], "expectedFailures": statuses["XFAIL"]}}
    write_reports(report, args.output)
    print(json.dumps({key: report[key] for key in ("status", "counts", "duration_seconds", "junit")}))
    return 1 if status != "PASS" else 0


if __name__ == "__main__":
    raise SystemExit(main())
