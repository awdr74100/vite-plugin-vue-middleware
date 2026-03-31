import { defineMiddleware } from 'virtual:vue-middleware';

export default defineMiddleware((to) => {
  console.log('[Named 2] Second Named Middleware On This Route', to.path);
});
