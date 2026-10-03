# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Regression guards for exact-source, build-local canonical parse reuse."""
from pathlib import Path
from unittest.mock import patch

import pytest

from bundler.emitter import rewrite_module_canonical
from bundler.graph import ModuleGraph, rewrite_module
from bundler.parser import ParseError, parse_module


def test_walk_reorder_and_emit_share_successful_parse(tmp_path):
    source = "export const answer = 42;"
    graph = ModuleGraph(tmp_path)
    with patch("bundler.graph.parse_module", wraps=parse_module) as parser:
        graph.walk_source("engine/entry.js", source)
        graph.reorder_by_namespace()
        with patch("bundler.emitter.parse_module", side_effect=AssertionError("reparsed")):
            output = rewrite_module_canonical(source, tmp_path / "engine/entry.js", graph)
    assert parser.call_count == 1
    assert "__e.answer = answer;" in output


def test_changed_source_and_new_graph_do_not_reuse_old_parse(tmp_path):
    graph = ModuleGraph(tmp_path)
    graph.walk_source("engine/entry.js", "export const old = 1;")
    changed = "export const current = 2;"
    with patch("bundler.emitter.parse_module", wraps=parse_module) as parser:
        output = rewrite_module_canonical(changed, tmp_path / "engine/entry.js", graph)
        rewrite_module_canonical(changed, tmp_path / "engine/entry.js", ModuleGraph(tmp_path))
    assert parser.call_count == 2
    assert "__e.current = current;" in output
    assert "__e.old" not in output


def test_cached_statements_resolve_against_each_module_location(tmp_path):
    source = "export { value } from './dependency.js';"
    graph = ModuleGraph(tmp_path)
    for directory in ("engine/first", "engine/second"):
        folder = tmp_path / directory
        folder.mkdir(parents=True)
        (folder / "dependency.js").write_text("export const value = 1;", encoding="utf-8")
        graph.walk_source(directory + "/entry.js", source)
        output = rewrite_module_canonical(source, folder / "entry.js", graph)
        assert f"__r('{directory}/dependency.js').value" in output


def test_failed_discovery_parse_still_blocks_canonical_emission(tmp_path):
    graph = ModuleGraph(tmp_path)
    source = "export const { broken = 1;"
    graph._extract_import_paths(source)
    assert source not in graph._parsed_modules
    with pytest.raises(ParseError, match="canonical rewrite failed"):
        rewrite_module(source, Path(tmp_path) / "engine/broken.js", graph)
