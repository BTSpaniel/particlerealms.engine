// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

let nextSubscriptionId = 1;

export const EventCategories = {
  ENGINE: "engine",
  INPUT: "input",
  GAMEPLAY: "gameplay",
  DEBUG: "debug",
};

function makeKey(category, name) {
  if (!category) {
    return name;
  }
  return `${category}.${name}`;
}

export function buildEventName(category, name) {
  if (!name) {
    throw new Error("EventBus.buildEventName: name is required");
  }
  return makeKey(category, name);
}

export function createEventBus() {
  const listenersByEvent = new Map();

  function getListeners(eventName, createIfMissing) {
    let list = listenersByEvent.get(eventName);
    if (!list && createIfMissing) {
      list = [];
      listenersByEvent.set(eventName, list);
    }
    return list;
  }

  function subscribe(eventName, handler, options = {}) {
    if (!eventName) {
      throw new Error("EventBus.subscribe: eventName is required");
    }
    if (typeof handler !== "function") {
      throw new Error("EventBus.subscribe: handler must be a function");
    }

    const priority = typeof options.priority === "number" ? options.priority : 0;
    const once = options.once === true;

    const id = nextSubscriptionId;
    nextSubscriptionId += 1;

    const entry = { id, eventName, handler, priority, once };

    const list = getListeners(eventName, true);
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);

    return id;
  }

  function unsubscribe(tokenOrHandler) {
    if (!tokenOrHandler) {
      return;
    }

    for (const [eventName, list] of listenersByEvent.entries()) {
      const originalLength = list.length;
      if (typeof tokenOrHandler === "function") {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].handler === tokenOrHandler) {
            list.splice(i, 1);
          }
        }
      } else {
        const token = tokenOrHandler;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].id === token) {
            list.splice(i, 1);
          }
        }
      }

      if (list.length === 0 && originalLength > 0) {
        listenersByEvent.delete(eventName);
      }
    }
  }

  function publish(eventName, payload) {
    const list = getListeners(eventName, false);
    if (!list || list.length === 0) {
      return;
    }

    const snapshot = list.slice();

    for (const entry of snapshot) {
      try {
        entry.handler(payload, { eventName, id: entry.id });
      } catch (error) {
        console.error("EventBus listener error for", eventName, error);
      }

      if (entry.once) {
        unsubscribe(entry.id);
      }
    }
  }

  function publishAsync(eventName, payload) {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(() => publish(eventName, payload));
    } else {
      setTimeout(() => publish(eventName, payload), 0);
    }
  }

  function clearAll() {
    listenersByEvent.clear();
  }

  function getDebugSnapshot() {
    const snapshot = [];
    for (const [eventName, list] of listenersByEvent.entries()) {
      snapshot.push({
        eventName,
        listeners: list.map((entry) => ({
          id: entry.id,
          priority: entry.priority,
          once: entry.once,
        })),
      });
    }
    return snapshot;
  }

  return {
    subscribe,
    unsubscribe,
    publish,
    publishAsync,
    clearAll,
    getDebugSnapshot,
  };
}
