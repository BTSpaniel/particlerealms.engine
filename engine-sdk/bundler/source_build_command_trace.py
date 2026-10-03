# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Parse retained raw producer bytes, never echoed/truncated parent stdout."""
import math
import re
import shlex

from bundler.combined_native import metadata, require
from bundler.flow_combined import _canonical


def cmake_command_block(trace, root, output):
    """Return exact source ranges and derived facts for one real lab.run block.

    `stdoutBytes` is the output region in the original log, including its writer's
    newline separator. It is not claimed to be a new subprocess capture.
    """
    require(type(trace) is bytes, 'producer command trace must be immutable bytes')
    headers = list(re.finditer(rb'(?m)^\$ (cmake --build [^\r\n]+)\r?\nCWD: ([^\r\n]+)\r?\n', trace))
    require(len(headers) == 1, 'full producer trace lacks a unique original CMake command')
    header = headers[0]
    argv = shlex.split(header.group(1).decode('utf-8'))
    cwd = header.group(2).decode('utf-8')
    require(len(argv) == 5 and argv[:2] == ['cmake', '--build'] and _canonical(argv[2]) == _canonical(output)
        and argv[3:] == ['--parallel', '8'] and _canonical(cwd) == _canonical(root),
        'full CMake command targets another output/root or changes parallelism')
    start = header.start()
    end = trace.find(b'\n$ ', header.end())
    if end < 0:
        end = len(trace)
    block = trace[start:end]
    # A nested `+ cmake` stdout echo is never a command boundary or evidence.
    footers = list(re.finditer(rb'(?m)^EXIT: (-?[0-9]+); elapsed seconds: ([0-9]+(?:\.[0-9]+)?)\r?$', block))
    require(len(footers) == 1, 'full CMake block lacks one original exit footer')
    footer = footers[0]
    require(not block[footer.end():].strip(), 'unexpected data after original CMake exit footer')
    exit_code = int(footer.group(1)); elapsed = float(footer.group(2))
    require(exit_code == 0 and math.isfinite(elapsed) and elapsed >= 0, 'original CMake command failed')
    stdout_start, stdout_end = header.end(), start + footer.start()
    require(stdout_start <= stdout_end, 'CMake output precedes its header')
    stdout = trace[stdout_start:stdout_end]
    paths = [row.decode('utf-8') for row in re.findall(rb'Building CXX object ([^\r\n]+)', stdout)]
    require(paths and all(path.endswith('.o') and not path.startswith('/') and '\\' not in path and ':' not in path
        and all(part not in ('', '.', '..') for part in path.split('/')) for path in paths),
        'actual CMake compilation rows are missing or unsafe')
    return {'actualArgv': argv, 'actualCwd': cwd, 'exitCode': exit_code, 'elapsedSeconds': elapsed,
        'block': {**metadata(block), 'sourceByteStart': start, 'sourceByteEnd': end},
        'stdout': {**metadata(stdout), 'sourceByteStart': stdout_start, 'sourceByteEnd': stdout_end},
        'cxxMessageCount': len(paths), 'uniqueCxxObjectCount': len(set(paths)), 'cxxObjectPaths': sorted(set(paths)),
        'blockBytes': block, 'stdoutBytes': stdout}


def verify_full_command_transcript(read, value, trace, source_ref, root, output, base, after_build):
    """Require the separately retained complete observation and exact raw slices."""
    require(isinstance(value, dict) and set(value) == {'sourceTrace', 'actualArgv', 'actualCwd', 'exitCode',
        'elapsedSeconds', 'block', 'stdout', 'cxxMessageCount', 'uniqueCxxObjectCount', 'cxxObjectPaths'},
        'missing or unknown full CMake transcript observation')
    require(value['sourceTrace'] == source_ref, 'full CMake observation references another producer trace')
    parsed = cmake_command_block(trace, root, output)
    for name in ('actualArgv', 'actualCwd', 'exitCode', 'elapsedSeconds', 'cxxMessageCount', 'uniqueCxxObjectCount', 'cxxObjectPaths'):
        require(value[name] == parsed[name], 'full CMake transcript fact differs: ' + name)
    require(all(type(value[name]) is int for name in ('exitCode', 'cxxMessageCount', 'uniqueCxxObjectCount'))
        and type(value['elapsedSeconds']) in (int, float), 'full CMake transcript has untyped counts')
    for name, filename in (('block', 'cmake-full-command.log'), ('stdout', 'cmake-full-stdout.log')):
        row = value[name]
        require(isinstance(row, dict) and set(row) == {'file', 'bytes', 'sha256', 'sourceByteStart', 'sourceByteEnd'}
            and row['file'] == base + filename and type(row['bytes']) is int
            and type(row['sourceByteStart']) is int and type(row['sourceByteEnd']) is int,
            'full CMake slice reference differs')
        require({key: row[key] for key in parsed[name]} == parsed[name], 'full CMake raw slice/range differs')
        raw = read.source(_canonical(root) + '/' + row['file'], {key: row[key] for key in ('bytes', 'sha256')})
        require(raw == parsed[name + 'Bytes'], 'retained CMake slice differs from full trace bytes')
    output_relative = _canonical(output)[len(_canonical(root)) + 1:]
    emitted = {output_relative + '/' + path for path in parsed['cxxObjectPaths']}
    require(emitted <= set(after_build['objectPaths']), 'full CMake emitted objects are missing from after-build observation')
    return parsed
