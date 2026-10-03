# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.transform — WGSL/HTML template minification + console/comment stripping."""

import re
from collections import deque
from .parser import _CodeScanner, ParseError
from .textscan import template_literal_end


# ---- WGSL Stripping ---------------------------------------------------------

_SHADER_PATH_MARKERS  = ('/shaders/', '/shader/', 'Shader.js', 'shader.js', '.wgsl')
_WGSL_CONTENT_MARKERS = ('@vertex', '@fragment', '@compute', '@group(', 'fn ', 'var<uniform', 'struct ')

# Ordered: block comment first (may contain // inside), then line comment
_RE_WGSL_BLOCK_CMT  = re.compile(r'/\*.*?\*/', re.DOTALL)
_RE_WGSL_LINE_CMT   = re.compile(r'//[^\n]*')
_RE_WGSL_WS         = re.compile(r'[ \t\r\n]+')
# Remove spaces around punctuation that is never content-significant in WGSL
# Includes: { } ( ) [ ] ; , : < >
_RE_WGSL_PUNCT_SP   = re.compile(r' *([{}\(\)\[\];,:<>]) *')
# Remove spaces around the -> return-type arrow
_RE_WGSL_ARROW_SP   = re.compile(r' *-> *')
# Float literal compaction (WGSL spec allows both forms):
#   0.NNN  ->  .NNN   (remove leading zero)
#   N.0    ->  N.     (remove trailing zero, only when no more digits follow)
_RE_WGSL_FLOAT_LEAD  = re.compile(r'\b0(\.[0-9]+)')
_RE_WGSL_FLOAT_TRAIL = re.compile(r'(\b[0-9]+)\.0\b')
def is_shader_file(filepath_str):
    fp = filepath_str.replace('\\', '/')
    return any(m in fp for m in _SHADER_PATH_MARKERS)


def strip_wgsl_in_template_literal(content):
    """Aggressively minify a WGSL string:

    1. Strip /* */ block comments
    2. Strip // line comments
    3. Collapse all whitespace (spaces, tabs, newlines) to a single space
    4. Remove spaces around WGSL punctuation: { } ( ) [ ] ; , : < >
    5. Remove spaces around the -> return arrow
    6. Float literal compaction: 0.5->.5  1.0->1.
    7. Trim leading/trailing whitespace

    Safe because WGSL has no string literals and whitespace is not semantic.
    """
    content = _RE_WGSL_BLOCK_CMT.sub(' ', content)        # block comments -> space
    content = _RE_WGSL_LINE_CMT.sub('', content)           # line comments -> nothing
    content = _RE_WGSL_WS.sub(' ', content)                # all whitespace -> single space
    content = _RE_WGSL_PUNCT_SP.sub(r'\1', content)       # spaces around punct removed
    content = _RE_WGSL_ARROW_SP.sub('->', content)         # spaces around -> removed
    content = _RE_WGSL_FLOAT_LEAD.sub(r'\1', content)     # 0.5 -> .5
    content = _RE_WGSL_FLOAT_TRAIL.sub(r'\1.', content)   # 1.0 -> 1.
    return content.strip()


def preprocess_shader_source(source):
    """Strip // comments from WGSL template literals in a JS shader source file.

    Scans for backtick-delimited template literals that look like WGSL,
    strips their inline comments, and collapses triple+ blank lines.
    Leaves JS code and non-WGSL template literals untouched.
    """
    out = []
    i = 0
    n = len(source)
    in_single = False
    in_double = False
    escape_next = False

    while i < n:
        c = source[i]

        if escape_next:
            escape_next = False
            out.append(c)
            i += 1
            continue

        if c == '\\':
            escape_next = True
            out.append(c)
            i += 1
            continue

        if c == "'" and not in_double:
            in_single = not in_single
            out.append(c)
            i += 1
            continue

        if c == '"' and not in_single:
            in_double = not in_double
            out.append(c)
            i += 1
            continue

        # Detect start of template literal (backtick) outside regular strings
        if c == '`' and not in_single and not in_double:
            # Collect the full template literal — interpolation-aware so a
            # '}' inside an interpolated string can't desync the scanner and
            # swallow real JS as template content.
            end = template_literal_end(source, i)

            literal = source[i:end]
            # Only strip if content looks like WGSL
            inner = literal[1:-1] if len(literal) > 2 else ''
            if any(m in inner for m in _WGSL_CONTENT_MARKERS):
                inner_stripped = strip_wgsl_in_template_literal(inner)
                out.append('`')
                out.append(inner_stripped)
                out.append('`')
            else:
                out.append(literal)
            i = end
            continue

        out.append(c)
        i += 1

    return ''.join(out)
# ---- Production Optimizations -----------------------------------------------

# Console stripping: remove console.debug() statements (dev-only noise).
# Handles multi-line calls by tracking tokenized parenthesis depth.
# Preserves console.log/warn/info (needed by editor console panel) and
# console.error/assert (actual error reporting).
def strip_console_calls(source):
    """Remove console.debug(...) statements from source.

    Keep an undefined expression in place of each call so unbraced control
    flow, arrow bodies, and expression contexts retain valid syntax. Literal
    contents are opaque; templates are conservatively left intact.
    Returns source and the number of bytes saved.
    """
    result = []
    cursor = 0
    scanner = _CodeScanner(source)
    recent = deque(maxlen=5)
    while (token := scanner.next_code_token()) is not None:
        recent.append(token)
        if token.value != '(':
            continue
        items = list(recent)
        if [item.value for item in items[-4:]] != ['console', '.', 'debug', '(']:
            continue
        if len(items) == 5 and items[0].value in ('.', '?.'):
            continue
        start = items[-4].start
        depth = 1
        while depth:
            token = scanner.next_code_token()
            if token is None:
                raise ParseError(f'Unclosed console.debug call at byte {start}')
            if token.value == '(':
                depth += 1
            elif token.value == ')':
                depth -= 1
        result.extend((source[cursor:start], '(void 0)'))
        cursor = token.end
        recent.clear()
    result.append(source[cursor:])
    output = ''.join(result)
    return output, len(source) - len(output)


# HTML template literal minification
# Collapses whitespace inside backtick strings that contain HTML tags.
# Similar to WGSL stripping but for HTML: collapse runs of whitespace to single space,
# trim whitespace around < and > and between tags.
_RE_HTML_WS        = re.compile(r'[ \t\r\n]+')
_RE_HTML_TAG_WS    = re.compile(r'>\s+<')
_RE_HTML_OPEN_WS   = re.compile(r'>\s+')
_RE_HTML_CLOSE_WS  = re.compile(r'\s+<')
_HTML_TAG_MARKER   = re.compile(r'<[a-zA-Z/!]')

def minify_html_template(inner):
    """Preserve one HTML template body byte-for-byte.

    This legacy entry point intentionally shares the safe behavior of
    ``minify_html_in_template_literals``. HTML whitespace is content, not a
    generally removable formatting detail.
    """
    return inner


def minify_html_in_template_literals(source):
    """Preserve HTML template literals byte-for-byte.

    HTML whitespace can be observable (inline text, ``pre`` content, CSS, and
    custom elements), and a former quote-toggle scanner could pair unrelated
    backticks across modules and rewrite executable JavaScript.  The general
    JavaScript minifier already protects complete template literals.  Keep this
    compatibility hook as an explicit no-op until an HTML-aware optimizer can
    prove DOM equivalence rather than guessing from ``<`` characters.
    """
    return source, 0
