import { type App } from 'vue';
import type { NavigationGuard, NavigationGuardReturn, Router } from 'vue-router';

import { PLUGIN_NAME } from './constants';

/** Route guard return type, aligned with vue-router's NavigationGuardReturn */
export type RouteGuardReturn = NavigationGuardReturn;

/**
 * Middleware guard function type.
 *
 * Use NavigationGuard so it can be invoked directly without `.call(undefined)`.
 */
export type MiddlewareGuard = NavigationGuard;

/**
 * Captured Vue app instance — set when `router.install(app)` is called.
 *
 * The plugin assumes a single app per router setup; in multi-app scenarios this is the most
 * recently installed app.
 */
let _app: App | null = null;

// `next` is unused in our pipeline (we model the middleware contract through return values), but
// vue-router's NavigationGuard signature still requires the third argument. Hoisted to avoid
// re-allocating on every navigation.
const _noop = () => {};

/** Sentinel returned from `consumeResult` when the pipeline should keep running. */
const CONTINUE = Symbol('CONTINUE');

/**
 * Helper for defining middleware with type safety.
 *
 * @example
 *   export default defineMiddleware((to, from) => {
 *     if (!isLoggedIn()) return '/login';
 *   });
 */
export function defineMiddleware(middleware: MiddlewareGuard): MiddlewareGuard {
  return middleware;
}

/** Wire global + named middleware into a Vue Router instance via `beforeEach`. */
export function setupMiddleware(
  router: Router,
  globalMiddleware: MiddlewareGuard[],
  namedMiddleware: Record<string, MiddlewareGuard>,
): void {
  const originalInstall = router.install.bind(router);

  // Intercept install to capture the app instance before Vue Router initialises
  router.install = function (app: App) {
    _app = app;
    return originalInstall(app);
  };

  router.beforeEach(async (to, from) => {
    // Wraps a middleware call inside `app.runWithContext` so that `inject()` and composables that
    // rely on it (e.g. `useQueryClient`) work synchronously at the top of the middleware body —
    // exactly like inside a component. `inject()` must be called before the first await; this
    // matches Vue's own Composition API rules.
    const run = (middleware: MiddlewareGuard) => {
      return _app
        ? _app.runWithContext(() => middleware(to, from, _noop))
        : middleware(to, from, _noop);
    };

    // ---- Global middleware ----
    for (const middleware of globalMiddleware) {
      const result = await run(middleware);
      const consumed = consumeResult(result);
      if (consumed !== CONTINUE) return consumed as NavigationGuardReturn;
    }

    // ---- Route-level (named) middleware ----
    const meta = to.meta.middleware;
    if (!meta) return;

    const keys = Array.isArray(meta) ? meta : [meta];
    for (const key of keys) {
      if (typeof key !== 'string') continue;

      const middleware = namedMiddleware[key];
      if (!middleware) {
        console.warn(`[${PLUGIN_NAME}] Middleware "${key}" not found.`);
        continue;
      }

      const result = await run(middleware);
      const consumed = consumeResult(result);
      if (consumed !== CONTINUE) return consumed as NavigationGuardReturn;
    }
  });
}

/**
 * Translate a middleware return value into the vue-router beforeEach contract.
 *
 * - `undefined` / `true` → keep going
 * - `false` → abort navigation
 * - `Error` instance → reject the navigation with the error
 * - Anything else → treat as a redirect target (path string, route location, …)
 */
function consumeResult(result: unknown): typeof CONTINUE | unknown {
  if (result === undefined || result === true) return CONTINUE;
  if (result === false) return false;
  if (result instanceof Error) return Promise.reject(result);
  return result;
}

/**
 * Generator-based executor that preserves Vue injection context across yield boundaries.
 *
 * Each segment between yields runs inside `app.runWithContext()`, ensuring that `inject()` and any
 * composable relying on it (e.g. `useQueryClient()`) works even after `await` in middleware.
 *
 * @param genFn A generator function with the same signature as a middleware guard. `yield` replaces
 *   `await` so the executor can re-enter context on each resume.
 * @returns A standard async MiddlewareGuard compatible with vue-router.
 * @internal Used by the build-time async-context transform — not intended for direct use.
 */
export function __executeMiddleware(
  genFn: (...args: any[]) => Generator<any, any, any>,
): MiddlewareGuard {
  return ((...args: any[]) => {
    const gen = genFn(...args);

    const stepInContext = (kind: 'next' | 'throw', value: any): IteratorResult<any> => {
      const advance = () => (kind === 'next' ? gen.next(value) : gen.throw(value));
      return _app ? _app.runWithContext(advance) : advance();
    };

    function step(value?: any): any {
      let result: IteratorResult<any>;
      try {
        result = stepInContext('next', value);
      } catch (err) {
        return Promise.reject(err);
      }
      if (result.done) return result.value;
      return Promise.resolve(result.value).then(step, throwIntoGen);
    }

    function throwIntoGen(err: any): any {
      let result: IteratorResult<any>;
      try {
        result = stepInContext('throw', err);
      } catch (e) {
        return Promise.reject(e);
      }
      if (result.done) return result.value;
      // Mutual recursion so subsequent rejections continue to be propagated through gen.throw()
      return Promise.resolve(result.value).then(step, throwIntoGen);
    }

    return step();
  }) as MiddlewareGuard;
}
