import { defineMiddleware } from "virtual:vue-middleware";

export default defineMiddleware((to) => {
  console.log("[Global 1] First Global Middleware", to.path);
});
