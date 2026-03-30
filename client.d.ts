declare module 'virtual:vue-middleware' {
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

  export const globalMiddleware: MiddlewareGuard[];
  export const namedMiddleware: Record<string, MiddlewareGuard>;

  export const setupMiddleware: (router: Router) => void;
  export const defineMiddleware: (middleware: MiddlewareGuard) => MiddlewareGuard;
}

