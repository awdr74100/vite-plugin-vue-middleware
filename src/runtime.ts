import type { Router, RouteLocationNormalized, RouteLocationRaw } from 'vue-router';

/**
 * @description Middleware 執行後的結果型別
 */
export type RouteGuardReturn = void | Error | string | boolean | RouteLocationRaw;

/**
 * @description Middleware 處理函式型別，用於 defineMiddleware
 */
export type MiddlewareGuard = (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
) => RouteGuardReturn | Promise<RouteGuardReturn>;

/**
 * 定義 Middleware 的輔助函式，提供強型別支援
 *
 * @description
 * 使用此函式定義 Middleware 可以獲得完善的 TypeScript 型別支援。
 *
 * @param {MiddlewareGuard} middleware - Middleware 處理函式
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
 * 核心 Middleware 執行邏輯（內部使用）
 *
 * @param {Router} router - Vue Router 實例
 * @param {MiddlewareGuard[]} globalMiddleware - 全域 Middleware 清單
 * @param {Record<string, MiddlewareGuard>} namedMiddleware - 具名 Middleware 對應表
 * @returns {void}
 */
export function setupMiddleware(
  router: Router,
  globalMiddleware: MiddlewareGuard[],
  namedMiddleware: Record<string, MiddlewareGuard>,
): void {
  router.beforeEach(async (to, from) => {
    // 依序執行 Global Middleware
    for (const middleware of globalMiddleware) {
      const result = await middleware(to, from);

      if (result === false) return false;
      if (result instanceof Error) return Promise.reject(result);
      if (result) return result;
    }

    // 取得當前路由的 middleware (支援陣列或單一字串)
    const routeMiddleware = to.meta.middleware;
    if (!routeMiddleware) return;

    const middlewareKeys = Array.isArray(routeMiddleware) ? routeMiddleware : [routeMiddleware];

    // 依序執行 Named Middleware
    for (const key of middlewareKeys) {
      if (typeof key !== 'string') continue;

      const middleware = namedMiddleware[key];
      if (!middleware) {
        console.warn(`[vite-plugin-vue-middleware] Middleware "${key}" not found.`);
        continue;
      }

      const result = await middleware(to, from);

      if (result === false) return false;
      if (result instanceof Error) return Promise.reject(result);
      if (result) return result;
    }
  });
}
