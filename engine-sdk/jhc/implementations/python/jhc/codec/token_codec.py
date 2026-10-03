# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""TokenCodec — lossless token-based text compression for JHC1 resources."""

import re
from typing import Dict, List, Tuple

_WORD_RE = re.compile(r"[A-Za-z0-9_]+|[^A-Za-z0-9_]+")

_OPCODE_RAW_1 = 0xF0
_OPCODE_RAW_2 = 0xF1
_OPCODE_RAW_4 = 0xF2
_OPCODE_DICT_2 = 0xF3
_MAX_DICT_1 = 240


def _make_dict(tokens: List[str]) -> Tuple[List[str], Dict[str, int]]:
    """Build a 1-byte opcode dictionary, deduplicated and truncated to the maximum size."""
    lst: List[str] = []
    mp: Dict[str, int] = {}
    for token in tokens:
        if token in mp:
            continue
        if len(lst) >= _MAX_DICT_1:
            break
        mp[token] = len(lst)
        lst.append(token)
    return lst, mp


_COMMON_TOKENS = [
    " ", "\n", "\t", "    ",
    "{", "}", "(", ")", "[", "]", ";", ":", ",", ".",
    "=", "==", "===", "!=", "!==", "=>",
    "+", "-", "*", "/", "%", "++", "--",
    "&&", "||", "!", "?", "...", "&", "|", "^", "~",
    "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
    "<", ">", "<=", ">=", "<<", ">>", ">>>",
    "'", '"', "`", "#", "/", "//", "/*", "*/",
    "<", ">", "</", "/>", "<!--", "-->", "<!DOCTYPE",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "true", "false", "null", "undefined", "NaN", "Infinity",
]

_JS_TOKENS = [
    "function", "const", "let", "var", "return", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "try", "catch", "finally", "throw",
    "new", "delete", "typeof", "instanceof", "in", "of", "void", "this", "with",
    "async", "await", "import", "export", "from", "as", "default", "class", "extends",
    "super", "static", "get", "set", "constructor", "yield", "debugger",
    "Object", "Array", "String", "Number", "Boolean", "JSON", "Math", "Date", "RegExp",
    "Map", "Set", "Promise", "fetch", "console", "window", "document", "globalThis",
    "setTimeout", "setInterval", "addEventListener", "removeEventListener", "querySelector",
    "querySelectorAll", "createElement", "appendChild", "removeChild", "innerHTML", "textContent",
    "style", "classList", "className", "add", "remove", "toggle", "contains", "forEach",
    "map", "filter", "reduce", "join", "split", "slice", "splice", "push", "pop", "shift",
    "unshift", "indexOf", "includes", "find", "findIndex", "sort", "reverse", "length",
    "toString", "parseInt", "parseFloat", "isNaN", "isFinite", "keys", "values", "entries",
    "assign", "create", "defineProperty", "hasOwnProperty", "prototype", "call", "apply",
    "bind", "then", "catch", "finally", "resolve", "reject", "all", "race", "allSettled",
    "any", "log", "warn", "error", "info", "e", "err", "i", "j", "k", "n", "m", "x", "y", "z",
    "a", "b", "c", "d", "o", "s", "t", "u", "v", "w", "h", "el", "elem", "data", "value",
    "key", "id", "name", "type", "options", "config", "result", "msg", "item", "idx", "len",
    "arr", "obj", "fn", "cb", "res", "req", "out", "self", "that", "ctx", "state", "props",
    "event", "target", "current", "parent", "child", "children", "root", "container", "panel",
    "body", "div", "span", "button", "input", "main", "section", "header", "footer", "nav",
    "article", "aside", "canvas", "img", "svg", "path", "on", "is", "to", "of", "get", "set",
    "has", "add", "map", "filter", "reduce", "forEach", "push", "pop", "shift", "unshift",
    "slice", "splice", "join", "split", "trim", "replace", "match", "search", "indexOf",
    "includes", "startsWith", "endsWith", "charAt", "charCodeAt", "fromCharCode", "fromCodePoint",
    "substring", "substr", "toString", "parseInt", "parseFloat", "isNaN", "isFinite", "stringify",
    "parse", "keys", "values", "entries", "assign", "create", "defineProperty", "getOwnPropertyNames",
    "hasOwnProperty", "hasOwn", "property", "constructor", "valueOf", "length", "push", "call",
    "apply", "bind", "then", "catch", "finally", "resolve", "reject", "all", "race", "allSettled",
    "any",
]

_HTML_TOKENS = [
    "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
    "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup",
    "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed",
    "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
    "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd", "label", "legend",
    "li", "link", "main", "map", "mark", "math", "menu", "meta", "meter", "nav", "noscript", "object",
    "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt", "ruby",
    "s", "samp", "script", "search", "section", "select", "slot", "small", "source", "span", "strong",
    "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th",
    "thead", "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
    "class", "id", "style", "src", "href", "type", "name", "value", "disabled", "checked", "selected",
    "hidden", "required", "readonly", "placeholder", "title", "alt", "rel", "target", "charset", "content",
    "http-equiv", "viewport", "width", "height", 'class="', 'id="', 'style="', 'src="', 'href="',
    'type="', 'name="', 'value="', '="', "data-", "aria-", "role", "tabindex", "hidden", "open",
    "defer", "async", "crossorigin", "integrity", "nomodule", "referrerpolicy", "sandbox", "allow",
    "autoplay", "controls", "loop", "muted", "preload", "poster", "srcset", "sizes", "alt=", "lang",
    "dir", "translate", "draggable", "spellcheck", "contenteditable", "download", 'target="', 'rel="',
    "xmlns", "viewBox", "fill", "stroke", "d", "points", "cx", "cy", "r", "x", "y", "width=", "height=",
    "xml:lang", "xml:space", "xlink:href", "svg", "g", "rect", "circle", "ellipse", "line", "polyline",
    "polygon", "text", "tspan", "path", "defs", "use", "clipPath", "mask", "pattern", "linearGradient",
    "radialGradient", "stop", "offset", "transform", "opacity", "fill-", "stroke-", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "preserveAspectRatio",
]

_JSON_TOKENS = [
    "{", "}", "[", "]", ":", ",", '"', "\\", "/", "true", "false", "null",
    "applicationId", "applicationVersion", "format", "name", "publisher", "entry",
    "requiredFeatures", "resources", "blockmap", "files", "version", "packageId",
    "builtAt", "format", "path", "mime", "id", "hash", "representation", "decodedLength",
    "licenseText", "manifest", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "test.", "com.", "org.", "io", "app", "v", "app-", "com.", "webgpu", "jhc-1.0",
]

_CSS_TOKENS = [
    "color", "background", "background-color", "border", "border-radius", "display", "position",
    "width", "height", "top", "left", "right", "bottom", "margin", "padding", "font", "font-size",
    "font-family", "font-weight", "text-align", "text-decoration", "overflow", "visibility", "opacity",
    "transform", "transition", "animation", "flex", "grid", "box-shadow", "cursor", "z-index",
    "pointer-events", "white-space", "content", "align-items", "justify-content", "flex-direction",
    "gap", "order", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-self", "justify-self",
    "grid-template", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-area",
    "min-width", "max-width", "min-height", "max-height", "margin-top", "margin-right", "margin-bottom",
    "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top",
    "border-right", "border-bottom", "border-left", "border-width", "border-style", "border-color",
    "outline", "outline-offset", "box-sizing", "float", "clear", "clip", "filter", "mix-blend-mode",
    "background-image", "background-size", "background-position", "background-repeat", "background-attachment",
    "color:", "background:", "display:", "position:", "width:", "height:", "margin:", "padding:", "font:",
    "px", "em", "rem", "%", "vh", "vw", "vmin", "vmax", "ex", "ch", "cm", "mm", "in", "pt", "pc",
    "!important", "inherit", "initial", "unset", "auto", "none", "block", "inline", "inline-block",
    "flex", "inline-flex", "grid", "inline-grid", "table", "table-cell", "table-row", "list-item",
    "absolute", "relative", "fixed", "static", "sticky", "center", "left", "right", "top", "bottom",
    "row", "column", "wrap", "nowrap", "wrap-reverse", "row-reverse", "column-reverse", "start", "end",
    "flex-start", "flex-end", "space-between", "space-around", "space-evenly", "stretch", "baseline",
    "rgba", "rgb", "hsl", "hsla", "var", "calc", "min", "max", "clamp", "transparent", "solid", "dashed",
    "dotted", "double", "groove", "ridge", "inset", "outset", "hidden", "visible", "scroll", "no-repeat",
    "repeat", "repeat-x", "repeat-y", "cover", "contain", "pointer", "default", "not-allowed", "wait",
    "text", "all", "none", "border-box", "content-box", "padding-box", "margin-box", "fill-box", "stroke-box",
    "view-box", "0", "1px", "2px", "4px", "8px", "16px", "32px", "100%", "100vh", "100vw", "1rem", "0.5",
    "0.25", "1em", "9999", "0px", "border-box", "content-box", "padding-box", "margin-box", "0s", "1s",
    "0.2s", "0.3s", "0.5s", "ease", "linear", "ease-in", "ease-out", "ease-in-out", "cubic-bezier",
    "translate", "translateX", "translateY", "translateZ", "scale", "scaleX", "scaleY", "rotate",
    "skewX", "skewY", "matrix", "matrix3d", "perspective", "rotateX", "rotateY", "rotateZ", "rotate3d",
    "scaleZ", "translate3d", "scale3d", "all", "opacity", "transform", "color", "background-color",
]

_DICTIONARIES = {
    "common": _make_dict(_COMMON_TOKENS),
    "js": _make_dict(_JS_TOKENS),
    "html": _make_dict(_HTML_TOKENS),
    "css": _make_dict(_CSS_TOKENS),
    "json": _make_dict(_JSON_TOKENS),
}


def _dictionary_for(language: str) -> Tuple[List[str], Dict[str, int]]:
    """Merge the common dictionary with a language-specific one."""
    base_list, base_map = _DICTIONARIES["common"]
    extra_list, _ = _DICTIONARIES.get(language, (base_list, base_map))
    if extra_list is base_list:
        return base_list, base_map
    merged = list(base_list)
    mp = dict(base_map)
    for token in extra_list:
        if token not in mp:
            if len(merged) >= _MAX_DICT_1:
                break
            mp[token] = len(merged)
            merged.append(token)
    return merged, mp


def _tokenize(text: str) -> List[str]:
    """Split text into maximal word / non-word runs."""
    return _WORD_RE.findall(text)


def _encode_string(s: str) -> bytes:
    return s.encode("utf-8")


class TokenCodec:
    """Lossless token-based text encoder/decoder."""

    @staticmethod
    def can_encode(text: str, language: str = "js") -> bool:
        try:
            TokenCodec.encode(text, language)
            return True
        except Exception:
            return False

    @staticmethod
    def encode(text: str, language: str = "js") -> bytes:
        """Encode a text string into a token byte stream."""
        dictionary, token_map = _dictionary_for(language)
        tokens = _tokenize(text)
        out = bytearray()
        for token in tokens:
            op = token_map.get(token)
            if op is not None:
                out.append(op)
            else:
                raw = _encode_string(token)
                length = len(raw)
                if length <= 0xFF:
                    out.append(_OPCODE_RAW_1)
                    out.append(length)
                elif length <= 0xFFFF:
                    out.append(_OPCODE_RAW_2)
                    out.append(length & 0xFF)
                    out.append((length >> 8) & 0xFF)
                elif length <= 0xFFFFFFFF:
                    out.append(_OPCODE_RAW_4)
                    out.append(length & 0xFF)
                    out.append((length >> 8) & 0xFF)
                    out.append((length >> 16) & 0xFF)
                    out.append((length >> 24) & 0xFF)
                else:
                    raise ValueError("Token too long for token codec")
                out.extend(raw)
        return bytes(out)

    @staticmethod
    def decode(data: bytes, language: str = "js") -> str:
        """Decode a token byte stream back to the original text string."""
        dictionary, _ = _dictionary_for(language)
        i = 0
        n = len(data)
        parts = []
        while i < n:
            op = data[i]
            if op < _MAX_DICT_1:
                parts.append(dictionary[op])
                i += 1
            elif op == _OPCODE_RAW_1:
                if i + 1 >= n:
                    raise ValueError("Truncated token stream")
                length = data[i + 1]
                if i + 2 + length > n:
                    raise ValueError("Truncated token stream")
                parts.append(data[i + 2 : i + 2 + length].decode("utf-8"))
                i += 2 + length
            elif op == _OPCODE_RAW_2:
                if i + 2 >= n:
                    raise ValueError("Truncated token stream")
                length = data[i + 1] | (data[i + 2] << 8)
                if i + 3 + length > n:
                    raise ValueError("Truncated token stream")
                parts.append(data[i + 3 : i + 3 + length].decode("utf-8"))
                i += 3 + length
            elif op == _OPCODE_RAW_4:
                if i + 4 >= n:
                    raise ValueError("Truncated token stream")
                length = data[i + 1] | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24)
                if i + 5 + length > n:
                    raise ValueError("Truncated token stream")
                parts.append(data[i + 5 : i + 5 + length].decode("utf-8"))
                i += 5 + length
            elif op == _OPCODE_DICT_2:
                raise ValueError("Application dictionary opcodes not yet implemented")
            else:
                raise ValueError(f"Unknown token opcode: {op}")
        return "".join(parts)
