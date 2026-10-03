# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Artifact-only SDK04 configuration/clean checks over supplied immutable bytes.

No filesystem, process, compiler or SDK helper is used by these checks. Absolute
names are retained provenance keys supplied to the reader, never reopened here.
"""
import json
import math
import re
import shlex

from bundler.combined_native import hash_map, metadata, require, sha
from bundler.flow_combined import _canonical
from bundler.source_build_command_trace import verify_full_command_transcript

CONFIG_SCHEMA = 'physx-pe.source-build-producer-configuration/v1'
DESCRIPTOR_SCHEMA = 'physx-pe.configured-source-build-observation/v1'
LOCK_SHA = '68518bb32b68e724030b66440ea4d9b2b23f56cf10a01606cdbf0a7f620788c7'
PRODUCER_ROLES = ('parent', 'child', 'sdkManifest', 'staticAudit')
PRODUCER_STATUSES = {'parent': 'FULL_SOURCE_COMPILED_NOT_RUNTIME_VERIFIED',
    'child': 'COMPILED_NOT_RUNTIME_VERIFIED', 'sdkManifest': None,
    'staticAudit': 'COMPILED_ARTIFACTS_STATICALLY_REVIEWED_NOT_RUNTIME_VERIFIED'}


def absolute(path):
    require(isinstance(path, str) and path and '\x00' not in path, 'missing absolute provenance')
    result = _canonical(path)
    require(re.match(r'^[A-Za-z]:/', result) or result.startswith('/'), 'relative provenance path')
    require(all(part not in ('.', '..') for part in result.split('/')), 'non-normal provenance path')
    return result


def joined(root, name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name
        and not name.startswith('/') and all(part not in ('', '.', '..') for part in name.split('/')),
        'unsafe relative clean input')
    return absolute(root).rstrip('/') + '/' + name


def checked_ref(row):
    require(isinstance(row, dict) and set(row) == {'path', 'sha256', 'bytes'}
        and type(row.get('bytes')) is int and row['bytes'] > 0
        and hash_map({'ref': row.get('sha256')}), 'invalid explicit original reference')
    absolute(row['path'])
    return row


def verify_configuration(config):
    require(isinstance(config, dict) and set(config) == {'schema', 'sourceRoot', 'sourceRevision',
        'sourceInventorySha256', 'version', 'producerReceipts', 'producerStatuses', 'producerLog',
        'cleanObservation', 'cleanObserverSource', 'staticAuditSource', 'staticAuditDialect',
        'historicalManifest', 'historicalStaticAudit', 'sdkVerification', 'sdkFunctionalObservation', 'collectorSources'}
        and config.get('schema') == CONFIG_SCHEMA, 'unsupported explicit producer configuration')
    root = absolute(config['sourceRoot'])
    revision = config['sourceRevision']
    require(isinstance(revision, dict) and set(revision) == {'commit', 'tree', 'inventorySha256'}
        and all(isinstance(revision[key], str) and re.fullmatch('[0-9a-f]{40}', revision[key])
            for key in ('commit', 'tree')) and hash_map({'inventory': revision['inventorySha256']})
        and config['sourceInventorySha256'] == revision['inventorySha256'], 'configuration revision differs')
    require(isinstance(config['version'], str) and re.fullmatch(r'5\.11\.0-alpha\.[1-9][0-9]*', config['version']),
        'configuration version is not explicit')
    require(config['staticAuditDialect'] in ('direct-link-v2', 'direct-link-postjs-v2'),
        'configured static audit dialect is unknown')
    require(set(config['producerReceipts']) == set(PRODUCER_ROLES)
        and config['producerStatuses'] == PRODUCER_STATUSES, 'producer roles/statuses differ')
    refs = [*config['producerReceipts'].values(), *(config[name] for name in
        ('producerLog', 'cleanObservation', 'cleanObserverSource', 'staticAuditSource', 'historicalManifest', 'historicalStaticAudit', 'sdkVerification', 'sdkFunctionalObservation'))]
    keys = []
    for row in refs:
        checked_ref(row)
        path = absolute(row['path'])
        require(path.startswith(root + '/'), 'configured producer leaves source root')
        key = path.casefold() if re.match(r'^[A-Za-z]:/', path) else path
        require(key not in keys, 'duplicate configured physical producer alias')
        keys.append(key)
    observer_dir = absolute(config['cleanObservation']['path']).rsplit('/', 1)[0]
    require(absolute(config['cleanObserverSource']['path']) == observer_dir + '/run.py'
        and observer_dir.startswith(root + '/reports/'), 'clean observer source/report scope differs')
    parent = absolute(config['producerReceipts']['parent']['path'])
    require(re.fullmatch(re.escape(root) + r'/reports/full-source-build-[0-9]+\.json', parent)
        and absolute(config['producerLog']['path']) == parent.removesuffix('.json') + '.log',
        'configured parent/log scope differs')
    require(absolute(config['producerReceipts']['child']['path']) == joined(root, 'reports/release-build.json')
        and absolute(config['producerReceipts']['sdkManifest']['path']) == joined(root, 'dist/candidate/build-manifest.json'),
        'raw SDK producer path differs')
    require(hash_map(config['collectorSources']) and all(absolute(path) == path for path in config['collectorSources']),
        'collector source closure is not explicit')
    return config


def ref_document(read, row):
    checked_ref(row)
    return read.document(row['path'], {key: row[key] for key in ('sha256', 'bytes')})


def verify_config_bindings(read, config, outer, inner, sdk, descriptor=None):
    verify_configuration(config)
    root = absolute(config['sourceRoot'])
    require(absolute(outer['sourceRoot']) == root and outer['sourceRevisionBefore'] == config['sourceRevision']
        and inner['version'] == config['version'] and inner['sourceRevision'] == config['sourceRevision'],
        'configured producer revision/version differs')
    require(sha(json.dumps(outer['sourceHashesBefore'], sort_keys=True, separators=(',', ':')).encode())
        == config['sourceInventorySha256'], 'configured source inventory differs')
    for role in PRODUCER_ROLES:
        value = ref_document(read, config['producerReceipts'][role])
        require(value.get('status') == config['producerStatuses'][role], 'original producer status differs')
    require(ref_document(read, config['producerReceipts']['parent']) == outer
        and ref_document(read, config['producerReceipts']['child']) == inner
        and ref_document(read, config['producerReceipts']['sdkManifest']) == sdk, 'configured raw producer differs')
    read.source(config['producerLog']['path'], {k: config['producerLog'][k] for k in ('sha256', 'bytes')})
    require(config['producerLog']['sha256'] == outer['logSha256'], 'configured original log differs')
    for path, digest in config['collectorSources'].items():
        read.source(path, digest)
    if descriptor is not None:
        require(descriptor.get('schema') == DESCRIPTOR_SCHEMA
            and descriptor.get('producerReceipts') == config['producerReceipts']
            and descriptor.get('producerStatuses') == config['producerStatuses']
            and descriptor.get('cleanBuildObservation') == config['cleanObservation']
            and descriptor.get('sdkFunctionalEvidence') == {name: config[name]
                for name in ('sdkVerification', 'sdkFunctionalObservation')}, 'configured descriptor lineage differs')


def verify_clean_binding(read, config, outer):
    """Bind the separate clean to the original one-step parent, never insert it."""
    from datetime import datetime

    verify_configuration(config)
    root = absolute(config['sourceRoot'])
    base = absolute(config['cleanObservation']['path'])[len(root) + 1:].rsplit('/', 1)[0] + '/'
    parent_name = absolute(config['producerReceipts']['parent']['path'])[len(root) + 1:]
    parent_log_name = absolute(config['producerLog']['path'])[len(root) + 1:]
    output = joined(root, 'work/candidate/PhysX/physx/compiler/emscripten-release')
    observed = ref_document(read, config['cleanObservation'])
    runner = read.source(config['cleanObserverSource']['path'],
        {key: config['cleanObserverSource'][key] for key in ('sha256', 'bytes')})
    require(sha(runner) == config['cleanObserverSource']['sha256'] and observed.get('runnerSha256') == sha(runner),
        'actual clean runner bytes differ')
    require(observed.get('schema') == 'physx-pe.same-lock-clean-build-observation/v1'
        and observed.get('status') == 'SAME_LOCK_CLEAN_AND_FULL_SOURCE_COMPILED_NOT_RUNTIME_VERIFIED'
        and all(observed.get(name) is False for name in ('runtimeExecuted', 'gpuExecuted', 'installPerformed', 'releaseAdmitted'))
        and 'error' not in observed and 'failurePost' not in observed, 'clean/build observer incomplete or failed')
    require(observed.get('sourceRevision') == config['sourceRevision'] == outer['sourceRevisionBefore']
        and outer.get('status') == PRODUCER_STATUSES['parent']
        and len(outer.get('steps', [])) == 1, 'clean mutated or targets another original parent')
    for field, name in (('originalDriverSha256', 'tools/source_kit_windows.py'), ('originalReleaseSha256', 'release.py')):
        require(observed.get(field) == outer['sourceHashesBefore'][name], 'clean observer used changed original driver')
        read.source(joined(root, name), observed[field])
    lock = outer['sharedPerformanceLock']
    require(observed.get('sharedPerformanceLock') == lock and lock.get('sha256') == LOCK_SHA
        and lock.get('environmentOverridden') is False
        and observed.get('lockAcquiredUtc') == outer['lockAcquiredUtc'], 'clean did not share the original held lock')
    read.source(lock['helper'], LOCK_SHA)
    desc = observed['description']
    require(desc.get('sourceRevision') == config['sourceRevision'] and desc.get('originalParentStepCount') == 1
        and desc.get('cleanIsSeparateReceipt') is True and desc.get('recursiveDeletePerformed') is False
        and desc.get('sourceFilesEdited') is False
        and absolute(desc.get('parentReport')) == absolute(config['producerReceipts']['parent']['path'])
        and absolute(desc.get('cleanReport')) == joined(root, base + 'clean.json'), 'clean description scope differs')
    parent_row = outer['steps'][0]
    require(observed.get('actualFullBuildStep') == parent_row and desc.get('fullBuildArgv') == parent_row['argv'],
        'original compile command/row was replaced')

    def relative_ref(name, filename, extras=None):
        row = observed[name]
        require(set(row) == {'file', 'sha256', 'bytes'} | set(extras or {}) and row['file'] == filename,
            'unexpected clean observed reference: ' + name)
        if extras:
            require(all(row.get(k) == v for k, v in extras.items()), 'clean original parent reference status/count differs')
        return {'path': joined(root, row['file']), **{k: row[k] for k in ('sha256', 'bytes')}}

    require(relative_ref('parentReceipt', parent_name,
        {'status': PRODUCER_STATUSES['parent'], 'stepCount': 1}) == config['producerReceipts']['parent']
        and relative_ref('parentLog', parent_log_name) == config['producerLog'], 'clean parent raw bytes differ')
    clean = ref_document(read, relative_ref('cleanReport', base + 'clean.json'))
    require(clean.get('schema') == 'physx-pe.source-kit-cmake-clean/v1' and clean.get('status') == 'CMAKE_CLEAN_SUCCEEDED'
        and clean.get('sourceRevision') == config['sourceRevision'] and clean.get('sharedPerformanceLock') == lock
        and clean.get('parentLockAcquiredUtc') == outer['lockAcquiredUtc']
        and clean.get('parentReport') == parent_name
        and clean.get('scope') == 'Real CMake clean target only; no source deletion, compile or runtime assertion.'
        and 'error' not in clean and len(clean.get('steps', [])) == 1, 'separate clean producer failed or changed')
    clean_row = clean['steps'][0]
    for row in (clean_row, parent_row):
        require(row.get('status') == 'PASS' and type(row.get('exitCode')) is int and row['exitCode'] == 0
            and type(row.get('elapsedSeconds')) in (int, float) and math.isfinite(row['elapsedSeconds'])
            and row['elapsedSeconds'] >= 0, 'actual clean/compile step failed')
    require(clean_row['argv'] == desc.get('cleanArgv'), 'separate clean command differs')
    a, b = clean_row['argv'], parent_row['argv']
    require(len(a) == len(b) == 7 and a[:6] == b[:6] == ['wsl.exe', '-d', 'Ubuntu-24.04', '--', 'bash', '-c'],
        'clean/compiler WSL route differs')
    a_prefix, a_command = a[6].rsplit('; exec ', 1)
    b_prefix, b_command = b[6].rsplit('; exec ', 1)
    argv = shlex.split(a_command)
    require(a_prefix == b_prefix and len(argv) == 5 and argv[:2] == ['/usr/bin/cmake', '--build']
        and absolute(argv[2]) == output and argv[3:] == ['--target', 'clean'], 'clean uses another environment/target')
    build = shlex.split(b_command)
    require(len(build) == 5 and build[:4] == ['/usr/bin/python3', 'release.py', 'build', '--slangc'],
        'original full build command differs')
    lock_time, clean_start, clean_end, build_start, build_end = [datetime.fromisoformat(value) for value in
        (outer['lockAcquiredUtc'], clean_row['startedUtc'], clean_row['finishedUtc'], parent_row['startedUtc'], parent_row['finishedUtc'])]
    start, end = (datetime.fromisoformat(observed[name]) for name in ('startedUtc', 'finishedUtc'))
    require(all(t.tzinfo is not None for t in (start, lock_time, clean_start, clean_end, build_start, build_end, end))
        and start <= lock_time <= clean_start <= clean_end <= build_start <= build_end <= end,
        'same-lock clean/build intervals differ')
    log = read.source(joined(root, base + 'clean.log'), clean['logSha256'])
    require(('COMMAND ' + json.dumps(a)).encode() in log, 'separate actual clean command log omitted')
    trace = observed['actualProducerTrace']
    require(set(trace) == {'file', 'bytes', 'sha256'}
        and trace['file'] == base + 'producer-commands.log', 'actual compiler trace metadata differs')
    producer_trace = read.source(joined(root, trace['file']), {k: trace[k] for k in ('bytes', 'sha256')})
    transcript = read.source(config['producerLog']['path'], {k: config['producerLog'][k] for k in ('bytes', 'sha256')})
    rows = re.findall(r'Building CXX object ([^\r\n]+)', transcript.decode('utf-8', errors='replace'))
    require(observed.get('cmakeTranscriptObservation') == {'cxxMessageCount': len(rows),
        'uniqueCxxObjectCount': len(set(rows)), 'uniqueCxxObjectPaths': sorted(set(rows))}, 'actual CMake transcript counts differ')
    cmake = observed['cmake']
    require(cmake == clean.get('cmake') == desc.get('cmake') and absolute(cmake.get('outputRoot')) == output
        and absolute(cmake.get('actualHomeDirectory')) == joined(root, 'work/candidate/PhysX/physx/compiler/public')
        and cmake.get('actualMakeProgram') == '/usr/bin/gmake', 'scoped CMake input differs')
    snapshots = []
    for name, filename in (('beforeClean', 'before-clean.json'), ('afterClean', 'after-clean.json'), ('afterBuild', 'after-build.json')):
        snap = ref_document(read, relative_ref(name, base + filename))
        require(snap.get('schema') == 'physx-pe.cmake-generated-output-observation/v1'
            and isinstance(snap.get('files'), dict) and snap['files'], 'generated observation schema differs')
        for path, row in snap['files'].items():
            require(joined(root, path).startswith(output + '/') and set(row) == {'sha256', 'bytes', 'mtimeNs'}
                and type(row['bytes']) is int and row['bytes'] >= 0 and type(row['mtimeNs']) is int and row['mtimeNs'] >= 0
                and hash_map({'file': row['sha256']}), 'generated snapshot entry differs')
        require(snap.get('objectPaths') == sorted(path for path in snap['files'] if path.endswith('.o')),
            'generated object observation coverage differs')
        snapshots.append(snap)
    before, after_clean, after_build = snapshots
    verify_full_command_transcript(read, observed.get('fullCmakeTranscriptObservation'), producer_trace,
        trace, root, output, base, after_build)
    times = [datetime.fromisoformat(snap['observedUtc']) for snap in snapshots]
    require(all(t.tzinfo is not None for t in times) and lock_time <= times[0] <= clean_start
        and clean_end <= times[1] <= build_start and build_end <= times[2] <= end, 'generated snapshot chronology differs')
    old, cleaned, rebuilt = (set(snap['objectPaths']) for snap in snapshots)
    require(all(type(observed.get(name)) is int for name in
        ('removedPriorObjectCount', 'recreatedPriorObjectCount', 'actualObjectCount'))
        and old and not old.intersection(cleaned) and old <= rebuilt
        and observed.get('removedPriorObjectCount') == len(old)
        and observed.get('recreatedPriorObjectCount') == len(old)
        and observed.get('actualObjectCount') == len(rebuilt), 'clean/rebuild object evidence is incomplete')
    cache_name = 'work/candidate/PhysX/physx/compiler/emscripten-release/CMakeCache.txt'
    require(cmake['cache'] == {k: before['files'][cache_name][k] for k in ('bytes', 'sha256')}, 'original CMake cache identity differs')
    history = observed['historicalPreservation']
    archive = ref_document(read, config['historicalManifest'])
    require(history['manifest'] == {k: config['historicalManifest'][k] for k in ('bytes', 'sha256')}
        and archive.get('schema') == 'physx-pe.historical-build-and-failure-byte-archive/v1'
        and archive.get('status') == 'ORIGINAL_BYTES_PRESERVED_NOT_NEW_VERIFICATION'
        and history.get('originalObjectCount') == 5 and history.get('originalArchiveCount') == 9
        and history.get('allGeneratedFilesPreserved') == len(before['files']) and history.get('allDirectInputsPreserved') == 14
        and all(archive['files'].get(path) == {k: row[k] for k in ('bytes', 'sha256')}
            for path, row in before['files'].items()), 'historical preservation metadata differs')
    # Historical bytes retain their archive path, never alias a newly rebuilt file.
    archive_ref = archive['archive']
    read.source(joined(root, archive_ref['path'].replace('\\', '/')), {k: archive_ref[k] for k in ('bytes', 'sha256')})
    require(history['originalDirectLinkRule'] == {k: config['historicalStaticAudit'][k] for k in ('bytes', 'sha256')},
        'historical original static audit identity differs')
    historical = ref_document(read, config['historicalStaticAudit'])
    historical_link = historical['finalLink']
    require(historical_link.get('linkMode') == 'direct-nine-archive-link' and historical_link.get('archiveCount') == 9
        and historical_link.get('mriMergeClaimed') is False and len(historical_link.get('inputs', {})) == 14
        and sum(path.endswith('.o') for path in historical_link['inputs']) == 5
        and sum(path.endswith('.a') for path in historical_link['inputs']) == 9,
        'historical link metadata differs')
    for path, row in historical_link['inputs'].items():
        original = absolute(path) if path.startswith('/') else joined(absolute(historical_link['workingDirectory']), path)
        require(original.startswith(root + '/') and archive['files'].get(original[len(root) + 1:]) == row,
            'historical link input was not archived')
    return observed


def verify_static_audit04(read, config, audit, outer, sdk):
    """Read the actual v2 fields, with no compatibility dictionary or status alias."""
    root = absolute(config['sourceRoot'])
    require(audit.get('schema') == 'physx-pe.final-build-audit/v2'
        and audit.get('status') == PRODUCER_STATUSES['staticAudit']
        and audit.get('version') == config['version'] and audit.get('sourceRevision') == config['sourceRevision']
        and audit.get('artifacts') == sdk['artifacts']
        and all(audit.get(name) is False for name in ('runtimeExecuted', 'engineAdmitted', 'installed', 'published')),
        'actual v2 static observation differs')
    read.source(config['staticAuditSource']['path'], {k: config['staticAuditSource'][k] for k in ('bytes', 'sha256')})
    require(absolute(config['staticAuditSource']['path']) == absolute(config['producerReceipts']['staticAudit']['path']).rsplit('/', 1)[0] + '/run.py',
        'static observer source is not adjacent to its report')
    expected_checks = ('actualCommittedSource', 'actualParentChildAdmission', 'realSameLockClean',
        'compilerAndReferenceAfterGuards', 'all96CompiledCAbiTypes', 'generatedDeclarations',
        'complete124ShaderClosure', 'actual27NativeRecipe', 'strictDirect5Object9ArchiveRule')
    if config['staticAuditDialect'] == 'direct-link-postjs-v2':
        expected_checks += ('uniqueO3TwoOwnedPostJsInputs', 'fullActualCmakeTranscript')
        require(isinstance(audit.get('checks'), dict) and all(value is True for value in audit['checks'].values()),
            'post-JS static observation checks must be actual true booleans')
    require(audit.get('checks') == dict.fromkeys(expected_checks, True)
        and audit.get('sourcePathCount') == len(outer['sourceHashesBefore'])
        and audit.get('flowShaderFileCount') == 252 and audit.get('blastTranslationUnitCount') == 27
        and audit.get('compiledCAbiFunctionCount') == 96, 'static observation coverage differs')
    functions = audit.get('compiledCAbiFunctions')
    require(isinstance(functions, dict) and len(functions) == 96, 'compiled C ABI coverage omitted')
    symbols = set()
    for name, row in functions.items():
        require(name.startswith('_pr_') and set(row) == {'nativeSymbol', 'expected', 'observed', 'equal'}
            and type(row.get('equal')) is bool and row['equal'] is True and row['expected'] == row['observed']
            and isinstance(row['nativeSymbol'], str) and row['nativeSymbol'] not in symbols,
            'compiled C ABI type or unique mapping differs')
        require(isinstance(row['expected'], list) and len(row['expected']) == 2
            and all(isinstance(values, list) and all(type(value) is int and value in (0x7f, 0x7e, 0x7d, 0x7c)
                for value in values) for values in row['expected']), 'compiled C ABI type array differs')
        symbols.add(row['nativeSymbol'])
    observer = audit['cAbiObserver']
    require(set(observer) == {'file', 'sha256', 'scannerOriginalSha256', 'scannerObservedSha256'}
        and hash_map({k: observer[k] for k in ('sha256', 'scannerOriginalSha256', 'scannerObservedSha256')}),
        'compiled C ABI observer provenance omitted')
    read.source(observer['file'], observer['sha256'])
    clean_dir = absolute(config['cleanObservation']['path']).rsplit('/', 1)[0]
    expected_paths = {absolute(config['producerReceipts'][role]['path']) for role in ('parent', 'child', 'sdkManifest')}
    expected_paths |= {absolute(config['producerLog']['path']), absolute(config['cleanObservation']['path']),
        clean_dir + '/clean.json', clean_dir + '/clean.log',
        joined(root, 'dist/flow-host/build-manifest.json'), joined(root, sdk['selected_native_source_build']['reportPath'])}
    if config['staticAuditDialect'] == 'direct-link-postjs-v2':
        expected_paths |= {absolute(config['cleanObserverSource']['path']),
            clean_dir + '/producer-commands.log', clean_dir + '/cmake-full-command.log',
            clean_dir + '/cmake-full-stdout.log', clean_dir + '/after-build.json'}
    require({joined(root, path) for path in audit.get('receipts', {})} == expected_paths, 'v2 original receipt closure differs')
    for path, row in audit['receipts'].items():
        read.source(joined(root, path), row)
    if config['staticAuditDialect'] == 'direct-link-postjs-v2':
        observed = ref_document(read, config['cleanObservation'])
        require(observed.get('runnerSha256') == config['cleanObserverSource']['sha256']
            and observed.get('sourceRevision') == config['sourceRevision'],
            'static full transcript belongs to another clean observer')
        base = clean_dir[len(root) + 1:] + '/'
        trace_ref = observed.get('actualProducerTrace')
        require(isinstance(trace_ref, dict) and set(trace_ref) == {'file', 'bytes', 'sha256'}
            and trace_ref['file'] == base + 'producer-commands.log', 'static full trace path differs')
        trace = read.source(joined(root, trace_ref['file']), {k: trace_ref[k] for k in ('bytes', 'sha256')})
        after_ref = observed.get('afterBuild')
        require(isinstance(after_ref, dict) and set(after_ref) == {'file', 'bytes', 'sha256'}
            and after_ref['file'] == base + 'after-build.json', 'static after-build path differs')
        after = read.document(joined(root, after_ref['file']), {k: after_ref[k] for k in ('bytes', 'sha256')})
        parsed = verify_full_command_transcript(read, observed.get('fullCmakeTranscriptObservation'),
            trace, trace_ref, root, joined(root, 'work/candidate/PhysX/physx/compiler/emscripten-release'), base, after)
        parent_log = read.source(config['producerLog']['path'], {k: config['producerLog'][k] for k in ('bytes', 'sha256')})
        limited = re.findall(r'Building CXX object ([^\r\n]+)', parent_log.decode('utf-8', errors='replace'))
        require(observed.get('cmakeTranscriptObservation') == {'cxxMessageCount': len(limited),
            'uniqueCxxObjectCount': len(set(limited)), 'uniqueCxxObjectPaths': sorted(set(limited))},
            'static limited parent transcript differs')
        summary = {'sourceTrace': trace_ref, **{k: parsed[k] for k in
            ('cxxMessageCount', 'uniqueCxxObjectCount', 'exitCode', 'elapsedSeconds')},
            'limitedParentLogMessageCount': len(limited)}
        require(audit.get('fullCmakeTranscript') == summary
            and all(type(audit['fullCmakeTranscript'].get(k)) is int for k in
                ('cxxMessageCount', 'uniqueCxxObjectCount', 'exitCode', 'limitedParentLogMessageCount')),
            'static full transcript summary differs from actual raw command')
    link = audit['finalLink']
    if config['staticAuditDialect'] == 'direct-link-postjs-v2':
        arguments = [link['argv'][i + 1] for i, value in enumerate(link['argv']) if value == '--post-js']
        require(type(link.get('postJsCount')) is int and link['postJsCount'] == 2
            and len(arguments) == len(set(arguments)) == 2 and set(link.get('postJs', {})) == set(arguments),
            'explicit post-JS observation is missing or ambiguous')
        for name, row in link['postJs'].items():
            require(set(row) == {'relativePath', 'bytes', 'sha256'}, 'post-JS observed metadata differs')
            observed_path = absolute(name) if name.startswith('/') else joined(absolute(link['workingDirectory']), name)
            require(joined(root, row['relativePath']) == observed_path, 'post-JS observed source path differs')
            read.source(observed_path, {key: row[key] for key in ('bytes', 'sha256')})
    else:
        require('postJsCount' not in link and 'postJs' not in link,
            'post-JS-aware observation cannot silently use the historical dialect')
