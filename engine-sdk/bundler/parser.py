# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""bundler.parser — a small tokenizer-based JS import/export scanner.

This is the first step toward Phase 6 "Parsers and canonical emitters".
It replaces regex-based import extraction with a state machine that skips
strings, comments, regular expressions, and template literals so false
positives inside those constructs cannot be matched.

It does not build a full AST; it records only the bindings a module needs
(exports, imports, and re-exports) and the module specifiers it depends on.
"""

import re
from collections import deque
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple, Union


_LINE_TERMINATORS = "\r\n\u2028\u2029"
_SCANNER_WHITESPACE = " \t" + _LINE_TERMINATORS


@dataclass
class Import:
    """A single import statement."""
    spec: str
    default: Optional[str] = None
    namespace: Optional[str] = None
    named: List[str] = field(default_factory=list)
    is_dynamic: bool = False
    source: str = ""  # original statement text (trimmed)
    start: int = 0
    end: int = 0


@dataclass
class Export:
    """A single export statement."""
    spec: str = ""
    default: bool = False
    declaration: Optional[str] = None
    named: List[str] = field(default_factory=list)
    reexport: bool = False
    namespace: Optional[str] = None
    source: str = ""
    start: int = 0
    end: int = 0


class ParseError(Exception):
    """Raised when a construct is malformed enough to break the scanner."""
    pass


RegistryKey = Union[int, str]


@dataclass(frozen=True)
class ModuleWrapper:
    """One canonical assignment in the emitted module registry.

    The offsets delimit the factory body without its surrounding braces.  They
    intentionally point into the original source so callers can validate code
    in the correct entry wrapper without copying a production-sized bundle.
    """

    key: RegistryKey
    assignment_start: int
    body_start: int
    body_end: int
    factory_kind: str

    def body(self, source: str) -> str:
        """Return this wrapper's factory body from *source*."""
        return source[self.body_start:self.body_end]

    def has_export(self, source: str, symbol: str) -> bool:
        """Return whether this wrapper directly assigns ``__e.<symbol>``."""
        if not _is_binding_identifier(symbol):
            raise ValueError(f"Invalid JavaScript export identifier: {symbol!r}")
        return contains_code_token_sequence(
            source,
            ("__e", ".", symbol, "="),
            start=self.body_start,
            end=self.body_end,
            brace_depth=0,
        )

    def reexport_keys(self, source: str) -> Tuple[RegistryKey, ...]:
        """Return direct ``Object.assign(__e,__r(key))`` dependencies."""
        tokens = tuple(_iter_code_tokens(
            source,
            start=self.body_start,
            end=self.body_end,
            max_brace_depth=0,
        ))
        prefix = ("Object", ".", "assign", "(", "__e", ",", "__r", "(")
        suffix = (")", ")")
        keys = []
        for index in range(0, len(tokens) - len(prefix) - len(suffix)):
            candidate = tokens[index:index + len(prefix)]
            if any(token.brace_depth != 0 for token in candidate):
                continue
            if tuple(token.value for token in candidate) != prefix:
                continue
            key_token = tokens[index + len(prefix)]
            after_key = tokens[index + len(prefix) + 1:index + len(prefix) + 3]
            if key_token.brace_depth != 0 or tuple(token.value for token in after_key) != suffix:
                continue
            if key_token.kind == "number" and re.fullmatch(r"[0-9]+", key_token.value or ""):
                key: RegistryKey = int(key_token.value)
            elif key_token.kind == "string":
                key = _decode_js_string_token(source, key_token)
            else:
                continue
            keys.append(key)
        return tuple(keys)


@dataclass(frozen=True)
class ModuleRegistry:
    """Canonical outer-IIFE module registry extracted from a final bundle."""

    declaration_start: int
    declaration_end: int
    iife_body_start: int
    iife_body_end: int
    wrappers: Tuple[ModuleWrapper, ...]
    _outer_values: Tuple[Optional[str], ...] = field(repr=False)

    @property
    def keys(self) -> Tuple[RegistryKey, ...]:
        """Return registry keys in emitted assignment order."""
        return tuple(wrapper.key for wrapper in self.wrappers)

    def wrapper_for(self, key: RegistryKey) -> ModuleWrapper:
        """Return the wrapper for *key*, raising ``KeyError`` when absent."""
        normalized = str(key)
        for wrapper in self.wrappers:
            if str(wrapper.key) == normalized:
                return wrapper
        raise KeyError(key)

    def has_outer_code_sequence(self, source: str, sequence: Sequence[str]) -> bool:
        """Check for a code-only token sequence directly in the outer IIFE."""
        return contains_code_token_sequence(
            source,
            sequence,
            start=self.iife_body_start,
            end=self.iife_body_end,
            brace_depth=0,
        )

    def outer_token_values(self, source: Optional[str] = None) -> Tuple[Optional[str], ...]:
        """Return cached direct outer-IIFE code token values.

        Opaque literal tokens are represented by ``None`` so searches cannot
        bridge across them or mistake literal text for executable code.  The
        optional source parameter is accepted for symmetry with wrapper APIs;
        extraction already performed the only production-sized scan.
        """
        return self._outer_values


class _Scanner:
    """Token scanner that exposes a stream of meaningful tokens and skips
    comments, strings, regexes, and template literals."""

    def __init__(self, source: str):
        self.source = source
        self.pos = 0
        self.length = len(source)
        self.token_start = 0

    def skip_whitespace(self):
        while self.pos < self.length and self.source[self.pos] in _SCANNER_WHITESPACE:
            self.pos += 1

    def peek(self, offset: int = 0) -> str:
        idx = self.pos + offset
        return self.source[idx] if idx < self.length else ""

    def _match_comment(self) -> bool:
        if self.peek(0) == "/" and self.peek(1) == "/":
            while self.pos < self.length and self.source[self.pos] not in _LINE_TERMINATORS:
                self.pos += 1
            return True
        if self.peek(0) == "/" and self.peek(1) == "*":
            self.pos += 2
            while self.pos < self.length - 1:
                if self.source[self.pos] == "*" and self.source[self.pos + 1] == "/":
                    self.pos += 2
                    return True
                self.pos += 1
            raise ParseError("Unterminated block comment")
        return False

    def _match_string(self) -> bool:
        quote = self.peek(0)
        if quote not in "'\"`":
            return False
        if quote == "`":
            self._skip_template_literal()
            return True
        self.pos += 1
        while self.pos < self.length:
            ch = self.source[self.pos]
            if ch == "\\":
                self.pos += 1
                if self.peek() == "\r" and self.peek(1) == "\n":
                    self.pos += 2
                else:
                    self.pos += 1
                continue
            if ch == quote:
                self.pos += 1
                return True
            if ch in "\r\n":
                raise ParseError(f"Unterminated string literal at byte {self.token_start}")
            self.pos += 1
        raise ParseError(f"Unterminated string literal at byte {self.token_start}")

    def _skip_template_literal(self):
        """Skip one complete template literal, including nested interpolations."""
        start = self.pos
        self.pos += 1  # opening backtick
        while self.pos < self.length:
            ch = self.source[self.pos]
            if ch == "\\":
                self.pos += 2
                continue
            if ch == "`":
                self.pos += 1
                return
            if ch == "$" and self.peek(1) == "{":
                self.pos += 2
                self._skip_template_expression(start)
                continue
            self.pos += 1
        raise ParseError(f"Unterminated template literal at byte {start}")

    def _skip_template_expression(self, template_start):
        depth = 1
        while self.pos < self.length and depth:
            ch = self.source[self.pos]
            if ch == "\\":
                self.pos += 2
                continue
            if ch in "'\"":
                saved_start = self.token_start
                self.token_start = self.pos
                self._match_string()
                self.token_start = saved_start
                continue
            if ch == "`":
                self._skip_template_literal()
                continue
            if ch == "/" and self.peek(1) == "/":
                while self.pos < self.length and self.source[self.pos] not in _LINE_TERMINATORS:
                    self.pos += 1
                continue
            if ch == "/" and self.peek(1) == "*":
                self.pos += 2
                while self.pos < self.length - 1 and self.source[self.pos:self.pos + 2] != "*/":
                    self.pos += 1
                self.pos += 2
                continue
            if ch == "/":
                saved_start = self.token_start
                self.token_start = self.pos
                matched_regex = self._match_regex()
                self.token_start = saved_start
                if matched_regex:
                    continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            self.pos += 1
        if depth:
            raise ParseError(f"Unterminated template interpolation at byte {template_start}")

    def _match_regex(self, *, expression_start: bool = False) -> bool:
        if self.peek(0) != "/":
            return False
        start = self.pos
        # Avoid confusing / with division. We only treat it as a regex when
        # the previous non-whitespace character is one of these tokens.
        # This is a conservative heuristic, not a full parser.
        prev = ""
        prev_index = -1
        for i in range(self.pos - 1, -1, -1):
            if self.source[i] not in _SCANNER_WHITESPACE:
                prev = self.source[i]
                prev_index = i
                break
        if not expression_start and prev and (prev.isalnum() or prev in "_$"):
            word_start = prev_index
            while word_start >= 0 and (self.source[word_start].isalnum() or self.source[word_start] in "_$"):
                word_start -= 1
            previous_word = self.source[word_start + 1:prev_index + 1]
            if previous_word not in {"return", "case", "throw", "yield", "await", "else", "do", "typeof", "instanceof", "in", "of", "delete", "void", "new"}:
                return False
        elif not expression_start and prev and prev not in "(,=:[!&|?;{}[>":
            return False
        self.pos += 1
        while self.pos < self.length:
            ch = self.source[self.pos]
            if ch == "\\":
                self.pos += 2
                continue
            if ch in _LINE_TERMINATORS:
                self.pos = start
                return False
            if ch == "/":
                self.pos += 1
                # consume flags
                while self.pos < self.length and self.source[self.pos].isalpha():
                    self.pos += 1
                return True
            if ch == "[":
                while self.pos < self.length and self.source[self.pos] != "]":
                    if self.source[self.pos] == "\\":
                        self.pos += 1
                    self.pos += 1
                if self.pos < self.length:
                    self.pos += 1
                continue
            self.pos += 1
        self.pos = start
        return False

    def next_token(self) -> str:
        """Return the next token, skipping whitespace and comments."""
        while self.pos < self.length:
            self.skip_whitespace()
            if self.pos >= self.length:
                break
            if self._match_comment():
                continue
            self.token_start = self.pos
            if self._match_string():
                continue
            if self._match_regex():
                continue
            ch = self.source[self.pos]
            if ch in "{}(),;*:\"<>=!&|+-*/%[].":
                # Multi-char punctuation
                if ch == "." and self.peek(1) == "." and self.peek(2) == ".":
                    self.pos += 3
                    return "..."
                self.pos += 1
                return ch
            if re.match(r"[A-Za-z0-9_$]", ch):
                start = self.pos
                while self.pos < self.length and re.match(r"[A-Za-z0-9_$]", self.source[self.pos]):
                    self.pos += 1
                return self.source[start:self.pos]
            # Any other single character is treated as a token of one char.
            self.pos += 1
            return ch
        return ""


@dataclass(frozen=True)
class _CodeToken:
    """A JavaScript token with its source range and lexical brace depth."""

    kind: str
    value: Optional[str]
    start: int
    end: int
    brace_depth: int = 0


class _CodeScanner(_Scanner):
    """Tokenize code while keeping literals opaque.

    Comments disappear completely.  Strings, regular expressions, and
    templates become one opaque token each, preventing their contents from
    impersonating registry code while still keeping token boundaries intact.
    """

    _PUNCTUATION_BY_INITIAL = {
        ">": (">>>=", ">>=", ">>>", ">>", ">="),
        "=": ("===", "=>", "=="),
        "!": ("!==", "!="),
        "*": ("**=", "**", "*="),
        "&": ("&&=", "&&", "&="),
        "|": ("||=", "||", "|="),
        "?": ("??=", "??", "?."),
        "<": ("<<=", "<<", "<="),
        ".": ("...",),
        "+": ("++", "+="),
        "-": ("--", "-="),
        "/": ("/=",),
        "%": ("%=",),
        "^": ("^=",),
    }

    def __init__(self, source: str, start: int = 0, end: Optional[int] = None):
        super().__init__(source)
        self.pos = start
        self.length = len(source) if end is None else end

    def _read_string_token(self) -> _CodeToken:
        start = self.pos
        quote = self.source[self.pos]
        self.pos += 1
        while self.pos < self.length:
            ch = self.source[self.pos]
            if ch == "\\":
                self.pos += 1
                if self.pos >= self.length:
                    break
                if self.source[self.pos] == "\r" and self.pos + 1 < self.length and self.source[self.pos + 1] == "\n":
                    self.pos += 2
                else:
                    self.pos += 1
                continue
            if ch == quote:
                self.pos += 1
                return _CodeToken("string", None, start, self.pos)
            if ch in "\r\n":
                raise ParseError(f"Unterminated string literal at byte {start}")
            self.pos += 1
        raise ParseError(f"Unterminated string literal at byte {start}")

    def next_code_token(self) -> Optional[_CodeToken]:
        """Return the next code token, or ``None`` at the configured end."""
        while self.pos < self.length:
            self.skip_whitespace()
            if self.pos >= self.length:
                return None
            self.token_start = self.pos
            if self._match_comment():
                continue

            start = self.pos
            ch = self.source[self.pos]
            if ch in "'\"":
                return self._read_string_token()
            if ch == "`":
                self._skip_template_literal()
                return _CodeToken("template", None, start, self.pos)
            if self._match_regex():
                return _CodeToken("regex", None, start, self.pos)

            if ch.isalpha() or ch in "_$":
                self.pos += 1
                while self.pos < self.length:
                    current = self.source[self.pos]
                    if not (current.isalnum() or current in "_$"):
                        break
                    self.pos += 1
                return _CodeToken("identifier", self.source[start:self.pos], start, self.pos)

            if ch.isdigit():
                self.pos += 1
                while self.pos < self.length and self.source[self.pos].isdigit():
                    self.pos += 1
                return _CodeToken("number", self.source[start:self.pos], start, self.pos)

            for punctuation in self._PUNCTUATION_BY_INITIAL.get(ch, ()):
                if self.source.startswith(punctuation, self.pos, self.length):
                    self.pos += len(punctuation)
                    return _CodeToken("punctuation", punctuation, start, self.pos)

            self.pos += 1
            return _CodeToken("punctuation", ch, start, self.pos)
        return None


def _iter_code_tokens(
    source: str,
    *,
    start: int = 0,
    end: Optional[int] = None,
    max_brace_depth: Optional[int] = None,
):
    """Yield opaque-literal code tokens, optionally omitting deeper blocks."""
    source_end = len(source) if end is None else end
    if start < 0 or source_end < start or source_end > len(source):
        raise ValueError("Invalid source tokenization range")

    scanner = _CodeScanner(source, start, source_end)
    brace_depth = 0
    while True:
        token = scanner.next_code_token()
        if token is None:
            break

        if token.value == "}":
            brace_depth -= 1
            if brace_depth < 0:
                raise ParseError(f"Unexpected }} at byte {token.start}")

        token = _CodeToken(token.kind, token.value, token.start, token.end, brace_depth)
        if max_brace_depth is None or brace_depth <= max_brace_depth:
            yield token

        if token.value == "{":
            brace_depth += 1

    if brace_depth:
        raise ParseError(f"Unterminated {{ block in source range starting at byte {start}")


def find_default_export_declaration(
    source: str,
    expression_start: int,
) -> Optional[Tuple[int, Optional[str]]]:
    """Return ``(end, binding)`` for a default class/function declaration.

    Canonical emission rewrites ``export default class`` and ``export default
    function`` declarations into assignment expressions.  Assignment
    expressions need an explicit statement terminator before whitespace
    minification can safely join the following declaration.  This helper finds
    the declaration body's closing brace without mistaking braces in parameter
    patterns, ``extends`` expressions, strings, templates, or regular
    expressions for that boundary.

    A named declaration's binding is returned so the emitter can preserve its
    module-local declaration semantics.  Anonymous declarations return a null
    binding.  ``None`` means the default export is an ordinary expression.
    """
    if expression_start < 0 or expression_start > len(source):
        raise ValueError("Invalid default export expression offset")

    tokens = iter(_iter_code_tokens(source, start=expression_start))
    declaration_token = next(tokens, None)
    if declaration_token is None:
        return None
    if declaration_token.value == "async":
        declaration_token = next(tokens, None)
        if declaration_token is None or declaration_token.value != "function":
            return None
    elif declaration_token.value not in {"class", "function"}:
        return None

    kind = declaration_token.value
    pending = next(tokens, None)
    if kind == "function" and pending is not None and pending.value == "*":
        pending = next(tokens, None)

    binding = None
    if pending is not None and pending.kind == "identifier":
        if kind == "function" or pending.value != "extends":
            binding = pending.value
            pending = next(tokens, None)

    paren_depth = 0
    bracket_depth = 0
    body_started = False
    while pending is not None:
        token = pending
        pending = next(tokens, None)
        value = token.value
        if not body_started:
            if value == "(":
                paren_depth += 1
            elif value == ")":
                paren_depth = max(paren_depth - 1, 0)
            elif value == "[":
                bracket_depth += 1
            elif value == "]":
                bracket_depth = max(bracket_depth - 1, 0)
            elif (
                value == "{"
                and token.brace_depth == 0
                and paren_depth == 0
                and bracket_depth == 0
            ):
                body_started = True
            continue

        if value == "}" and token.brace_depth == 0:
            return token.end, binding

    raise ParseError(
        f"Unterminated default-exported {kind} declaration at byte {declaration_token.start}"
    )


def find_code_token_sequence(
    source: str,
    sequence: Sequence[str],
    *,
    start: int = 0,
    end: Optional[int] = None,
    brace_depth: Optional[int] = None,
) -> Optional[Tuple[int, int]]:
    """Return the source range of an exact code-only token sequence.

    Literal bodies and comments can never satisfy the sequence.  When
    ``brace_depth`` is provided, every token must occur at exactly that depth
    relative to the supplied source range.
    """
    expected = tuple(sequence)
    if not expected:
        raise ValueError("Code token sequence must not be empty")
    if any(not isinstance(value, str) or not value for value in expected):
        raise ValueError("Code token sequence values must be non-empty strings")

    window = deque(maxlen=len(expected))
    max_depth = brace_depth
    for token in _iter_code_tokens(
        source,
        start=start,
        end=end,
        max_brace_depth=max_depth,
    ):
        if brace_depth is not None and token.brace_depth != brace_depth:
            continue
        window.append(token)
        if len(window) != len(expected):
            continue
        if all(item.value == value for item, value in zip(window, expected)):
            return window[0].start, window[-1].end
    return None


def contains_code_token_sequence(
    source: str,
    sequence: Sequence[str],
    *,
    start: int = 0,
    end: Optional[int] = None,
    brace_depth: Optional[int] = None,
) -> bool:
    """Return whether an exact code-only token sequence exists."""
    return find_code_token_sequence(
        source,
        sequence,
        start=start,
        end=end,
        brace_depth=brace_depth,
    ) is not None


def contains_token_value_sequence(
    token_values: Sequence[Optional[str]],
    sequence: Sequence[str],
) -> bool:
    """Search a previously tokenized code-value stream for an exact sequence."""
    expected = tuple(sequence)
    if not expected:
        raise ValueError("Code token sequence must not be empty")
    if any(not isinstance(value, str) or not value for value in expected):
        raise ValueError("Code token sequence values must be non-empty strings")
    limit = len(token_values) - len(expected) + 1
    return any(tuple(token_values[index:index + len(expected)]) == expected for index in range(max(0, limit)))


class _TemplateRegionScanner(_Scanner):
    """Scanner variant that records complete, non-overlapping templates."""

    def __init__(self, source: str):
        super().__init__(source)
        self.template_regions = []
        self._template_depth = 0

    def _skip_template_literal(self):
        start = self.pos
        outermost = self._template_depth == 0
        self._template_depth += 1
        try:
            super()._skip_template_literal()
        finally:
            self._template_depth -= 1
        if outermost:
            self.template_regions.append((start, self.pos))


def find_template_literal_regions(source: str):
    """Return complete outer template literal ranges using the JS scanner."""
    scanner = _TemplateRegionScanner(source)
    while scanner.pos < scanner.length:
        scanner.next_token()
    return tuple(scanner.template_regions)


def _decode_js_string_token(source: str, token: _CodeToken) -> str:
    """Decode a quoted strict JavaScript string without evaluating its source."""
    literal = source[token.start:token.end]
    if len(literal) < 2 or literal[0] not in "'\"" or literal[-1] != literal[0]:
        raise ParseError(f"Malformed registry string key at byte {token.start}")

    escapes = {
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "v": "\v",
        "0": "\0",
    }
    value = []
    index = 1
    limit = len(literal) - 1
    while index < limit:
        ch = literal[index]
        if ch != "\\":
            if ch in "\r\n":
                raise ParseError(f"Unterminated string literal at byte {token.start}")
            value.append(ch)
            index += 1
            continue

        index += 1
        if index >= limit:
            raise ParseError(f"Malformed registry string escape at byte {token.start}")
        escaped = literal[index]
        if escaped in _LINE_TERMINATORS:
            if escaped == "\r" and index + 1 < limit and literal[index + 1] == "\n":
                index += 1
            index += 1
            continue
        if escaped == "x":
            digits = literal[index + 1:index + 3]
            if len(digits) != 2 or not re.fullmatch(r"[0-9A-Fa-f]{2}", digits):
                raise ParseError(f"Malformed hexadecimal registry key escape at byte {token.start}")
            value.append(chr(int(digits, 16)))
            index += 3
            continue
        if escaped == "u":
            if index + 1 < limit and literal[index + 1] == "{":
                closing = literal.find("}", index + 2, limit)
                digits = literal[index + 2:closing] if closing >= 0 else ""
                if not digits or not re.fullmatch(r"[0-9A-Fa-f]+", digits):
                    raise ParseError(f"Malformed Unicode registry key escape at byte {token.start}")
                codepoint = int(digits, 16)
                if codepoint > 0x10FFFF:
                    raise ParseError(f"Out-of-range Unicode registry key escape at byte {token.start}")
                value.append(chr(codepoint))
                index = closing + 1
                continue
            digits = literal[index + 1:index + 5]
            if len(digits) != 4 or not re.fullmatch(r"[0-9A-Fa-f]{4}", digits):
                raise ParseError(f"Malformed Unicode registry key escape at byte {token.start}")
            value.append(chr(int(digits, 16)))
            index += 5
            continue

        if escaped in "123456789" or (escaped == "0" and index + 1 < limit and literal[index + 1] in "0123456789"):
            raise ParseError(f"Malformed strict string decimal escape at byte {token.start}")
        value.append(escapes.get(escaped, escaped))
        index += 1
    # JavaScript strings use UTF-16 code units. Adjacent surrogate escapes and
    # one code-point escape must identify the same filesystem/URL specifier.
    return "".join(value).encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def _delimiter_matches(tokens: Sequence[_CodeToken]):
    """Return matching delimiter indexes for a low-depth token stream."""
    opening_for = {")": "(", "]": "[", "}": "{"}
    stack = []
    matches = {}
    for index, token in enumerate(tokens):
        value = token.value
        if value in ("(", "[", "{"):
            stack.append((value, index))
            continue
        if value not in opening_for:
            continue
        if not stack or stack[-1][0] != opening_for[value]:
            raise ParseError(f"Mismatched {value} at byte {token.start}")
        _, opening_index = stack.pop()
        matches[opening_index] = index
        matches[index] = opening_index
    if stack:
        value, index = stack[-1]
        raise ParseError(f"Unterminated {value} at byte {tokens[index].start}")
    return matches


def _find_outer_iifes(tokens: Sequence[_CodeToken], matches):
    """Return canonical anonymous outer-IIFE body delimiter indexes."""
    iifes = []
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value != "function" or token.brace_depth != 0:
            continue
        if index == 0 or tokens[index - 1].value != "(" or tokens[index - 1].brace_depth != 0:
            continue
        if index + 1 >= len(tokens) or tokens[index + 1].value != "(":
            continue

        group_open = index - 1
        parameters_open = index + 1
        parameters_close = matches.get(parameters_open)
        if parameters_close is None or parameters_close + 1 >= len(tokens):
            continue
        body_open = parameters_close + 1
        if tokens[body_open].value != "{" or tokens[body_open].brace_depth != 0:
            continue
        body_close = matches.get(body_open)
        if body_close is None:
            continue
        group_close = body_close + 1
        if matches.get(group_open) != group_close:
            continue
        invocation_open = group_close + 1
        if invocation_open >= len(tokens) or tokens[invocation_open].value != "(":
            continue
        if matches.get(invocation_open) is None:
            continue
        iifes.append((body_open, body_close))
    return iifes


def _canonical_registry_declarations(tokens, matches, iifes):
    """Return valid declarations and malformed direct declaration offsets."""
    declarations = []
    malformed = []
    for body_open, body_close in iifes:
        body_depth = tokens[body_open].brace_depth + 1
        for index in range(body_open + 1, body_close):
            token = tokens[index]
            if token.brace_depth != body_depth or token.value not in ("var", "let", "const"):
                continue
            if index + 1 >= body_close or tokens[index + 1].value != "__modules":
                continue

            expected = ("var", "__modules", "=", "{", "}", ";")
            candidate = tokens[index:index + len(expected)]
            is_canonical = (
                len(candidate) == len(expected)
                and all(item.brace_depth == body_depth for item in candidate)
                and tuple(item.value for item in candidate) == expected
                and matches.get(index + 3) == index + 4
            )
            if is_canonical:
                declarations.append((body_open, body_close, index))
            else:
                malformed.append(token.start)
    return declarations, malformed


def _parse_registry_wrapper(source, tokens, matches, index, body_close):
    """Parse one exact-depth canonical wrapper assignment."""
    token = tokens[index]
    depth = token.brace_depth
    if index == 0 or tokens[index - 1].value not in (";", "}"):
        raise ParseError(f"Registry wrapper is not a standalone statement at byte {token.start}")
    if index + 4 >= body_close or tokens[index + 1].value != "[":
        raise ParseError(f"Malformed registry access at byte {token.start}")

    bracket_close = matches.get(index + 1)
    if bracket_close != index + 3 or tokens[index + 2].brace_depth != depth:
        raise ParseError(f"Registry key must be one string or decimal integer at byte {token.start}")
    key_token = tokens[index + 2]
    if key_token.kind == "number" and re.fullmatch(r"[0-9]+", key_token.value or ""):
        key: RegistryKey = int(key_token.value)
    elif key_token.kind == "string":
        key = _decode_js_string_token(source, key_token)
    else:
        raise ParseError(f"Unsupported registry key at byte {key_token.start}")

    equals_index = bracket_close + 1
    if equals_index >= body_close or tokens[equals_index].value != "=":
        raise ParseError(f"Registry access is not a factory assignment at byte {token.start}")
    factory_index = equals_index + 1
    if factory_index >= body_close:
        raise ParseError(f"Missing registry factory at byte {token.start}")

    function_header = ("function", "(", "__e", ",", "__r", ")", "{")
    arrow_header = ("(", "__e", ",", "__r", ")", "=>", "{")
    header = tokens[factory_index:factory_index + len(function_header)]
    values = tuple(item.value for item in header)
    if len(header) != len(function_header) or any(item.brace_depth != depth for item in header):
        raise ParseError(f"Truncated registry factory at byte {token.start}")
    if values == function_header:
        factory_kind = "function"
    elif values == arrow_header:
        factory_kind = "arrow"
    else:
        raise ParseError(f"Non-canonical registry factory at byte {token.start}")

    body_open_index = factory_index + len(function_header) - 1
    factory_body_close = matches.get(body_open_index)
    if factory_body_close is None or factory_body_close >= body_close:
        raise ParseError(f"Unterminated registry factory at byte {token.start}")
    terminator_index = factory_body_close + 1
    if terminator_index >= body_close or tokens[terminator_index].value != ";":
        raise ParseError(f"Registry factory lacks its canonical terminator at byte {token.start}")

    return ModuleWrapper(
        key=key,
        assignment_start=token.start,
        body_start=tokens[body_open_index].end,
        body_end=tokens[factory_body_close].start,
        factory_kind=factory_kind,
    )


def extract_canonical_module_registry(source: str) -> ModuleRegistry:
    """Extract the canonical module registry from a final emitted bundle.

    Only assignments directly inside the canonical anonymous outer IIFE count.
    Duplicate runtime keys, ambiguous declarations, and malformed direct
    registry assignments fail closed with ``ParseError``.
    """
    tokens = tuple(_iter_code_tokens(source, max_brace_depth=1))
    matches = _delimiter_matches(tokens)
    iifes = _find_outer_iifes(tokens, matches)
    declarations, malformed = _canonical_registry_declarations(tokens, matches, iifes)

    if malformed:
        raise ParseError(f"Malformed outer-IIFE __modules declaration at byte {malformed[0]}")
    if not declarations:
        raise ParseError("Canonical outer-IIFE 'var __modules={};' declaration not found")
    if len(declarations) != 1:
        raise ParseError(f"Ambiguous canonical module registries: found {len(declarations)} declarations")

    body_open, body_close, declaration_index = declarations[0]
    body_depth = tokens[body_open].brace_depth + 1
    declaration_end_index = declaration_index + 5
    wrappers = []
    seen_keys = {}

    for index in range(body_open + 1, body_close):
        token = tokens[index]
        if token.brace_depth != body_depth or token.value != "__modules":
            continue
        if index == declaration_index + 1:
            continue
        if index > 0 and tokens[index - 1].value == ".":
            continue
        if index + 1 >= body_close or tokens[index + 1].value != "[":
            if index + 1 < body_close and tokens[index + 1].value == "=":
                raise ParseError(f"Ambiguous __modules reassignment at byte {token.start}")
            continue
        if index <= declaration_end_index:
            raise ParseError(f"Registry wrapper precedes its declaration at byte {token.start}")

        wrapper = _parse_registry_wrapper(source, tokens, matches, index, body_close)
        normalized_key = str(wrapper.key)
        if normalized_key in seen_keys:
            raise ParseError(
                f"Duplicate registry key {wrapper.key!r} at byte {token.start}; "
                f"first assigned at byte {seen_keys[normalized_key]}"
            )
        seen_keys[normalized_key] = token.start
        wrappers.append(wrapper)

    return ModuleRegistry(
        declaration_start=tokens[declaration_index].start,
        declaration_end=tokens[declaration_end_index].end,
        iife_body_start=tokens[body_open].end,
        iife_body_end=tokens[body_close].start,
        wrappers=tuple(wrappers),
        _outer_values=tuple(
            token.value
            for token in tokens[body_open + 1:body_close]
            if token.brace_depth == body_depth
        ),
    )


def _parse_identifier_list(scanner: _Scanner) -> List[str]:
    """Parse a comma-separated list of identifiers from inside { ... }."""
    names = []
    token = scanner.next_token()
    if token != "{":
        raise ParseError(f"Expected {{, got {token}")
    while True:
        token = scanner.next_token()
        if token == "}":
            break
        if not token or token in ",":
            raise ParseError(f"Unexpected token in identifier list: {token}")
        name = token
        # optional alias:  foo as bar
        nxt = scanner.next_token()
        if nxt == "as":
            alias = scanner.next_token()
            if not alias:
                raise ParseError("Expected alias after 'as'")
            name = alias
            nxt = scanner.next_token()
        if nxt == ",":
            pass
        elif nxt == "}":
            names.append(name)
            break
        else:
            raise ParseError(f"Expected , or }}, got {nxt}")
        names.append(name)
    return names


def _read_until_statement_end(scanner: _Scanner, start_pos: int) -> str:
    """Return the original source text from start_pos up to the statement semicolon/newline."""
    while scanner.pos < scanner.length and scanner.source[scanner.pos] in " \t\r\n":
        scanner.pos += 1
    end = scanner.pos
    # Walk back to the end of the meaningful token
    while end > start_pos and scanner.source[end - 1] in " \t\r\n":
        end -= 1
    return scanner.source[start_pos:end]


def _is_binding_identifier(token: str) -> bool:
    """Return whether *token* can name a binding in the canonical emitter."""
    return bool(re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", token))


def _skip_binding_expression(scanner: _Scanner, closing_token: str) -> str:
    """Consume an expression until a top-level comma or pattern terminator."""
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    while True:
        token = scanner.next_token()
        if not token:
            raise ParseError(f"Unterminated binding expression; expected {closing_token}")
        if token in "([{":
            stack.append(token)
            continue
        if token in pairs:
            if stack:
                if stack[-1] != pairs[token]:
                    raise ParseError(f"Mismatched {token} in binding expression")
                stack.pop()
                continue
            if token == closing_token:
                return token
            raise ParseError(f"Unexpected {token} in binding expression")
        if token == "," and not stack:
            return token


def _parse_binding_pattern(scanner: _Scanner, first_token: str) -> List[str]:
    """Return every local identifier declared by one JS binding pattern."""
    if _is_binding_identifier(first_token):
        return [first_token]
    if first_token == "{":
        return _parse_object_binding_pattern(scanner)
    if first_token == "[":
        return _parse_array_binding_pattern(scanner)
    raise ParseError(f"Expected export binding identifier or pattern, got {first_token}")


def _parse_object_binding_pattern(scanner: _Scanner) -> List[str]:
    """Parse an object binding pattern after its opening brace."""
    names = []
    while True:
        token = scanner.next_token()
        if token == "}":
            return names
        if not token or token == ",":
            raise ParseError(f"Unexpected token in object binding pattern: {token}")

        if token == "...":
            target = scanner.next_token()
            names.extend(_parse_binding_pattern(scanner, target))
            delimiter = scanner.next_token()
        else:
            property_token = token
            if token == "[":
                if _skip_binding_expression(scanner, "]") != "]":
                    raise ParseError("Expected ] in computed binding property")
                property_token = ""
                delimiter = scanner.next_token()
            else:
                delimiter = scanner.next_token()

            if delimiter == ":":
                target = scanner.next_token()
                names.extend(_parse_binding_pattern(scanner, target))
                delimiter = scanner.next_token()
            elif _is_binding_identifier(property_token):
                names.append(property_token)
            else:
                raise ParseError(f"Expected : after binding property {property_token or '[computed]'}")

            if delimiter == "=":
                delimiter = _skip_binding_expression(scanner, "}")

        if delimiter == ",":
            continue
        if delimiter == "}":
            return names
        raise ParseError(f"Expected , or }} in object binding pattern, got {delimiter}")


def _parse_array_binding_pattern(scanner: _Scanner) -> List[str]:
    """Parse an array binding pattern after its opening bracket."""
    names = []
    while True:
        token = scanner.next_token()
        if token == "]":
            return names
        if token == ",":
            continue
        if not token:
            raise ParseError("Unterminated array binding pattern")

        if token == "...":
            token = scanner.next_token()
        names.extend(_parse_binding_pattern(scanner, token))
        delimiter = scanner.next_token()
        if delimiter == "=":
            delimiter = _skip_binding_expression(scanner, "]")
        if delimiter == ",":
            continue
        if delimiter == "]":
            return names
        raise ParseError(f"Expected , or ] in array binding pattern, got {delimiter}")


def _parse_variable_declaration_bindings(scanner: _Scanner, names: List[str]) -> List[str]:
    """Collect later declarators without consuming initializer import expressions.

    Keep the main scanner and its source offsets at the first binding. A separate
    token lookahead distinguishes declaration commas from nested expressions and
    stops at automatic semicolons instead of exporting the next statement's names.
    """
    lookahead = _CodeScanner(scanner.source, start=scanner.pos)
    names = list(names)
    pairs = {")": "(", "]": "[", "}": "{"}
    continuations = {
        ",", ".", "?.", "(", "[", "?", ":", "+", "-", "*", "/", "%", "**",
        "<", ">", "<=", ">=", "==", "!=", "===", "!==", "<<", ">>", ">>>",
        "&", "|", "^", "&&", "||", "??", "in", "instanceof", "=", "=>",
        "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=",
        "&=", "|=", "^=", "&&=", "||=", "??=",
    }
    prefixes = {"new", "typeof", "void", "delete", "await", "yield", "function", "class", "extends", "in", "instanceof"}
    stack = []
    previous = None
    previous_ends_expression = False
    in_initializer = False
    declaration_body_pending = False
    while (token := lookahead.next_code_token()) is not None:
        value = token.value
        if not stack:
            if value == ";":
                break
            if not in_initializer:
                if value == "=":
                    in_initializer = True
                    previous = token
                    previous_ends_expression = False
                    continue
                if value != ",":
                    break
            elif previous is not None:
                gap = scanner.source[previous.end:token.start]
                if (previous_ends_expression and any(char in gap for char in _LINE_TERMINATORS)
                        and value not in continuations and token.kind != "template"
                        and not declaration_body_pending):
                    break
            if value == ",":
                names.extend(_parse_binding_pattern(lookahead, lookahead.next_token()))
                in_initializer = False
                previous = None
                previous_ends_expression = False
                declaration_body_pending = False
                continue
            if value in {"function", "class"} and (previous is None or previous.value not in {".", "?."}):
                declaration_body_pending = True
            elif value == "{":
                declaration_body_pending = False
        if value in {"(", "[", "{"}:
            stack.append(value)
        elif value in pairs:
            if not stack or stack.pop() != pairs[value]:
                raise ParseError(f"Mismatched {value} in export initializer")
        previous_ends_expression = (
            token.kind in {"number", "string", "template", "regex"}
            or token.kind == "identifier" and (
                value not in prefixes or previous is not None and previous.value in {".", "?."}
            )
            or value in {")", "]", "}", "++", "--"}
        )
        previous = token
    return names


def parse_module(source: str) -> Tuple[List[Import], List[Export]]:
    """Parse a JS module and return (imports, exports)."""
    scanner = _Scanner(source)
    imports: List[Import] = []
    exports: List[Export] = []
    prior_token = ""

    while True:
        token = scanner.next_token()
        if token == "":
            break
        start_pos = scanner.token_start
        previous = prior_token
        prior_token = token
        if previous == "." and token in ("import", "export"):
            continue
        if token == "import":
            # dynamic import import('./path')
            nxt = scanner.next_token()
            if nxt == ".":
                # import.meta is an expression, not an import declaration.
                continue
            if nxt in (":", ",", "}"):
                # Object/class members may legally be named `import`.
                continue
            if nxt == "(":
                # Only string-literal dynamic imports can be resolved at build time.
                scanner.skip_whitespace()
                if not scanner.peek() or scanner.peek() not in "'\"":
                    _skip_balanced_parentheses(scanner)
                    continue
                spec = _read_string_literal(scanner)
                scanner.skip_whitespace()
                if scanner.peek() != ")":
                    raise ParseError("Expected ')' in dynamic import")
                scanner.pos += 1
                imports.append(Import(spec=spec, is_dynamic=True, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
                continue

            # Static import. Parse variants.
            if nxt == "{":
                scanner.pos = start_pos + len("import")
                scanner.skip_whitespace()
                scanner.pos += 1  # consume {
                named = _parse_named_imports(scanner)
                from_tok = scanner.next_token()
                if from_tok != "from":
                    raise ParseError("Expected 'from' in named import")
                spec = _read_string_literal(scanner)
                imports.append(Import(spec=spec, named=named, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
            elif nxt == "*":
                as_tok = scanner.next_token()
                if as_tok != "as":
                    raise ParseError("Expected 'as' in namespace import")
                namespace = scanner.next_token()
                from_tok = scanner.next_token()
                if from_tok != "from":
                    raise ParseError("Expected 'from' in namespace import")
                spec = _read_string_literal(scanner)
                imports.append(Import(spec=spec, namespace=namespace, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
            elif nxt and re.match(r"[A-Za-z_$]", nxt[0]):
                # default import or default + named
                default = nxt
                comma_or_from = scanner.next_token()
                named = []
                namespace = None
                if comma_or_from == ",":
                    token = scanner.next_token()
                    if token == "{":
                        named = _parse_named_imports(scanner)
                    elif token == "*":
                        if scanner.next_token() != "as":
                            raise ParseError("Expected 'as' in namespace import")
                        namespace = scanner.next_token()
                    else:
                        raise ParseError("Expected { or * after default import comma")
                    from_tok = scanner.next_token()
                else:
                    from_tok = comma_or_from
                if from_tok != "from":
                    raise ParseError("Expected 'from' in default import")
                spec = _read_string_literal(scanner)
                imports.append(Import(spec=spec, default=default, named=named, namespace=namespace, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
            else:
                # Side effect import: import 'path';  (next_token skipped the string literal)
                scanner.pos = start_pos + len("import")
                scanner.skip_whitespace()
                spec = _read_string_literal(scanner)
                imports.append(Import(spec=spec, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))

        elif token == "export":
            nxt = scanner.next_token()
            if nxt == "{":
                scanner.pos = start_pos + len("export")
                scanner.skip_whitespace()
                scanner.pos += 1
                named = _parse_named_exports(scanner)
                after_names = scanner.pos
                from_tok = scanner.next_token()
                if from_tok == "from":
                    spec = _read_string_literal(scanner)
                    exports.append(Export(spec=spec, named=named, reexport=True, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
                else:
                    scanner.pos = after_names
                    exports.append(Export(named=named, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
            elif nxt == "*":
                as_tok = scanner.next_token()
                namespace = None
                if as_tok == "as":
                    namespace = scanner.next_token()
                    from_tok = scanner.next_token()
                else:
                    from_tok = as_tok
                if from_tok != "from":
                    raise ParseError("Expected 'from' in export *")
                spec = _read_string_literal(scanner)
                exports.append(Export(spec=spec, reexport=True, namespace=namespace, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
            elif nxt == "default":
                exports.append(Export(default=True, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
                # Skip rest of the statement
                while scanner.pos < scanner.length and scanner.source[scanner.pos] not in ";\n":
                    scanner.pos += 1
            elif nxt in ("function", "class", "const", "let", "var", "async"):
                declaration = nxt
                if nxt == "async":
                    nxt2 = scanner.next_token()
                    if nxt2 == "function":
                        declaration = "async function"
                    else:
                        raise ParseError("Expected 'function' after async export")
                name = scanner.next_token()
                if name == "*" and declaration in ("function", "async function"):
                    declaration += "*"
                    name = scanner.next_token()
                names = _parse_binding_pattern(scanner, name)
                if declaration in ("const", "let", "var"):
                    names = _parse_variable_declaration_bindings(scanner, names)
                exports.append(Export(declaration=declaration, named=names, source=source[start_pos:scanner.pos], start=start_pos, end=scanner.pos))
                # Continue scanning the declaration body: exported functions and
                # classes may contain string-literal dynamic imports.
            elif nxt in ("(", ":", ",", "}"):
                # Object/class members may legally be named `export`.
                continue
            else:
                raise ParseError(f"Unexpected export token: {nxt}")

    return imports, exports


def _parse_named_imports(scanner: _Scanner) -> List[str]:
    """Parse the named imports from inside { ... } and leave scanner after '}'."""
    names = []
    while True:
        token = scanner.next_token()
        if token == "}":
            break
        if not token or token == ",":
            raise ParseError(f"Unexpected token in named imports: {token}")
        name = token
        nxt = scanner.next_token()
        if nxt == "as":
            alias = scanner.next_token()
            if not alias:
                raise ParseError("Expected alias after 'as'")
            name = f"{name}: {alias}"
            nxt = scanner.next_token()
        if nxt == ",":
            names.append(name)
        elif nxt == "}":
            names.append(name)
            break
        else:
            raise ParseError(f"Expected , or }} in named imports, got {nxt}")
    return names


def _parse_named_exports(scanner: _Scanner) -> List[str]:
    """Parse named exports from inside { ... } and leave scanner after '}'."""
    names = []
    while True:
        token = scanner.next_token()
        if token == "}":
            break
        if not token or token == ",":
            raise ParseError(f"Unexpected token in named exports: {token}")
        name = token
        nxt = scanner.next_token()
        if nxt == "as":
            alias = scanner.next_token()
            if not alias:
                raise ParseError("Expected alias after 'as'")
            name = f"{name} as {alias}"
            nxt = scanner.next_token()
        if nxt == ",":
            names.append(name)
        elif nxt == "}":
            names.append(name)
            break
        else:
            raise ParseError(f"Expected , or }} in named exports, got {nxt}")
    return names


def _read_string_literal(scanner: _Scanner) -> str:
    """Read a string literal and return its value. Supports ' and "."""
    scanner.skip_whitespace()
    if scanner.pos >= scanner.length:
        raise ParseError("Expected string literal")
    quote = scanner.source[scanner.pos]
    if quote not in "'\"":
        raise ParseError(f"Expected string quote, got {quote}")
    start = scanner.pos
    scanner.token_start = start
    scanner._match_string()
    return _decode_js_string_token(scanner.source, _CodeToken("string", None, start, scanner.pos))


def _skip_balanced_parentheses(scanner: _Scanner):
    """Skip the remainder of a non-literal dynamic import expression."""
    depth = 1
    while scanner.pos < scanner.length and depth:
        ch = scanner.source[scanner.pos]
        if ch in "'\"`":
            quote = ch
            scanner.pos += 1
            while scanner.pos < scanner.length:
                current = scanner.source[scanner.pos]
                if current == "\\":
                    scanner.pos += 2
                    continue
                scanner.pos += 1
                if current == quote:
                    break
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        scanner.pos += 1


def _skip_statement(scanner: _Scanner):
    """Skip until the end of the current statement (semicolon or brace-balanced)."""
    brace_depth = 0
    saw_brace = False
    while scanner.pos < scanner.length:
        ch = scanner.source[scanner.pos]
        if ch == "'" or ch == '"' or ch == "`":
            # Skip string/template
            quote = ch
            scanner.pos += 1
            while scanner.pos < scanner.length:
                c = scanner.source[scanner.pos]
                if c == "\\":
                    scanner.pos += 2
                    continue
                if c == quote:
                    scanner.pos += 1
                    break
                scanner.pos += 1
            continue
        if ch == "/" and scanner.peek(1) == "/":
            while scanner.pos < scanner.length and scanner.source[scanner.pos] != "\n":
                scanner.pos += 1
            continue
        if ch == "/" and scanner.peek(1) == "*":
            scanner.pos += 2
            while scanner.pos < scanner.length - 1:
                if scanner.source[scanner.pos] == "*" and scanner.source[scanner.pos + 1] == "/":
                    scanner.pos += 2
                    break
                scanner.pos += 1
            continue
        if ch == "{":
            saw_brace = True
            brace_depth += 1
        elif ch == "}":
            brace_depth -= 1
            if brace_depth < 0 or (saw_brace and brace_depth == 0):
                scanner.pos += 1
                return
        elif ch == ";" and brace_depth == 0:
            scanner.pos += 1
            return
        scanner.pos += 1
