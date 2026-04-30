declare module 'virtual:vue-middleware' {
  import type { Router, NavigationGuard, NavigationGuardReturn } from 'vue-router';

  /** Route guard return type, aligned with vue-router's NavigationGuardReturn */
  export type RouteGuardReturn = NavigationGuardReturn;

  /**
   * Middleware guard function type
   *
   * Use NavigationGuard to allow direct calls without .call(undefined)
   */
  export type MiddlewareGuard = NavigationGuard;

  export const globalMiddleware: MiddlewareGuard[];
  export const namedMiddleware: Record<string, MiddlewareGuard>;

  export const setupMiddleware: (router: Router) => void;
  export const defineMiddleware: (middleware: MiddlewareGuard) => MiddlewareGuard;

  /**
   * Generator-based executor that preserves Vue injection context across yield boundaries.
   *
   * @internal Used by the build-time async-context transform — not intended for direct use.
   */
  export const __executeMiddleware: (
    genFn: (...args: Parameters<MiddlewareGuard>) => Generator,
  ) => MiddlewareGuard;
}
