# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.graph — ES module dependency graph + import/export rewriter."""

import re
from pathlib import Path
from collections import OrderedDict
from .transform import is_shader_file, preprocess_shader_source
from .scan_import_paths import scan_import_paths
from .parser import parse_module, ParseError
from . import emitter


# ---- Regex ------------------------------------------------------------------

# import { a, b } from './path.js';   (may span multiple lines)
RE_NAMED_IMPORT = re.compile(
    r"""import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?""",
    re.DOTALL
)
# import * as X from './path.js';
RE_STAR_IMPORT = re.compile(
    r"""import\s*\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"];?"""
)
# import X, { A, B } from './path.js';   (mixed default + named — must be before RE_DEFAULT_IMPORT)
RE_MIXED_IMPORT = re.compile(
    r"""import\s+(\w+)\s*,\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?""",
    re.DOTALL
)
# import X from './path.js';   (default import)
RE_DEFAULT_IMPORT = re.compile(
    r"""import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?"""
)
# import './path.js';   (side-effect)
RE_SIDE_EFFECT_IMPORT = re.compile(
    r"""import\s+['"]([^'"]+)['"];?"""
)
# Dynamic import:  import('./path.js')  — does NOT consume leading 'await'
# so `await import(...)` becomes `await Promise.resolve(__r(...))` which resolves correctly
RE_DYNAMIC_IMPORT = re.compile(
    r"""import\(\s*['"]([^'"]+)['"]\s*\)"""
)

# export { a, b } from './path.js';   (re-export)
RE_REEXPORT_NAMED = re.compile(
    r"""export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?""",
    re.DOTALL
)
# export * from './path.js';
RE_REEXPORT_STAR = re.compile(
    r"""export\s*\*\s+from\s*['"]([^'"]+)['"];?"""
)
# export * as Namespace from './path.js';
RE_REEXPORT_NAMESPACE = re.compile(
    r"""export\s*\*\s+as\s+(\w+)\s+from\s*['"]([^'"]+)['"];?"""
)

# export default X
RE_EXPORT_DEFAULT = re.compile(r"""^\s*export\s+default\s+""", re.MULTILINE)
# export class / function / const / let / var / async function
RE_EXPORT_DECL = re.compile(
    r"""^\s*export\s+(async\s+function|function|class|const|let|var)\s+(\w+)""",
    re.MULTILINE
)
# Plain export { a, b };
RE_EXPORT_LIST = re.compile(
    r"""^\s*export\s*\{([^}]+)\};?\s*$""",
    re.MULTILINE
)
# export const { a, b, c } = Source;  (destructuring export)
RE_EXPORT_DESTRUCTURE = re.compile(
    r"""^\s*export\s+(const|let|var)\s*\{([^}]+)\}\s*=\s*([^;]+);""",
    re.MULTILINE | re.DOTALL
)

# Comments
RE_BLOCK_COMMENT = re.compile(r'/\*[\s\S]*?\*/')
RE_LINE_COMMENT = re.compile(r'(?<=[^:"\'])//[^\n]*|^//[^\n]*', re.MULTILINE)
RE_BLANK_LINES = re.compile(r'\n\s*\n\s*\n')
# ---- Dependency Graph -------------------------------------------------------

def _is_external_import(import_path):
    """Return True for runtime/external URLs that are not part of the bundle graph."""
    if not import_path:
        return True
    # Bare specifiers (e.g. 'three') are resolved at runtime via import map.
    if not import_path.startswith('.') and not import_path.startswith('/'):
        return True
    # Explicit URL schemes are fetched by the browser, not bundled.
    if re.match(r'^[a-z][a-z0-9+.-]*:', import_path, re.IGNORECASE):
        return True
    return False


class ModuleGraph:
    def __init__(self, root_dir, skip_patterns=None, cyclic_baseline=None):
        self.root = Path(root_dir)
        self.skip = skip_patterns or []
        self.modules = OrderedDict()   # abs_path -> source
        self.raw_modules = OrderedDict()  # source before shader preprocessing
        self.order = []                # topological order
        self.visited = set()
        self.visiting = set()
        self.visiting_stack = []       # ordered DFS path for cycle reporting
        self.errors = []
        self.cycles = []               # list of [abs_path, ...] cycles
        # cyclic_baseline=None disables cycle enforcement; [] enforces an empty baseline.
        self.enforce_cyclic_baseline = cyclic_baseline is not None
        self.cyclic_baseline = set()   # set of frozenset(module_id, ...)
        if cyclic_baseline:
            for cycle in cyclic_baseline:
                ids = tuple(cycle) if isinstance(cycle, (list, tuple)) else (cycle,)
                self.cyclic_baseline.add(frozenset(ids))
        self.stats = {"files": 0, "total_bytes": 0, "skipped": 0}
        self._path_to_id = {}         # abs_path -> module_id
        self._resolve_cache = {}      # (from_file, import_path) -> abs_path or None
        self._parsed_modules = {}    # exact source -> canonical imports/exports; build-local
        self._root_str = str(self.root)

    def mod_id(self, abs_path):
        if abs_path not in self._path_to_id:
            rel = Path(abs_path).relative_to(self.root)
            self._path_to_id[abs_path] = str(rel).replace("\\", "/")
        return self._path_to_id[abs_path]

    def _is_cyclic_baseline(self, cycle):
        if not self.enforce_cyclic_baseline:
            return True
        ids = frozenset(self.mod_id(p) for p in cycle)
        return ids in self.cyclic_baseline

    def should_skip(self, path):
        rel = str(path.relative_to(self.root)).replace("\\", "/")
        return any(pat in rel for pat in self.skip)

    def resolve_import(self, from_file, import_path):
        key = (str(from_file), import_path)
        if key in self._resolve_cache:
            return self._resolve_cache[key]

        result = None
        if import_path.startswith("."):
            base_dir = Path(from_file).parent
            resolved = (base_dir / import_path).resolve()
            if resolved.is_file():
                result = str(resolved)
            elif not resolved.suffix and resolved.with_suffix(".js").is_file():
                result = str(resolved.with_suffix(".js"))
            elif resolved.is_dir() and (resolved / "index.js").is_file():
                result = str((resolved / "index.js"))
        elif import_path.startswith("/"):
            # Browser-root imports keep stable host modules outside a
            # release-qualified URL at runtime. Resolve the same specifier
            # against the repository root while bundling so the monolithic
            # development/release bundle still contains its dependency.
            resolved = (self.root / import_path.lstrip("/")).resolve()
            try:
                resolved.relative_to(self.root.resolve())
            except ValueError:
                resolved = None
            if resolved is not None:
                if resolved.is_file():
                    result = str(resolved)
                elif not resolved.suffix and resolved.with_suffix(".js").is_file():
                    result = str(resolved.with_suffix(".js"))
                elif resolved.is_dir() and (resolved / "index.js").is_file():
                    result = str((resolved / "index.js"))

        self._resolve_cache[key] = result
        return result

    def walk(self, entry_file):
        entry = (self.root / entry_file).resolve()
        if not entry.is_file():
            self.errors.append(f"Entry not found: {entry}")
            return
        self._visit(str(entry))

    def walk_source(self, entry_file, source):
        """Walk an in-memory entry using its stable root-relative module path.

        Generated entry modules must not rely on a shared temporary source file:
        concurrent bundler processes can otherwise delete or replace that file
        between generation and graph traversal. Relative imports still resolve
        from the supplied logical path and therefore retain their normal module
        IDs in the finished bundle.
        """
        entry = (self.root / entry_file).resolve()
        try:
            entry.relative_to(self.root.resolve())
        except ValueError:
            self.errors.append(f"In-memory entry escapes bundle root: {entry}")
            return
        if not isinstance(source, str):
            self.errors.append(f"In-memory entry source must be text: {entry}")
            return
        self._visit(str(entry), source_override=source)

    def _extract_import_paths(self, source):
        try:
            parsed = self._parsed_modules.get(source)
            if parsed is None:
                parsed = parse_module(source)
                self._parsed_modules[source] = parsed
            imports, exports = parsed
            paths = {imp.spec for imp in imports if imp.spec}
            paths |= {exp.spec for exp in exports if exp.reexport and exp.spec}
            return paths
        except ParseError:
            return scan_import_paths(source)

    def _visit(self, fp_str, source_override=None):
        if fp_str in self.visited:
            return
        if fp_str in self.visiting:
            # A back edge means a circular dependency. Capture the cycle from the
            # current DFS stack so it can be baselined or reported.
            try:
                idx = self.visiting_stack.index(fp_str)
                cycle = self.visiting_stack[idx:] + [fp_str]
            except ValueError:
                cycle = [fp_str]
            self.cycles.append(cycle)
            if not self._is_cyclic_baseline(cycle):
                self.errors.append(f"Cyclic module dependency: {' -> '.join(self.mod_id(p) for p in cycle)}")
            return

        fp = Path(fp_str)
        if self.should_skip(fp):
            self.stats["skipped"] += 1
            return

        self.visiting.add(fp_str)
        self.visiting_stack.append(fp_str)
        try:
            if source_override is None:
                with open(fp_str, 'r', encoding='utf-8', errors='replace') as fh:
                    source = fh.read()
            else:
                source = source_override
            self.raw_modules[fp_str] = source
            # WGSL comment stripping only applies to shader files. Running it on
            # every file is wasteful and risky: its template scanner can desync
            # on ordinary JS (quotes inside regex literals like /"/g, apostrophes
            # in comments) and corrupt real code. Gate it to actual shaders.
            if is_shader_file(fp_str):
                source = preprocess_shader_source(source)
        except Exception as e:
            self.errors.append(f"Cannot read {fp}: {e}")
            self.visiting.discard(fp_str)
            self.visiting_stack.pop()
            return

        for imp_path in sorted(self._extract_import_paths(source)):
            # External / runtime URLs are not part of the release bundle graph.
            if _is_external_import(imp_path):
                continue
            resolved = self.resolve_import(fp_str, imp_path)
            if resolved is None:
                # Release imports (relative paths) must resolve at build time.
                if imp_path.startswith('.') or imp_path.startswith('/'):
                    self.errors.append(f"Unresolved release import: {imp_path} from {self.mod_id(fp_str)}")
                continue
            if resolved not in self.visited:
                self._visit(resolved)

        self.visiting_stack.pop()
        self.visiting.discard(fp_str)
        self.visited.add(fp_str)
        self.modules[fp_str] = source
        self.order.append(fp_str)
        self.stats["files"] += 1
        self.stats["total_bytes"] += len(source.encode("utf-8"))

    def reorder_by_namespace(self):
        """Reorder modules using Kahn's BFS with namespace-sorted tie-breaking.

        The default DFS topological sort produces one valid ordering.  This
        produces another that groups modules by path prefix (e.g. all
        engine/sim/*, then engine/render/*, then engine/math/*), so the
        LZ77 back-reference window in every compressor sees more repetitive
        content and achieves better ratios — especially for gzip/zstd.

        Maintains full topological validity: every dependency still appears
        before its dependents.
        """
        import heapq
        all_mods = set(self.order)
        # Build forward + reverse edge maps by re-parsing import statements
        deps  = {fp: set() for fp in all_mods}   # fp -> set it depends on
        rdeps = {fp: set() for fp in all_mods}   # fp -> set that depend on it

        for fp in all_mods:
            for imp_path in self._extract_import_paths(self.modules[fp]):
                resolved = self.resolve_import(fp, imp_path)
                if resolved and resolved in all_mods and resolved != fp:
                    deps[fp].add(resolved)
                    rdeps[resolved].add(fp)

        def _ns_key(fp):
            rel = str(Path(fp).relative_to(self.root)).replace("\\", "/")
            parts = rel.split("/")
            # group by first two components: "engine/sim", "engine/render", …
            return "/".join(parts[:2])

        in_deg = {fp: len(deps[fp]) for fp in all_mods}
        heap   = []
        for fp in all_mods:
            if in_deg[fp] == 0:
                heapq.heappush(heap, (_ns_key(fp), fp))

        new_order = []
        while heap:
            _, fp = heapq.heappop(heap)
            new_order.append(fp)
            for dep in rdeps[fp]:
                in_deg[dep] -= 1
                if in_deg[dep] == 0:
                    heapq.heappush(heap, (_ns_key(dep), dep))

        if len(new_order) == len(self.order):
            self.order = new_order   # only replace if Kahn completed cleanly
# ---- Source Rewriter --------------------------------------------------------

def _strip_block_comments_safe(source, strip_line_comments=False):
    """Strip /* ... */ block comments while preserving string contents.

    A naive regex like r'/\\*[\\s\\S]*?\\*/' will match /* inside string
    literals (e.g. 'image/*') and eat real code.  This function walks
    character-by-character, tracking string context, so it only removes
    actual block comments.
    """
    out = []
    i = 0
    n = len(source)
    while i < n:
        c = source[i]
        # Single/double quoted strings — copy verbatim
        if c == "'" or c == '"':
            q = c
            out.append(c)
            i += 1
            while i < n and source[i] != q:
                if source[i] == '\\':
                    out.append(source[i])
                    i += 1
                    if i < n:
                        out.append(source[i])
                        i += 1
                    continue
                out.append(source[i])
                i += 1
            if i < n:
                out.append(source[i])  # closing quote
                i += 1
            continue
        # Template literals — copy verbatim (may contain /*)
        if c == '`':
            out.append(c)
            i += 1
            depth = 0
            while i < n:
                ch = source[i]
                if ch == '\\':
                    out.append(ch)
                    i += 1
                    if i < n:
                        out.append(source[i])
                        i += 1
                    continue
                if ch == '$' and i + 1 < n and source[i + 1] == '{' and depth == 0:
                    out.append(ch)
                    i += 1
                    out.append(source[i])
                    i += 1
                    depth += 1
                    continue
                if ch == '{' and depth > 0:
                    depth += 1
                elif ch == '}' and depth > 0:
                    depth -= 1
                elif ch == '`' and depth == 0:
                    out.append(ch)
                    i += 1
                    break
                out.append(ch)
                i += 1
            continue
        # Line comment — copy as-is by default; skip when strip_line_comments is True
        if c == '/' and i + 1 < n and source[i + 1] == '/':
            while i < n and source[i] != '\n':
                if not strip_line_comments:
                    out.append(source[i])
                i += 1
            continue
        # Block comment — SKIP (this is the whole point)
        if c == '/' and i + 1 < n and source[i + 1] == '*':
            i += 2
            while i < n - 1 and not (source[i] == '*' and source[i + 1] == '/'):
                i += 1
            i += 2  # skip closing */
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def _rewrite_module_regex(source, filepath, graph, os_base_prefix=None):
    """Rewrite a module's imports/exports to use __require/__exports.

    os_base_prefix: optional path prefix (e.g. "webgpu-os/"). Modules under this
    prefix get a PATH-PRESERVING import.meta.url rewrite anchored to a
    configurable runtime base (globalThis.__PE_OS_BASE__ || document.baseURI),
    so runtime fetch()/dynamic-import paths relative to a module's original
    location (apps/, mods/, manifests) still resolve after bundling.
    """
    s = source

    # 0) Strip block comments FIRST to prevent import/export regexes
    #    from matching patterns inside JSDoc /** ... */ blocks.
    #    (e.g. a JSDoc code example with `import { ... } from '...'` would
    #     get rewritten to `/* skipped: ... */` which injects a premature
    #     */ that breaks the outer comment block.)
    #    IMPORTANT: Must be string-aware — naive regex eats /* inside
    #    string literals like 'image/*' and destroys the source.
    s = _strip_block_comments_safe(s)

    # 0b) Rewrite module-only metadata for the classic IIFE bundle. Keep this
    #     legacy path on the same literal-safe implementation as the canonical
    #     emitter so either transformer preserves identical URL behavior.
    s = emitter.rewrite_import_meta(s, filepath, graph, os_base_prefix=os_base_prefix)

    # Helper: strip // line comments from import/export name lists.
    # Only used on the { names } portion, NOT on full source (which has template literals).
    def _strip_inline_comments(text):
        return re.sub(r'//[^\n]*', '', text)

    # 1) Rewrite:  import { a, b as c } from './x.js';
    #         to:  const { a, b: c } = __r('x');
    def repl_named_import(m):
        names_raw = _strip_inline_comments(m.group(1))
        path = m.group(2)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped: {m.group(0).strip()} */"
        mid = graph.mod_id(resolved)
        # Fix "as" aliases: "a as b" -> "a: b"
        names = names_raw.replace("\n", " ").strip()
        names = re.sub(r'(\w+)\s+as\s+(\w+)', r'\1: \2', names)
        return f"const {{ {names} }} = __r('{mid}');"

    s = RE_NAMED_IMPORT.sub(repl_named_import, s)

    # 2) Rewrite:  import * as X from './x.js';
    def repl_star_import(m):
        alias = m.group(1)
        path = m.group(2)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped: {m.group(0).strip()} */"
        mid = graph.mod_id(resolved)
        return f"const {alias} = __r('{mid}');"

    s = RE_STAR_IMPORT.sub(repl_star_import, s)

    # 3) Rewrite:  import X, { A, B as C } from './x.js';   (mixed default + named)
    def repl_mixed_import(m):
        default_alias = m.group(1)
        names_raw = _strip_inline_comments(m.group(2))
        path = m.group(3)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped: {m.group(0).strip()} */"
        mid = graph.mod_id(resolved)
        names = re.sub(r'\s+', ' ', names_raw.strip())
        names = re.sub(r'(\w+)\s+as\s+(\w+)', r'\1: \2', names)
        tmp = f'__{default_alias}_m'
        return (f"const {tmp} = __r('{mid}'); "
                f"const {default_alias} = ({tmp}.__default || {tmp}); "
                f"const {{ {names} }} = {tmp};")

    s = RE_MIXED_IMPORT.sub(repl_mixed_import, s)

    # 4) Rewrite:  import X from './x.js';   (default import)
    def repl_default_import(m):
        alias = m.group(1)
        path = m.group(2)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped: {m.group(0).strip()} */"
        mid = graph.mod_id(resolved)
        return f"const {alias} = (__r('{mid}').__default || __r('{mid}'));"

    s = RE_DEFAULT_IMPORT.sub(repl_default_import, s)

    # 4) Rewrite:  import './x.js';
    def repl_side_effect(m):
        path = m.group(1)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped: import '{path}' */"
        mid = graph.mod_id(resolved)
        return f"__r('{mid}');"

    s = RE_SIDE_EFFECT_IMPORT.sub(repl_side_effect, s)

    # 4b) Rewrite dynamic:  import('./x.js')  ->  Promise.resolve(__r('x'))
    #     and:  await import('./x.js')  ->  Promise.resolve(__r('x'))
    def repl_dynamic_import(m):
        path = m.group(1)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return m.group(0)  # leave unresolved dynamic imports as-is
        mid = graph.mod_id(resolved)
        return f"Promise.resolve(__r('{mid}'))"

    s = RE_DYNAMIC_IMPORT.sub(repl_dynamic_import, s)

    # 5) Rewrite:  export { a, b } from './x.js';
    def repl_reexport_named(m):
        names_raw = _strip_inline_comments(m.group(1)).replace("\n", " ").strip()
        path = m.group(2)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped reexport from '{path}' */"
        mid = graph.mod_id(resolved)
        # Parse names: "a, b as c" -> assign individually
        parts = []
        for item in names_raw.split(","):
            item = item.strip()
            if not item:
                continue
            m2 = re.match(r'(\w+)\s+as\s+(\w+)', item)
            if m2:
                parts.append(f"__e.{m2.group(2)} = __r('{mid}').{m2.group(1)};")
            else:
                parts.append(f"__e.{item} = __r('{mid}').{item};")
        return " ".join(parts)

    s = RE_REEXPORT_NAMED.sub(repl_reexport_named, s)

    # 5b) Rewrite:  export * as Name from './x.js';
    def repl_reexport_namespace(m):
        name = m.group(1)
        path = m.group(2)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped namespace reexport from '{path}' */"
        mid = graph.mod_id(resolved)
        return f"__e.{name} = __r('{mid}');"

    s = RE_REEXPORT_NAMESPACE.sub(repl_reexport_namespace, s)

    # 6) Rewrite:  export * from './x.js';
    def repl_reexport_star(m):
        path = m.group(1)
        resolved = graph.resolve_import(filepath, path)
        if not resolved:
            return f"/* skipped reexport from '{path}' */"
        mid = graph.mod_id(resolved)
        return f"Object.assign(__e, __r('{mid}'));"

    s = RE_REEXPORT_STAR.sub(repl_reexport_star, s)

    # 7) Rewrite:  export default X  ->  __e.__default = X
    s = RE_EXPORT_DEFAULT.sub("__e.__default = ", s)

    # 8) Rewrite: export const { a, b } = X;  ->  const { a, b } = X; __e.a = a; ...
    def repl_export_destructure(m):
        kind = m.group(1)  # const/let/var
        names_raw = m.group(2)
        source = m.group(3).strip()
        # Strip inline comments before extracting names
        cleaned = re.sub(r'//[^\n]*', '', names_raw)
        # Extract comma-separated identifiers
        names = [n.strip() for n in cleaned.split(',') if n.strip()]
        if not names:
            return m.group(0)  # safety: leave unchanged if no names found
        decl = f"{kind} {{ {', '.join(names)} }} = {source};"
        assigns = " ".join(f"__e.{n} = {n};" for n in names)
        return f"{decl}\n{assigns}"

    s = RE_EXPORT_DESTRUCTURE.sub(repl_export_destructure, s)

    # 8b) Collect exported declaration names for appending to __e
    exported_names = []

    def repl_export_decl(m):
        kind = m.group(1)   # "const", "function", "class", etc.
        name = m.group(2)
        exported_names.append(name)
        return f"{kind} {name}"

    s = RE_EXPORT_DECL.sub(repl_export_decl, s)

    # 9) Rewrite:  export { a, b };  ->  __e.a = a; __e.b = b;
    def repl_export_list(m):
        names_raw = _strip_inline_comments(m.group(1)).strip()
        parts = []
        for item in names_raw.split(","):
            item = item.strip()
            if not item:
                continue
            m2 = re.match(r'(\w+)\s+as\s+(\w+)', item)
            if m2:
                parts.append(f"__e.{m2.group(2)} = {m2.group(1)};")
            else:
                parts.append(f"__e.{item} = {item};")
        return " ".join(parts)

    s = RE_EXPORT_LIST.sub(repl_export_list, s)

    # Append export assignments for declarations
    if exported_names:
        assigns = " ".join(f"__e.{n} = {n};" for n in exported_names)
        s += f"\n{assigns}"

    return s


def rewrite_module(source, filepath, graph, os_base_prefix=None):
    """Rewrite a module using the canonical parser/emitter.

    Parser failures are release blockers; a silent regex fallback can produce a
    syntactically valid but semantically incomplete bundle.
    """
    try:
        return emitter.rewrite_module_canonical(source, filepath, graph, os_base_prefix)
    except Exception as error:
        raise ParseError(f"canonical rewrite failed for {filepath}: {error}") from error
