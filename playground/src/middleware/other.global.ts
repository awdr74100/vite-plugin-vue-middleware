import { defineMiddleware } from 'virtual:vue-middleware';

export default defineMiddleware((to) => {
  console.log('[Global 0] No Prefix Global Middleware', to.path);
});
