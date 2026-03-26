import { createRouter, createWebHistory } from "vue-router";
import { routes, handleHotUpdate } from "vue-router/auto-routes";
import { setupMiddleware } from "virtual:vue-middleware";
import { setupLayouts } from "virtual:meta-layouts";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: setupLayouts(routes),
});

setupMiddleware(router);

if (import.meta.hot) {
  handleHotUpdate(router);
}

export default router;
