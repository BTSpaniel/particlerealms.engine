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
from urllib.parse import unquote, urlsplit
import zipfile

# Dynamic loading of the delivered HTTP server must not add SDK cache files.
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOFTWARE_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUDeveloperFeatures',
                 '--use-gl=angle', '--use-angle=swiftshader', '--use-vulkan=swiftshader',
                 '--disable-vulkan-surface']


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
        self.send_error(403, 'CI blocks external network access')

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


def smoke_mount(browser, package, root, mount, server_module, integrity, software, images):
    result = {'package': package, 'mount': mount, 'status': 'RUNNING', 'cases': [],
              'diagnostics': {key: [] for key in ('pageErrors', 'consoleErrors', 'httpErrors', 'externalRequests')}}
    diagnostics = result['diagnostics']
    with package_server(root, mount, server_module) as (origin, requests), contained_proxy(origin) as (proxy_url, proxy):
        context = browser.new_context(service_workers='block', viewport={'width': 1000, 'height': 800},
                                      proxy={'server': proxy_url, 'bypass': '<-loopback>'})

        def admit(route):
            url = route.request.url
            if url.startswith(origin + '/') or urlsplit(url).scheme in ('blob', 'data'):
                route.continue_()
            else:
                diagnostics['externalRequests'].append(url)
                route.abort('blockedbyclient')

        context.route('**/*', admit)
        context.on('request', lambda request: diagnostics['externalRequests'].append(request.url)
            if not request.url.startswith(origin + '/') and urlsplit(request.url).scheme not in ('blob', 'data') else None)
        context.on('response', lambda response: diagnostics['httpErrors'].append({'url': response.url, 'status': response.status})
            if response.status >= 400 else None)
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
                if software:
                    result['softwareSuite'] = 'RUNNING'
                    result['softwareAdapter'] = page.evaluate(ADAPTER_PROBE)
                    for mode in ('source', 'compiled'):
                        for name in ('engine', 'worker'):
                            print(f'[browser-ci] {package} {mount} software {mode} {name}', flush=True)
                            result['cases'].append(shipped_example(page, base + f'examples/{mode}.html?case={name}',
                                f'Software WebGPU {name}', mode))
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
            # Installed branded Chrome search-engine CONNECT probes are denied,
            # recorded raw, and separated from requests observed in this context.
            # No product/worker request is excluded, including this exact host.
            background = [url for url in proxy.blocked if url == 'www.google.com:443']
            diagnostics['externalRequests'].extend(url for url in proxy.blocked if url not in background)
            result['networkContainment'] = {'proxyBlocked': list(proxy.blocked), 'browserBackgroundDenied': background,
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
            result['networkContainment'] = {'proxyBlocked': list(proxy.blocked),
                'browserBackgroundDenied': [url for url in proxy.blocked if url == 'www.google.com:443'],
                'proxyFailures': list(proxy.failures), 'forwarded': proxy.forwarded,
                'serviceWorkers': 'blocked', 'onlyOrigin': origin}
            try:
                page.screenshot(path=str(images / f'last-{package}-{mount.strip("/") or "root"}.png'))
            except Exception as capture_error:
                result['screenshotError'] = str(capture_error)
            (images / f'{package}-{mount.strip("/") or "root"}.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
            context.close()
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
    inputs = {name: path.read_bytes() for name, path in {
        'runner': Path(__file__), 'sdkManifest': sdk / 'manifest.json', 'server': sdk / 'serve_sdk.py',
        'scenarios': sdk / 'examples/scenarios.js', 'templateArchive': ROOT / 'Template.zip'}.items()}
    report = {'schema': 'particle-sdk-ci-browser/v1', 'status': 'RUNNING', 'webgpu': args.webgpu,
        'inputsSha256': {name: hashlib.sha256(payload).hexdigest() for name, payload in inputs.items()}, 'mounts': [],
        'gpuSuite': {'status': 'NOT_RUN', 'reason': 'Software suite not started' if args.webgpu == 'software' else
                     'CPU baseline; rendering and GPU Surface Field transport were not executed'},
        'scope': 'Distributed bytes only. No source rebuilding, native Flow, hardware qualification or performance claim.'}
    started = time.perf_counter()
    try:
        manifest = json.loads(inputs['sdkManifest'])
        for name in ('serve_sdk.py', 'examples/scenarios.js'):
            record = manifest['files'][name]
            payload = (sdk / name).read_bytes()
            if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
                raise ValueError('Shipped CI input differs from SDK receipt: ' + name)
        module_spec = importlib.util.spec_from_file_location('sdk_ci_server', sdk / 'serve_sdk.py')
        server_module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(server_module)
        with tempfile.TemporaryDirectory(prefix='particle-sdk-ci-template-') as temporary:
            template, receipt = extract_template(ROOT / 'Template.zip', Path(temporary))
            from playwright.sync_api import sync_playwright
            launch_args = ['--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
                           '--disable-features=AutofillServerCommunication,OptimizationHints,MediaRouter,Translate']
            if args.webgpu == 'software':
                launch_args.extend(SOFTWARE_ARGS)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True,
                    channel='chromium' if args.browser is None else None,
                    executable_path=str(args.browser) if args.browser else None,
                    proxy={'server': 'http://per-context'}, args=launch_args)
                report['browserVersion'], report['launchArgs'] = browser.version, launch_args
                try:
                    browser_session = browser.new_browser_cdp_session()
                    try:
                        report['browserCommandLine'] = browser_session.send('Browser.getBrowserCommandLine')['arguments']
                    finally:
                        browser_session.detach()
                    for package, root, integrity in (('sdk', sdk, manifest['bundle']['browser_runtime_integrity']),
                                                      ('template', template, receipt['runtime']['integrity'])):
                        for mount in ('/', '/ci-nested/'):
                            print(f'[browser-ci] {package} {mount} {args.webgpu}', flush=True)
                            result = smoke_mount(browser, package, root, mount, server_module, integrity,
                                                 args.webgpu == 'software', images)
                            report['mounts'].append(result)
                            if result['status'] != 'PASS':
                                raise AssertionError(result['error'])
                finally:
                    browser.close()
        if args.webgpu == 'software':
            report['gpuSuite'] = {'status': 'PASS', 'requestedBackend': 'swiftshader',
                'adapters': [mount['softwareAdapter'] for mount in report['mounts'] if mount['package'] == 'sdk'],
                'scope': 'Actual shipped Engine rendering and Surface Field GPU transport, source+compiled, root+nested; Plauna CPU interaction. Template CPU smoke. No Flow or hardware qualification.'}
        if (Path(__file__).read_bytes() != inputs['runner'] or (sdk / 'manifest.json').read_bytes() != inputs['sdkManifest']
                or (sdk / 'serve_sdk.py').read_bytes() != inputs['server']
                or (sdk / 'examples/scenarios.js').read_bytes() != inputs['scenarios']
                or (ROOT / 'Template.zip').read_bytes() != inputs['templateArchive']):
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
