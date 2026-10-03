Loads and verifies signed `.prpkg` bundles at runtime. Handles trust tier
checks, capability grants, sandbox initialization, and dependency resolution.

### Basic loading

```js
import { PackageLoader } from "webgpu-os/packages/PackageLoader.js";

// Load with minimum trust tier
const app = await PackageLoader.load("./game.prpkg", {
  requiredTier: "community",     // or "trusted" for stricter
  capabilities: ["storage", "network", "audio"],
  sandbox: true                  // Isolate from other apps
});

// Check what we got
console.log(app.manifest.name);     // "My Game"
console.log(app.manifest.version);  // "1.2.3"
console.log(app.trustTier);         // "community"
console.log(app.grantedCapabilities); // ["storage", "network", "audio"]

// Start the app
await app.mount();
```

### Trust tiers and capabilities

```js
// Developer build (self-signed) - runs with limited capabilities
const devApp = await PackageLoader.load("./debug.prpkg", {
  requiredTier: "developer"
});

// Community app - user acknowledged the risk
const communityApp = await PackageLoader.load("./indie-game.prpkg", {
  requiredTier: "community",
  capabilities: ["storage", "input"]
});

// Trusted app - root-signed, gets broader access
const trustedApp = await PackageLoader.load("./official-app.prpkg", {
  requiredTier: "trusted",
  capabilities: ["storage", "network", "raw-gpu", "file-system"]
});
```

### Dependency resolution

```js
// App depends on shared libraries
const app = await PackageLoader.load("./main.prpkg", {
  dependencies: {
    "std:graphics": "^2.0.0",
    "std:physics": "^1.5.0",
    "user:custom-mod": ">=1.0.0 <2.0.0"
  },
  registry: "https://packages.particlerealms.online",
  allowPrerelease: false
});

// Dependencies are loaded and linked automatically
const graphics = app.dependencies["std:graphics"];
```

### Sandboxing and permissions

```js
// Strict sandbox - no filesystem, network, or system access
const sandboxed = await PackageLoader.load("./untrusted.prpkg", {
  sandbox: {
    filesystem: false,
    network: false,
    subprocesses: false,
    memoryLimit: 128 * 1024 * 1024,  // 128 MB
    timeLimit: 60 * 1000              // 60 seconds max
  }
});

// Relaxed sandbox for editor extensions
const extension = await PackageLoader.load("./editor-ext.prpkg", {
  sandbox: {
    filesystem: { read: ["/assets"], write: [] },
    network: { hosts: ["api.example.com"] },
    subprocesses: false
  }
});
```

### Hot reload (development)

```js
// Auto-reload on file changes
const devApp = await PackageLoader.load("./debug.prpkg", {
  hotReload: true,
  onReload: () => {
    console.log("App updated, restarting...");
    devApp.restart();
  }
});
```

### Error handling

```js
try {
  const app = await PackageLoader.load("./corrupt.prpkg");
} catch (err) {
  if (err.code === "VERIFICATION_FAILED") {
    // Signature invalid or package tampered
    console.error("Package verification failed:", err.details);
  } else if (err.code === "TRUST_TIER_INSUFFICIENT") {
    // Required tier not met
    console.error("Trust tier too low. Required:", err.requiredTier);
  } else if (err.code === "CAPABILITY_DENIED") {
    // Missing capability grant
    console.error("Missing capability:", err.capability);
  } else if (err.code === "DEPENDENCY_MISSING") {
    // Couldn't resolve a dependency
    console.error("Missing dependency:", err.dependency);
  }
}
```

**See also:** [Package Trust Tiers](/concepts/security-model.md) · [WebGPU OS Architecture](/webgpu-os/architecture.md)
