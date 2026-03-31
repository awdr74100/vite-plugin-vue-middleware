import { defineMiddleware } from 'virtual:vue-middleware';

export default defineMiddleware((to) => {
  console.log('[Global 2] Second Global Middleware', to.path);
});
