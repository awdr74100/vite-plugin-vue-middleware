import { defineMiddleware } from "virtual:vue-middleware";

export default defineMiddleware((to) => {
  console.log("[Named 1] First Named Middleware On This Route", to.path);
});
