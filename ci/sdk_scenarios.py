# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Real SDK application and offscreen selection checks shared by browser jobs."""
import math
import time


def selection_case(page, base, mode):
    page.goto(base + 'examples/docs-snippets.html', wait_until='domcontentloaded')
    return page.evaluate(r'''async ({base,mode}) => {
        const engine = mode === 'source' ? await import(new URL('engine/EngineBootstrap.js',base)) : await globalThis.__PE_RUNTIME_READY;
        const {runSelectionRegression} = await import(new URL('examples/selection-regression.js',base));
        const adapter=await navigator.gpu.requestAdapter();
        if(!adapter)throw Error('Selection regression requires WebGPU');
        const device=await adapter.requestDevice();
        const uncaptured=[];
        const onError=event=>uncaptured.push(String(event.error?.message??event.error));
        device.addEventListener('uncapturederror',onError);
        try {
            const evidence=await runSelectionRegression(engine,device);
            await device.queue.onSubmittedWorkDone();
            if(uncaptured.length)throw Error('Uncaptured selection GPU errors: '+uncaptured.join('; '));
            return {name:'Selected-object GPU pixel regression',mode,status:evidence.status,
                checks:evidence.cases.map(entry=>({name:entry.name,passed:entry.passed??entry.status==='PASS',detail:entry})),
                evidence,cleanup:{status:evidence.cleanup.errors.length===0 && evidence.cleanup.allocated===evidence.cleanup.destroyed?'passed':'failed'}};
        } catch(error) { throw Error(JSON.stringify(error.receipt??{error:String(error)})); }
        finally { device.removeEventListener('uncapturederror',onError);device.destroy(); const lost=await device.lost;if(lost.reason!=='destroyed')throw Error('Unexpected selection device loss'); }
    }''', {'base': base, 'mode': mode})


def start_playground(page, base, mode):
    page.goto(base + f'examples/{mode}.html?case=playground', wait_until='domcontentloaded')
    page.wait_for_function("['passed','failed','unsupported'].includes(globalThis.__SDK_EXAMPLE_RESULT__?.status)")
    result = page.evaluate('globalThis.__SDK_EXAMPLE_RESULT__')
    if result['status'] != 'passed':
        raise AssertionError('Playground startup failed: ' + str(result))


def assert_ownership(observed, expected):
    for name in ('entities', 'bodies', 'uniformBuffers', 'bindGroups'):
        if type(observed[name]) is not int or observed[name] != expected:
            raise AssertionError(f'Playground {name}: expected {expected}, observed {observed[name]}')
    if (type(observed['nativeBodies']) is not int or observed['nativeBodies'] != expected + 1
            or observed['finite'] is not True):
        raise AssertionError('Native floor/body ownership or finite simulation check failed')


def assert_measurements(observed):
    """Reject absent/nonfinite samples instead of publishing misleading timing."""
    if type(observed['frames']) is not int or observed['frames'] < 1:
        raise AssertionError('Continuous simulation has no rendered frames')
    timing = observed['frameTimeMs']
    if type(timing['samples']) is not int or timing['samples'] < 1:
        raise AssertionError('Continuous simulation has no frame interval samples')
    values = [timing[key] for key in ('p50', 'p95', 'p99')]
    if any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in values):
        raise AssertionError('Frame interval measurements are not finite nonnegative numbers')
    if values != sorted(values):
        raise AssertionError('Frame interval percentile order is invalid')
    if observed.get('memory') is not None:
        for name in ('usedJSHeapSize', 'totalJSHeapSize'):
            value = observed['memory'][name]
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise AssertionError('Browser memory measurement is not finite: ' + name)


def cleanup_playground(page):
    page.evaluate('localStorage.removeItem(__SDK_PLAYGROUND__.storageKey)')
    first = page.evaluate('__SDK_EXAMPLE_CLEANUP__()')
    second = page.evaluate('__SDK_EXAMPLE_CLEANUP__()')
    if first != second or first['status'] != 'passed':
        raise AssertionError('Playground cleanup failed or was not idempotent')
    if page.evaluate('__SDK_EXAMPLE_RESULT__.status') != 'passed':
        raise AssertionError('Playground reported a runtime failure during cleanup')
    return first


def playground_case(page, base, mode):
    start_playground(page, base, mode)
    page.get_by_role('button', name='Reset', exact=True).click()
    before = page.evaluate('__SDK_PLAYGROUND__.inspect()')
    page.get_by_role('button', name='Spawn', exact=True).click()
    observed = page.evaluate('__SDK_PLAYGROUND__.inspect()')
    assert_ownership(observed, 4)
    selected = observed['selected']
    page.get_by_role('button', name='Select next', exact=True).click()
    if page.evaluate('__SDK_PLAYGROUND__.inspect().selected') == selected:
        raise AssertionError('Plauna Select control did not change selected entity')
    page.get_by_role('button', name='Save', exact=True).click()
    saved = page.evaluate('JSON.parse(localStorage.getItem(__SDK_PLAYGROUND__.storageKey))')
    page.get_by_role('button', name='Reset', exact=True).click()
    assert_ownership(page.evaluate('__SDK_PLAYGROUND__.inspect()'), 3)
    page.get_by_role('button', name='Reload', exact=True).click()
    assert_ownership(page.evaluate('__SDK_PLAYGROUND__.inspect()'), 4)
    roundtrip = page.evaluate('''() => {
        const app=__SDK_PLAYGROUND__;const expected=app.save();app.clear();app.reload();
        return JSON.stringify(expected.entities)===JSON.stringify(app.snapshot().entities);
    }''')
    if not roundtrip:
        raise AssertionError('Public scene persistence changed a saved pose, scale, color or simulation mode')
    saved_bytes = page.evaluate('localStorage.getItem(__SDK_PLAYGROUND__.storageKey)')
    page.evaluate('__SDK_EXAMPLE_CLEANUP__()')
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function("['passed','failed','unsupported'].includes(globalThis.__SDK_EXAMPLE_RESULT__?.status)")
    if page.evaluate('__SDK_EXAMPLE_RESULT__.status') != 'passed':
        raise AssertionError('Playground failed after page reload')
    if page.evaluate('localStorage.getItem(__SDK_PLAYGROUND__.storageKey)') != saved_bytes:
        raise AssertionError('Saved scene bytes changed across page reload')
    assert_ownership(page.evaluate('__SDK_PLAYGROUND__.inspect()'), len(saved['entities']))
    first = cleanup_playground(page)
    return {'name': 'Engine + Plauna complete physics playground', 'mode': mode, 'status': 'PASS',
            'checks': [{'name': name, 'passed': True} for name in
                ('Plauna spawn/select/reset controls', 'Public scene JSON preserves all entity fields',
                 'Saved scene survives page reload', 'Native/ECS/GPU ownership counts agree', 'Repeated cleanup')],
            'initial': before, 'cleanup': first}


def endurance_case(page, base, mode, duration=600, cycles=100):
    start_playground(page, base, mode)
    started = time.monotonic()
    cycle_results = []
    for index in range(cycles):
        observation = page.evaluate('''() => {
            const app=__SDK_PLAYGROUND__;app.reset();app.spawn();const saved=app.save();app.clear();
            const empty=app.inspect();app.reload();const restored=app.snapshot();const loaded=app.inspect();app.clear();
            return {empty,loaded,after:app.inspect(),equal:JSON.stringify(saved.entities)===JSON.stringify(restored.entities)};
        }''')
        for name, count in (('empty', 0), ('loaded', 4), ('after', 0)):
            assert_ownership(observation[name], count)
        if not observation['equal']:
            raise AssertionError(f'Persistence cycle {index + 1} changed the scene')
        cycle_results.append({'cycle': index + 1, 'passed': True})
    page.evaluate('__SDK_PLAYGROUND__.reset()')
    simulation_started = time.monotonic()
    initial = page.evaluate('__SDK_PLAYGROUND__.inspect()')
    previous_frames = initial['frames']
    previous_sample_time = simulation_started
    samples = []
    while time.monotonic() - simulation_started < duration:
        page.wait_for_timeout(min(5000, max(1, (duration - (time.monotonic() - simulation_started)) * 1000)))
        result = page.evaluate('__SDK_EXAMPLE_RESULT__')
        if result['status'] != 'passed':
            raise AssertionError('Endurance scenario failed: ' + str(result))
        observed = page.evaluate('__SDK_PLAYGROUND__.inspect()')
        assert_ownership(observed, 3)
        assert_measurements(observed)
        sampled_at = time.monotonic()
        # Check sustained progress, not a single frame somewhere in ten minutes.
        # The final partial sample can be shorter than one display interval.
        if sampled_at - previous_sample_time >= 1 and observed['frames'] <= previous_frames:
            raise AssertionError('Continuous simulation stopped producing frames between samples')
        samples.append({'elapsedSeconds': sampled_at - simulation_started, **observed})
        previous_frames, previous_sample_time = observed['frames'], sampled_at
    final = page.evaluate('__SDK_PLAYGROUND__.inspect()')
    assert_ownership(final, 3)
    assert_measurements(final)
    if final['frames'] <= initial['frames']:
        raise AssertionError('Continuous simulation did not render frames')
    simulation_duration = time.monotonic() - simulation_started
    cleanup = cleanup_playground(page)
    return {'name': 'SDK lifecycle and continuous simulation', 'mode': mode, 'status': 'PASS',
        'checks': [{'name': f'{cycles} create/save/load/destroy cycles', 'passed': True},
                   {'name': f'{duration} seconds continuous finite simulation', 'passed': True}],
        'cycles': cycle_results, 'durationSeconds': simulation_duration,
        'elapsedSeconds': time.monotonic() - started, 'measurements': samples, 'final': final, 'cleanup': cleanup,
        'measurementScope': 'Observed software WebGPU frame intervals and available JS heap estimates; not hardware performance or total native/GPU memory.'}
