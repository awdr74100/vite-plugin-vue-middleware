import { defineMiddleware } from 'virtual:vue-middleware';
import { inject } from 'vue';

export default defineMiddleware(async (to) => {
  console.log('[Global 1] First Global Middleware', to.path, inject('test'));
  console.log(inject('test'));

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(inject('test2'));
});
