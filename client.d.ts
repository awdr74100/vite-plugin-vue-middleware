declare module 'virtual:vue-middleware' {
  import type { Router, NavigationGuardWithThis, NavigationGuardReturn } from 'vue-router';

  /**
   * Route guard return type, aligned with vue-router's NavigationGuardReturn
   */
  export type RouteGuardReturn = NavigationGuardReturn;

  /**
   * Middleware guard function type, using NavigationGuardWithThis<undefined> for compatibility with Vue Router standards
   */
  export type MiddlewareGuard = NavigationGuardWithThis<undefined>;

  export const globalMiddleware: MiddlewareGuard[];
  export const namedMiddleware: Record<string, MiddlewareGuard>;

  export const setupMiddleware: (router: Router) => void;
  export const defineMiddleware: (middleware: MiddlewareGuard) => MiddlewareGuard;
}
