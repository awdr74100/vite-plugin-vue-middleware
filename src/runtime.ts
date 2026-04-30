import { type App } from 'vue';
import type { Router, NavigationGuard, NavigationGuardReturn } from 'vue-router';

/** Route guard return type, aligned with vue-router's NavigationGuardReturn */
export type RouteGuardReturn = NavigationGuardReturn;

/**
 * Middleware guard function type
 *
 * Use NavigationGuard to allow direct calls without .call(undefined)
 */
export type MiddlewareGuard = NavigationGuard;

// Captured Vue app instance — set once router.install(app) is called
let _app: App | null = null;

/**
 * Helper function for defining middleware with type safety
 *
 * @example
 *   export default defineMiddleware((to, from) => {
 *     if (!isLoggedIn()) return '/login';
 *   });
 *
 * @param {MiddlewareGuard} middleware - Middleware handler function
 * @returns {MiddlewareGuard}
 */
export function defineMiddleware(middleware: MiddlewareGuard): MiddlewareGuard {
  return middleware;
}

/**
 * Core middleware execution logic
 *
 * @param {Router} router - Vue Router instance
 * @param {MiddlewareGuard[]} globalMiddleware - List of global middleware
 * @param {Record<string, MiddlewareGuard>} namedMiddleware - Map of named middleware
 */
export function setupMiddleware(
  router: Router,
  globalMiddleware: MiddlewareGuard[],
  namedMiddleware: Record<string, MiddlewareGuard>,
): void {
  const originalInstall = router.install.bind(router);

  // Intercept install to capture the app instance before Vue Router initializes
  router.install = function (app: App) {
    _app = app;
    return originalInstall(app);
  };

  router.beforeEach(async (to, from) => {
    // No-op function to pass as the `next` argument for compatibility
    const noop = () => {};

    // Wraps a middleware call inside app.runWithContext so that inject() and
    // composables that internally use inject() (e.g. useQueryClient) work
    // synchronously at the top of the middleware body, just like inside a component.
    // Note: inject() must be called before the first await in the middleware —
    // this matches Vue's own rules for the Composition API.
    const run = (middleware: MiddlewareGuard) =>
      _app ? _app.runWithContext(() => middleware(to, from, noop)) : middleware(to, from, noop);

    // Execute global middleware in order
    for (const middleware of globalMiddleware) {
      const result = await run(middleware);

      if (result === false) return false;
      if (result instanceof Error) return Promise.reject(result);
      if (result !== undefined && result !== true) return result;
    }

    // Get current route's middleware (supports array or single string)
    const routeMiddleware = to.meta.middleware;
    if (!routeMiddleware) return;

    const middlewareKeys = Array.isArray(routeMiddleware) ? routeMiddleware : [routeMiddleware];

    // Execute named middleware in order
    for (const key of middlewareKeys) {
      if (typeof key !== 'string') continue;

      const middleware = namedMiddleware[key];
      if (!middleware) {
        console.warn(`[vite-plugin-vue-middleware] Middleware "${key}" not found.`);
        continue;
      }

      const result = await run(middleware);

      if (result === false) return false;
      if (result instanceof Error) return Promise.reject(result);
      if (result !== undefined && result !== true) return result;
    }
  });
}

/**
 * Generator-based executor that preserves Vue injection context across yield boundaries.
 *
 * Each segment between yields runs inside `app.runWithContext()`, ensuring that `inject()` and any
 * composable relying on it (e.g. `useQueryClient()`) works even after `await` in middleware.
 *
 * @param genFn - A generator function with the same signature as a middleware guard. `yield`
 *   replaces `await` so the executor can re-enter context on each resume.
 * @returns A standard async MiddlewareGuard compatible with vue-router
 * @internal Used by the build-time async-context transform — not intended for direct use.
 */
export function __executeMiddleware(
  genFn: (...args: any[]) => Generator<any, any, any>,
): MiddlewareGuard {
  return ((...args: any[]) => {
    const app = _app;
    const gen = genFn(...args);

    function step(value?: any): any {
      let result: IteratorResult<any>;
      try {
        result = app ? app.runWithContext(() => gen.next(value)) : gen.next(value);
      } catch (err) {
        return Promise.reject(err);
      }
      if (result.done) return result.value;
      return Promise.resolve(result.value).then(step, throwIntoGen);
    }

    function throwIntoGen(err: any): any {
      let errResult: IteratorResult<any>;
      try {
        errResult = app ? app.runWithContext(() => gen.throw(err)) : gen.throw(err);
      } catch (e) {
        return Promise.reject(e);
      }
      if (errResult.done) return errResult.value;
      // Use mutual recursion so subsequent rejections are also propagated through gen.throw()
      return Promise.resolve(errResult.value).then(step, throwIntoGen);
    }

    return step();
  }) as MiddlewareGuard;
}
