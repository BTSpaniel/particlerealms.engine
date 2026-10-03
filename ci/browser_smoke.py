# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Exercise the distributed SDK and extracted Template without repository fallback.

CPU smoke and software WebGPU are separate scopes. The latter executes the
unchanged shipped examples using Chromium's SwiftShader Vulkan driver;
neither scope qualifies production GPU hardware/Flow.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from functools import partial
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qsl, unquote, urlsplit
import zipfile

from sdk_scenarios import playground_case, selection_case
from network_trace import BrowserSocketTrace

# Dynamic loading of the delivered HTTP server must not add SDK cache files.
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOFTWARE_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUDeveloperFeatures',
                 '--use-gl=angle', '--use-angle=swiftshader', '--use-vulkan=swiftshader',
                 '--disable-vulkan-surface']
# Browser services must not compete with the package under test. These switches
# reduce attempts; the denying proxy remains the actual network boundary.
# https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
# https://chromium.googlesource.com/chromium/src/+/25e84d9ef2ae6b698d42ef95600ce1f86a95d409/components/network_time/network_time_tracker.cc
OFFLINE_BROWSER_ARGS = [
    '--enable-automation', '--disable-background-networking',
    '--disable-component-update', '--disable-domain-reliability', '--disable-sync',
    '--metrics-recording-only', '--no-first-run', '--proxy-bypass-list=<-loopback>',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--disable-features=AutofillServerCommunication,OptimizationHints,MediaRouter,Translate,NetworkTimeServiceQuerying',
]


def observe_package_network(context, origin, diagnostics):
    """Observe page and worker requests without any external-host exceptions."""
    def external(url):
        return not url.startswith(origin + '/') and urlsplit(url).scheme not in ('blob', 'data')

    def admit(route):
        if external(route.request.url):
            diagnostics['externalRequests'].append(route.request.url)
            route.abort('blockedbyclient')
        else:
            route.continue_()

    def admit_web_socket(route):
        # WebSocket handshakes do not use context.route(). Never connect an
        # external socket, even when its host is a known browser-service host.
        url = route.url
        http_url = 'http' + url[2:] if url.startswith(('ws://', 'wss://')) else url
        if external(http_url):
            diagnostics['externalRequests'].append(url)
            # An unconnected WebSocketRoute never contacts its server. Closing
            # it synchronously inside the creation callback deadlocks the
            # pinned Playwright driver; retain the denied attempt and let
            # context disposal release this intercepted socket.
            # https://playwright.dev/python/docs/api/class-websocketroute
        else:
            route.connect_to_server()

    def observe_page(page):
        page.on('websocket', lambda socket: diagnostics['externalRequests'].append(socket.url)
            if external('http' + socket.url[2:]) else None)

    context.route('**/*', admit)
    context.route_web_socket('**/*', admit_web_socket)
    context.on('page', observe_page)
    for page in context.pages:
        observe_page(page)
    context.on('request', lambda request: diagnostics['externalRequests'].append(request.url)
        if external(request.url) else None)
    context.on('response', lambda response: diagnostics['httpErrors'].append(
        {'url': response.url, 'status': response.status}) if response.status >= 400 else None)


def classify_proxy_denials(blocked, application_requests):
    """Classify denied browser maintenance probes, never permit a connection.

    Only exact destinations observed in Chromium CI are recognized. A matching
    page/worker request overrides this classification even if its route was
    aborted before reaching the proxy. Unknown destinations remain failures.
    """
    def authority(destination):
        try:
            parsed = urlsplit(destination if '://' in destination else 'https://' + destination)
            return parsed.hostname, parsed.port or (443 if parsed.scheme in ('https', 'wss') else 80)
        except ValueError:
            return None

    observed = {authority(url) for url in application_requests}
    background, unexpected = [], []
    known_connect = {'www.google.com:443', 'update.googleapis.com:443',
                     'accounts.google.com:443', 'android.clients.google.com:443'}
    for destination in blocked:
        known = destination in known_connect
        if not known:
            try:
                parsed = urlsplit(destination)
                query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
                known = (parsed.scheme == 'http' and parsed.netloc == 'clients2.google.com'
                    and parsed.path == '/time/1/current' and not parsed.fragment
                    and sorted(key for key, _ in query) == ['cup2hreq', 'cup2key']
                    and all(value for _, value in query))
            except ValueError:
                known = False
        if known and authority(destination) not in observed:
            background.append(destination)
        else:
            unexpected.append(destination)
    return {'browserBackgroundDenied': background, 'unexpectedProxyDenied': unexpected}


def contained_path(root, raw_path, mount):
    path = unquote(urlsplit(raw_path).path, errors='strict')
    if (not path.startswith(mount) or '\\' in path or '\0' in path
            or '%' in path or '..' in PurePosixPath(path).parts):
        raise ValueError('Request is outside the package mount')
    target = root.joinpath(*PurePosixPath(path[len(mount):]).parts).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Request escapes its package root')
    return target


@contextmanager
def package_server(root, mount, server_module):
    """Reuse the shipped MIME/isolation server with a strict URL mount."""
    observations = []

    class Handler(server_module.SDKRequestHandler):
        def _admit(self):
            try:
                contained_path(root, self.path, mount)
            except (ValueError, UnicodeError):
                self.send_error(404, 'Package route unavailable')
                return False
            return True

        def do_GET(self):
            if self._admit():
                super().do_GET()

        def do_HEAD(self):
            if self._admit():
                super().do_HEAD()

        def translate_path(self, path):
            return str(contained_path(root, path, mount))

        def log_request(self, code='-', size='-'):
            observations.append({'path': self.path, 'status': int(code)})

        def log_message(self, format, *args):
            pass

    server = server_module.SDKHTTPServer(('127.0.0.1', 0),
        partial(Handler, directory=str(root), isolate=True))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', observations
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class ContainedProxy(BaseHTTPRequestHandler):
    """Deny every destination except the one local package server."""
    protocol_version = 'HTTP/1.1'

    def do_CONNECT(self):
        self._deny(self.path)

    def _deny(self, destination):
        self.server.blocked.append(destination)
        try:
            self.send_error(403, 'CI blocks external network access')
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Denied browser probes may close their socket before reading 403.
            pass

    def do_GET(self):
        parsed = urlsplit(self.path)
        if (parsed.scheme != 'http' or parsed.username or parsed.password
                or f'{parsed.scheme}://{parsed.netloc}' != self.server.origin):
            self._deny(self.path)
            return
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=120)
        try:
            connection.request('GET', parsed.path + ('?' + parsed.query if parsed.query else ''))
            response = connection.getresponse()
            payload = response.read()
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in ('content-length', 'connection', 'transfer-encoding'):
                    self.send_header(name, value)
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            self.server.forwarded += 1
        except (OSError, http.client.HTTPException) as error:
            self.server.failures.append(str(error))
            self.send_error(502, 'Local package server unavailable')
        finally:
            connection.close()

    def log_message(self, format, *args):
        pass


@contextmanager
def contained_proxy(origin):
    server = ThreadingHTTPServer(('127.0.0.1', 0), ContainedProxy)
    server.daemon_threads = True
    server.origin, server.blocked, server.failures, server.forwarded = origin, [], [], 0
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def network_boundary_probe(browser):
    """Prove real page/worker HTTP and sockets cannot hide as browser traffic.

    Intentional denied requests use their own context, proxy and diagnostics,
    so they cannot be mistaken for requests made by the distributed application.
    This CPU-only check neither imports the SDK nor requests a GPU device.
    """
    expected = [
        'https://update.googleapis.com/page-boundary-probe',
        'https://update.googleapis.com/worker-boundary-probe',
        'wss://accounts.google.com/page-boundary-probe',
        'wss://android.clients.google.com/worker-boundary-probe',
    ]
    result = {'status': 'RUNNING', 'expectedDeniedApplicationRequests': expected,
              'diagnostics': {'externalRequests': [], 'httpErrors': []}}
    # No local HTTP request is needed. This reserved unserved endpoint also
    # makes accidental forwarding observable instead of serving extra content.
    origin = 'http://127.0.0.1:1'
    with contained_proxy(origin) as (proxy_url, proxy):
        trace = BrowserSocketTrace(browser)
        trace.start()
        context = browser.new_context(service_workers='block',
            proxy={'server': proxy_url, 'bypass': '<-loopback>'})
        try:
            observe_package_network(context, origin, result['diagnostics'])
            page = context.new_page()
            page.set_default_timeout(10000)
            page.set_content('<!doctype html><title>CI network boundary probe</title>')
            page.evaluate('''expected => {
                fetch(expected[0]).catch(() => {});
                const socket = new WebSocket(expected[2]); socket.onerror = () => {};
                const script = `fetch(${JSON.stringify(expected[1])}).catch(() => {});
                    const socket = new WebSocket(${JSON.stringify(expected[3])}); socket.onerror = () => {};
                    postMessage('requests-created');`;
                globalThis.__boundaryWorkerUrl = URL.createObjectURL(new Blob([script], {type:'text/javascript'}));
                globalThis.__boundaryWorker = new Worker(__boundaryWorkerUrl);
                __boundaryWorker.onmessage = () => { globalThis.__boundaryWorkerRequested = true; };
            }''', expected)
            deadline = time.monotonic() + 5
            def observed():
                requests = result['diagnostics']['externalRequests']
                return (set(expected[:3]).issubset(requests) and
                        page.evaluate('globalThis.__boundaryWorkerRequested === true'))

            while not observed() and time.monotonic() < deadline:
                page.wait_for_timeout(50)
            page.evaluate('''() => {
                __boundaryWorker.terminate(); URL.revokeObjectURL(__boundaryWorkerUrl);
                delete globalThis.__boundaryWorker; delete globalThis.__boundaryWorkerUrl;
            }''')
            result['status'] = 'PASS'
        except Exception as error:
            result.update(status='FAIL', error=str(error))
        finally:
            context.close()
            try:
                result['socketTrace'] = trace.finish()
                result['diagnostics']['externalRequests'].extend(result['socketTrace']['urls'])
            except Exception as error:
                result.update(status='FAIL', error='Browser socket trace failed: ' + str(error))
        result['missingObservations'] = sorted(set(expected) - set(result['diagnostics']['externalRequests']))
        if result['missingObservations']:
            result.update(status='FAIL', error='Application network attempts were not observed: ' + str(result['missingObservations']))
        result['networkContainment'] = {'proxyBlocked': list(proxy.blocked),
            **classify_proxy_denials(proxy.blocked, result['diagnostics']['externalRequests']),
            'forwarded': proxy.forwarded, 'proxyFailures': list(proxy.failures)}
        if proxy.forwarded or proxy.failures:
            result.update(status='FAIL', error='Boundary probe forwarded a request or failed its proxy')
    return result


def extract_template(archive, destination):
    with zipfile.ZipFile(archive) as package:
        seen = set()
        for item in package.infolist():
            path = PurePosixPath(item.filename)
            if (item.filename in seen or not item.filename.startswith('Template/')
                    or path.is_absolute() or '..' in path.parts or ':' in item.filename
                    or '\\' in item.filename or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError('Unsafe or duplicate Template archive member: ' + item.filename)
            seen.add(item.filename)
        if package.testzip():
            raise ValueError('Corrupt Template archive')
        package.extractall(destination)
    root = destination / 'Template'
    receipt = json.loads((root / 'template-manifest.json').read_text(encoding='utf-8'))
    actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file()}
    if actual != set(receipt['files']) | {'template-manifest.json'}:
        raise ValueError('Template membership differs from its receipt')
    for name, record in receipt['files'].items():
        payload = (root / name).read_bytes()
        if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
            raise ValueError('Template file differs from its receipt: ' + name)
    return root, receipt


CPU_PROBE = r'''async ({rootUrl,mode,integrity}) => {
    const engine=mode==='source' ? await import(new URL('engine/EngineBootstrap.js',rootUrl)) : await globalThis.__PE_RUNTIME_READY;
    const checks=[], resources=[], failures=[];
    const check=(name,ok,detail=null)=>{if(!ok)throw Error(name);checks.push({name,passed:true,detail});};
    let result={name:'Engine math/ECS/native PhysX',mode,status:'RUNNING',checks,cleanup:{status:'pending'}};
    try {
        check('Vector addition/cross/normalization match independent oracles',
            JSON.stringify(engine.vec3Add([1,2,3],[4,5,6]))==='[5,7,9]' &&
            JSON.stringify(engine.vec3Cross([1,0,0],[0,1,0]))==='[0,0,1]' &&
            Math.abs(engine.vec3Length(engine.vec3Normalize([3,4,0]))-1)<1e-12);
        if(mode==='compiled')check('Loader verified the declared runtime SRI',globalThis.__PE_RUNTIME_PROVENANCE__?.integrity===integrity);
        const world=engine.createWorld({name:'CI native CPU'}), entity=engine.createEntity(world);
        resources.push(['ECS entity',()=>{engine.destroyEntity(world,entity);check('Destroyed entity has no Transform',engine.getEntityComponent(world,entity,'Transform')===null);}]);
        engine.setEntityComponent(world,entity,'Transform',engine.createTransform({position:[0,2,0],scale:[.45,.45,.45]}));
        const physics=engine.particlePhysXPhysicsWorld, simulation=physics.createPhysicsWorld({gravity:[0,-9.81,0]});
        resources.push(['Native PhysX world',()=>{physics.destroyPhysicsWorld(simulation);check('PhysX world and bodies released',simulation.destroyed && simulation.bodies.size===0);}]);
        const deadline=performance.now()+30000;
        while(!simulation.ready && performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
        check('Real native PhysX world initialized',simulation.ready===true);
        physics.createBody(simulation,{simMode:'static',position:[0,-.5,0],collider:{shape:'box',halfExtents:[3,.5,3]}});
        const body=physics.createBody(simulation,{entityId:entity,simMode:'dynamic',mass:1,position:[0,2,0],collider:{shape:'box',halfExtents:[.45,.45,.45]}});
        for(let tick=0;tick<120;tick++)physics.stepPhysicsWorld(simulation,1/60);
        check('Native gravity and floor contact',body.position.every(Number.isFinite) && body.position[1]>.25 && body.position[1]<.8,{positionM:[...body.position],steps:120});
        engine.setEntityComponent(world,entity,'Transform',engine.createTransform({position:body.position,rotation:body.rotation,scale:[.45,.45,.45]}));
        check('ECS retains simulated pose',Math.abs(engine.getEntityComponent(world,entity,'Transform').position[1]-body.position[1])<1e-6);
        result.status='PASS';
    }catch(error){result.status='FAIL';result.error=String(error);}
    finally {
        const released=[];
        for(const [name,release]of resources.reverse())try{await release();released.push(name);}catch(error){failures.push(name+': '+error);}
        result.cleanup={status:failures.length?'failed':'passed',released,failures};
        if(failures.length)result.status='FAIL';
    }
    return result;
}'''

SNAPSHOT_PROBE = r'''async rootUrl => {
    const results=[];
    for(const relative of ['engine/sim/particles/SnapshotWorker.js','editor/SnapshotWorker.js']) {
        const worker=new Worker(new URL(relative,rootUrl),{type:'module'});
        const result={name:'Snapshot module worker '+relative,mode:'resource',status:'RUNNING',checks:[],cleanup:{status:'pending'}};
        let sequence=0;
        const request=(type,data)=>new Promise((resolve,reject)=>{
            const id=++sequence, timeout=setTimeout(()=>reject(Error('Snapshot worker timed out: '+type)),10000);
            worker.onerror=event=>{clearTimeout(timeout);reject(Error(event.message));};
            worker.onmessage=({data:reply})=>{if(reply.id!==id)return;clearTimeout(timeout);reply.type==='error'?reject(Error(reply.error)):resolve(reply.result??reply);};
            worker.postMessage({type,data,id});
        });
        const check=(name,ok,detail=null)=>{if(!ok)throw Error(name);result.checks.push({name,passed:true,detail});};
        try{
            await request('init',{keyframeInterval:60});
            const frame={positions:new Float32Array([10,20,30,0,40,50,60,0]),velocities:new Float32Array([1,2,3,0,4,5,6,0]),
                slotInfo:new Float32Array([1,10,1,10]),liveCount:2,instanceCount:2,freeSlots:[],particleCount:2,currentTimeMs:2000,emitterStates:{}};
            const first=await request('capture',frame);
            check('Keyframe quantization and live indices',first.isKeyframe===true && first.positions instanceof Int16Array &&
                JSON.stringify([...first.liveIndices])==='[0,1]' && Math.abs(first.positions[0]*10000/32767-10)<.16,
                {packedBytes:first.byteSize,positionSNORM:first.positions[0]});
            frame.positions[0]=11;frame.currentTimeMs=2010;
            const delta=await request('capture',frame);
            check('Delta records real position change',delta.isKeyframe===false && delta.changedIndices.includes(0) &&
                Math.abs(delta.positionDeltas[0]*10000/32767-1)<.16,{changed:[...delta.changedIndices]});
            await request('reset',{});
            check('Reset starts a new keyframe',(await request('capture',frame)).isKeyframe===true);
            result.status='PASS';
        }catch(error){result.status='FAIL';result.error=String(error);}
        finally{worker.terminate();result.cleanup={status:'passed',released:['Module worker terminated']};}
        results.push(result);
    }
    return results;
}'''

ADAPTER_PROBE = r'''async () => {
    if(!navigator.gpu)throw Error('Software WebGPU is unavailable');
    const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No software WebGPU adapter');
    const info=adapter.info??(adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    const identity=Object.fromEntries(['vendor','architecture','device','description'].map(key=>[key,info[key]??'']));
    const text=Object.values(identity).join(' ');
    const observed=/swiftshader/i.test(text)?'swiftshader':/lavapipe|llvmpipe/i.test(text)?'mesa-software':text.trim()?'other':'unreported';
    if(observed==='other')throw Error('Requested software backend but observed another adapter: '+text);
    const device=await adapter.requestDevice();device.destroy();await device.lost;
    return {requestedBackend:'swiftshader',observedBackend:observed,identity,isFallbackAdapter:info.isFallbackAdapter??adapter.isFallbackAdapter??null,
        deviceCreated:true,deviceDestroyed:true,scope:'Software WebGPU example smoke; no hardware, Flow, performance or device-matrix qualification'};
}'''


def require_case(result):
    if (result.get('status') not in ('PASS', 'passed') or not result.get('checks')
            or any(check.get('passed') is not True for check in result['checks'])
            or result.get('cleanup', {}).get('status') != 'passed'):
        raise AssertionError('Browser operation failed: ' + json.dumps(result))


def shipped_example(page, url, name, mode):
    page.goto(url, wait_until='domcontentloaded')
    page.wait_for_function("['passed','failed','unsupported'].includes(globalThis.__SDK_EXAMPLE_RESULT__?.status)")
    result = page.evaluate('globalThis.__SDK_EXAMPLE_RESULT__')
    if result.get('status') != 'passed':
        raise AssertionError('Shipped example failed: ' + json.dumps(result))
    for _ in range(2):
        page.evaluate('globalThis.__SDK_EXAMPLE_CLEANUP__()')
    result = page.evaluate('globalThis.__SDK_EXAMPLE_RESULT__')
    result['name'], result['mode'] = name, mode
    require_case(result)
    return result


def smoke_mount(browser, package, root, mount, server_module, integrity, software, images, doc_examples=()):
    result = {'package': package, 'mount': mount, 'status': 'RUNNING', 'cases': [],
              'diagnostics': {key: [] for key in ('pageErrors', 'consoleErrors', 'httpErrors', 'externalRequests')}}
    diagnostics = result['diagnostics']
    with package_server(root, mount, server_module) as (origin, requests), contained_proxy(origin) as (proxy_url, proxy):
        context = browser.new_context(service_workers='block', viewport={'width': 1000, 'height': 800},
                                      proxy={'server': proxy_url, 'bypass': '<-loopback>'})

        observe_package_network(context, origin, diagnostics)
        page = context.new_page()
        page.set_default_timeout(90000)
        page.on('pageerror', lambda error: diagnostics['pageErrors'].append(str(error)))
        page.on('console', lambda message: diagnostics['consoleErrors'].append(message.text) if message.type == 'error' else None)
        try:
            base = origin + mount
            page.goto(base, wait_until='domcontentloaded')
            if package == 'sdk':
                page.wait_for_function("['passed','failed'].includes(globalThis.__SDK_CHECK_RESULT__?.status)")
                if page.evaluate('globalThis.__SDK_CHECK_RESULT__.status') != 'passed':
                    raise AssertionError('Shipped SDK startup check failed')
                for mode in ('source', 'compiled'):
                    result['cases'].append(shipped_example(page, base + f'examples/{mode}.html?case=plauna', 'Plauna retained DOM interaction', mode))
                    operation = page.evaluate(CPU_PROBE, {'rootUrl': base, 'mode': mode, 'integrity': integrity})
                    require_case(operation)
                    result['cases'].append(operation)
                for worker in page.evaluate(SNAPSHOT_PROBE, base):
                    require_case(worker)
                    result['cases'].append(worker)
                for example in doc_examples:
                    print(f'[browser-ci] {package} {mount} Markdown {example["id"]}', flush=True)
                    # Each exact Markdown module gets a fresh document and the
                    # ordinary shipped loader; no prior scenario supplies its API.
                    page.goto(base + 'examples/docs-snippets.html', wait_until='domcontentloaded')
                    page.wait_for_function("typeof globalThis.runSdkDocSnippet === 'function'")
                    operation = page.evaluate(
                        'async ({record, rootUrl}) => runSdkDocSnippet(record, {rootUrl})',
                        {'record': example, 'rootUrl': base})
                    result['cases'].append(operation)
                    page.screenshot(path=str(images / f'docs-{example["id"]}-{mount.strip("/") or "root"}.png'))
                    require_case(operation)
                if software:
                    result['softwareSuite'] = 'RUNNING'
                    result['softwareAdapter'] = page.evaluate(ADAPTER_PROBE)
                    for mode in ('source', 'compiled'):
                        for name in ('engine', 'worker'):
                            print(f'[browser-ci] {package} {mount} software {mode} {name}', flush=True)
                            result['cases'].append(shipped_example(page, base + f'examples/{mode}.html?case={name}',
                                f'Software WebGPU {name}', mode))
                        for name, operation in (('selection', selection_case), ('playground', playground_case)):
                            print(f'[browser-ci] {package} {mount} software {mode} {name}', flush=True)
                            observed = operation(page, base, mode)
                            result['cases'].append(observed)
                            page.screenshot(path=str(images / f'{name}-{mode}-{mount.strip("/") or "root"}.png'))
                            require_case(observed)
                    result['softwareSuite'] = 'PASS'
            else:
                page.wait_for_function("document.querySelector('#boot-selector')?.classList.contains('visible')")
                namespaces = page.evaluate("async()=>{const api=await globalThis.__PE_RUNTIME_READY;return ['Engine','Editor','Plauna','AGI','WebGPUOS'].filter(name=>!!api[name]);}")
                if namespaces != ['Engine', 'Editor', 'Plauna', 'AGI', 'WebGPUOS']:
                    raise AssertionError('Template public Platform namespaces are incomplete')
                operation = page.evaluate(CPU_PROBE, {'rootUrl': base, 'mode': 'compiled', 'integrity': integrity})
                require_case(operation)
                result['cases'].append(operation)
                page.locator('[data-mode="plauna"]').click()
                page.wait_for_function("['running','failed'].includes(globalThis.__PE_TEMPLATE_STATE__?.phase)")
                if page.evaluate('globalThis.__PE_TEMPLATE_STATE__.phase') != 'running':
                    raise AssertionError('Template Plauna startup failed')
                before = page.locator('#plauna-gallery-content').inner_text()
                page.locator('#plauna-gallery nav button').nth(1).click()
                page.wait_for_function("text=>document.querySelector('#plauna-gallery-content')?.innerText!==text", arg=before)
                cleanup = page.evaluate('globalThis.__PE_TEMPLATE_CLEANUP__()')
                if page.evaluate('globalThis.__PE_TEMPLATE_CLEANUP__()') != cleanup or page.locator('#plauna-root').evaluate('(root)=>root.children.length'):
                    raise AssertionError('Template Plauna cleanup failed')
                ui = {'name': 'Template Plauna selector interaction', 'mode': 'compiled', 'status': 'PASS',
                      'checks': [{'name': 'Gallery native click changes content', 'passed': True}], 'cleanup': cleanup}
                require_case(ui)
                result['cases'].append(ui)
                result['namespaces'] = namespaces
            native = [request for request in requests if urlsplit(request['path']).path.endswith('.wasm') and 'physx' in request['path']]
            if not native or any(request['status'] != 200 for request in native):
                raise AssertionError('Real native PhysX WASM was not served successfully')
            result['nativeWasmRequests'] = native
            page.screenshot(path=str(images / f'{package}-{mount.strip("/") or "root"}.png'))
            denied = classify_proxy_denials(proxy.blocked, diagnostics['externalRequests'])
            diagnostics['externalRequests'].extend(denied['unexpectedProxyDenied'])
            result['networkContainment'] = {'proxyBlocked': list(proxy.blocked), **denied,
                'proxyFailures': proxy.failures, 'forwarded': proxy.forwarded, 'serviceWorkers': 'blocked', 'onlyOrigin': origin}
            if proxy.failures or any(diagnostics.values()):
                raise AssertionError('Unexpected browser diagnostics: ' + json.dumps(diagnostics))
            result['status'] = 'PASS'
        except Exception as error:
            result.update(status='FAIL', error=str(error))
            if result.get('softwareSuite') == 'RUNNING':
                result['softwareSuite'] = 'FAIL'
        finally:
            result['requests'] = requests
            try:
                page.screenshot(path=str(images / f'last-{package}-{mount.strip("/") or "root"}.png'))
            except Exception as capture_error:
                result['screenshotError'] = str(capture_error)
            context.close()
            denied = classify_proxy_denials(proxy.blocked, diagnostics['externalRequests'])
            result['networkContainment'] = {'proxyBlocked': list(proxy.blocked), **denied,
                'proxyFailures': list(proxy.failures), 'forwarded': proxy.forwarded,
                'serviceWorkers': 'blocked', 'onlyOrigin': origin}
            if any(diagnostics.values()) or proxy.failures or denied['unexpectedProxyDenied']:
                result.update(status='FAIL', error='Unexpected browser diagnostics after disposal: ' + json.dumps(diagnostics))
            (images / f'{package}-{mount.strip("/") or "root"}.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/browser.json')
    parser.add_argument('--webgpu', choices=('off', 'software'), default='off')
    parser.add_argument('--browser', type=Path, help='Use an installed Chromium; default: Playwright Chromium')
    args = parser.parse_args(argv)
    args.output = args.output.resolve()
    sdk = ROOT / 'engine-sdk'
    if args.output.is_relative_to(sdk):
        parser.error('--output must be outside the immutable SDK')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    images = args.output.with_suffix('')
    images.mkdir(parents=True, exist_ok=True)
    input_paths = {
        'runner': Path(__file__), 'sdkManifest': sdk / 'manifest.json', 'server': sdk / 'serve_sdk.py',
        'scenarios': sdk / 'examples/scenarios.js', 'templateArchive': ROOT / 'Template.zip',
        'scenarioHarness': Path(__file__).with_name('sdk_scenarios.py'),
        'exampleRunner': sdk / 'examples/runner.js', 'playground': sdk / 'examples/playground.js',
        'selectionRegression': sdk / 'examples/selection-regression.js',
        'docExtractor': sdk / 'sdk/doc_snippets.py',
        'networkTrace': Path(__file__).with_name('network_trace.py'),
        'docRunner': sdk / 'examples/docs-snippets.js', 'docPage': sdk / 'examples/docs-snippets.html',
        'engineDoc': sdk / 'MD/guides/sdk-distribution.md', 'plaunaDoc': sdk / 'MD/plauna/getting-started.md',
    }
    inputs = {name: path.read_bytes() for name, path in input_paths.items()}
    report = {'schema': 'particle-sdk-ci-browser/v1', 'status': 'RUNNING', 'webgpu': args.webgpu,
        'inputsSha256': {name: hashlib.sha256(payload).hexdigest() for name, payload in inputs.items()}, 'mounts': [],
        'gpuSuite': {'status': 'NOT_RUN', 'reason': 'Software suite not started' if args.webgpu == 'software' else
                     'CPU baseline; rendering and GPU Surface Field transport were not executed'},
        'scope': 'Distributed bytes only. No source rebuilding, native Flow, hardware qualification or performance claim.'}
    started = time.perf_counter()
    try:
        manifest = json.loads(inputs['sdkManifest'])
        for name in ('serve_sdk.py', 'examples/scenarios.js', 'examples/runner.js',
                     'examples/playground.js', 'examples/selection-regression.js', 'sdk/doc_snippets.py',
                     'examples/docs-snippets.js', 'examples/docs-snippets.html',
                     'MD/guides/sdk-distribution.md', 'MD/plauna/getting-started.md'):
            record = manifest['files'][name]
            payload = (sdk / name).read_bytes()
            if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
                raise ValueError('Shipped CI input differs from SDK receipt: ' + name)
        docs_spec = importlib.util.spec_from_file_location('sdk_ci_doc_snippets', sdk / 'sdk/doc_snippets.py')
        docs_module = importlib.util.module_from_spec(docs_spec)
        docs_spec.loader.exec_module(docs_module)
        doc_examples = docs_module.extract_sdk_doc_snippets(sdk)
        report['documentationExamples'] = [{key: value for key, value in example.items() if key != 'code'}
                                           for example in doc_examples]
        module_spec = importlib.util.spec_from_file_location('sdk_ci_server', sdk / 'serve_sdk.py')
        server_module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(server_module)
        with tempfile.TemporaryDirectory(prefix='particle-sdk-ci-template-') as temporary:
            template, receipt = extract_template(ROOT / 'Template.zip', Path(temporary))
            from playwright.sync_api import sync_playwright
            launch_args = list(OFFLINE_BROWSER_ARGS)
            if args.webgpu == 'software':
                launch_args.extend(SOFTWARE_ARGS)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True,
                    channel='chromium' if args.browser is None else None,
                    executable_path=str(args.browser) if args.browser else None,
                    proxy={'server': 'http://per-context'}, args=launch_args)
                report['browserVersion'], report['launchArgs'] = browser.version, launch_args
                try:
                    report['networkBoundaryProbe'] = network_boundary_probe(browser)
                    if report['networkBoundaryProbe']['status'] != 'PASS':
                        raise AssertionError('Network boundary probe failed: ' + json.dumps(report['networkBoundaryProbe']))
                    browser_session = browser.new_browser_cdp_session()
                    try:
                        report['browserCommandLine'] = browser_session.send('Browser.getBrowserCommandLine')['arguments']
                    finally:
                        browser_session.detach()
                    for package, root, integrity in (('sdk', sdk, manifest['bundle']['browser_runtime_integrity']),
                                                      ('template', template, receipt['runtime']['integrity'])):
                        for mount in ('/', '/ci-nested/'):
                            print(f'[browser-ci] {package} {mount} {args.webgpu}', flush=True)
                            socket_trace = BrowserSocketTrace(browser).start()
                            try:
                                result = smoke_mount(browser, package, root, mount, server_module, integrity,
                                                     args.webgpu == 'software', images, doc_examples)
                                report['mounts'].append(result)
                            finally:
                                trace_report = socket_trace.finish()
                            result['socketTrace'] = trace_report
                            origin = result['networkContainment']['onlyOrigin']
                            external_sockets = [url for url in trace_report['urls']
                                if not ('http' + url[2:]).startswith(origin + '/')]
                            if external_sockets:
                                result['diagnostics']['externalRequests'].extend(external_sockets)
                                result.update(status='FAIL', error='External browser/worker sockets: ' + json.dumps(external_sockets))
                            (images / f'{package}-{mount.strip("/") or "root"}.json').write_text(
                                json.dumps(result, indent=2) + '\n', encoding='utf-8')
                            if result['status'] != 'PASS':
                                raise AssertionError(result['error'])
                finally:
                    browser.close()
        if args.webgpu == 'software':
            report['gpuSuite'] = {'status': 'PASS', 'requestedBackend': 'swiftshader',
                'adapters': [mount['softwareAdapter'] for mount in report['mounts'] if mount['package'] == 'sdk'],
                'scope': 'Actual shipped Engine rendering, selection pixel regression, physics playground and Surface Field GPU transport, source+compiled, root+nested; exact Markdown examples and Plauna interaction. Template CPU smoke. No Flow or hardware qualification.'}
        if any(path.read_bytes() != inputs[name] for name, path in input_paths.items()):
            raise AssertionError('A pinned browser CI input changed during execution')
        report['status'] = 'PASS'
    except Exception as error:
        report.update(status='FAIL', error=str(error))
        if args.webgpu == 'software' and any(mount.get('softwareSuite') for mount in report['mounts']):
            report['gpuSuite'] = {'status': 'FAIL', 'requestedBackend': 'swiftshader', 'error': str(error)}
    finally:
        report['durationSeconds'] = round(time.perf_counter() - started, 3)
        report['elapsedSeconds'] = report['durationSeconds']
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({key: value for key, value in report.items() if key != 'mounts'}), flush=True)
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
