/**
 * JHEventBus — Production-Grade Event Bus
 * @version 2.0.0
 * @author JH
 *
 * Features:
 *  - on / off / once / emit
 *  - Priority-based listener sorting
 *  - Wildcard "*" listeners
 *  - Async/sync handler support
 *  - Middleware pipeline (with error isolation)
 *  - Debounce / Throttle helpers
 *  - Event validation
 *  - once() properly removable via off()
 *  - Emit returns a Promise (awaitable in all modes)
 *  - listenerCount() / eventNames() for debugging
 *  - Universal: works in Browser + Node.js + SSR
 */

class JHEventBus {
  /**
   * @param {Object} options
   * @param {number} [options.maxListeners=100]
   * @param {boolean} [options.verbose=false] - log warnings
   */
  constructor(options = {}) {
    /** @type {Record<string, Array<ListenerEntry>>} */
    this._listeners = {};

    /** @type {Function[]} */
    this._middlewares = [];

    /** @type {number} */
    this._maxListeners = options.maxListeners ?? 100;

    /** @type {boolean} */
    this._verbose = options.verbose ?? false;

    // Map original handler → wrapper, so off(original) works for once()
    /** @type {WeakMap<Function, Function>} */
    this._onceWrappers = new WeakMap();
  }

  // ─────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────

  /**
   * Validate that event name is a non-empty string.
   * @param {*} event
   */
  _validateEvent(event) {
    if (typeof event !== "string" || event.trim() === "") {
      throw new TypeError(
        `[JHEventBus] Event name must be a non-empty string. Received: ${JSON.stringify(event)}`
      );
    }
  }

  /**
   * Validate that handler is a function.
   * @param {*} handler
   */
  _validateHandler(handler) {
    if (typeof handler !== "function") {
      throw new TypeError(
        `[JHEventBus] Handler must be a function. Received: ${typeof handler}`
      );
    }
  }

  /**
   * Run middleware pipeline safely.
   * A failing middleware is caught and logged; it does NOT abort the emit.
   * @param {string} event
   * @param {*} data
   */
  async _runMiddlewares(event, data) {
    for (const mw of this._middlewares) {
      try {
        await mw(event, data);
      } catch (err) {
        console.error(`[JHEventBus] Middleware error on "${event}":`, err);
      }
    }
  }

  /**
   * Execute a list of listener entries for a given event/data.
   * Each listener is isolated — one failure won't stop others.
   * @param {Array<ListenerEntry>} items
   * @param {string} event
   * @param {*} data
   */
  async _runListeners(items, event, data) {
    for (const item of items) {
      try {
        await this._runMiddlewares(event, data);

        if (item.type === "async") {
          await item.handler(data, event);
        } else {
          const result = item.handler(data, event);
          // If a "sync" handler accidentally returns a Promise, still await it
          if (result instanceof Promise) await result;
        }
      } catch (err) {
        console.error(`[JHEventBus] Error in listener for "${event}":`, err);
      }
    }
  }

  // ─────────────────────────────────────────
  // MIDDLEWARE
  // ─────────────────────────────────────────

  /**
   * Register a middleware that runs before every handler.
   * fn(event, data) — can be async.
   * @param {Function} fn
   * @returns {this}
   */
  use(fn) {
    this._validateHandler(fn);
    this._middlewares.push(fn);
    return this;
  }

  // ─────────────────────────────────────────
  // ON
  // ─────────────────────────────────────────

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @param {Object} [options]
   * @param {number} [options.priority=0]    - Higher runs first
   * @param {"sync"|"async"} [options.type="sync"]
   * @returns {this}
   */
  on(event, handler, options = {}) {
    this._validateEvent(event);
    this._validateHandler(handler);

    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }

    // Prevent duplicate registration of the exact same handler
    const alreadyRegistered = this._listeners[event].some(
      (l) => l.handler === handler
    );
    if (alreadyRegistered) {
      if (this._verbose) {
        console.warn(
          `[JHEventBus] Handler already registered for "${event}". Skipping duplicate.`
        );
      }
      return this;
    }

    if (this._listeners[event].length >= this._maxListeners) {
      console.warn(
        `[JHEventBus] ⚠️ Max listeners (${this._maxListeners}) reached for "${event}". ` +
          `Possible memory leak. Increase maxListeners if intentional.`
      );
    }

    this._listeners[event].push({
      handler,
      priority: typeof options.priority === "number" ? options.priority : 0,
      type: options.type === "async" ? "async" : "sync",
    });

    // Sort by priority descending (higher priority runs first)
    this._listeners[event].sort((a, b) => b.priority - a.priority);

    return this;
  }

  // ─────────────────────────────────────────
  // OFF
  // ─────────────────────────────────────────

  /**
   * Unsubscribe a handler from an event.
   * Works correctly even for handlers registered via once().
   * @param {string} event
   * @param {Function} handler
   * @returns {this}
   */
  off(event, handler) {
    this._validateEvent(event);
    this._validateHandler(handler);

    if (!this._listeners[event]) return this;

    // Resolve the wrapper if it was a once() registration
    const target = this._onceWrappers.get(handler) ?? handler;

    this._listeners[event] = this._listeners[event].filter(
      (l) => l.handler !== target
    );

    // Clean up the WeakMap entry
    if (this._onceWrappers.has(handler)) {
      this._onceWrappers.delete(handler);
    }

    // GC: remove empty event key
    if (this._listeners[event].length === 0) {
      delete this._listeners[event];
    }

    return this;
  }

  // ─────────────────────────────────────────
  // ONCE
  // ─────────────────────────────────────────

  /**
   * Subscribe to an event once — auto-removes after first fire.
   * The original handler can still be used with off() to cancel early.
   * @param {string} event
   * @param {Function} handler
   * @param {Object} [options]
   * @returns {this}
   */
  once(event, handler, options = {}) {
    this._validateEvent(event);
    this._validateHandler(handler);

    const wrapper = async (data, evt) => {
      // Remove before calling — prevents re-entrancy issues
      this.off(event, handler);
      await handler(data, evt);
    };

    // Store mapping so off(original) resolves to wrapper
    this._onceWrappers.set(handler, wrapper);

    return this.on(event, wrapper, options);
  }

  // ─────────────────────────────────────────
  // EMIT
  // ─────────────────────────────────────────

  /**
   * Emit an event.
   *
   * @param {string} event
   * @param {*} [data]
   * @param {Object} [options]
   * @param {"sync"|"parallel"} [options.mode="parallel"]
   *   - "sync"     → await all listeners sequentially before returning
   *   - "parallel" → fire all listeners concurrently, still returns a Promise
   * @returns {Promise<this>}
   */
  async emit(event, data, options = {}) {
    this._validateEvent(event);

    // Snapshot the listeners at emit time to avoid mutation issues mid-run
    const list = [...(this._listeners[event] ?? [])];
    const wild = [...(this._listeners["*"] ?? [])];

    if (options.mode === "sync") {
      // Sequential: event-specific first, then wildcards
      await this._runListeners(list, event, data);
      await this._runListeners(wild, event, data);
    } else {
      // Parallel: both groups fire concurrently, fully awaited
      await Promise.all([
        this._runListeners(list, event, data),
        this._runListeners(wild, event, data),
      ]);
    }

    return this;
  }

  // ─────────────────────────────────────────
  // DEBOUNCE
  // ─────────────────────────────────────────

  /**
   * Register a debounced handler — fires only after `delay`ms of inactivity.
   * Returns the off() function to unsubscribe.
   * @param {string} event
   * @param {Function} handler
   * @param {number} [delay=300]
   * @returns {Function} unsubscribe fn
   */
  debounce(event, handler, delay = 300) {
    this._validateEvent(event);
    this._validateHandler(handler);

    let timer = null;
    const wrapper = (data) => {
      clearTimeout(timer);
      timer = setTimeout(() => handler(data), delay);
    };

    this.on(event, wrapper);

    // Return unsubscribe function
    return () => this.off(event, wrapper);
  }

  // ─────────────────────────────────────────
  // THROTTLE
  // ─────────────────────────────────────────

  /**
   * Register a throttled handler — fires at most once per `limit`ms.
   * Returns the off() function to unsubscribe.
   * @param {string} event
   * @param {Function} handler
   * @param {number} [limit=300]
   * @returns {Function} unsubscribe fn
   */
  throttle(event, handler, limit = 300) {
    this._validateEvent(event);
    this._validateHandler(handler);

    let lastCall = 0;
    const wrapper = (data) => {
      const now = Date.now(); // ← fixed typo from v1
      if (now - lastCall >= limit) {
        lastCall = now;
        handler(data);
      }
    };

    this.on(event, wrapper);

    // Return unsubscribe function
    return () => this.off(event, wrapper);
  }

  // ─────────────────────────────────────────
  // INSPECTION / DEBUG
  // ─────────────────────────────────────────

  /**
   * Get the number of listeners for an event.
   * @param {string} event
   * @returns {number}
   */
  listenerCount(event) {
    this._validateEvent(event);
    return this._listeners[event]?.length ?? 0;
  }

  /**
   * Get all event names that currently have listeners.
   * @returns {string[]}
   */
  eventNames() {
    return Object.keys(this._listeners);
  }

  /**
   * Check if an event has any listeners.
   * @param {string} event
   * @returns {boolean}
   */
  hasListeners(event) {
    this._validateEvent(event);
    return (this._listeners[event]?.length ?? 0) > 0;
  }

  // ─────────────────────────────────────────
  // CLEAR / DESTROY
  // ─────────────────────────────────────────

  /**
   * Remove all listeners for a specific event, or all events.
   * @param {string} [event]
   * @returns {this}
   */
  clear(event) {
    if (event !== undefined) {
      this._validateEvent(event);
      delete this._listeners[event];
    } else {
      this._listeners = {};
    }
    return this;
  }

  /**
   * Full teardown — clears all listeners and middlewares.
   */
  destroy() {
    this._listeners = {};
    this._middlewares = [];
  }
}

// ─────────────────────────────────────────
// UNIVERSAL GLOBAL EXPORT
// Works in Browser, Node.js, and SSR (Next.js, etc.)
// ─────────────────────────────────────────
const _instance = new JHEventBus();

if (typeof window !== "undefined") {
  window.JHbus = _instance; // Browser
} else if (typeof global !== "undefined") {
  global.JHbus = _instance; // Node.js
}

// Also supports ES module & CommonJS
if (typeof module !== "undefined" && module.exports) {
  module.exports = { JHEventBus, JHbus: _instance };
}
