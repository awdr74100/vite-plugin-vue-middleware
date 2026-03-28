import { defineMiddleware } from "virtual:vue-middleware";

export default defineMiddleware(() => {
  console.log("[Redirect] Intercepting /news -> /about");
  return "/about";
});
