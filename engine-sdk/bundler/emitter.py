# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""bundler.emitter — canonical emitter for ES module import/export statements.

This is the second half of Phase 6 "Parsers and canonical emitters". It takes
a parsed module (imports/exports with source positions) and produces a
transformed source that uses the bundler's internal `__r` and `__e` helpers.

It preserves the original non-import/export source text exactly by replacing
only the located statement ranges. It is a drop-in replacement for the
regex-based rewrite in ``bundler.graph.rewrite_module``.
"""

import json
import re
from typing import List, Tuple, Optional

from .parser import (
    parse_module,
    ParseError,
    Import,
    Export,
    find_default_export_declaration,
)


_RUNTIME_MODULE_BASES = (
    ("engine/", "engine", "__PE_ENGINE_BASE__", "/engine/"),
    ("editor/", "editor", "__PE_EDITOR_BASE__", "/editor/"),
    ("plauna/", "plauna", "__PE_PLAUNA_BASE__", "/plauna/"),
    ("agi/", "agi", "__PE_AGI_BASE__", "/agi/"),
)


_REGEX_PRECEDING_KEYWORDS = frozenset({
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "do", "else", "case", "yield", "await", "throw",
})


def _quoted_literal_end(source: str, start: int) -> int:
    """Return the first index after a quoted JavaScript string literal."""
    quote = source[start]
    index = start + 1
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue
        index += 1
        if char == quote:
            return index
    return len(source)


def _regex_literal_end(source: str, start: int) -> Optional[int]:
    """Return the end of a regex literal, or ``None`` when ``/`` is division."""
    previous_index = start - 1
    while previous_index >= 0 and source[previous_index] in " \t\r\n":
        previous_index -= 1
    previous = source[previous_index] if previous_index >= 0 else ""

    if previous and (previous.isalnum() or previous in "_$"):
        word_start = previous_index
        while word_start >= 0 and (source[word_start].isalnum() or source[word_start] in "_$"):
            word_start -= 1
        if source[word_start + 1:previous_index + 1] not in _REGEX_PRECEDING_KEYWORDS:
            return None
    elif previous and previous not in "(,=:[!&|?;{}[>":
        return None

    index = start + 1
    in_character_class = False
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char in "\r\n":
            return None
        if char == "[":
            in_character_class = True
        elif char == "]":
            in_character_class = False
        elif char == "/" and not in_character_class:
            index += 1
            while index < len(source) and source[index].isalpha():
                index += 1
            return index
        index += 1
    return None


def _import_meta_expressions(filepath, graph, os_base_prefix=None):
    """Return classic-script replacements for one module's ``import.meta``."""
    module_id = graph.mod_id(filepath)
    if os_base_prefix and module_id.startswith(os_base_prefix):
        relative_path = module_id[len(os_base_prefix):]
        runtime_base = "(globalThis.__PE_OS_BASE__||document.baseURI||'')"
        url_expression = f"(new URL({json.dumps(relative_path)},{runtime_base}).href)"
    else:
        url_expression = None
        for prefix, base_key, legacy_global, default_path in _RUNTIME_MODULE_BASES:
            if not module_id.startswith(prefix):
                continue
            relative_path = module_id[len(prefix):]
            configured_bases = "(globalThis.__PE_RUNTIME_BASES__||{})"
            runtime_base = (
                f"(globalThis.{legacy_global}||{configured_bases}[{json.dumps(base_key)}]||"
                f"new URL({json.dumps(default_path)},document.baseURI).href)"
            )
            url_expression = f"(new URL({json.dumps(relative_path)},{runtime_base}).href)"
            break
        if url_expression is None:
            url_expression = "(document.currentScript&&document.currentScript.src||document.baseURI||'')"
    return url_expression, f"({{url:{url_expression}}})"


def _transform_import_meta(source: str, url_expression=None, meta_expression=None):
    """Rewrite executable ``import.meta`` while preserving literal text.

    JavaScript strings, comments, regular expressions, and raw template text are
    copied byte-for-byte. Template interpolations are scanned recursively because
    they contain executable JavaScript and may legitimately use ``import.meta``.
    Returns the transformed source and the original offsets that were matched.
    """
    # The scanner recognizes this exact lexeme. Modules without a candidate
    # cannot need rewriting, so preserve them without allocating per character.
    if "import.meta" not in source:
        return source, []
    matches = []
    source_length = len(source)

    def transform_code(start: int, stop_at_template_brace=False):
        output = []
        index = start
        brace_depth = 0

        while index < source_length:
            char = source[index]

            if stop_at_template_brace and char == "}" and brace_depth == 0:
                return "".join(output), index

            if char in "'\"":
                end = _quoted_literal_end(source, index)
                output.append(source[index:end])
                index = end
                continue

            if char == "`":
                rendered, index = transform_template(index)
                output.append(rendered)
                continue

            if char == "/" and index + 1 < source_length:
                following = source[index + 1]
                if following == "/":
                    end = source.find("\n", index + 2)
                    end = source_length if end < 0 else end
                    output.append(source[index:end])
                    index = end
                    continue
                if following == "*":
                    close = source.find("*/", index + 2)
                    end = source_length if close < 0 else close + 2
                    output.append(source[index:end])
                    index = end
                    continue
                regex_end = _regex_literal_end(source, index)
                if regex_end is not None:
                    output.append(source[index:regex_end])
                    index = regex_end
                    continue

            is_identifier_prefix = index > 0 and (source[index - 1].isalnum() or source[index - 1] in "_$")
            previous_index = index - 1
            while previous_index >= 0 and source[previous_index] in " \t\r\n":
                previous_index -= 1
            is_property_access = previous_index >= 0 and source[previous_index] == "."

            if not is_identifier_prefix and not is_property_access and source.startswith("import.meta", index):
                meta_end = index + len("import.meta")
                if meta_end == source_length or not (source[meta_end].isalnum() or source[meta_end] in "_$"):
                    url_end = meta_end + len(".url")
                    if source.startswith(".url", meta_end) and (
                        url_end == source_length or not (source[url_end].isalnum() or source[url_end] in "_$")
                    ):
                        matches.append(index)
                        output.append(url_expression if url_expression is not None else source[index:url_end])
                        index = url_end
                        continue
                    matches.append(index)
                    output.append(meta_expression if meta_expression is not None else source[index:meta_end])
                    index = meta_end
                    continue

            if stop_at_template_brace:
                if char == "{":
                    brace_depth += 1
                elif char == "}":
                    brace_depth -= 1

            output.append(char)
            index += 1

        return "".join(output), index

    def transform_template(start: int):
        output = ["`"]
        index = start + 1
        while index < source_length:
            char = source[index]
            if char == "\\":
                end = min(index + 2, source_length)
                output.append(source[index:end])
                index = end
                continue
            if char == "`":
                output.append(char)
                return "".join(output), index + 1
            if char == "$" and index + 1 < source_length and source[index + 1] == "{":
                output.append("${")
                expression, close = transform_code(index + 2, stop_at_template_brace=True)
                output.append(expression)
                if close < source_length and source[close] == "}":
                    output.append("}")
                    index = close + 1
                    continue
                return "".join(output), close
            output.append(char)
            index += 1
        return "".join(output), index

    transformed, _ = transform_code(0)
    return transformed, matches


def rewrite_import_meta(source, filepath, graph, os_base_prefix=None):
    """Rewrite module-only ``import.meta`` expressions for a classic bundle."""
    url_expression, meta_expression = _import_meta_expressions(
        filepath, graph, os_base_prefix=os_base_prefix
    )
    transformed, _ = _transform_import_meta(source, url_expression, meta_expression)
    return transformed


def find_executable_import_meta(source):
    """Return offsets of ``import.meta`` expressions parsed as executable code."""
    _, matches = _transform_import_meta(source)
    return matches


def assert_classic_script_compatible(source, label="bundle"):
    """Reject a classic-script bundle containing module-only syntax."""
    matches = find_executable_import_meta(source)
    if not matches:
        return
    locations = []
    for offset in matches[:8]:
        line = source.count("\n", 0, offset) + 1
        line_start = source.rfind("\n", 0, offset) + 1
        locations.append(f"{line}:{offset - line_start + 1}")
    suffix = "" if len(matches) <= len(locations) else f" (+{len(matches) - len(locations)} more)"
    raise ParseError(
        f"{label} contains {len(matches)} executable import.meta expression(s) at "
        f"{', '.join(locations)}{suffix}"
    )


def resolve_import_path(filepath, import_path, graph, os_base_prefix=None):
    """Resolve an import specifier against the current module's file."""
    return graph.resolve_import(filepath, import_path)


def mod_id(graph, resolved):
    """Return the module id for a resolved path, or the path itself."""
    return graph.mod_id(resolved)


def _escape_identifier(name: str) -> str:
    """Return a safe JS identifier string for the given name."""
    # Basic sanitization: allow only JS identifier characters.
    if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name):
        return name
    return re.sub(r"[^A-Za-z0-9_$]", "_", name)


def _require_declaration_identifier(name: str, filepath: str) -> str:
    """Reject parser output that cannot form a declaration export assignment."""
    if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name):
        return name
    raise ParseError(f"invalid exported declaration binding {name!r} in {filepath}")


def _emit_import(imp: Import, filepath, graph, os_base_prefix) -> Optional[str]:
    """Convert a parsed Import to a __r call or similar."""
    resolved = resolve_import_path(filepath, imp.spec, graph, os_base_prefix)
    if not resolved:
        return None
    mid = mod_id(graph, resolved)
    if imp.is_dynamic:
        return f"Promise.resolve(__r('{mid}'))"

    parts = []
    if imp.default:
        parts.append(f"const {imp.default} = (__r('{mid}').__default || __r('{mid}'));")
    if imp.named:
        names = ", ".join(imp.named)
        parts.append(f"const {{ {names} }} = __r('{mid}');")
    if imp.namespace:
        parts.append(f"const {imp.namespace} = __r('{mid}');")
    if not parts:
        # Side-effect import
        parts.append(f"__r('{mid}');")
    return " ".join(parts)


def _emit_export(exp: Export, filepath, graph, os_base_prefix) -> Optional[str]:
    """Convert a parsed Export to __e assignments or re-exports."""
    if exp.reexport and exp.spec:
        resolved = resolve_import_path(filepath, exp.spec, graph, os_base_prefix)
        if not resolved:
            return None
        mid = mod_id(graph, resolved)
        if exp.namespace:
            return f";__e.{_escape_identifier(exp.namespace)} = __r('{mid}');"
        if exp.named:
            parts = []
            for binding in exp.named:
                if " as " in binding:
                    original, alias = binding.split(" as ", 1)
                else:
                    original = alias = binding
                # Internal module defaults use __default. A default forwarded
                # by a barrel must remain consumable by ordinary default imports.
                target = '__default' if alias == 'default' else _escape_identifier(alias)
                member = '__default' if original == 'default' else _escape_identifier(original)
                parts.append(f"__e.{target} = __r('{mid}').{member};")
            return ";" + " ".join(parts)
        return f";Object.assign(__e, __r('{mid}'));"
    if exp.default:
        return "__e.__default = "
    if exp.declaration:
        # Export declarations are split into a declaration and an assignment.
        # The caller handles the declaration name assignment separately.
        return ""
    if exp.named:
        parts = []
        for binding in exp.named:
            if " as " in binding:
                original, alias = binding.split(" as ", 1)
            else:
                original = alias = binding
            target = '__default' if alias == 'default' else _escape_identifier(alias)
            parts.append(f"__e.{target} = {_escape_identifier(original)};")
        # A named export may directly follow `export default class` or
        # `export default function`. Those declarations become assignment
        # expressions in the classic bundle and therefore require an explicit
        # statement boundary when later whitespace-minification removes ASI.
        return ";" + " ".join(parts)
    return None


def rewrite_module_canonical(source, filepath, graph, os_base_prefix=None):
    """Rewrite a module's imports/exports to use __r/__e with canonical emission."""
    # Graph traversal already parsed this exact source. Reuse only successful
    # build-local results; custom graphs and changed sources still parse normally.
    parsed = getattr(graph, "_parsed_modules", {}).get(source)
    imports, exports = parsed if parsed is not None else parse_module(source)

    # Build replacement ranges from parsed statements.
    ranges: List[Tuple[int, int, str, bool]] = []  # (start, end, text, is_prefix)
    for imp in imports:
        emitted = _emit_import(imp, filepath, graph, os_base_prefix)
        if emitted is not None:
            ranges.append((imp.start, imp.end, emitted, False))

    declaration_names = []
    default_declaration_names = []
    for exp in exports:
        if exp.default:
            prefix_len = len("export default ")
            expression_start = exp.start + prefix_len
            declaration = find_default_export_declaration(source, expression_start)
            declaration_end, declaration_name = declaration or (None, None)
            if declaration_name:
                # Keep named class/function declarations as declarations so
                # their source-level module binding remains available to later
                # code. Export the binding with the other end-of-module
                # assignments.
                ranges.append((exp.start, expression_start, "", True))
                default_declaration_names.append(declaration_name)
            else:
                ranges.append((exp.start, expression_start, "__e.__default = ", True))
            if declaration_end is not None:
                # A module declaration becomes an assignment expression after
                # the prefix rewrite when anonymous. Named declarations also
                # get a deterministic boundary. Never depend on a source
                # newline for ASI: whitespace minifiers may otherwise emit
                # `} function`, which is invalid classic-script syntax.
                ranges.append((declaration_end, declaration_end, ";", False))
            continue
        emitted = _emit_export(exp, filepath, graph, os_base_prefix)
        if exp.declaration and exp.named:
            declaration_names.extend(
                _require_declaration_identifier(name, filepath) for name in exp.named
            )
            # Keep the declaration intact; only remove the `export` keyword.
            ranges.append((exp.start, exp.start + len("export"), "", True))
            continue
        if emitted is not None:
            ranges.append((exp.start, exp.end, emitted, False))

    # Append export assignments for exported declarations
    assignments = [f"__e.{n} = {n};" for n in declaration_names]
    assignments.extend(f"__e.__default = {n};" for n in default_declaration_names)
    if assignments:
        append = "\n;" + " ".join(assignments)
    else:
        append = ""

    # Sort ranges by start and apply, ensuring no overlaps.
    ranges.sort(key=lambda x: x[0])
    out = []
    last = 0
    for start, end, text, is_prefix in ranges:
        if start < last:
            raise ParseError(f"overlapping canonical rewrite ranges at byte {start}")
        out.append(source[last:start])
        out.append(text)
        if is_prefix:
            last = end
        else:
            last = end
    out.append(source[last:])
    rewritten = "".join(out) + append
    return rewrite_import_meta(rewritten, filepath, graph, os_base_prefix=os_base_prefix)
