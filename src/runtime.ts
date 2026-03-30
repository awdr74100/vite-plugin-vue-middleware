import type { Router, NavigationGuard, NavigationGuardReturn } from 'vue-router';

/**
 * Route guard return type, aligned with vue-router's NavigationGuardReturn
 */
export type RouteGuardReturn = NavigationGuardReturn;

/**
 * Middleware guard function type
 * @description Use NavigationGuard to allow direct calls without .call(undefined)
 */
export type MiddlewareGuard = NavigationGuard;

/**
 * Helper function for defining middleware with type safety
 *
 * @param {MiddlewareGuard} middleware - Middleware handler function
 * @returns {MiddlewareGuard}
 *
 * @example
 * export default defineMiddleware((to, from) => {
 *   if (!isLoggedIn()) return '/login'
 * })
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
  router.beforeEach(async (to, from) => {
    // No-op function to pass as the `next` argument for compatibility
    const noop = () => {};

    // Execute global middleware in order
    for (const middleware of globalMiddleware) {
      const result = await middleware(to, from, noop);

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

      const result = await middleware(to, from, noop);

      if (result === false) return false;
      if (result instanceof Error) return Promise.reject(result);
      if (result !== undefined && result !== true) return result;
    }
  });
}
