# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Compute artifacts must be reproducible, ABI-bound, and runnable in real browsers."""

import functools
import hashlib
from contextlib import contextmanager
import http.server
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from bundler.wasm import (
    ROOT, ARTIFACT_ROOT, KERNEL_ROOT, VARIANTS, build_compute_kernels,
    compute_release_asset_paths, inspect_wasm, kernel_source_hash, verify_compute_artifacts,
)
from bundler.cli import _release_build_input_digest
from bundler.emitter import rewrite_import_meta
from bundler.graph import ModuleGraph
from bundler.site import _verify_compute_sidecars
from bundler.compute_contracts import compute_contract_asset_paths


class TestComputeWasm(unittest.TestCase):
    def fixture(self, root):
        for relative in (KERNEL_ROOT, ARTIFACT_ROOT):
            shutil.copytree(ROOT / relative, root / relative)
        (root / "bundler").mkdir()
        shutil.copy2(ROOT / "bundler/wasm.py", root / "bundler/wasm.py")

    def test_cache_verifies_without_invoking_compiler(self):
        with mock.patch("bundler.wasm._run", side_effect=AssertionError("cache invoked compiler")):
            result = build_compute_kernels(check=True)
            self.assertTrue(result["cached"])
            self.assertEqual(set(result["manifest"]["variants"]), set(VARIANTS))

    def test_source_changes_fail_readonly_check(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            before = kernel_source_hash(root)
            source = root / KERNEL_ROOT / "src/lib.rs"
            source.write_text(source.read_text() + "\n// changed kernel source\n")
            self.assertNotEqual(kernel_source_hash(root), before)
            with self.assertRaisesRegex(ValueError, "Stale compute"):
                verify_compute_artifacts(root)
            with mock.patch("bundler.wasm._run", side_effect=AssertionError("check invoked compiler")):
                with self.assertRaisesRegex(ValueError, "verification failed"):
                    build_compute_kernels(root, check=True)

    def test_corrupted_binary_and_manifest_path_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            path = root / ARTIFACT_ROOT / "compute-simd.wasm"
            original = path.read_bytes()
            path.write_bytes(original[:-1])
            with self.assertRaisesRegex(ValueError, "hash/length mismatch"):
                verify_compute_artifacts(root)
            path.write_bytes(original)
            manifest_path = root / ARTIFACT_ROOT / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["variants"]["scalar"]["file"] = "../compute-scalar.wasm"
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "Invalid compute artifact record"):
                verify_compute_artifacts(root)

    def test_binary_metadata_controls_features_and_imports(self):
        manifest = verify_compute_artifacts()
        for name, expected in VARIANTS.items():
            with self.subTest(name=name):
                record = manifest["variants"][name]
                inspected = inspect_wasm((ROOT / ARTIFACT_ROOT / record["file"]).read_bytes())
                self.assertEqual(inspected["imports"], [{"module": "env", "name": "memory", "kind": "memory"}])
                self.assertEqual(inspected["memory"]["shared"], name.startswith("threads"))
                self.assertEqual("simd128" in inspected["compiledFeatures"], "simd128" in expected)
        with self.assertRaises(ValueError):
            inspect_wasm(b"\0asm\x01\0\0\0\x02\xff\xff\xff\xff\xff")

    def test_sidecar_closure_is_portable_and_source_free(self):
        paths = compute_release_asset_paths()
        self.assertEqual(len(paths), len(set(paths)))
        self.assertIn("engine/core/compute/ComputeWorker.js", paths)
        self.assertIn("engine/core/compute/ComputeOperations.js", paths)
        self.assertIn("engine/core/math/DocumentImageMath.js", paths)
        self.assertIn("engine/core/gpu/MatmulKernel.js", paths)
        self.assertIn("engine/core/math/TensorShapeMath.js", paths)
        self.assertFalse(any(path.startswith("agi/") for path in paths))
        self.assertFalse(any("/kernels/" in path or "/.cache/" in path for path in paths))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in paths:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, destination)
            self.assertEqual(compute_release_asset_paths(root), paths)
            self.assertEqual(verify_compute_artifacts(root, check_source=False)["abiVersion"], 1)

    def test_binary_edit_invalidates_runtime_cache_even_without_site(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            before = _release_build_input_digest(root, include_site=False)
            path = root / ARTIFACT_ROOT / "compute-scalar.wasm"
            path.write_bytes(path.read_bytes() + b"\0")
            self.assertNotEqual(before, _release_build_input_digest(root, include_site=False))

    def test_consumer_compute_inventory_requires_verified_complete_closure(self):
        paths = tuple(sorted(set(compute_release_asset_paths()) | set(compute_contract_asset_paths())))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            records = []
            for relative in paths:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, destination)
                payload = destination.read_bytes()
                records.append({"path": relative, "sha256": hashlib.sha256(payload).hexdigest(), "byteLength": len(payload)})
            self.assertEqual(_verify_compute_sidecars(records, root), len(paths))
            with self.assertRaisesRegex(ValueError, "complete worker closure"):
                _verify_compute_sidecars(records[:-1], root)
            with self.assertRaisesRegex(ValueError, "unique"):
                _verify_compute_sidecars(records + records[:1], root)
            path = root / records[0]["path"]
            path.write_bytes(path.read_bytes() + b" ")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                _verify_compute_sidecars(records, root)

    def test_compiled_provider_urls_keep_engine_release_base(self):
        source = "const worker = new URL('./ComputeWorker.js', import.meta.url); const manifest = new URL('./artifacts/manifest.json', import.meta.url);"
        rewritten = rewrite_import_meta(source, ROOT / "engine/core/compute/WasmComputeProvider.js", ModuleGraph(ROOT), os_base_prefix="webgpu-os/")
        self.assertNotIn("import.meta", rewritten)
        self.assertIn("globalThis.__PE_ENGINE_BASE__", rewritten)
        self.assertIn('core/compute/WasmComputeProvider.js', rewritten)
        self.assertIn("./artifacts/manifest.json", rewritten)

    @contextmanager
    def browser_page(self, root=ROOT):
        from playwright.sync_api import sync_playwright
        from bundler.browser_syntax import _find_browser

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def end_headers(self):
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
                super().end_headers()

            def do_GET(self):
                if self.path == "/__compute_test__":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(b"<!doctype html><title>Compute kernel validation</title>")
                else:
                    super().do_GET()

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(root)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=str(_find_browser()), headless=True)
                try:
                    page = browser.new_page()
                    page.goto(f"http://127.0.0.1:{server.server_port}/__compute_test__")
                    yield page
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()

    def test_real_scalar_simd_and_shared_binaries(self):
        with self.browser_page() as page:
            report = page.evaluate(BROWSER_TEST)
        self.assertEqual(report["variants"], list(VARIANTS))
        self.assertEqual(report["parallel"], [3, 6])
        self.assertTrue(report["isolated"])

    def test_packaged_worker_closure_executes_with_browser_offline(self):
        paths = compute_release_asset_paths()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in paths:
                destination = root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, destination)
            inventory = json.dumps(["/" + relative for relative in paths] + ["/__compute_test__"])
            (root / "offline-test-worker.js").write_text(
                "self.addEventListener('install', event => event.waitUntil(caches.open('compute-test').then(cache => cache.addAll("
                + inventory + ")).then(() => self.skipWaiting())));\n"
                "self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));\n"
                "self.addEventListener('fetch', event => event.respondWith(caches.match(event.request).then(response => response || fetch(event.request))));\n",
                encoding="utf-8",
            )
            with self.browser_page(root) as page:
                page.evaluate("async () => { await navigator.serviceWorker.register('/offline-test-worker.js'); await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true})); }")
                page.context.set_offline(True)
                report = page.evaluate(OFFLINE_WORKER_TEST)
                self.assertEqual(report, {"sum": 10, "mean": 2.5, "offline": True})


OFFLINE_WORKER_TEST = r"""async () => {
 const root = '/engine/core/compute/';
 const manifest = await (await fetch(root+'artifacts/manifest.json')).json();
 const module = await WebAssembly.compile(await (await fetch(root+'artifacts/'+manifest.variants.scalar.file)).arrayBuffer());
 const worker = new Worker(root+'ComputeWorker.js', {type:'module'});
 try {
   const exchange = data => new Promise((resolve,reject) => {
     const timeout = setTimeout(() => reject(new Error('Offline compute worker timed out')), 10000);
     worker.onmessage = event => { clearTimeout(timeout); event.data.error ? reject(new Error(event.data.error.message)) : resolve(event.data); };
     worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
     worker.postMessage(data);
   });
   await exchange({type:'init',workerId:0,backend:'wasm-scalar',variant:'scalar',module,memory:null,sharedBuffer:null,
     memoryDescriptor:{initial:64,maximum:64},stackPointer:2097152,arenaStart:2097152,arenaEnd:4194304,cancelOffset:983040});
   const response = await exchange({type:'job',taskType:'compute',jobId:'offline',data:{operation:'math.stats.summary@1',backend:'wasm-scalar',inputs:{values:new Float64Array([1,2,3,4])},parameters:{},policy:{precision:'f64'}}});
   return {sum:response.result.value.sum,mean:response.result.value.mean,offline:!navigator.onLine};
 } finally { worker.terminate(); }
}"""


BROWSER_TEST = r"""async () => {
 const check = (ok, label) => { if (!ok) throw new Error(label); };
 const near = (a,b) => Math.abs(a-b) < 1e-10;
 const manifest = await (await fetch('/engine/core/compute/artifacts/manifest.json')).json();
 const names = ['scalar','simd','threads','threads-simd'];
 let sharedModule;
 for (const name of names) {
   const record = manifest.variants[name];
   const module = await WebAssembly.compile(await (await fetch('/engine/core/compute/artifacts/' + record.file)).arrayBuffer());
   const shared = name.startsWith('threads');
   const memory = new WebAssembly.Memory({initial:128,maximum:4096,shared});
   const instance = await WebAssembly.instantiate(module,{env:{memory}});
   const e = instance.exports;
   e.__stack_pointer.value = 2097152;
   const base = 2162688, out = base + 65536, control = base + 131072;
   const input = new Float64Array(memory.buffer,base,16); input.set([1,2,3,4]);
   const result = new Float64Array(memory.buffer,out,16);
   check(e.abi_version()===1,'abi '+name);
   check(e.stats(base,4,out,0)===0,'stats status');
   check(result[0]===10 && result[1]===2.5 && near(result[2],5/3) && result[3]===1.25 && result[4]===1 && result[5]===4,'stats '+name);
   input.set([1e16,1,-1e16]); e.compensated_sum(base,3,out,0); check(result[2]===1,'compensated '+name);
    input.set([2,3,4,1,-2,9]);e.bounds(base,2,3,out,0);check(result[0]===1&&result[1]===-2&&result[5]===9,'bounds '+name);
    input.set([0,-0]);e.bounds(base,2,1,out,0);check(Object.is(result[0],-0)&&Object.is(result[1],0),'bounds signed zero '+name);
    e.waveform(base,2,1,out,0);check(Object.is(result[0],-0)&&Object.is(result[1],0),'peaks signed zero '+name);
    input.set([2,3,4,1,-2,9]);
   const matrix=base+256;new Float64Array(memory.buffer,matrix,16).set([2,0,0,0,0,3,0,0,0,0,4,0,1,2,3,1]);
   e.transform_points(base,2,matrix,out,0);check(result[0]===5&&result[1]===11&&result[2]===19,'transform '+name);
   const rgba=new Uint8Array(memory.buffer,base,12);rgba.set([255,0,0,255,0,255,0,128,0,0,255,0]);
   e.luminance(base,3,out,.2126,.7152,.0722,1/255,0);
   const luminance=new Float32Array(memory.buffer,out,3);check(Math.abs(luminance[0]-.2126)<1e-7&&Math.abs(luminance[1]-.7152)<1e-7&&Math.abs(luminance[2]-.0722)<1e-7,'luminance '+name);
   e.rgba_histogram(base,3,out,.2126,.7152,.0722,0);const hist=new Uint32Array(memory.buffer,out,1280);
    check(hist[255]===1&&hist[0]===2&&hist[1024+54]===1&&hist[1024+182]===1&&hist[1024+18]===1,'rgba hist '+name);
    e.rgba_histogram(base,3,out,1e308,-1e308,1e308,0);check(hist[1024]===3&&hist[1279]===0,'nonfinite histogram luma '+name);
   const bytes=new TextEncoder().encode('123456789');new Uint8Array(memory.buffer,base,bytes.length).set(bytes);
   check(e.crc32(base,9,0,0)>>>0===0xcbf43926,'crc '+name);e.byte_histogram(base,9,out,0);check(hist[49]===1&&hist[57]===1&&hist[0]===0,'byte hist '+name);
   input.set([1,-2,3,-4]);e.waveform(base,4,2,out,0);check(result[0]===-2&&result[1]===1&&result[2]===2&&result[3]===-4&&result[5]===4,'peaks '+name);
   e.windowed_rms(base,4,2,2,out,0);check(near(result[0],Math.sqrt(2.5))&&near(result[2],Math.sqrt(12.5)),'rms '+name);
   const real=base,imag=base+128,twiddles=base+256;input.set([1,2,3,4]);new Float64Array(memory.buffer,imag,4).fill(0);
   new Float64Array(memory.buffer,twiddles,4).set([1,0,Math.cos(Math.PI/2),Math.sin(Math.PI/2)]);
   e.fft(real,imag,4,twiddles,0,0);check(near(input[0],10)&&near(input[1],-2)&&near(new Float64Array(memory.buffer,imag,4)[1],2),'fft '+name);
    e.fft(real,imag,4,twiddles,1,0);check([1,2,3,4].every((v,i)=>near(input[i],v)),'ifft '+name);
    const samples=new Float64Array(memory.buffer,base,100000);for(let i=0;i<samples.length;i++)samples[i]=i%17-8;
    const peaksOffset=3211264;e.waveform(base,samples.length,100000,peaksOffset,0);const peaks=new Float64Array(memory.buffer,peaksOffset,300000);
    for(let i=0;i<samples.length;i++)check(peaks[i*3]===samples[i]&&peaks[i*3+1]===samples[i]&&peaks[i*3+2]===Math.abs(samples[i]),'large waveform index '+i+' '+name);
   if(shared){Atomics.store(new Int32Array(memory.buffer,control,1),0,1);check(e.stats(base,4,out,control)===1,'atomic cancellation '+name);sharedModule=module;}
 }
 const sharedMemory=new WebAssembly.Memory({initial:96,maximum:4096,shared:true});
 const workerSource=`onmessage=async e=>{try{const {module,memory,offset,id}=e.data;const instance=await WebAssembly.instantiate(module,{env:{memory}});instance.exports.__stack_pointer.value=2097152+id*1048576;new Float64Array(memory.buffer,offset,3).set([id+1,id+1,id+1]);instance.exports.stats(offset,3,offset+64,0);postMessage(new Float64Array(memory.buffer,offset+64,1)[0]);}catch(error){postMessage({error:error.message});}}`;
 const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
 const parallel=await Promise.all([0,1].map(id=>new Promise((resolve,reject)=>{const worker=new Worker(url);worker.onmessage=e=>{worker.terminate();e.data?.error?reject(new Error(e.data.error)):resolve(e.data);};worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.postMessage({module:sharedModule,memory:sharedMemory,offset:4194304+id*65536,id});})));
 URL.revokeObjectURL(url);return {variants:names,parallel,isolated:crossOriginIsolated};
}"""


if __name__ == "__main__":
    unittest.main()
