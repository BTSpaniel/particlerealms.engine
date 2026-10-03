# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Exercise the extracted-build network guard without weakening its boundary."""

import subprocess
import sys
import textwrap
import tempfile
from pathlib import Path
from unittest import TestCase, main

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from sdk.rebuild_acceptance import _OFFLINE_BOOTSTRAP


def spawned_network_and_compression_probe(payload):
    """Run actual codec work and socket rejection inside a spawned worker."""
    import hashlib
    import os
    import socket
    from bundler.compress import compress_gzip

    denied = []
    with socket.socket() as tcp, socket.socket(type=socket.SOCK_DGRAM) as udp:
        operations = (
            ('DNS', lambda: socket.getaddrinfo('localhost', 9)),
            ('TCP', lambda: tcp.connect(('127.0.0.1', 9))),
            ('UDP', lambda: udp.sendto(b'sdk-offline-probe', ('127.0.0.1', 9))),
        )
        for name, operation in operations:
            try:
                operation()
            except RuntimeError as error:
                if 'Python network access is blocked' not in str(error):
                    raise
                denied.append(name)
            else:
                raise AssertionError(name + ' escaped the spawned worker guard')
    guard = socket.socket.connect.__globals__['_guard_source']
    return {'pid': os.getpid(), 'denied': denied, 'compressed': compress_gzip(payload, 6),
            'guardSha256': hashlib.sha256(guard.encode('utf-8')).hexdigest()}


class SDKOfflineNetworkTests(TestCase):
    def isolated(self, code, *, before='', timeout=30):
        completed = subprocess.run(
            [sys.executable, '-I', '-c', textwrap.dedent(before) + '\n'
             + _OFFLINE_BOOTSTRAP + '\n' + textwrap.dedent(code)],
            cwd=ROOT, capture_output=True, text=True, timeout=timeout,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        return completed.stdout

    def test_real_tcp_socketpair_exchanges_bytes_and_restores_scope(self):
        self.isolated('''
            families = (None, socket.AF_INET) if os.name == 'nt' else (None, socket.AF_UNIX)
            for family in families:
                pair = socket.socketpair() if family is None else socket.socketpair(family)
                with pair[0] as left, pair[1] as right:
                    left.sendall(b'sdk-self-pipe')
                    assert right.recv(64) == b'sdk-self-pipe'
                    right.sendall(b'ack')
                    assert left.recv(64) == b'ack'
                assert not _socketpair_scope.active
            with socket.socket() as client:
                try:
                    client.connect(('127.0.0.1', 9))
                except RuntimeError as error:
                    assert 'network access is blocked' in str(error)
                else:
                    raise AssertionError('ordinary loopback escaped the guard')
        ''')

    def test_real_asyncio_self_pipe_runs_and_closes(self):
        output = self.isolated('''
            import asyncio
            loop = asyncio.new_event_loop()
            try:
                assert loop.run_until_complete(asyncio.sleep(0, result='sdk')) == 'sdk'
                print(type(loop).__name__)
            finally:
                loop.close()
            assert not getattr(_socketpair_scope, 'active', False)
        ''')
        if sys.platform == 'win32':
            self.assertIn('ProactorEventLoop', output)

    def test_connections_are_rejected_before_the_operating_system_call(self):
        self.isolated('''
            destinations = [('127.0.0.1', 9), ('::1', 9), ('localhost', 9),
                            ('192.0.2.1', 443), ('2001:db8::1', 443)]
            for address in destinations:
                for operation in ('connect', 'connect_ex', 'create_connection'):
                    with socket.socket() as client:
                        try:
                            if operation == 'create_connection':
                                socket.create_connection(address)
                            else:
                                getattr(client, operation)(address)
                        except RuntimeError as error:
                            assert 'network access is blocked' in str(error)
                        else:
                            raise AssertionError((operation, address))
            # Even within the private scope, hostnames and external literals
            # cannot reach the saved OS operation.
            _socketpair_scope.active = True
            try:
                for address in [('localhost', 9), ('192.0.2.1', 443), ('2001:db8::1', 443)]:
                    with socket.socket() as client:
                        try:
                            client.connect(address)
                        except RuntimeError:
                            pass
                        else:
                            raise AssertionError(address)
            finally:
                _socketpair_scope.active = False
            assert not os_calls, os_calls
        ''', before='''
            import socket
            os_calls = []
            def record_os_call(*args, **kwargs):
                os_calls.append((args, kwargs))
                raise AssertionError('connection reached the operating system')
            socket.socket.connect = record_os_call
            socket.socket.connect_ex = record_os_call
            socket.create_connection = record_os_call
        ''')

    def test_concurrent_thread_does_not_inherit_socketpair_permission(self):
        self.isolated('''
            pairs, errors = [], []
            def make_pair():
                try:
                    family = socket.AF_INET if os.name == 'nt' else socket.AF_UNIX
                    pairs.append(socket.socketpair(family))
                except BaseException as error:
                    errors.append(error)
            worker = threading.Thread(target=make_pair)
            worker.start()
            assert entered.wait(5), 'socketpair did not enter its scoped wrapper'
            try:
                assert not getattr(_socketpair_scope, 'active', False)
                with socket.socket() as client:
                    try:
                        client.connect(('127.0.0.1', 9))
                    except RuntimeError:
                        pass
                    else:
                        raise AssertionError('concurrent thread acquired socketpair permission')
            finally:
                proceed.set()
                worker.join(5)
            assert not worker.is_alive() and not errors, errors
            assert len(pairs) == 1
            with pairs[0][0] as left, pairs[0][1] as right:
                left.sendall(b'thread-local')
                assert right.recv(64) == b'thread-local'
        ''', before='''
            import socket, threading
            original_pair = socket.socketpair
            entered, proceed = threading.Event(), threading.Event()
            def paused_pair(*args, **kwargs):
                entered.set()
                assert proceed.wait(5), 'concurrency test did not release socketpair'
                return original_pair(*args, **kwargs)
            socket.socketpair = paused_pair
        ''')

    def test_socketpair_failure_restores_permission(self):
        self.isolated('''
            try:
                socket.socketpair()
            except OSError as error:
                assert str(error) == 'pair creation failed'
            else:
                raise AssertionError('test socketpair did not fail')
            assert not _socketpair_scope.active
            with socket.socket() as client:
                try:
                    client.connect(('127.0.0.1', 9))
                except RuntimeError:
                    pass
                else:
                    raise AssertionError('failed socketpair left network permission active')
        ''', before='''
            import socket
            def failed_pair(*args, **kwargs):
                raise OSError('pair creation failed')
            socket.socketpair = failed_pair
        ''')

    def test_dns_udp_and_saved_socket_calls_are_blocked(self):
        self.isolated('''
            calls = [lambda: socket.getaddrinfo('example.invalid', 443),
                     lambda: socket.gethostbyname('example.invalid')]
            with socket.socket(type=socket.SOCK_DGRAM) as udp, socket.socket() as tcp:
                calls += [lambda: udp.sendto(b'x', ('127.0.0.1', 9)),
                          lambda: _socket_connect(tcp, ('127.0.0.1', 9))]
                for call in calls:
                    try:
                        call()
                    except RuntimeError as error:
                        assert 'network access is blocked' in str(error)
                    else:
                        raise AssertionError('socket operation escaped the offline guard')
        ''')

    def test_child_python_inherits_guard_and_runs_local_code(self):
        with tempfile.TemporaryDirectory(prefix='sdk-guard-child-') as temporary:
            script = Path(temporary) / 'child.py'
            script.write_text('''import socket
try:
    socket.create_connection(('127.0.0.1', 9))
except RuntimeError as error:
    assert 'network access is blocked' in str(error)
else:
    raise AssertionError('child escaped offline guard')
print('CHILD PASS')
''', encoding='utf-8')
            self.isolated(f'''
                result = subprocess.run([sys.executable, {str(script)!r}], capture_output=True, text=True)
                assert result.returncode == 0, result.stderr
                assert 'CHILD PASS' in result.stdout
            ''')

    def test_spawned_process_pool_blocks_network_and_preserves_compression(self):
        output = self.isolated('''
            import gzip, hashlib, multiprocessing, os, sys
            from concurrent.futures import ProcessPoolExecutor
            sys.path.insert(0, os.getcwd())
            from bundler.compress import compress_gzip
            from sdk.tests.test_rebuild_network import spawned_network_and_compression_probe
            payload = bytes(range(256)) * 1024
            with ProcessPoolExecutor(max_workers=2, mp_context=multiprocessing.get_context('spawn')) as pool:
                probes = [pool.submit(spawned_network_and_compression_probe, payload) for _ in range(2)]
                compressed = pool.submit(compress_gzip, payload, 6).result(timeout=20)
                results = [probe.result(timeout=20) for probe in probes]
            expected = compress_gzip(payload, 6)
            assert compressed == expected and gzip.decompress(compressed) == payload
            for result in results:
                assert result['pid'] != os.getpid(), 'Compression did not use a spawned process'
                assert result['denied'] == ['DNS', 'TCP', 'UDP'], result
                assert result['compressed'] == expected
                assert result['guardSha256'] == hashlib.sha256(_guard_source.encode('utf-8')).hexdigest()
            print('PASS spawned process compression; DNS/TCP/UDP blocked in workers')
        ''', timeout=45)
        self.assertIn('PASS spawned process compression', output)

    def test_native_tool_and_shell_spawns_are_blocked(self):
        self.isolated('''
            calls = [lambda: subprocess.run(['git', 'version']),
                     lambda: subprocess.run('echo unwanted', shell=True),
                     lambda: os.system('echo unwanted')]
            for call in calls:
                try:
                    call()
                except PermissionError:
                    pass
                else:
                    raise AssertionError('unguarded subprocess escaped the guard')
        ''')

    def test_real_playwright_local_syntax_gate_keeps_python_network_blocked(self):
        self.isolated('''
            import os, sys
            sys.path.insert(0, os.getcwd())
            from bundler.browser_syntax import assert_browser_classic_script_syntax
            assert_browser_classic_script_syntax(
                'globalThis.__SDK_CPU_PARSE_WITNESS__ = 1;', label='offline socketpair witness',
                timeout_seconds=30,
            )
            for address in [('127.0.0.1', 9), ('192.0.2.1', 443)]:
                with socket.socket() as client:
                    try:
                        client.connect(address)
                    except RuntimeError:
                        pass
                    else:
                        raise AssertionError('syntax gate weakened Python network guard')
            print('PASS real Chromium syntax gate; Python network remains blocked')
        ''', timeout=60)


if __name__ == '__main__':
    main()
