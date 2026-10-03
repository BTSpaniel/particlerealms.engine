# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""String-aware import path scanner for the JS bundler.

The regex-based extractor in bundler/graph.py was matching import/export
statements inside generated strings, JSDoc examples, and comments. This
small tokenizer skips those contexts so only real source imports are
returned as graph edges.
"""

from .parser import _CodeToken, _decode_js_string_token


def scan_import_paths(source):
    """Extract static and dynamic import paths from a JavaScript source.

    Returns a set of specifier strings. The parser skips line comments, block
    comments, single/double quoted strings, template literals, and regex
    literals.
    """
    paths = set()
    i = 0
    n = len(source)

    def _skip_line_comment(idx):
        while idx < n and source[idx] != '\n':
            idx += 1
        return idx

    def _skip_block_comment(idx):
        idx += 2
        while idx < n - 1 and not (source[idx] == '*' and source[idx + 1] == '/'):
            idx += 1
        return idx + 2

    def _skip_string(idx, quote):
        idx += 1
        while idx < n:
            c = source[idx]
            if c == '\\':
                idx += 2
                continue
            if c == quote:
                idx += 1
                break
            idx += 1
        return idx

    def _skip_template(idx):
        idx += 1
        depth = 0
        while idx < n:
            c = source[idx]
            if c == '\\':
                idx += 2
                continue
            if c == '$' and idx + 1 < n and source[idx + 1] == '{' and depth == 0:
                idx += 2
                depth += 1
                continue
            if c == '{' and depth > 0:
                depth += 1
            elif c == '}' and depth > 0:
                depth -= 1
            elif c == '`' and depth == 0:
                idx += 1
                break
            idx += 1
        return idx

    def _skip_whitespace_and_comments(idx):
        while idx < n:
            c = source[idx]
            if c in ' \t\r\n':
                idx += 1
                continue
            if c == '/' and idx + 1 < n:
                if source[idx + 1] == '/':
                    idx = _skip_line_comment(idx)
                    continue
                if source[idx + 1] == '*':
                    idx = _skip_block_comment(idx)
                    continue
            break
        return idx

    def _read_identifier(idx):
        while idx < n and (source[idx].isalnum() or source[idx] in '_$'):
            idx += 1
        return idx

    def _read_token(idx):
        idx = _skip_whitespace_and_comments(idx)
        if idx >= n:
            return ('EOF', None, idx)
        c = source[idx]
        if c == '{' or c == '}':
            return ('BRACE', c, idx + 1)
        if c == '(' or c == ')':
            return ('PAREN', c, idx + 1)
        if c == ',':
            return ('COMMA', c, idx + 1)
        if c == '*':
            return ('STAR', c, idx + 1)
        if c == ';':
            return ('SEMI', c, idx + 1)
        if c == '.':
            return ('DOT', c, idx + 1)
        if c == "'" or c == '"':
            end = _skip_string(idx, c)
            token = _CodeToken('string', None, idx, end)
            return ('STR', _decode_js_string_token(source, token), end)
        if c == '`':
            start = idx + 1
            end = _skip_template(idx)
            return ('TEMPLATE', source[start:end - 1], end)
        if c.isalpha() or c == '_' or c == '$':
            start = idx
            end = _read_identifier(idx)
            word = source[start:end]
            return ('ID', word, end)
        return ('OTHER', c, idx + 1)

    def _consume_balanced_braces(idx):
        depth = 1
        while depth > 0:
            tok, val, idx = _read_token(idx)
            if tok == 'EOF':
                return idx
            if tok == 'BRACE':
                if val == '{':
                    depth += 1
                elif val == '}':
                    depth -= 1
        return idx

    def _parse_import(idx):
        tok, val, idx = _read_token(idx)
        if tok == 'STR':
            return idx, val
        if tok == 'STAR':
            tok, val, idx = _read_token(idx)
            if tok == 'ID' and val == 'as':
                tok, val, idx = _read_token(idx)
                tok, val, idx = _read_token(idx)
                if tok == 'ID' and val == 'from':
                    tok, val, idx = _read_token(idx)
                    if tok == 'STR':
                        return idx, val
            return idx, None
        if tok == 'BRACE' and val == '{':
            idx = _consume_balanced_braces(idx)
            tok, val, idx = _read_token(idx)
            if tok == 'ID' and val == 'from':
                tok, val, idx = _read_token(idx)
                if tok == 'STR':
                    return idx, val
            return idx, None
        if tok == 'ID':
            tok, val, idx = _read_token(idx)
            if tok == 'ID' and val == 'from':
                tok, val, idx = _read_token(idx)
                if tok == 'STR':
                    return idx, val
                return idx, None
            if tok == 'COMMA':
                tok, val, idx = _read_token(idx)
                if tok == 'STAR':
                    tok, val, idx = _read_token(idx)
                    if tok == 'ID' and val == 'as':
                        tok, val, idx = _read_token(idx)
                elif tok == 'BRACE' and val == '{':
                    idx = _consume_balanced_braces(idx)
                tok, val, idx = _read_token(idx)
                if tok == 'ID' and val == 'from':
                    tok, val, idx = _read_token(idx)
                    if tok == 'STR':
                        return idx, val
            return idx, None
        if tok == 'PAREN' and val == '(':
            tok, val, idx = _read_token(idx)
            if tok == 'STR':
                path = val
                tok, val, idx = _read_token(idx)
                if tok == 'PAREN' and val == ')':
                    return idx, path
            return idx, None
        return idx, None

    def _parse_export(idx):
        tok, val, idx = _read_token(idx)
        if tok == 'STAR':
            tok, val, idx = _read_token(idx)
            if tok == 'ID' and val == 'as':
                tok, val, idx = _read_token(idx)
                tok, val, idx = _read_token(idx)
            if tok == 'ID' and val == 'from':
                tok, val, idx = _read_token(idx)
                if tok == 'STR':
                    return idx, val
            return idx, None
        if tok == 'BRACE' and val == '{':
            idx = _consume_balanced_braces(idx)
            tok, val, idx = _read_token(idx)
            if tok == 'ID' and val == 'from':
                tok, val, idx = _read_token(idx)
                if tok == 'STR':
                    return idx, val
            return idx, None
        return idx, None

    while i < n:
        c = source[i]
        if c == '/' and i + 1 < n:
            if source[i + 1] == '/':
                i = _skip_line_comment(i)
                continue
            if source[i + 1] == '*':
                i = _skip_block_comment(i)
                continue
            if i == 0 or source[i - 1] in '(,=[:;!?&|~*+-%^{[':
                i += 1
                while i < n and source[i] != '/':
                    if source[i] == '\\':
                        i += 2
                        continue
                    i += 1
                i += 1
                continue
        if c == "'" or c == '"':
            i = _skip_string(i, c)
            continue
        if c == '`':
            i = _skip_template(i)
            continue
        if c.isalpha() or c == '_' or c == '$':
            start = i
            i = _read_identifier(i)
            word = source[start:i]
            if word == 'import':
                i, path = _parse_import(i)
                if path is not None:
                    paths.add(path)
                continue
            if word == 'export':
                i, path = _parse_export(i)
                if path is not None:
                    paths.add(path)
                continue
            continue
        i += 1

    return paths
