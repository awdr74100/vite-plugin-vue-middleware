import { defineMiddleware } from 'virtual:vue-middleware';
import { inject } from 'vue';

export default defineMiddleware(async (to) => {
  console.log('[Global 1] First Global Middleware', to.path);

  console.log(inject('hobbies'));

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(inject('name'));
});
