# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Bounded physical transport for unchanged Engine demo runtime/ZIP bytes."""
import hashlib
import json
from pathlib import Path

from .runtime_transport import plan_compressed_artifact_parts, read_compressed_artifact, validate_compressed_artifact_parts

FORMAT = 'particle-engine-demo-transport/v1'
MAX_BYTES = 128 * 1024 * 1024


def descriptor_path(path):
    return Path(str(path) + '.transport.json')


def read_descriptor(path):
    path = Path(path)
    descriptor = descriptor_path(path)
    if descriptor.stat().st_size > 65536:
        raise ValueError('Engine demo transport descriptor is oversized')
    value = json.loads(descriptor.read_text(encoding='utf-8'))
    if (set(value) != {'format', 'name', 'bytes', 'sha256', 'parts'}
            or value['format'] != FORMAT or value['name'] != path.name
            or type(value['bytes']) is not int or not 0 < value['bytes'] <= MAX_BYTES
            or not isinstance(value['sha256'], str) or len(value['sha256']) != 64
            or any(c not in '0123456789abcdef' for c in value['sha256'])
            or not isinstance(value['parts'], list)):
        raise ValueError('Invalid Engine demo transport descriptor')
    if value['parts']:
        validate_compressed_artifact_parts(path.name, value['parts'], expected_bytes=value['bytes'])
    return value


def read_transport_file(path):
    path = Path(path)
    if not descriptor_path(path).exists():
        return path.read_bytes()
    record = read_descriptor(path)
    manifest = {'compressed_artifact_parts': {path.name: record['parts']}} if record['parts'] else {}
    data = read_compressed_artifact(path.parent, path.name, manifest, expected_bytes=record['bytes'], prefer_full=False)
    if hashlib.sha256(data).hexdigest() != record['sha256']:
        raise ValueError('Engine demo transport SHA-256 mismatch')
    return data


def transport_paths(path):
    path = Path(path)
    if not descriptor_path(path).exists():
        return (path,)
    record = read_descriptor(path)
    physical = tuple(path.parent / item['src'] for item in record['parts']) if record['parts'] else (path,)
    return (descriptor_path(path), *physical)


def publish_transport(path, max_file_bytes):
    """Called only inside an unpublished staging tree; directory commit is atomic."""
    path = Path(path)
    data = path.read_bytes()
    if not 0 < len(data) <= MAX_BYTES:
        raise ValueError('Engine demo artifact exceeds its logical byte bound')
    records, parts = plan_compressed_artifact_parts(path.name, data, max_file_bytes=max_file_bytes,
                                                   part_bytes=min(max_file_bytes, 16 * 1024 * 1024))
    for name, payload in parts.items():
        (path.parent / name).write_bytes(payload)
    descriptor_path(path).write_text(json.dumps({
        'format': FORMAT, 'name': path.name, 'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(), 'parts': records,
    }, indent=2) + '\n', encoding='utf-8')
    if read_transport_file(path) != data:
        raise ValueError('Engine demo transport did not preserve artifact bytes')
    if records:
        path.unlink()
    return records
