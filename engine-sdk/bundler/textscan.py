# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""bundler.textscan — string/template-literal character scanners shared by transforms."""


def _string_literal_end(source, k):
    """source[k] is a quote char; return index just past the closing quote."""
    q = source[k]
    n = len(source)
    k += 1
    while k < n:
        ch = source[k]
        if ch == '\\':
            k += 2
            continue
        if ch == q:
            return k + 1
        k += 1
    return n


def _interpolation_end(source, k):
    """source[k] is just past '${'; return index just past the matching '}'.

    Correctly skips strings and nested template literals so that a '}' inside
    an interpolated string (e.g. `${cond ? '}' : ''}`) does not prematurely
    close the interpolation.
    """
    n = len(source)
    depth = 1
    while k < n:
        ch = source[k]
        if ch == '\\':
            k += 2
            continue
        if ch == "'" or ch == '"':
            k = _string_literal_end(source, k)
            continue
        if ch == '`':
            k = template_literal_end(source, k)
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return k + 1
        k += 1
    return n


def template_literal_end(source, i):
    """source[i] is a backtick; return index just past the matching closing
    backtick, correctly skipping ${...} interpolations (which may themselves
    contain strings, nested template literals, and braces).

    The naive `{`/`}`-only depth counter that previously lived inline desynced
    on interpolations like `${a ? '}' : ''}` and could swallow large spans of
    real JS as template "content".
    """
    n = len(source)
    k = i + 1
    while k < n:
        ch = source[k]
        if ch == '\\':
            k += 2
            continue
        if ch == '`':
            return k + 1
        if ch == '$' and k + 1 < n and source[k + 1] == '{':
            k = _interpolation_end(source, k + 2)
            continue
        k += 1
    return n
