# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Opt-in, bounded production pinned-V2 browser probe; never an offline test.

Uses two fresh browser contexts, ephemeral signing identities and public party
create/join APIs. No accounts, external media, native approval bypass, fallback
transport, fixture rendezvous or persistent browser profile is used. Invite
codes, identity keys, sessions and ICE credentials are never printed.
"""
from __future__ import annotations
import functools
import http.server
import json
import sys
import threading
import time
from urllib.parse import urlsplit, urlunsplit
from playwright.sync_api import sync_playwright
from run_party_tests import CANDIDATES, Handler, ROOT

TIMEOUT_SECONDS = 25

class ProbeHandler(Handler):
    def do_GET(self) -> None:
        if self.path != "/__party_network_probe__":
            super().do_GET()
            return
        body = b"<!doctype html><meta charset=utf-8><link rel=icon href=data:,><title>Temporary Watch Party network probe</title>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

INITIALIZE = """async role => {
    const { createWatchParty } = await import('/engine/media/party/WatchParty.js');
    const { particleNetworkDaemonStats } = await import('/engine/network/daemon/ParticleNetworkDaemonRegistry.js');
    const { PARTICLE_PRODUCTION_V2_URL } = await import('/engine/network/routes/MasterServerList.js');
    window.probeEvents = []; window.probePhase = 'idle'; window.probeFailure = null;
    window.probeParty = createWatchParty({displayName:`Temporary network probe ${role}`});
    window.probeStats = particleNetworkDaemonStats;
    for (const type of ['status','error','network','member','control','peer']) {
        window.probeParty.on(type, event => {
            const safe = {type, at:Math.round(performance.now())};
            for (const key of ['status','role','reason','code','message','mode','relayAvailable','action']) {
                if (['string','boolean','number'].includes(typeof event?.[key])) safe[key] = event[key];
            }
            window.probeEvents.push(safe);
        });
    }
    window.probeStart = code => {
        window.probePhase = 'pending';
        window.probePromise = (role === 'host' ? window.probeParty.create() : window.probeParty.join(code))
            .then(result => {window.probePhase = 'ready'; if (role === 'host') window.probeInvite = result.code;})
            .catch(error => {window.probeFailure = {code:error.code ?? error.name,message:error.message}; window.probePhase = 'failed';});
    };
    window.probeSnapshot = () => ({phase:window.probePhase,failure:window.probeFailure,status:window.probeParty.status,
        secureIdentity:window.probeParty.identity?.secure === true,
        members:window.probeParty.members.length,connectedMembers:window.probeParty.members.filter(member=>member.connected).length,
        routes:window.probeParty._ownedRoutes.size,
        daemons:window.probeStats().map(({state})=>({state:state.state,protocol:state.protocol,pinnedV2:state.server.url === PARTICLE_PRODUCTION_V2_URL})),
        controls:window.probeEvents.filter(event=>event.type==='control').length,events:window.probeEvents.slice(-32)});
    return {secureContext:isSecureContext,crypto:!!crypto.subtle,webrtc:typeof RTCPeerConnection==='function',endpoint:PARTICLE_PRODUCTION_V2_URL};
}"""

def safe_url(value: str) -> str:
    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))

def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    executable = next((path for path in CANDIDATES if path.is_file()), None)
    if executable is None:
        raise FileNotFoundError("Chrome or Edge required for real browser network probe")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(ProbeHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    report = {"transport": "production pinned Particle V2", "timeoutSeconds": TIMEOUT_SECONDS, "success": False, "network": []}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(executable), headless=True)
            contexts = [browser.new_context(), browser.new_context()]
            pages = [context.new_page() for context in contexts]
            try:
                for page, role in zip(pages, ["host", "guest"]):
                    page.on("websocket", lambda socket, role=role: report["network"].append({"role":role,"type":"websocket", "url":safe_url(socket.url)}))
                    page.on("requestfailed", lambda request, role=role: report["network"].append({"role":role,"type":"requestfailed","url":safe_url(request.url),"reason":request.failure}))
                    page.on("response", lambda response, role=role: report["network"].append({"role":role,"type":"manifest-response","url":safe_url(response.url),"status":response.status,"accessControlAllowOrigin":response.headers.get("access-control-allow-origin"),"server":response.headers.get("server")}) if response.url.startswith("https://discovery.particlerealms.online/v2/manifest") else None)
                    page.on("console", lambda message, role=role: report["network"].append({"role":role,"type":"browser-error","message":message.text[:500]}) if message.type == "error" else None)
                    page.goto(f"http://127.0.0.1:{server.server_port}/__party_network_probe__")
                    report[f"{role}Capabilities"] = page.evaluate(INITIALIZE, role)
                started = time.monotonic()
                deadline = started + TIMEOUT_SECONDS
                pages[0].evaluate("() => window.probeStart()")
                joining = False
                sent_state = False
                while time.monotonic() < deadline:
                    cors = next((event for event in report["network"] if event["type"] == "browser-error" and "/v2/manifest" in event.get("message", "") and "CORS policy" in event["message"]), None)
                    if cors:
                        report["blocker"] = {"code":"MANIFEST_CORS","message":cors["message"]}
                        break
                    host = pages[0].evaluate("() => window.probeSnapshot()")
                    if host["phase"] == "failed":
                        report["blocker"] = host["failure"]
                        break
                    if host["phase"] == "ready" and not joining:
                        code = pages[0].evaluate("() => window.probeInvite")
                        pages[1].evaluate("code => window.probeStart(code)", code)
                        code = None
                        joining = True
                    guest = pages[1].evaluate("() => window.probeSnapshot()")
                    if guest["phase"] == "failed":
                        report["blocker"] = guest["failure"]
                        break
                    if guest["phase"] == "ready" and not sent_state:
                        pages[0].evaluate("() => window.probeParty.sendHostState({sourceRevision:1,itemId:'network-probe',source:{kind:'file',title:'Temporary network probe'},mode:'restream',position:0,paused:true,rate:1,clock:Date.now()})")
                        sent_state = True
                    if sent_state and pages[1].evaluate("() => window.probeParty.state?.itemId === 'network-probe'"):
                        report["success"] = True
                        break
                    time.sleep(0.2)
                report["elapsedSeconds"] = round(time.monotonic() - started, 2)
                report["host"] = pages[0].evaluate("() => window.probeSnapshot()")
                report["guest"] = pages[1].evaluate("() => window.probeSnapshot()")
                if not report["success"] and "blocker" not in report:
                    report["blocker"] = {"code":"PROBE_DEADLINE","message":"No authenticated joined/control state before bounded probe deadline"}
                report["guestJoinAttempted"] = joining
            finally:
                for page, role in zip(pages, ["host", "guest"]):
                    try:
                        report[f"{role}Cleanup"] = page.evaluate("""async () => {
                            await window.probeParty?.end('network-probe-complete');
                            window.probeInvite = null;
                            await window.probePromise?.catch(()=>{});
                            return {identityReleased:!window.probeParty?.identity,routes:window.probeParty?._ownedRoutes.size??0,daemons:window.probeStats?.().length??0,status:window.probeParty?.status};
                        }""")
                    except Exception as error:
                        report[f"{role}Cleanup"] = {"error":str(error)}
                for context in contexts:
                    context.close()
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    print(json.dumps(report, indent=2))
    return 0 if report["success"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
