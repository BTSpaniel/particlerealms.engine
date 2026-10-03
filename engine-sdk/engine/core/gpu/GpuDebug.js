// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function labelResource(resource, label) {
  if (!resource || typeof label !== "string") {
    return;
  }
  try {
    resource.label = label;
  } catch (error) {
    console.warn("Failed to label WebGPU resource", error);
  }
}

export async function withErrorScope(device, fn) {
  if (!device
    || typeof device.pushErrorScope !== "function"
    || typeof device.popErrorScope !== "function") {
    return fn();
  }

  device.pushErrorScope("validation");

  let operationPromise;
  try {
    operationPromise = Promise.resolve(fn());
  } catch (error) {
    operationPromise = Promise.reject(error);
  }

  // Pop before yielding. WebGPU associates already-issued operations with the
  // returned promise, so another task can safely open its own device scope.
  let scopePromise;
  try {
    scopePromise = Promise.resolve(device.popErrorScope());
  } catch (error) {
    scopePromise = Promise.reject(error);
  }

  const [operation, scope] = await Promise.allSettled([
    operationPromise,
    scopePromise,
  ]);
  const scopeError = scope.status === "fulfilled" ? scope.value : null;

  if (operation.status === "rejected") {
    if (scopeError) {
      console.error("WebGPU validation error", scopeError);
    } else if (scope.status === "rejected") {
      console.error("Failed to close WebGPU validation scope", scope.reason);
    }
    throw operation.reason;
  }

  if (scope.status === "rejected") {
    throw scope.reason;
  }

  if (scopeError) {
    console.error("WebGPU validation error:", scopeError.message || scopeError);
    throw scopeError;
  }

  return operation.value;
}
