declare module 'virtual:vue-middleware' {
  import type { Router, RouteLocationNormalized, RouteLocationRaw } from 'vue-router';

  export type RouteGuardReturn = void | Error | string | boolean | RouteLocationRaw;
  export type MiddlewareGuard = (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
  ) => RouteGuardReturn | Promise<RouteGuardReturn>;

  export const globalMiddleware: MiddlewareGuard[];
  export const namedMiddleware: Record<string, MiddlewareGuard>;

  export const setupMiddleware: (router: Router) => void;
  export const defineMiddleware: (middleware: MiddlewareGuard) => MiddlewareGuard;
}
