# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Train a tiny deterministic policy that predicts when TokenCodec is worth trying.

This remakes the useful PS training pattern (measure, label, balance, export) as
an offline standard-library tool. It does not import PS, Torch, a checkpoint,
or any server code. Correctness never depends on the model: JHC still encodes a
candidate and keeps it only when its measured bytes are smaller than raw.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Iterable

from jhc import JhcPackage, TokenCodec


FEATURES = (
    "log2_bytes",
    "ascii_ratio",
    "whitespace_ratio",
    "identifier_ratio",
    "unique_byte_ratio",
    "repeated_quad_ratio",
)
TEXT_SUFFIXES = {".js": "js", ".mjs": "js", ".html": "html", ".htm": "html", ".css": "css", ".json": "json"}


def extract_features(data: bytes) -> dict[str, float]:
    """Return bounded, deterministic byte-level features."""
    size = len(data)
    if not size:
        return {name: 0.0 for name in FEATURES}
    ascii_count = sum(byte < 128 for byte in data)
    whitespace_count = sum(byte in b" \t\r\n" for byte in data)
    identifier_count = sum(
        48 <= byte <= 57 or 65 <= byte <= 90 or 97 <= byte <= 122 or byte in (36, 95)
        for byte in data
    )
    quad_count = max(0, size - 3)
    unique_quads = len({data[i:i + 4] for i in range(quad_count)}) if quad_count else 0
    return {
        "log2_bytes": math.log2(size + 1),
        "ascii_ratio": ascii_count / size,
        "whitespace_ratio": whitespace_count / size,
        "identifier_ratio": identifier_count / size,
        "unique_byte_ratio": len(set(data)) / min(size, 256),
        "repeated_quad_ratio": 1.0 - (unique_quads / quad_count) if quad_count else 0.0,
    }


def _gini(rows: list[dict]) -> float:
    if not rows:
        return 0.0
    positives = sum(row["label"] for row in rows)
    p = positives / len(rows)
    return 2.0 * p * (1.0 - p)


def _leaf(rows: list[dict]) -> dict:
    positives = sum(row["label"] for row in rows)
    probability = positives / len(rows) if rows else 0.0
    return {"leaf": True, "tryToken": probability >= 0.5, "probability": round(probability, 6), "samples": len(rows)}


def train_tree(rows: list[dict], max_depth: int = 4, min_leaf: int = 4, depth: int = 0) -> dict:
    """Train a compact CART-style binary classifier with deterministic ties."""
    if depth >= max_depth or len(rows) < min_leaf * 2 or _gini(rows) == 0.0:
        return _leaf(rows)
    best = None
    parent_cost = _gini(rows) * len(rows)
    for feature in FEATURES:
        values = sorted({row["features"][feature] for row in rows})
        if len(values) > 64:
            values = [values[round(i * (len(values) - 1) / 64)] for i in range(65)]
        for left_value, right_value in zip(values, values[1:]):
            threshold = (left_value + right_value) / 2.0
            left = [row for row in rows if row["features"][feature] <= threshold]
            right = [row for row in rows if row["features"][feature] > threshold]
            if len(left) < min_leaf or len(right) < min_leaf:
                continue
            cost = _gini(left) * len(left) + _gini(right) * len(right)
            candidate = (cost, feature, threshold, left, right)
            if best is None or candidate[:3] < best[:3]:
                best = candidate
    if best is None or best[0] >= parent_cost:
        return _leaf(rows)
    _, feature, threshold, left, right = best
    return {
        "leaf": False,
        "feature": feature,
        "threshold": round(threshold, 9),
        "left": train_tree(left, max_depth, min_leaf, depth + 1),
        "right": train_tree(right, max_depth, min_leaf, depth + 1),
    }


def predict(model: dict, features: dict[str, float]) -> bool:
    """Evaluate a validated policy tree without executing model-supplied code."""
    node = model
    for _ in range(16):
        if node.get("leaf") is True:
            return node.get("tryToken") is True
        feature = node.get("feature")
        if feature not in FEATURES or not isinstance(node.get("threshold"), (int, float)):
            raise ValueError("Invalid adaptive codec policy node")
        node = node.get("left") if features[feature] <= node["threshold"] else node.get("right")
        if not isinstance(node, dict):
            raise ValueError("Invalid adaptive codec policy branch")
    raise ValueError("Adaptive codec policy exceeds maximum depth")


def _canonical(value: dict) -> bytes:
    # Use the exact JHC Python/JavaScript canonical profile so the browser can
    # independently verify the exported policy digest.
    return JhcPackage._canonical_json(value).encode("utf-8")


def seal_policy(payload: dict) -> dict:
    """Add a deterministic integrity digest; release signatures provide identity."""
    return {**payload, "integrity": {"algorithm": "SHA-256", "payloadSha256": hashlib.sha256(_canonical(payload)).hexdigest()}}


def verify_policy(policy: dict) -> dict:
    integrity = policy.get("integrity")
    payload = {key: value for key, value in policy.items() if key != "integrity"}
    expected = hashlib.sha256(_canonical(payload)).hexdigest()
    if integrity != {"algorithm": "SHA-256", "payloadSha256": expected}:
        raise ValueError("Adaptive codec policy integrity check failed")
    predict(payload["model"], {name: 0.0 for name in FEATURES})
    return payload


def collect_rows(roots: Iterable[Path]) -> tuple[list[dict], str, Counter]:
    rows = []
    corpus_hash = hashlib.sha256()
    outcomes = Counter()
    paths = sorted(
        path for root in roots for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES
        and path.name != "adaptive-codec-policy.json"
    )
    for path in paths:
        try:
            data = path.read_bytes()
            text = data.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        language = TEXT_SUFFIXES[path.suffix.lower()]
        encoded = TokenCodec.encode(text, language)
        label = int(len(encoded) < len(data))
        outcomes["token_wins" if label else "raw_wins"] += 1
        corpus_hash.update(path.as_posix().encode("utf-8"))
        corpus_hash.update(b"\0")
        corpus_hash.update(hashlib.sha256(data).digest())
        rows.append({"path": path.as_posix(), "features": extract_features(data), "label": label, "rawBytes": len(data), "tokenBytes": len(encoded)})
    return rows, corpus_hash.hexdigest(), outcomes


def build_policy(roots: Iterable[Path], max_depth: int = 4, min_leaf: int = 4) -> dict:
    rows, corpus_sha256, outcomes = collect_rows(roots)
    if not rows:
        raise ValueError("No UTF-8 JS/HTML/CSS/JSON training files found")
    model = train_tree(rows, max_depth=max_depth, min_leaf=min_leaf)
    correct = sum(predict(model, row["features"]) == bool(row["label"]) for row in rows)
    payload = {
        "schema": "jhc-adaptive-policy-v1",
        "features": list(FEATURES),
        "model": model,
        "training": {
            "files": len(rows),
            "corpusSha256": corpus_sha256,
            "tokenWins": outcomes["token_wins"],
            "rawWins": outcomes["raw_wins"],
            "trainingAccuracy": round(correct / len(rows), 6),
            "maxDepth": max_depth,
            "minLeaf": min_leaf,
        },
        "safety": {"advisoryOnly": True, "measureCandidateBeforeUse": True, "neverExpand": True},
    }
    return seal_policy(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Train an offline JHC TokenCodec attempt policy")
    parser.add_argument("corpus", nargs="+", type=Path, help="Corpus directories; PS may be supplied only as offline input")
    parser.add_argument("--output", type=Path, required=True, help="Output JSON policy")
    parser.add_argument("--max-depth", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--min-leaf", type=int, default=4)
    args = parser.parse_args()
    policy = build_policy(args.corpus, args.max_depth, max(1, args.min_leaf))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(policy, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(policy["training"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
