import { setupLayouts } from 'virtual:meta-layouts';
import { setupMiddleware } from 'virtual:vue-middleware';
import { createRouter, createWebHistory } from 'vue-router';
import { routes, handleHotUpdate } from 'vue-router/auto-routes';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: setupLayouts(routes),
});

setupMiddleware(router);

if (import.meta.hot) {
  handleHotUpdate(router);
}

export default router;
