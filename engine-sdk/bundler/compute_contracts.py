# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Generate and verify local compute contracts; never fetch schema references.

Run ``python -m bundler.compute_contracts`` after editing canonical schemas.
``--check`` is read-only and is also enforced by the existing bundler CLI.
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = Path('engine/core/compute/schemas')
GENERATED = Path('engine/core/compute/ComputeContractSchemas.generated.js')
PROFILE = Path('engine/core/schema/json-schema-profile.json')
PROFILE_GENERATED = Path('engine/core/schema/JsonSchemaProfile.generated.js')
BASE = 'https://particlerealms.online/schemas/compute/'
DIALECT = 'https://json-schema.org/draft/2020-12/schema'


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False)


def _read_json(path):
    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result:
                raise ValueError(f'Duplicate JSON key {key!r} in {path}')
            result[key] = value
        return result

    def nonfinite(value):
        raise ValueError(f'Nonfinite JSON number {value} in {path}')

    raw = path.read_bytes()
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError(f'Compute schema input exceeds 8 MiB: {path}')
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    except RecursionError as error:
        raise ValueError(f'Compute schema input nesting exceeds supported limits: {path}') from error


def load_json_schema_profile(root=ROOT):
    profile = _read_json(Path(root) / PROFILE)
    if not isinstance(profile, dict) or profile.get('dialect') != DIALECT or set(profile) - {'dialect', 'types', 'annotations', 'keywords', '$comment'}:
        raise ValueError('Invalid shared JSON Schema profile')
    for field in ('types', 'annotations', 'keywords'):
        entries = profile.get(field)
        if not isinstance(entries, list) or not entries or not all(isinstance(item, str) and item for item in entries) or len(entries) != len(set(entries)):
            raise ValueError(f'Invalid shared JSON Schema profile {field}')
    if set(profile['annotations']) & set(profile['keywords']):
        raise ValueError('Shared JSON Schema annotations and assertions overlap')
    return profile


def validate_supported_profile(schema, profile):
    """Check only schema positions; const/default/examples remain ordinary JSON."""
    allowed = set(profile['annotations']) | set(profile['keywords'])
    nodes = 0

    def visit(node, depth):
        nonlocal nodes
        nodes += 1
        if nodes > 100000 or depth > 64:
            raise ValueError('Shared schema profile traversal limit exceeded')
        if isinstance(node, bool):
            return
        if not isinstance(node, dict):
            raise ValueError('A supported schema must be an object or boolean')
        for key in node:
            if key not in allowed and not key.startswith('x-'):
                raise ValueError(f'Unsupported shared JSON Schema keyword: {key}')
        if '$id' in node and depth:
            raise ValueError('Nested $id resource scopes are not supported')
        if '$schema' in node and node['$schema'] != profile['dialect']:
            raise ValueError('Unsupported shared JSON Schema dialect')
        if 'type' in node:
            types = node['type'] if isinstance(node['type'], list) else [node['type']]
            if not types or not all(isinstance(item, str) and item in profile['types'] for item in types):
                raise ValueError('Unsupported shared JSON Schema type')
        for key in ('properties', '$defs'):
            if key in node:
                if not isinstance(node[key], dict):
                    raise ValueError(f'Invalid schema map {key}')
                for sub in node[key].values():
                    visit(sub, depth + 1)
        for key in ('additionalProperties', 'items', 'not', 'if', 'then', 'else'):
            if key in node:
                visit(node[key], depth + 1)
        for key in ('prefixItems', 'oneOf', 'anyOf', 'allOf'):
            if key in node:
                if not isinstance(node[key], list):
                    raise ValueError(f'Invalid schema array {key}')
                for sub in node[key]:
                    visit(sub, depth + 1)

    visit(schema, 0)


def _schema_nodes(schema):
    """Enumerate schema locations without interpreting annotation/data objects."""
    yield schema
    if not isinstance(schema, dict):
        return
    for key in ('properties', '$defs'):
        for sub in schema.get(key, {}).values():
            yield from _schema_nodes(sub)
    for key in ('additionalProperties', 'items', 'not', 'if', 'then', 'else'):
        if key in schema:
            yield from _schema_nodes(schema[key])
    for key in ('prefixItems', 'oneOf', 'anyOf', 'allOf'):
        for sub in schema.get(key, []):
            yield from _schema_nodes(sub)


def load_compute_contracts(root=ROOT):
    """Read canonical v1 documents, checking identity and local reference closure."""
    contracts = {}
    profile = load_json_schema_profile(root)
    for path in sorted((Path(root) / SCHEMA_DIR).glob('*.v1.schema.json')):
        name = path.name.removesuffix('.v1.schema.json')
        doc = _read_json(path)
        if not isinstance(doc, dict) or doc.get('$id') != BASE + path.name or doc.get('$schema') != DIALECT:
            raise ValueError(f'Invalid compute contract identity: {path.name}')
        validate_supported_profile(doc, profile)
        contracts[name] = doc
    if not contracts:
        raise ValueError('Missing canonical compute contracts')
    ids = {doc['$id']: doc for doc in contracts.values()}

    pending = [(doc, doc['$id']) for doc in contracts.values()]
    visited = set()
    while pending:
        schema, current = pending.pop()
        if id(schema) in visited:
            continue
        visited.add(id(schema))
        for value in _schema_nodes(schema):
            if not isinstance(value, dict) or '$ref' not in value:
                continue
            reference = value['$ref']
            if not isinstance(reference, str) or len(reference) > 4096:
                raise ValueError('Invalid compute schema reference')
            target, _, fragment = reference.partition('#')
            resolved = ids.get(target or current)
            if resolved is None or re.search(r'%(?![0-9a-fA-F]{2})', fragment):
                raise ValueError(f'Nonlocal/unknown compute reference: {reference}')
            fragment = unquote(fragment, errors='strict')
            if fragment and not fragment.startswith('/'):
                raise ValueError(f'Unsupported compute reference fragment: {reference}')
            for key in fragment.split('/')[1:]:
                if re.search(r'~(?:[^01]|$)', key):
                    raise ValueError(f'Invalid compute reference escape: {reference}')
                key = key.replace('~1', '/').replace('~0', '~')
                if isinstance(resolved, list) and re.fullmatch(r'0|[1-9][0-9]*', key) and int(key) < len(resolved):
                    resolved = resolved[int(key)]
                elif isinstance(resolved, dict) and key in resolved:
                    resolved = resolved[key]
                else:
                    raise ValueError(f'Unresolved compute reference: {reference}')
            validate_supported_profile(resolved, profile)
            pending.append((resolved, target or current))
    return contracts


def contract_validators(root=ROOT):
    """Use the independent Draft validator with a closed, offline registry."""
    try:
        from jsonschema import Draft202012Validator
        from jsonschema.exceptions import ValidationError
        from jsonschema.validators import extend
        from referencing import Registry, Resource
    except ImportError as error:
        raise RuntimeError('Compute schema validation requires: python -m pip install -r bundler/requirements.txt') from error
    contracts = load_compute_contracts(root)

    def exact_multiple_of(validator, divisor, instance, _schema):
        if not validator.is_type(instance, 'number'):
            return
        try:
            if not math.isfinite(instance):
                raise ValueError('nonfinite JSON number')
            left = Decimal(str(instance)).as_tuple()
            right = Decimal(str(divisor)).as_tuple()
            left_coefficient = int(''.join(str(digit) for digit in left.digits))
            right_coefficient = int(''.join(str(digit) for digit in right.digits))
            shift = left.exponent - right.exponent
            matches = (left_coefficient * 10 ** shift) % right_coefficient == 0 if shift >= 0 else (
                left_coefficient % (right_coefficient * 10 ** -shift) == 0)
        except (TypeError, ValueError, OverflowError, ArithmeticError):
            matches = False
        if not matches:
            yield ValidationError(f'{instance!r} is not a multipleOf {divisor!r}')

    # Match the browser's exact finite decimal representation, avoiding the
    # stock float-modulo disagreement for JSON numbers such as 0.3 and 0.1.
    shared_validator = extend(Draft202012Validator, {'multipleOf': exact_multiple_of})

    def no_retrieve(uri):
        raise ValueError(f'Remote schema retrieval is forbidden: {uri}')

    registry = Registry(retrieve=no_retrieve).with_resources(
        (doc['$id'], Resource.from_contents(doc)) for doc in contracts.values())
    validators = {}
    for name, doc in contracts.items():
        try:
            Draft202012Validator.check_schema(doc)
        except Exception as error:
            raise ValueError(f'Invalid Draft 2020-12 compute schema {name}: {error.message if hasattr(error, "message") else error}') from error
        validators[name] = shared_validator(doc, registry=registry)
    return validators


def _generated_header():
    return ('// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n'
            '// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n'
            '// Generated by python -m bundler.compute_contracts. Do not hand-edit.\n')


def profile_generated_bytes(profile):
    encoded = _canonical(profile)
    return (_generated_header() + "import { deepFreezeJson } from './StrictJsonValue.js';\n"
            f'export const JSON_SCHEMA_PROFILE = deepFreezeJson({encoded});\n').encode('utf-8')


def generated_bytes(contracts, profile=None):
    profile = load_json_schema_profile() if profile is None else profile
    encoded = _canonical(contracts)
    digest = hashlib.sha256(_canonical({'profile': profile, 'contracts': contracts}).encode('utf-8')).hexdigest()
    return (_generated_header() + "import { deepFreezeJson } from '../schema/StrictJsonValue.js';\n"
            'export const COMPUTE_CONTRACT_SCHEMA_VERSION = 1;\n'
            f"export const COMPUTE_CONTRACT_SOURCE_HASH = '{digest}';\n"
            f'export const COMPUTE_CONTRACTS = deepFreezeJson({encoded});\n').encode('utf-8')


def verify_compute_contracts(root=ROOT, *, manifest=None):
    """Reject stale generated metadata and structurally incompatible artifacts."""
    root = Path(root)
    profile = load_json_schema_profile(root)
    contracts = load_compute_contracts(root)
    if not (root / PROFILE_GENERATED).is_file() or (root / PROFILE_GENERATED).read_bytes() != profile_generated_bytes(profile):
        raise ValueError('Stale shared JSON Schema profile module; run python -m bundler.compute_contracts')
    if not (root / GENERATED).is_file() or (root / GENERATED).read_bytes() != generated_bytes(contracts, profile):
        raise ValueError('Stale compute contract module; run python -m bundler.compute_contracts')
    validators = contract_validators(root)
    if manifest is not None:
        errors = sorted(validators['artifact-manifest'].iter_errors(manifest), key=lambda error: str(error.path))
        if errors:
            raise ValueError('Invalid compute artifact manifest schema: ' + errors[0].message)
    return contracts


def compute_contract_asset_paths(root=ROOT):
    """Canonical JSON ships for offline inspection; execution imports generated JS."""
    root = Path(root)
    return tuple(sorted([PROFILE.as_posix(), *(path.relative_to(root).as_posix() for path in (root / SCHEMA_DIR).glob('*.v1.schema.json'))]))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Reject stale contracts without writing')
    args = parser.parse_args(argv)
    if args.check:
        contracts = verify_compute_contracts()
    else:
        contracts = load_compute_contracts()
        contract_validators()
        profile = load_json_schema_profile()
        for relative, data in [(PROFILE_GENERATED, profile_generated_bytes(profile)), (GENERATED, generated_bytes(contracts, profile))]:
            target = ROOT / relative
            if not target.is_file() or target.read_bytes() != data:
                descriptor, temporary = tempfile.mkstemp(prefix='.' + target.name, dir=target.parent)
                try:
                    with os.fdopen(descriptor, 'wb') as stream:
                        stream.write(data)
                    os.replace(temporary, target)
                finally:
                    Path(temporary).unlink(missing_ok=True)
    print(f'[compute-contracts] {len(contracts)} local Draft 2020-12 contracts {"verified" if args.check else "generated"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
