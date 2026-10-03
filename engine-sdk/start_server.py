#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""
Engine v2 Project Hub Server Launcher
Starts a local HTTP server and opens the project hub in the default browser.
"""

import os
import sys
import webbrowser
import http.server
import socketserver
import concurrent.futures
import ipaddress
import json
import math
import re
import socket
import struct
import threading
import time
import gzip
import hashlib
import io
import tempfile
from collections import deque
from copy import deepcopy
from pathlib import Path
from types import MappingProxyType
from urllib.parse import parse_qs, unquote, urlsplit

from bundler.site import (
    CLOUDFLARE_PAGES_MAX_FILE_BYTES,
    ENGINE_DEMO_RUNTIME_ASSET_COPIES,
    ENGINE_DEMO_RUNTIME_DEPLOYMENT_ROOT,
    ENGINE_DEMO_RUNTIME_KIT_MANIFEST,
    ENGINE_DEMO_STARTER_ARCHIVE_PATH,
    lay_down_engine_demo_runtime_assets,
)

# Configuration
PORT = int(os.environ.get("PARTICLE_REALMS_PORT", "9001"))
HOST = "127.0.0.1"
PROJECT_ROOT = Path(__file__).parent
INDEX_URL = f"http://{HOST}:{PORT}/"
NTP_PORT = 123
NTP_UNIX_DELTA = 2_208_988_800
NTP_TIMEOUT_SECONDS = 1.5
MAX_NTP_SOURCES = 8
RELEASE_SITE_ROUTE = "/release/site/"
STATE_CHANNEL_SSE_ENABLED = os.environ.get("PARTICLE_STATE_SSE", "1").strip().lower() not in {"0", "false", "off"}
STATE_CHANNEL_ROUTE = "/_api/state-channels/v1"
STATE_CHANNEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
STATE_CHANNEL_MAX_BODY = 256 * 1024
STATE_CHANNEL_MAX_MESSAGES = 2048
STATE_CHANNEL_MESSAGE_VERSIONS = (2, 1)
STATE_CHANNEL_V2_FORMAT = "particle-state-channel-message/2"
STATE_CHANNEL_FORBIDDEN_KEYS = {"__proto__", "prototype", "constructor"}
STATE_CHANNEL_MAX_JSON_DEPTH = 64
STATE_CHANNEL_MAX_JSON_NODES = 100_000
ENGINE_DEMO_DEVELOPMENT_ROUTE_ROOT = (
    f"/webgpu-os/{ENGINE_DEMO_RUNTIME_DEPLOYMENT_ROOT}"
)
ENGINE_DEMO_DEVELOPMENT_ROUTE_PREFIX = f"{ENGINE_DEMO_DEVELOPMENT_ROUTE_ROOT}/"
ENGINE_DEMO_DEVELOPMENT_STARTER_ROUTE = (
    f"/webgpu-os/{ENGINE_DEMO_STARTER_ARCHIVE_PATH}"
)
ENGINE_DEMO_DEVELOPMENT_ASSET_SOURCES = MappingProxyType({
    **{
        deployed_name: (PROJECT_ROOT / source_name).resolve()
        for source_name, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
    },
    ENGINE_DEMO_RUNTIME_KIT_MANIFEST: (
        PROJECT_ROOT / "Template" / "assets" / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
    ).resolve(),
})

if (
    len(ENGINE_DEMO_DEVELOPMENT_ASSET_SOURCES)
    != len(ENGINE_DEMO_RUNTIME_ASSET_COPIES) + 1
):
    raise RuntimeError("Engine demo development asset routes must be unique")

_ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE = None
_ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE_LOCK = threading.Lock()


def _engine_demo_development_asset_source(request_target):
    """Resolve one exact Pages-compatible engine-demo URL to its source file."""
    request_path = unquote(urlsplit(request_target).path)
    if request_path == ENGINE_DEMO_DEVELOPMENT_ROUTE_ROOT:
        return True, None
    if not request_path.startswith(ENGINE_DEMO_DEVELOPMENT_ROUTE_PREFIX):
        return False, None
    relative_name = request_path[len(ENGINE_DEMO_DEVELOPMENT_ROUTE_PREFIX):]
    return True, ENGINE_DEMO_DEVELOPMENT_ASSET_SOURCES.get(relative_name)


def _engine_demo_development_starter_archive():
    """Build and validate the canonical starter once without a source-tree copy."""
    global _ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE
    with _ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE_LOCK:
        if _ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE is not None:
            return _ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE
        started = time.perf_counter()
        print("[EngineDemo][starter-route][build][entry]")
        with tempfile.TemporaryDirectory(prefix="particle-engine-demo-starter-") as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_engine_demo_runtime_assets(PROJECT_ROOT, destination)
            archive_path = destination / ENGINE_DEMO_STARTER_ARCHIVE_PATH
            payload = archive_path.read_bytes()
        if len(payload) >= CLOUDFLARE_PAGES_MAX_FILE_BYTES:
            raise ValueError("Engine demo starter exceeds the Cloudflare Pages file cap")
        digest = hashlib.sha256(payload).hexdigest()
        _ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE = (payload, digest)
        duration_ms = round((time.perf_counter() - started) * 1000.0, 3)
        print(
            f"[EngineDemo][starter-route][build][exit] bytes={len(payload)} "
            f"sha256={digest} durationMs={duration_ms}"
        )
        return _ENGINE_DEMO_DEVELOPMENT_STARTER_CACHE


def _state_channel_bounded_text(value, maximum):
    return isinstance(value, str) and 1 <= len(value) <= maximum


def _state_channel_optional_text(value, maximum):
    return value is None or (isinstance(value, str) and len(value) <= maximum)


def _state_channel_nonnegative_integer(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _state_channel_optional_integer(value):
    return value is None or _state_channel_nonnegative_integer(value)


def _state_channel_timestamp(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= 0
        and math.isfinite(value)
    )


def _apply_json_merge_patch(target, patch):
    """Apply RFC 7396 semantics to JSON-safe values."""
    if not isinstance(patch, dict):
        return deepcopy(patch)
    result = deepcopy(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if key in {"__proto__", "prototype", "constructor"}:
            raise ValueError("unsafe state channel key")
        if value is None:
            result.pop(key, None)
        elif isinstance(value, dict):
            result[key] = _apply_json_merge_patch(result.get(key), value)
        else:
            result[key] = deepcopy(value)
    return result


def _validate_state_channel_json(root):
    stack = [(root, 0)]
    nodes = 0
    while stack:
        value, depth = stack.pop()
        nodes += 1
        if nodes > STATE_CHANNEL_MAX_JSON_NODES:
            raise ValueError("state channel message exceeds the JSON node limit")
        if depth > STATE_CHANNEL_MAX_JSON_DEPTH:
            raise ValueError("state channel message exceeds the JSON depth limit")
        if value is None or isinstance(value, (str, bool, int)):
            continue
        if isinstance(value, float):
            if not math.isfinite(value):
                raise ValueError("state channel message contains a non-finite number")
            continue
        if isinstance(value, list):
            stack.extend((child, depth + 1) for child in value)
            continue
        if not isinstance(value, dict):
            raise ValueError("state channel message contains a non-JSON value")
        for key, child in value.items():
            if not isinstance(key, str) or key in STATE_CHANNEL_FORBIDDEN_KEYS:
                raise ValueError("state channel message contains an unsafe key")
            stack.append((child, depth + 1))


def _reject_non_finite_json(value):
    raise ValueError(f"non-finite JSON number is not allowed: {value}")


class StateChannelBroker:
    """Bounded local SSE fan-out with replay and synthesized snapshots."""

    def __init__(self, max_messages=STATE_CHANNEL_MAX_MESSAGES):
        self._max_messages = max_messages
        self._channels = {}
        self._condition = threading.Condition()

    def publish(self, channel_id, message, sender):
        if not STATE_CHANNEL_RE.fullmatch(channel_id):
            raise ValueError("invalid state channel id")
        if not isinstance(message, dict) or message.get("channelId") != channel_id:
            raise ValueError("state channel message does not match route")
        _validate_state_channel_json(message)
        version = message.get("version")
        if version not in STATE_CHANNEL_MESSAGE_VERSIONS or isinstance(version, bool):
            raise ValueError("unsupported state channel message version")
        if version == 2 and message.get("format") != STATE_CHANNEL_V2_FORMAT:
            raise ValueError("state channel v2 message has an invalid format")
        kind = message.get("kind")
        if kind not in {"intent", "projection", "receipt", "heartbeat"}:
            raise ValueError("invalid state channel message kind")
        if kind == "intent" and (
            not _state_channel_bounded_text(message.get("id"), 256)
            or not _state_channel_bounded_text(message.get("clientId"), 128)
            or not _state_channel_bounded_text(message.get("action"), 96)
            or "payload" not in message
            or "expectedRevision" not in message
            or not _state_channel_optional_integer(message.get("expectedRevision"))
            or "authorityEpoch" not in message
            or not _state_channel_optional_integer(message.get("authorityEpoch"))
            or "createdAt" not in message
            or not _state_channel_timestamp(message.get("createdAt"))
        ):
            raise ValueError("invalid state channel intent")
        if kind == "projection" and (
            not _state_channel_bounded_text(message.get("id"), 256)
            or message.get("projectionKind") not in {"snapshot", "merge-patch", "event"}
            or "data" not in message
            or not _state_channel_nonnegative_integer(message.get("revision"))
            or not _state_channel_nonnegative_integer(message.get("sequence"))
            or not _state_channel_bounded_text(message.get("authorityId"), 256)
            or not _state_channel_nonnegative_integer(message.get("authorityEpoch"))
            or "causedBy" not in message
            or not _state_channel_optional_text(message.get("causedBy"), 256)
            or "createdAt" not in message
            or not _state_channel_timestamp(message.get("createdAt"))
        ):
            raise ValueError("invalid state channel projection")
        if kind == "receipt" and (
            not _state_channel_bounded_text(message.get("id"), 256)
            or not _state_channel_bounded_text(message.get("intentId"), 256)
            or not _state_channel_bounded_text(message.get("clientId"), 128)
            or message.get("status") not in {"accepted", "rejected", "duplicate"}
            or "reason" not in message
            or not _state_channel_optional_text(message.get("reason"), 1024)
            or not _state_channel_nonnegative_integer(message.get("revision"))
            or not _state_channel_nonnegative_integer(message.get("sequence"))
            or not _state_channel_nonnegative_integer(message.get("authorityEpoch"))
            or "createdAt" not in message
            or not _state_channel_timestamp(message.get("createdAt"))
        ):
            raise ValueError("invalid state channel receipt")
        with self._condition:
            state = self._channels.setdefault(channel_id, {
                "sequence": 0,
                "messages": deque(maxlen=self._max_messages),
                "projection": None,
                "snapshot": None,
            })
            state["sequence"] += 1
            record = {
                "id": state["sequence"],
                "event": kind,
                "message": deepcopy(message),
                "sender": str(sender or "anonymous")[:128],
            }
            state["messages"].append(record)
            if kind == "projection":
                state["projection"] = deepcopy(message)
                if message.get("projectionKind") == "snapshot":
                    projection_state = deepcopy(message.get("data"))
                elif message.get("projectionKind") == "merge-patch":
                    projection_state = _apply_json_merge_patch(
                        state["snapshot"].get("data") if state["snapshot"] else {},
                        message.get("data"),
                    )
                else:
                    projection_state = state["snapshot"].get("data") if state["snapshot"] else None
                if projection_state is not None:
                    state["snapshot"] = {
                        **deepcopy(message),
                        "projectionKind": "snapshot",
                        "data": projection_state,
                    }
            self._condition.notify_all()
            return deepcopy(record)

    def after(self, channel_id, sequence, sender=None):
        with self._condition:
            state = self._channels.get(channel_id)
            if not state:
                return []
            return [
                deepcopy(record) for record in state["messages"]
                if record["id"] > sequence and (sender is None or record["sender"] != sender)
            ]

    def wait_after(self, channel_id, sequence, sender=None, timeout=10.0):
        with self._condition:
            records = self.after(channel_id, sequence, sender)
            if records:
                return records
            self._condition.wait(timeout)
            return self.after(channel_id, sequence, sender)

    def snapshot(self, channel_id):
        with self._condition:
            state = self._channels.get(channel_id)
            return deepcopy(state.get("snapshot")) if state and state.get("snapshot") else None

    def status(self):
        with self._condition:
            return {
                "enabled": STATE_CHANNEL_SSE_ENABLED,
                "standard": "sse-downstream/http-post-upstream",
                "version": 1,
                "messageVersions": list(STATE_CHANNEL_MESSAGE_VERSIONS),
                "channels": len(self._channels),
                "messages": sum(len(state["messages"]) for state in self._channels.values()),
            }


STATE_CHANNEL_BROKER = StateChannelBroker()


def _release_site_transition_path(project_root, request_path):
    """Resolve release-site requests during the brief staged publication swap."""
    project_root = Path(project_root)
    if request_path == RELEASE_SITE_ROUTE.rstrip("/"):
        request_path += "/"
    if not request_path.startswith(RELEASE_SITE_ROUTE):
        return None

    final_root = project_root / "release" / "site"
    if final_root.exists():
        return None

    relative_path = request_path[len(RELEASE_SITE_ROUTE):]
    staging_root = project_root / "release" / ".staging"
    for directory_name in ("site.previous", "site"):
        fallback_root = (staging_root / directory_name).resolve()
        candidate = (fallback_root / relative_path).resolve()
        try:
            candidate.relative_to(fallback_root)
        except ValueError:
            return None
        if candidate.exists():
            return candidate
    return None


def _ntp_timestamp(value):
    """Encode Unix seconds as one NTP 64-bit timestamp."""
    ntp_value = value + NTP_UNIX_DELTA
    seconds = int(ntp_value)
    fraction = int((ntp_value - seconds) * (1 << 32))
    return struct.pack("!II", seconds & 0xFFFFFFFF, fraction & 0xFFFFFFFF)


def _decode_ntp_timestamp(packet, offset):
    seconds, fraction = struct.unpack_from("!II", packet, offset)
    return seconds - NTP_UNIX_DELTA + fraction / float(1 << 32)


def _is_public_address(sockaddr):
    try:
        return ipaddress.ip_address(sockaddr[0].split("%", 1)[0]).is_global
    except ValueError:
        return False


def _resolve_public_ntp(host):
    """Resolve a hostname once and reject loopback, LAN, and reserved targets."""
    addresses = socket.getaddrinfo(host, NTP_PORT, type=socket.SOCK_DGRAM, proto=socket.IPPROTO_UDP)
    public = [entry for entry in addresses if _is_public_address(entry[4])]
    if not public:
        raise ValueError("hostname did not resolve to a public Internet address")
    return public[0]


def _query_ntp_host(host):
    """Collect one RFC 5905 four-timestamp sample from a public NTP server."""
    started = time.perf_counter()
    try:
        family, socket_type, protocol, _, sockaddr = _resolve_public_ntp(host)
        request = bytearray(48)
        request[0] = 0x23  # LI=0, VN=4, client mode=3
        t1 = time.time()
        request[40:48] = _ntp_timestamp(t1)
        with socket.socket(family, socket_type, protocol) as client:
            client.settimeout(NTP_TIMEOUT_SECONDS)
            client.connect(sockaddr)
            client.send(request)
            response = client.recv(512)
        t4 = time.time()
        if len(response) < 48:
            raise ValueError("short NTP response")
        leap = response[0] >> 6
        version = (response[0] >> 3) & 0x07
        mode = response[0] & 0x07
        stratum = response[1]
        if mode not in (4, 5) or version < 3:
            raise ValueError("invalid NTP server mode or version")
        if leap == 3 or not 1 <= stratum <= 15:
            raise ValueError("server is not synchronized")
        if response[24:32] != request[40:48]:
            raise ValueError("NTP originate timestamp mismatch")

        t2 = _decode_ntp_timestamp(response, 32)
        t3 = _decode_ntp_timestamp(response, 40)
        offset_ms = ((t2 - t1) + (t3 - t4)) * 500.0
        delay_ms = max(0.0, ((t4 - t1) - (t3 - t2)) * 1000.0)
        root_delay_raw = struct.unpack_from("!i", response, 4)[0]
        root_dispersion_raw = struct.unpack_from("!I", response, 8)[0]
        root_delay_ms = root_delay_raw / 65536.0 * 1000.0
        root_dispersion_ms = root_dispersion_raw / 65536.0 * 1000.0
        uncertainty_ms = max(0.1, delay_ms / 2.0 + max(0.0, root_dispersion_ms) + max(0.0, root_delay_ms) / 2.0)
        if not all(math.isfinite(value) for value in (offset_ms, delay_ms, uncertainty_ms)):
            raise ValueError("non-finite NTP measurement")
        return {
            "ok": True,
            "host": host,
            "address": sockaddr[0],
            "offsetMs": offset_ms,
            "delayMs": delay_ms,
            "uncertaintyMs": uncertainty_ms,
            "stratum": stratum,
            "leap": leap,
            "version": version,
            "authenticated": False,
            "sampledAt": int(t4 * 1000),
            "durationMs": round((time.perf_counter() - started) * 1000, 3),
        }
    except (OSError, ValueError, struct.error) as error:
        return {
            "ok": False,
            "host": host,
            "error": str(error)[:240],
            "durationMs": round((time.perf_counter() - started) * 1000, 3),
        }

class QuietHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP request handler with compression, CORS, and cross-origin isolation."""

    protocol_version = "HTTP/1.1"

    MORPHFIELD_SCHEMA_ROUTE = "/schemas/morphfield/v2/"
    MORPHFIELD_SCHEMA_SOURCE = PROJECT_ROOT / "engine" / "render" / "morphfield" / "schemas"
    WEBGPU_OS_DEEP_LINK = re.compile(
        r"^/webgpu-os/open/(?:"
        r"app/[a-z0-9][a-z0-9.-]{0,79}|"
        r"subsurface/[a-z0-9][a-z0-9.-]{0,79}/[A-Za-z0-9][A-Za-z0-9._-]{0,79}"
        r")/?$"
    )

    # Ensure modern module / WASM types are served correctly
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".wgsl": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".jsonl": "application/x-ndjson; charset=utf-8",
    }
    
    # File types to compress
    COMPRESSIBLE = {'.html', '.css', '.js', '.mjs', '.json', '.jsonl', '.svg', '.txt', '.xml', '.md'}

    def translate_path(self, path):
        """Serve canonical virtual routes from their concrete source files."""
        request_path = unquote(urlsplit(path).path)
        engine_demo_route, engine_demo_source = _engine_demo_development_asset_source(path)
        if engine_demo_route:
            if engine_demo_source is not None:
                return str(engine_demo_source)
            # Invalid names under the virtual route never fall through to the
            # repository filesystem, even if a similarly named file appears.
            return str(PROJECT_ROOT / ".engine-demo-development-route-rejected")
        transition_path = _release_site_transition_path(PROJECT_ROOT, request_path)
        if transition_path is not None:
            print(
                f"[bundle-site][transition-fallback] path={request_path!r} "
                f"source={transition_path}"
            )
            return str(transition_path)
        if self.WEBGPU_OS_DEEP_LINK.fullmatch(request_path):
            print(f"[PWA][deep-link][rewrite] path={request_path!r}")
            return str(PROJECT_ROOT / "webgpu-os" / "index.html")
        if request_path.startswith(self.MORPHFIELD_SCHEMA_ROUTE):
            relative = request_path[len(self.MORPHFIELD_SCHEMA_ROUTE):]
            if relative and "/" not in relative and "\\" not in relative and relative.endswith(".schema.json"):
                return str(self.MORPHFIELD_SCHEMA_SOURCE / relative)
        return super().translate_path(path)

    def guess_type(self, path):
        if str(path).lower().endswith(".schema.json"):
            return "application/schema+json"
        return super().guess_type(path)

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass

    def handle_one_request(self):
        """Wrap request handling to silently drop client-aborted connections
        (e.g. a browser navigating away / cancelling an in-flight asset
        request) instead of letting BaseServer log a full traceback."""
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def do_GET(self):
        """Handle GET with gzip compression for text files."""
        request_url = urlsplit(self.path)
        if self._serve_engine_demo_development_starter(include_body=True):
            return
        if self._reject_unknown_engine_demo_development_asset():
            return
        if self.path.startswith("/_api/"):
            print(f"[API][request] path={request_url.path!r}")
        if request_url.path == "/_api/time/ntp":
            self._handle_ntp_query(parse_qs(request_url.query, keep_blank_values=False))
            return
        if request_url.path == f"{STATE_CHANNEL_ROUTE}/status":
            self._handle_state_channel_status()
            return
        state_route = self._parse_state_channel_route(request_url.path)
        if state_route and state_route[1] == "events":
            self._handle_state_channel_events(state_route[0], parse_qs(request_url.query))
            return
        if state_route and state_route[1] == "snapshot":
            self._handle_state_channel_snapshot(state_route[0])
            return
        if request_url.path == "/_api/jhc/fixtures":
            self._handle_jhc_fixtures_list()
            return
        if request_url.path == "/_api/jhc/malformed":
            self._handle_jhc_malformed_list()
            return
        if request_url.path.startswith("/_api/jhc/verify/"):
            self._handle_jhc_verify_fixture(request_url.path[len("/_api/jhc/verify/"):])
            return

        # Check if client accepts gzip
        accept_encoding = self.headers.get('Accept-Encoding', '')
        
        # Get file path
        path = self.translate_path(self.path)
        ext = os.path.splitext(path)[1].lower()
        
        # Compress text files if client supports gzip
        if 'gzip' in accept_encoding and ext in self.COMPRESSIBLE and os.path.isfile(path):
            try:
                with open(path, 'rb') as f:
                    content = f.read()
                
                # Compress content
                buf = io.BytesIO()
                with gzip.GzipFile(fileobj=buf, mode='wb', compresslevel=6) as gz:
                    gz.write(content)
                compressed = buf.getvalue()
                
                # Send compressed response
                self.send_response(200)
                self.send_header('Content-Type', self.guess_type(path))
                self.send_header('Content-Encoding', 'gzip')
                self.send_header('Content-Length', len(compressed))
                self.send_header('Vary', 'Accept-Encoding')
                self.end_headers()
                self.wfile.write(compressed)
                return
            except Exception:
                pass  # Fall back to normal serving
        
        # Default behavior for non-compressible files
        super().do_GET()

    def do_HEAD(self):
        """Serve metadata only for exact engine-demo development asset names."""
        if self._serve_engine_demo_development_starter(include_body=False):
            return
        if self._reject_unknown_engine_demo_development_asset():
            return
        super().do_HEAD()

    def _reject_unknown_engine_demo_development_asset(self):
        engine_demo_route, engine_demo_source = _engine_demo_development_asset_source(self.path)
        if not engine_demo_route or engine_demo_source is not None:
            return False
        request_path = unquote(urlsplit(self.path).path)
        print(f"[EngineDemo][asset-route][reject] path={request_path!r}")
        self.send_error(404, "Unknown engine demo development asset")
        return True

    def _serve_engine_demo_development_starter(self, include_body):
        request_path = unquote(urlsplit(self.path).path)
        if request_path != ENGINE_DEMO_DEVELOPMENT_STARTER_ROUTE:
            return False
        try:
            payload, digest = _engine_demo_development_starter_archive()
        except Exception as error:
            print(f"[EngineDemo][starter-route][build][error] error={error!r}")
            self.send_error(500, "Engine demo starter generation failed")
            return True
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header(
            "Content-Disposition",
            'attachment; filename="particle-engine-demo-starter.zip"',
        )
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("ETag", f'"sha256-{digest}"')
        self.end_headers()
        if include_body:
            self.wfile.write(payload)
        return True

    def do_POST(self):
        """Handle bounded local binary API requests."""
        request_url = urlsplit(self.path)
        state_route = self._parse_state_channel_route(request_url.path)
        if state_route and state_route[1] in {"intents", "messages"}:
            self._handle_state_channel_post(state_route[0], state_route[1])
            return
        if request_url.path != "/_api/jhc/cross-verify":
            self._send_json(404, {"ok": False, "code": "not_found", "error": "unknown API endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 64 * 1024 * 1024:
            self._send_json(413, {"ok": False, "error": "JHC body must be 1 byte to 64 MiB"})
            return
        self._handle_jhc_cross_verify(self.rfile.read(length))

    def _parse_state_channel_route(self, path):
        if not STATE_CHANNEL_SSE_ENABLED or not path.startswith(f"{STATE_CHANNEL_ROUTE}/"):
            return None
        remainder = unquote(path[len(STATE_CHANNEL_ROUTE) + 1:])
        for suffix in ("/events", "/snapshot", "/intents", "/messages"):
            if remainder.endswith(suffix):
                channel_id = remainder[:-len(suffix)]
                if STATE_CHANNEL_RE.fullmatch(channel_id):
                    return channel_id, suffix[1:]
        return None

    def _handle_state_channel_status(self):
        if not self._request_has_local_origin():
            self._send_json(403, {"ok": False, "error": "local origin required"})
            return
        self._send_json(200, {"ok": True, **STATE_CHANNEL_BROKER.status()})

    def _handle_state_channel_snapshot(self, channel_id):
        if not self._request_has_local_origin():
            self._send_json(403, {"ok": False, "error": "local origin required"})
            return
        message = STATE_CHANNEL_BROKER.snapshot(channel_id)
        if message is None:
            self._send_json(404, {"ok": False, "error": "state channel has no snapshot"})
            return
        self._send_json(200, {"ok": True, "message": message})

    def _handle_state_channel_post(self, channel_id, resource):
        if not self._request_has_local_origin():
            self._send_json(403, {"ok": False, "error": "local origin required"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > STATE_CHANNEL_MAX_BODY:
            self._send_json(413, {"ok": False, "error": "state channel body must be 1 byte to 256 KiB"})
            return
        try:
            message = json.loads(
                self.rfile.read(length).decode("utf-8"),
                parse_constant=_reject_non_finite_json,
            )
            expected = {"intent"} if resource == "intents" else {"projection", "receipt"}
            if message.get("kind") not in expected:
                raise ValueError(f"{resource} endpoint does not accept this message kind")
            sender = self.headers.get("X-Particle-State-Client") or message.get("clientId") or message.get("authorityId")
            record = STATE_CHANNEL_BROKER.publish(channel_id, message, sender)
            print(f"[StateChannel][publish] channel={channel_id!r} kind={message.get('kind')!r} brokerSeq={record['id']}")
            self._send_json(202, {
                "ok": True,
                "accepted": True,
                "brokerSequence": record["id"],
                "messageVersion": message["version"],
            })
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as error:
            self._send_json(400, {"ok": False, "error": str(error)[:240]})

    def _handle_state_channel_events(self, channel_id, query):
        if not self._request_has_local_origin():
            self._send_json(403, {"ok": False, "error": "local origin required"})
            return
        client_id = str((query.get("clientId") or ["anonymous"])[0])[:128]
        raw_after = (query.get("after") or [self.headers.get("Last-Event-ID", "0")])[0]
        try:
            after = max(0, int(raw_after))
        except (TypeError, ValueError):
            after = 0
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("X-Particle-State-Transport", "sse-v1")
        self.send_header(
            "X-Particle-State-Message-Versions",
            ",".join(str(version) for version in STATE_CHANNEL_MESSAGE_VERSIONS),
        )
        self.end_headers()
        try:
            self.wfile.write(b"retry: 1500\n\n")
            self.wfile.flush()
            while True:
                records = STATE_CHANNEL_BROKER.wait_after(channel_id, after, client_id, timeout=10.0)
                if not records:
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                    continue
                for record in records:
                    payload = json.dumps(record["message"], separators=(",", ":"), ensure_ascii=True)
                    frame = f"id: {record['id']}\nevent: {record['event']}\ndata: {payload}\n\n".encode("utf-8")
                    self.wfile.write(frame)
                    after = record["id"]
                self.wfile.flush()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def _request_has_local_origin(self):
        """Reject browser requests routed to this loopback service by another site."""
        allowed_hosts = {"127.0.0.1", "localhost", "::1"}
        try:
            peer_address = ipaddress.ip_address(self.client_address[0].split("%", 1)[0])
            if not peer_address.is_loopback:
                return False
            fetch_site = self.headers.get("Sec-Fetch-Site", "").strip().lower()
            if fetch_site not in ("", "none", "same-origin"):
                return False
            host_url = urlsplit(f"//{self.headers.get('Host', '')}")
            if host_url.hostname not in allowed_hosts:
                return False
            origin = self.headers.get("Origin")
            if not origin:
                return True
            origin_url = urlsplit(origin)
            request_port = int(self.server.server_address[1])
            origin_port = origin_url.port or (443 if origin_url.scheme == "https" else 80)
            return (
                origin_url.scheme == "http"
                and origin_url.hostname in allowed_hosts
                and origin_port == request_port
            )
        except (TypeError, ValueError):
            return False

    def _handle_jhc_fixtures_list(self):
        """Return the JHC fixture index plus Python verification results."""
        fixtures_dir = PROJECT_ROOT / "jhc" / "tests" / "fixtures"
        index_path = fixtures_dir / "fixtures.json"
        if not index_path.exists():
            self._send_json(404, {"ok": False, "error": "fixtures.json not found"})
            return
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
            fixtures = []
            for name in index.get("fixtures", []):
                raw_path = fixtures_dir / name / "expected.jhcraw"
                if not raw_path.exists():
                    continue
                try:
                    sys.path.insert(0, str(PROJECT_ROOT))
                    from jhc import JhcPackage
                    container = raw_path.read_bytes()
                    parsed = JhcPackage.parse(container)
                    fixtures.append({
                        "name": name,
                        "applicationId": parsed["manifest"]["applicationId"],
                        "applicationVersion": parsed["manifest"]["applicationVersion"],
                        "rootHash": parsed["rootHash"],
                        "resourcePaths": sorted(parsed["resources"].keys()),
                        "pythonVerified": True,
                        "size": len(container),
                    })
                except Exception as e:
                    fixtures.append({
                        "name": name,
                        "error": str(e)[:200],
                        "pythonVerified": False,
                    })
            self._send_json(200, {"ok": True, "fixtures": fixtures})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": str(e)[:200]})

    def _handle_jhc_malformed_list(self):
        """Return the malformed corpus index."""
        malformed_dir = PROJECT_ROOT / "jhc" / "tests" / "malformed"
        index_path = malformed_dir / "index.json"
        if not index_path.exists():
            self._send_json(404, {"ok": False, "error": "malformed index.json not found"})
            return
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
            self._send_json(200, {"ok": True, "cases": index.get("cases", [])})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": str(e)[:200]})

    def _handle_jhc_verify_fixture(self, name):
        """Run Python verification on a fixture and return the result."""
        fixtures_dir = PROJECT_ROOT / "jhc" / "tests" / "fixtures"
        raw_path = fixtures_dir / name / "expected.jhcraw"
        if not raw_path.exists():
            self._send_json(404, {"ok": False, "error": f"fixture {name!r} not found"})
            return
        try:
            sys.path.insert(0, str(PROJECT_ROOT))
            from jhc import JhcPackage
            container = raw_path.read_bytes()
            parsed = JhcPackage.parse(container)
            self._send_json(200, {
                "ok": True,
                "name": name,
                "applicationId": parsed["manifest"]["applicationId"],
                "applicationVersion": parsed["manifest"]["applicationVersion"],
                "rootHash": parsed["rootHash"],
                "resourcePaths": sorted(parsed["resources"].keys()),
            })
        except Exception as e:
            self._send_json(200, {"ok": False, "name": name, "error": str(e)[:200]})

    def _handle_jhc_cross_verify(self, container):
        """Parse browser-produced JHC bytes with Python and report canonical state."""
        try:
            sys.path.insert(0, str(PROJECT_ROOT))
            from jhc import JhcPackage
            parsed = JhcPackage.parse(container)
            verified = JhcPackage.verify(container)
            self._send_json(200, {
                # Cross-verify reports structural/canonical parse success. Trust
                # is separate: unsigned golden fixtures are valid parity inputs
                # but are deliberately not trusted or installable.
                "ok": True,
                "trustOk": bool(verified.get("ok")),
                "trustVerdict": verified.get("verdict"),
                "applicationId": parsed["manifest"]["applicationId"],
                "applicationVersion": parsed["manifest"]["applicationVersion"],
                "rootHash": parsed["rootHash"],
                "resourcePaths": sorted(parsed["resources"]),
                "canonicalManifest": JhcPackage._canonical_json(parsed["manifest"]),
                "size": len(container),
            })
        except Exception as error:
            code = getattr(error, "code", None)
            self._send_json(400, {
                "ok": False,
                "code": code,
                "error": str(error)[:240],
            })

    def _handle_ntp_query(self, query):
        """Return bounded, parallel NTP observations for the local Clock app."""
        raw_hosts = query.get("host", [])
        hosts = []
        for value in raw_hosts:
            host = value.strip().lower()
            if host and host not in hosts:
                hosts.append(host)
            if len(hosts) == MAX_NTP_SOURCES:
                break
        invalid = [host for host in hosts if len(host) > 253 or "://" in host or "/" in host or "\\" in host]
        if not hosts or invalid:
            self._send_json(400, {"ok": False, "error": "provide 1-8 valid NTP host query parameters"})
            return

        started = time.perf_counter()
        print(f"[TimeSync][query][entry] sources={len(hosts)}")
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(hosts), thread_name_prefix="ntp") as executor:
            results = list(executor.map(_query_ntp_host, hosts))
        successes = sum(1 for item in results if item["ok"])
        duration_ms = round((time.perf_counter() - started) * 1000, 3)
        print(f"[TimeSync][query][exit] success={successes}/{len(hosts)} durationMs={duration_ms}")
        self._send_json(200, {
            "ok": successes > 0,
            "results": results,
            "requested": len(hosts),
            "successful": successes,
            "durationMs": duration_ms,
        })

    def _send_json(self, status, payload):
        content = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def end_headers(self):
        """Add CORS headers, cache control, and cross-origin isolation headers."""
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Access-Control-Allow-Origin', '*')
        # Cross-origin isolation headers for SharedArrayBuffer and measureUserAgentSpecificMemory
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        if unquote(urlsplit(self.path).path).endswith('/core/compute/ComputeWorker.js'):
            # Workers have their own CSP; approved kernels need local imports
            # and Wasm but no network or nested worker access.
            self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'")
            self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


class QuietTCPServer(socketserver.ThreadingTCPServer):
    """Threaded so one slow/aborted request can't block others, and silences
    the default traceback dump for benign client-side connection drops."""

    daemon_threads = True
    allow_reuse_address = True
    # The default listen backlog of 5 refuses connections when a page imports
    # hundreds of ES modules at once (seen as net::ERR_CONNECTION_REFUSED).
    request_queue_size = 128

    def handle_error(self, request, client_address):
        exc_type = sys.exc_info()[0]
        if exc_type in (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            return
        super().handle_error(request, client_address)


def start_server():
    """Start the HTTP server in a background thread."""
    os.chdir(PROJECT_ROOT)
    
    with QuietTCPServer((HOST, PORT), QuietHTTPRequestHandler) as httpd:
        print(f"✓ Server started at {INDEX_URL}")
        print(f"✓ Project root: {PROJECT_ROOT}")
        print(f"✓ State Channels: {'SSE standard enabled' if STATE_CHANNEL_SSE_ENABLED else 'disabled'}")
        print(f"✓ Press Ctrl+C to stop the server")
        print()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n✓ Server stopped")
            sys.exit(0)


def open_browser():
    """Open the project hub in the default browser."""
    time.sleep(1)  # Wait for server to start
    print(f"✓ Opening browser at {INDEX_URL}")
    webbrowser.open(INDEX_URL)


def main():
    """Main entry point."""
    print("=" * 60)
    print("Engine v2 Project Hub")
    print("=" * 60)
    print()
    
    # Start server in background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Open browser
    browser_thread = threading.Thread(target=open_browser, daemon=False)
    browser_thread.start()
    
    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n✓ Shutting down...")
        sys.exit(0)


if __name__ == "__main__":
    main()
