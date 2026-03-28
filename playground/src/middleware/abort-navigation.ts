import { defineMiddleware } from "virtual:vue-middleware";

export default defineMiddleware(() => {
  console.log("[Abort] Middleware returns false, navigation aborted.");
  alert("Middleware Aborted: You cannot enter this page!");
  return false;
});
