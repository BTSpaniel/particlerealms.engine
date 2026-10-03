# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.builder — bundle assembly, minification, obfuscation, encryption, integrity."""

import os
import re
import gzip
import json
import base64
import hashlib
import subprocess as _subprocess
import shutil as _shutil_which
from collections import OrderedDict, deque
from .config import ENGINE_VERSION
from .graph import rewrite_module
from .parser import _CodeScanner, _decode_js_string_token, _iter_code_tokens, find_template_literal_regions

_ESBUILD_BIN = _shutil_which.which('esbuild')
HAS_ESBUILD = _ESBUILD_BIN is not None

try:
    import rjsmin as _rjsmin
    HAS_RJSMIN = True
except ImportError:
    HAS_RJSMIN = False

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    HAS_AESGCM = True
except ImportError:
    HAS_AESGCM = False


# ---- Module ID Shortening ---------------------------------------------------

_MODULE_ID_PATTERN = r"((?:engine|editor|game|agi|pro|tests)/[^']+\.js)"
_RE_MODULE_ID = re.compile(_MODULE_ID_PATTERN)

_MODULE_ID_MAP_DECLARATION = "var __moduleIdMap = Object.freeze({});"


def shorten_module_ids(bundle_text):
    """Replace verbose module path strings with compact numeric IDs.

    'engine/sim/particles/ParticleSimWorld.js'  ->  42

    IDs are assigned in order of first appearance.  Returns (new_text, id_map).
    """
    ids_seen = []
    ids_set = set()
    registry_references = []
    require_references = []
    window = deque(maxlen=6)

    # Reuse the repository JavaScript scanner so code-shaped text inside
    # strings, templates, comments, and regular expressions stays opaque.
    for token in _iter_code_tokens(bundle_text):
        window.append(token)

        if token.value == "function" and len(window) == 6:
            registry = tuple(window)
            if (
                tuple(item.value for item in registry[:2]) == ("__modules", "[")
                and registry[2].kind == "string"
                and tuple(item.value for item in registry[3:]) == ("]", "=", "function")
            ):
                mid = _decode_js_string_token(bundle_text, registry[2])
                if _RE_MODULE_ID.fullmatch(mid):
                    registry_references.append((registry[2].start, registry[2].end, mid))
                    if mid not in ids_set:
                        ids_seen.append(mid)
                        ids_set.add(mid)

        if token.value == ")" and len(window) >= 4:
            recent = tuple(window)
            require = recent[-4:]
            preceding = recent[-5] if len(recent) >= 5 else None
            if (
                tuple(item.value for item in require[:2]) == ("__r", "(")
                and require[2].kind == "string"
                and require[3].value == ")"
                and (preceding is None or preceding.value not in (".", "?."))
            ):
                mid = _decode_js_string_token(bundle_text, require[2])
                if _RE_MODULE_ID.fullmatch(mid):
                    require_references.append((require[2].start, require[2].end, mid))

    id_to_num = {mid: str(idx) for idx, mid in enumerate(ids_seen)}

    # The bundle's public requireModule(path) contract must continue to accept
    # canonical source paths after the internal registry keys are compacted.
    # JSON uses double-quoted keys, while the executable replacements below are
    # explicitly scoped to registry declarations and require calls.
    module_id_map = json.dumps(
        {mid: int(compact_id) for mid, compact_id in id_to_num.items()},
        separators=(",", ":"),
    )
    replacements = {
        (start, end): id_to_num[mid]
        for start, end, mid in (*registry_references, *require_references)
        if mid in id_to_num
    }
    if replacements:
        chunks = []
        cursor = 0
        for (start, end), compact_id in sorted(replacements.items()):
            if start < cursor:
                raise ValueError("Module ID replacement spans overlap")
            chunks.extend((bundle_text[cursor:start], compact_id))
            cursor = end
        chunks.append(bundle_text[cursor:])
        bundle_text = "".join(chunks)

    bundle_text = bundle_text.replace(
        _MODULE_ID_MAP_DECLARATION,
        f"var __moduleIdMap = Object.freeze({module_id_map});",
        1,
    )
    return bundle_text, id_to_num


_ENTRY_NAMESPACE_OVERRIDES = {
    "agi/index.js": "AGI",
    "plauna/index.js": "Plauna",
    "webgpu-os/index.js": "WebGPUOS",
    "webgpu-os/.bundled-os-content.generated.js": "WebGPUOSContent",
}


def public_entry_namespace(module_id):
    """Return a stable, collision-resistant PE namespace for an entry module."""
    normalized = str(module_id).replace("\\", "/")
    override = _ENTRY_NAMESPACE_OVERRIDES.get(normalized)
    if override:
        return override
    parts = normalized.removesuffix(".js").split("/")
    leaf = parts[-1]
    if leaf == "index" and len(parts) > 1:
        leaf = parts[-2]
    if parts[0] == "editor" and not leaf.startswith("Editor"):
        leaf = "Editor" + leaf[:1].upper() + leaf[1:]
    namespace = re.sub(r"[^A-Za-z0-9_$]", "_", leaf)
    if not namespace or not re.match(r"[A-Za-z_$]", namespace[0]):
        namespace = "_" + namespace
    return namespace


def shorten_bundle_internals(bundle_text):
    """Preserve bundle internals until an AST-scoped renamer is available.

    The former global text replacements also matched application identifiers,
    JSON strings, and signed Base64URL evidence. A signature containing
    ``__r`` was therefore changed after signing. The module-ID compactor remains
    active; this smaller optimization deliberately returns the remaining source
    byte-for-byte so data and public contracts cannot be rewritten as code.
    """
    return bundle_text
# ---- Bundle Builder ---------------------------------------------------------

def build_bundle(graph, root, entry_ids=None, eager=False, os_base_prefix=None):
    """Build the IIFE bundle with module registry.

    Args:
        graph:     Populated ModuleGraph with all modules.
        root:      Project root Path.
        entry_ids: List of module IDs that are entry points.
                   The first is the primary (exposed as PE), rest are
                   exposed as PE.<EntryName>.
        eager:     If True, force-require every module at load time.
    """
    if entry_ids is None:
        entry_ids = [graph.mod_id(graph.order[-1])]

    parts = []

    header = f"""\
// Particle Engine v{ENGINE_VERSION} -- Bundled Runtime
// Generated by bundle_engine.py
// {graph.stats['files']} modules | {graph.stats['total_bytes']:,} bytes source
// Entries: {', '.join(entry_ids)}
(function(global) {{
'use strict';

var __modules = {{}};
var __cache = {{}};
var __moduleIdMap = Object.freeze({{}});

function __resolveModuleId(id) {{
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(__moduleIdMap, id)
    ? __moduleIdMap[id]
    : id;
}}

function __r(id) {{
  if (__cache[id]) return __cache[id];
  var m = __modules[id];
  if (!m) {{ console.error('[PE] missing module: ' + id); return {{}}; }}
  var __e = {{}};
  __cache[id] = __e;
  try {{ m(__e, __r); }} catch(e) {{ console.error('[PE] error in ' + id, e); }}
  if (__e.__default !== undefined && __e.default === undefined) __e.default = __e.__default;
  return __e;
}}

"""
    parts.append(header)

    for filepath in graph.order:
        source = graph.modules[filepath]
        mid = graph.mod_id(filepath)
        rewritten = rewrite_module(source, filepath, graph, os_base_prefix=os_base_prefix)
        parts.append(f"// -- {mid}")
        parts.append(f"__modules['{mid}'] = function(__e, __r) {{")
        parts.append(rewritten)
        parts.append("};")
        parts.append("")

    # -- Public API: multi-entry support --
    primary_id = entry_ids[0]
    parts.append(f"""
// -- Public API
var PE = {{}};

// Primary entry: {primary_id}
var __primary = __r('{primary_id}');
var _pk = Object.keys(__primary);
for (var i = 0; i < _pk.length; i++) {{ PE[_pk[i]] = __primary[_pk[i]]; }}
""")

    # Secondary entries get their own namespace
    entry_namespaces = set()
    for eid in entry_ids[1:]:
        ns_name = public_entry_namespace(eid)
        if ns_name in entry_namespaces:
            raise ValueError(
                f"Secondary entry namespace collision: PE.{ns_name} ({eid})"
            )
        entry_namespaces.add(ns_name)
        parts.append(f"""
// Secondary entry: {eid} -> PE.{ns_name}
var __{ns_name} = __r('{eid}');
PE.{ns_name} = __{ns_name};
var _{ns_name}k = Object.keys(__{ns_name});
for (var i = 0; i < _{ns_name}k.length; i++) {{
  if (!PE[_{ns_name}k[i]]) PE[_{ns_name}k[i]] = __{ns_name}[_{ns_name}k[i]];
}}
""")

    # Expose VirtualGPU directly (always useful)
    parts.append("""
// Direct access to key modules
try { var _vgpu = __r('engine/core/gpu/VirtualGPU.js');
  PE.VirtualGPU = _vgpu.VirtualGPU;
  PE.getVGPU = _vgpu.getVGPU;
  PE.vgpu = _vgpu.vgpu;
  PE.initVGPU = _vgpu.initVGPU;
} catch(e) {}
""")

    # Eager init: force-require ALL modules so nothing is lazy
    if eager:
        parts.append("""
// Eager init: force-initialize all modules into memory
var _allMK = Object.keys(__modules);
for (var _ei = 0; _ei < _allMK.length; _ei++) {
  try { __r(_allMK[_ei]); } catch(e) {}
}
""")

    # Module introspection API
    parts.append("""
// Introspection: access any module by its path
PE.requireModule = function(id) {
  var moduleId = __resolveModuleId(id);
  if (!Object.prototype.hasOwnProperty.call(__modules, moduleId)) return null;
  return __r(moduleId);
};
PE.__require = __r;
PE.__modules = __modules;
PE.__cache   = __cache;
// Preserve the aliases emitted by optimized bundles before requireModule().
PE._require = __r;
PE._M = __modules;
PE._C = __cache;
""")

    parts.append("""
global.ParticleEngine = PE;
global.PE = PE;

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
""")

    return "\n".join(parts)
class JSMin:
    """Python port of Douglas Crockford's JSMin (jsmin.c 2019-10-30).

    Character-by-character state machine that strips comments and unnecessary
    whitespace from JavaScript source. Handles string literals ('/""/``),
    regex literals, single-line and block comments.

    This is the exact same algorithm used by virtually every JS minifier
    in existence — simple, proven, no dependencies.
    """

    EOF = ''

    # A '/' starts a regex literal (not division) when the preceding char is one
    # of the punctuators in `_action`, OR when the preceding *token* is one of
    # these keywords. Crockford's original JSMin omits this keyword check, which
    # mis-parses `return /re/`, `typeof /re/`, etc. as division and then strips
    # an internal `//` (e.g. in /^https?:\/\//i) as a line comment — corrupting
    # the bundle. Keyword-awareness fixes that class of bug.
    _REGEX_PRECEDING_KEYWORDS = frozenset({
        'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
        'do', 'else', 'case', 'yield', 'await', 'throw',
    })

    def __init__(self, source):
        self._src = source
        self._pos = 0
        self._a = '\n'
        self._b = None
        self._x = self.EOF
        self._y = self.EOF
        self._lookahead = self.EOF
        self._out = []

    @staticmethod
    def _is_alnum(c):
        return (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or \
               (c >= 'A' and c <= 'Z') or c in ('_', '$', '\\') or \
               (c != '' and ord(c) > 126)

    def _get(self):
        if self._lookahead != self.EOF:
            c = self._lookahead
            self._lookahead = self.EOF
            return c
        if self._pos >= len(self._src):
            return self.EOF
        c = self._src[self._pos]
        self._pos += 1
        if c >= ' ' or c == '\n':
            return c
        if c == '\r':
            return '\n'
        return ' '

    def _peek(self):
        self._lookahead = self._get()
        return self._lookahead

    def _next(self):
        c = self._get()
        if c == '/':
            p = self._peek()
            if p == '/':
                while True:
                    c = self._get()
                    if c <= '\n':
                        break
                return c
            if p == '*':
                self._get()
                while True:
                    ch = self._get()
                    if ch == '*':
                        if self._peek() == '/':
                            self._get()
                            return ' '
                    if ch == self.EOF:
                        return self.EOF
        self._y = self._x
        self._x = c
        return c

    def _put(self, c):
        self._out.append(c)

    def _regex_after_keyword(self):
        """True if the token preceding the candidate '/' is a regex keyword.

        self._a is the char immediately before the '/': it is the keyword's
        last char when there is no gap (`return/re/`), or collapsed whitespace
        when there is (`return /re/`). The rest of the identifier has already
        been emitted to self._out, so reconstruct the trailing word from both.
        Guards against property access (`obj.return / x`) which is division.
        """
        out = self._out
        a = self._a
        chars = []
        if a.isalnum() or a in ('_', '$'):
            chars.append(a)
        elif a not in (' ', '\t', '\r', '\n', self.EOF):
            return False
        k = len(out) - 1
        while k >= 0 and (out[k].isalnum() or out[k] in ('_', '$')):
            chars.append(out[k])
            k -= 1
        if not chars:
            return False
        if k >= 0 and out[k] == '.':
            return False
        word = ''.join(reversed(chars))
        return word in self._REGEX_PRECEDING_KEYWORDS

    def _action(self, d):
        if d <= 1:
            self._put(self._a)
            if (self._y == '\n' or self._y == ' ') and \
               self._a in ('+', '-', '*', '/') and \
               self._b in ('+', '-', '*', '/'):
                self._put(self._y)
        if d <= 2:
            self._a = self._b
            if self._a == "'" or self._a == '"' or self._a == '`':
                quote = self._a
                while True:
                    self._put(self._a)
                    self._a = self._get()
                    if self._a == quote:
                        break
                    if self._a == '\\':
                        self._put(self._a)
                        self._a = self._get()
                    if self._a == self.EOF:
                        break
        if d <= 3:
            self._b = self._next()
            if self._b == '/' and (self._a in (
                '(', ',', '=', ':', '[', '!', '&', '|',
                '?', '+', '-', '~', '*', '/', '{', '}', ';'
            ) or self._regex_after_keyword()):
                self._put(self._a)
                if self._a == '/' or self._a == '*':
                    self._put(' ')
                self._put(self._b)
                while True:
                    self._a = self._get()
                    if self._a == '[':
                        while True:
                            self._put(self._a)
                            self._a = self._get()
                            if self._a == ']':
                                break
                            if self._a == '\\':
                                self._put(self._a)
                                self._a = self._get()
                            if self._a == self.EOF:
                                break
                    elif self._a == '/':
                        break
                    elif self._a == '\\':
                        self._put(self._a)
                        self._a = self._get()
                    elif self._a == self.EOF:
                        break
                    self._put(self._a)
                self._b = self._next()

    def minify(self):
        if self._src and self._src[0] == '\ufeff':
            self._pos = 1
        self._a = '\n'
        self._action(3)
        while self._a != self.EOF:
            if self._a == ' ':
                self._action(1 if self._is_alnum(self._b) else 2)
            elif self._a == '\n':
                if self._b in ('{', '[', '(', '+', '-', '!', '~'):
                    self._action(1)
                elif self._b == ' ':
                    self._action(3)
                else:
                    self._action(1 if self._is_alnum(self._b) else 2)
            else:
                if self._b == ' ':
                    self._action(1 if self._is_alnum(self._a) else 3)
                elif self._b == '\n':
                    if self._a in ('}', ']', ')', '+', '-', '"', "'", '`'):
                        self._action(1)
                    else:
                        self._action(1 if self._is_alnum(self._a) else 3)
                else:
                    self._action(1)
        return ''.join(self._out)


def _minify_esbuild(source):
    """Minify via esbuild subprocess — fastest option (~0.5s for 11MB)."""
    proc = _subprocess.run(
        [_ESBUILD_BIN, '--minify-whitespace', '--minify-syntax', '--loader=js'],
        input=source, capture_output=True, text=True, timeout=30,
    )
    if proc.returncode == 0 and proc.stdout:
        return proc.stdout
    return None


def _minify_rjsmin(source):
    """Minify via rjsmin C extension — ~10-50x faster than pure Python."""
    return _rjsmin.jsmin(source, keep_bang_comments=False)


def _minify_jsmin(source):
    """Minify via pure Python JSMin — slowest fallback."""
    return JSMin(source).minify()


class _MinificationLiteralScanner(_CodeScanner):
    """Recognize legacy-minifier regex gaps from code tokens, skipping comments.

    rjsmin recognizes a regex after ``return`` and a small punctuation set,
    but not after arrow/comparison operators or the other expression keywords.
    Keep this repair bounded: the shared scanner's conservative heuristic also
    calls some division chains regexes, so those must not receive markers.
    """

    _REGEX_PREFIXES = frozenset({
        "=>", ">", ">=", ">>", ">>>", "typeof", "void", "throw", "delete",
        "new", "instanceof", "in", "else", "do", "case", "/",
    })

    def __init__(self, source):
        super().__init__(source)
        self._previous = deque(maxlen=2)
        self.protect_regex = False

    def _match_regex(self):
        self.protect_regex = False
        if self.peek() != "/":
            return False
        # A property named `return` or `typeof` is an expression value, so its
        # following slash is division even when a later slash closes a comment.
        if len(self._previous) == 2 and self._previous[0] in {".", "?."}:
            return False
        unsafe_context = bool(self._previous and self._previous[-1] in self._REGEX_PREFIXES)
        matched = super()._match_regex(expression_start=unsafe_context)
        self.protect_regex = matched and unsafe_context
        return matched

    def next_code_token(self):
        token = super().next_code_token()
        if token is not None:
            self._previous.append(token.value)
        return token

    def _skip_template_literal(self):
        # Template interpolations use the base scanner internally; their code
        # tokens are not part of this outer stream. An outer arrow or keyword
        # must not force a division inside `${...}` to become a regex.
        previous = self._previous
        self._previous = deque(maxlen=2)
        try:
            super()._skip_template_literal()
        finally:
            self._previous = previous


def _protect_minification_literals(source):
    """Replace templates and unsupported regex contexts while legacy minifiers run.

    rjsmin and the bundled JSMin scanner predate nested template literals. They
    stop at the first nested backtick and then delete meaningful whitespace
    from subsequent template segments. Keeping each complete literal behind a
    deterministic quoted token preserves cooked text, raw text, tags, nested
    expressions, CSS, and WGSL byte-for-byte while surrounding JavaScript is
    still minified. Regexes after arrows and expression keywords have a similar
    problem: an escaped slash can be mistaken for the start of a line comment.
    Only those token-confirmed contexts receive regex protection.
    """
    nonce = hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]
    marker_prefix = f"__PE_LITERAL_{nonce}_"
    if marker_prefix in source:
        raise ValueError("Literal protection marker collides with source text")

    output = []
    replacements = []
    cursor = 0
    scanner = _MinificationLiteralScanner(source)
    while (token := scanner.next_code_token()) is not None:
        if token.kind != "template" and not (token.kind == "regex" and scanner.protect_regex):
            continue
        start, end = token.start, token.end
        literal_index = len(replacements)
        marker = f"'{marker_prefix}{literal_index:08x}__'"
        output.append(source[cursor:start])
        output.append(marker)
        literal = source[start:end]
        # Preserve token separation if a minifier removes the gap between an
        # operator and the quoted marker. Never let division become `//`.
        replacements.append((marker, f" {literal} " if token.kind == "regex" else literal))
        cursor = end
    output.append(source[cursor:])
    return ''.join(output), tuple(replacements)


def _restore_minification_literals(source, replacements):
    if not replacements:
        return source
    by_marker = dict(replacements)
    seen = set()
    marker_pattern = re.compile(r"'__PE_LITERAL_[0-9a-f]{16}_[0-9a-f]{8}__'")

    def restore(match):
        marker = match.group(0)
        literal = by_marker.get(marker)
        if literal is None:
            raise RuntimeError(f"Unknown literal minification marker: {marker}")
        if marker in seen:
            raise RuntimeError(f"Duplicate literal minification marker: {marker}")
        seen.add(marker)
        return literal

    restored = marker_pattern.sub(restore, source)
    if len(seen) != len(replacements):
        missing = [marker for marker, _ in replacements if marker not in seen]
        raise RuntimeError(
            f"Literal minification marker integrity failed: {len(missing)} marker(s) missing"
        )
    return restored


def minify_source(source):
    """Minify JS source using the fastest available minifier.

    Priority: esbuild (Go subprocess) > rjsmin (C extension) > JSMin (pure Python).
    """
    if HAS_ESBUILD:
        result = _minify_esbuild(source)
        if result is not None:
            return result
    protected_source, literals = _protect_minification_literals(source)
    if HAS_RJSMIN:
        minified = _minify_rjsmin(protected_source)
    else:
        minified = _minify_jsmin(protected_source)
    return _restore_minification_literals(minified, literals)
# ---- Obfuscation ------------------------------------------------------------

# Regex to match single/double quoted string literals (handles escapes)
_RE_JS_STRING = re.compile(r"""(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')""", re.DOTALL)


def _find_template_body_regions(source):
    """Scan source to find template literal BODY regions (not ${...} expressions).

    Returns a sorted list of (start, end) tuples for template body text only.
    Strings in body text must be skipped (they're HTML/literal text, not JS).
    Strings inside ${...} expressions are real JS and safe to extract.
    """
    body_regions = []
    n = len(source)
    i = 0
    while i < n:
        c = source[i]
        # Skip regular strings
        if c == '"' or c == "'":
            q = c
            i += 1
            while i < n and source[i] != q:
                if source[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        # Skip // line comments
        if c == '/' and i + 1 < n and source[i + 1] == '/':
            i += 2
            while i < n and source[i] != '\n':
                i += 1
            continue
        # Skip /* block comments */
        if c == '/' and i + 1 < n and source[i + 1] == '*':
            i += 2
            while i < n - 1 and not (source[i] == '*' and source[i + 1] == '/'):
                i += 1
            i += 2
            continue
        if c == '`':
            # Found a template literal — scan its body and expressions
            _scan_template_body(source, n, i, body_regions)
            # Skip past the entire template literal
            i = _skip_template_literal(source, n, i)
            continue
        i += 1
    return body_regions


def _skip_template_literal(source, n, i):
    """Skip past a complete template literal starting at position i (the backtick).
    Returns position after the closing backtick."""
    i += 1  # skip opening backtick
    while i < n:
        c = source[i]
        if c == '\\':
            i += 2
            continue
        if c == '`':
            return i + 1  # past closing backtick
        if c == '$' and i + 1 < n and source[i + 1] == '{':
            i = _skip_expression(source, n, i + 2)
            continue
        i += 1
    return i


def _skip_expression(source, n, i):
    """Skip a ${...} expression body starting after the opening '{'.
    Returns position after the closing '}'."""
    depth = 1
    while i < n and depth > 0:
        c = source[i]
        if c == '\\':
            i += 2
            continue
        if c == '"' or c == "'":
            q = c
            i += 1
            while i < n and source[i] != q:
                if source[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        if c == '`':
            # Nested template literal inside expression
            i = _skip_template_literal(source, n, i)
            continue
        if c == '{':
            depth += 1
            i += 1
            continue
        if c == '}':
            depth -= 1
            if depth == 0:
                return i + 1
            i += 1
            continue
        i += 1
    return i


def _scan_template_body(source, n, start, body_regions):
    """Scan a template literal and add its BODY text ranges (not ${...}) to body_regions."""
    i = start + 1  # skip opening backtick
    body_start = i  # body text starts here
    while i < n:
        c = source[i]
        if c == '\\':
            i += 2
            continue
        if c == '`':
            # End of template — record final body segment
            if i > body_start:
                body_regions.append((body_start, i))
            return
        if c == '$' and i + 1 < n and source[i + 1] == '{':
            # Record body segment before this expression
            if i > body_start:
                body_regions.append((body_start, i))
            # Skip the expression
            i = _skip_expression(source, n, i + 2)
            body_start = i  # next body segment starts after expression
            continue
        i += 1
    # Unclosed template literal — record what we have
    if i > body_start:
        body_regions.append((body_start, i))


# Regex to match standalone decimal integers (not inside identifiers, hex, or
# scientific notation like 1e-12, 2.5e+10, 1E12).
_RE_DECIMAL_INT = re.compile(r'(?<![.\w])(?<![eE])(?<![eE][+-])(\d{2,})(?![.\w])')


def obfuscate_strings(source):
    """Extract string literals into a base64-encoded, shuffled, rotated array.

    Technique: string array extraction + base64 encoding + index rotation.
    Industry standard from javascript-obfuscator. Makes string searching useless.

    Returns (modified_source, num_extracted).
    """
    import base64 as _b64
    import random as _rnd

    # ---- Step 1: Find non-code regions via character scan ----
    # We skip: template literals, regex literals, comments.
    # String regex only runs on code segments (gaps between these regions).
    # This eliminates template AND regex injection by construction.
    _REGEX_PREV = set('=([!&|^~+-*/%<>?:;,{}')
    skip_regions = []  # (start, end) for template literals AND regex literals
    _ti = 0
    _tn = len(source)
    _prev_token = ';'  # treat start-of-file as statement boundary
    while _ti < _tn:
        _tc = source[_ti]
        if _tc == '"' or _tc == "'":
            _tq = _tc
            _ti += 1
            while _ti < _tn and source[_ti] != _tq:
                if source[_ti] == '\\':
                    _ti += 1
                _ti += 1
            _ti += 1
            _prev_token = ')'  # string acts like a value (division context)
            continue
        if _tc == '/' and _ti + 1 < _tn and source[_ti + 1] == '/':
            _ti += 2
            while _ti < _tn and source[_ti] != '\n':
                _ti += 1
            continue
        if _tc == '/' and _ti + 1 < _tn and source[_ti + 1] == '*':
            _ti += 2
            while _ti < _tn - 1 and not (source[_ti] == '*' and source[_ti + 1] == '/'):
                _ti += 1
            _ti += 2
            continue
        if _tc == '`':
            _tstart = _ti
            _ti = _skip_template_literal(source, _tn, _ti)
            skip_regions.append((_tstart, _ti))
            _prev_token = ')'  # template literal acts like a value
            continue
        # Regex literal detection: / after operator/punctuation context
        if _tc == '/' and _prev_token in _REGEX_PREV:
            _tstart = _ti
            _ti += 1  # skip opening /
            while _ti < _tn and source[_ti] != '/':
                if source[_ti] == '\\':
                    _ti += 1  # skip escaped char in regex
                if source[_ti] == '[':
                    # character class — scan until ]
                    _ti += 1
                    while _ti < _tn and source[_ti] != ']':
                        if source[_ti] == '\\':
                            _ti += 1
                        _ti += 1
                _ti += 1
            _ti += 1  # skip closing /
            # Skip regex flags (g, i, m, s, u, y, d)
            while _ti < _tn and source[_ti] in 'gimsuvyd':
                _ti += 1
            skip_regions.append((_tstart, _ti))
            _prev_token = ')'  # regex acts like a value
            continue
        if not _tc.isspace():
            _prev_token = _tc
        _ti += 1

    # ---- Step 2: Build code segments (gaps between skip regions) ----
    skip_regions.sort()
    code_segments = []  # (source_offset, segment_text)
    prev_end = 0
    for ts, te in skip_regions:
        if ts > prev_end:
            code_segments.append((prev_end, source[prev_end:ts]))
        prev_end = te
    if prev_end < _tn:
        code_segments.append((prev_end, source[prev_end:]))

    # ---- Step 3: Run regex ONLY on code segments, map positions back ----
    matches = []
    for seg_offset, seg_text in code_segments:
        for m in _RE_JS_STRING.finditer(seg_text):
            matches.append((seg_offset + m.start(), seg_offset + m.end(), m.group(0)))

    if not matches:
        return source, 0

    # Deduplicate and filter
    unique_strings = OrderedDict()
    replacements = []
    _skip_short = _skip_strict = _skip_esc = _skip_prop = 0

    n = len(source)
    for start, end, raw in matches:
        inner = raw[1:-1]
        if len(inner) < 3:
            _skip_short += 1
            continue
        if inner == 'use strict':
            _skip_strict += 1
            continue
        # Skip strings with escape sequences
        if '\\' in inner:
            _skip_esc += 1
            continue
        # Skip strings used as object property names
        if end < n and source[end] == ':':
            _skip_prop += 1
            continue

        if raw not in unique_strings:
            unique_strings[raw] = len(unique_strings)
        replacements.append((start, end, unique_strings[raw]))

    if not replacements:
        return source, 0

    # Build the string array (base64 encoded)
    str_list = list(unique_strings.keys())
    encoded = []
    for s in str_list:
        inner = s[1:-1]
        encoded.append(_b64.b64encode(inner.encode('utf-8')).decode('ascii'))

    # ---- Fisher-Yates full shuffle ----
    # Build a permutation: shuffled_idx[i] = original index of the string at position i
    N = len(encoded)
    perm = list(range(N))  # identity permutation
    _rnd.shuffle(perm)     # Fisher-Yates shuffle

    # Build shuffled array and inverse mapping (orig_idx -> shuffled position)
    shuffled = [''] * N
    orig_to_shuffled = [0] * N
    for shuffled_pos, orig_idx in enumerate(perm):
        shuffled[shuffled_pos] = encoded[orig_idx]
        orig_to_shuffled[orig_idx] = shuffled_pos

    # ---- Index shift (random base offset) ----
    # Instead of fn(0), fn(1), calls use fn(base+0), fn(base+1)
    # Decoder subtracts the base. Defeats simple pattern matching.
    index_shift = _rnd.randint(0x80, 0x3FF)

    # ---- Generate variable names ----
    arr_name = '_0x' + format(_rnd.randint(0x1000, 0xFFFF), 'x')
    fn_name = '_0x' + format(_rnd.randint(0x1000, 0xFFFF), 'x')

    # ---- Generate 3 wrapper function names (aliases for the decoder) ----
    wrapper_names = []
    for _ in range(3):
        wrapper_names.append('_0x' + format(_rnd.randint(0x1000, 0xFFFF), 'x'))

    # ---- Build header: array + decoder + wrappers ----
    arr_json = json.dumps(shuffled)
    # Decoder function with index shift + UTF-8 decode.
    # atob() returns raw bytes as Latin-1 chars; escape()+decodeURIComponent()
    # re-interprets them as UTF-8, correctly restoring multi-byte chars (emoji etc).
    header = (
        f"var {arr_name}={arr_json};"
        f"var {fn_name}=function(i){{return decodeURIComponent(escape(atob({arr_name}[i-{hex(index_shift)}])))}};"
    )
    # Wrapper functions: each is an alias with a secondary offset for extra indirection
    wrapper_offsets = []
    for wn in wrapper_names:
        wo = _rnd.randint(0x10, 0xFF)
        wrapper_offsets.append(wo)
        header += f"var {wn}=function(i){{return {fn_name}(i-{hex(wo)})}};"
    header += '\n'

    # ---- Build replacement call expressions ----
    # Randomly pick between the main fn and wrapper functions for each call
    all_callers = [(fn_name, 0)] + list(zip(wrapper_names, wrapper_offsets))

    parts = []
    prev = 0
    for start, end, orig_idx in replacements:
        parts.append(source[prev:start])
        # Check if preceding char needs a separator space
        if start > 0 and source[start - 1].isalnum() or (start > 0 and source[start - 1] == '_'):
            parts.append(' ')
        # Pick a random caller (main fn or one of the wrappers)
        caller_name, caller_offset = _rnd.choice(all_callers)
        # Final index: shuffled position + index_shift + wrapper offset, in hex
        call_idx = orig_to_shuffled[orig_idx] + index_shift + caller_offset
        parts.append(f"{caller_name}({hex(call_idx)})")
        prev = end
    parts.append(source[prev:])

    result = header + ''.join(parts)

    # ---- Self-verification: scan output for known syntax-breaking patterns ----
    # Build regex matching ANY of our decoder/wrapper function calls (hex indices)
    all_fn_names = [fn_name] + wrapper_names
    any_fn_esc = '(?:' + '|'.join(re.escape(n) for n in all_fn_names) + ')'
    fn_call_re = re.compile(any_fn_esc + r'\(0x[0-9a-f]+\)')
    verify_errors = []

    # Pattern 1: keyword joined with fn call
    for vm in re.finditer(
        r'(return|typeof|throw|case|void|delete|new|in|instanceof|yield|await)'
        + any_fn_esc + r'\(', result
    ):
        verify_errors.append("keyword+fn")

    # Pattern 2: fn call as object property name
    for vm in re.finditer(r'[{,]\s*' + any_fn_esc + r'\(0x[0-9a-f]+\)\s*:', result):
        verify_errors.append("prop-name")

    # Pattern 3: scientific notation broken
    for vm in re.finditer(r'\d[eE][+-]0x[0-9a-f]+', result):
        verify_errors.append("sci-nota")

    # Pattern 4: fn call inside template body
    out_body = _find_template_body_regions(result)
    if out_body:
        import bisect as _bv
        ob_s = [s for s, e in out_body]
        ob_e = [e for s, e in out_body]
        for vm in fn_call_re.finditer(result):
            idx = _bv.bisect_right(ob_s, vm.start()) - 1
            if idx >= 0 and vm.start() < ob_e[idx]:
                verify_errors.append("tpl-body")

    if verify_errors:
        from collections import Counter
        counts = Counter(verify_errors)
        summary = ", ".join(f"{v} {k}" for k, v in counts.items())
        print(f"[bundle] ⚠ OBFUSCATION VERIFY: {len(verify_errors)} issues ({summary})")
    else:
        print(f"[bundle] ✓ Obfuscation self-verify: 0 issues")

    return result, len(unique_strings)


def obfuscate_hex_numbers(source):
    """Convert decimal integer literals to hexadecimal.

    2024 -> 0x7e8.  Makes numeric constants harder to search for.
    Only converts integers >= 10 to avoid breaking single-digit logic.
    Skips numbers inside strings, template literals, and regex literals.

    Returns (modified_source, count).
    """
    import bisect as _bisect

    # Build non-code regions: strings + template literals + regex literals
    # Same scanner as obfuscate_strings to ensure consistency
    _REGEX_PREV = set('=([!&|^~+-*/%<>?:;,{}')
    skip_regions = []
    _ti = 0
    _tn = len(source)
    _prev_token = ';'
    while _ti < _tn:
        _tc = source[_ti]
        if _tc == '"' or _tc == "'":
            _tstart = _ti
            _tq = _tc
            _ti += 1
            while _ti < _tn and source[_ti] != _tq:
                if source[_ti] == '\\':
                    _ti += 1
                _ti += 1
            _ti += 1
            skip_regions.append((_tstart, _ti))
            _prev_token = ')'
            continue
        if _tc == '/' and _ti + 1 < _tn and source[_ti + 1] == '/':
            _tstart = _ti
            _ti += 2
            while _ti < _tn and source[_ti] != '\n':
                _ti += 1
            skip_regions.append((_tstart, _ti))
            continue
        if _tc == '/' and _ti + 1 < _tn and source[_ti + 1] == '*':
            _tstart = _ti
            _ti += 2
            while _ti < _tn - 1 and not (source[_ti] == '*' and source[_ti + 1] == '/'):
                _ti += 1
            _ti += 2
            skip_regions.append((_tstart, _ti))
            continue
        if _tc == '`':
            _tstart = _ti
            _ti = _skip_template_literal(source, _tn, _ti)
            skip_regions.append((_tstart, _ti))
            _prev_token = ')'
            continue
        if _tc == '/' and _prev_token in _REGEX_PREV:
            _tstart = _ti
            _ti += 1
            while _ti < _tn and source[_ti] != '/':
                if source[_ti] == '\\':
                    _ti += 1
                if source[_ti] == '[':
                    _ti += 1
                    while _ti < _tn and source[_ti] != ']':
                        if source[_ti] == '\\':
                            _ti += 1
                        _ti += 1
                _ti += 1
            _ti += 1
            while _ti < _tn and source[_ti] in 'gimsuvyd':
                _ti += 1
            skip_regions.append((_tstart, _ti))
            _prev_token = ')'
            continue
        if not _tc.isspace():
            _prev_token = _tc
        _ti += 1

    skip_regions.sort()
    skip_s = [s for s, e in skip_regions]
    skip_e = [e for s, e in skip_regions]

    count = [0]

    def _in_skip(pos):
        idx = _bisect.bisect_right(skip_s, pos) - 1
        return idx >= 0 and pos < skip_e[idx]

    def _hex_replacer(m):
        if _in_skip(m.start()):
            return m.group(0)
        num = int(m.group(1))
        if num < 10:
            return m.group(0)
        count[0] += 1
        return f'0x{num:x}'

    result = _RE_DECIMAL_INT.sub(_hex_replacer, source)
    return result, count[0]


# ---- Encryption & Protection ------------------------------------------------

def encrypt_bundle(source, domains=None):
    """AES-256-GCM encrypt the bundle with a random key.

    Generates a self-contained loader script that:
    - Checks domain whitelist (if domains provided)
    - Injects anti-debugging traps
    - Decrypts the bundle using Web Crypto API (SubtleCrypto)
    - Executes via Blob URL (CSP-friendly, avoids eval)
    - Verifies integrity via GCM authentication tag

    The AES key is embedded (split + obfuscated) in the loader.
    Domain lock is a separate check layer.

    Requires: `pip install cryptography`

    Returns the complete encrypted loader as a JS string.
    """
    if not HAS_AESGCM:
        raise RuntimeError("--encrypt requires `pip install cryptography`")

    import base64 as _b64

    source_bytes = source.encode('utf-8')

    # Compress BEFORE encrypting so the base64 payload is compact
    # (~85% smaller). Loader decompresses via DecompressionStream.
    compressed = gzip.compress(source_bytes, compresslevel=9)

    # Generate random key (256-bit) and IV (96-bit)
    key = os.urandom(32)
    iv = os.urandom(12)

    # Encrypt the COMPRESSED data with AES-256-GCM
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, compressed, None)

    # Encode to base64 for embedding
    iv_b64 = _b64.b64encode(iv).decode('ascii')
    ct_b64 = _b64.b64encode(ciphertext).decode('ascii')

    # Split key into 4 obfuscated parts with XOR scramble
    key_parts = [key[i:i+8] for i in range(0, 32, 8)]
    scramble = os.urandom(8)
    scramble_hex = ','.join(f'0x{b:02x}' for b in scramble)

    # Each part is XOR'd with scramble, stored as hex array
    part_vars = []
    part_decls = []
    for i, part in enumerate(key_parts):
        xored = bytes(a ^ b for a, b in zip(part, scramble))
        hex_arr = ','.join(f'0x{b:02x}' for b in xored)
        vname = f'_k{i}'
        part_vars.append(vname)
        part_decls.append(f'var {vname}=[{hex_arr}];')

    # Domain lock code
    if domains:
        domains_json = json.dumps(domains)
        domain_check = (
            f'var _h=location.hostname;'
            f'var _dl={domains_json};'
            f'if(!_dl.some(function(d){{return _h===d||_h.endsWith("."+d)}}))'
            f'{{document.body&&(document.body.innerHTML="");return}}'
        )
    else:
        domain_check = ''

    # Build the loader
    loader = (
        '(async function(){'
        # Anti-debugging: recurring debugger trap + timing detection
        'var _ad=function(){try{(function(){}).constructor("debugger")();'
        'setTimeout(_ad,3000)}catch(e){}};_ad();'
        # Console disable
        'var _nc=function(){};'
        'if(typeof console!=="undefined"){'
        'console.log=_nc;console.debug=_nc;console.info=_nc;'
        'console.warn=_nc;console.error=_nc;console.table=_nc;'
        'console.clear=_nc;console.dir=_nc;console.trace=_nc}'
        # Domain lock
        f'{domain_check}'
        # Key reconstruction: unscramble the 4 parts
        f'{" ".join(part_decls)}'
        f'var _sc=[{scramble_hex}];'
        'var _kb=new Uint8Array(32);'
        f'for(var _i=0;_i<4;_i++){{'
        f'var _p=[{",".join(part_vars)}][_i];'
        f'for(var _j=0;_j<8;_j++)_kb[_i*8+_j]=_p[_j]^_sc[_j]}}'
        # Import key
        'var _ck=await crypto.subtle.importKey("raw",_kb,"AES-GCM",false,["decrypt"]);'
        # Decrypt
        f'var _iv=Uint8Array.from(atob("{iv_b64}"),function(c){{return c.charCodeAt(0)}});'
        f'var _ct=Uint8Array.from(atob("{ct_b64}"),function(c){{return c.charCodeAt(0)}});'
        'try{'
        'var _pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:_iv},_ck,_ct);'
        # Decompress gzip (data was compressed before encryption)
        'var _gz=new Blob([_pt]).stream().pipeThrough(new DecompressionStream("gzip"));'
        'var _code=await new Response(_gz).text();'
        # Execute via Blob URL (CSP-friendly)
        'var _b=new Blob([_code],{type:"text/javascript"});'
        'var _u=URL.createObjectURL(_b);'
        'var _s=document.createElement("script");'
        '_s.src=_u;_s.onload=function(){URL.revokeObjectURL(_u)};'
        'document.head.appendChild(_s)'
        '}catch(e){'
        'document.body&&(document.body.innerHTML="")'
        '}'
        '})();'
    )

    return loader


# ---- Integrity Map (chunked HMAC verification) ------------------------------

def build_integrity_wrapper(source, chunk_size=65536):
    """Wrap the source with a chunked integrity verification header.

    At build time:
    - Splits source body into fixed-size chunks
    - SHA-256 hashes each chunk
    - HMAC-SHA256 signs the hash list with a random key (prevents hash replacement)

    At runtime:
    - Fetches its own source via document.currentScript.src
    - Strips the known-length verification header
    - Re-hashes each chunk using SubtleCrypto SHA-256
    - HMAC-verifies the hash list integrity
    - If ANY chunk fails: halts execution, reports which chunk was tampered

    Returns (wrapped_source, num_chunks).
    """
    import hmac as _hmac

    source_bytes = source.encode('utf-8')
    num_chunks = (len(source_bytes) + chunk_size - 1) // chunk_size

    # SHA-256 hash each chunk
    chunk_hashes = []
    for i in range(num_chunks):
        start = i * chunk_size
        end = min(start + chunk_size, len(source_bytes))
        chunk = source_bytes[start:end]
        h = hashlib.sha256(chunk).hexdigest()
        chunk_hashes.append(h)

    # HMAC-SHA256 sign the hash list
    hmac_key = os.urandom(32)
    hash_list_str = ','.join(chunk_hashes)
    map_hmac = _hmac.new(hmac_key, hash_list_str.encode(), hashlib.sha256).hexdigest()

    # Encode HMAC key as hex array for JS
    hmac_key_hex = ','.join(f'0x{b:02x}' for b in hmac_key)
    hashes_json = json.dumps(chunk_hashes)

    # Build the verification header
    # Uses a placeholder for HEADER_SIZE which we calculate after building
    verification_js = (
        '(async function _iv(){'
        'var _cs=document.currentScript;'
        'if(!_cs||!_cs.src){return}'
        'try{'
        'var _r=await fetch(_cs.src);'
        'var _t=await _r.text();'
        f'var _hs={hashes_json};'
        f'var _cs2={chunk_size};'
        # HMAC key
        f'var _hk=new Uint8Array([{hmac_key_hex}]);'
        f'var _em="{map_hmac}";'
        # Verify HMAC of hash list first
        'var _hki=await crypto.subtle.importKey("raw",_hk,{name:"HMAC",hash:"SHA-256"},false,["sign"]);'
        'var _hm=await crypto.subtle.sign("HMAC",_hki,new TextEncoder().encode(_hs.join(",")));'
        'var _hh=Array.from(new Uint8Array(_hm)).map(function(b){return b.toString(16).padStart(2,"0")}).join("");'
        'if(_hh!==_em){throw new Error("Map tampered")}'
        # Strip header, verify each chunk
        'var _body=_t.slice(/*HEADER_SIZE*/);'
        'var _bb=new TextEncoder().encode(_body);'
        'for(var _i=0;_i<_hs.length;_i++){'
        'var _s=_i*_cs2;'
        'var _e=Math.min(_s+_cs2,_bb.length);'
        'var _ch=_bb.slice(_s,_e);'
        'var _d=await crypto.subtle.digest("SHA-256",_ch);'
        'var _dx=Array.from(new Uint8Array(_d)).map(function(b){return b.toString(16).padStart(2,"0")}).join("");'
        'if(_dx!==_hs[_i]){'
        'throw new Error("Integrity violation: chunk "+_i+" of "+_hs.length)'
        '}}'
        '}catch(e){document.body&&(document.body.innerHTML="")}'
        '})();\n'
    )

    # Now calculate the actual header size and patch in the placeholder
    # First pass: estimate size with a placeholder number
    placeholder = '/*HEADER_SIZE*/'
    # The header size includes the header itself, so we need to solve for it
    # Try with the current length, then adjust
    test_header = verification_js.replace(placeholder, str(len(verification_js.encode('utf-8'))))
    actual_size = len(test_header.encode('utf-8'))
    # If the digit count changed, recalculate
    final_header = verification_js.replace(placeholder, str(actual_size))
    final_size = len(final_header.encode('utf-8'))
    if final_size != actual_size:
        final_header = verification_js.replace(placeholder, str(final_size))
        final_size = len(final_header.encode('utf-8'))
        if final_size != int(final_header.split('.slice(')[1].split(')')[0]):
            # One more iteration to converge
            final_header = verification_js.replace(placeholder, str(final_size))

    return final_header + source, num_chunks
